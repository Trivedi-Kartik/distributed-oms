import { Kafka, Partitioners } from "kafkajs";
import { v4 as uuidv4 } from "uuid";
import { context, trace } from "@opentelemetry/api";
import {
  KAFKA_TOPICS,
  extractTraceContext,
  injectTraceHeaders,
} from "@oms/event-contracts";

const kafka = new Kafka({
  clientId: "saga-orchestrator",
  brokers: [process.env.KAFKA_BROKER || "localhost:9094"],
});

const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

const consumer = kafka.consumer({
  groupId: "order-saga-orchestrator-group",
});

import { pool } from "./db/connection";

export async function startSagaOrchestrator(): Promise<void> {
  await producer.connect();
  await consumer.connect();

  console.log("[Saga Orchestrator] Connected to Kafka.");

  // Listen to outcomes from downstream services
  await consumer.subscribe({
    topic: KAFKA_TOPICS.INVENTORY_EVENTS,
    fromBeginning: true,
  });

  await consumer.subscribe({
    topic: KAFKA_TOPICS.PAYMENT_EVENTS,
    fromBeginning: true,
  });

  const tracer = trace.getTracer("saga-orchestrator");

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;

      // 1. EXTRACT: Read the incoming trace headers from Kafka
      const parentContext = extractTraceContext(message.headers || {});

      // 2. CONTEXT: Tell OpenTelemetry to link all DB calls below to that trace
      await context.with(parentContext, async () => {
        const span = tracer.startSpan(`saga process ${topic}`);

        const client = await pool.connect();
        try {
          const event = JSON.parse(message.value!.toString());
          const { eventType, aggregateId } = event;
          const orderId = aggregateId || event.payload?.orderId;

          if (!orderId) return;

          // Case A: Stock reservation failed -> Cancel order immediately
          if (eventType === "InventoryReservationFailed") {
            console.log(
              `[Saga] Stock reservation failed for order ${orderId}. Cancelling.`,
            );
            await client.query(
              `UPDATE orders 
               SET status = 'CANCELLED', cancellation_reason = $1, updated_at = NOW() 
               WHERE id = $2`,
              [event.payload.reason, orderId],
            );
          }

          // Case B: Payment authorized -> Confirm order (Happy Path complete)
          else if (eventType === "PaymentAuthorized") {
            console.log(
              `[Saga] Payment authorized for order ${orderId}. Confirming.`,
            );
            await client.query(
              `UPDATE orders 
               SET status = 'CONFIRMED', updated_at = NOW() 
               WHERE id = $1`,
              [orderId],
            );
          }

          // Case C: Payment failed -> Trigger compensating rollback on inventory
          else if (eventType === "PaymentFailed") {
            console.warn(
              `[Saga] Payment failed for order ${orderId}. Triggering compensation...`,
            );

            await client.query(
              `UPDATE orders 
               SET status = 'COMPENSATING', cancellation_reason = $1, updated_at = NOW() 
               WHERE id = $2`,
              [event.payload.reason, orderId],
            );

            // Construct compensation event with trace headers injected
            const compensationEvent = {
              eventId: uuidv4(),
              eventType: "InventoryReleaseRequested",
              aggregateId: orderId,
              correlationId: event.correlationId,
              causationId: event.eventId,
              timestamp: new Date().toISOString(),
              version: 1,
              producer: "saga-orchestrator",
              payload: {
                orderId,
                reason: event.payload.reason,
              },
            };

            // 3. INJECT: Pass the trace context into the rollback message
            await producer.send({
              topic: KAFKA_TOPICS.INVENTORY_EVENTS,
              messages: [
                {
                  key: orderId,
                  value: JSON.stringify(compensationEvent),
                  headers: injectTraceHeaders({
                    eventType: "InventoryReleaseRequested",
                  }),
                },
              ],
            });
          }

          // Case D: Inventory compensation complete -> Move to terminal CANCELLED
          else if (eventType === "InventoryReleased") {
            console.log(
              `[Saga] Compensation finished for order ${orderId}. Marking CANCELLED.`,
            );
            await client.query(
              `UPDATE orders 
               SET status = 'CANCELLED', updated_at = NOW() 
               WHERE id = $1`,
              [orderId],
            );
          }
        } catch (error) {
          console.error(
            `[Saga Orchestrator] Error processing ${topic}:`,
            error,
          );
        } finally {
          client.release();
          span.end();
        }
      });
    },
  });
}
