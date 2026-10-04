import { FastifyInstance } from 'fastify';

export const orderOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Order Service API',
    description: 'Order Management, Transactional Outbox, and Saga Orchestration APIs for Distributed OMS.',
    version: '1.0.0',
    contact: {
      name: 'Distributed OMS Team',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local Order Service Instance',
    },
  ],
  tags: [
    { name: 'System', description: 'Health and service diagnostics' },
    { name: 'Analytics', description: 'Order volume and revenue statistics' },
    { name: 'Orders', description: 'Order creation, retrieval, and Saga cancellation' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns health status and timestamp of the Order Service.',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    service: { type: 'string', example: 'order-service' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/orders/stats/summary': {
      get: {
        tags: ['Analytics'],
        summary: 'Order statistics and revenue summary',
        description: 'Retrieves total orders, total revenue, confirmed revenue, and order counts grouped by status.',
        responses: {
          '200': {
            description: 'Aggregated order statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalOrders: { type: 'integer', example: 12 },
                    totalRevenue: { type: 'number', example: 4500000 },
                    confirmedRevenue: { type: 'number', example: 1500000 },
                    countsByStatus: {
                      type: 'object',
                      properties: {
                        PENDING: { type: 'integer', example: 1 },
                        CONFIRMED: { type: 'integer', example: 5 },
                        COMPENSATING: { type: 'integer', example: 0 },
                        CANCELLED: { type: 'integer', example: 6 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List orders with filtering and pagination',
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Filter by order status',
            required: false,
            schema: {
              type: 'string',
              enum: ['PENDING', 'CONFIRMED', 'COMPENSATING', 'CANCELLED'],
            },
          },
          {
            name: 'customerId',
            in: 'query',
            description: 'Filter by customer identifier',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of orders to return (1-100, default: 20)',
            required: false,
            schema: { type: 'integer', default: 20 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Number of orders to skip (default: 0)',
            required: false,
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated list of orders',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 5 },
                    limit: { type: 'integer', example: 20 },
                    offset: { type: 'integer', example: 0 },
                    orders: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/OrderSummary' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Orders'],
        summary: 'Create a new order',
        description: 'Saves the order and line items to PostgreSQL, creates an outbox event in the same transaction, and triggers Saga orchestration.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateOrderRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order successfully created in PENDING state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orderId: { type: 'string', format: 'uuid' },
                    status: { type: 'string', example: 'PENDING' },
                    totalAmount: { type: 'number', example: 150000 },
                    currency: { type: 'string', example: 'INR' },
                    correlationId: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error in request payload',
          },
        },
      },
    },
    '/api/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get single order details by ID',
        description: 'Retrieves order metadata, associated line items, and outbox event publication history.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Order UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Order details with line items and outbox events',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderDetail' },
              },
            },
          },
          '404': {
            description: 'Order not found',
          },
        },
      },
    },
    '/api/orders/{id}/cancel': {
      post: {
        tags: ['Orders'],
        summary: 'Cancel an order',
        description: 'Manually initiates order cancellation. If the order was confirmed or pending, publishes an InventoryReleaseRequested event via the outbox to return reserved stock to available inventory.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Order UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', example: 'Customer requested cancellation' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Cancellation initiated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orderId: { type: 'string', format: 'uuid' },
                    message: { type: 'string', example: 'Order cancellation initiated successfully' },
                    reason: { type: 'string', example: 'Customer requested cancellation' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Order already cancelled or undergoing compensation',
          },
          '404': {
            description: 'Order not found',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      OrderItem: {
        type: 'object',
        required: ['sku', 'quantity', 'unitPrice'],
        properties: {
          sku: { type: 'string', example: 'macbook-m3' },
          quantity: { type: 'integer', minimum: 1, example: 1 },
          unitPrice: { type: 'number', minimum: 0.01, example: 150000 },
        },
      },
      CreateOrderRequest: {
        type: 'object',
        required: ['customerId', 'items'],
        properties: {
          customerId: { type: 'string', example: 'cust-alice' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderItem' },
            example: [{ sku: 'macbook-m3', quantity: 1, unitPrice: 150000 }],
          },
        },
      },
      OrderSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          customer_id: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'COMPENSATING', 'CANCELLED'] },
          total_amount: { type: 'string', example: '150000.00' },
          currency: { type: 'string', example: 'INR' },
          cancellation_reason: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          item_count: { type: 'integer', example: 1 },
        },
      },
      OrderDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          customer_id: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'COMPENSATING', 'CANCELLED'] },
          total_amount: { type: 'string', example: '150000.00' },
          currency: { type: 'string', example: 'INR' },
          cancellation_reason: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                sku: { type: 'string' },
                quantity: { type: 'integer' },
                unit_price: { type: 'string' },
              },
            },
          },
          outboxEvents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                event_type: { type: 'string' },
                created_at: { type: 'string', format: 'date-time' },
                published_at: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
      },
    },
  },
};

export function registerSwagger(server: FastifyInstance) {
  // OpenAPI Specification JSON
  server.get('/docs/openapi.json', async () => {
    return orderOpenApiSpec;
  });

  // Interactive Swagger UI HTML Page
  server.get('/docs', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Order Service API Documentation — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.18.2/favicon-32x32.png" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none !important; }
    .custom-header {
      background: #1e293b;
      color: #fff;
      padding: 16px 32px;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .custom-header a {
      color: #38bdf8;
      text-decoration: none;
      font-size: 14px;
      margin-left: 16px;
    }
    .custom-header a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="custom-header">
    <span>🛒 Order Service API — Distributed OMS</span>
    <div>
      <a href="/docs/openapi.json" target="_blank">View OpenAPI JSON</a>
      <a href="http://localhost:3002/docs">Inventory Docs (3002)</a>
      <a href="http://localhost:3003/docs">Payment Docs (3003)</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
    return reply.type('text/html').send(html);
  });
}
