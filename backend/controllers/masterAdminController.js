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
  );

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
          'SELECT id, email, password_hash, is_active FROM master_admins WHERE email = $1',
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

      const token = issueMasterToken({ id: admin.id, email: admin.email });

      return res.json({
        message: 'Master admin login successful.',
        token,
        admin: { id: admin.id, email: admin.email }
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
          conditions.push(`t.status = $${idx++}`);
          params.push(status);
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
             LEFT JOIN subscriptions s  ON s.tenant_id = t.id AND s.status = 'active'
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
            `SELECT COUNT(*) FROM tenants t ${where}`,
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
          `SELECT id, email, is_active, created_at, last_login_at
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
  }
};

export default masterAdminController;
