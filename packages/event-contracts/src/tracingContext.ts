import { context, propagation, defaultTextMapGetter, defaultTextMapSetter } from '@opentelemetry/api';

// 1. Injects current trace ID into Kafka message headers
export function injectTraceHeaders(headers: Record<string, any> = {}): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier, defaultTextMapSetter);
  return { ...headers, ...carrier };
}

// 2. Extracts trace ID from incoming Kafka message headers
export function extractTraceContext(headers: Record<string, any> = {}) {
  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      carrier[key] = Buffer.isBuffer(value) ? value.toString() : String(value);
    }
  }
  return propagation.extract(context.active(), carrier, defaultTextMapGetter);
}