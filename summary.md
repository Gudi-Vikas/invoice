
=== ./AGENTS.md ===
# AGENTS.md — Ultrakey Invoice SaaS Platform
# Persona Roster and Operational Directives

## Project Context
This is a multi-tenant B2B SaaS platform for Ultrakey IT Solutions Private Limited.
It handles Quotation and Invoice generation, double-entry ledger accounting,
Razorpay Route split payments, and PostgreSQL Row-Level Security isolation.

**Tech Stack**:
- Frontend: React 18 + Vite + Vanilla CSS (HSL-based design system, glassmorphism)
- Backend: Node.js + Express (ES Modules) + PostgreSQL (pg pool)
- Payment: Razorpay Route API (linked accounts, split trdansfers, webhooks)
- Auth: JWT (HS256) with x-tenant-id header

**Key Directories**:
=== ./AUTH_CONTEXT.md ===
# Auth Flow — Context Snapshot
_Generated: 2026-06-15 | Read this file before touching any auth code._

## Stack
- Backend: Node.js + Express (ES Modules), PostgreSQL via `pg` pool
- Auth: JWT HS256, `x-tenant-id` header for tenant resolution
- DB: `runInTransaction(tenantId, callback)` from `backend/config/db.js`
- Schema applied via: `node backend/config/initDb.js` (reads schema.sql)

## Key Files
| File | Role |
|---|---|
| `backend/controllers/authController.js` | signup + login handlers |
| `backend/routes/auth.js` | mounts POST /signup, /login |
| `backend/middleware/auth.js` | authenticateToken, requireTenant, checkRole |
=== ./backend/config/db.js ===
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
=== ./backend/config/initDb.js ===
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const initDb = async () => {
  try {
    console.log('Reading schema.sql...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Executing schema script on PostgreSQL...');
=== ./backend/config/schema.sql ===
    -- ==========================================================================
    -- Invoice SaaS Platform — PostgreSQL Schema
    -- Multi-Tenant Pool Model with Row-Level Security (RLS)
    -- @dba: All tenant-scoped tables enforce USING (tenant_id = current_setting(...))
    -- ==========================================================================

    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    -- =========================================================================
    -- GLOBAL TABLES (No Row-Level Security — Accessible without tenant context)
    -- =========================================================================

    -- 1. Tenants Table
    CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
=== ./backend/controllers/authController.js ===
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';
const INVITE_TTL_HOURS = 72;
const STARTER_PLAN_ID = 'b3310000-0000-0000-0000-000000000001';
const STARTER_LOCK_DAYS = 7;

/**
 * Issues a signed JWT for the given user + tenant combination.
 * @param {{ id: string, email: string }} user
 * @param {{ id: string, name: string, domain: string|null, role: string }} tenant
 */
=== ./backend/controllers/clientController.js ===
import { runInTransaction } from '../config/db.js';

/**
 * Controller for managing client contacts for invoice and quotation routing.
 * All queries run within runInTransaction to enforce tenant RLS isolation.
 */
export const clientController = {
  /**
   * 1. Register a new client under the tenant's namespace.
   */
  createClient: async (req, res, next) => {
    const { name, email, billingAddress, extraInfo } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Client name and email address are required.' });
=== ./backend/controllers/documentController.js ===
import jwt from 'jsonwebtoken';
import { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger, postPaymentLedger } from '../services/ledgerService.js';
import emailService from '../services/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

/**
 * Controller orchestrating Quotation and Invoicing document lifecycles.
 * All DB operations run within runInTransaction to enforce tenant RLS isolation.
 */
export const documentController = {
  /**
   * 1. Creates a new invoice or quotation.
=== ./backend/controllers/masterAdminController.js ===
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { runWithoutRLS } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

/**
 * Issues a signed JWT scoped to a Master Admin identity.
 * Carries role: 'master_admin' — no tenantId. Expires in 8 hours.
 */
const issueMasterToken = (admin) =>
  jwt.sign(
    { id: admin.id, email: admin.email, role: 'master_admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
=== ./backend/controllers/paymentController.js ===
import { runInTransaction } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';

export const paymentController = {
  /**
   * Generates authorization redirect URL for Tenant Razorpay OAuth connection.
   */
  getOAuthUrl: async (req, res, next) => {
    try {
      const clientId = process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey';
      
      // Build callback dynamically so it works in both dev (localhost) and production
      const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/payments/razorpay/oauth/callback`;
      const state = `tenant:${req.tenantId}`;

=== ./backend/controllers/platformBillingController.js ===
import { runWithoutRLS } from '../config/db.js';

// ─── Invoice Number Generator ──────────────────────────────────────────────
// Format: UKEY-BILL-YYYYMM-NNNN  (e.g. UKEY-BILL-202406-0001)
// Thread-safe: uses explicit row lock (FOR UPDATE) on a dedicated monthly sequence table
const generateInvoiceNumber = async (client) => {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `UKEY-BILL-${yyyymm}`;

  // Ensure sequence tracking row exists for this prefix
  await client.query(
    `INSERT INTO platform_invoice_sequences (prefix, last_seq)
     VALUES ($1, 0)
     ON CONFLICT (prefix) DO NOTHING`,
=== ./backend/controllers/portalController.js ===
import jwt from 'jsonwebtoken';
import pool, { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger, postPaymentLedger } from '../services/ledgerService.js';
import razorpayService from '../services/razorpayService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const verifyPortalToken = (token, expectedDocumentId, expectedType) => {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (String(decoded.documentId) !== String(expectedDocumentId)) {
    const err = new Error('Magic link does not match the requested document.');
    err.status = 403;
    throw err;
=== ./backend/controllers/settingsController.js ===
import { runInTransaction } from '../config/db.js';
import { sanitizeHtmlContent } from '../utils/sanitize.js';

/**
 * Controller for retrieving and updating tenant configuration blocks.
 * Enforces Row-Level Security via the runInTransaction database query wrapper.
 */
export const settingsController = {
  /**
   * 1. Fetches all settings blocks for the current tenant.
   */
  getSettings: async (req, res, next) => {
    try {
      const settings = await runInTransaction(req.tenantId, async (client) => {
        const result = await client.query(
=== ./backend/controllers/subscriptionController.js ===
import { runInTransaction } from '../config/db.js';
import pool from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { createPlatformInvoice } from './platformBillingController.js';

const STARTER_PLAN_ID = 'b3310000-0000-0000-0000-000000000001';

/**
 * Controller managing platform subscription plans and subscription order checks.
 */
export const subscriptionController = {
  getStatus: async (req, res, next) => {
    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const subRes = await client.query(
=== ./backend/controllers/vendorController.js ===
import { runInTransaction } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { postLedgerTransaction } from '../services/ledgerService.js';

/**
 * Controller managing Marketplace Vendor Onboarding and KYC workflows.
 */
export const vendorController = {
  /**
   * 1. Onboards a new vendor and creates a Razorpay Route Linked Account.
   */
  createVendor: async (req, res, next) => {
    const { businessName, email, platformFeePercentage } = req.body;

    if (!businessName || !email) {
=== ./backend/controllers/webhookController.js ===
import { runInTransaction } from '../config/db.js';
import pool from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { postLedgerTransaction, postPaymentLedger } from '../services/ledgerService.js';
import { createPlatformInvoice } from './platformBillingController.js';

/**
 * Controller processing asynchronous status updates from Razorpay Webhook streams.
 * Protects against duplicate event processing via processed_events idempotency check.
 */
export const webhookController = {
  /**
   * Universal Webhook listener route.
   */
  handleWebhook: async (req, res, next) => {
=== ./backend/middleware/auth.js ===
import jwt from 'jsonwebtoken';
import { runWithoutRLS } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

/**
 * Unified authentication middleware.
 *
 * Handles TWO distinct identity types from the same Authorization header:
 *
 * 1. Master Admin JWT — carries { id, email, role: 'master_admin' }
 *    → Validates against master_admins table, sets req.masterAdmin.
 *    → No tenant resolution (master admins are cross-tenant by design).
 *
 * 2. Tenant User JWT — carries { id, email, tenantId }
=== ./backend/middleware/errorHandler.js ===
/**
 * Global Express Error Handling Middleware.
 * Standardizes API error outputs and intercepts known database errors to prevent internal leakage.
 */
export const errorHandler = (err, req, res, next) => {
  console.error('API Error details:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Unique constraint violation in PostgreSQL (code: 23505)
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict: A record with duplicate unique fields already exists.',
      details: err.detail
=== ./backend/routes/auth.js ===
import express from 'express';
import authController from '../controllers/authController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// ── Public ──────────────────────────────────────────────────────────────────
// Create a new tenant + admin user (owner onboarding)
router.post('/signup', authController.signup);

// Authenticate and receive a JWT (+ allTenants list for tenant picker)
router.post('/login', authController.login);

// Redeem an invite token → join an existing tenant workspace
router.post('/join', authController.join);
=== ./backend/routes/clients.js ===
import express from 'express';
import clientController from '../controllers/clientController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

// Collection routes
router.post('/', clientController.createClient);
router.get('/', clientController.getClients);

// Individual resource routes
router.get('/:id', clientController.getClientById);
=== ./backend/routes/documents.js ===
import express from 'express';
import documentController from '../controllers/documentController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

// Collection routes
router.post('/', documentController.createDocument);
router.get('/', documentController.getDocuments);

// Individual resource routes
router.get('/:id', documentController.getDocumentDetails);
=== ./backend/routes/master.js ===
import express from 'express';
import { authenticateToken, requireMasterAdmin } from '../middleware/auth.js';
import masterAdminController from '../controllers/masterAdminController.js';
import platformBillingController from '../controllers/platformBillingController.js';

const router = express.Router();

// ── Shorthand for the auth + guard chain used on every protected route ───────
const guard = [authenticateToken, requireMasterAdmin];

// ============================================================================
//  PUBLIC
// ============================================================================

// POST /api/v1/master/login
=== ./backend/routes/payments.js ===
import express from 'express';
import paymentController from '../controllers/paymentController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

// 1. Public OAuth callback (called by Razorpay OAuth redirection)
router.get('/razorpay/oauth/callback', paymentController.handleOAuthCallback);

// 2. Protected tenant routes
router.use(authenticateToken);
router.use(requireTenant);

router.get('/razorpay/oauth-url', paymentController.getOAuthUrl);
router.post('/razorpay/disconnect', paymentController.disconnectRazorpay);
=== ./backend/routes/portal.js ===
import express from 'express';
import portalController from '../controllers/portalController.js';

const router = express.Router();

// Publicly-accessible endpoints (rely on JWT magic link token verification in payloads/parameters)
router.get('/documents/:token', portalController.getDocumentByToken);
router.post('/quotes/:id/accept', portalController.acceptQuote);
router.post('/quotes/:id/decline', portalController.declineQuote);
router.post('/invoices/:id/pay', portalController.initializePayment);
router.post('/invoices/:id/verify', portalController.verifyPayment);
router.post('/invoices/:id/verify-offline', portalController.verifyOfflinePayment);

export default router;
=== ./backend/routes/settings.js ===
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import settingsController from '../controllers/settingsController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

const logoUploadDir = path.resolve('uploads/logos');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(logoUploadDir, { recursive: true });
    cb(null, logoUploadDir);
=== ./backend/routes/subscriptions.js ===
import express from 'express';
import subscriptionController from '../controllers/subscriptionController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// Get available subscription packages (public to authenticated users)
router.get('/plans', authenticateToken, subscriptionController.getPlans);
router.get('/status', authenticateToken, requireTenant, subscriptionController.getStatus);

// Get platform billing invoices (restricted to tenant context admin/billing roles)
router.get('/invoices', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.getTenantInvoices);

// Initialize a checkout session (restricted to tenant context admin/billing roles)
router.post('/checkout', authenticateToken, requireTenant, checkRole(['admin', 'billing','member']), subscriptionController.initializeCheckout);
=== ./backend/routes/vendors.js ===
import express from 'express';
import vendorController from '../controllers/vendorController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// 1. Public redirect callback (invoked by Razorpay server authorization redirects)
router.get('/oauth/callback', vendorController.handleOAuthCallback);

// 2. Secured Tenant API routes
router.use(authenticateToken);
router.use(requireTenant);

router.post('/', vendorController.createVendor);
router.post('/:id/kyc', vendorController.submitKyc);
=== ./backend/routes/webhooks.js ===
import express from 'express';
import webhookController from '../controllers/webhookController.js';

const router = express.Router();

// Public webhook receiver (authenticity verified internally via cryptographic signatures)
router.post('/razorpay', webhookController.handleWebhook);

export default router;
=== ./backend/scratch_alter.js ===
import pool from './config/db.js';

const runAlters = async () => {
  try {
    await pool.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS offline_payment_info JSONB;
    `);
    console.log('Alters successful');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
};

=== ./backend/scratch_seed.js ===
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from './config/db.js';
import { initializeLedgerAccounts, postInvoiceLedger } from './services/ledgerService.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const seedAndGetLink = async () => {
  const mockTenantId = crypto.randomUUID();
  const mockUserId = crypto.randomUUID();
  const mockClientId = crypto.randomUUID();
  const mockVendorId = crypto.randomUUID();
  const mockInvoiceId = crypto.randomUUID();

  try {
=== ./backend/scripts/createMasterAdmin.js ===
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
=== ./backend/server.js ===
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import errorHandler from './middleware/errorHandler.js';

// Route Imports
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import clientRoutes from './routes/clients.js';
import documentRoutes from './routes/documents.js';
import vendorRoutes from './routes/vendors.js';
import portalRoutes from './routes/portal.js';
import webhookRoutes from './routes/webhooks.js';
import subscriptionRoutes from './routes/subscriptions.js';
import masterRoutes from './routes/master.js';
=== ./backend/services/emailService.js ===
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const emailService = {
  /**
   * Dispatches email using local file recording for verification & dev previews.
   * @param {{ to: string, subject: string, body: string, html: string }} params
   */
  sendEmail: async ({ to, subject, body, html }) => {
    console.log(`[Email Service] Dispatching email to: ${to}`);
    console.log(`[Email Service] Subject: ${subject}`);
=== ./backend/services/ledgerService.js ===
/**
 * Double-Entry Accounting Ledger Service.
 * Updated to use the normalized debit/credit column model on ledger_entries,
 * replacing the direction VARCHAR + amount pattern.
 *
 * @dba: ledger_entries.debit and ledger_entries.credit are mutually exclusive columns
 *       enforced by the check_single_side DB constraint and trg_ledger_balance trigger.
 */

// Default chart of accounts seeded for every new tenant
export const DEFAULT_ACCOUNTS = [
  { name: 'Accounts Receivable',  type: 'asset',     code: 'AR_DEFAULT' },
  { name: 'Service Revenue',      type: 'revenue',   code: 'REV_DEFAULT' },
  { name: 'Cash',                 type: 'asset',     code: 'CASH_DEFAULT' },
  { name: 'Tax Liability',        type: 'liability', code: 'TAX_DEFAULT' },
=== ./backend/services/razorpayService.js ===
import crypto from 'crypto';
import Razorpay from 'razorpay';

// Read credentials from environment
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_123';

const isMockMode = !keyId || keyId.startsWith('rzp_test_mockkey') || !keySecret;

let razorpayClient = null;
if (!isMockMode) {
  razorpayClient = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
=== ./backend/test_flow.js ===
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { runInTransaction } from './config/db.js';
import { getNextDocumentNumber } from './utils/sequence.js';
import { initializeLedgerAccounts, postInvoiceLedger, postPaymentLedger } from './services/ledgerService.js';
import { sanitizeHtmlContent } from './utils/sanitize.js';
import razorpayService from './services/razorpayService.js';

import authController from './controllers/authController.js';
import settingsController from './controllers/settingsController.js';
import clientController from './controllers/clientController.js';
import documentController from './controllers/documentController.js';
import vendorController from './controllers/vendorController.js';
import portalController from './controllers/portalController.js';
=== ./backend/tests/test_double_payment.js ===
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { subscriptionController } from '../controllers/subscriptionController.js';
import platformBillingController from '../controllers/platformBillingController.js';

console.log('========================================================');
console.log('   Invoice SaaS - Double Payment Prevention Tests');
console.log('========================================================');

const mockTenantId = 'b4444444-4444-4444-4444-444444444444';
const mockUserId = 'c4444444-4444-4444-4444-444444444444';
const STARTER_PLAN_ID = 'b3310000-0000-0000-0000-000000000001';

const runTests = async () => {
  try {
=== ./backend/tests/test_email_decline.js ===
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { documentController } from '../controllers/documentController.js';
import { portalController } from '../controllers/portalController.js';

console.log('========================================================');
console.log('   Invoice SaaS - Emailing & Quote Decline Tests');
console.log('========================================================');

const mockTenantId = 'b2222222-2222-2222-2222-222222222222';
const mockUserId = 'c2222222-2222-2222-2222-222222222222';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

=== ./backend/tests/test_offline_payments.js ===
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';
import { portalController } from '../controllers/portalController.js';
import { documentController } from '../controllers/documentController.js';
import { postInvoiceLedger } from '../services/ledgerService.js';

console.log('========================================================');
console.log('   Invoice SaaS - Offline Payment & Ledger Tests');
console.log('========================================================');

const mockTenantId = 'b4444444-4444-4444-4444-444444444444';
const mockUserId = 'c4444444-4444-4444-4444-444444444444';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

=== ./backend/tests/test_surcharge_cost.js ===
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';
import { portalController } from '../controllers/portalController.js';
import { postInvoiceLedger } from '../services/ledgerService.js';

console.log('========================================================');
console.log('   Invoice SaaS - Gateway Surcharge & Vendor Cost Tests');
console.log('========================================================');

const mockTenantId = 'b3333333-3333-3333-3333-333333333333';
const mockUserId = 'c3333333-3333-3333-3333-333333333333';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const runTests = async () => {
=== ./backend/utils/sanitize.js ===
import sanitize from 'sanitize-html';

/**
 * Sanitizes unsafe HTML content by filtering out potentially malicious script tags,
 * event listeners, and unauthorized styling attributes, while preserving benign rich text features.
 * Used for formatting components like "Extra Business Info" in PDF rendering headers.
 * 
 * @param {string} rawHtml - Unsanitized HTML string from user inputs.
 * @returns {string} Clean, safe HTML string.
 */
export const sanitizeHtmlContent = (rawHtml) => {
  if (!rawHtml) return '';

  return sanitize(rawHtml, {
    // Whitelist tags that are benign for document layout rendering
=== ./backend/utils/sequence.js ===
/**
 * Increments the document number count and returns a formatted code.
 * Implements a strict row-level write lock (`FOR UPDATE`) on the tenant settings row
 * within the active transaction to guarantee that duplicate numbers are never generated
 * under high concurrency.
 * 
 * @param {import('pg').Client} client - Database client with active transaction context.
 * @param {string} tenantId - Tenant ID UUID.
 * @param {'invoice'|'quote'} type - The type of document to generate.
 * @returns {Promise<string>} The constructed, unique document sequence code.
 */
export const getNextDocumentNumber = async (client, tenantId, type) => {
  // Query with row-lock to block other sessions until current transaction commits
  const result = await client.query(
    'SELECT invoice_config FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE',
=== ./frontend/eslint.config.js ===
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
=== ./frontend/README.md ===
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

=== ./frontend/src/api.js ===
// API Client — Dynamic Backend Integration
// No mock fallbacks. All requests go to the real backend API.
// JWT token and tenant context are read from localStorage on every call.

// const API_BASE = 'http://localhost:5000/api/v1';
const API_BASE = 'https://tool-prefix-recipients-yearly.trycloudflare.com/api/v1';

/**
 * Core HTTP request handler.
 * Automatically attaches Authorization and x-tenant-id headers.
 * Dispatches auth:logout event on 401/403 responses.
 */
const request = async (url, options = {}) => {
  const token = localStorage.getItem('invoice_saas_token') || '';
  const activeTenant = (() => {
=== ./frontend/src/App.jsx ===
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';

// Auth Pages
import LoginPage from './components/auth/LoginPage';
import JoinPage from './components/auth/JoinPage';
import ProtectedRoute from './components/auth/ProtectedRoute';

// Tenant Layout + Pages
import TenantLayout from './components/TenantLayout';
import Dashboard from './components/Dashboard';
import Clients from './components/Clients';
=== ./frontend/src/components/auth/JoinPage.jsx ===
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, UserCheck } from 'lucide-react';

/**
 * JoinPage — Invite redemption page.
 * Accessed via /join?token=<uuid>.
 * User must provide a password (new or existing account).
 */
export const JoinPage = () => {
  const { joinWorkspace } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
=== ./frontend/src/components/auth/LoginPage.jsx ===
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, LogIn, UserPlus, ArrowRight } from 'lucide-react';

/**
 * LoginPage — Full-screen glassmorphism login/signup page.
 * Two-tab toggle: Login | Sign Up.
 * After login: auto-redirects to /dashboard (or tenant picker if multi-tenant).
 */
export const LoginPage = () => {
  const { login, signup } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
=== ./frontend/src/components/auth/ProtectedRoute.jsx ===
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * ProtectedRoute — Route guard wrapper.
 *
 * Usage:
 *   <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
 *   <Route path="/master/*" element={<ProtectedRoute requireMaster><MasterLayout /></ProtectedRoute>} />
 */
export const ProtectedRoute = ({ children, requireMaster = false }) => {
  const { isAuthenticated, isMasterAdmin, loading } = useAuth();

  // Still hydrating auth state from localStorage
=== ./frontend/src/components/ClientPortal.jsx ===
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { CheckCircle2, ShieldCheck, CreditCard, ArrowRightLeft, FileCheck, Landmark, Loader, Printer } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
=== ./frontend/src/components/Clients.jsx ===
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  Users, UserPlus, FileText, Edit2, X, Check, Search, ChevronLeft, ChevronRight,
  Building2, Mail, MapPin, ArrowUpRight, Trash2
} from 'lucide-react';

/**
 * Clients Management Page.
 * Full CRUD for client contacts: list with search + pagination, add modal, edit panel.
 */
export const Clients = () => {
=== ./frontend/src/components/Dashboard.jsx ===
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  TrendingUp, ArrowUpRight, DollarSign, Clock, ShieldAlert,
  FilePlus, UserPlus, Zap
} from 'lucide-react';

/**
 * Main Administrative Dashboard.
 * Displays aggregate performance indicators, recent documents, and quick actions.
 * Fetches live data from the backend documents endpoint.
 */
=== ./frontend/src/components/Documents.jsx ===
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  FileText, Plus, Trash2, ArrowLeft, FilePlus, Copy, Check,
  UserPlus, Printer, ChevronLeft, ChevronRight, Minus, Tag,
  Mail, Loader
} from 'lucide-react';

/**
 * Documents Module (Quotes & Invoices Manager).
 * Contains list, builder form with real-time tax math, and PDF invoice visualizer.
 * Uses SettingsContext — no redundant getSettings() calls.
 */
=== ./frontend/src/components/master/MasterAdmins.jsx ===
import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

/**
 * MasterAdmins — Co-admin management panel.
 * List, enable/disable master admin accounts.
 */
export const MasterAdmins = () => {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [admins, setAdmins] = useState([]);
=== ./frontend/src/components/master/MasterBilling.jsx ===
import { useState, useEffect } from 'react';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  Receipt, Plus, DollarSign, XCircle, CheckCircle, Eye
} from 'lucide-react';

/**
 * MasterBilling — Platform billing invoice management.
 * Generate, list, mark-paid, void billing invoices.
 */
export const MasterBilling = () => {
  const { showToast } = useToast();

  const [invoices, setInvoices] = useState([]);
=== ./frontend/src/components/master/MasterDashboard.jsx ===
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  Building2, TrendingUp, DollarSign, Users, AlertTriangle,
  ArrowUpRight, RefreshCw
} from 'lucide-react';

/**
 * MasterDashboard — Platform health snapshot.
 */
export const MasterDashboard = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
=== ./frontend/src/components/master/MasterLayout.jsx ===
import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../ThemeToggle';
import {
  LayoutDashboard, Building2, Receipt, ShieldCheck, LogOut, Layers
} from 'lucide-react';

/**
 * MasterLayout — App shell for the Master Admin panel.
 * Separate sidebar, separate brand identity.
 */
export const MasterLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
=== ./frontend/src/components/master/MasterLogin.jsx ===
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, LogIn, ShieldCheck } from 'lucide-react';

/**
 * MasterLogin — Separate login page for platform master admins.
 */
export const MasterLogin = () => {
  const { masterLogin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
=== ./frontend/src/components/master/MasterTenantDetail.jsx ===
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  ArrowLeft, CreditCard, Receipt, ShieldAlert,
  Power, PowerOff, Trash2, Save, Users
} from 'lucide-react';

/**
 * MasterTenantDetail — Full tenant profile with tabs.
 */
export const MasterTenantDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
=== ./frontend/src/components/master/MasterTenants.jsx ===
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import { Search, Building2, ArrowUpRight } from 'lucide-react';

/**
 * MasterTenants — Paginated tenant list with search and status filters.
 */
export const MasterTenants = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
=== ./frontend/src/components/Settings.jsx ===
import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { Save, AlertCircle, Eye, Code, Upload } from 'lucide-react';
import { sanitizeHtmlContent } from '../utils/sanitize';
import { useSettings } from '../context/SettingsContext';

/**
 * Settings Control Dashboard.
 * Integrates 8 distinct tabs mapping to the Ultrakey product design.
 */
export const Settings = () => {
  const { settings: ctxSettings, refreshSettings } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
=== ./frontend/src/components/Sidebar.jsx ===
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TenantSwitcher from './TenantSwitcher';
import ThemeToggle from './ThemeToggle';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  Users,
  Store,
  Settings,
  CreditCard,
  LogOut,
  Layers,
  UserPlus
=== ./frontend/src/components/SubscriptionPage.jsx ===
import { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CreditCard, Check, Zap, ArrowRight } from 'lucide-react';

const loadRazorpayScript = () => new Promise((resolve) => {
  if (window.Razorpay) {
    resolve(true);
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.onload = () => resolve(true);
=== ./frontend/src/components/Team.jsx ===
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { MailPlus, Copy, Users, Calendar } from 'lucide-react';
import api from '../api';

/**
 * Team — Admin-facing workspace invite UI.
 */
export const Team = () => {
  const { activeTenant, invite } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(false);
=== ./frontend/src/components/TenantLayout.jsx ===
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import api from '../api';
import { useToast } from '../context/ToastContext';

/**
 * TenantLayout — App shell wrapper for tenant-scoped pages.
 * Renders the Sidebar + main content area using React Router's <Outlet>.
 */
export const TenantLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [checkingSubscription, setCheckingSubscription] = useState(true);
=== ./frontend/src/components/TenantSwitcher.jsx ===
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ChevronDown, Plus, Building2, Check } from 'lucide-react';

/**
 * TenantSwitcher — Dropdown component for the Sidebar footer.
 * Shows active tenant name, allows switching between tenants,
 * and creating new workspaces.
 */
export const TenantSwitcher = () => {
  const { activeTenant, allTenants, switchTenant, createTenant } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
=== ./frontend/src/components/ThemeToggle.jsx ===
import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export const ThemeToggle = ({ className, style }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`btn btn-secondary ${className || ''}`}
      style={{
        padding: '0.5rem',
        borderRadius: '8px',
        minWidth: '36px',
=== ./frontend/src/components/Vendors.jsx ===
import React, { useState, useEffect } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { Users, UserPlus, FileCheck, CheckCircle2, ShieldAlert, AlertTriangle, Trash2, RefreshCw, X, Wallet } from 'lucide-react';

/**
 * Marketplace Vendor Management & KYC Panel.
 */
export const Vendors = () => {
  const { showToast } = useToast();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Registration Form
  const [showAddForm, setShowAddForm] = useState(false);
=== ./frontend/src/context/AuthContext.jsx ===
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * AuthContext — Central authentication state manager.
 *
 * Provides login/signup/logout/switchTenant/createTenant/joinWorkspace actions
 * and exposes the current user, active tenant, all tenants, and auth status.
 *
 * JWT tokens are persisted in localStorage and hydrated on mount.
 * Expired tokens trigger automatic logout.
 */

const API_BASE = 'http://localhost:5000/api/v1';

const AuthContext = createContext(null);
=== ./frontend/src/context/SettingsContext.jsx ===
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';

/**
 * Global Settings Context.
 * Fetches tenant settings on mount and distributes to all consumers.
 * Re-fetches when tenant:switched event fires (from TenantSwitcher).
 *
 * Usage:
 *   import { useSettings } from '../context/SettingsContext';
 *   const { settings, loading, refreshSettings } = useSettings();
 */

const SettingsContext = createContext(null);

=== ./frontend/src/context/ThemeContext.jsx ===
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return 'dark'; // Default platform theme is dark
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
=== ./frontend/src/context/ToastContext.jsx ===
import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * ToastContext — Global notification system.
 *
 * Usage:
 *   import { useToast } from '../context/ToastContext';
 *   const { showToast } = useToast();
 *   showToast('Client created successfully!', 'success');
 */

const ToastContext = createContext(null);

let toastId = 0;

=== ./frontend/src/main.jsx ===
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
=== ./frontend/src/utils/sanitize.js ===
/**
 * Safely parses HTML strings on the browser client by creating an in-memory DOM,
 * and stripping out unsafe tags (like <script>, <iframe>, etc.) or event handlers (like onload, onclick).
 * This replaces Node-specific sanitizers to keep frontend builds lightweight and bundle-safe.
 * 
 * @param {string} rawHtml - Unsanitized HTML string.
 * @returns {string} Clean, safe HTML string for rendering.
 */
export const sanitizeHtmlContent = (rawHtml) => {
  if (!rawHtml) return '';
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    
=== ./frontend/vite.config.js ===
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
=== ./.skills/frontend_react.md ===
---
name: frontend_react
description: >
  Architectural rules for React UI development within the Ultrakey Invoice SaaS platform.
  Covers Vite configuration, CSS design token patterns, React Context state management,
  component conventions, and animation guidelines. Load this skill when building or
  modifying any frontend component.
triggers:
  - "create component"
  - "update UI"
  - "add page"
  - "fix styling"
  - "react context"
---

=== ./.skills/ledger_engine.md ===
---
name: ledger_engine
description: >
  Double-entry accounting constraints for the financial ledger: schema structure,
  deferred zero-sum trigger, check_single_side constraint, chart of accounts,
  and posting patterns for invoices and payments.
triggers:
  - "ledger"
  - "accounting"
  - "double entry"
  - "journal entry"
  - "debit credit"
  - "postLedger"
  - "initializeLedger"
---
=== ./.skills/postgres_rls.md ===
---
name: postgres_rls
description: >
  SQL execution scripts, connection pool configurations, and transaction wrapper mechanics
  for enforcing Row-Level Security (RLS) in the multi-tenant PostgreSQL database.
  Load this skill when working on schema migrations, RLS policies, or DB connection logic.
triggers:
  - "RLS"
  - "row level security"
  - "tenant isolation"
  - "runInTransaction"
  - "schema migration"
  - "SET LOCAL"
---

=== ./.skills/razorpay_route.md ===
---
name: razorpay_route
description: >
  Razorpay Route API integration: linked account creation, stakeholder KYC, order generation
  with split transfers, partial payment configuration, webhook signature verification,
  and idempotency handling. Load this skill when working on payment flows.
triggers:
  - "razorpay"
  - "split payment"
  - "linked account"
  - "webhook"
  - "paise"
  - "order creation"
  - "KYC"
---
