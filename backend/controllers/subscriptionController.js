import { runInTransaction } from '../config/db.js';
import pool from '../config/db.js';
import razorpayService from '../services/razorpayService.js';

/**
 * Controller managing platform subscription plans and subscription order checks.
 */
export const subscriptionController = {
  /**
   * 1. Lists all available SaaS subscription plans and their feature gates.
   */
  getPlans: async (req, res, next) => {
    try {
      // Query global plans table (no RLS)
      const plansRes = await pool.query(
        `SELECT p.id, p.name, p.price_monthly, p.external_product_id,
                JSON_AGG(JSON_BUILD_OBJECT('key', pf.feature_key, 'limit', pf.usage_limit)) as features
         FROM plans p
         LEFT JOIN plan_features pf ON p.id = pf.plan_id
         GROUP BY p.id, p.name, p.price_monthly, p.external_product_id
         ORDER BY p.price_monthly ASC`
      );

      return res.json(plansRes.rows);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Spawns a subscription checkout order in Razorpay.
   */
  initializeCheckout: async (req, res, next) => {
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'SaaS plan ID is required.' });
    }

    try {
      const checkoutDetails = await runInTransaction(req.tenantId, async (client) => {
        // A. Load plan detail
        const planRes = await client.query(
          'SELECT external_product_id, name FROM plans WHERE id = $1',
          [planId]
        );

        if (planRes.rows.length === 0) {
          throw new Error('SaaS Subscription Plan not found.');
        }

        const plan = planRes.rows[0];

        // B. Query tenant admin email to link payment profile
        const adminRes = await client.query(
          `SELECT u.email 
           FROM users u
           JOIN tenant_users tu ON u.id = tu.user_id
           WHERE tu.tenant_id = $1 AND tu.role = 'admin'
           LIMIT 1`,
          [req.tenantId]
        );
        const email = adminRes.rows[0]?.email || 'billing@tenant.local';

        // C. Trigger subscription contract creation in Razorpay
        const rzpSub = await razorpayService.createSubscription(plan.external_product_id, email);

        // D. Record the subscription link locally in active state (will fully settle when webhook fires)
        const checkSub = await client.query(
          'SELECT id FROM subscriptions WHERE tenant_id = $1',
          [req.tenantId]
        );

        const periodEnd = new Date(rzpSub.current_period_end * 1000);

        if (checkSub.rows.length > 0) {
          await client.query(
            `UPDATE subscriptions 
             SET plan_id = $1, status = 'active', current_period_end = $2, external_subscription_id = $3
             WHERE tenant_id = $4`,
            [planId, periodEnd, rzpSub.id, req.tenantId]
          );
        } else {
          await client.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end, external_subscription_id)
             VALUES ($1, $2, 'active', $3, $4)`,
            [req.tenantId, planId, periodEnd, rzpSub.id]
          );
        }

        return {
          subscriptionId: rzpSub.id,
          planName: plan.name,
          adminEmail: email
        };
      });

      return res.json({
        message: 'Subscription payment contract registered.',
        data: checkoutDetails
      });
    } catch (err) {
      next(err);
    }
  }
};

export default subscriptionController;
