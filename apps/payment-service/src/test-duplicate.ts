import { Kafka, Partitioners } from 'kafkajs';
import { KAFKA_TOPICS } from '@oms/event-contracts';
import { pool } from './db/connection';

const kafka = new Kafka({
  clientId: 'test-runner',
  brokers: ['localhost:9094'],
});

const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });

async function run() {
  await producer.connect();

  // 1. Grab the eventId of an already processed event from payment_db
  const res = await pool.query('SELECT event_id FROM processed_events LIMIT 1');
  if (res.rows.length === 0) {
    console.error('No processed events found to test with.');
    process.exit(1);
  }

  const existingEventId = res.rows[0].event_id;
  console.log(`[Test] Re-sending duplicate event with eventId: ${existingEventId}`);

  // 2. Publish duplicate event
  await producer.send({
    topic: KAFKA_TOPICS.INVENTORY_EVENTS,
    messages: [
      {
        key: 'test-order-key',
        value: JSON.stringify({
          eventId: existingEventId, // DUPLICATE ID
          eventType: 'InventoryReserved',
          aggregateId: 'test-order-key',
          correlationId: 'test-corr-id',
          causationId: 'test-cause-id',
          timestamp: new Date().toISOString(),
          version: 1,
          producer: 'inventory-service',
          payload: {
            orderId: '00000000-0000-0000-0000-000000000000',
            items: [],
          },
        }),
      },
    ],
  });

  console.log('[Test] Duplicate event sent to Kafka.');
  await producer.disconnect();
  process.exit(0);
}

run().catch(console.error);