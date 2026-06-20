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
    // 1. Fixture Setup
    await runWithoutRLS(async (client) => {
      // Clear previous test records
      await client.query('DELETE FROM platform_billing_invoices WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM subscriptions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);

      // Insert fresh fixtures
      await client.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Double Pay Test Tenant', 'active')", [mockTenantId]);
      await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'test@doublepay.local', 'hash')", [mockUserId]);
      await client.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [mockTenantId, mockUserId]);
    });

    console.log('[OK] Database fixtures initialized.');

    // 2. Case A: Subscription is INACTIVE
    console.log('-> Testing initializeCheckout when subscription is INACTIVE...');
    let checkoutData = null;
    let errCheckout = null;

    const mockResCheckout = {
      json: (data) => {
        checkoutData = data;
      }
    };

    const mockReqCheckout = {
      tenantId: mockTenantId,
      body: { planId: STARTER_PLAN_ID }
    };

    await subscriptionController.initializeCheckout(mockReqCheckout, mockResCheckout, (err) => {
      errCheckout = err;
    });

    if (errCheckout) {
      throw errCheckout;
    }
    console.log('   * Success! Inactive checkout initialized:', checkoutData.message);

    // Let's create an invoice for this tenant to test invoice payment
    let invoiceId = null;
    await runWithoutRLS(async (client) => {
      const now = new Date();
      const insertRes = await client.query(
        `INSERT INTO platform_billing_invoices
           (tenant_id, plan_id, invoice_number, billing_period_start, billing_period_end,
            amount, tax_percentage, tax_amount, total_amount, status, due_date)
         VALUES ($1, $2, 'UKEY-BILL-MOCK-TEST1', $3, $4, 999.00, 18.00, 179.82, 1178.82, 'pending', $5)
         RETURNING id`,
        [mockTenantId, STARTER_PLAN_ID, now, now, now]
      );
      invoiceId = insertRes.rows[0].id;
    });

    console.log('-> Testing initializeInvoicePayment when subscription is INACTIVE...');
    let payInvoiceData = null;
    let errPayInvoice = null;

    const mockResPay = {
      json: (data) => {
        payInvoiceData = data;
      }
    };

    const mockReqPay = {
      tenantId: mockTenantId,
      params: { invoiceId }
    };

    await subscriptionController.initializeInvoicePayment(mockReqPay, mockResPay, (err) => {
      errPayInvoice = err;
    });

    if (errPayInvoice) {
      throw errPayInvoice;
    }
    console.log('   * Success! Inactive invoice payment initialized:', payInvoiceData.message);

    // 3. Case B: Subscription is ACTIVE
    console.log('-> Setting subscription status to ACTIVE in database...');
    await runWithoutRLS(async (client) => {
      await client.query(
        `UPDATE subscriptions
         SET status = 'active', current_period_end = NOW() + INTERVAL '30 days'
         WHERE tenant_id = $1`,
        [mockTenantId]
      );
    });

    console.log('-> Testing initializeCheckout when subscription is ACTIVE...');
    let checkoutErrStatus = null;
    let checkoutErrJson = null;

    const mockResCheckoutActive = {
      status: (code) => {
        checkoutErrStatus = code;
        return {
          json: (data) => {
            checkoutErrJson = data;
          }
        };
      },
      json: (data) => {
        checkoutErrJson = data;
      }
    };

    await subscriptionController.initializeCheckout(mockReqCheckout, mockResCheckoutActive, (err) => {
      // should not trigger next(err) if handled with err.statusCode status response
    });

    console.log('   * Status:', checkoutErrStatus);
    console.log('   * Error:', checkoutErrJson);

    if (checkoutErrStatus !== 400 || !checkoutErrJson.error.includes('already has an active subscription')) {
      throw new Error('initializeCheckout failed to block checkout when active subscription exists');
    }
    console.log('   [OK] initializeCheckout correctly blocked duplicate checkout!');

    console.log('-> Testing initializeInvoicePayment when subscription is ACTIVE...');
    let payInvoiceErrStatus = null;
    let payInvoiceErrJson = null;

    const mockResPayActive = {
      status: (code) => {
        payInvoiceErrStatus = code;
        return {
          json: (data) => {
            payInvoiceErrJson = data;
          }
        };
      },
      json: (data) => {
        payInvoiceErrJson = data;
      }
    };

    await subscriptionController.initializeInvoicePayment(mockReqPay, mockResPayActive, (err) => {
      // should not trigger next(err) if handled with err.statusCode status response
    });

    console.log('   * Status:', payInvoiceErrStatus);
    console.log('   * Error:', payInvoiceErrJson);

    if (payInvoiceErrStatus !== 400 || !payInvoiceErrJson.error.includes('already has an active subscription')) {
      throw new Error('initializeInvoicePayment failed to block invoice payment when active subscription exists');
    }
    console.log('   [OK] initializeInvoicePayment correctly blocked invoice payment!');

    console.log('\n========================================================');
    console.log('   ALL DOUBLE PAYMENT PREVENTION TESTS PASSED!');
    console.log('========================================================');

  } catch (err) {
    console.error('\n[TEST FAILURE]:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    // Cleanup fixtures
    await runWithoutRLS(async (client) => {
      await client.query('DELETE FROM platform_billing_invoices WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM subscriptions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);
    });
    await pool.end();
  }
};

runTests();
