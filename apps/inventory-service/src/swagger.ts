import { FastifyInstance } from 'fastify';

export const inventoryOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Inventory Service API',
    description: 'Warehouse catalog, stock allocation, pessimistic locking, and reservation APIs for Distributed OMS.',
    version: '1.0.0',
    contact: {
      name: 'Distributed OMS Team',
    },
  },
  servers: [
    {
      url: 'http://localhost:3002',
      description: 'Local Inventory Service Instance',
    },
  ],
  tags: [
    { name: 'System', description: 'Health and service diagnostics' },
    { name: 'Catalog', description: 'Stock levels, product creation, and restocking' },
    { name: 'Reservations', description: 'Order-level stock allocation and compensation tracking' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns health status and timestamp of the Inventory Service.',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    service: { type: 'string', example: 'inventory-service' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/inventory': {
      get: {
        tags: ['Catalog'],
        summary: 'List all inventory items and stock summary',
        description: 'Returns total SKUs, aggregated available and reserved counts, and individual product details.',
        responses: {
          '200': {
            description: 'Inventory catalog listing',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    summary: {
                      type: 'object',
                      properties: {
                        total_skus: { type: 'integer', example: 2 },
                        total_available_units: { type: 'integer', example: 20 },
                        total_reserved_units: { type: 'integer', example: 5 },
                      },
                    },
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/InventoryItem' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Catalog'],
        summary: 'Create a new product SKU',
        description: 'Registers a new SKU in the warehouse catalog with an initial available quantity.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProductRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Product successfully created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InventoryItem' },
              },
            },
          },
          '400': { description: 'Validation error' },
          '409': { description: 'SKU already exists' },
        },
      },
    },
    '/api/inventory/{sku}': {
      get: {
        tags: ['Catalog'],
        summary: 'Get single product stock details by SKU',
        parameters: [
          {
            name: 'sku',
            in: 'path',
            required: true,
            description: 'Product SKU identifier',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Product stock details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InventoryItem' },
              },
            },
          },
          '404': { description: 'SKU not found' },
        },
      },
    },
    '/api/inventory/{sku}/restock': {
      post: {
        tags: ['Catalog'],
        summary: 'Restock an existing SKU',
        description: 'Atomically increments available_quantity for the specified SKU using a database transaction.',
        parameters: [
          {
            name: 'sku',
            in: 'path',
            required: true,
            description: 'Product SKU identifier',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RestockProductRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Product successfully restocked',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: "Successfully restocked 10 units of 'macbook-m3'" },
                    item: { $ref: '#/components/schemas/InventoryItem' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid restock quantity' },
          '404': { description: 'SKU not found' },
        },
      },
    },
    '/api/inventory/reservations': {
      get: {
        tags: ['Reservations'],
        summary: 'List stock reservations',
        description: 'Lists all stock allocations with optional filtering by orderId or status.',
        parameters: [
          {
            name: 'orderId',
            in: 'query',
            description: 'Filter by order UUID',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by reservation status (RESERVED, RELEASED, CONFIRMED)',
            required: false,
            schema: { type: 'string', enum: ['RESERVED', 'RELEASED', 'CONFIRMED'] },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of items to return (default: 50)',
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
            description: 'List of reservations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                    reservations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Reservation' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/inventory/reservations/{orderId}': {
      get: {
        tags: ['Reservations'],
        summary: 'Get stock reservations for a specific order',
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
            description: 'Order reservation records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orderId: { type: 'string', format: 'uuid' },
                    reservations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Reservation' },
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
      InventoryItem: {
        type: 'object',
        properties: {
          sku: { type: 'string', example: 'macbook-m3' },
          name: { type: 'string', example: 'Apple MacBook Pro M3' },
          available_quantity: { type: 'integer', example: 10 },
          reserved_quantity: { type: 'integer', example: 5 },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateProductRequest: {
        type: 'object',
        required: ['sku', 'name'],
        properties: {
          sku: { type: 'string', example: 'airpods-pro' },
          name: { type: 'string', example: 'Apple AirPods Pro 2' },
          availableQuantity: { type: 'integer', minimum: 0, default: 0, example: 25 },
        },
      },
      RestockProductRequest: {
        type: 'object',
        required: ['quantityToAdd'],
        properties: {
          quantityToAdd: { type: 'integer', minimum: 1, example: 10 },
        },
      },
      Reservation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          order_id: { type: 'string', format: 'uuid' },
          sku: { type: 'string', example: 'macbook-m3' },
          quantity: { type: 'integer', example: 1 },
          status: { type: 'string', enum: ['RESERVED', 'RELEASED', 'CONFIRMED'], example: 'RELEASED' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

export function registerSwagger(server: FastifyInstance) {
  // OpenAPI Specification JSON
  server.get('/docs/openapi.json', async () => {
    return inventoryOpenApiSpec;
  });

  // Interactive Swagger UI HTML Page
  server.get('/docs', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Inventory Service API Documentation — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.18.2/favicon-32x32.png" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none !important; }
    .custom-header {
      background: #0f766e;
      color: #fff;
      padding: 16px 32px;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .custom-header a {
      color: #99f6e4;
      text-decoration: none;
      font-size: 14px;
      margin-left: 16px;
    }
    .custom-header a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="custom-header">
    <span>📦 Inventory Service API — Distributed OMS</span>
    <div>
      <a href="/docs/openapi.json" target="_blank">View OpenAPI JSON</a>
      <a href="http://localhost:3001/docs">Order Docs (3001)</a>
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
