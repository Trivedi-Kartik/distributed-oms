# 📜 Package: `@oms/event-contracts`

The `@oms/event-contracts` package is the single source of truth for all asynchronous message definitions, Zod validation schemas, OpenTelemetry tracing helpers, and resilience utilities across the Distributed Order Management System.

---

## 🎯 Purpose
In microservice architectures, different services communicate asynchronously over Kafka. If Service A publishes a message with `{ order_id: 123 }` and Service B expects `{ orderId: "123" }`, runtime errors will occur silently.

`@oms/event-contracts` solves this by:
1. Providing **strongly typed TypeScript interfaces** shared across all microservices.
2. Enforcing **runtime validation via Zod schemas** before messages are serialized or accepted.
3. Supplying common utilities for **resilient consumption, exponential backoff retries, and Dead Letter Queue (DLQ) routing**.
4. Providing **W3C TraceContext propagation** to link distributed traces across Kafka message headers.

---

## 📦 Exported Modules

### 1. Topic Constants (`KAFKA_TOPICS` & `DLQ_TOPICS`)
Located in [src/index.ts](file:///d:/Projects/distributed-oms/packages/event-contracts/src/index.ts):
```typescript
export const KAFKA_TOPICS = {
  ORDER_EVENTS: 'order.events',
  INVENTORY_EVENTS: 'inventory.events',
  PAYMENT_EVENTS: 'payment.events',
  FULFILLMENT_EVENTS: 'fulfillment.events',
} as const;

export const DLQ_TOPICS = {
  ORDER_EVENTS_DLQ: 'order.events.dlq',
  INVENTORY_EVENTS_DLQ: 'inventory.events.dlq',
  PAYMENT_EVENTS_DLQ: 'payment.events.dlq',
} as const;
```

### 2. Base Event Envelope (`EventEnvelopeSchema`)
Every event traveling over Kafka is wrapped in this envelope:
```typescript
export const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),       // Unique UUID for this message (used for deduplication)
  eventType: z.string().min(1),     // Event name (e.g., 'OrderCreated')
  aggregateId: z.string().min(1),   // Primary entity ID (orderId), used as Kafka partition key
  correlationId: z.string().min(1), // Trace ID shared across all related events
  causationId: z.string().min(1),   // eventId of the immediate parent event
  timestamp: z.string().datetime(), // ISO 8601 UTC timestamp
  version: z.number().int().positive().default(1),
  producer: z.string().min(1),      // Microservice that produced the event
});
```

### 3. Domain Events
| Event Type | Topic | Payload Description |
| :--- | :--- | :--- |
| `OrderCreated` | `order.events` | `orderId`, `customerId`, `items`, `totalAmount`, `currency` |
| `InventoryReserved` | `inventory.events` | `orderId`, `items`, `totalAmount` |
| `InventoryReservationFailed` | `inventory.events` | `orderId`, `reason`, `items` |
| `PaymentAuthorized` | `payment.events` | `orderId`, `paymentId`, `amount`, `currency` |
| `PaymentFailed` | `payment.events` | `orderId`, `reason`, `amount` |
| `InventoryReleaseRequested` | `inventory.events` | `orderId`, `reason` (Compensating command from Saga) |
| `InventoryReleased` | `inventory.events` | `orderId`, `reason` (Confirmation of compensation) |
| `OrderCancelled` | `order.events` | `orderId`, `reason` |
| `OrderConfirmed` | `order.events` | `orderId` |

---

## 🛡️ Resilient Consumer Utility (`resilientConsumer.ts`)

The `runResilientConsumer` helper wraps KafkaJS's `consumer.run()` to provide:
1. **JSON Parsing Guard:** If a message is corrupt JSON, routes it directly to DLQ without crashing the consumer.
2. **Envelope Validation:** Ensures `eventId` exists.
3. **Trace Context Extraction:** Automatically reads incoming W3C trace headers and wraps the handler execution inside an OpenTelemetry Span.
4. **Exponential Backoff Retries:** On unhandled exceptions, retries the message up to `maxRetries` (default: 3) with exponential backoff delay:
   $$\text{backoff} = \text{initialBackoffMs} \times 2^{\text{attempt} - 1}$$
5. **Dead Letter Queue Routing:** If retries are exhausted, formats a `DeadLetterEnvelope` and publishes it to the specified `dlqTopic`.

### Usage Example:
```typescript
import { runResilientConsumer, DLQ_TOPICS } from '@oms/event-contracts';

await runResilientConsumer({
  consumer,
  producer,
  consumerGroup: 'payment-service-group',
  dlqTopic: DLQ_TOPICS.PAYMENT_EVENTS_DLQ,
  maxRetries: 3,
  initialBackoffMs: 500,
  handler: async (event, rawMessage) => {
    // Process business logic here
  },
});
```

---

## 🔍 Tracing Helpers (`tracer.ts` & `tracingContext.ts`)

- `initTracer(serviceName)`: Initializes the OpenTelemetry NodeSDK with an OTLP HTTP trace exporter pointing to Jaeger (`http://localhost:4318/v1/traces`).
- `injectTraceHeaders(headers)`: Injects the active trace context (`traceparent`) into Kafka message headers before publishing.
- `extractTraceContext(headers)`: Extracts the `traceparent` from Kafka message headers so downstream consumers continue the same trace.

---

## 🔨 Build Command
```bash
pnpm build
```
Compiles TypeScript into `dist/` containing `.js` and `.d.ts` declaration files.
