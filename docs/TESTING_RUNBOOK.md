# 🧪 Distributed OMS — Testing Runbook & Operational Verification

This runbook provides step-by-step instructions for running, testing, and verifying the Distributed Order Management System across all happy and failure paths.

---

## 📑 Table of Contents
1. [Prerequisites & Environment Setup](#1-prerequisites--environment-setup)
2. [Starting the Infrastructure & Services](#2-starting-the-infrastructure--services)
3. [Test Case 1: Happy Path (Successful Order & Payment)](#3-test-case-1-happy-path-successful-order--payment)
4. [Test Case 2: Inventory Out-of-Stock Failure](#4-test-case-2-inventory-out-of-stock-failure)
5. [Test Case 3: Payment Limit Exceeded & Saga Compensation Rollback](#5-test-case-3-payment-limit-exceeded--saga-compensation-rollback)
6. [Test Case 4: Idempotency & Duplicate Event Prevention](#6-test-case-4-idempotency--duplicate-event-prevention)
7. [Test Case 5: Dead Letter Queue (DLQ) & Message Replay](#7-test-case-5-dead-letter-queue-dlq--message-replay)
8. [Observability Verification (Jaeger & Kafka UI)](#8-observability-verification-jaeger--kafka-ui)
9. [Database Verification Queries](#9-database-verification-queries)

---

## 1. Prerequisites & Environment Setup

Ensure you have the following installed on your machine:
- **Node.js**: v20 or higher
- **pnpm**: v9 or higher (run `npm install -g pnpm` if needed)
- **Docker & Docker Compose**: Docker Desktop (Windows/Mac) or Docker Engine (Linux)

---

## 2. Starting the Infrastructure & Services

### Step 1: Start Docker Infrastructure
In the project root, start PostgreSQL, Kafka KRaft, Kafka UI, and Jaeger:

```bash
docker compose up -d
```

Verify that all 4 containers are running healthy:
```bash
docker compose ps
```
You should see:
- `oms-postgres` running on port `5432`
- `oms-kafka` running on port `9094`
- `oms-kafka-ui` running on port `8080`
- `oms-jaeger` running on ports `16686` and `4318`

### Step 2: Install Dependencies & Build Packages
From the root directory:
```bash
pnpm install
```

Build the shared contract package:
```bash
cd packages/event-contracts
pnpm build
cd ../..
```

### Step 3: Start the Microservices
Open three separate terminal windows to monitor logs concurrently:

**Terminal 1 — Order Service:**
```bash
cd apps/order-service
pnpm dev
```
*(Listening on http://localhost:3001, Outbox Relay polling every 1s, Saga Orchestrator listening on Kafka)*

**Terminal 2 — Inventory Service:**
```bash
cd apps/inventory-service
pnpm dev
```
*(Pre-seeded with 5 `macbook-m3` and 10 `keyboard-mech`)*

**Terminal 3 — Payment Service:**
```bash
cd apps/payment-service
pnpm dev
```
*(Resilient consumer listening on `inventory.events`)*

---

## 3. Test Case 1: Happy Path (Successful Order & Payment)

### Description
Purchase 1 unit of `macbook-m3` (Total: ₹1,50,000). Stock is available, amount is under the ₹5,00,000 limit.

### Execute Request
```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-alice",
    "items": [
      { "sku": "macbook-m3", "quantity": 1, "unitPrice": 150000 }
    ]
  }'
```

### Expected HTTP Response (HTTP 201)
```json
{
  "orderId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "PENDING",
  "totalAmount": 150000,
  "correlationId": "..."
}
```

### Expected Service Terminal Logs
1. **Order Service API:**
   ```
   [Server] POST /api/orders 201
   [Outbox Relay] Found 1 pending events to publish.
   [Outbox Relay] Published OrderCreated for Order: a1b2c3d4...
   ```
2. **Inventory Service:**
   ```
   [Inventory] Received OrderCreated for Order: a1b2c3d4...
   [Inventory] Stock successfully reserved for Order: a1b2c3d4...
   ```
3. **Payment Service:**
   ```
   [Payment] Processing payment for Order: a1b2c3d4... (Amount: ₹150000)...
   [Payment] Payment AUTHORIZED for Order: a1b2c3d4...
   ```
4. **Order Service (Saga Orchestrator):**
   ```
   [Saga] Payment authorized for order a1b2c3d4.... Confirming.
   ```

### Verification
Query the orders table in `order_db`:
```bash
docker exec -it oms-postgres psql -U oms_user -d order_db -c "SELECT id, status, total_amount FROM orders;"
```
**Expected Result:** Status is `CONFIRMED`.

---

## 4. Test Case 2: Inventory Out-of-Stock Failure

### Description
Request 99 units of `macbook-m3` (Only 4 or 5 are available in stock).

### Execute Request
```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-bob",
    "items": [
      { "sku": "macbook-m3", "quantity": 99, "unitPrice": 150000 }
    ]
  }'
```

### Expected Terminal Logs
1. **Order Service API:**
   ```
   [Outbox Relay] Published OrderCreated for Order: ...
   ```
2. **Inventory Service:**
   ```
   [Inventory] Received OrderCreated for Order: ...
   [Inventory] Reservation FAILED: Insufficient stock for macbook-m3. Requested: 99, Available: 4
   ```
3. **Payment Service:**
   *(Silent — Payment is never triggered because InventoryReserved was not emitted)*
4. **Order Service (Saga Orchestrator):**
   ```
   [Saga] Stock reservation failed for order .... Cancelling.
   ```

### Verification
Query `order_db`:
```bash
docker exec -it oms-postgres psql -U oms_user -d order_db -c "SELECT id, status, cancellation_reason FROM orders ORDER BY created_at DESC LIMIT 1;"
```
**Expected Result:** Status is `CANCELLED`, cancellation_reason is `Insufficient stock for macbook-m3...`.

---

## 5. Test Case 3: Payment Limit Exceeded & Saga Compensation Rollback

### Description
Purchase 4 units of `macbook-m3` at ₹1,50,000 each = **₹6,00,000**.
- Inventory **has** 4 units in stock -> Stock is reserved!
- Payment Service has a business rule: transactions > ₹5,00,000 fail.
- Saga Orchestrator detects `PaymentFailed`, sets Order to `COMPENSATING`, and sends `InventoryReleaseRequested`.
- Inventory Service un-reserves the 4 units, adds them back to available stock, and emits `InventoryReleased`.
- Order transitions to final `CANCELLED` state.

### Step 1: Note Stock Before Request
```bash
docker exec -it oms-postgres psql -U oms_user -d inventory_db -c "SELECT sku, available_quantity, reserved_quantity FROM inventory WHERE sku='macbook-m3';"
```

### Step 2: Execute High-Value Order
```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-whale",
    "items": [
      { "sku": "macbook-m3", "quantity": 4, "unitPrice": 150000 }
    ]
  }'
```

### Step 3: Observe Terminal Logs
1. **Inventory Service:**
   ```
   [Inventory] Received OrderCreated for Order: ...
   [Inventory] Stock successfully reserved for Order: ...
   ```
2. **Payment Service:**
   ```
   [Payment] Processing payment for Order: ... (Amount: ₹600000)...
   [Payment] Payment FAILED for Order: ... - Limit exceeded
   ```
3. **Order Service (Saga Orchestrator):**
   ```
   [Saga] Payment failed for order .... Triggering compensation...
   ```
4. **Inventory Service:**
   ```
   [Inventory] Releasing reserved stock for Order: .... Reason: Transaction amount ₹600000 exceeds allowed limit of ₹5,00,000
   [Inventory] Stock successfully released for Order: ...
   ```
5. **Order Service (Saga Orchestrator):**
   ```
   [Saga] Compensation finished for order .... Marking CANCELLED.
   ```

### Step 4: Verify Inventory Was Safely Restored
```bash
docker exec -it oms-postgres psql -U oms_user -d inventory_db -c "SELECT sku, available_quantity, reserved_quantity FROM inventory WHERE sku='macbook-m3';"
```
**Expected Result:** `available_quantity` is back to its pre-order count, `reserved_quantity` is 0.
```bash
docker exec -it oms-postgres psql -U oms_user -d order_db -c "SELECT id, status, cancellation_reason FROM orders ORDER BY created_at DESC LIMIT 1;"
```
**Expected Result:** Status is `CANCELLED`.

---

## 6. Test Case 4: Idempotency & Duplicate Event Prevention

### Description
Kafka can redeliver duplicate messages due to network timeouts. We verify that Payment Service deduplicates incoming events and prevents double charges.

### Run Duplicate Test Script
In `apps/payment-service`, run the built-in test script:
```bash
cd apps/payment-service
pnpm tsx src/test-duplicate.ts
```

### Expected Payment Service Terminal Log
```
[Payment] Duplicate event <uuid> detected. Skipping safely.
```

### Verification
Query `payment_db`:
```bash
docker exec -it oms-postgres psql -U oms_user -d payment_db -c "SELECT count(*) FROM payments;"
```
**Expected Result:** Payment count remains strictly unchanged. No duplicate payment record is created.

---

## 7. Test Case 5: Dead Letter Queue (DLQ) & Message Replay

### Description
Test how the Resilient Consumer catches repeatedly failing messages, avoids crashing, moves them to `payment.events.dlq`, and allows operational replay.

### Step 1: Simulate Unrecoverable Crash
In [apps/payment-service/src/index.ts](file:///d:/Projects/distributed-oms/apps/payment-service/src/index.ts), lines 174–176 contains a simulated crash hook:
```typescript
if (event?.payload?.orderId === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
  throw new Error("SIMULATED_UNRECOVERABLE_DB_CRASH");
}
```
Uncomment those lines and save.

### Step 2: Send Poison Pill Message
Send an order or publish an `InventoryReserved` event with `orderId: "ffffffff-ffff-ffff-ffff-ffffffffffff"`.

### Step 3: Observe Exponential Backoff & DLQ Escalation
In Payment Service terminal:
```
[Consumer Warning] Error processing event from inventory.events (Attempt 1/3): SIMULATED_UNRECOVERABLE_DB_CRASH
[Consumer Warning] Error processing event from inventory.events (Attempt 2/3): SIMULATED_UNRECOVERABLE_DB_CRASH
[Consumer Warning] Error processing event from inventory.events (Attempt 3/3): SIMULATED_UNRECOVERABLE_DB_CRASH
[DLQ Alert] Max retries exhausted for event on inventory.events. Sending to payment.events.dlq.
```
Notice:
- The service did NOT crash.
- Backoff delays (500ms, 1000ms) were applied.
- The dead letter was sent to `payment.events.dlq`.

### Step 4: Replay Messages from DLQ
Once the simulated error is commented back out and saved, run:
```bash
cd apps/payment-service
pnpm dlq:replay
```
Expected output:
```
[DLQ Replayer] Connected. Scanning topic: payment.events.dlq...
[DLQ Replayer] Found dead letter from: inventory.events
   Failure reason: "SIMULATED_UNRECOVERABLE_DB_CRASH" (failed after 3 retries)
   -> Successfully re-routed event back to [inventory.events]
[DLQ Replayer] Completed. Total messages replayed: 1
```

---

## 8. Observability Verification (Jaeger & Kafka UI)

### 1. Kafka UI (`http://localhost:8080`)
1. Open your browser to `http://localhost:8080`.
2. Click **Topics**:
   - `order.events`: Inspect produced messages, partition offsets, and message schemas.
   - `inventory.events`: Inspect reservation events and compensation commands.
   - `payment.events`: Inspect authorized/failed payment records.
   - `payment.events.dlq`: Inspect dead letter envelopes containing error stack traces.
3. Click **Consumers**:
   - Inspect consumer groups: `order-saga-orchestrator-group`, `inventory-service-group`, `payment-service-group`. Check that consumer lag is 0.

### 2. Jaeger Tracing (`http://localhost:16686`)
1. Open your browser to `http://localhost:16686`.
2. Under **Service**, select `order-service` or `payment-service`.
3. Click **Find Traces**.
4. Click on any trace to open the waterfall view:
   - See the HTTP request span.
   - Follow the Kafka message headers into the downstream consumer spans.
   - Measure the exact execution duration of each step.

---

## 9. Database Verification Queries

Connect to PostgreSQL via Docker CLI:
```bash
docker exec -it oms-postgres psql -U oms_user -d order_db
```

### Inspect Orders
```sql
SELECT id, customer_id, status, total_amount, cancellation_reason, created_at, updated_at 
FROM orders 
ORDER BY created_at DESC;
```

### Inspect Outbox Events
```sql
SELECT id, aggregate_id, event_type, published_at, created_at 
FROM outbox_events 
ORDER BY created_at DESC;
```

### Inspect Inventory & Reservations
Connect to `inventory_db`:
```bash
docker exec -it oms-postgres psql -U oms_user -d inventory_db
```
```sql
SELECT * FROM inventory;
SELECT * FROM inventory_reservations ORDER BY created_at DESC;
```

### Inspect Payments & Processed Events
Connect to `payment_db`:
```bash
docker exec -it oms-postgres psql -U oms_user -d payment_db
```
```sql
SELECT * FROM payments ORDER BY created_at DESC;
SELECT * FROM processed_events ORDER BY processed_at DESC;
```

---

## 10. Complete REST API Verification Suite

You can verify all newly introduced endpoints across all 3 microservices using PowerShell or cURL:

### Order Service (Port 3001)
```powershell
# 1. Executive Summary & Revenue Stats
Invoke-RestMethod -Uri "http://localhost:3001/api/orders/stats/summary" | ConvertTo-Json

# 2. List Orders (Filtered by status)
Invoke-RestMethod -Uri "http://localhost:3001/api/orders?status=CONFIRMED&limit=5" | ConvertTo-Json

# 3. Create Order
$newOrder = @{
  customerId = "cust-live-test"
  items = @(
    @{ sku = "macbook-m3"; quantity = 1; unitPrice = 150000 }
  )
} | ConvertTo-Json
$created = Invoke-RestMethod -Uri "http://localhost:3001/api/orders" -Method Post -ContentType "application/json" -Body $newOrder
$orderId = $created.orderId
Write-Host "Created Order: $orderId"

# 4. Fetch Order by ID (Includes Line Items & Outbox Status)
Start-Sleep -Seconds 1
Invoke-RestMethod -Uri "http://localhost:3001/api/orders/$orderId" | ConvertTo-Json -Depth 5

# 5. Cancel Order (Triggers Saga Compensation Rollback)
Invoke-RestMethod -Uri "http://localhost:3001/api/orders/$orderId/cancel" -Method Post -ContentType "application/json" -Body '{"reason": "Customer cancellation"}' | ConvertTo-Json
```

### Inventory Service (Port 3002)
```powershell
# 1. List All Inventory & Stock Balances
Invoke-RestMethod -Uri "http://localhost:3002/api/inventory" | ConvertTo-Json

# 2. Get Single Product Stock
Invoke-RestMethod -Uri "http://localhost:3002/api/inventory/macbook-m3" | ConvertTo-Json

# 3. Restock Product
Invoke-RestMethod -Uri "http://localhost:3002/api/inventory/macbook-m3/restock" -Method Post -ContentType "application/json" -Body '{"quantityToAdd": 10}' | ConvertTo-Json

# 4. View Stock Reservations for an Order
Invoke-RestMethod -Uri "http://localhost:3002/api/inventory/reservations/$orderId" | ConvertTo-Json -Depth 5
```

### Payment Service (Port 3003)
```powershell
# 1. Transaction Stats & Volume Summary
Invoke-RestMethod -Uri "http://localhost:3003/api/payments/stats" | ConvertTo-Json

# 2. List Payments
Invoke-RestMethod -Uri "http://localhost:3003/api/payments?limit=5" | ConvertTo-Json

# 3. Get Payment for Specific Order
Invoke-RestMethod -Uri "http://localhost:3003/api/payments/order/$orderId" | ConvertTo-Json -Depth 5

# 4. Audit Log of Processed Events (Idempotency Store)
Invoke-RestMethod -Uri "http://localhost:3003/api/payments/processed-events" | ConvertTo-Json

# 5. Trigger Dead Letter Queue (DLQ) Replay via API
Invoke-RestMethod -Uri "http://localhost:3003/api/payments/dlq/replay" -Method Post -ContentType "application/json" -Body '{}' | ConvertTo-Json
```
