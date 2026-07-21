import jwt from 'jsonwebtoken';
import { runWithoutRLS } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET;

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
 *    → Validates tenant membership via tenant_users, sets req.tenantId + req.role.
 *    → Existing behaviour, unchanged.
 */
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // ── Path 1: Master Admin ─────────────────────────────────────────────────
    if (decoded.role === 'master_admin') {
      // Re-verify against DB — allows disabling a master admin mid-session.
      const adminRes = await runWithoutRLS(async (client) => {
        return client.query(
          'SELECT id, email, is_active, permissions FROM master_admins WHERE id = $1',
          [decoded.id]
        );
      });

      if (adminRes.rows.length === 0 || !adminRes.rows[0].is_active) {
        return res.status(403).json({
          error: 'Master admin account not found or has been disabled.'
        });
      }

      const adminRow = adminRes.rows[0];
      req.masterAdmin = {
        id: adminRow.id,
        email: adminRow.email,
        permissions: adminRow.permissions   // NULL = full access, array = restricted
      };
      // Also set req.user for any middleware that reads it generically.
      req.user = req.masterAdmin;
      return next();
    }

    // ── Path 2: Tenant User ───────────────────────────────────────────────────
    req.user = { id: decoded.id, email: decoded.email };

    // Tenant ID can come from header, query-string, or the JWT claim itself.
    const tenantId =
      req.headers['x-tenant-id'] || req.query.tenantId || decoded.tenantId;

    if (!tenantId) {
      // Some endpoints (e.g. /create-tenant, /switch-tenant) are valid without
      // a specific tenant context — let them pass and enforce via requireTenant.
      return next();
    }

    // Cross-tenant membership check — cannot use RLS here because the tenant
    // context has not been established yet; user_id filter prevents data leakage.
    const memberCheck = await runWithoutRLS(async (client) => {
      return client.query(
        'SELECT role, permissions FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, req.user.id]
      );
    });

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'Access denied: You do not belong to the requested tenant context'
      });
    }

    req.tenantId = tenantId;
    req.role = memberCheck.rows[0].role; // admin | billing | member
    req.permissions = memberCheck.rows[0].permissions; // null or array of keys

    next();
  } catch (err) {
    console.error('JWT authentication error:', err.message);
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }
};

/**
 * Restricts access to requests that carry a verified tenant context.
 * Use after authenticateToken on any tenant-scoped route.
 */
export const requireTenant = (req, res, next) => {
  if (req.masterAdmin) {
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body.tenantId;
    if (tenantId) {
      req.tenantId = tenantId;
      return next();
    }
  }
  if (!req.tenantId) {
    return res.status(400).json({
      error: 'Active tenant context (x-tenant-id header or parameter) is required'
    });
  }
  next();
};

/**
 * Role-Based Access Control (RBAC) enforcer for tenant roles.
 * @param {string[]} allowedRoles - Roles allowed to access the route.
 */
export const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (req.masterAdmin) {
      return next();
    }
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient privileges for this operation'
      });
    }
    next();
  };
};

/**
 * Role-Based Access Control (RBAC) enforcer for specific tenant sections.
 * @param {string} section - The section key (e.g. 'dashboard', 'quotes')
 */
export const requireTenantPermission = (section) => {
  return (req, res, next) => {
    // Master Admins doing global tenant overrides bypass section checks
    if (req.masterAdmin) {
      return next();
    }
    
    // Tenant Admins have full access
    if (req.role === 'admin') {
      return next();
    }

    // NULL permissions means full access (default for existing non-admin roles unless changed)
    if (req.permissions === null) {
      return next();
    }

    // Array of permissions
    if (Array.isArray(req.permissions) && req.permissions.includes(section)) {
      return next();
    }

    return res.status(403).json({
      error: `Forbidden: You do not have permission to access the '${section}' section.`
    });
  };
};

/**
 * Guards routes that are exclusively for the platform Master Admin.
 * Must be chained AFTER authenticateToken.
 *
 * Usage:
 *   router.get('/dashboard', authenticateToken, requireMasterAdmin, handler);
 */
export const requireMasterAdmin = (req, res, next) => {
  if (!req.masterAdmin) {
    return res.status(403).json({
      error: 'Forbidden: This endpoint requires Master Admin privileges.'
    });
  }
  next();
};

/**
 * RBAC permission guard for individual master admin sections.
 * Must be chained AFTER authenticateToken + requireMasterAdmin.
 *
 * If the admin's permissions field is NULL → full access (legacy/seed admins).
 * If the admin's permissions is a JSON array → must contain the required section.
 *
 * @param {string} section - One of: dashboard, plans, tenants, billing, admins
 *
 * Usage:
 *   router.get('/dashboard', ...guard, requireMasterPermission('dashboard'), handler);
 */
export const requireMasterPermission = (section) => {
  return (req, res, next) => {
    const perms = req.masterAdmin?.permissions;
    // NULL = full access (unrestricted)
    if (perms === null || perms === undefined) {
      return next();
    }
    // Array check — must include the section or wildcard
    if (Array.isArray(perms) && (perms.includes(section) || perms.includes('*'))) {
      return next();
    }
    return res.status(403).json({
      error: `Forbidden: You do not have access to the "${section}" section.`
    });
  };
};
