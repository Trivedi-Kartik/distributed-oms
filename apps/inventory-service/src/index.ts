import Fastify from "fastify";
import { Kafka, Partitioners } from "kafkajs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { pool } from "./db/connection";
import { initDatabase } from "./db/init";
import {
  KAFKA_TOPICS,
  OrderCreatedEvent,
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
} from "@oms/event-contracts";
import { initTracer } from "@oms/event-contracts";
import { injectTraceHeaders } from "@oms/event-contracts";

initTracer("inventory-service");

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
  clientId: "inventory-service",
  brokers: [process.env.KAFKA_BROKER || "localhost:9094"],
});

const consumer = kafka.consumer({ groupId: "inventory-service-group" });
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const CreateProductSchema = z.object({
  sku: z.string().min(1, "SKU is required").max(100),
  name: z.string().min(1, "Product name is required").max(255),
  availableQuantity: z.number().int().nonnegative().default(0),
});

const RestockProductSchema = z.object({
  quantityToAdd: z.number().int().positive("Must restock at least 1 unit"),
});

// ============================================================================
// REST API ROUTES
// ============================================================================

// 1. Health check
server.get("/health", async () => {
  return { 
    status: "healthy", 
    service: "inventory-service",
    timestamp: new Date().toISOString()
  };
});

// 2. List all inventory items
server.get("/api/inventory", async (request, reply) => {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT sku, name, available_quantity, reserved_quantity, updated_at
      FROM inventory
      ORDER BY sku ASC
    `);

    const summaryRes = await client.query(`
      SELECT 
        COUNT(*)::int as total_skus,
        COALESCE(SUM(available_quantity), 0)::int as total_available_units,
        COALESCE(SUM(reserved_quantity), 0)::int as total_reserved_units
      FROM inventory
    `);

    return reply.send({
      summary: summaryRes.rows[0],
      items: res.rows,
    });
  } catch (err) {
    request.log.error(err, "Failed to list inventory");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 3. Get single inventory item by SKU
server.get("/api/inventory/:sku", async (request, reply) => {
  const { sku } = request.params as { sku: string };
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT sku, name, available_quantity, reserved_quantity, updated_at
       FROM inventory
       WHERE sku = $1`,
      [sku]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: `SKU '${sku}' not found` });
    }

    return reply.send(res.rows[0]);
  } catch (err) {
    request.log.error(err, `Failed to fetch SKU ${sku}`);
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 4. Create new product/SKU
server.post("/api/inventory", async (request, reply) => {
  const parseResult = CreateProductSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: "Invalid request payload",
      details: parseResult.error.issues,
    });
  }

  const { sku, name, availableQuantity } = parseResult.data;
  const client = await pool.connect();

  try {
    const existing = await client.query(
      `SELECT sku FROM inventory WHERE sku = $1`,
      [sku]
    );

    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: `SKU '${sku}' already exists` });
    }

    const insertRes = await client.query(
      `INSERT INTO inventory (sku, name, available_quantity, reserved_quantity)
       VALUES ($1, $2, $3, 0)
       RETURNING sku, name, available_quantity, reserved_quantity, updated_at`,
      [sku, name, availableQuantity]
    );

    return reply.status(201).send(insertRes.rows[0]);
  } catch (err) {
    request.log.error(err, "Failed to create product");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 5. Restock / Add stock to an existing SKU
server.post("/api/inventory/:sku/restock", async (request, reply) => {
  const { sku } = request.params as { sku: string };
  const parseResult = RestockProductSchema.safeParse(request.body);

  if (!parseResult.success) {
    return reply.status(400).send({
      error: "Invalid request payload",
      details: parseResult.error.issues,
    });
  }

  const { quantityToAdd } = parseResult.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT sku, name, available_quantity, reserved_quantity 
       FROM inventory 
       WHERE sku = $1 
       FOR UPDATE`,
      [sku]
    );

    if (res.rows.length === 0) {
      await client.query("ROLLBACK");
      return reply.status(404).send({ error: `SKU '${sku}' not found` });
    }

    const updateRes = await client.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity + $1,
           updated_at = NOW()
       WHERE sku = $2
       RETURNING sku, name, available_quantity, reserved_quantity, updated_at`,
      [quantityToAdd, sku]
    );

    await client.query("COMMIT");

    return reply.send({
      message: `Successfully restocked ${quantityToAdd} units of '${sku}'`,
      item: updateRes.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    request.log.error(err, `Failed to restock SKU ${sku}`);
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 6. List reservations
server.get("/api/inventory/reservations", async (request, reply) => {
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

    const res = await client.query(
      `SELECT id, order_id, sku, quantity, status, created_at
       FROM inventory_reservations
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...values, limit, offset]
    );

    return reply.send({
      limit,
      offset,
      reservations: res.rows,
    });
  } catch (err) {
    request.log.error(err, "Failed to list reservations");
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// 7. Get reservations for a specific order
server.get("/api/inventory/reservations/:orderId", async (request, reply) => {
  const { orderId } = request.params as { orderId: string };
  const client = await pool.connect();

  try {
    const res = await client.query(
      `SELECT id, order_id, sku, quantity, status, created_at
       FROM inventory_reservations
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [orderId]
    );

    return reply.send({
      orderId,
      reservations: res.rows,
    });
  } catch (err) {
    request.log.error(err, `Failed to get reservations for order ${orderId}`);
    return reply.status(500).send({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ============================================================================
// KAFKA EVENT PROCESSORS
// ============================================================================

async function handleOrderCreated(event: OrderCreatedEvent) {
  const { orderId, items } = event.payload;
  console.log(`[Inventory] Received OrderCreated for Order: ${orderId}`);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Check stock for ALL items using pessimistic row locks (FOR UPDATE)
    for (const item of items) {
      const res = await client.query(
        `SELECT available_quantity, reserved_quantity 
         FROM inventory 
         WHERE sku = $1 
         FOR UPDATE`,
        [item.sku],
      );

      if (
        res.rows.length === 0 ||
        res.rows[0].available_quantity < item.quantity
      ) {
        // Insufficient stock or SKU does not exist
        await client.query("ROLLBACK");

        const reason =
          res.rows.length === 0
            ? `SKU ${item.sku} not found`
            : `Insufficient stock for ${item.sku}. Requested: ${item.quantity}, Available: ${res.rows[0]?.available_quantity || 0}`;

        console.warn(`[Inventory] Reservation FAILED: ${reason}`);

        // Emit failure event
        const failureEvent: InventoryReservationFailedEvent = {
          eventId: uuidv4(),
          eventType: "InventoryReservationFailed",
          aggregateId: orderId,
          correlationId: event.correlationId,
          causationId: event.eventId,
          timestamp: new Date().toISOString(),
          version: 1,
          producer: "inventory-service",
          payload: { orderId, reason, items },
        };

        await producer.send({
          topic: KAFKA_TOPICS.INVENTORY_EVENTS,
          messages: [
            {
              key: orderId,
              value: JSON.stringify(failureEvent),
              headers: { eventType: "InventoryReservationFailed" },
            },
          ],
        });

        return;
      }
    }

    // 2. If all items have stock, reserve them atomically
    for (const item of items) {
      await client.query(
        `UPDATE inventory 
         SET available_quantity = available_quantity - $1,
             reserved_quantity = reserved_quantity + $1,
             updated_at = NOW()
         WHERE sku = $2`,
        [item.quantity, item.sku],
      );

      await client.query(
        `INSERT INTO inventory_reservations (id, order_id, sku, quantity, status)
         VALUES ($1, $2, $3, $4, 'RESERVED')`,
        [uuidv4(), orderId, item.sku, item.quantity],
      );
    }

    await client.query("COMMIT");
    console.log(
      `[Inventory] Stock successfully reserved for Order: ${orderId}`,
    );

    // 3. Emit success event
    const reservedEvent: InventoryReservedEvent = {
      eventId: uuidv4(),
      eventType: "InventoryReserved",
      aggregateId: orderId,
      correlationId: event.correlationId,
      causationId: event.eventId,
      timestamp: new Date().toISOString(),
      version: 1,
      producer: "inventory-service",
      payload: { orderId, items, totalAmount: event.payload.totalAmount },
    };

    await producer.send({
      topic: KAFKA_TOPICS.INVENTORY_EVENTS,
      messages: [
        {
          key: orderId,
          value: JSON.stringify(reservedEvent),
          headers: injectTraceHeaders({
            eventType: "InventoryReserved",
          }),
        },
      ],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`[Inventory] Error processing order ${orderId}:`, error);
  } finally {
    client.release();
  }
}

async function handleReleaseRequested(event: any) {
  const { orderId, reason } = event.payload;
  console.log(
    `[Inventory] Releasing reserved stock for Order: ${orderId}. Reason: ${reason}`,
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find active reservations
    const reservations = await client.query(
      `SELECT sku, quantity 
       FROM inventory_reservations 
       WHERE order_id = $1 AND status = 'RESERVED'`,
      [orderId],
    );

    if (reservations.rows.length === 0) {
      await client.query("COMMIT");
      console.log(
        `[Inventory] No active reservations found for order: ${orderId}`,
      );
      return;
    }

    // Return stock to available pool
    for (const row of reservations.rows) {
      await client.query(
        `UPDATE inventory 
         SET available_quantity = available_quantity + $1,
             reserved_quantity = reserved_quantity - $1,
             updated_at = NOW() 
         WHERE sku = $2`,
        [row.quantity, row.sku],
      );
    }

    // Mark reservation released
    await client.query(
      `UPDATE inventory_reservations 
       SET status = 'RELEASED' 
       WHERE order_id = $1`,
      [orderId],
    );

    await client.query("COMMIT");
    console.log(
      `[Inventory] Stock successfully released for Order: ${orderId}`,
    );

    // Emit InventoryReleased back to Kafka
    const releasedEvent = {
      eventId: uuidv4(),
      eventType: "InventoryReleased",
      aggregateId: orderId,
      correlationId: event.correlationId,
      causationId: event.eventId,
      timestamp: new Date().toISOString(),
      version: 1,
      producer: "inventory-service",
      payload: {
        orderId,
        reason,
      },
    };

    await producer.send({
      topic: KAFKA_TOPICS.INVENTORY_EVENTS,
      messages: [
        {
          key: orderId,
          value: JSON.stringify(releasedEvent),
          headers: injectTraceHeaders({
            eventType: "InventoryReleased",
          }),
        },
      ],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      `[Inventory] Error releasing inventory for order ${orderId}:`,
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

  console.log("[Kafka] Inventory Service producer & consumer connected.");

  // 1. Subscribe to relevant topics
  await consumer.subscribe({
    topic: KAFKA_TOPICS.ORDER_EVENTS,
    fromBeginning: true,
  });
  await consumer.subscribe({
    topic: KAFKA_TOPICS.INVENTORY_EVENTS,
    fromBeginning: true,
  });

  // 2. Dispatch events
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      const event = JSON.parse(message.value.toString());

      if (event.eventType === "OrderCreated") {
        await handleOrderCreated(event);
      } else if (
        event.eventType === "InventoryReleaseRequested" ||
        event.eventType === "OrderCancelled"
      ) {
        await handleReleaseRequested(event);
      }
    },
  });

  // 3. Start HTTP Server on Port 3002
  const PORT = Number(process.env.PORT) || 3002;
  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[Server] Inventory Service listening on http://localhost:${PORT}`);
}

start().catch(console.error);
