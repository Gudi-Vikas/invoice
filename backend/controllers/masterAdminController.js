import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { runWithoutRLS } from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import eventBus from '../services/eventBus.js';

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Issues a signed JWT scoped to a Master Admin identity.
 * Carries role: 'master_admin' + permissions array — no tenantId. Expires in 8 hours.
 */
const issueMasterToken = (admin) =>
  jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: 'master_admin',
      permissions: admin.permissions ?? null    // NULL = full access
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

/**
 * Allowed feature keys and their display labels.
 */
const ALLOWED_FEATURE_KEYS = [
  'max_clients',
  'max_invoices_per_month',
  'max_quotes_per_month',
  'max_team_members',
  'custom_branding'
];

/**
 * Allowed master admin permission keys.
 * These correspond to sidebar sections in the platform admin panel.
 */
const ALLOWED_PERMISSIONS = ['dashboard', 'plans', 'tenants', 'billing', 'admins'];

/**
 * Master Admin Controller — Platform Owner Control Plane.
 *
 * All handlers use runWithoutRLS because master admin operations are
 * intentionally cross-tenant. No app.current_tenant_id is ever set here.
 *
 * Security note: every handler (except login) is guarded by the
 * authenticateToken + requireMasterAdmin middleware chain at the route level.
 */
export const masterAdminController = {

  // ───────────────────────────────────────────────────────────────────────────
  // 1. LOGIN  —  Authenticate using master_admins table.
  //    Returns an 8-hour JWT with role: 'master_admin' (no tenantId).
  //    Public endpoint — no prior auth required.
  // ───────────────────────────────────────────────────────────────────────────
  login: async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
      const adminRes = await runWithoutRLS(async (client) => {
        return client.query(
          'SELECT id, email, password_hash, is_active, permissions FROM master_admins WHERE email = $1',
          [email.toLowerCase().trim()]
        );
      });

      // Return the same generic error for not-found and wrong-password
      // to avoid leaking which master admin emails exist.
      if (adminRes.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const admin = adminRes.rows[0];

      if (!admin.is_active) {
        return res.status(403).json({
          error: 'This master admin account has been disabled. Contact another administrator.'
        });
      }

      const valid = await bcrypt.compare(password, admin.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      // Non-blocking last_login update — failure here must not block the login response.
      runWithoutRLS(async (client) =>
        client.query('UPDATE master_admins SET last_login_at = NOW() WHERE id = $1', [admin.id])
      ).catch((err) => console.error('[master] last_login update failed:', err.message));

      const token = issueMasterToken({ id: admin.id, email: admin.email, permissions: admin.permissions });

      return res.json({
        message: 'Master admin login successful.',
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          permissions: admin.permissions   // NULL = full access
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. DASHBOARD STATS  —  High-level platform health snapshot.
  //    Returns tenant counts by status, estimated MRR, and 5 most recent signups.
  // ───────────────────────────────────────────────────────────────────────────
  getDashboardStats: async (req, res, next) => {
    try {
      const stats = await runWithoutRLS(async (client) => {
        const [tenantStats, mrrRes, recentSignups, billingStats] = await Promise.all([
          // Tenant status breakdown
          client.query(`
            SELECT
              COUNT(*)                                              AS total_tenants,
              COUNT(*) FILTER (WHERE status = 'active')           AS active_tenants,
              COUNT(*) FILTER (WHERE status = 'suspended')        AS suspended_tenants,
              COUNT(*) FILTER (WHERE status = 'trial')            AS trial_tenants,
              COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)  AS new_today,
              COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)) AS new_this_month
            FROM tenants
          `),
          // Estimated MRR (sum of active subscription plan prices)
          client.query(`
            SELECT COALESCE(SUM(p.price_monthly), 0) AS mrr
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active'
          `),
          // 5 most recent tenant signups
          client.query(`
            SELECT t.id, t.name, t.domain, t.status, t.created_at,
                   p.name AS plan_name
            FROM tenants t
            LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
            LEFT JOIN plans p ON p.id = s.plan_id
            ORDER BY t.created_at DESC
            LIMIT 5
          `),
          // Platform billing snapshot
          client.query(`
            SELECT
              COUNT(*) FILTER (WHERE status = 'pending')  AS pending_invoices,
              COUNT(*) FILTER (WHERE status = 'overdue')  AS overdue_invoices,
              COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'
                AND created_at >= DATE_TRUNC('month', CURRENT_DATE)), 0) AS collected_this_month
            FROM platform_billing_invoices
          `)
        ]);

        return {
          tenants: tenantStats.rows[0],
          mrr: parseFloat(mrrRes.rows[0].mrr).toFixed(2),
          billing: billingStats.rows[0],
          recentSignups: recentSignups.rows
        };
      });

      return res.json({ stats });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. LIST TENANTS  —  Paginated list of all tenants with plan + user count.
  //    Query params: page, limit, status (active|suspended|trial), search (name/domain)
  // ───────────────────────────────────────────────────────────────────────────
  listTenants: async (req, res, next) => {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { status, search } = req.query;

    try {
      const result = await runWithoutRLS(async (client) => {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) {
          conditions.push(`(t.status = $${idx} OR s.status = $${idx})`);
          params.push(status);
          idx++;
        }
        if (search) {
          conditions.push(`(t.name ILIKE $${idx} OR t.domain ILIKE $${idx})`);
          params.push(`%${search}%`);
          idx++;
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows, total] = await Promise.all([
          client.query(
            `SELECT
               t.id, t.name, t.domain, t.status, t.created_at,
               p.name            AS plan_name,
               p.price_monthly   AS plan_price,
               s.status          AS subscription_status,
               s.current_period_end,
               COUNT(tu.user_id) AS user_count
             FROM tenants t
             LEFT JOIN subscriptions s  ON s.tenant_id = t.id
             LEFT JOIN plans p          ON p.id = s.plan_id
             LEFT JOIN tenant_users tu  ON tu.tenant_id = t.id
             ${where}
             GROUP BY t.id, t.name, t.domain, t.status, t.created_at,
                      p.name, p.price_monthly, s.status, s.current_period_end
             ORDER BY t.created_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset]
          ),
          client.query(
            `SELECT COUNT(DISTINCT t.id) FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id ${where}`,
            params
          )
        ]);

        return { rows: rows.rows, total: parseInt(total.rows[0].count) };
      });

      return res.json({
        tenants: result.rows,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. GET TENANT DETAIL  —  Full profile: users, subscription history, settings.
  // ───────────────────────────────────────────────────────────────────────────
  getTenantDetail: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runWithoutRLS(async (client) => {
        const [tenantRow, users, subscriptionHistory, settings, billingInvoices] =
          await Promise.all([
            client.query(
              `SELECT t.*,
                      p.name AS plan_name, p.price_monthly,
                      s.status AS sub_status, s.current_period_end,
                      s.external_subscription_id
               FROM tenants t
               LEFT JOIN subscriptions s ON s.tenant_id = t.id
               LEFT JOIN plans p ON p.id = s.plan_id
               WHERE t.id = $1
               ORDER BY s.created_at DESC NULLS LAST
               LIMIT 1`,
              [id]
            ),
            client.query(
              `SELECT u.id, u.email, u.created_at, tu.role
               FROM tenant_users tu
               JOIN users u ON u.id = tu.user_id
               WHERE tu.tenant_id = $1
               ORDER BY tu.role DESC, u.created_at ASC`,
              [id]
            ),
            client.query(
              `SELECT s.*, p.name AS plan_name, p.price_monthly
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.tenant_id = $1
               ORDER BY s.created_at DESC`,
              [id]
            ),
            client.query(
              'SELECT business_info, general_config FROM tenant_settings WHERE tenant_id = $1',
              [id]
            ),
            client.query(
              `SELECT id, invoice_number, amount, tax_amount, total_amount,
                      status, billing_period_start, billing_period_end, due_date, paid_at
               FROM platform_billing_invoices
               WHERE tenant_id = $1
               ORDER BY created_at DESC
               LIMIT 10`,
              [id]
            )
          ]);

        if (tenantRow.rows.length === 0) return null;

        return {
          tenant: tenantRow.rows[0],
          users: users.rows,
          subscriptionHistory: subscriptionHistory.rows,
          settings: settings.rows[0] || null,
          recentBillingInvoices: billingInvoices.rows
        };
      });

      if (!result) {
        return res.status(404).json({ error: 'Tenant not found.' });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. DISABLE TENANT  —  Sets status = 'suspended'.
  //    Suspended tenants are filtered out of the login query → users see a clear
  //    error message instead of "invalid credentials".
  // ───────────────────────────────────────────────────────────────────────────
  disableTenant: async (req, res, next) => {
    const { id } = req.params;
    const { reason } = req.body;

    try {
      const updated = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE tenants
           SET status = 'suspended'
           WHERE id = $1 AND status != 'suspended'
           RETURNING id, name, status`,
          [id]
        );
      });

      if (updated.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found, or it is already suspended.'
        });
      }

      eventBus.emit('tenant.suspended', {
        tenantId: updated.rows[0].id,
        name: updated.rows[0].name,
        reason: reason || null
      });

      return res.json({
        message: `Tenant "${updated.rows[0].name}" has been suspended.`,
        tenant: updated.rows[0],
        reason: reason || null
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. ENABLE TENANT  —  Lifts a suspension, sets status = 'active'.
  // ───────────────────────────────────────────────────────────────────────────
  enableTenant: async (req, res, next) => {
    const { id } = req.params;

    try {
      const updated = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE tenants
           SET status = 'active'
           WHERE id = $1 AND status = 'suspended'
           RETURNING id, name, status`,
          [id]
        );
      });

      if (updated.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found, or it is not currently suspended.'
        });
      }

      eventBus.emit('tenant.enabled', {
        tenantId: updated.rows[0].id,
        name: updated.rows[0].name
      });

      return res.json({
        message: `Tenant "${updated.rows[0].name}" has been re-activated.`,
        tenant: updated.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. DELETE TENANT  —  Hard delete with cascades. Irreversible.
  //    Requires { confirm: true } in body as an intentional friction guard.
  // ───────────────────────────────────────────────────────────────────────────
  deleteTenant: async (req, res, next) => {
    const { id } = req.params;
    const { confirm } = req.body;

    if (confirm !== true) {
      return res.status(400).json({
        error:
          'Hard delete requires { "confirm": true } in the request body. ' +
          'This action permanently deletes all tenant data and cannot be undone.'
      });
    }

    try {
      const deleted = await runWithoutRLS(async (client) => {
        return client.query(
          'DELETE FROM tenants WHERE id = $1 RETURNING id, name',
          [id]
        );
      });

      if (deleted.rows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found.' });
      }

      return res.json({
        message: `Tenant "${deleted.rows[0].name}" and all associated data have been permanently deleted.`,
        deleted: { id: deleted.rows[0].id, name: deleted.rows[0].name }
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 8. OVERRIDE SUBSCRIPTION  —  Manually adjust a tenant's plan/status/period.
  //    Useful for support escalations, free trials, grace periods, etc.
  //    Body: { planId?, status?, currentPeriodEnd?, note? }
  // ───────────────────────────────────────────────────────────────────────────
  overrideSubscription: async (req, res, next) => {
    const { id } = req.params; // tenant id
    const { planId, status, currentPeriodEnd, note } = req.body;

    if (!planId && !status && !currentPeriodEnd) {
      return res.status(400).json({
        error: 'Provide at least one field to update: planId, status, or currentPeriodEnd.'
      });
    }

    const ALLOWED_SUB_STATUSES = ['active', 'past_due', 'canceled'];
    if (status && !ALLOWED_SUB_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${ALLOWED_SUB_STATUSES.join(', ')}.`
      });
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        if (planId) {
          const planCheck = await client.query(
            'SELECT id, name FROM plans WHERE id = $1',
            [planId]
          );
          if (planCheck.rows.length === 0) {
            throw Object.assign(new Error('Invalid planId — plan not found.'), { statusCode: 400 });
          }
        }

        const sets = [];
        const params = [];
        let idx = 1;

        if (planId)           { sets.push(`plan_id = $${idx++}`);             params.push(planId); }
        if (status)           { sets.push(`status = $${idx++}`);              params.push(status); }
        if (currentPeriodEnd) { sets.push(`current_period_end = $${idx++}`);  params.push(currentPeriodEnd); }

        params.push(id); // tenant_id

        const updated = await client.query(
          `UPDATE subscriptions
           SET ${sets.join(', ')}
           WHERE tenant_id = $${idx}
           RETURNING *`,
          params
        );

        if (updated.rows.length === 0) {
          throw Object.assign(
            new Error('No subscription record found for this tenant.'),
            { statusCode: 404 }
          );
        }

        return updated.rows[0];
      });

      eventBus.emit('subscription.overridden', {
        tenantId: id,
        planId,
        status
      });

      return res.json({
        message: 'Subscription overridden by master admin.',
        subscription: result,
        adminNote: note || null
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 9. LIST MASTER ADMINS  —  Returns all master admin accounts (no passwords).
  // ───────────────────────────────────────────────────────────────────────────
  listMasterAdmins: async (req, res, next) => {
    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `SELECT id, email, is_active, permissions, created_by, created_at, last_login_at
           FROM master_admins
           ORDER BY created_at ASC`
        );
      });

      return res.json({ admins: result.rows });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 10. TOGGLE MASTER ADMIN  —  Flip is_active for a co-admin account.
  //     Self-disablement is blocked (prevents lockout when only 1 admin exists).
  // ───────────────────────────────────────────────────────────────────────────
  toggleMasterAdmin: async (req, res, next) => {
    const { id } = req.params;

    if (id === req.masterAdmin.id) {
      return res.status(400).json({
        error: 'You cannot disable your own master admin account.'
      });
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE master_admins
           SET is_active = NOT is_active
           WHERE id = $1
           RETURNING id, email, is_active`,
          [id]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Master admin account not found.' });
      }

      const { is_active, email } = result.rows[0];
      return res.json({
        message: `Master admin "${email}" has been ${is_active ? 'enabled' : 'disabled'}.`,
        admin: result.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 10b. CREATE MASTER ADMIN  —  Add a new co-admin with optional restrictions.
  //      Body: { email, password, permissions? }
  //      permissions = null → full access.  permissions = ['dashboard','tenants'] → restricted.
  // ───────────────────────────────────────────────────────────────────────────
  createMasterAdmin: async (req, res, next) => {
    const { email, password, permissions } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Validate permission keys if provided
    let normalizedPerms = null;
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const invalid = permissions.filter(p => !ALLOWED_PERMISSIONS.includes(p));
      if (invalid.length > 0) {
        return res.status(400).json({
          error: `Invalid permission keys: ${invalid.join(', ')}. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}`
        });
      }
      normalizedPerms = permissions;
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        // Check for duplicate email
        const existing = await client.query(
          'SELECT id FROM master_admins WHERE email = $1',
          [email.toLowerCase().trim()]
        );
        if (existing.rows.length > 0) {
          throw Object.assign(new Error('A master admin with this email already exists.'), { statusCode: 409 });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const insertRes = await client.query(
          `INSERT INTO master_admins (email, password_hash, is_active, permissions, created_by)
           VALUES ($1, $2, true, $3, $4)
           RETURNING id, email, is_active, permissions, created_by, created_at`,
          [email.toLowerCase().trim(), passwordHash, normalizedPerms ? JSON.stringify(normalizedPerms) : null, req.masterAdmin.id]
        );

        return insertRes.rows[0];
      });

      eventBus.emit('master_admin.created', {
        email: result.email
      });

      return res.status(201).json({
        message: `Master admin "${result.email}" created successfully.`,
        admin: result
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 10c. UPDATE MASTER ADMIN PERMISSIONS  —  Change an admin's section access.
  //      Body: { permissions } — null for full access, or array of section keys.
  //      Self-modification is blocked to prevent accidental lockout.
  // ───────────────────────────────────────────────────────────────────────────
  updateMasterAdminPermissions: async (req, res, next) => {
    const { id } = req.params;
    const { permissions } = req.body;

    if (id === req.masterAdmin.id) {
      return res.status(400).json({
        error: 'You cannot modify your own permissions.'
      });
    }

    // Validate permission keys if provided as array
    let normalizedPerms = null;
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const invalid = permissions.filter(p => !ALLOWED_PERMISSIONS.includes(p));
      if (invalid.length > 0) {
        return res.status(400).json({
          error: `Invalid permission keys: ${invalid.join(', ')}. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}`
        });
      }
      normalizedPerms = permissions;
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE master_admins
           SET permissions = $1
           WHERE id = $2
           RETURNING id, email, is_active, permissions`,
          [normalizedPerms ? JSON.stringify(normalizedPerms) : null, id]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Master admin account not found.' });
      }

      const admin = result.rows[0];
      return res.json({
        message: `Permissions for "${admin.email}" updated successfully.`,
        admin
      });
    } catch (err) {
      next(err);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN MANAGEMENT — CRUD for SaaS subscription plans
  // ═══════════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────────
  // 11. LIST PLANS  —  All plans with features and subscriber count.
  //     Query: ?includeArchived=true to include inactive plans (default: all)
  // ───────────────────────────────────────────────────────────────────────────
  listPlans: async (req, res, next) => {
    const includeArchived = req.query.includeArchived !== 'false';

    try {
      const result = await runWithoutRLS(async (client) => {
        const condition = includeArchived ? '' : 'WHERE p.is_active = true';

        const plansRes = await client.query(`
          SELECT p.*,
                 COALESCE(
                   JSON_AGG(
                     JSON_BUILD_OBJECT('key', pf.feature_key, 'limit', pf.usage_limit)
                   ) FILTER (WHERE pf.feature_key IS NOT NULL),
                   '[]'::json
                 ) AS features,
                 (
                   SELECT COUNT(DISTINCT s.tenant_id)
                   FROM subscriptions s
                   WHERE s.plan_id = p.id AND s.status = 'active'
                 ) AS active_subscribers
          FROM plans p
          LEFT JOIN plan_features pf ON p.id = pf.plan_id
          ${condition}
          GROUP BY p.id
          ORDER BY p.display_order ASC, p.price_monthly ASC
        `);

        return plansRes.rows;
      });

      return res.json({ plans: result });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 12. CREATE PLAN  —  Creates a new SaaS plan + features + Razorpay Plan.
  //     Body: {
  //       name, description?, priceMonthly, priceAnnually?,
  //       features: [{ key, limit }], displayOrder?, isFeatured?, badgeText?
  //     }
  // ───────────────────────────────────────────────────────────────────────────
  createPlan: async (req, res, next) => {
    const {
      name, description, priceMonthly, priceAnnually,
      features = [], displayOrder = 0, isFeatured = false, badgeText
    } = req.body;

    if (!name || priceMonthly === undefined || priceMonthly === null) {
      return res.status(400).json({ error: 'name and priceMonthly are required.' });
    }

    if (parseFloat(priceMonthly) < 0) {
      return res.status(400).json({ error: 'priceMonthly must be non-negative.' });
    }

    // Validate feature keys
    for (const f of features) {
      if (!ALLOWED_FEATURE_KEYS.includes(f.key)) {
        return res.status(400).json({
          error: `Invalid feature key: "${f.key}". Allowed: ${ALLOWED_FEATURE_KEYS.join(', ')}`
        });
      }
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        // A. Create Razorpay Plan (monthly)
        let externalProductId = null;
        let externalAnnualProductId = null;

        try {
          const rzpPlan = await razorpayService.createRazorpayPlan({
            name,
            description: description || name,
            amountInRupees: parseFloat(priceMonthly),
            interval: 'monthly',
            period: 1
          });
          externalProductId = rzpPlan.id;
        } catch (rzpErr) {
          console.error('[Master] Razorpay monthly plan creation failed:', rzpErr.message);
          // Continue — plan can still be saved locally. Admin can retry Razorpay sync later.
        }

        // Create annual Razorpay Plan if annual price provided
        if (priceAnnually && parseFloat(priceAnnually) > 0) {
          try {
            const rzpAnnualPlan = await razorpayService.createRazorpayPlan({
              name: `${name} (Annual)`,
              description: description || name,
              amountInRupees: parseFloat(priceAnnually),
              interval: 'yearly',
              period: 1
            });
            externalAnnualProductId = rzpAnnualPlan.id;
          } catch (rzpErr) {
            console.error('[Master] Razorpay annual plan creation failed:', rzpErr.message);
          }
        }

        // B. Insert plan into DB
        const planRes = await client.query(
          `INSERT INTO plans (name, description, price_monthly, price_annually,
                              external_product_id, external_annual_product_id,
                              is_active, is_featured, display_order, badge_text)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
           RETURNING *`,
          [
            name, description || null, parseFloat(priceMonthly),
            priceAnnually ? parseFloat(priceAnnually) : null,
            externalProductId, externalAnnualProductId,
            isFeatured, displayOrder, badgeText || null
          ]
        );

        const plan = planRes.rows[0];

        // C. Insert features
        if (features.length > 0) {
          const featureValues = features.map((f, i) =>
            `($1, $${i * 2 + 2}, $${i * 2 + 3})`
          ).join(', ');

          const featureParams = [plan.id];
          features.forEach(f => {
            featureParams.push(f.key);
            featureParams.push(parseInt(f.limit));
          });

          await client.query(
            `INSERT INTO plan_features (plan_id, feature_key, usage_limit)
             VALUES ${featureValues}
             ON CONFLICT (plan_id, feature_key)
             DO UPDATE SET usage_limit = EXCLUDED.usage_limit`,
            featureParams
          );
        }

        // D. Re-fetch with features
        const fullPlan = await client.query(`
          SELECT p.*,
                 COALESCE(
                   JSON_AGG(
                     JSON_BUILD_OBJECT('key', pf.feature_key, 'limit', pf.usage_limit)
                   ) FILTER (WHERE pf.feature_key IS NOT NULL),
                   '[]'::json
                 ) AS features
          FROM plans p
          LEFT JOIN plan_features pf ON p.id = pf.plan_id
          WHERE p.id = $1
          GROUP BY p.id
        `, [plan.id]);

        return fullPlan.rows[0];
      });

      eventBus.emit('plan.created', {
        planId: result.id,
        name: result.name
      });

      return res.status(201).json({
        message: `Plan "${result.name}" created successfully.`,
        plan: result
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 13. UPDATE PLAN  —  Update plan metadata and features.
  //     Body: { name?, description?, priceMonthly?, priceAnnually?,
  //             features?, displayOrder?, isFeatured?, badgeText? }
  // ───────────────────────────────────────────────────────────────────────────
  updatePlan: async (req, res, next) => {
    const { id } = req.params;
    const {
      name, description, priceMonthly, priceAnnually,
      features, displayOrder, isFeatured, badgeText
    } = req.body;

    // Validate feature keys if provided
    if (features) {
      for (const f of features) {
        if (!ALLOWED_FEATURE_KEYS.includes(f.key)) {
          return res.status(400).json({
            error: `Invalid feature key: "${f.key}". Allowed: ${ALLOWED_FEATURE_KEYS.join(', ')}`
          });
        }
      }
    }

    try {
      const result = await runWithoutRLS(async (client) => {
        // Verify plan exists
        const existing = await client.query('SELECT * FROM plans WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
          throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
        }

        // Build dynamic SET clause
        const sets = [];
        const params = [];
        let idx = 1;

        if (name !== undefined)         { sets.push(`name = $${idx++}`);          params.push(name); }
        if (description !== undefined)  { sets.push(`description = $${idx++}`);   params.push(description); }
        if (priceMonthly !== undefined) { sets.push(`price_monthly = $${idx++}`); params.push(parseFloat(priceMonthly)); }
        if (priceAnnually !== undefined){ sets.push(`price_annually = $${idx++}`); params.push(priceAnnually ? parseFloat(priceAnnually) : null); }
        if (displayOrder !== undefined) { sets.push(`display_order = $${idx++}`); params.push(displayOrder); }
        if (isFeatured !== undefined)   { sets.push(`is_featured = $${idx++}`);   params.push(isFeatured); }
        if (badgeText !== undefined)    { sets.push(`badge_text = $${idx++}`);    params.push(badgeText || null); }

        if (sets.length > 0) {
          params.push(id);
          await client.query(
            `UPDATE plans SET ${sets.join(', ')} WHERE id = $${idx}`,
            params
          );
        }

        // Replace features if provided
        if (features) {
          await client.query('DELETE FROM plan_features WHERE plan_id = $1', [id]);

          if (features.length > 0) {
            const featureValues = features.map((f, i) =>
              `($1, $${i * 2 + 2}, $${i * 2 + 3})`
            ).join(', ');

            const featureParams = [id];
            features.forEach(f => {
              featureParams.push(f.key);
              featureParams.push(parseInt(f.limit));
            });

            await client.query(
              `INSERT INTO plan_features (plan_id, feature_key, usage_limit)
               VALUES ${featureValues}`,
              featureParams
            );
          }
        }

        // Re-fetch
        const fullPlan = await client.query(`
          SELECT p.*,
                 COALESCE(
                   JSON_AGG(
                     JSON_BUILD_OBJECT('key', pf.feature_key, 'limit', pf.usage_limit)
                   ) FILTER (WHERE pf.feature_key IS NOT NULL),
                   '[]'::json
                 ) AS features,
                 (
                   SELECT COUNT(DISTINCT s.tenant_id)
                   FROM subscriptions s
                   WHERE s.plan_id = p.id AND s.status = 'active'
                 ) AS active_subscribers
          FROM plans p
          LEFT JOIN plan_features pf ON p.id = pf.plan_id
          WHERE p.id = $1
          GROUP BY p.id
        `, [id]);

        return fullPlan.rows[0];
      });

      return res.json({
        message: `Plan "${result.name}" updated successfully.`,
        plan: result
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 14. ARCHIVE PLAN  —  Soft-delete by setting is_active = false.
  //     Existing subscribers are NOT affected.
  // ───────────────────────────────────────────────────────────────────────────
  archivePlan: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE plans SET is_active = false WHERE id = $1 AND is_active = true
           RETURNING id, name, is_active`,
          [id]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Plan not found or already archived.' });
      }

      return res.json({
        message: `Plan "${result.rows[0].name}" has been archived. Existing subscribers are unaffected.`,
        plan: result.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 15. RESTORE PLAN  —  Re-activate an archived plan.
  // ───────────────────────────────────────────────────────────────────────────
  restorePlan: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE plans SET is_active = true WHERE id = $1 AND is_active = false
           RETURNING id, name, is_active`,
          [id]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Plan not found or already active.' });
      }

      return res.json({
        message: `Plan "${result.rows[0].name}" has been restored and is now visible to tenants.`,
        plan: result.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // getMasterNotifications  —  Badge counts for the master admin sidebar.
  //   Returns: newTenants (last 7d), inactiveTenants, overdueInvoices, pendingBilling
  // ───────────────────────────────────────────────────────────────────────────
  getMasterNotifications: async (req, res, next) => {
    try {
      const counts = await runWithoutRLS(async (client) => {
        const [tenantRes, billingRes] = await Promise.all([
          client.query(`
            SELECT
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS new_tenants,
              COUNT(*) FILTER (WHERE status = 'suspended')                     AS inactive_tenants
            FROM tenants
          `),
          client.query(`
            SELECT
              COUNT(*) FILTER (WHERE status = 'overdue')  AS overdue_invoices,
              COUNT(*) FILTER (WHERE status = 'pending')  AS pending_billing
            FROM platform_billing_invoices
          `)
        ]);

        const t = tenantRes.rows[0];
        const b = billingRes.rows[0];

        const feed = [];

        // Fetch recent new tenants
        const newTenantsQuery = await client.query(`
          SELECT id, name, created_at
          FROM tenants
          WHERE created_at >= NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC
          LIMIT 5
        `);
        newTenantsQuery.rows.forEach(t => {
          feed.push({
            id: `tenant-new-${t.id}`,
            type: 'tenant',
            title: `New Tenant: ${t.name}`,
            message: 'Signed up recently',
            actionUrl: `/master/tenants/${t.id}`,
            date: t.created_at,
            status: 'info'
          });
        });

        // Fetch suspended tenants
        const suspendedTenantsQuery = await client.query(`
          SELECT id, name, created_at
          FROM tenants
          WHERE status = 'suspended'
          ORDER BY created_at DESC
          LIMIT 5
        `);
        suspendedTenantsQuery.rows.forEach(t => {
          feed.push({
            id: `tenant-susp-${t.id}`,
            type: 'tenant',
            title: `Suspended: ${t.name}`,
            message: 'Tenant account suspended',
            actionUrl: `/master/tenants/${t.id}`,
            date: t.created_at,
            status: 'danger'
          });
        });

        // Fetch overdue invoices
        const overdueInvoicesQuery = await client.query(`
          SELECT id, invoice_number, total_amount, due_date
          FROM platform_billing_invoices
          WHERE status = 'overdue'
          ORDER BY due_date ASC
          LIMIT 5
        `);
        overdueInvoicesQuery.rows.forEach(inv => {
          feed.push({
            id: `billing-overdue-${inv.id}`,
            type: 'billing',
            title: `Overdue: ${inv.invoice_number}`,
            message: `Amount: ₹${parseFloat(inv.total_amount).toFixed(2)}`,
            actionUrl: `/master/billing`,
            date: inv.due_date,
            status: 'danger'
          });
        });

        // Sort feed by date descending
        feed.sort((a, b) => new Date(b.date) - new Date(a.date));

        return {
          newTenants:      parseInt(t.new_tenants,      10),
          inactiveTenants: parseInt(t.inactive_tenants, 10),
          overdueInvoices: parseInt(b.overdue_invoices, 10),
          pendingBilling:  parseInt(b.pending_billing,  10),
          feed: feed.slice(0, 15) // Limit to top 15
        };
      });

      return res.json(counts);
    } catch (err) {
      next(err);
    }
  }
};

export default masterAdminController;

