import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';

const JWT_SECRET = process.env.JWT_SECRET;
const INVITE_TTL_HOURS = 72;
const STARTER_PLAN_ID = 'b3310000-0000-0000-0000-000000000001';
const STARTER_LOCK_DAYS = 7;

/**
 * Issues a signed JWT for the given user + tenant combination.
 * @param {{ id: string, email: string }} user
 * @param {{ id: string, name: string, domain: string|null, role: string }} tenant
 */
const issueToken = (user, tenant) =>
  jwt.sign(
    { id: user.id, email: user.email, tenantId: tenant.id },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

/**
 * Builds the default settings object for a brand-new tenant.
 * @param {string} name  - Tenant / business name
 * @param {string} email - Admin user's email
 */
const buildDefaultSettings = (name, email) => ({
  general_config: {
    fiscalYearStart: '01 Apr',
    fiscalYearEnd: '31 Mar',
    predefinedLineItems: []
  },
  business_info: {
    businessName: name,
    email,
    address: '',
    website: '',
    logoUrl: '',
    extraInfo: ''
  },
  invoice_config: {
    invoice: {
      prefix: 'INV-',
      suffix: '',
      autoIncrement: true,
      nextNumber: 1001,
      dueDateDays: 14,
      termsAndConditions: 'Payment is due within 14 days from invoice date.',
      footerNotes: 'Thank you for your business!',
      templateDesign: 'default'
    },
    quote: {
      prefix: 'QT-',
      suffix: '',
      autoIncrement: true,
      nextNumber: 1001,
      validityDays: 30,
      enableAcceptPortalButton: true,
      actionOnAccept: 'convert_to_invoice',
      termsAndConditions: 'Quotation valid for 30 days.',
      footerNotes: 'Looking forward to working with you.',
      templateDesign: 'default'
    }
  },
  tax_config: {
    pricesInclusiveOfTax: false,
    defaultTaxPercentage: 18.00,
    defaultTaxName: 'GST'
  },
  payments_config: {
    passGatewayFees: false,
    bankDetails: '',
    razorpayKeyId: '',
    currencyPosition: 'left',
    gpayNumber: '6300440316',
    bankName: 'HDFC Bank',
    bankAccountNumber: '50200092611852',
    bankAccountName: 'Ultrakey IT Solutions Pvt. Ltd.',
    bankIfsc: 'HDFC0000968',
    bankBranch: 'GACHIBOWLI',
    upiId: '6300440316@ybl'
  },
  email_templates: {
    quote_availability: {
      subject: 'Quotation {{document_number}} is ready',
      body: 'Hello {{client_name}},\n\nYour quotation is available here: {{portal_link}}'
    },
    invoice_availability: {
      subject: 'Invoice {{document_number}} generated',
      body: 'Hello {{client_name}},\n\nYour invoice is available here: {{portal_link}}'
    },
    payment_receipt: {
      subject: 'Payment receipt for {{document_number}}',
      body: 'Hello {{client_name}},\n\nWe have received your payment of {{amount}}. Thank you!'
    },
    payment_reminder: {
      subject: 'Urgent: Payment reminder for {{document_number}}',
      body: 'Hello {{client_name}},\n\nThis is a friendly reminder that invoice {{document_number}} was due on {{due_date}}.'
    }
  },
  translations: {
    invoice: 'Invoice',
    quote: 'Quotation',
    qty: 'Qty',
    rate: 'Rate',
    total: 'Total',
    subtotal: 'Subtotal',
    tax: 'Tax'
  }
});

/**
 * Seeds all standard resources for a brand-new tenant workspace:
 *   1. Default tenant_settings row
 *   2. Double-entry chart of accounts (ledger)
 *   3. Starter plan subscription in past_due state until payment completes
 *
 * Must be called inside an open transaction client that already has
 * `app.current_tenant_id` set via set_config.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @param {string} tenantName
 * @param {string} adminEmail
 */
const seedNewTenant = async (client, tenantId, tenantName, adminEmail) => {
  const defaults = buildDefaultSettings(tenantName, adminEmail);

  await client.query(
    `INSERT INTO tenant_settings
       (tenant_id, general_config, business_info, invoice_config,
        tax_config, payments_config, email_templates, translations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tenantId,
      defaults.general_config,
      defaults.business_info,
      defaults.invoice_config,
      defaults.tax_config,
      defaults.payments_config,
      defaults.email_templates,
      defaults.translations
    ]
  );

  await initializeLedgerAccounts(client, tenantId);

  const lockedUntil = new Date();
  lockedUntil.setDate(lockedUntil.getDate() + STARTER_LOCK_DAYS);

  await client.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
     VALUES ($1, $2, 'past_due', $3)`,
    [tenantId, STARTER_PLAN_ID, lockedUntil]
  );
};

/**
 * Tenant & User Auth Handlers.
 */
export const authController = {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. SIGNUP  —  Register a brand-new tenant + its first admin user.
  //    Safe against duplicate emails: PG error 23505 → 400 (not 500).
  // ─────────────────────────────────────────────────────────────────────────
  signup: async (req, res, next) => {
    const { name, domain, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Tenant name, email, and password are required.' });
    }

    try {
      const result = await runInTransaction(null, async (client) => {
        // A. Insert new tenant
        let tenant;
        try {
          const tenantResult = await client.query(
            `INSERT INTO tenants (name, domain, status)
              VALUES ($1, $2, 'active')
              RETURNING id, name, domain`,
            [name, domain || null]
          );
          tenant = tenantResult.rows[0];
        } catch (pgErr) {
          if (pgErr.code === '23505') {
            throw Object.assign(
              new Error('A tenant with this domain already exists.'),
              { statusCode: 400 }
            );
          }
          throw pgErr;
        }
        const tenantId = tenant.id;

        // ── Set RLS context NOW ──────────────────────────────────────────
        // All subsequent inserts into tenant-scoped tables require this.
        await client.query(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          [tenantId]
        );

        // B. Insert or retrieve global user
        let user;

        // Try creating a new user.
        // If email already exists, do nothing instead of throwing an error.
        const hashedPassword = await bcrypt.hash(password, 10);

        const userResult = await client.query(
          `
  INSERT INTO users (email, password_hash)
  VALUES ($1, $2)
  ON CONFLICT (email) DO NOTHING
  RETURNING id, email
  `,
          [email, hashedPassword]
        );

        if (userResult.rows.length > 0) {
          // New user created
          user = userResult.rows[0];
        } else {
          // User already exists
          const existingRes = await client.query(
            `
    SELECT id, email, password_hash
    FROM users
    WHERE email = $1
    `,
            [email]
          );

          const existing = existingRes.rows[0];

          const valid = await bcrypt.compare(
            password,
            existing.password_hash
          );

          if (!valid) {
            throw Object.assign(
              new Error(
                'Incorrect password for the existing account associated with this email.'
              ),
              { statusCode: 400 }
            );
          }

          user = {
            id: existing.id,
            email: existing.email
          };
        }

        // C. Associate user with tenant as 'admin'
        await client.query(
          `INSERT INTO tenant_users (tenant_id, user_id, role)
           VALUES ($1, $2, 'admin')`,
          [tenantId, user.id]
        );

        // D. Seed settings, ledger accounts, and starter subscription
        await seedNewTenant(client, tenantId, name, email);

        return { tenant, user };
      });

      const token = issueToken(result.user, { ...result.tenant, role: 'admin' });

      return res.status(201).json({
        message: 'Onboarding completed successfully.',
        token,
        user: result.user,
        activeTenant: { ...result.tenant, role: 'admin' }
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. LOGIN  —  Authenticate an existing user.
  //    Returns allTenants so the client can present a tenant picker if needed.
  // ─────────────────────────────────────────────────────────────────────────
  login: async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
      // Cross-tenant operation: users (global) + tenant_users (RLS) membership lookup.
      // Uses runWithoutRLS because the user may belong to multiple tenants and
      // we cannot set a single tenant context before knowing which tenants exist.
      const { user, tenants } = await runWithoutRLS(async (client) => {
        const userRes = await client.query(
          'SELECT id, email, password_hash FROM users WHERE email = $1',
          [email]
        );
        if (userRes.rows.length === 0) {
          return { user: null, tenants: [] };
        }

        const foundUser = userRes.rows[0];

        // Fetch all tenants this user belongs to, with their role per tenant.
        // Only ACTIVE tenants are returned — suspended tenants are filtered out.
        // If all of a user's tenants are suspended they will hit the check below
        // and receive a clear "workspace suspended" message.
        const tenantsRes = await client.query(
          `SELECT t.id, t.name, t.domain, tu.role, t.status
           FROM tenants t
           JOIN tenant_users tu ON t.id = tu.tenant_id
           WHERE tu.user_id = $1
           ORDER BY t.created_at ASC`,
          [foundUser.id]
        );

        return { user: foundUser, tenants: tenantsRes.rows };
      });

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      if (tenants.length === 0) {
        return res.status(403).json({ error: 'User is not associated with any active tenant.' });
      }

      // Check if all tenants are suspended — give the user a clear message.
      const activeTenants = tenants.filter((t) => t.status === 'active');
      const suspendedTenants = tenants.filter((t) => t.status === 'suspended');

      if (activeTenants.length === 0 && suspendedTenants.length > 0) {
        return res.status(403).json({
          error:
            'Your workspace has been suspended. ' +
            'Please contact Ultrakey IT Solutions support to resolve this.'
        });
      }

      // Auto-select the first ACTIVE tenant; client can call /switch-tenant to change context
      const primaryTenant = activeTenants[0];
      const token = issueToken({ id: user.id, email: user.email }, primaryTenant);

      return res.json({
        message: 'Login successful.',
        token,
        user: { id: user.id, email: user.email },
        activeTenant: primaryTenant,
        allTenants: activeTenants // only expose active tenants to the client picker
      });
    } catch (err) {
      next(err);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. SWITCH TENANT  —  Re-issue JWT scoped to a different tenant.
  //    Requires: authenticateToken (any valid JWT).
  //    The user must already be a member of the requested tenant.
  // ─────────────────────────────────────────────────────────────────────────
  switchTenant: async (req, res, next) => {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required.' });
    }

    try {
      // Cross-tenant membership check — uses runWithoutRLS because the caller's
      // current JWT may be scoped to a different tenant than the one being switched to.
      const memberRes = await runWithoutRLS(async (client) => {
        return client.query(
          `SELECT t.id, t.name, t.domain, tu.role
           FROM tenants t
           JOIN tenant_users tu ON t.id = tu.tenant_id
           WHERE tu.user_id = $1 AND t.id = $2`,
          [req.user.id, tenantId]
        );
      });

      if (memberRes.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have access to the requested tenant.' });
      }

      const tenant = memberRes.rows[0];
      const token = issueToken({ id: req.user.id, email: req.user.email }, tenant);

      return res.json({
        message: 'Tenant context switched.',
        token,
        activeTenant: tenant
      });
    } catch (err) {
      next(err);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4. INVITE  —  Admin creates an invite token for a specific email + role.
  //    Requires: authenticateToken + requireTenant + checkRole(['admin']).
  //    Calling again for the same (tenant, email) replaces the prior invite
  //    (via ON CONFLICT UPDATE) so the admin can resend without errors.
  // ─────────────────────────────────────────────────────────────────────────
  invite: async (req, res, next) => {
    const { email, role = 'member' } = req.body;
    const tenantId = req.tenantId;
    const invitedBy = req.user.id;

    if (!email) {
      return res.status(400).json({ error: 'email is required.' });
    }

    const allowedRoles = ['admin', 'billing', 'member'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${allowedRoles.join(', ')}.` });
    }

    try {
      // All queries wrapped in a single transaction with tenant RLS context.
      // tenant_users is RLS-protected, so we need runInTransaction(tenantId).
      // tenant_invites and tenants are global but safe to query inside the same txn.
      const inviteResult = await runInTransaction(tenantId, async (client) => {
        // Check if the email is already an active member of this tenant
        const alreadyMember = await client.query(
          `SELECT tu.role FROM tenant_users tu
           JOIN users u ON u.id = tu.user_id
           WHERE tu.tenant_id = $1 AND u.email = $2`,
          [tenantId, email]
        );
        if (alreadyMember.rows.length > 0) {
          throw Object.assign(
            new Error(`${email} is already a ${alreadyMember.rows[0].role} of this workspace.`),
            { statusCode: 409 }
          );
        }

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + INVITE_TTL_HOURS);

        // Upsert: if a pending invite already exists for this (tenant, email), refresh it
        const inviteRes = await client.query(
          `INSERT INTO tenant_invites (tenant_id, invited_by, email, role, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ON CONSTRAINT unique_pending_invite
           DO UPDATE SET
             role       = EXCLUDED.role,
             invited_by = EXCLUDED.invited_by,
             token      = gen_random_uuid(),
             expires_at = EXCLUDED.expires_at,
             used_at    = NULL
           RETURNING token, expires_at`,
          [tenantId, invitedBy, email, role, expiresAt]
        );

        const { token: invToken, expires_at: expiresAtResult } = inviteRes.rows[0];

        // Fetch tenant name for informational response (tenants table is global, no RLS)
        const tenantRes = await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
        const tenantName = tenantRes.rows[0]?.name || '';

        return { invToken, expiresAtResult, tenantName };
      });

      return res.status(201).json({
        message: `Invite created for ${email}.`,
        inviteToken: inviteResult.invToken,
        expiresAt: inviteResult.expiresAtResult,
        // Convenience: the admin can embed this token into a join link
        joinUrl: `${process.env.APP_URL || 'http://localhost:5173'}/join?token=${inviteResult.invToken}`,
        meta: { email, role, tenantName: inviteResult.tenantName }
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. JOIN  —  Redeem an invite token and enter the tenant workspace.
  //    Public endpoint — no auth token required.
  //    Two sub-paths:
  //      a) Email already has a `users` row → verify password + link + login.
  //      b) Email is brand-new → create user + link + login.
  //    In both cases the invite is marked used_at = NOW() (single-use).
  //
  //    Security notes:
  //    - Invite row is locked with SELECT ... FOR UPDATE to prevent race
  //      conditions where two concurrent requests both redeem the same token.
  //    - Existing users MUST provide the correct password to prove account
  //      ownership before being linked to the inviting tenant.
  // ─────────────────────────────────────────────────────────────────────────
  join: async (req, res, next) => {
    const { inviteToken, password } = req.body;

    if (!inviteToken || !password) {
      return res.status(400).json({ error: 'inviteToken and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    try {
      // Everything happens inside a single transaction:
      //   1. Lock + validate the invite (global tables, no RLS)
      //   2. Set RLS context for the target tenant
      //   3. Create/link user + insert tenant_users
      //   4. Mark invite as consumed
      const result = await runWithoutRLS(async (client) => {
        // ── Step 1: Atomically lock the invite row ──────────────────────
        // SELECT ... FOR UPDATE OF ti prevents a concurrent request from
        // reading the same unused invite row. WHERE used_at IS NULL ensures
        // we only match unconsumed invites (single-use enforcement).
        const inviteRes = await client.query(
          `SELECT ti.*, t.name AS tenant_name, t.domain AS tenant_domain
           FROM tenant_invites ti
           JOIN tenants t ON t.id = ti.tenant_id
           WHERE ti.token = $1 AND ti.used_at IS NULL
           FOR UPDATE OF ti`,
          [inviteToken]
        );

        if (inviteRes.rows.length === 0) {
          throw Object.assign(
            new Error('Invite token not found, already used, or revoked.'),
            { statusCode: 410 }
          );
        }

        const invite = inviteRes.rows[0];

        if (new Date() > new Date(invite.expires_at)) {
          throw Object.assign(
            new Error(`Invite expired on ${invite.expires_at.toISOString()}.`),
            { statusCode: 410 }
          );
        }

        // ── Step 2: Set RLS context for tenant_users insert ─────────────
        await client.query(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          [invite.tenant_id]
        );

        // ── Step 3: Resolve or create user ──────────────────────────────
        const existingUser = await client.query(
          'SELECT id, email, password_hash FROM users WHERE email = $1',
          [invite.email]
        );

        let user;

        if (existingUser.rows.length > 0) {
          // Path A: existing user — verify password before linking
          const existingRecord = existingUser.rows[0];

          const validPassword = await bcrypt.compare(password, existingRecord.password_hash);
          if (!validPassword) {
            throw Object.assign(
              new Error('Invalid password for existing account.'),
              { statusCode: 401 }
            );
          }

          user = { id: existingRecord.id, email: existingRecord.email };

          // Guard: they might already belong to this tenant (duplicate click)
          const alreadyLinked = await client.query(
            'SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
            [invite.tenant_id, user.id]
          );
          if (alreadyLinked.rows.length === 0) {
            await client.query(
              `INSERT INTO tenant_users (tenant_id, user_id, role)
               VALUES ($1, $2, $3)`,
              [invite.tenant_id, user.id, invite.role]
            );
          }
        } else {
          // Path B: brand-new user — hash password here, only when needed
          const passwordHash = await bcrypt.hash(password, 10);
          const userInsert = await client.query(
            `INSERT INTO users (email, password_hash)
             VALUES ($1, $2)
             RETURNING id, email`,
            [invite.email, passwordHash]
          );
          user = userInsert.rows[0];

          await client.query(
            `INSERT INTO tenant_users (tenant_id, user_id, role)
             VALUES ($1, $2, $3)`,
            [invite.tenant_id, user.id, invite.role]
          );
        }

        // ── Step 4: Mark invite as consumed (atomic — row is locked) ────
        await client.query(
          `UPDATE tenant_invites SET used_at = NOW() WHERE id = $1`,
          [invite.id]
        );

        return {
          user,
          tenant: {
            id: invite.tenant_id,
            name: invite.tenant_name,
            domain: invite.tenant_domain,
            role: invite.role
          }
        };
      });

      const token = issueToken(result.user, result.tenant);

      return res.status(201).json({
        message: `You have joined "${result.tenant.name}" as ${result.tenant.role}.`,
        token,
        user: result.user,
        activeTenant: result.tenant
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. CREATE TENANT  —  Allows a logged-in user to create a new tenant workspace.
  //    Requires: authenticateToken (any valid JWT).
  // ─────────────────────────────────────────────────────────────────────────
  createTenant: async (req, res, next) => {
    const { name, domain } = req.body;
    const userId = req.user.id;
    const email = req.user.email;

    if (!name) {
      return res.status(400).json({ error: 'Tenant name is required.' });
    }

    try {
      const result = await runInTransaction(null, async (client) => {
        // A. Insert new tenant
        let tenant;
        try {
          const tenantResult = await client.query(
            `INSERT INTO tenants (name, domain, status)
             VALUES ($1, $2, 'active')
             RETURNING id, name, domain`,
            [name, domain || null]
          );
          tenant = tenantResult.rows[0];
        } catch (pgErr) {
          if (pgErr.code === '23505') {
            throw Object.assign(
              new Error('A tenant with this domain already exists.'),
              { statusCode: 400 }
            );
          }
          throw pgErr;
        }
        const tenantId = tenant.id;

        // ── Set RLS context NOW ──────────────────────────────────────────
        // All subsequent inserts into tenant-scoped tables require this.
        await client.query(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          [tenantId]
        );

        // B. Associate user with tenant as 'admin'
        await client.query(
          `INSERT INTO tenant_users (tenant_id, user_id, role)
           VALUES ($1, $2, 'admin')`,
          [tenantId, userId]
        );

        // C. Seed settings, ledger accounts, and starter subscription
        await seedNewTenant(client, tenantId, name, email);

        return { tenant, user: { id: userId, email } };
      });

      const token = issueToken(result.user, { ...result.tenant, role: 'admin' });

      return res.status(201).json({
        message: 'Tenant workspace created successfully.',
        token,
        user: result.user,
        activeTenant: { ...result.tenant, role: 'admin' }
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  },

  listUsers: async (req, res, next) => {
    try {
      const usersList = await runInTransaction(req.tenantId, async (client) => {
        const result = await client.query(
          `SELECT u.id, u.email, tu.role, u.created_at
           FROM tenant_users tu
           JOIN users u ON u.id = tu.user_id
           WHERE tu.tenant_id = $1
           ORDER BY tu.role DESC, u.created_at ASC`,
          [req.tenantId]
        );
        return result.rows;
      });

      return res.json(usersList);
    } catch (err) {
      next(err);
    }
  }
};

export default authController;
