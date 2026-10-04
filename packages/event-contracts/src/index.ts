import { z } from 'zod';

// ============================================================================
// TOPIC DEFINITIONS
// ============================================================================
// Central list of Kafka topics. Using constants prevents hardcoded string typos
// across microservices.
// ============================================================================
export const KAFKA_TOPICS = {
  ORDER_EVENTS: 'order.events',
  INVENTORY_EVENTS: 'inventory.events',
  PAYMENT_EVENTS: 'payment.events',
  FULFILLMENT_EVENTS: 'fulfillment.events',
} as const;

// ============================================================================
// BASE EVENT ENVELOPE SCHEMA
// ============================================================================
// Every event in the system must be wrapped in this envelope.
// ============================================================================
export const EventEnvelopeSchema = z.object({
  // Unique UUID for this message instance. Used by consumers for deduplication.
  eventId: z.string().uuid(),

  // Identifies what happened (e.g., 'OrderCreated', 'InventoryReserved')
  eventType: z.string().min(1),

  // The primary entity ID (e.g., orderId). Used as Kafka partition key.
  aggregateId: z.string().min(1),

  // Trace ID shared by all events triggered by the initial user request.
  correlationId: z.string().min(1),

  // The eventId of the immediate parent event that triggered this one.
  causationId: z.string().min(1),

  // ISO 8601 timestamp string when the event was produced.
  timestamp: z.string().datetime(),

  // Schema version for backward compatibility during schema changes.
  version: z.number().int().positive().default(1),

  // Name of the microservice producing the event (e.g., 'order-service')
  producer: z.string().min(1),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

// ============================================================================
// DOMAIN EVENT: OrderCreated
// ============================================================================
// Emitted by Order Service when a customer successfully registers an order.
// ============================================================================
export const OrderItemSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

export const OrderCreatedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1),
  items: z.array(OrderItemSchema).min(1),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
});

export const OrderCreatedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('OrderCreated'),
  payload: OrderCreatedPayloadSchema,
});

export type OrderCreatedEvent = z.infer<typeof OrderCreatedEventSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ============================================================================
// DOMAIN EVENTS: InventoryReserved & InventoryReservationFailed
// ============================================================================

export const InventoryReservedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(OrderItemSchema),
  totalAmount: z.number().positive(),
});

export const InventoryReservedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('InventoryReserved'),
  payload: InventoryReservedPayloadSchema,
});

export type InventoryReservedEvent = z.infer<typeof InventoryReservedEventSchema>;

export const InventoryReservationFailedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string(),
  items: z.array(OrderItemSchema),
});

export const InventoryReservationFailedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('InventoryReservationFailed'),
  payload: InventoryReservationFailedPayloadSchema,
});

export type InventoryReservationFailedEvent = z.infer<typeof InventoryReservationFailedEventSchema>;

// ============================================================================
// DOMAIN EVENTS: PaymentAuthorized & PaymentFailed
// ============================================================================

export const PaymentAuthorizedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
});

export const PaymentAuthorizedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('PaymentAuthorized'),
  payload: PaymentAuthorizedPayloadSchema,
});

export type PaymentAuthorizedEvent = z.infer<typeof PaymentAuthorizedEventSchema>;

export const PaymentFailedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string(),
  amount: z.number().positive(),
});

export const PaymentFailedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('PaymentFailed'),
  payload: PaymentFailedPayloadSchema,
});

export type PaymentFailedEvent = z.infer<typeof PaymentFailedEventSchema>;

// ============================================================================
// SAGA COMMANDS & COMPENSATIONS
// ============================================================================

export const ReleaseInventoryPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string(),
});

export const ReleaseInventoryEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('InventoryReleased'),
  payload: ReleaseInventoryPayloadSchema,
});

export type ReleaseInventoryEvent = z.infer<typeof ReleaseInventoryEventSchema>;

export const OrderCancelledPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string(),
});

export const OrderCancelledEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('OrderCancelled'),
  payload: OrderCancelledPayloadSchema,
});

export type OrderCancelledEvent = z.infer<typeof OrderCancelledEventSchema>;

export const OrderConfirmedPayloadSchema = z.object({
  orderId: z.string().uuid(),
});

export const OrderConfirmedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal('OrderConfirmed'),
  payload: OrderConfirmedPayloadSchema,
});

export type OrderConfirmedEvent = z.infer<typeof OrderConfirmedEventSchema>;

// ============================================================================
// DEAD LETTER QUEUE (DLQ) DEFINITIONS
// ============================================================================

export const DLQ_TOPICS = {
  ORDER_EVENTS_DLQ: 'order.events.dlq',
  INVENTORY_EVENTS_DLQ: 'inventory.events.dlq',
  PAYMENT_EVENTS_DLQ: 'payment.events.dlq',
} as const;

export const DeadLetterEnvelopeSchema = z.object({
  originalTopic: z.string(),
  originalMessage: z.unknown(),
  error: z.object({
    message: z.string(),
    stack: z.string().optional(),
  }),
  failedAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative(),
  consumerGroup: z.string(),
});

export * from './resilientConsumer';
export * from './tracer';
export * from './tracingContext';
export type DeadLetterEnvelope = z.infer<typeof DeadLetterEnvelopeSchema>;