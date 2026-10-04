# 💳 Payment Service (`apps/payment-service`)

The **Payment Service** processes order payments, enforces transaction limits, guarantees consumer idempotency to prevent duplicate charges, and incorporates a resilient Dead Letter Queue (DLQ) retry and replay mechanism.

---

## 🎯 Key Responsibilities
1. **Payment Authorization:** Consumes `InventoryReserved` events and authorizes or rejects transactions based on business limits.
2. **Strict Idempotency:** Employs database-level deduplication to guarantee that duplicate Kafka messages do not result in double billing.
3. **Resilient Consumer & DLQ:** Catches transient failures, applies exponential backoff retries, and routes poison pill messages to `payment.events.dlq`.
4. **DLQ Replay Capability:** Includes an operational CLI utility to re-inject resolved dead-letter messages back into the active processing queue.

---

## 🏗️ Architecture & Internal Components

```
apps/payment-service/src/
├── index.ts           # Resilient Kafka consumer, payment business logic, idempotency checks
├── replay-dlq.ts      # Operational CLI tool to scan and re-inject DLQ messages
├── test-duplicate.ts  # Verification script to test duplicate event deduplication
└── db/
    ├── connection.ts  # PostgreSQL connection pool for payment_db
    └── init.ts        # Database schema initialization script
```

---

## 🗄️ Database Schema (`payment_db`)

The service connects to `payment_db` on PostgreSQL port `5432`:

### 1. `processed_events` Table (Idempotency Store)
| Column | Type | Description |
| :--- | :--- | :--- |
| `event_id` | `UUID PRIMARY KEY` | Global UUID of the processed event envelope. |
| `consumer_name` | `VARCHAR(100)` | Name of the consumer (`'payment-service'`). |
| `processed_at` | `TIMESTAMPTZ` | Timestamp when event was processed. |

### 2. `payments` Table (Transactions Ledger)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY` | Unique payment transaction ID. |
| `order_id` | `UUID` | Associated order identifier. |
| `amount` | `NUMERIC(12, 2)` | Authorized or attempted charge amount. |
| `currency` | `VARCHAR(3)` | Currency code (`'INR'`). |
| `status` | `VARCHAR(50)` | `'AUTHORIZED'` or `'FAILED'`. |
| `created_at` | `TIMESTAMPTZ` | Timestamp of the transaction. |

---

## 🛡️ Idempotency: Duplicate Prevention

Because Kafka guarantees **At-Least-Once** delivery, consumers can receive the same message multiple times if a network blip occurs during offset commit.

In `index.ts`, Payment Service uses an atomic database pattern:

```typescript
try {
  await client.query(
    `INSERT INTO processed_events (event_id, consumer_name)
     VALUES ($1, $2)`,
    [event.eventId, "payment-service"]
  );
} catch (dedupError: any) {
  if (dedupError.code === "23505") { // Postgres unique_violation code
    await client.query("ROLLBACK");
    console.warn(`[Payment] Duplicate event ${event.eventId} detected. Skipping safely.`);
    return;
  }
  throw dedupError;
}
```

If the `event_id` has already been recorded:
- PostgreSQL rejects the insert.
- The transaction rolls back.
- No payment record is created.
- The function exits safely without throwing an unhandled exception.

---

## 💳 Payment Rules & Outcome Emission

- **Transaction Limit Rule:** Transactions $\le ₹5,00,000$ are approved. Any transaction $> ₹5,00,000$ is rejected.
- **On Approval:**
  - Inserts payment with `status = 'AUTHORIZED'`.
  - Emits `PaymentAuthorized` event to `payment.events`.
  - Triggers the Saga Orchestrator to confirm the order.
- **On Limit Exceeded:**
  - Inserts payment with `status = 'FAILED'`.
  - Emits `PaymentFailed` event to `payment.events`.
  - Triggers the Saga Orchestrator to begin compensation and inventory release.

---

## 🔁 Dead Letter Queue (DLQ) & Replay System

Payment Service uses `runResilientConsumer` from `@oms/event-contracts`:
1. If a message has corrupt JSON or missing `eventId`, it is routed directly to `payment.events.dlq`.
2. If processing throws an exception, the consumer retries up to 3 times with exponential backoff (500ms, 1000ms, 2000ms).
3. If all 3 attempts fail, a `DeadLetterEnvelope` containing the original payload, error message, stack trace, and attempt count is sent to `payment.events.dlq`.

### Replaying Dead Letter Messages
When the underlying issue is resolved:
```bash
pnpm dlq:replay
```
The script reads `payment.events.dlq` from offset 0, extracts the original message, appends audit headers (`x-replayed: true`, `x-replayed-at`), and publishes it back to the original topic.

## 🌐 REST API Endpoints (Port 3003)

### 1. Health Check
- **GET** `/health`
- **Response (200 OK):**
  ```json
  { "status": "healthy", "service": "payment-service", "timestamp": "2026-10-04T08:18:50.940Z" }
  ```

### 2. Transaction Statistics & Volume Summary
- **GET** `/api/payments/stats`
- **Response (200 OK):**
  ```json
  {
    "totalProcessedEvents": 8,
    "authorized": {
      "count": 5,
      "volume": 630000
    },
    "failed": {
      "count": 2,
      "volume": 1200000
    },
    "totalVolume": 1830000
  }
  ```

### 3. List Payments (With Filtering & Pagination)
- **GET** `/api/payments?status=AUTHORIZED&limit=20`
- Query parameters: `orderId`, `status`, `limit`, `offset`.
- **Response (200 OK):**
  ```json
  {
    "total": 5,
    "limit": 20,
    "offset": 0,
    "payments": [
      {
        "id": "f2f87b79-ec9c-4a86-a30d-406d00fc9f5a",
        "order_id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "amount": "150000.00",
        "currency": "INR",
        "status": "AUTHORIZED",
        "created_at": "2026-10-04T08:19:01.889Z"
      }
    ]
  }
  ```

### 4. Get Payment by Payment ID
- **GET** `/api/payments/:id`
- **Response (200 OK):**
  ```json
  {
    "id": "f2f87b79-ec9c-4a86-a30d-406d00fc9f5a",
    "order_id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
    "amount": "150000.00",
    "currency": "INR",
    "status": "AUTHORIZED",
    "created_at": "2026-10-04T08:19:01.889Z"
  }
  ```

### 5. Get Payment for Specific Order ID
- **GET** `/api/payments/order/:orderId`
- **Response (200 OK):**
  ```json
  {
    "orderId": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
    "payments": [
      {
        "id": "f2f87b79-ec9c-4a86-a30d-406d00fc9f5a",
        "order_id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "amount": "150000.00",
        "currency": "INR",
        "status": "AUTHORIZED",
        "created_at": "2026-10-04T08:19:01.889Z"
      }
    ]
  }
  ```

### 6. Idempotency Audit Log
- **GET** `/api/payments/processed-events`
- **Response (200 OK):**
  ```json
  {
    "count": 8,
    "events": [
      {
        "event_id": "cf26eb1b-3c0c-4d6a-b3a4-03b97babdddf",
        "consumer_name": "payment-service",
        "processed_at": "2026-10-04T08:19:01.880Z"
      }
    ]
  }
  ```

### 7. Trigger Dead Letter Queue (DLQ) Replay via API
- **POST** `/api/payments/dlq/replay`
- **Response (200 OK):**
  ```json
  {
    "message": "DLQ replay complete. 2 message(s) replayed.",
    "replayedCount": 2,
    "replayedMessages": [
      {
        "originalTopic": "inventory.events",
        "orderId": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "reason": "SIMULATED_UNRECOVERABLE_DB_CRASH"
      }
    ]
  }
  ```

---

## 🚀 Running Locally

```bash
cd apps/payment-service
pnpm dev
```
Starts Fastify on `http://localhost:3003` and connects the resilient Kafka consumer with hot-reloading via `tsx watch`.
