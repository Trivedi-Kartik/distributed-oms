# 📦 Inventory Service (`apps/inventory-service`)

The **Inventory Service** manages warehouse catalog stock, reserves items for incoming customer orders, and executes compensating releases when downstream payment transactions fail.

---

## 🎯 Key Responsibilities
1. **Stock Reservation:** Consumes `OrderCreated` events and atomically reserves inventory using pessimistic row locking.
2. **Concurrency Safety:** Uses PostgreSQL `SELECT ... FOR UPDATE` locks to prevent race conditions and stock overselling during flash sales.
3. **Compensating Rollbacks:** Consumes `InventoryReleaseRequested` commands from the Saga Orchestrator to release reserved items back to available shelf stock.
4. **Outcome Emission:** Publishes `InventoryReserved`, `InventoryReservationFailed`, or `InventoryReleased` back to Apache Kafka.

---

## 🏗️ Architecture & Internal Components

```
apps/inventory-service/src/
├── index.ts        # Kafka consumer & producer, event dispatching, business logic
└── db/
    ├── connection.ts  # PostgreSQL connection pool for inventory_db
    └── init.ts        # Database schema creation and catalog seed data
```

---

## 🗄️ Database Schema (`inventory_db`)

The service connects to `inventory_db` on PostgreSQL port `5432`:

### 1. `inventory` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `sku` | `VARCHAR(100) PRIMARY KEY` | Unique product identifier (e.g. `'macbook-m3'`). |
| `name` | `VARCHAR(255)` | Human-readable product name. |
| `available_quantity` | `INT CHECK (>= 0)` | Stock available for new orders. |
| `reserved_quantity` | `INT CHECK (>= 0)` | Stock allocated to orders currently awaiting payment. |
| `updated_at` | `TIMESTAMPTZ` | Timestamp of last modification. |

### 2. `inventory_reservations` Table
Tracks active allocations per order to support Saga compensation:
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID PRIMARY KEY` | Unique reservation identifier. |
| `order_id` | `UUID` | Order ID being fulfilled. |
| `sku` | `VARCHAR(100) REFERENCES inventory(sku)` | Product SKU. |
| `quantity` | `INT` | Number of units reserved. |
| `status` | `VARCHAR(50)` | `'RESERVED'`, `'RELEASED'`, or `'CONFIRMED'`. |
| `created_at` | `TIMESTAMPTZ` | Timestamp when reservation was created. |

### Default Seed Data
On initial startup, `init.ts` seeds:
- `macbook-m3` — Apple MacBook Pro M3 (Initial: 5 available, 0 reserved)
- `keyboard-mech` — Mechanical Gaming Keyboard (Initial: 10 available, 0 reserved)

---

## 🔒 Concurrency Control: Pessimistic Row Locking

When multiple concurrent requests attempt to reserve the same SKU, standard non-locking queries can result in race conditions. Inventory Service guarantees strict atomicity:

```typescript
const res = await client.query(
  `SELECT available_quantity, reserved_quantity 
   FROM inventory 
   WHERE sku = $1 
   FOR UPDATE`,
  [item.sku]
);
```

- `FOR UPDATE` places an exclusive lock on the specific SKU row.
- Any other concurrent order transaction for that SKU will wait until this transaction completes (`COMMIT` or `ROLLBACK`).
- If `available_quantity < item.quantity`, the transaction is rolled back and an `InventoryReservationFailed` event is emitted.

---

## 🔄 Event Handling Workflows

### 1. Handling `OrderCreated` (`order.events`)
1. Checks availability for all items in the order.
2. If **ALL** items have sufficient stock:
   - Decrements `available_quantity`.
   - Increments `reserved_quantity`.
   - Inserts row into `inventory_reservations` (`status: RESERVED`).
   - Commits transaction.
   - Publishes `InventoryReserved` to `inventory.events` (triggers Payment Service).
3. If **ANY** item has insufficient stock:
   - Rolls back transaction.
   - Publishes `InventoryReservationFailed` to `inventory.events` (triggers Order cancellation in Saga).

### 2. Handling `InventoryReleaseRequested` (`inventory.events`)
1. Queries `inventory_reservations` for active reservations (`status = 'RESERVED'`) matching the `orderId`.
2. Restores inventory balances:
   $$\text{available\_quantity} = \text{available\_quantity} + \text{quantity}$$
   $$\text{reserved\_quantity} = \text{reserved\_quantity} - \text{quantity}$$
3. Updates reservation status to `RELEASED`.
4. Commits transaction.
5. Publishes `InventoryReleased` to `inventory.events` (Saga moves order to `CANCELLED`).

---

## 🌐 REST API Endpoints (Port 3002)

### 1. Health Check
- **GET** `/health`
- **Response (200 OK):**
  ```json
  { "status": "healthy", "service": "inventory-service", "timestamp": "2026-10-04T08:18:50.940Z" }
  ```

### 2. List All Inventory & Warehouse Stock Summary
- **GET** `/api/inventory`
- **Response (200 OK):**
  ```json
  {
    "summary": {
      "total_skus": 2,
      "total_available_units": 20,
      "total_reserved_units": 5
    },
    "items": [
      {
        "sku": "keyboard-mech",
        "name": "Mechanical Gaming Keyboard",
        "available_quantity": 10,
        "reserved_quantity": 0,
        "updated_at": "2026-10-02T12:23:49.798Z"
      },
      {
        "sku": "macbook-m3",
        "name": "Apple MacBook Pro M3",
        "available_quantity": 10,
        "reserved_quantity": 5,
        "updated_at": "2026-10-04T08:19:47.649Z"
      }
    ]
  }
  ```

### 3. Get Single Product Stock by SKU
- **GET** `/api/inventory/:sku`
- **Response (200 OK):**
  ```json
  {
    "sku": "macbook-m3",
    "name": "Apple MacBook Pro M3",
    "available_quantity": 10,
    "reserved_quantity": 5,
    "updated_at": "2026-10-04T08:19:47.649Z"
  }
  ```

### 4. Create New Product SKU
- **POST** `/api/inventory`
- **Request Body:**
  ```json
  {
    "sku": "airpods-pro",
    "name": "Apple AirPods Pro 2",
    "availableQuantity": 25
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "sku": "airpods-pro",
    "name": "Apple AirPods Pro 2",
    "available_quantity": 25,
    "reserved_quantity": 0,
    "updated_at": "2026-10-04T08:21:00.000Z"
  }
  ```

### 5. Restock / Add Quantity to an Existing SKU
- **POST** `/api/inventory/:sku/restock`
- **Request Body:**
  ```json
  {
    "quantityToAdd": 10
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "message": "Successfully restocked 10 units of 'macbook-m3'",
    "item": {
      "sku": "macbook-m3",
      "name": "Apple MacBook Pro M3",
      "available_quantity": 20,
      "reserved_quantity": 5,
      "updated_at": "2026-10-04T08:22:00.000Z"
    }
  }
  ```

### 6. List Stock Reservations
- **GET** `/api/inventory/reservations?status=RESERVED&limit=20`
- Query parameters: `orderId`, `status`, `limit`, `offset`.
- **Response (200 OK):**
  ```json
  {
    "limit": 20,
    "offset": 0,
    "reservations": [
      {
        "id": "9b9cc953-635e-4280-9858-64bc48ce4e08",
        "order_id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "sku": "macbook-m3",
        "quantity": 1,
        "status": "RELEASED",
        "created_at": "2026-10-04T08:19:01.775Z"
      }
    ]
  }
  ```

### 7. Get Reservations for Specific Order
- **GET** `/api/inventory/reservations/:orderId`
- **Response (200 OK):**
  ```json
  {
    "orderId": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
    "reservations": [
      {
        "id": "9b9cc953-635e-4280-9858-64bc48ce4e08",
        "order_id": "55e729ae-ea04-44e5-be4b-dbe5869d82fa",
        "sku": "macbook-m3",
        "quantity": 1,
        "status": "RELEASED",
        "created_at": "2026-10-04T08:19:01.775Z"
      }
    ]
  }
  ```

---

## 🚀 Running Locally

```bash
cd apps/inventory-service
pnpm dev
```
Starts Fastify on `http://localhost:3002` and connects to Kafka with hot-reloading via `tsx watch`.
