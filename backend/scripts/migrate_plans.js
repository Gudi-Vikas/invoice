import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sslConfig = process.env.DATABASE_URL?.includes('aiven')
  ? {
      ca: fs.readFileSync(path.join(__dirname, '..', 'config', 'ca.pem')).toString(),
      rejectUnauthorized: true,
    }
  : false;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/invoice_db',
  ssl: sslConfig,
});

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('[Migration] Adding new columns to plans table...');

    // Add new columns to plans table (idempotent with IF NOT EXISTS)
    await client.query(`
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_annually NUMERIC(10, 2);
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS external_annual_product_id VARCHAR(255);
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS badge_text VARCHAR(50);
    `);

    console.log('[Migration] Plans table columns added successfully.');

    // Add max_clients and max_quotes_per_month feature keys for the existing Starter plan
    // (max_invoices_per_month and max_vendors already exist)
    await client.query(`
      INSERT INTO plan_features (plan_id, feature_key, usage_limit) VALUES
        ('b3310000-0000-0000-0000-000000000001', 'max_clients', 20),
        ('b3310000-0000-0000-0000-000000000001', 'max_quotes_per_month', 30),
        ('b3310000-0000-0000-0000-000000000001', 'max_team_members', 3)
      ON CONFLICT DO NOTHING;
    `);

    console.log('[Migration] Starter plan feature keys enriched.');

    // Update Starter plan with description and display_order
    await client.query(`
      UPDATE plans
      SET description = 'Perfect for freelancers and small businesses getting started with professional invoicing.',
          display_order = 1,
          is_active = true
      WHERE id = 'b3310000-0000-0000-0000-000000000001';
    `);

    console.log('[Migration] Starter plan metadata updated.');

    await client.query('COMMIT');
    console.log('[Migration] ✅ All migrations applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] ❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
