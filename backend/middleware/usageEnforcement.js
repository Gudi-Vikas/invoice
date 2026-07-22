import { runInTransaction } from '../config/db.js';

/**
 * Usage Enforcement Middleware Factory
 *
 * Checks if a tenant has exceeded their plan's usage limits before allowing
 * resource creation. Returns 403 with a clear error if the limit is reached.
 *
 * @param {string} featureKey - The plan_features.feature_key to check (e.g. 'max_clients')
 * @param {string} tableName  - The DB table to count rows in (e.g. 'clients')
 * @param {Object} [opts]
 * @param {string} [opts.countFilter] - Additional SQL WHERE clause for counting (e.g. "AND type = 'invoice'")
 * @param {boolean} [opts.monthly]    - If true, only count rows created in the current month
 */
export const enforceLimit = (featureKey, tableName, opts = {}) => {
  return async (req, res, next) => {
    // Skip enforcement for master admins
    if (req.masterAdmin) return next();

    // Skip if no tenant context
    if (!req.tenantId) return next();

    try {
      const check = await runInTransaction(req.tenantId, async (client) => {
        // 1. Get the tenant's active plan features
        const subRes = await client.query(
          `SELECT pf.usage_limit
           FROM subscriptions s
           JOIN plan_features pf ON pf.plan_id = s.plan_id AND pf.feature_key = $2
           WHERE s.tenant_id = $1 AND s.status = 'active' AND s.current_period_end >= CURRENT_TIMESTAMP
           ORDER BY s.created_at DESC
           LIMIT 1`,
          [req.tenantId, featureKey]
        );

        // No active subscription or no feature limit defined → allow
        if (subRes.rows.length === 0) {
          return { allowed: true };
        }

        const limit = subRes.rows[0].usage_limit;

        // -1 = unlimited
        if (limit === -1) {
          return { allowed: true, limit: -1 };
        }

        // 2. Count current usage
        let countQuery = `SELECT COUNT(*) AS count FROM ${tableName} WHERE tenant_id = $1`;
        const countParams = [req.tenantId];

        // Monthly counting for per-month limits
        if (opts.monthly) {
          countQuery += ` AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
        }

        // Additional filter (e.g. document type)
        if (opts.countFilter) {
          countQuery += ` ${opts.countFilter}`;
        }

        const countRes = await client.query(countQuery, countParams);
        const currentCount = parseInt(countRes.rows[0].count);

        return {
          allowed: currentCount < limit,
          currentCount,
          limit
        };
      });

      if (!check.allowed) {
        const limitLabel = featureKey.replace(/_/g, ' ').replace(/^max /, '');
        return res.status(403).json({
          error: `Plan limit reached: You have used ${check.currentCount} of ${check.limit} ${limitLabel}. Please upgrade your plan to continue.`,
          code: 'PLAN_LIMIT_EXCEEDED',
          featureKey,
          currentUsage: check.currentCount,
          limit: check.limit
        });
      }

      next();
    } catch (err) {
      // Don't block operations if enforcement check fails — log and allow
      console.error(`[UsageEnforcement] Check failed for ${featureKey}:`, err.message);
      next();
    }
  };
};

export default enforceLimit;
