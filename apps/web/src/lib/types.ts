export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'COMPENSATING' | 'CANCELLED';

export interface OrderItem {
  id?: string;
  sku: string;
  quantity: number;
  unit_price?: string | number;
  unitPrice?: number;
}

export interface OutboxEventRecord {
  id: string;
  event_type: string;
  created_at: string;
  published_at: string | null;
}

export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
  items?: OrderItem[];
  outboxEvents?: OutboxEventRecord[];
}

export interface OrderSummaryStats {
  totalOrders: number;
  totalRevenue: number;
  confirmedRevenue: number;
  countsByStatus: {
    PENDING: number;
    CONFIRMED: number;
    COMPENSATING: number;
    CANCELLED: number;
  };
}

export interface InventoryItem {
  sku: string;
  name: string;
  available_quantity: number;
  reserved_quantity: number;
  updated_at: string;
}

export interface InventorySummary {
  total_skus: number;
  total_available_units: number;
  total_reserved_units: number;
}

export interface Reservation {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
  status: 'RESERVED' | 'RELEASED' | 'CONFIRMED';
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  status: 'AUTHORIZED' | 'FAILED';
  created_at: string;
}

export interface PaymentStats {
  totalProcessedEvents: number;
  authorized: {
    count: number;
    volume: number;
  };
  failed: {
    count: number;
    volume: number;
  };
  totalVolume: number;
}

export interface ProcessedEvent {
  event_id: string;
  consumer_name: string;
  processed_at: string;
}

export interface ServiceHealth {
  orderService: boolean;
  inventoryService: boolean;
  paymentService: boolean;
  latencyMs: {
    orderService: number;
    inventoryService: number;
    paymentService: number;
  };
  lastChecked: string;
}
