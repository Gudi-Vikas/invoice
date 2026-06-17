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
// Authenticate with master_admins table — returns 8h JWT (role: master_admin).
router.post('/login', masterAdminController.login);


// ============================================================================
//  MASTER ADMIN — PLATFORM DASHBOARD
// ============================================================================

// GET /api/v1/master/dashboard
// Aggregate platform stats: tenant counts, MRR, billing snapshot, recent signups.
router.get('/dashboard', ...guard, masterAdminController.getDashboardStats);


// ============================================================================
//  MASTER ADMIN — TENANT MANAGEMENT
// ============================================================================

// GET  /api/v1/master/tenants?page&limit&status&search
// Paginated list of all tenants with plan + user count.
router.get('/tenants',     ...guard, masterAdminController.listTenants);

// GET  /api/v1/master/tenants/:id
// Full tenant profile: users, subscription history, settings snapshot, recent billing.
router.get('/tenants/:id', ...guard, masterAdminController.getTenantDetail);

// PATCH /api/v1/master/tenants/:id/disable
// Suspend a tenant — users of that tenant will see a clear "workspace suspended" error on login.
router.patch('/tenants/:id/disable', ...guard, masterAdminController.disableTenant);

// PATCH /api/v1/master/tenants/:id/enable
// Re-activate a suspended tenant.
router.patch('/tenants/:id/enable', ...guard, masterAdminController.enableTenant);

// PATCH /api/v1/master/tenants/:id/subscription
// Override a tenant's plan / subscription status / period end (support tool).
router.patch('/tenants/:id/subscription', ...guard, masterAdminController.overrideSubscription);

// DELETE /api/v1/master/tenants/:id
// Hard delete a tenant and all cascaded data. Requires { confirm: true } in body.
router.delete('/tenants/:id', ...guard, masterAdminController.deleteTenant);


// ============================================================================
//  MASTER ADMIN — CO-ADMIN MANAGEMENT
// ============================================================================

// GET   /api/v1/master/admins
// List all master admin accounts (id, email, is_active, last_login_at).
router.get('/admins', ...guard, masterAdminController.listMasterAdmins);

// PATCH /api/v1/master/admins/:id/toggle
// Enable or disable a co-admin account. Cannot toggle self.
router.patch('/admins/:id/toggle', ...guard, masterAdminController.toggleMasterAdmin);


// ============================================================================
//  PLATFORM BILLING  —  Ultrakey → Tenant subscription invoices
// ============================================================================

// POST /api/v1/master/billing/generate
// Generate a new platform billing invoice for a tenant.
router.post('/billing/generate', ...guard, platformBillingController.generateInvoice);

// GET  /api/v1/master/billing?page&limit&status&tenantId&from&to
// Paginated list of all platform billing invoices (filterable).
router.get('/billing', ...guard, platformBillingController.listInvoices);

// GET  /api/v1/master/billing/:id
// Full detail of a single platform billing invoice.
router.get('/billing/:id', ...guard, platformBillingController.getInvoice);

// PATCH /api/v1/master/billing/:id/mark-paid
// Manually mark an invoice as paid (for offline/bank transfers).
router.patch('/billing/:id/mark-paid', ...guard, platformBillingController.markPaid);

// PATCH /api/v1/master/billing/:id/void
// Void an invoice that should not be collected.
router.patch('/billing/:id/void', ...guard, platformBillingController.voidInvoice);

// POST /api/v1/master/billing/mark-overdue
// Bulk-sweep: mark all past-due pending invoices as overdue.
// Designed to be triggered by a cron job or manually.
router.post('/billing/mark-overdue', ...guard, platformBillingController.markOverdueInvoices);

// GET  /api/v1/master/billing/tenant/:tenantId
// Full billing history + summary for a specific tenant.
router.get('/billing/tenant/:tenantId', ...guard, platformBillingController.getTenantBillingHistory);

export default router;
