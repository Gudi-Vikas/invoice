import express from 'express';
import { authenticateToken, requireMasterAdmin, requireMasterPermission } from '../middleware/auth.js';
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
router.get('/dashboard', ...guard, requireMasterPermission('dashboard'), masterAdminController.getDashboardStats);

// GET /api/v1/master/notifications
// Sidebar badge counts: new tenants, inactive tenants, overdue + pending billing invoices.
router.get('/notifications', ...guard, masterAdminController.getMasterNotifications);


// ============================================================================
//  MASTER ADMIN — TENANT MANAGEMENT
// ============================================================================

// GET  /api/v1/master/tenants?page&limit&status&search
// Paginated list of all tenants with plan + user count.
router.get('/tenants',     ...guard, requireMasterPermission('tenants'), masterAdminController.listTenants);

// GET  /api/v1/master/tenants/:id
// Full tenant profile: users, subscription history, settings snapshot, recent billing.
router.get('/tenants/:id', ...guard, requireMasterPermission('tenants'), masterAdminController.getTenantDetail);

// PATCH /api/v1/master/tenants/:id/disable
// Suspend a tenant — users of that tenant will see a clear "workspace suspended" error on login.
router.patch('/tenants/:id/disable', ...guard, requireMasterPermission('tenants'), masterAdminController.disableTenant);

// PATCH /api/v1/master/tenants/:id/enable
// Re-activate a suspended tenant.
router.patch('/tenants/:id/enable', ...guard, requireMasterPermission('tenants'), masterAdminController.enableTenant);

// PATCH /api/v1/master/tenants/:id/subscription
// Override a tenant's plan / subscription status / period end (support tool).
router.patch('/tenants/:id/subscription', ...guard, requireMasterPermission('tenants'), masterAdminController.overrideSubscription);

// DELETE /api/v1/master/tenants/:id
// Hard delete a tenant and all cascaded data. Requires { confirm: true } in body.
router.delete('/tenants/:id', ...guard, requireMasterPermission('tenants'), masterAdminController.deleteTenant);


// ============================================================================
//  MASTER ADMIN — CO-ADMIN MANAGEMENT
// ============================================================================

// GET   /api/v1/master/admins
// List all master admin accounts (id, email, is_active, permissions, last_login_at).
router.get('/admins', ...guard, requireMasterPermission('admins'), masterAdminController.listMasterAdmins);

// POST  /api/v1/master/admins
// Create a new master admin with optional permission restrictions.
router.post('/admins', ...guard, requireMasterPermission('admins'), masterAdminController.createMasterAdmin);

// PATCH /api/v1/master/admins/:id/toggle
// Enable or disable a co-admin account. Cannot toggle self.
router.patch('/admins/:id/toggle', ...guard, requireMasterPermission('admins'), masterAdminController.toggleMasterAdmin);

// PATCH /api/v1/master/admins/:id/permissions
// Update a co-admin's section permissions. Cannot modify self.
router.patch('/admins/:id/permissions', ...guard, requireMasterPermission('admins'), masterAdminController.updateMasterAdminPermissions);


// ============================================================================
//  MASTER ADMIN — PLAN MANAGEMENT
// ============================================================================

// GET  /api/v1/master/plans?includeArchived=true|false
// List all SaaS plans with features and subscriber count.
router.get('/plans', ...guard, requireMasterPermission('plans'), masterAdminController.listPlans);

// POST /api/v1/master/plans
// Create a new plan (auto-creates Razorpay Plan). Body: { name, priceMonthly, features, ... }
router.post('/plans', ...guard, requireMasterPermission('plans'), masterAdminController.createPlan);

// PUT  /api/v1/master/plans/:id
// Update plan metadata and features.
router.put('/plans/:id', ...guard, requireMasterPermission('plans'), masterAdminController.updatePlan);

// PATCH /api/v1/master/plans/:id/archive
// Soft-delete: set is_active = false. Existing subscribers are unaffected.
router.patch('/plans/:id/archive', ...guard, requireMasterPermission('plans'), masterAdminController.archivePlan);

// PATCH /api/v1/master/plans/:id/restore
// Re-activate an archived plan.
router.patch('/plans/:id/restore', ...guard, requireMasterPermission('plans'), masterAdminController.restorePlan);


// ============================================================================
//  PLATFORM BILLING  —  Ultrakey → Tenant subscription invoices
// ============================================================================

// POST /api/v1/master/billing/generate
// Generate a new platform billing invoice for a tenant.
router.post('/billing/generate', ...guard, requireMasterPermission('billing'), platformBillingController.generateInvoice);

// GET  /api/v1/master/billing?page&limit&status&tenantId&from&to
// Paginated list of all platform billing invoices (filterable).
router.get('/billing', ...guard, requireMasterPermission('billing'), platformBillingController.listInvoices);

// GET  /api/v1/master/billing/:id
// Full detail of a single platform billing invoice.
router.get('/billing/:id', ...guard, requireMasterPermission('billing'), platformBillingController.getInvoice);

// PATCH /api/v1/master/billing/:id/mark-paid
// Manually mark an invoice as paid (for offline/bank transfers).
router.patch('/billing/:id/mark-paid', ...guard, requireMasterPermission('billing'), platformBillingController.markPaid);

// PATCH /api/v1/master/billing/:id/void
// Void an invoice that should not be collected.
router.patch('/billing/:id/void', ...guard, requireMasterPermission('billing'), platformBillingController.voidInvoice);

// POST /api/v1/master/billing/mark-overdue
// Bulk-sweep: mark all past-due pending invoices as overdue.
// Designed to be triggered by a cron job or manually.
router.post('/billing/mark-overdue', ...guard, requireMasterPermission('billing'), platformBillingController.markOverdueInvoices);

// GET  /api/v1/master/billing/tenant/:tenantId
// Full billing history + summary for a specific tenant.
router.get('/billing/tenant/:tenantId', ...guard, requireMasterPermission('billing'), platformBillingController.getTenantBillingHistory);

export default router;

