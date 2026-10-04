# 🔄 Distributed OMS — Workflows, State Machines & Flowcharts

This document details every transaction flow, failure recovery path, and state machine transition in the Distributed Order Management System using comprehensive Mermaid diagrams and step-by-step explanations.

---

## 📑 Table of Contents
1. [High-Level Architecture Map](#1-high-level-architecture-map)
2. [Order Lifecycle State Machine](#2-order-lifecycle-state-machine)
3. [Workflow 1: The Happy Path (Complete Order Success)](#3-workflow-1-the-happy-path-complete-order-success)
4. [Workflow 2: Inventory Failure Path (Out of Stock)](#4-workflow-2-inventory-failure-path-out-of-stock)
5. [Workflow 3: Payment Failure & Saga Compensation Rollback](#5-workflow-3-payment-failure--saga-compensation-rollback)
6. [Workflow 4: The Transactional Outbox Relay Pattern](#6-workflow-4-the-transactional-outbox-relay-pattern)
7. [Workflow 5: Resilient Consumer, Retry Backoff & DLQ Flow](#7-workflow-5-resilient-consumer-retry-backoff--dlq-flow)
8. [Workflow 6: Distributed Tracing & W3C Context Propagation](#8-workflow-6-distributed-tracing--w3c-context-propagation)

---

## 1. High-Level Architecture Map

The system is organized into three microservices, a shared contract package, a Kafka event backbone with KRaft, PostgreSQL databases, and Jaeger observability.

```mermaid
flowchart TB
    subgraph ClientLayer["Client Layer"]
        Client["Web / Mobile App / cURL"]
    end

    subgraph OrderService["Order Service (Port 3001)"]
        API["Fastify HTTP Server\nPOST /api/orders"]
        OrderDB[("PostgreSQL\norder_db\n(orders, items, outbox)")]
        OutboxRelay["Outbox Relay Worker\n(Polls every 1s)"]
        Saga["Saga Orchestrator\nConsumer"]
    end

    subgraph KafkaBackbone["Apache Kafka Event Broker (KRaft Mode - Port 9094)"]
        TOPIC_ORDER["order.events"]
        TOPIC_INVENTORY["inventory.events"]
        TOPIC_PAYMENT["payment.events"]
        TOPIC_PAYMENT_DLQ["payment.events.dlq"]
    end

    subgraph InventoryService["Inventory Service"]
        InvConsumer["Inventory Consumer"]
        InvDB[("PostgreSQL\ninventory_db\n(inventory, reservations)")]
        InvProducer["Inventory Producer"]
    end

    subgraph PaymentService["Payment Service"]
        PayResilient["Resilient Consumer\n(Retry + Backoff)"]
        PayDB[("PostgreSQL\npayment_db\n(processed_events, payments)")]
        PayProducer["Payment Producer"]
        DLQReplayer["DLQ Replay Tool\npnpm dlq:replay"]
    end

    subgraph Observability["Observability & Monitoring"]
        Jaeger["Jaeger Tracing UI\n(Port 16686 / OTLP 4318)"]
        KafkaUI["Kafka UI Dashboard\n(Port 8080)"]
    end

    %% Interactions
    Client -->|"1. POST /api/orders"| API
    API -->|"2. Single ACID Transaction"| OrderDB
    OrderDB -.->|"3. FOR UPDATE SKIP LOCKED"| OutboxRelay
    OutboxRelay -->|"4. OrderCreated"| TOPIC_ORDER

    TOPIC_ORDER -->|"5. Consume OrderCreated"| InvConsumer
    InvConsumer <-->|"6. Pessimistic Lock (FOR UPDATE)"| InvDB
    InvConsumer -->|"7a. InventoryReserved"| TOPIC_INVENTORY
    InvConsumer -->|"7b. InventoryReservationFailed"| TOPIC_INVENTORY

    TOPIC_INVENTORY -->|"8. Consume InventoryReserved"| PayResilient
    PayResilient <-->|"9. Check Idempotency & Save Payment"| PayDB
    PayResilient -->|"10a. PaymentAuthorized"| TOPIC_PAYMENT
    PayResilient -->|"10b. PaymentFailed"| TOPIC_PAYMENT
    PayResilient -.->|"10c. Poison Pill / Exhausted Retries"| TOPIC_PAYMENT_DLQ

    TOPIC_INVENTORY -->|"Listen to Inventory Outcomes"| Saga
    TOPIC_PAYMENT -->|"Listen to Payment Outcomes"| Saga
    Saga -->|"Compensation: InventoryReleaseRequested"| TOPIC_INVENTORY
    TOPIC_INVENTORY -->|"Consume Release Request"| InvConsumer
    Saga -->|"Update Order Status (CONFIRMED/CANCELLED)"| OrderDB

    DLQReplayer -.->|"Re-inject Recovered Messages"| TOPIC_INVENTORY

    OrderService -.->|"Export Traces"| Jaeger
    InventoryService -.->|"Export Traces"| Jaeger
    PaymentService -.->|"Export Traces"| Jaeger
    KafkaBackbone -.->|"Inspect Clusters & Topics"| KafkaUI
```

---

## 2. Order Lifecycle State Machine

Each order transitions through a strictly defined state machine inside the `orders` table in `order_db`.

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /api/orders (OrderCreated saved to Outbox)
    
    state PENDING {
        [*] --> AwaitingInventory: OrderCreated published to Kafka
        AwaitingInventory --> AwaitingPayment: InventoryReserved emitted
    }

    PENDING --> CANCELLED: InventoryReservationFailed (Out of Stock / SKU missing)
    
    PENDING --> COMPENSATING: PaymentFailed (Amount > ₹500,000 or gateway error)
    
    AwaitingPayment --> CONFIRMED: PaymentAuthorized emitted (Happy Path completed!)
    
    state COMPENSATING {
        [*] --> EmittingReleaseRequest: InventoryReleaseRequested published
        EmittingReleaseRequest --> AwaitingReleaseConfirm: Stock released to shelf
    }

    COMPENSATING --> CANCELLED: InventoryReleased emitted by Inventory Service
    
    CONFIRMED --> [*]
    CANCELLED --> [*]
```

---

## 3. Workflow 1: The Happy Path (Complete Order Success)

This workflow demonstrates what happens when a customer purchases an in-stock product with a valid payment amount (≤ ₹5,00,000).

```mermaid
sequenceDiagram
    autonumber
    actor Customer as 👤 Customer
    participant OrderAPI as 🛒 Order Service API
    participant OrderDB as 🗄️ Order DB (PostgreSQL)
    participant Outbox as 📬 Outbox Relay
    participant Kafka as 📨 Apache Kafka
    participant InvSvc as 📦 Inventory Service
    participant InvDB as 🗄️ Inventory DB
    participant PaySvc as 💳 Payment Service
    participant PayDB as 🗄️ Payment DB
    participant Saga as 🎭 Saga Orchestrator

    Customer->>OrderAPI: POST /api/orders { customerId: "cust-1", items: [{ sku: "macbook-m3", quantity: 1, unitPrice: 150000 }] }
    Note over OrderAPI,OrderDB: Step 1: Atomic Database Transaction
    OrderAPI->>OrderDB: BEGIN TRANSACTION
    OrderAPI->>OrderDB: INSERT INTO orders (id, status='PENDING', total_amount=150000)
    OrderAPI->>OrderDB: INSERT INTO order_items (order_id, sku, quantity, unit_price)
    OrderAPI->>OrderDB: INSERT INTO outbox_events (event_type='OrderCreated', payload=...)
    OrderAPI->>OrderDB: COMMIT
    OrderAPI-->>Customer: 201 Created { orderId: "...", status: "PENDING" }

    Note over Outbox,Kafka: Step 2: Reliable Event Publication
    loop Every 1000ms
        Outbox->>OrderDB: SELECT * FROM outbox_events WHERE published_at IS NULL FOR UPDATE SKIP LOCKED
        Outbox->>Kafka: Publish "OrderCreated" to topic 'order.events'
        Outbox->>OrderDB: UPDATE outbox_events SET published_at = NOW()
    end

    Note over Kafka,InvSvc: Step 3: Inventory Reservation
    Kafka->>InvSvc: Consume "OrderCreated" from 'order.events'
    InvSvc->>InvDB: BEGIN TRANSACTION
    InvSvc->>InvDB: SELECT available_quantity FROM inventory WHERE sku='macbook-m3' FOR UPDATE
    Note over InvDB: Available = 5, Requested = 1 (Stock Available!)
    InvSvc->>InvDB: UPDATE inventory SET available_quantity = available_quantity - 1, reserved_quantity = reserved_quantity + 1
    InvSvc->>InvDB: INSERT INTO inventory_reservations (order_id, sku, quantity, status='RESERVED')
    InvSvc->>InvDB: COMMIT
    InvSvc->>Kafka: Publish "InventoryReserved" to topic 'inventory.events'

    Note over Kafka,PaySvc: Step 4: Payment Authorization & Idempotency
    Kafka->>PaySvc: Consume "InventoryReserved" from 'inventory.events'
    PaySvc->>PayDB: BEGIN TRANSACTION
    PaySvc->>PayDB: INSERT INTO processed_events (event_id, consumer_name) -- Idempotency check
    Note over PaySvc: Amount ₹1,50,000 <= ₹5,00,000 (Payment Approved)
    PaySvc->>PayDB: INSERT INTO payments (order_id, amount, status='AUTHORIZED')
    PaySvc->>PayDB: COMMIT
    PaySvc->>Kafka: Publish "PaymentAuthorized" to topic 'payment.events'

    Note over Kafka,Saga: Step 5: Saga Confirmation
    Kafka->>Saga: Consume "PaymentAuthorized" from 'payment.events'
    Saga->>OrderDB: UPDATE orders SET status = 'CONFIRMED' WHERE id = orderId
    Note over Saga: ✅ Order flow completed successfully!
```

---

## 4. Workflow 2: Inventory Failure Path (Out of Stock)

This scenario occurs when the requested quantity exceeds the stock available in `inventory` or if the SKU does not exist.

```mermaid
sequenceDiagram
    autonumber
    actor Customer as 👤 Customer
    participant OrderAPI as 🛒 Order Service API
    participant OrderDB as 🗄️ Order DB
    participant Outbox as 📬 Outbox Relay
    participant Kafka as 📨 Apache Kafka
    participant InvSvc as 📦 Inventory Service
    participant InvDB as 🗄️ Inventory DB
    participant Saga as 🎭 Saga Orchestrator

    Customer->>OrderAPI: POST /api/orders (Requesting 99 units of 'macbook-m3')
    OrderAPI->>OrderDB: INSERT orders (PENDING) + outbox_events (OrderCreated)
    OrderAPI-->>Customer: 201 Created { status: "PENDING" }

    Outbox->>Kafka: Publish "OrderCreated" to 'order.events'
    Kafka->>InvSvc: Consume "OrderCreated"

    InvSvc->>InvDB: BEGIN; SELECT available_quantity FROM inventory WHERE sku='macbook-m3' FOR UPDATE;
    Note over InvDB: Available = 5, Requested = 99 -> INSUFFICIENT STOCK!
    InvSvc->>InvDB: ROLLBACK
    InvSvc->>Kafka: Publish "InventoryReservationFailed" to 'inventory.events' { reason: "Insufficient stock" }

    Kafka->>Saga: Consume "InventoryReservationFailed" from 'inventory.events'
    Saga->>OrderDB: UPDATE orders SET status = 'CANCELLED', cancellation_reason = 'Insufficient stock' WHERE id = orderId
    Note over Saga: ❌ Order cancelled immediately. Payment was never invoked.
```

---

## 5. Workflow 3: Payment Failure & Saga Compensation Rollback

This is the most critical distributed systems scenario: **Inventory was already reserved**, but **Payment subsequently failed** (for example, the total exceeded ₹5,00,000). The Saga Orchestrator must perform a **compensating transaction** to release the reserved items back to the stock shelf.

```mermaid
sequenceDiagram
    autonumber
    actor Customer as 👤 Customer
    participant OrderDB as 🗄️ Order DB
    participant Kafka as 📨 Apache Kafka
    participant InvSvc as 📦 Inventory Service
    participant InvDB as 🗄️ Inventory DB
    participant PaySvc as 💳 Payment Service
    participant PayDB as 🗄️ Payment DB
    participant Saga as 🎭 Saga Orchestrator

    Note over Customer,InvSvc: Customer orders 4 MacBooks @ ₹150,000 = ₹6,00,000
    InvSvc->>InvDB: Reserve 4 MacBooks (available: 5 -> 1, reserved: 0 -> 4)
    InvSvc->>Kafka: Publish "InventoryReserved" (Total: ₹600,000)

    Kafka->>PaySvc: Consume "InventoryReserved"
    PaySvc->>PayDB: INSERT processed_events
    Note over PaySvc: Amount ₹6,00,000 > ₹5,00,000 limit -> FAILS!
    PaySvc->>PayDB: INSERT INTO payments (status='FAILED')
    PaySvc->>Kafka: Publish "PaymentFailed" to 'payment.events' { reason: "Limit exceeded" }

    Note over Kafka,Saga: Saga Orchestrator detects failure
    Kafka->>Saga: Consume "PaymentFailed" from 'payment.events'
    Saga->>OrderDB: UPDATE orders SET status = 'COMPENSATING', cancellation_reason = 'Limit exceeded'
    
    Note over Saga,Kafka: Trigger Compensating Transaction
    Saga->>Kafka: Publish "InventoryReleaseRequested" to topic 'inventory.events'

    Note over Kafka,InvSvc: Inventory Compensation Execution
    Kafka->>InvSvc: Consume "InventoryReleaseRequested"
    InvSvc->>InvDB: BEGIN TRANSACTION
    InvSvc->>InvDB: SELECT sku, quantity FROM inventory_reservations WHERE order_id = orderId AND status='RESERVED'
    InvSvc->>InvDB: UPDATE inventory SET available_quantity = available_quantity + 4, reserved_quantity = reserved_quantity - 4
    InvSvc->>InvDB: UPDATE inventory_reservations SET status = 'RELEASED' WHERE order_id = orderId
    InvSvc->>InvDB: COMMIT
    InvSvc->>Kafka: Publish "InventoryReleased" to 'inventory.events'

    Note over Kafka,Saga: Complete Saga Cancellation
    Kafka->>Saga: Consume "InventoryReleased"
    Saga->>OrderDB: UPDATE orders SET status = 'CANCELLED'
    Note over Saga: 🔄 Compensation Complete! Stock is restored to shelf, Order is CANCELLED.
```

---

## 6. Workflow 4: The Transactional Outbox Relay Pattern

The Transactional Outbox pattern guarantees that database writes and Kafka events are 100% consistent, solving the dual-write problem.

```mermaid
flowchart TD
    Client["Client / User"] -->|POST /api/orders| Handler["Order Controller"]

    subgraph AtomicPostgresTx["PostgreSQL Atomic Transaction"]
        Handler -->|1. BEGIN| TxStart["Begin TX"]
        TxStart -->|2. Write| OrdersTable["INSERT INTO orders\n(status: PENDING)"]
        OrdersTable -->|3. Write| ItemsTable["INSERT INTO order_items\n(line items)"]
        ItemsTable -->|4. Write| OutboxTable["INSERT INTO outbox_events\n(payload, published_at: NULL)"]
        OutboxTable -->|5. COMMIT| TxCommit["Commit TX (Guaranteed ACID)"]
    end

    TxCommit -->|201 Created| Client

    subgraph OutboxWorker["Outbox Relay Worker (Every 1000ms)"]
        Timer["Interval Poller"] -->|Query with Row Locks| SelectEvents["SELECT * FROM outbox_events\nWHERE published_at IS NULL\nORDER BY created_at ASC\nLIMIT 10\nFOR UPDATE SKIP LOCKED"]
        SelectEvents -->|Has Rows?| Decision{Rows Found?}
        Decision -->|No| Wait["Sleep 1 second"]
        Decision -->|Yes| ForEach["For Each Event"]
        ForEach -->|Inject W3C Tracing Headers| KafkaPublish["producer.send(topic, message, headers)"]
        KafkaPublish -->|Kafka ACK Received| MarkDone["UPDATE outbox_events\nSET published_at = NOW()\nWHERE id = event.id"]
        MarkDone -->|Commit Worker TX| RelayCommit["COMMIT"]
    end

    KafkaPublish -->|Stored safely on disk| KafkaBroker["Apache Kafka Broker"]
```

---

## 7. Workflow 5: Resilient Consumer, Retry Backoff & DLQ Flow

This flowchart describes the error handling, exponential backoff, and Dead Letter Queue mechanism implemented inside [packages/event-contracts/src/resilientConsumer.ts](file:///d:/Projects/distributed-oms/packages/event-contracts/src/resilientConsumer.ts).

```mermaid
flowchart TD
    Start["Message Arrives from Kafka"] --> ParseCheck{"Is valid JSON?"}

    ParseCheck -->|No| DirectDLQ1["Send directly to DLQ\nReason: Non-parseable JSON"]
    ParseCheck -->|Yes| EnvelopeCheck{"Has valid eventId\nstring envelope?"}

    EnvelopeCheck -->|No| DirectDLQ2["Send directly to DLQ\nReason: Missing eventId"]
    EnvelopeCheck -->|Yes| ExtractTrace["Extract W3C Trace Context\nfrom message headers"]

    ExtractTrace --> StartSpan["Start OpenTelemetry Span\n(process topic message)"]
    StartSpan --> InitAttempt["attempt = 0"]

    InitAttempt --> ExecuteHandler["Call service handler(payload, message)"]

    ExecuteHandler --> HandlerSuccess{"Handler succeeded?"}

    HandlerSuccess -->|Yes| CompleteSpan["End Span & Return (Success)"]

    HandlerSuccess -->|No - Error Thrown| IncrementAttempt["attempt = attempt + 1"]
    IncrementAttempt --> CheckMaxRetries{"attempt >= maxRetries?\n(Default: 3)"}

    CheckMaxRetries -->|Yes - Retries Exhausted| BuildDeadLetter["Create DeadLetterEnvelope\n- originalTopic\n- originalMessage\n- error.message & stack\n- failedAt timestamp\n- retryCount\n- consumerGroup"]
    BuildDeadLetter --> SendDLQ["producer.send(dlqTopic, DeadLetterEnvelope)"]
    SendDLQ --> DLQComplete["Log Alert & Return (Handled)"]

    CheckMaxRetries -->|No - More Retries Left| CalculateBackoff["Calculate Exponential Backoff:\nbackoff = initialBackoffMs * 2^(attempt - 1)\n(e.g., 500ms, 1000ms, 2000ms)"]
    CalculateBackoff --> Sleep["Wait for backoff duration"]
    Sleep --> ExecuteHandler

    subgraph ReplayMechanism["DLQ Replay Tool (pnpm dlq:replay)"]
        Admin["Developer / Operator"] -->|Runs CLI| RunReplayer["Execute replay-dlq.ts"]
        RunReplayer --> ReadDLQ["Consume from payment.events.dlq\n(Offset 0)"]
        ReadDLQ --> FormatOriginal["Extract originalMessage & aggregateId"]
        FormatOriginal --> AddAuditHeaders["Add headers:\n- x-replayed: true\n- x-replayed-at: timestamp"]
        AddAuditHeaders --> Republish["producer.send(originalTopic, originalMessage)"]
        Republish --> ReplaySuccess["Message successfully returned to processing pipeline!"]
    end
```

---

## 8. Workflow 6: Distributed Tracing & W3C Context Propagation

Tracing enables visibility across all asynchronous boundaries, matching HTTP requests to background Kafka events and database queries.

```mermaid
sequenceDiagram
    autonumber
    participant Client as 👤 HTTP Client
    participant OrderSvc as 🛒 Order Service
    participant Kafka as 📨 Apache Kafka
    participant InvSvc as 📦 Inventory Service
    participant PaySvc as 💳 Payment Service
    participant Jaeger as 🔍 Jaeger (Collector :4318 / UI :16686)

    Client->>OrderSvc: POST /api/orders (traceparent: 00-4bf92f35...-00c4...-01)
    Note over OrderSvc: Starts Span: 'POST /api/orders'
    OrderSvc->>OrderSvc: Inject trace headers into Outbox record
    OrderSvc->>Jaeger: Export Span: 'POST /api/orders' (Duration: 35ms)
    
    OrderSvc->>Kafka: Publish OrderCreated with Kafka headers:<br/>traceparent: 00-4bf92f35...-1a2b...-01

    Kafka->>InvSvc: Read message with traceparent header
    Note over InvSvc: Extracts traceparent header!<br/>Continues Trace ID 4bf92f35...
    Note over InvSvc: Starts Child Span: 'process order.events message'
    InvSvc->>InvSvc: Execute pessimistic DB lock
    InvSvc->>Jaeger: Export Child Span: 'process order.events' (Duration: 18ms)
    InvSvc->>Kafka: Publish InventoryReserved with traceparent:<br/>00-4bf92f35...-3c4d...-01

    Kafka->>PaySvc: Read message with traceparent header
    Note over PaySvc: Extracts traceparent header!<br/>Starts Child Span: 'process payment.events'
    PaySvc->>PaySvc: Check Idempotency & Save Payment
    PaySvc->>Jaeger: Export Child Span: 'process payment.events' (Duration: 22ms)

    Note over Jaeger: Jaeger merges all 3 spans into a single unified trace waterfall timeline!
```
