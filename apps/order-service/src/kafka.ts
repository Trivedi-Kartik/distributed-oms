import { Kafka, Partitioners } from 'kafkajs';

// ============================================================================
// KAFKA CLIENT CONFIGURATION
// ============================================================================
// We connect to 'localhost:9094' because this Node process runs on your laptop,
// communicating with the Kafka container via the EXTERNAL listener port.
// ============================================================================
export const kafka = new Kafka({
  clientId: 'order-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9094'],
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

// Create a singleton producer instance
export const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});