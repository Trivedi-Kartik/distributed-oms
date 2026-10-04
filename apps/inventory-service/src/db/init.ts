import { pool } from './connection';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Inventory Table
      CREATE TABLE IF NOT EXISTS inventory (
        sku VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        available_quantity INT NOT NULL CHECK (available_quantity >= 0),
        reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Reservations Table (Tracks allocations per order for Saga compensation)
      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL,
        sku VARCHAR(100) NOT NULL REFERENCES inventory(sku),
        quantity INT NOT NULL,
        status VARCHAR(50) NOT NULL, -- RESERVED, RELEASED, CONFIRMED
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Pre-seed some inventory items if they do not exist
      INSERT INTO inventory (sku, name, available_quantity, reserved_quantity)
      VALUES 
        ('macbook-m3', 'Apple MacBook Pro M3', 5, 0),
        ('keyboard-mech', 'Mechanical Gaming Keyboard', 10, 0)
      ON CONFLICT (sku) DO NOTHING;
    `);

    console.log('[DB] Inventory Service database schema & seed initialized.');
  } finally {
    client.release();
  }
}