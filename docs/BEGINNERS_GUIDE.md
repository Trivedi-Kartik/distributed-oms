# 📘 Distributed OMS — Beginner's Guide & Technology Primer

> **Who is this guide for?**  
> If you are new to distributed systems, microservices, Apache Kafka, monorepos, pnpm, Docker, or distributed tracing, this guide was written specifically for you! It explains every technology, pattern, and design choice used in this project from the ground up with plain-English analogies.

---

## 📑 Table of Contents
1. [Monoliths vs. Microservices](#1-monoliths-vs-microservices)
2. [What is a Monorepo and PNPM?](#2-what-is-a-monorepo-and-pnpm)
3. [What is Apache Kafka? (The Event Backbone)](#3-what-is-apache-kafka-the-event-backbone)
4. [Synchronous REST vs. Event-Driven Architecture (EDA)](#4-synchronous-rest-vs-event-driven-architecture-eda)
5. [The Dual-Write Problem & The Transactional Outbox Pattern](#5-the-dual-write-problem--the-transactional-outbox-pattern)
6. [Distributed Transactions & The Saga Pattern](#6-distributed-transactions--the-saga-pattern)
7. [What is Idempotency & Why Does It Matter?](#7-what-is-idempotency--why-does-it-matter)
8. [Dead Letter Queues (DLQ) & Poison Pills](#8-dead-letter-queues-dlq--poison-pills)
9. [Distributed Tracing with OpenTelemetry & Jaeger](#9-distributed-tracing-with-opentelemetry--jaeger)
10. [Docker & Docker Compose Basics](#10-docker--docker-compose-basics)
11. [Glossary of System Terms](#11-glossary-of-system-terms)

---

## 1. Monoliths vs. Microservices

### The Monolith (Traditional Approach)
In a traditional **monolithic** web app, all features (Orders, Inventory, Payments, Users, Shipping) live inside a single codebase, run in a single process, and share a single database:
- **Advantage:** Easy to build initially. You can do database transactions spanning multiple tables (`BEGIN TRANSACTION ... COMMIT`).
- **Disadvantage:** If the Payment gateway crashes, the entire website might freeze. Scaling requires duplicating the entire application. Independent teams step on each other's toes.

### Microservices (Our Architecture)
In a **microservices** architecture, the application is divided into small, independent, specialized services:
1. **Order Service:** Handles order placement and customer carts.
2. **Inventory Service:** Tracks stock levels and reserves items.
3. **Payment Service:** Interacts with payment gateways and authorizes payments.

Each service has its **own private database**. The Order Service cannot query or write to the Inventory database directly. This ensures:
- **Fault Isolation:** If Payment Service is down, customers can still browse inventory.
- **Independent Scalability:** If thousands of people are checking inventory, we can spin up 10 Inventory instances without touching Payment.
- **Technology Flexibility:** Each service can evolve independently.

> **The Big Challenge:** If each service has its own database, how do we keep data consistent across all of them without a single centralized database transaction? This is solved by **Apache Kafka** and the **Saga Pattern**!

---

## 2. What is a Monorepo and PNPM?

### What is a Monorepo?
A **monorepo** (monolithic repository) is a single Git repository containing multiple distinct projects or packages. In our repository:
```
distributed-oms/
├── apps/
│   ├── order-service/      # Independent Node.js microservice
│   ├── inventory-service/  # Independent Node.js microservice
│   └── payment-service/    # Independent Node.js microservice
├── packages/
│   └── event-contracts/    # Shared library with schemas, types & utilities
└── infrastructure/         # Docker Compose, SQL scripts
```
Instead of managing 4 separate Git repositories, everything is housed together, making cross-cutting refactoring and type sharing effortless.

### What is PNPM?
`pnpm` (Performant Node Package Manager) is an alternative to `npm` and `yarn`:
- **Content-Addressable Storage:** Unlike standard `npm` which copies `node_modules` into every single project folder (wasting gigabytes of disk space), `pnpm` stores package files in a single global content store on your disk and uses hard links.
- **Workspaces (`pnpm-workspace.yaml`):** PNPM connects all projects inside `apps/*` and `packages/*`.
- **Workspace Protocol (`workspace:*`):** Notice inside [apps/order-service/package.json](file:///d:/Projects/distributed-oms/apps/order-service/package.json):
  ```json
  "dependencies": {
    "@oms/event-contracts": "workspace:*"
  }
  ```
  This tells PNPM: *"Do not download `@oms/event-contracts` from the public internet. Use the local folder in `packages/event-contracts`!"* Any edit in `packages/event-contracts` is instantly available across all services without publishing to npm.

---

## 3. What is Apache Kafka? (The Event Backbone)

### The Real-World Analogy
Think of Apache Kafka like a **bulletin board with an immutable logbook** in a busy office:
- Someone pins an announcement: *"Notice #104: Order #99 has been placed."*
- Everyone in the office can walk up to the board and read the note whenever they are ready.
- Reading the notice does not erase it. It stays there in exact sequence forever (or for a configured retention period).
- Different departments (Inventory, Payment, Shipping) read at their own speed and keep a personal bookmark of which note they read last.

```
+-----------------------------------------------------------+
|                      APACHE KAFKA                         |
|                                                           |
| Topic: order.events                                       |
| [Offset 0]  [Offset 1]  [Offset 2]  [Offset 3]  [Offset 4]|
| Order #1    Order #2    Order #3    Order #4    Order #5  |
+-----------------------------------------------------------+
         ▲                                   ▲
         │ Producer                          │ Consumer (Reads & bookmarks offset)
  [Order Service]                  [Inventory Service]
```

### Core Kafka Terminology Explained
| Term | What It Means | In Our Project |
| :--- | :--- | :--- |
| **Broker** | A running Kafka server instance that receives, stores, and serves messages. | The Docker container `oms-kafka` running on port `9094`. |
| **Topic** | A named stream/channel of messages (like a table in a database, or a folder of events). | `order.events`, `inventory.events`, `payment.events`. |
| **Message / Event** | A record written to Kafka containing a key, value (JSON payload), and optional headers. | An event envelope containing `orderId`, `items`, `amount`. |
| **Partition** | A topic is split into partitions for horizontal scalability and ordering. | Each partition guarantees strict FIFO (First-In, First-Out) order for messages with the same partition key. |
| **Partition Key** | A string (e.g., `orderId`). Kafka hashes this key to ensure all events for the **same order** go to the **exact same partition**, guaranteeing strict chronological order. | We use `orderId` or `aggregateId` as the Kafka message key. |
| **Producer** | An application that writes (publishes) messages to a Kafka topic. | Order Service, Inventory Service, Payment Service. |
| **Consumer** | An application that reads (subscribes to) messages from a topic. | Inventory Service reads `order.events`; Payment Service reads `inventory.events`. |
| **Consumer Group** | A team of consumer instances working together. Kafka assigns each partition to only one consumer in the group, ensuring work is not duplicated. | `order-saga-orchestrator-group`, `inventory-service-group`, `payment-service-group`. |
| **Offset** | A sequential integer assigned to each message in a partition (e.g., 0, 1, 2, 3...). The consumer commits its offset as a "bookmark" of what it has processed. | Allows consumers to resume exactly where they left off if they restart. |
| **KRaft Mode** | Kafka Raft Metadata mode. Older Kafka required an extra software called Apache ZooKeeper to manage cluster metadata. Modern Kafka (v3.3+) uses **KRaft**, eliminating ZooKeeper entirely for high performance and simpler management! | Our [docker-compose.yml](file:///d:/Projects/distributed-oms/docker-compose.yml) runs Kafka in KRaft mode. |

---

## 4. Synchronous REST vs. Event-Driven Architecture (EDA)

### Synchronous REST (HTTP Calls)
In a synchronous system, when a user clicks "Buy":
1. Order Service calls Inventory Service over HTTP: *"Reserve 1 laptop"*.
2. Order Service waits... (blocked).
3. Order Service calls Payment Service over HTTP: *"Charge ₹1,00,000"*.
4. Order Service waits... (blocked).
5. If Payment Service takes 10 seconds or fails due to a network blip, the user's browser hangs or crashes.
6. **Temporal Coupling:** All services must be online, reachable, and fast at the exact same millisecond.

### Event-Driven Architecture (EDA)
In our Event-Driven OMS:
1. User submits an order to Order Service via HTTP.
2. Order Service saves the order as `PENDING`, publishes an `OrderCreated` event to Kafka, and immediately responds to the user: `201 Created (Order ID: xyz)`.
3. Inventory Service reacts to `OrderCreated` whenever it is ready, reserves stock, and publishes `InventoryReserved`.
4. Payment Service reacts to `InventoryReserved`, authorizes payment, and publishes `PaymentAuthorized`.
5. Order Service reacts to `PaymentAuthorized` and marks the order `CONFIRMED`.
- **Temporal Decoupling:** Even if Payment Service is rebooting for 30 seconds, Kafka safely buffers the messages. When Payment Service boots up, it picks up right where it left off. Nothing is lost!

---

## 5. The Dual-Write Problem & The Transactional Outbox Pattern

### What is the "Dual-Write Problem"?
Suppose Order Service receives a new order. It needs to do two things:
1. Save the order to its PostgreSQL database (`INSERT INTO orders...`).
2. Send an event to Apache Kafka (`producer.send('order.events', ...)`).

What happens if step 1 succeeds, but right before step 2, the server crashes, or Kafka has a network glitch?
- Database has the order, but Kafka never got the event! Inventory will never reserve stock, Payment will never charge the customer, and the order is stuck in limbo forever.
What if we reverse the order (publish to Kafka first, then save to DB)?
- If the DB insert fails (e.g., unique constraint violation or DB timeout), Kafka has already told the world that an order was created! Inventory will reserve stock for a ghost order that doesn't exist.

> This dilemma is known across computer science as the **Dual-Write Problem**. You cannot write to two independent distributed storage systems (Postgres and Kafka) atomically without a distributed coordination protocol.

### The Solution: Transactional Outbox Pattern
Instead of writing to Kafka directly in the HTTP request handler:
1. Order Service writes both the `orders` record AND an `outbox_events` record inside **one single atomic PostgreSQL transaction**:
   ```sql
   BEGIN;
     INSERT INTO orders (id, customer_id, status, ...) VALUES (...);
     INSERT INTO order_items (id, order_id, sku, ...) VALUES (...);
     INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload) VALUES (...);
   COMMIT;
   ```
   Postgres guarantees **ACID properties**: either BOTH records are saved, or NEITHER is saved.
2. A separate background process called the **Outbox Relay** [apps/order-service/src/outboxRelay.ts](file:///d:/Projects/distributed-oms/apps/order-service/src/outboxRelay.ts) polls `outbox_events` every 1 second:
   ```sql
   SELECT * FROM outbox_events 
   WHERE published_at IS NULL 
   ORDER BY created_at ASC 
   LIMIT 10 
   FOR UPDATE SKIP LOCKED;
   ```
3. The relay publishes each message to Kafka, and once Kafka confirms receipt (`ACK`), marks `published_at = NOW()`.
- **Result:** Zero lost messages! Guaranteed At-Least-Once event delivery.

---

## 6. Distributed Transactions & The Saga Pattern

### Why Can't We Use Traditional Transactions?
In a monolith, if payment fails, you simply execute `ROLLBACK` and the database rolls back changes to both orders and inventory tables.
In microservices, Order, Inventory, and Payment have **physically separate databases**. A database `ROLLBACK` in Payment Service cannot reach into Inventory Service's database!

### The Saga Pattern
A **Saga** is a sequence of local transactions across multiple services. Each local transaction updates a database and publishes an event that triggers the next step.
If a step fails, the Saga executes **Compensating Transactions** — reverse operations that undo earlier actions (like issuing a refund or putting reserved inventory back on the shelf).

There are two styles of Sagas:
1. **Choreography:** Each service listens to events and decides what to do next without a central coordinator. Can become confusing to trace as the system grows.
2. **Orchestration (Used in our project):** A central coordinator (the **Saga Orchestrator** inside [apps/order-service/src/sagaOrchestrator.ts](file:///d:/Projects/distributed-oms/apps/order-service/src/sagaOrchestrator.ts)) tracks order state and commands services what to do.

```
HAPPY PATH:
[Customer] ---> [Order Service] 
                    │ (OrderCreated)
                    ▼
           [Inventory Service] (Stock Reserved)
                    │ (InventoryReserved)
                    ▼
           [Payment Service]   (Payment Authorized)
                    │ (PaymentAuthorized)
                    ▼
           [Saga Orchestrator] ---> Updates Order to "CONFIRMED"

COMPENSATION PATH (Payment Fails):
[Payment Service] ──(PaymentFailed)──> [Saga Orchestrator]
                                              │
                    Sets Order to "COMPENSATING"
                                              │
                    Emits "InventoryReleaseRequested"
                                              ▼
                                     [Inventory Service]
                                              │ Un-reserves stock
                                              ▼
                                     Emits "InventoryReleased"
                                              ▼
                                     [Saga Orchestrator]
                                              │
                                     Sets Order to "CANCELLED"
```

---

## 7. What is Idempotency & Why Does It Matter?

### What is Idempotency?
An operation is **idempotent** if performing it multiple times produces the exact same result as performing it once.
- *Mathematical example:* Multiplying a number by 1 (`x * 1 = x`) is idempotent. Pressing an elevator button for floor 5 is idempotent.
- *Non-idempotent example:* Charging a customer's credit card ₹50,000. If you do it twice, they get charged ₹1,00,000!

### Why Duplicates Happen in Kafka
Kafka guarantees **At-Least-Once delivery**. This means if a network timeout occurs right when a consumer finishes reading a message but before it saves its offset back to Kafka, Kafka will redeliver the message.
Consequently, your consumers **MUST be idempotent**!

### How We Implement Idempotency
In [apps/payment-service/src/index.ts](file:///d:/Projects/distributed-oms/apps/payment-service/src/index.ts):
1. Every event has a globally unique `eventId` (UUIDv4) generated by the producer.
2. Payment Service maintains a table named `processed_events`:
   ```sql
   CREATE TABLE processed_events (
     event_id UUID PRIMARY KEY,
     consumer_name VARCHAR(100) NOT NULL,
     processed_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
3. Before charging the card, Payment Service inserts the `event_id`:
   ```sql
   INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, $2);
   ```
4. If a duplicate event arrives, PostgreSQL throws a unique constraint error (`code 23505`). Payment Service catches this error, logs `Duplicate event detected. Skipping safely.`, rolls back, and does NOT charge the customer twice!

---

## 8. Dead Letter Queues (DLQ) & Poison Pills

### What is a Poison Pill?
A **poison pill** is a message that cannot be processed successfully no matter how many times you retry:
- Malformed JSON (e.g. `{"invalid_json...`).
- Schema violation (missing required `orderId` or negative amounts).
- Unhandled business exceptions (e.g. database schema mismatch).

In standard Kafka, if a consumer encounters an unhandled exception and crashes, Kafka restarts the consumer, which reads the same message, crashes again, restarts, crashes... The consumer is permanently stuck in an infinite crash loop, blocking all subsequent valid messages!

### What is a Dead Letter Queue (DLQ)?
A DLQ is a specialized Kafka topic (e.g., `payment.events.dlq`) where failed or unprocessable messages are shunted so that normal message processing can continue uninterrupted.

### Our Resilient Consumer Pattern
We built [packages/event-contracts/src/resilientConsumer.ts](file:///d:/Projects/distributed-oms/packages/event-contracts/src/resilientConsumer.ts):
1. **JSON Validation:** If the message is unparseable JSON, route directly to DLQ.
2. **Envelope Check:** If required fields (`eventId`) are missing, route directly to DLQ.
3. **Retry with Exponential Backoff:** For transient errors, retry up to 3 times:
   - Attempt 1: wait 500ms
   - Attempt 2: wait 1000ms
   - Attempt 3: wait 2000ms
4. **DLQ Escalation:** If all 3 attempts fail, wrap the original payload, stack trace, failure timestamp, and retry count into a `DeadLetterEnvelope` and send it to the DLQ topic.
5. **Replay Tool:** When the bug or outage is fixed, an engineer can run [apps/payment-service/src/replay-dlq.ts](file:///d:/Projects/distributed-oms/apps/payment-service/src/replay-dlq.ts) (`pnpm dlq:replay`) to safely inject the dead letters back into the original topic!

---

## 9. Distributed Tracing with OpenTelemetry & Jaeger

### The Problem in Distributed Systems
When an order request fails or takes 5 seconds, how do you know *which* service caused the delay?
- Did Order Service take 2ms?
- Did Kafka queue it for 100ms?
- Did Inventory Service lock the database row for 3 seconds?
- Did Payment Service experience a network lag?

Traditional logs are scattered across different terminal windows and files. It is nearly impossible to correlate them manually.

### The Solution: OpenTelemetry & Distributed Context Propagation
- **Trace:** Represents the complete journey of a request as it moves through all microservices. Every trace has a unique **Trace ID** (e.g., `4bf92f3577b34da6a3ce929d0e0e4736`).
- **Span:** A single unit of work within a trace (e.g., `POST /api/orders`, `reserve inventory`, `process payment`).
- **Context Propagation:** When Order Service publishes a message to Kafka, it injects the W3C `traceparent` header into the Kafka message headers using [packages/event-contracts/src/tracingContext.ts](file:///d:/Projects/distributed-oms/packages/event-contracts/src/tracingContext.ts).
- When Inventory Service reads the Kafka message, it extracts that header and continues the trace!
- **Jaeger UI:** A web dashboard (`http://localhost:16686`) where you can visually inspect the entire call graph, see waterfalls of execution times, and pinpoint errors down to the exact millisecond and line of code.

```
Jaeger Visual Trace Waterfall:
[Order Service: POST /api/orders] ════════════════════════════════════ (45ms)
    └─ [Kafka: order.events publication] ════ (12ms)
         └─ [Inventory Service: handleOrderCreated] ══════════ (25ms)
              └─ [Postgres: SELECT FOR UPDATE] ═══ (4ms)
              └─ [Kafka: inventory.events publication] ══ (8ms)
                   └─ [Payment Service: processPayment] ═════════ (30ms)
                        └─ [Postgres: INSERT payment] ══ (6ms)
                        └─ [Saga Orchestrator: confirmOrder] ══ (10ms)
```

---

## 10. Docker & Docker Compose Basics

### Why Docker?
Instead of forcing every developer to install PostgreSQL 16, configure database users, download Apache Kafka, configure JVM flags, install Jaeger, and set up Kafka UI on their operating system:
- Docker packages software into standardized lightweight **containers** that run identically on Windows, macOS, and Linux.
- `docker-compose.yml` is a recipe file that starts all 4 infrastructure dependencies with a single command:
  ```bash
  docker compose up -d
  ```

### Services Managed by Docker in this Project
1. **`oms-postgres` (Port 5432):** Runs PostgreSQL 16. On first boot, runs `init-databases.sql` to initialize `order_db`, `inventory_db`, and `payment_db`.
2. **`oms-kafka` (Port 9094):** Apache Kafka broker in KRaft mode.
3. **`oms-kafka-ui` (Port 8080):** Web GUI to browse topics, messages, and consumer groups at `http://localhost:8080`.
4. **`oms-jaeger` (Port 16686 & 4318):** Distributed tracing receiver (OTLP on 4318) and visual dashboard on 16686.

---

## 11. Glossary of System Terms

| Term | Simple Definition |
| :--- | :--- |
| **ACID** | Atomicity, Consistency, Isolation, Durability — database transaction guarantees. |
| **Aggregate ID** | The unique identifier of the core entity being modified (in our case, `orderId`). |
| **Causation ID** | The ID of the event that directly caused the current event to occur. |
| **Correlation ID** | A shared ID tracking the entire business transaction from the original user click across all services. |
| **DLQ** | Dead Letter Queue — storage for messages that cannot be processed after retries. |
| **EDA** | Event-Driven Architecture — services communicate by producing and consuming events asynchronously. |
| **Idempotency** | The property of an operation where executing it multiple times has the exact same effect as executing it once. |
| **KRaft** | Kafka Raft — Kafka's native consensus mechanism that replaced ZooKeeper. |
| **OTel** | Short for OpenTelemetry — an open-source observability framework for metrics, traces, and logs. |
| **Outbox Pattern** | Saving events to a local DB table in the same transaction as business data, then asynchronously publishing them. |
| **Pessimistic Lock** | Locking a database row (`FOR UPDATE`) so no other transaction can read or modify it until you are finished. |
| **Poison Pill** | A message that causes consumers to crash consistently due to bugs or corrupt data. |
| **Saga Pattern** | A sequence of local transactions with compensating rollbacks for managing distributed data consistency. |
| **Zod** | A TypeScript-first schema declaration and runtime validation library. |
