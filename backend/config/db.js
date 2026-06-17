import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sslConfig = process.env.DATABASE_URL?.includes('aiven')
  ? {
      ca: fs.readFileSync(path.join(__dirname, 'ca.pem')).toString(),
      rejectUnauthorized: true,
    }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/invoice_db',
  ssl: sslConfig,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err);
});

/**
 * Executes a callback block within a database transaction.
 * Automatically injects the tenant_id into the session context to satisfy PostgreSQL Row-Level Security (RLS).
 *
 * @param {string|null} tenantId
 * @param {function(pg.Client): Promise<any>} callback
 * @returns {Promise<any>}
 */
export const runInTransaction = async (tenantId, callback) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (tenantId) {
      await client.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [tenantId]
      );
    }

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Executes a callback within a transaction WITHOUT setting any tenant context.
 * ONLY for operations that legitimately span all tenants or hit global tables:
 *   - Login (users + tenant_users membership lookup across tenants)
 *   - Auth middleware membership check (tenant unknown at verification time)
 *   - Invite validation (tenant_invites is global by design)
 *
 * ⚠️  Do NOT use this for any tenant-scoped business data queries.
 *     Use runInTransaction(tenantId, callback) instead.
 */
export const runWithoutRLS = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export default pool;