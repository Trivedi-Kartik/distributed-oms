# 🛒 Order Service (`apps/order-service`)

The **Order Service** is the entry point for customer orders. It serves as both the **REST API Gateway** for order creation and the **Saga Orchestrator** managing the distributed transaction across Inventory and Payment microservices.

---

## 🎯 Key Responsibilities
1. **HTTP Ingestion:** Exposes Fastify REST endpoints to receive customer order requests.
2. **Transactional Outbox:** Atomically writes order records and outbound Kafka events into PostgreSQL in a single ACID transaction.
3. **Outbox Relay:** A background worker that polls unpublished events using `FOR UPDATE SKIP LOCKED` and reliably publishes them to Apache Kafka.
4. **Saga Orchestration:** Listens to downstream domain events on `inventory.events` and `payment.events`, maintaining order state and issuing compensating commands when failures occur.

---

## 🏗️ Architecture & Internal Components

```
apps/order-service/src/
├── index.ts              # Fastify server, POST /api/orders endpoint, server bootstrap
├── sagaOrchestrator.ts   # Saga state machine listening to Inventory & Payment events
├── outboxRelay.ts        # Polling worker publishing outbox events to Kafka
├── kafka.ts              # KafkaJS client and producer singleton
└── db/
    ├── connection.ts     # PostgreSQL connection pool (pg.Pool)
    └── init.ts           # Database schema migration script
```

---

## 🗄️ Database Schema (`order_db`)

The service connects to `order_db` on PostgreSQL port `5432`:

### 1. `orders` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY` | Order unique identifier. |
| `customer_id` | `VARCHAR(100)` | Customer identifier. |
| `status` | `VARCHAR(50)` | Current state: `PENDING`, `CONFIRMED`, `COMPENSATING`, `CANCELLED`. |
| `total_amount` | `NUMERIC(12, 2)` | Sum total of line items. |
| `currency` | `VARCHAR(3)` | Default: `'INR'`. |
| `cancellation_reason`| `TEXT` | Reason if cancelled or compensated. |
| `created_at` | `TIMESTAMPTZ` | Timestamp when order was placed. |
| `updated_at` | `TIMESTAMPTZ` | Timestamp of latest state change. |

### 2. `order_items` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY` | Line item unique ID. |
| `order_id` | `UUID REFERENCES orders(id)` | Parent order reference. |
| `sku` | `VARCHAR(100)` | Stock Keeping Unit (e.g. `'macbook-m3'`). |
| `quantity` | `INT` | Quantity ordered (> 0). |
| `unit_price` | `NUMERIC(12, 2)` | Unit price (> 0). |

### 3. `outbox_events` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY` | Event unique ID (`eventId`). |
| `aggregate_type` | `VARCHAR(50)` | `'Order'`. |
| `aggregate_id` | `VARCHAR(100)` | `orderId`. |
| `event_type` | `VARCHAR(100)` | `'OrderCreated'`. |
| `payload` | `JSONB` | Full serialized JSON event envelope. |
| `headers` | `JSONB` | Correlation ID and metadata. |
| `published_at` | `TIMESTAMPTZ` | `NULL` until published to Kafka, then set to `NOW()`. |
| `retry_count` | `INT` | Number of publish attempts. |

---

## 🔄 Saga Orchestration State Machine

Inside [src/sagaOrchestrator.ts](file:///d:/Projects/distributed-oms/apps/order-service/src/sagaOrchestrator.ts), the orchestrator subscribes to:
- Topic: `inventory.events`
- Topic: `payment.events`
- Consumer Group: `order-saga-orchestrator-group`

```
Event Received               Order Status Transition    Action Taken
-----------------------------------------------------------------------------------------
InventoryReservationFailed   PENDING -> CANCELLED       Saves cancellation reason to DB
PaymentAuthorized            PENDING -> CONFIRMED       Happy path completed!
PaymentFailed                PENDING -> COMPENSATING    Emits 'InventoryReleaseRequested' to Kafka
InventoryReleased            COMPENSATING -> CANCELLED  Compensation rollback finished
```

---

## 📬 Transactional Outbox Relay

Inside [src/outboxRelay.ts](file:///d:/Projects/distributed-oms/apps/order-service/src/outboxRelay.ts):
- Runs every **1000 milliseconds**.
- Queries unpublished records:
  ```sql
  SELECT id, aggregate_id, event_type, payload
  FROM outbox_events
  WHERE published_at IS NULL
  ORDER BY created_at ASC
  LIMIT 10
  FOR UPDATE SKIP LOCKED;
  ```
- Injects OpenTelemetry W3C trace headers into the Kafka headers.
- Publishes each event to `order.events` with `key = aggregate_id`.
- Sets `published_at = NOW()`.
- Commits the transaction.

---

## 🌐 API Endpoints

### 1. Health Check
- **GET** `/health`
- **Response (200 OK):**
  ```json
  { "status": "healthy", "service": "order-service", "timestamp": "2026-10-04T08:19:01.046Z" }
  ```

### 2. Orders Statistics & Executive Summary
- **GET** `/api/orders/stats/summary`
- **Response (200 OK):**
  ```json
  {
    "totalOrders": 12,
    "totalRevenue": 4500000,
    "confirmedRevenue": 1500000,
    "countsByStatus": {
      "PENDING": 1,
      "CONFIRMED": 5,
      "COMPENSATING": 0,
      "CANCELLED": 6
    }
  }
  ```

### 3. List Orders (With Pagination & Filtering)
- **GET** `/api/orders?status=CONFIRMED&limit=20&offset=0`
- Query parameters:
  - `status`: Filter by state (`PENDING`, `CONFIRMED`, `COMPENSATING`, `CANCELLED`).
  - `customerId`: Filter by customer ID.
  - `limit`: Number of records (1-100, default: 20).
  - `offset`: Starting index (default: 0).
- **Response (200 OK):**
  ```json
  {
    "total": 5,
    "limit": 20,
    "offset": 0,
    "orders": [
      {
        "id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "customer_id": "cust-alice",
        "status": "CONFIRMED",
        "total_amount": "150000.00",
        "currency": "INR",
        "cancellation_reason": null,
        "created_at": "2026-10-04T08:19:01.046Z",
        "updated_at": "2026-10-04T08:19:01.989Z",
        "item_count": 1
      }
    ]
  }
  ```

### 4. Get Single Order by ID (With Line Items & Outbox Events)
- **GET** `/api/orders/:id`
- **Response (200 OK):**
  ```json
  {
    "id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
    "customer_id": "cust-alice",
    "status": "CONFIRMED",
    "total_amount": "150000.00",
    "currency": "INR",
    "created_at": "2026-10-04T08:19:01.046Z",
    "updated_at": "2026-10-04T08:19:01.989Z",
    "cancellation_reason": null,
    "items": [
      {
        "id": "a197c43c-2eb5-48f9-9989-d5daed7294f8",
        "sku": "macbook-m3",
        "quantity": 1,
        "unit_price": "150000.00"
      }
    ],
    "outboxEvents": [
      {
        "id": "399d8c12-b18f-44bf-b374-875813d867a8",
        "event_type": "OrderCreated",
        "created_at": "2026-10-04T08:19:01.046Z",
        "published_at": "2026-10-04T08:19:01.292Z"
      }
    ]
  }
  ```

### 5. Create Order
- **POST** `/api/orders`
- **Request Body:**
  ```json
  {
    "customerId": "cust-001",
    "items": [
      { "sku": "macbook-m3", "quantity": 1, "unitPrice": 150000 }
    ]
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "orderId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "PENDING",
    "totalAmount": 150000,
    "currency": "INR",
    "correlationId": "...",
    "createdAt": "2026-10-04T08:19:01.070Z"
  }
  ```

### 6. Cancel Order (Manual User or Admin Cancellation)
- **POST** `/api/orders/:id/cancel`
- **Request Body:**
  ```json
  {
    "reason": "Customer requested cancellation"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "orderId": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
    "message": "Order cancellation initiated successfully",
    "reason": "Customer requested cancellation"
  }
  ```
  *(Triggers automatic inventory release and Saga compensation!)*

---

## 🚀 Running Locally

```bash
pnpm dev
```
Starts Fastify on `http://localhost:3001` with hot-reloading via `tsx watch`.
