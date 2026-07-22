import { runInTransaction } from '../config/db.js';
import pool from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { createPlatformInvoice } from './platformBillingController.js';
import eventBus from '../services/eventBus.js';

/**
 * Controller managing platform subscription plans and subscription order checks.
 * Supports any active plan — no longer hardcoded to a single Starter plan.
 */
export const subscriptionController = {
  getStatus: async (req, res, next) => {
    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        const subRes = await client.query(
          `SELECT s.id, s.status, s.current_period_end,
                  p.id AS plan_id, p.name AS plan_name, p.price_monthly,
                  p.description AS plan_description
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
           WHERE s.tenant_id = $1
           ORDER BY s.created_at DESC
           LIMIT 1`,
          [req.tenantId]
        );

        if (subRes.rows[0]) {
          const sub = subRes.rows[0];
          // Auto-expire active subscriptions whose period end has passed
          if (sub.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
            await client.query(
              `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
              [sub.id]
            );
            sub.status = 'expired';
          }
        }

        // Also fetch plan features for the plan
        let features = [];
        if (subRes.rows[0]) {
          const featRes = await client.query(
            `SELECT feature_key AS key, usage_limit AS limit
             FROM plan_features WHERE plan_id = $1`,
            [subRes.rows[0].plan_id]
          );
          features = featRes.rows;
        }

        return subRes.rows[0]
          ? { ...subRes.rows[0], features }
          : null;
      });

      const isSubActive = result?.status === 'active' && result?.current_period_end
        ? new Date(result.current_period_end) >= new Date()
        : result?.status === 'active';

      return res.json({
        subscription: result,
        isActive: isSubActive
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 1. Lists all available SaaS subscription plans and their feature gates.
   *    Returns only active plans, ordered by display_order.
   */
  getPlans: async (req, res, next) => {
    try {
      // Query global plans table (no RLS needed — plans are global)
      const plansRes = await pool.query(
        `SELECT p.id, p.name, p.description, p.price_monthly, p.price_annually,
                p.external_product_id, p.is_featured, p.display_order, p.badge_text,
                COALESCE(
                  JSON_AGG(
                    JSON_BUILD_OBJECT('key', pf.feature_key, 'limit', pf.usage_limit)
                  ) FILTER (WHERE pf.feature_key IS NOT NULL),
                  '[]'::json
                ) AS features
         FROM plans p
         LEFT JOIN plan_features pf ON p.id = pf.plan_id
         WHERE p.is_active = true
         GROUP BY p.id, p.name, p.description, p.price_monthly, p.price_annually,
                  p.external_product_id, p.is_featured, p.display_order, p.badge_text
         ORDER BY p.display_order ASC, p.price_monthly ASC`
      );

      return res.json(plansRes.rows);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Spawns a subscription checkout order in Razorpay.
   *    Accepts any valid, active planId.
   */
  initializeCheckout: async (req, res, next) => {
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'planId is required.' });
    }

    try {
      const checkoutDetails = await runInTransaction(req.tenantId, async (client) => {
        // A. Load plan detail — must be active
        const planRes = await client.query(
          `SELECT id, external_product_id, name, price_monthly, description
           FROM plans WHERE id = $1 AND is_active = true`,
          [planId]
        );

        if (planRes.rows.length === 0) {
          throw Object.assign(new Error('Plan not found or is no longer available.'), { statusCode: 400 });
        }

        const plan = planRes.rows[0];

        // Check if there is already an active non-expired subscription
        const activeSubCheck = await client.query(
          "SELECT id FROM subscriptions WHERE tenant_id = $1 AND status = 'active' AND current_period_end >= NOW()",
          [req.tenantId]
        );
        if (activeSubCheck.rows.length > 0) {
          throw Object.assign(new Error('This workspace already has an active subscription.'), { statusCode: 400 });
        }

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

        // C. Create a Razorpay order for the plan amount
        const rzpOrder = await razorpayService.createOrder({
          amountInRupees: plan.price_monthly,
          receipt: `sub_${req.tenantId.slice(0, 8)}_${Date.now()}`,
          notes: {
            tenant_id: req.tenantId,
            plan_id: plan.id,
            purpose: 'subscription_payment'
          }
        });

        // D. Keep the subscription locked until payment verification completes.
        const checkSub = await client.query(
          'SELECT id FROM subscriptions WHERE tenant_id = $1',
          [req.tenantId]
        );

        if (checkSub.rows.length > 0) {
          await client.query(
            `UPDATE subscriptions 
             SET plan_id = $1, status = 'past_due', external_subscription_id = $2
             WHERE tenant_id = $3`,
            [planId, rzpOrder.id, req.tenantId]
          );
        } else {
          const lockedUntil = new Date();
          lockedUntil.setDate(lockedUntil.getDate() + 7);
          await client.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, external_subscription_id, current_period_end)
             VALUES ($1, $2, 'past_due', $3, $4)`,
            [req.tenantId, planId, rzpOrder.id, lockedUntil]
          );
        }

        return {
          order: rzpOrder,
          keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey',
          mockMode: razorpayService.isMockMode,
          planName: plan.name,
          amount: plan.price_monthly,
          adminEmail: email
        };
      });

      return res.json({
        message: checkoutDetails.mockMode
          ? 'Mock payment order created.'
          : 'Payment order created.',
        data: checkoutDetails
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  verifyCheckout: async (req, res, next) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ error: 'Payment verification payload is incomplete.' });
    }

    try {
      const isValid = razorpayService.verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });

      if (!isValid) {
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }

      const result = await runInTransaction(req.tenantId, async (client) => {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // Find the pending subscription by the order ID (works for any plan)
        const updated = await client.query(
          `UPDATE subscriptions
           SET status = 'active',
               current_period_end = $1,
               external_subscription_id = $2
           WHERE tenant_id = $3
             AND external_subscription_id = $4
             AND status = 'past_due'
           RETURNING id, plan_id, status, current_period_end`,
          [periodEnd, razorpay_payment_id, req.tenantId, razorpay_order_id]
        );

        if (updated.rows.length === 0) {
          throw Object.assign(new Error('No pending payment found for this workspace.'), { statusCode: 404 });
        }

        const activatedSub = updated.rows[0];

        // Fetch plan details for the billing invoice
        const planRes = await client.query('SELECT price_monthly FROM plans WHERE id = $1', [activatedSub.plan_id]);
        const planPrice = planRes.rows[0]?.price_monthly || 0;

        // Create paid platform invoice record for master admin visibility
        await createPlatformInvoice(client, {
          tenantId: req.tenantId,
          planId: activatedSub.plan_id,
          amount: planPrice,
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          status: 'paid'
        });

        return activatedSub;
      });

      eventBus.emit('subscription.created', {
        tenantId: req.tenantId,
        planId: result.plan_id
      });

      return res.json({
        message: 'Subscription activated successfully.',
        subscription: result
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  getTenantInvoices: async (req, res, next) => {
    try {
      const invoices = await runInTransaction(req.tenantId, async (client) => {
        const queryRes = await client.query(
          `SELECT bi.*, p.name AS plan_name
           FROM platform_billing_invoices bi
           LEFT JOIN plans p ON p.id = bi.plan_id
           WHERE bi.tenant_id = $1
           ORDER BY bi.created_at DESC`,
          [req.tenantId]
        );
        return queryRes.rows;
      });
      return res.json(invoices);
    } catch (err) {
      next(err);
    }
  },

  initializeInvoicePayment: async (req, res, next) => {
    const { invoiceId } = req.params;
    try {
      const checkoutDetails = await runInTransaction(req.tenantId, async (client) => {
        const invRes = await client.query(
          `SELECT * FROM platform_billing_invoices WHERE tenant_id = $1 AND id = $2`,
          [req.tenantId, invoiceId]
        );
        if (invRes.rows.length === 0) {
          throw Object.assign(new Error('Platform Invoice not found for this workspace.'), { statusCode: 404 });
        }
        const invoice = invRes.rows[0];
        if (invoice.status === 'paid') {
          throw Object.assign(new Error('Invoice has already been settled.'), { statusCode: 400 });
        }


        const rzpOrder = await razorpayService.createOrder({
          amountInRupees: parseFloat(invoice.total_amount),
          receipt: `bill_${invoice.invoice_number.slice(-8)}_${Date.now()}`,
          notes: {
            tenant_id: req.tenantId,
            invoice_id: invoice.id,
            purpose: 'platform_invoice_payment'
          }
        });

        await client.query(
          `UPDATE platform_billing_invoices SET razorpay_order_id = $1 WHERE id = $2`,
          [rzpOrder.id, invoice.id]
        );

        return {
          order: rzpOrder,
          keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey',
          mockMode: razorpayService.isMockMode,
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount
        };
      });

      return res.json({
        message: 'Platform invoice payment order prepared.',
        data: checkoutDetails
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  verifyInvoicePayment: async (req, res, next) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ error: 'Payment verification payload is incomplete.' });
    }

    try {
      const isValid = razorpayService.verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });

      if (!isValid) {
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }

      const result = await runInTransaction(req.tenantId, async (client) => {
        const invRes = await client.query(
          `SELECT * FROM platform_billing_invoices WHERE tenant_id = $1 AND razorpay_order_id = $2 FOR UPDATE`,
          [req.tenantId, razorpay_order_id]
        );

        if (invRes.rows.length === 0) {
          throw Object.assign(new Error('Invoice not found or order ID mismatch.'), { statusCode: 404 });
        }

        const invoice = invRes.rows[0];
        if (invoice.status === 'paid') {
          return invoice;
        }

        const updated = await client.query(
          `UPDATE platform_billing_invoices
           SET status = 'paid',
               paid_at = NOW(),
               razorpay_payment_id = $1
           WHERE id = $2
           RETURNING *`,
          [razorpay_payment_id, invoice.id]
        );

        const tenantRes = await client.query(
          `SELECT status FROM tenants WHERE id = $1`,
          [req.tenantId]
        );
        if (tenantRes.rows.length > 0 && tenantRes.rows[0].status === 'suspended') {
          await client.query(
            `UPDATE tenants SET status = 'active' WHERE id = $1`,
            [req.tenantId]
          );
          console.log(`[Subscription Controller] Activated suspended tenant workspace: ${req.tenantId}`);
        }

        return updated.rows[0];
      });

      eventBus.emit('platform_billing.paid', {
        invoiceId: result.id,
        invoiceNumber: result.invoice_number,
        tenantId: req.tenantId,
        amount: result.total_amount
      });

      return res.json({
        message: 'Platform invoice payment processed successfully.',
        invoice: result
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  }
};

export default subscriptionController;
