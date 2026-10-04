import { FastifyInstance } from 'fastify';

export const paymentOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Payment Service API',
    description: 'Payment authorization, transaction ledger, idempotency deduplication, and DLQ management APIs for Distributed OMS.',
    version: '1.0.0',
    contact: {
      name: 'Distributed OMS Team',
    },
  },
  servers: [
    {
      url: 'http://localhost:3003',
      description: 'Local Payment Service Instance',
    },
  ],
  tags: [
    { name: 'System', description: 'Health and service diagnostics' },
    { name: 'Analytics', description: 'Transaction volume and authorization metrics' },
    { name: 'Payments', description: 'Payment records and transaction querying' },
    { name: 'Resilience', description: 'Idempotency audit and Dead Letter Queue (DLQ) operations' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns health status and timestamp of the Payment Service.',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    service: { type: 'string', example: 'payment-service' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/payments/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Payment statistics and volume summary',
        description: 'Aggregates counts and total transaction volume for authorized vs. failed payments.',
        responses: {
          '200': {
            description: 'Aggregated transaction statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalProcessedEvents: { type: 'integer', example: 8 },
                    authorized: {
                      type: 'object',
                      properties: {
                        count: { type: 'integer', example: 5 },
                        volume: { type: 'number', example: 630000 },
                      },
                    },
                    failed: {
                      type: 'object',
                      properties: {
                        count: { type: 'integer', example: 2 },
                        volume: { type: 'number', example: 1200000 },
                      },
                    },
                    totalVolume: { type: 'number', example: 1830000 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payment transactions',
        description: 'Retrieves payment records with optional filtering by orderId or status (AUTHORIZED, FAILED).',
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Filter by payment status',
            required: false,
            schema: { type: 'string', enum: ['AUTHORIZED', 'FAILED'] },
          },
          {
            name: 'orderId',
            in: 'query',
            description: 'Filter by order UUID',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of records to return (default: 50)',
            required: false,
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Offset for pagination (default: 0)',
            required: false,
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'List of payment records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 5 },
                    limit: { type: 'integer', example: 20 },
                    offset: { type: 'integer', example: 0 },
                    payments: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Payment' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/payments/{id}': {
      get: {
        tags: ['Payments'],
        summary: 'Get single payment by payment ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Payment UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Payment transaction record',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Payment' },
              },
            },
          },
          '404': { description: 'Payment not found' },
        },
      },
    },
    '/api/payments/order/{orderId}': {
      get: {
        tags: ['Payments'],
        summary: 'Get payment records for a specific order',
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            description: 'Order UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Payments found for this order',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orderId: { type: 'string', format: 'uuid' },
                    payments: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Payment' },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'No payments found for this order' },
        },
      },
    },
    '/api/payments/processed-events': {
      get: {
        tags: ['Resilience'],
        summary: 'List processed event audit log (Idempotency Store)',
        description: 'Returns the eventId values tracked by PostgreSQL unique constraint to prevent duplicate processing.',
        responses: {
          '200': {
            description: 'Audit log of deduplicated event IDs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', example: 8 },
                    events: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          event_id: { type: 'string', format: 'uuid' },
                          consumer_name: { type: 'string', example: 'payment-service' },
                          processed_at: { type: 'string', format: 'date-time' },
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
    },
    '/api/payments/dlq/replay': {
      post: {
        tags: ['Resilience'],
        summary: 'Trigger Dead Letter Queue (DLQ) replay',
        description: 'Scans payment.events.dlq from offset 0, extracts original messages, appends x-replayed audit headers, and safely re-injects them into their original Kafka topics.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': {
            description: 'DLQ replay execution summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'DLQ replay complete. 2 message(s) replayed.' },
                    replayedCount: { type: 'integer', example: 2 },
                    replayedMessages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          originalTopic: { type: 'string' },
                          orderId: { type: 'string' },
                          reason: { type: 'string' },
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
    },
  },
  components: {
    schemas: {
      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          order_id: { type: 'string', format: 'uuid' },
          amount: { type: 'string', example: '150000.00' },
          currency: { type: 'string', example: 'INR' },
          status: { type: 'string', enum: ['AUTHORIZED', 'FAILED'], example: 'AUTHORIZED' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

export function registerSwagger(server: FastifyInstance) {
  // OpenAPI Specification JSON
  server.get('/docs/openapi.json', async () => {
    return paymentOpenApiSpec;
  });

  // Interactive Swagger UI HTML Page
  server.get('/docs', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Payment Service API Documentation — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.18.2/favicon-32x32.png" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none !important; }
    .custom-header {
      background: #4338ca;
      color: #fff;
      padding: 16px 32px;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .custom-header a {
      color: #c7d2fe;
      text-decoration: none;
      font-size: 14px;
      margin-left: 16px;
    }
    .custom-header a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="custom-header">
    <span>💳 Payment Service API — Distributed OMS</span>
    <div>
      <a href="/docs/openapi.json" target="_blank">View OpenAPI JSON</a>
      <a href="http://localhost:3001/docs">Order Docs (3001)</a>
      <a href="http://localhost:3002/docs">Inventory Docs (3002)</a>
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
