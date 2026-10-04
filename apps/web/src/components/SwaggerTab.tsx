'use client';

import React from 'react';
import { 
  FileCode2, 
  ExternalLink, 
  Layers, 
  ShieldCheck, 
  Server, 
  Download, 
  CheckCircle2, 
  Box, 
  Database,
  Workflow,
  Sparkles
} from 'lucide-react';

export default function SwaggerTab() {
  const services = [
    {
      name: 'Order Service',
      port: 3001,
      badge: 'Core Saga Orchestrator',
      color: 'cyan',
      description: 'Handles order placement, transactional outbox pattern, compensation rollback workflows, and order status transitions.',
      swaggerUrl: 'http://localhost:3001/docs',
      openapiJson: 'http://localhost:3001/docs/openapi.json',
      endpoints: [
        { method: 'POST', path: '/orders', desc: 'Create a new order & emit OrderCreated to Kafka', tags: 'Orders' },
        { method: 'GET', path: '/orders', desc: 'List all orders with customer details & status', tags: 'Orders' },
        { method: 'GET', path: '/orders/:id', desc: 'Retrieve single order with line items & saga state', tags: 'Orders' },
        { method: 'POST', path: '/orders/:id/cancel', desc: 'Cancel order and trigger compensation cascade', tags: 'Orders' },
        { method: 'GET', path: '/health', desc: 'Liveness & readiness probe for Order Service', tags: 'System' },
        { method: 'GET', path: '/docs', desc: 'Fastify Swagger UI Interactive API Explorer', tags: 'Docs' }
      ]
    },
    {
      name: 'Inventory Service',
      port: 3002,
      badge: 'Stock & Allocation Catalog',
      color: 'purple',
      description: 'Provides pessimistic locking stock reservations, concurrency-safe decrements, restock replenishments, and SKU registration.',
      swaggerUrl: 'http://localhost:3002/docs',
      openapiJson: 'http://localhost:3002/docs/openapi.json',
      endpoints: [
        { method: 'GET', path: '/inventory', desc: 'Get all products, stock levels, and allocation states', tags: 'Inventory' },
        { method: 'GET', path: '/inventory/:sku', desc: 'Query stock level for specific SKU', tags: 'Inventory' },
        { method: 'POST', path: '/inventory', desc: 'Create a new product SKU in database', tags: 'Inventory' },
        { method: 'POST', path: '/inventory/:sku/restock', desc: 'Add quantity to existing inventory SKU', tags: 'Inventory' },
        { method: 'POST', path: '/inventory/reserve', desc: 'Pessimistic lock reservation for order checkout', tags: 'Inventory' },
        { method: 'GET', path: '/inventory/reservations', desc: 'Audit table of active and released reservations', tags: 'Inventory' },
        { method: 'GET', path: '/health', desc: 'Liveness & DB connection probe', tags: 'System' },
        { method: 'GET', path: '/docs', desc: 'Interactive Swagger UI documentation', tags: 'Docs' }
      ]
    },
    {
      name: 'Payment Service',
      port: 3003,
      badge: 'Resilient Payment Gateway & DLQ',
      color: 'emerald',
      description: 'Deduplicated Kafka consumer, idempotent payment settlements, payment ledger audits, and dead letter queue (DLQ) replay triggers.',
      swaggerUrl: 'http://localhost:3003/docs',
      openapiJson: 'http://localhost:3003/docs/openapi.json',
      endpoints: [
        { method: 'GET', path: '/payments', desc: 'Fetch all processed transactions and authorization codes', tags: 'Payments' },
        { method: 'GET', path: '/payments/:id', desc: 'Retrieve single payment record by ID', tags: 'Payments' },
        { method: 'GET', path: '/payments/order/:orderId', desc: 'Find payment matching specific order ID', tags: 'Payments' },
        { method: 'POST', path: '/payments/dlq/replay', desc: 'Trigger automated Dead Letter Queue replay sweep', tags: 'Operations' },
        { method: 'GET', path: '/payments/idempotency/events', desc: 'Inspect idempotency deduplication key cache', tags: 'Audit' },
        { method: 'GET', path: '/health', desc: 'Payment service health and Kafka consumer state', tags: 'System' },
        { method: 'GET', path: '/docs', desc: 'Interactive Swagger UI documentation', tags: 'Docs' }
      ]
    }
  ];

  return (
    <div className="space-y-8">
      {/* Top Intro Banner */}
      <div className="glass-card p-6 border-slate-800 bg-gradient-to-r from-cyan-950/30 via-slate-900 to-purple-950/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <FileCode2 className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Interactive Microservice Swagger & OpenAPI Hub
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            All 3 microservices expose full OpenAPI 3.0 specification documents and interactive Fastify Swagger UIs. 
            You can test live payload schemas, trigger endpoints directly in the browser, or import the unified OpenAPI document into Postman, Insomnia, or Bruno.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="http://localhost:3001/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-950/40 transition-all cursor-pointer"
          >
            <span>Launch Order Docs</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="http://localhost:3002/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-medium text-xs shadow-lg shadow-purple-950/40 transition-all cursor-pointer"
          >
            <span>Launch Inventory Docs</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="http://localhost:3003/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium text-xs shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
          >
            <span>Launch Payment Docs</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 3 Service Swagger Explorer Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {services.map((svc) => (
          <div key={svc.name} className="glass-card flex flex-col justify-between p-5 border-slate-800 hover:border-slate-700 transition-all">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-bold text-white text-base">{svc.name}</h3>
                  </div>
                  <span className="text-2xs font-mono text-slate-400 mt-1 block">
                    Port: <span className="text-cyan-400 font-semibold">{svc.port}</span>
                  </span>
                </div>
                <span className="text-2xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium">
                  {svc.badge}
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed min-h-[48px]">
                {svc.description}
              </p>

              {/* Endpoint Highlights */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider block">
                  API Routes
                </span>
                <div className="space-y-1.5">
                  {svc.endpoints.map((ep, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-2xs p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            ep.method === 'GET'
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : ep.method === 'POST'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {ep.method}
                        </span>
                        <span className="text-slate-300">{ep.path}</span>
                      </div>
                      <span className="text-slate-500 text-3xs">{ep.tags}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-5 mt-4 border-t border-slate-800/80 flex items-center gap-2">
              <a
                href={svc.swaggerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition-colors cursor-pointer"
              >
                <span>Live Swagger UI</span>
                <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
              </a>
              <a
                href={svc.openapiJson}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
                title="View Raw OpenAPI 3.0 JSON"
              >
                <FileCode2 className="w-4 h-4 text-slate-400" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* OpenAPI Architecture Notes & Postman Integration */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Workflow className="w-4 h-4 text-purple-400" />
          Enterprise API Standards & OpenAPI Integration
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Auto-Generated OpenAPI 3.0
            </h4>
            <p className="text-2xs text-slate-400 leading-relaxed">
              Every route leverages strict Fastify JSON Schema validation (`body`, `params`, `response`). The Swagger UI and JSON specs update automatically as code evolves.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              CORS Enabled for Web Clients
            </h4>
            <p className="text-2xs text-slate-400 leading-relaxed">
              Native CORS headers (`Access-Control-Allow-Origin: *`, `Methods: GET, POST, PUT, DELETE, OPTIONS`) are active across all 3 services for seamless frontend integration.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Postman & Bruno Ready
            </h4>
            <p className="text-2xs text-slate-400 leading-relaxed">
              Directly import unified documentation located at <code className="text-cyan-400 font-mono">docs/openapi/unified-oms-openapi.json</code> to test end-to-end Saga traces.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
