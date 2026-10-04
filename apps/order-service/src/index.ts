import Fastify from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { pool } from './db/connection';
import { initDatabase } from './db/init';
import { 
  OrderCreatedEvent, 
  OrderItemSchema,
  KAFKA_TOPICS
} from '@oms/event-contracts';
import { producer } from './kafka';
import { startOutboxRelay } from './outboxRelay';
import { startSagaOrchestrator } from './sagaOrchestrator';
import { initTracer } from '@oms/event-contracts';

initTracer('order-service');

const server = Fastify({ logger: true });

// Native CORS headers without plugin version mismatch
server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-correlation-id');
  if (request.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

// Handle empty or optional request bodies gracefully
server.addContentTypeParser('*', (_request, payload, done) => {
  let data = '';
  payload.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  payload.on('end', () => {
    if (!data || data.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(data));
    } catch {
      done(null, data);
    }
  });
});

import { registerSwagger } from './swagger';

// Register Swagger UI at /docs and OpenAPI JSON at /docs/openapi.json
registerSwagger(server);
const CreateOrderRequestSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  items: z.array(OrderItemSchema).min(1, 'At least one item is required'),
});

const CancelOrderRequestSchema = z.object({
  reason: z.string().optional().default('Cancelled by user or administrator'),
});

// ============================================================================
// HEALTH & STATS ROUTES
// ============================================================================

server.get('/health', async () => {
  return { 
    status: 'healthy', 
    service: 'order-service',
    timestamp: new Date().toISOString()
  };
});

server.get('/api/orders/stats/summary', async (request, reply) => {
  const client = await pool.connect();
  try {
    const statusCounts = await client.query(`
      SELECT status, COUNT(*)::int as count 
      FROM orders 
      GROUP BY status
    `);

    const revenueRes = await client.query(`
      SELECT COALESCE(SUM(total_amount), 0)::numeric as total_revenue, COUNT(*)::int as total_orders
      FROM orders
    `);

    const confirmedRevenueRes = await client.query(`
      SELECT COALESCE(SUM(total_amount), 0)::numeric as confirmed_revenue
      FROM orders
      WHERE status = 'CONFIRMED'
    `);

    const countsByStatus: Record<string, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPENSATING: 0,
      CANCELLED: 0,
    };

    for (const row of statusCounts.rows) {
      countsByStatus[row.status] = row.count;
    }

    return reply.send({
      totalOrders: revenueRes.rows[0].total_orders,
      totalRevenue: Number(revenueRes.rows[0].total_revenue),
      confirmedRevenue: Number(confirmedRevenueRes.rows[0].confirmed_revenue),
      countsByStatus,
    });
  } catch (err) {
    request.log.error(err, 'Failed to fetch order summary stats');
    return reply.status(500).send({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// ============================================================================
// ORDER CRUD & QUERY ROUTES
// ============================================================================

// 1. List Orders (with pagination & filters)
server.get('/api/orders', async (request, reply) => {
  const query = request.query as {
    customerId?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const client = await pool.connect();
  try {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (query.customerId) {
      conditions.push(`customer_id = $${paramIndex++}`);
      values.push(query.customerId);
    }

    if (query.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(query.status.toUpperCase());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await client.query(`SELECT COUNT(*)::int as total FROM orders ${whereClause}`, values);
    const total = countRes.rows[0]?.total || 0;

    const ordersRes = await client.query(`
      SELECT 
        o.id,
        o.customer_id,
        o.status,
        o.total_amount,
        o.currency,
        o.cancellation_reason,
        o.created_at,
        o.updated_at,
        COUNT(i.id)::int as item_count
      FROM orders o
      LEFT JOIN order_items i ON o.id = i.order_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `, [...values, limit, offset]);

    return reply.send({
      total,
      limit,
      offset,
      orders: ordersRes.rows,
    });
  } catch (err) {
    request.log.error(err, 'Failed to list orders');
    return reply.status(500).send({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// 2. Get Single Order by ID (with line items & outbox event status)
server.get('/api/orders/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const client = await pool.connect();
  try {
    const orderRes = await client.query(`
      SELECT * FROM orders WHERE id = $1
    `, [id]);

    if (orderRes.rows.length === 0) {
      return reply.status(404).send({ error: `Order with ID ${id} not found` });
    }

    const order = orderRes.rows[0];

    const itemsRes = await client.query(`
      SELECT id, sku, quantity, unit_price 
      FROM order_items 
      WHERE order_id = $1
      ORDER BY id ASC
    `, [id]);

    const outboxRes = await client.query(`
      SELECT id, event_type, created_at, published_at 
      FROM outbox_events 
      WHERE aggregate_id = $1
      ORDER BY created_at ASC
    `, [id]);

    return reply.send({
      ...order,
      items: itemsRes.rows,
      outboxEvents: outboxRes.rows,
    });
  } catch (err) {
    request.log.error(err, 'Failed to fetch order details');
    return reply.status(500).send({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// 3. Create Order
server.post('/api/orders', async (request, reply) => {
  const parseResult = CreateOrderRequestSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: 'Invalid request body',
      details: parseResult.error.issues,
    });
  }

  const { customerId, items } = parseResult.data;
  const orderId = uuidv4();
  const eventId = uuidv4();
  const correlationId = (request.headers['x-correlation-id'] as string) || uuidv4();

  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice, 
    0
  );

  const orderCreatedEvent: OrderCreatedEvent = {
    eventId,
    eventType: 'OrderCreated',
    aggregateId: orderId,
    correlationId,
    causationId: correlationId,
    timestamp: new Date().toISOString(),
    version: 1,
    producer: 'order-service',
    payload: {
      orderId,
      customerId,
      items,
      totalAmount,
      currency: 'INR',
    },
  };

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO orders (id, customer_id, status, total_amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, customerId, 'PENDING', totalAmount, 'INR']
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (id, order_id, sku, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), orderId, item.sku, item.quantity, item.unitPrice]
      );
    }

    await client.query(
      `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, headers)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventId,
        'Order',
        orderId,
        'OrderCreated',
        JSON.stringify(orderCreatedEvent),
        JSON.stringify({ correlationId }),
      ]
    );

    await client.query('COMMIT');

    return reply.status(201).send({
      orderId,
      status: 'PENDING',
      totalAmount,
      currency: 'INR',
      correlationId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    request.log.error(err, 'Failed to create order');
    return reply.status(500).send({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// 4. Cancel Order (User or Admin initiated cancellation)
server.post('/api/orders/:id/cancel', async (request, reply) => {
  const { id } = request.params as { id: string };
  const parseResult = CancelOrderRequestSchema.safeParse(request.body || {});
  const reason = parseResult.success ? parseResult.data.reason : 'Cancelled by user';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply.status(404).send({ error: `Order with ID ${id} not found` });
    }

    const order = orderRes.rows[0];

    if (order.status === 'CANCELLED') {
      await client.query('ROLLBACK');
      return reply.status(400).send({ 
        error: 'Order is already cancelled',
        currentStatus: order.status,
        cancellationReason: order.cancellation_reason
      });
    }

    if (order.status === 'COMPENSATING') {
      await client.query('ROLLBACK');
      return reply.status(400).send({ 
        error: 'Order is already undergoing compensation rollback',
        currentStatus: order.status
      });
    }

    const eventId = uuidv4();
    const correlationId = (request.headers['x-correlation-id'] as string) || uuidv4();

    // If order was CONFIRMED or PENDING, trigger inventory release via Kafka
    if (order.status === 'CONFIRMED' || order.status === 'PENDING') {
      const newStatus = order.status === 'CONFIRMED' ? 'COMPENSATING' : 'CANCELLED';

      await client.query(
        `UPDATE orders 
         SET status = $1, cancellation_reason = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newStatus, reason, id]
      );

      // Construct release request for Inventory Service
      const releaseEvent = {
        eventId,
        eventType: 'InventoryReleaseRequested',
        aggregateId: id,
        correlationId,
        causationId: id,
        timestamp: new Date().toISOString(),
        version: 1,
        producer: 'order-service',
        payload: {
          orderId: id,
          reason,
        },
      };

      await client.query(
        `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, headers)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          eventId,
          'Order',
          id,
          'InventoryReleaseRequested',
          JSON.stringify(releaseEvent),
          JSON.stringify({ correlationId }),
        ]
      );
    }

    await client.query('COMMIT');

    return reply.send({
      orderId: id,
      message: 'Order cancellation initiated successfully',
      reason,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    request.log.error(err, `Failed to cancel order ${id}`);
    return reply.status(500).send({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

async function start() {
  try {
    // 1. Initialize Database Schema
    await initDatabase();

    // 2. Connect Kafka Producer
    await producer.connect();
    console.log('[Kafka] Producer connected to cluster.');

    // 3. Start Background Outbox Poller
    startOutboxRelay(1000);

    // 4. Start HTTP Server
    await server.listen({ port: 3001, host: '0.0.0.0' });
    console.log('[Server] Order Service listening on http://localhost:3001');

    // 5. Start Saga Orchestrator Consumer
    await startSagaOrchestrator();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();