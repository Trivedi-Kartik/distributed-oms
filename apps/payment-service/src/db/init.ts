import { pool } from './connection';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Idempotency deduplication table
      CREATE TABLE IF NOT EXISTS processed_events (
        event_id UUID PRIMARY KEY,
        consumer_name VARCHAR(100) NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Payments table
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(50) NOT NULL, -- AUTHORIZED, FAILED
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('[DB] Payment Service schema initialized.');
  } finally {
    client.release();
  }
}