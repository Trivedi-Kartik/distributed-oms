# 📖 Interactive Swagger UI & OpenAPI Documentation Guide

The Distributed Order Management System includes **live, interactive Swagger UI documentation embedded inside every microservice**, alongside standard **OpenAPI 3.0.3 specification files** ready for import into Postman, Insomnia, or SwaggerHub.

---

## 📑 Table of Contents
1. [Live Swagger UI Dashboards](#1-live-swagger-ui-dashboards)
2. [OpenAPI 3.0 Specification Files](#2-openapi-30-specification-files)
3. [Order Service API Reference (Port 3001)](#3-order-service-api-reference-port-3001)
4. [Inventory Service API Reference (Port 3002)](#4-inventory-service-api-reference-port-3002)
5. [Payment Service API Reference (Port 3003)](#5-payment-service-api-reference-port-3003)
6. [Importing into Postman / Insomnia](#6-importing-into-postman--insomnia)

---

## 1. Live Swagger UI Dashboards

When the microservices are running locally (`pnpm dev`), you can open your browser to interactively test all endpoints with "Try it out":

| Service | Swagger UI Dashboard | Raw OpenAPI JSON | Port |
| :--- | :--- | :--- | :--- |
| **🛒 Order Service** | [http://localhost:3001/docs](http://localhost:3001/docs) | [http://localhost:3001/docs/openapi.json](http://localhost:3001/docs/openapi.json) | `3001` |
| **📦 Inventory Service** | [http://localhost:3002/docs](http://localhost:3002/docs) | [http://localhost:3002/docs/openapi.json](http://localhost:3002/docs/openapi.json) | `3002` |
| **💳 Payment Service** | [http://localhost:3003/docs](http://localhost:3003/docs) | [http://localhost:3003/docs/openapi.json](http://localhost:3003/docs/openapi.json) | `3003` |

Each Swagger UI page includes custom navigation links in the header, allowing you to jump between Order, Inventory, and Payment Swagger interfaces with a single click.

---

## 2. OpenAPI 3.0 Specification Files

The repository stores standardized, version-controlled OpenAPI 3.0 JSON specifications inside the [docs/openapi/](file:///d:/Projects/distributed-oms/docs/openapi) directory:

- 🛒 **[order-service-openapi.json](file:///d:/Projects/distributed-oms/docs/openapi/order-service-openapi.json)**: Complete specification for Order Service endpoints, models, and schemas.
- 📦 **[inventory-service-openapi.json](file:///d:/Projects/distributed-oms/docs/openapi/inventory-service-openapi.json)**: Complete specification for Inventory Service catalog, restock, and reservation endpoints.
- 💳 **[payment-service-openapi.json](file:///d:/Projects/distributed-oms/docs/openapi/payment-service-openapi.json)**: Complete specification for Payment Service authorization, stats, audit log, and DLQ replay endpoints.
- 🌐 **[unified-oms-openapi.json](file:///d:/Projects/distributed-oms/docs/openapi/unified-oms-openapi.json)**: **Unified Master Specification** merging all three microservices into one file for seamless Postman import!

---

## 3. Order Service API Reference (Port 3001)

### Tag: `Orders`
- **`POST /api/orders`**
  - **Summary:** Create a new order.
  - **Body:**
    ```json
    {
      "customerId": "cust-alice",
      "items": [
        { "sku": "macbook-m3", "quantity": 1, "unitPrice": 150000 }
      ]
    }
    ```
  - **Responses:** `201 Created` (status: `PENDING`), `400 Bad Request`.
- **`GET /api/orders`**
  - **Summary:** List orders with pagination & status filters.
  - **Query Parameters:** `status` (`PENDING`, `CONFIRMED`, `COMPENSATING`, `CANCELLED`), `customerId`, `limit`, `offset`.
  - **Responses:** `200 OK`.
- **`GET /api/orders/{id}`**
  - **Summary:** Retrieve order metadata, line items, and transactional outbox event publication history.
  - **Responses:** `200 OK`, `404 Not Found`.
- **`POST /api/orders/{id}/cancel`**
  - **Summary:** Manually initiate order cancellation.
  - **Body (optional):** `{"reason": "Customer cancellation"}`
  - **Behavior:** If order is CONFIRMED or PENDING, transitions status to COMPENSATING and emits an `InventoryReleaseRequested` event to Kafka. Inventory Service restores stock, and order status transitions to `CANCELLED`.
  - **Responses:** `200 OK`, `400 Bad Request`, `404 Not Found`.

### Tag: `Analytics`
- **`GET /api/orders/stats/summary`**
  - **Summary:** Executive overview of total order count, total revenue, confirmed revenue, and breakdown by status.

### Tag: `System`
- **`GET /health`**
  - **Summary:** Health check and timestamp.

---

## 4. Inventory Service API Reference (Port 3002)

### Tag: `Catalog`
- **`GET /api/inventory`**
  - **Summary:** List all catalog items with available and reserved unit counts.
  - **Responses:** `200 OK`.
- **`GET /api/inventory/{sku}`**
  - **Summary:** Get real-time stock details for a single SKU.
  - **Responses:** `200 OK`, `404 Not Found`.
- **`POST /api/inventory`**
  - **Summary:** Register a new SKU into the warehouse catalog.
  - **Body:**
    ```json
    {
      "sku": "airpods-pro",
      "name": "Apple AirPods Pro 2",
      "availableQuantity": 25
    }
    ```
  - **Responses:** `201 Created`, `409 Conflict`.
- **`POST /api/inventory/{sku}/restock`**
  - **Summary:** Atomically add stock to an existing SKU using row locks.
  - **Body:** `{"quantityToAdd": 10}`
  - **Responses:** `200 OK`, `404 Not Found`.

### Tag: `Reservations`
- **`GET /api/inventory/reservations`**
  - **Summary:** List stock reservations with filters (`orderId`, `status`: `RESERVED`, `RELEASED`, `CONFIRMED`).
- **`GET /api/inventory/reservations/{orderId}`**
  - **Summary:** Get stock reservation records for a specific order.

---

## 5. Payment Service API Reference (Port 3003)

### Tag: `Payments`
- **`GET /api/payments`**
  - **Summary:** List payment transactions with filters (`status`: `AUTHORIZED`, `FAILED`, `orderId`).
- **`GET /api/payments/{id}`**
  - **Summary:** Get payment details by payment UUID.
- **`GET /api/payments/order/{orderId}`**
  - **Summary:** Get payment transactions for an order.

### Tag: `Analytics`
- **`GET /api/payments/stats`**
  - **Summary:** Transaction statistics (authorized vs. failed counts & total volume in INR).

### Tag: `Resilience`
- **`GET /api/payments/processed-events`**
  - **Summary:** View deduplicated event IDs (PostgreSQL idempotency store).
- **`POST /api/payments/dlq/replay`**
  - **Summary:** Trigger Dead Letter Queue (DLQ) replay directly via HTTP API. Consumes from `payment.events.dlq` from offset 0, injects audit headers (`x-replayed: true`), and republishes to the active topic.

---

## 6. Importing into Postman / Insomnia

To test all microservices in Postman or Insomnia:

1. Open Postman or Insomnia.
2. Click **Import**.
3. Select **File** and choose:
   ```
   d:/Projects/distributed-oms/docs/openapi/unified-oms-openapi.json
   ```
4. Postman will automatically create a complete Collection with folders:
   - `Orders`
   - `Order Analytics`
   - `Inventory Catalog`
   - `Inventory Reservations`
   - `Payments`
   - `Payment Analytics`
   - `Payment Resilience`
   - `Health & Diagnostics`
5. All route URLs, parameters, sample JSON bodies, and headers are pre-populated!
