import { Pool } from 'pg';

// ============================================================================
// POSTGRES CONNECTION POOL
// ============================================================================
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'oms_user',
  password: process.env.DB_PASSWORD || 'oms_password',
  database: process.env.DB_NAME || 'order_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});