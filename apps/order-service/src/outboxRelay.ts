import { pool } from "./db/connection";
import { producer } from "./kafka";
import { KAFKA_TOPICS } from "@oms/event-contracts";
import { injectTraceHeaders } from "@oms/event-contracts";

let isRunning = false;

export async function processOutboxBatch() {
  // Prevent overlapping runs if the previous batch is still busy publishing
  if (isRunning) return;
  isRunning = true;

  const client = await pool.connect();

  try {
    // 1. Begin atomic transaction
    await client.query("BEGIN");

    // 2. Select unpublished events using FOR UPDATE SKIP LOCKED
    // - FOR UPDATE: Locks rows so no other worker picks them up
    // - SKIP LOCKED: If another instance already locked rows, skip them immediately
    const res = await client.query(`
      SELECT id, aggregate_id, event_type, payload
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);

    if (res.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    console.log(
      `[Outbox Relay] Found ${res.rows.length} pending events to publish.`,
    );

    // 3. Publish each event to Kafka
    for (const row of res.rows) {
      await producer.send({
        topic: KAFKA_TOPICS.ORDER_EVENTS,
        messages: [
          {
            key: row.aggregate_id,
            value:
              typeof row.payload === "string"
                ? row.payload
                : JSON.stringify(row.payload),
            headers: injectTraceHeaders({
              eventType: row.event_type,
            }),
          },
        ],
      });

      // 4. Mark the outbox event as published
      await client.query(
        `UPDATE outbox_events 
         SET published_at = NOW() 
         WHERE id = $1`,
        [row.id],
      );

      console.log(
        `[Outbox Relay] Published ${row.event_type} for Order: ${row.aggregate_id}`,
      );
    }

    // 5. Commit the batch transaction
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[Outbox Relay] Error processing outbox batch:", error);
  } finally {
    client.release();
    isRunning = false;
  }
}

// Polling Loop: Runs every 1 second
export function startOutboxRelay(intervalMs = 1000) {
  console.log("[Outbox Relay] Worker started polling...");
  setInterval(async () => {
    try {
      await processOutboxBatch();
    } catch (err) {
      console.error("[Outbox Relay] Unhandled error in relay loop:", err);
    }
  }, intervalMs);
}
