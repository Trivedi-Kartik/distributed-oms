import { pool } from './connection';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        customer_id VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL, -- PENDING, INVENTORY_HOLD, CONFIRMED, COMPENSATING, CANCELLED
        total_amount NUMERIC(12, 2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'INR',
        cancellation_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        sku VARCHAR(100) NOT NULL,
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price > 0)
      );

      CREATE TABLE IF NOT EXISTS outbox_events (
        id UUID PRIMARY KEY,
        aggregate_type VARCHAR(50) NOT NULL,
        aggregate_id VARCHAR(100) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        headers JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        published_at TIMESTAMPTZ NULL,
        retry_count INT DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_unpublished 
      ON outbox_events (created_at) 
      WHERE published_at IS NULL;
    `);

    // Ensure cancellation_reason column exists if table was created earlier
    await client.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
    `);

    console.log('[DB] Order Service schema up to date.');
  } finally {
    client.release();
  }
}