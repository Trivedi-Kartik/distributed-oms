# 🏗️ Infrastructure & Local Development Environment

This directory and the root `docker-compose.yml` orchestrate the local infrastructure required to run the Distributed Order Management System.

---

## 📑 Table of Contents
1. [Components Overview](#1-components-overview)
2. [Service Architecture & Port Mappings](#2-service-architecture--port-mappings)
3. [PostgreSQL Multi-Database Initialization](#3-postgresql-multi-database-initialization)
4. [Apache Kafka Configuration (KRaft Mode)](#4-apache-kafka-configuration-kraft-mode)
5. [Observability Tools (Kafka UI & Jaeger)](#5-observability-tools-kafka-ui--jaeger)
6. [Operational Commands (Runbook)](#6-operational-commands-runbook)

---

## 1. Components Overview

Instead of installing multiple native services on your host operating system, Docker Compose spins up containerized instances of:
1. **PostgreSQL 16 (Alpine):** Relational database engine hosting isolated databases for Order, Inventory, and Payment services.
2. **Apache Kafka (KRaft Mode):** Distributed event streaming platform without ZooKeeper.
3. **Kafka UI (Provectus):** Real-time web management interface for browsing topics, consumer groups, offsets, and messages.
4. **Jaeger Tracing (All-in-One):** OpenTelemetry collector and visual flame-graph trace dashboard.

---

## 2. Service Architecture & Port Mappings

| Container Name | Image | Host Port | Internal Port | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `oms-postgres` | `postgres:16-alpine` | `5432` | `5432` | Relational storage for all 3 microservices |
| `oms-kafka` | `apache/kafka:latest` | `9094` | `9092`, `9093`, `9094` | Event broker running in KRaft mode |
| `oms-kafka-ui` | `provectuslabs/kafka-ui:latest` | `8080` | `8080` | Web dashboard for Kafka cluster monitoring |
| `oms-jaeger` | `jaegertracing/all-in-one:1.57` | `16686`, `4318` | `16686`, `4318` | Distributed tracing UI (16686) & OTLP HTTP receiver (4318) |

---

## 3. PostgreSQL Multi-Database Initialization

In production, each microservice connects to an independent, physically separated database cluster. For local development, we run one PostgreSQL container that automatically initializes three isolated databases.

On the container's first boot, PostgreSQL executes all `.sql` scripts placed inside `/docker-entrypoint-initdb.d/`.

### Initializer Script: [docker/init-databases.sql](file:///d:/Projects/distributed-oms/infrastructure/docker/init-databases.sql)
```sql
CREATE DATABASE inventory_db;
CREATE DATABASE payment_db;
```
*(The primary database `order_db` is created automatically by the `POSTGRES_DB` environment variable).*

### Database Connection Strings
- **Order Service:** `postgresql://oms_user:oms_password@localhost:5432/order_db`
- **Inventory Service:** `postgresql://oms_user:oms_password@localhost:5432/inventory_db`
- **Payment Service:** `postgresql://oms_user:oms_password@localhost:5432/payment_db`

---

## 4. Apache Kafka Configuration (KRaft Mode)

Modern Kafka eliminates Apache ZooKeeper by using the **KRaft (Kafka Raft)** consensus protocol.

### Listeners Configuration Explained
Kafka uses distinct listeners so both Docker containers and your host machine can communicate with the broker:
- **`EXTERNAL://localhost:9094`**: Exposed to your laptop. Node.js processes running locally (`pnpm dev`) connect via `localhost:9094`.
- **`PLAINTEXT://kafka:9092`**: Internal Docker bridge network listener. Used by the `oms-kafka-ui` container to talk to `kafka:9092`.
- **`CONTROLLER://:9093`**: Used internally by the Kafka KRaft engine for metadata quorum voting.

### Key Environment Variables in `docker-compose.yml`:
```yaml
KAFKA_NODE_ID: 1
KAFKA_PROCESS_ROLES: 'broker,controller'
KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094'
KAFKA_ADVERTISED_LISTENERS: 'PLAINTEXT://kafka:9092,EXTERNAL://localhost:9094'
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT'
KAFKA_CONTROLLER_QUORUM_VOTERS: '1@kafka:9093'
KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'true'
```

---

## 5. Observability Tools (Kafka UI & Jaeger)

### 1. Kafka UI (`http://localhost:8080`)
- **Dashboard:** Displays broker status, controller health, and active partition distribution.
- **Topics:** Browse `order.events`, `inventory.events`, `payment.events`, and `payment.events.dlq`.
- **Messages:** View individual message JSON payloads, keys, timestamps, and headers (including OpenTelemetry traceparent headers).
- **Consumer Groups:** Check consumer group status and consumer lag in real-time.

### 2. Jaeger Tracing (`http://localhost:16686`)
- **OTLP HTTP Receiver (Port 4318):** All microservices send OpenTelemetry traces to `http://localhost:4318/v1/traces`.
- **Jaeger Web UI (Port 16686):** Search traces by service name (`order-service`, `inventory-service`, `payment-service`) or operation.
- **Flame Graphs:** Inspect waterfall timelines showing end-to-end execution times across HTTP, Kafka, and database operations.

---

## 6. Operational Commands (Runbook)

### Start All Infrastructure
```bash
docker compose up -d
```

### Check Container Status
```bash
docker compose ps
```

### View Live Container Logs
```bash
docker compose logs -f kafka
docker compose logs -f postgres
```

### Stop Infrastructure (Retaining Data)
```bash
docker compose stop
```

### Reset All Data (Clean Slate)
To wipe all PostgreSQL tables and reset Kafka topics/offsets:
```bash
docker compose down -v
```
*(The `-v` flag removes the `pgdata` and `kafkadata` volumes, allowing a clean rebuild on next `docker compose up -d`).*
