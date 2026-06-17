/**
 * @file createMasterAdmin.js
 * @description One-time bootstrap script to seed the first (or additional)
 * Master Admin account into the `master_admins` table.
 *
 * This is the ONLY way to create a master admin — there is intentionally no
 * HTTP endpoint for this. Running this from the server terminal ensures that
 * only someone with direct server access can create a master admin.
 *
 * Usage:
 *   node backend/scripts/createMasterAdmin.js
 *
 * The script reads credentials from environment variables:
 *   MASTER_ADMIN_EMAIL    — required
 *   MASTER_ADMIN_PASSWORD — required (min 12 characters recommended)
 *
 * Add these to your .env file before running:
 *   MASTER_ADMIN_EMAIL=owner@ultrakey.in
 *   MASTER_ADMIN_PASSWORD=YourSecurePasswordHere
 *
 * The script is idempotent: if the email already exists it prints a notice
 * and exits cleanly without throwing an error.
 */

import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Validate required env vars ────────────────────────────────────────────────
const email    = (process.env.MASTER_ADMIN_EMAIL    || '').trim().toLowerCase();
const password =  process.env.MASTER_ADMIN_PASSWORD || '';

if (!email) {
  console.error('❌  MASTER_ADMIN_EMAIL is not set in .env');
  process.exit(1);
}

if (!password || password.length < 8) {
  console.error('❌  MASTER_ADMIN_PASSWORD must be set and at least 8 characters long.');
  process.exit(1);
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error(`❌  MASTER_ADMIN_EMAIL "${email}" is not a valid email address.`);
  process.exit(1);
}

// ── Database Connection ───────────────────────────────────────────────────────
const sslConfig = process.env.DATABASE_URL?.includes('aiven')
  ? {
      ca: fs.readFileSync(path.join(__dirname, '../config/ca.pem')).toString(),
      rejectUnauthorized: true,
    }
  : false;

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/invoice_db',
  ssl: sslConfig
});

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  let client;
  try {
    client = await pool.connect();

    console.log(`\n🔐  Creating master admin: ${email}`);

    // Hash with cost factor 12 — higher than tenant users (10) for the
    // most privileged account type.
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO master_admins (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, created_at`,
      [email, passwordHash]
    );

    if (result.rows.length === 0) {
      console.log(`\n⚠️   Master admin with email "${email}" already exists. No changes made.\n`);
    } else {
      const { id, created_at } = result.rows[0];
      console.log(`\n✅  Master admin created successfully!`);
      console.log(`    ID:      ${id}`);
      console.log(`    Email:   ${email}`);
      console.log(`    Created: ${created_at.toISOString()}`);
      console.log(`\n    Login endpoint: POST /api/v1/master/login`);
      console.log(`    Body:           { "email": "${email}", "password": "***" }\n`);
    }
  } catch (err) {
    console.error('\n❌  Failed to create master admin:', err.message);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
})();
