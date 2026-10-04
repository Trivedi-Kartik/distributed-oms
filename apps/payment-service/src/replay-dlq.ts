import { Kafka, Partitioners } from 'kafkajs';
import { DLQ_TOPICS, DeadLetterEnvelope } from '@oms/event-contracts';

const kafka = new Kafka({
  clientId: 'payment-dlq-replayer',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9094'],
});

async function runDLQReplay() {
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });

  // Use a unique group ID each run to guarantee we read from offset 0
  const replayGroupId = `payment-dlq-replayer-${Date.now()}`;
  const consumer = kafka.consumer({ groupId: replayGroupId });

  await producer.connect();
  await consumer.connect();

  console.log(`[DLQ Replayer] Connected. Scanning topic: ${DLQ_TOPICS.PAYMENT_EVENTS_DLQ}...`);

  await consumer.subscribe({
    topic: DLQ_TOPICS.PAYMENT_EVENTS_DLQ,
    fromBeginning: true,
  });

  let replayedCount = 0;

  // Set up an idle timeout to gracefully disconnect when no more messages arrive
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      console.log(`\n[DLQ Replayer] Completed. Total messages replayed: ${replayedCount}`);
      await consumer.disconnect();
      await producer.disconnect();
      process.exit(0);
    }, 4000); // 4 seconds without messages -> exit
  };

  resetIdleTimer();

  await consumer.run({
    eachMessage: async ({ message, partition, topic }) => {
      resetIdleTimer();
      if (!message.value) return;

      try {
        const dlqEnvelope: DeadLetterEnvelope = JSON.parse(message.value.toString());
        const { originalTopic, originalMessage, error, retryCount } = dlqEnvelope;

        console.log(`\n[DLQ Replayer] Found dead letter from: ${originalTopic}`);
        console.log(`   Failure reason: "${error.message}" (failed after ${retryCount} retries)`);

        // Check if message is JSON string or object
        const messageValue =
          typeof originalMessage === 'string'
            ? originalMessage
            : JSON.stringify(originalMessage);

        const parsedInner =
          typeof originalMessage === 'string'
            ? JSON.parse(originalMessage)
            : originalMessage;

        const partitionKey =
          parsedInner?.aggregateId || parsedInner?.payload?.orderId || 'replayed-key';

        // Publish back to original destination with replay audit metadata
        await producer.send({
          topic: originalTopic,
          messages: [
            {
              key: partitionKey,
              value: messageValue,
              headers: {
                'x-replayed': 'true',
                'x-replayed-at': new Date().toISOString(),
                'x-original-error': error.message,
              },
            },
          ],
        });

        replayedCount++;
        console.log(`   -> Successfully re-routed event back to [${originalTopic}]`);
      } catch (err: any) {
        console.error(`[DLQ Replayer] Failed to process message at offset ${message.offset}:`, err.message);
      }
    },
  });
}

runDLQReplay().catch((err) => {
  console.error('[DLQ Replayer] Fatal crash:', err);
  process.exit(1);
});