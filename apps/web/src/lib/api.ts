import {
  Order,
  OrderSummaryStats,
  InventoryItem,
  InventorySummary,
  Reservation,
  PaymentRecord,
  PaymentStats,
  ProcessedEvent,
  ServiceHealth,
} from './types';

export const ORDER_API_URL = process.env.NEXT_PUBLIC_ORDER_API_URL || 'http://localhost:3001';
export const INVENTORY_API_URL = process.env.NEXT_PUBLIC_INVENTORY_API_URL || 'http://localhost:3002';
export const PAYMENT_API_URL = process.env.NEXT_PUBLIC_PAYMENT_API_URL || 'http://localhost:3003';

// ============================================================================
// HEALTH MONITORING
// ============================================================================

export async function checkServicesHealth(): Promise<ServiceHealth> {
  const checkService = async (url: string) => {
    const start = performance.now();
    try {
      const res = await fetch(`${url}/health`, { method: 'GET', cache: 'no-store' });
      const elapsed = Math.round(performance.now() - start);
      return { ok: res.ok, elapsed };
    } catch {
      return { ok: false, elapsed: 0 };
    }
  };

  const [order, inventory, payment] = await Promise.all([
    checkService(ORDER_API_URL),
    checkService(INVENTORY_API_URL),
    checkService(PAYMENT_API_URL),
  ]);

  return {
    orderService: order.ok,
    inventoryService: inventory.ok,
    paymentService: payment.ok,
    latencyMs: {
      orderService: order.elapsed,
      inventoryService: inventory.elapsed,
      paymentService: payment.elapsed,
    },
    lastChecked: new Date().toLocaleTimeString(),
  };
}

// ============================================================================
// ORDER SERVICE API CALLS (:3001)
// ============================================================================

export async function fetchOrderSummaryStats(): Promise<OrderSummaryStats> {
  const res = await fetch(`${ORDER_API_URL}/api/orders/stats/summary`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch order statistics');
  return res.json();
}

export async function fetchOrders(status?: string, limit = 50, offset = 0): Promise<{ total: number; orders: Order[] }> {
  const params = new URLSearchParams();
  if (status && status !== 'ALL') params.append('status', status);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const res = await fetch(`${ORDER_API_URL}/api/orders?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch orders');
  return res.json();
}

export async function fetchOrderById(id: string): Promise<Order> {
  const res = await fetch(`${ORDER_API_URL}/api/orders/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch order ${id}`);
  return res.json();
}

export async function createOrder(payload: { customerId: string; items: { sku: string; quantity: number; unitPrice: number }[] }) {
  const res = await fetch(`${ORDER_API_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create order');
  }
  return res.json();
}

export async function cancelOrder(id: string, reason?: string) {
  const res = await fetch(`${ORDER_API_URL}/api/orders/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || 'Cancelled by user from Control Center' }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to cancel order');
  }
  return res.json();
}

// ============================================================================
// INVENTORY SERVICE API CALLS (:3002)
// ============================================================================

export async function fetchInventory(): Promise<{ summary: InventorySummary; items: InventoryItem[] }> {
  const res = await fetch(`${INVENTORY_API_URL}/api/inventory`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch inventory catalog');
  return res.json();
}

export async function fetchSingleInventoryItem(sku: string): Promise<InventoryItem> {
  const res = await fetch(`${INVENTORY_API_URL}/api/inventory/${sku}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch SKU ${sku}`);
  return res.json();
}

export async function restockSku(sku: string, quantityToAdd: number) {
  const res = await fetch(`${INVENTORY_API_URL}/api/inventory/${sku}/restock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantityToAdd }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to restock item');
  }
  return res.json();
}

export async function createProduct(product: { sku: string; name: string; availableQuantity: number }) {
  const res = await fetch(`${INVENTORY_API_URL}/api/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to register product');
  }
  return res.json();
}

export async function fetchReservations(orderId?: string): Promise<{ reservations: Reservation[] }> {
  const url = orderId 
    ? `${INVENTORY_API_URL}/api/inventory/reservations/${orderId}`
    : `${INVENTORY_API_URL}/api/inventory/reservations`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch reservations');
  return res.json();
}

// ============================================================================
// PAYMENT SERVICE API CALLS (:3003)
// ============================================================================

export async function fetchPaymentStats(): Promise<PaymentStats> {
  const res = await fetch(`${PAYMENT_API_URL}/api/payments/stats`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch payment statistics');
  return res.json();
}

export async function fetchPayments(status?: string): Promise<{ total: number; payments: PaymentRecord[] }> {
  const params = new URLSearchParams();
  if (status && status !== 'ALL') params.append('status', status);

  const res = await fetch(`${PAYMENT_API_URL}/api/payments?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch payments ledger');
  return res.json();
}

export async function fetchProcessedEvents(): Promise<{ count: number; events: ProcessedEvent[] }> {
  const res = await fetch(`${PAYMENT_API_URL}/api/payments/processed-events`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch processed events audit log');
  return res.json();
}

export async function triggerDlqReplay(): Promise<{ message: string; replayedCount: number; replayedMessages: any[] }> {
  const res = await fetch(`${PAYMENT_API_URL}/api/payments/dlq/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to replay DLQ');
  }
  return res.json();
}

// ============================================================================
// COMPATIBILITY ALIASES
// ============================================================================
export const restockInventory = restockSku;
export const createInventoryItem = createProduct;
export const fetchInventoryReservations = fetchReservations;
export const checkSystemHealth = checkServicesHealth;

