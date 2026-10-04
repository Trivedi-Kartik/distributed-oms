import Fastify from "fastify";
import { Kafka, Partitioners } from "kafkajs";
import { v4 as uuidv4 } from "uuid";
import { pool } from "./db/connection";
import { initDatabase } from "./db/init";
import {
  KAFKA_TOPICS,
  InventoryReservedEvent,
  PaymentAuthorizedEvent,
  PaymentFailedEvent,
  DLQ_TOPICS,
  DeadLetterEnvelope,
  runResilientConsumer,
} from "@oms/event-contracts";
import { initTracer } from "@oms/event-contracts";
import { injectTraceHeaders } from "@oms/event-contracts";

initTracer("payment-service");

// Configure HTTP Server
const server = Fastify({ logger: true });

// Native CORS headers without plugin version mismatch
server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-correlation-id');
  if (request.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

// Handle empty or optional request bodies gracefully
server.addContentTypeParser('*', (_request, payload, done) => {
  let data = '';
  payload.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  payload.on('end', () => {
    if (!data || data.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(data));
    } catch {
      done(null, data);
    }
  });
});

import { registerSwagger } from './swagger';

// Register Swagger UI at /docs and OpenAPI JSON at /docs/openapi.json
registerSwagger(server);

// Configure Kafka client
const kafka = new Kafka({
  clientId: "payment-service",
  brokers: [process.env.KAFKA_BROKER || "localhost:9094"],
});

const consumer = kafka.consumer({ groupId: "payment-service-group" });
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

// ============================================================================
// REST API ROUTES
// ============================================================================

// 1. Health check
server.get("/health", async () => {
  return { 
    status: "healthy", 
    service: "payment-service",
    timestamp: new Date().toISOString()
  };
});

// 2. Transaction Stats & Summary
server.get("/api/payments/stats", async (request, reply) => {
  const client = await pool.connect();
  try {
    const statusCounts = await client.query(`
      SELECT 
        status, 
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as volume
      FROM payments
      GROUP BY status
    `);

    const processedEventsCount = await client.query(`
      SELECT COUNT(*)::int as total FROM processed_events
    `);

    const summary: Record<string, { count: number; volume: number }> = {
      AUTHORIZED: { count: 0, volume: 0 },
      FAILED: { count: 0, volume: 0 },
    };

    for (const row of statusCounts.rows) {
      summary[row.status] = {
        count: row.count,
        volume: Number(row.volume),
      };
    }

    return reply.send({
      totalProcessedEvents: processedEventsCount.rows[0].total,
      authorized: summary.AUTHORIZED,
      failed: summary.FAILED,
      totalVolume: summary.AUTHORIZED.volume + summary.FAILED.volume,
    });
  } catch (err) {
    request.log.error(err, "Failed to get payment stats");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 3. List Payments (with filtering & pagination)
server.get("/api/payments", async (request, reply) => {
  const query = request.query as {
    orderId?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const client = await pool.connect();
  try {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (query.orderId) {
      conditions.push(`order_id = $${paramIndex++}`);
      values.push(query.orderId);
    }

    if (query.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(query.status.toUpperCase());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await client.query(
      `SELECT COUNT(*)::int as total FROM payments ${whereClause}`,
      values
    );
    const total = countRes.rows[0]?.total || 0;

    const res = await client.query(
      `SELECT id, order_id, amount, currency, status, created_at
       FROM payments
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...values, limit, offset]
    );

    return reply.send({
      total,
      limit,
      offset,
      payments: res.rows,
    });
  } catch (err) {
    request.log.error(err, "Failed to list payments");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 4. Get Payment by Payment ID
server.get("/api/payments/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const client = await pool.connect();

  try {
    const res = await client.query(
      `SELECT id, order_id, amount, currency, status, created_at
       FROM payments
       WHERE id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: `Payment with ID ${id} not found` });
    }

    return reply.send(res.rows[0]);
  } catch (err) {
    request.log.error(err, `Failed to get payment ${id}`);
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 5. Get Payment by Order ID
server.get("/api/payments/order/:orderId", async (request, reply) => {
  const { orderId } = request.params as { orderId: string };
  const client = await pool.connect();

  try {
    const res = await client.query(
      `SELECT id, order_id, amount, currency, status, created_at
       FROM payments
       WHERE order_id = $1
       ORDER BY created_at DESC`,
      [orderId]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: `No payments found for order ${orderId}` });
    }

    return reply.send({
      orderId,
      payments: res.rows,
    });
  } catch (err) {
    request.log.error(err, `Failed to get payment for order ${orderId}`);
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 6. List Processed Events (Idempotency Audit)
server.get("/api/payments/processed-events", async (request, reply) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT event_id, consumer_name, processed_at
       FROM processed_events
       ORDER BY processed_at DESC
       LIMIT 50`
    );

    return reply.send({
      count: res.rows.length,
      events: res.rows,
    });
  } catch (err) {
    request.log.error(err, "Failed to list processed events");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 7. Trigger Dead Letter Queue (DLQ) Replay via API
server.post("/api/payments/dlq/replay", async (request, reply) => {
  const replayGroupId = `payment-dlq-api-replayer-${Date.now()}`;
  const replayConsumer = kafka.consumer({ groupId: replayGroupId });

  try {
    await replayConsumer.connect();
    await replayConsumer.subscribe({
      topic: DLQ_TOPICS.PAYMENT_EVENTS_DLQ,
      fromBeginning: true,
    });

    let replayedCount = 0;
    const replayedMessages: any[] = [];

    // Run short-lived consumer with a timeout
    await new Promise<void>((resolve) => {
      let timeout = setTimeout(async () => {
        resolve();
      }, 3000);

      replayConsumer.run({
        eachMessage: async ({ message }) => {
          clearTimeout(timeout);
          if (message.value) {
            try {
              const dlqEnvelope: DeadLetterEnvelope = JSON.parse(message.value.toString());
              const { originalTopic, originalMessage, error } = dlqEnvelope;

              const messageValue =
                typeof originalMessage === "string"
                  ? originalMessage
                  : JSON.stringify(originalMessage);

              const parsedInner =
                typeof originalMessage === "string"
                  ? JSON.parse(originalMessage)
                  : originalMessage;

              const partitionKey =
                parsedInner?.aggregateId || parsedInner?.payload?.orderId || "replayed-key";

              await producer.send({
                topic: originalTopic,
                messages: [
                  {
                    key: partitionKey,
                    value: messageValue,
                    headers: {
                      "x-replayed": "true",
                      "x-replayed-at": new Date().toISOString(),
                      "x-original-error": error.message,
                    },
                  },
                ],
              });

              replayedCount++;
              replayedMessages.push({
                originalTopic,
                orderId: partitionKey,
                reason: error.message,
              });
            } catch (err: any) {
              console.error("[API DLQ Replay] Parse error:", err.message);
            }
          }
          timeout = setTimeout(async () => {
            resolve();
          }, 2000);
        },
      });
    });

    await replayConsumer.disconnect();

    return reply.send({
      message: `DLQ replay complete. ${replayedCount} message(s) replayed.`,
      replayedCount,
      replayedMessages,
    });
  } catch (err: any) {
    request.log.error(err, "Failed to run DLQ replay");
    return reply.status(500).send({ error: err.message || "Failed to replay DLQ" });
  }
});

// ============================================================================
// KAFKA PAYMENT PROCESSOR
// ============================================================================

async function processPayment(event: InventoryReservedEvent) {
  const { orderId, totalAmount } = event.payload;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Deduplication check
    try {
      await client.query(
        `INSERT INTO processed_events (event_id, consumer_name)
         VALUES ($1, $2)`,
        [event.eventId, "payment-service"],
      );
    } catch (dedupError: any) {
      if (dedupError.code === "23505") {
        await client.query("ROLLBACK");
        console.warn(
          `[Payment] Duplicate event ${event.eventId} detected. Skipping safely.`,
        );
        return;
      }
      throw dedupError;
    }

    console.log(
      `[Payment] Processing payment for Order: ${orderId} (Amount: ₹${totalAmount})...`,
    );

    // Business rule: Amounts over ₹5,00,000 fail limit checks
    const isSuccess = totalAmount <= 500000;
    const paymentId = uuidv4();

    if (isSuccess) {
      await client.query(
        `INSERT INTO payments (id, order_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, 'AUTHORIZED')`,
        [paymentId, orderId, totalAmount, "INR"],
      );

      await client.query("COMMIT");
      console.log(`[Payment] Payment AUTHORIZED for Order: ${orderId}`);

      const authorizedEvent: PaymentAuthorizedEvent = {
        eventId: uuidv4(),
        eventType: "PaymentAuthorized",
        aggregateId: orderId,
        correlationId: event.correlationId,
        causationId: event.eventId,
        timestamp: new Date().toISOString(),
        version: 1,
        producer: "payment-service",
        payload: {
          orderId,
          paymentId,
          amount: totalAmount,
          currency: "INR",
        },
      };

      await producer.send({
        topic: KAFKA_TOPICS.PAYMENT_EVENTS,
        messages: [
          {
            key: orderId,
            value: JSON.stringify(authorizedEvent),
            headers: injectTraceHeaders({
              eventType: "PaymentAuthorized",
            }),
          },
        ],
      });
    } else {
      await client.query(
        `INSERT INTO payments (id, order_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, 'FAILED')`,
        [paymentId, orderId, totalAmount, "INR"],
      );

      await client.query("COMMIT");
      console.warn(
        `[Payment] Payment FAILED for Order: ${orderId} - Limit exceeded`,
      );

      const failedEvent: PaymentFailedEvent = {
        eventId: uuidv4(),
        eventType: "PaymentFailed",
        aggregateId: orderId,
        correlationId: event.correlationId,
        causationId: event.eventId,
        timestamp: new Date().toISOString(),
        version: 1,
        producer: "payment-service",
        payload: {
          orderId,
          reason: `Transaction amount ₹${totalAmount} exceeds allowed limit of ₹5,00,000`,
          amount: totalAmount,
        },
      };

      await producer.send({
        topic: KAFKA_TOPICS.PAYMENT_EVENTS,
        messages: [
          {
            key: orderId,
            value: JSON.stringify(failedEvent),
            headers: injectTraceHeaders({
              eventType: "PaymentFailed",
            }),
          },
        ],
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      `[Payment] Fatal error processing payment for ${orderId}:`,
      error,
    );
  } finally {
    client.release();
  }
}

// ============================================================================
// APPLICATION STARTUP
// ============================================================================

async function start() {
  await initDatabase();
  await producer.connect();
  await consumer.connect();

  console.log("[Kafka] Payment Service consumer & producer connected.");

  await consumer.subscribe({
    topic: KAFKA_TOPICS.INVENTORY_EVENTS,
    fromBeginning: true,
  });

  const CONSUMER_GROUP = "payment-service-group";

  // Run resilient consumer in background
  runResilientConsumer({
    consumer,
    producer,
    consumerGroup: CONSUMER_GROUP,
    dlqTopic: DLQ_TOPICS.PAYMENT_EVENTS_DLQ,
    maxRetries: 3,
    initialBackoffMs: 500,
    handler: async (event: any) => {
      if (event.eventType === "InventoryReserved") {
        await processPayment(event as InventoryReservedEvent);
      }
    },
  }).catch((err) => {
    console.error("[Payment Consumer] Fatal consumer crash:", err);
  });

  // Start HTTP Server on Port 3003
  const PORT = Number(process.env.PORT) || 3003;
  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[Server] Payment Service listening on http://localhost:${PORT}`);
}

start().catch(console.error);
