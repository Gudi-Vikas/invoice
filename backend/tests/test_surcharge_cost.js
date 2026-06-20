import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';
import { portalController } from '../controllers/portalController.js';
import { postInvoiceLedger } from '../services/ledgerService.js';

console.log('========================================================');
console.log('   Invoice SaaS - Gateway Surcharge & Vendor Cost Tests');
console.log('========================================================');

const mockTenantId = 'b3333333-3333-3333-3333-333333333333';
const mockUserId = 'c3333333-3333-3333-3333-333333333333';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const runTests = async () => {
  try {
    // 1. Database Fixtures Setup
    await runWithoutRLS(async (client) => {
      // Clear previous test records
      await client.query('DELETE FROM transfers WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_accounts WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM document_lines WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM documents WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM vendors WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM clients WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);

      // Insert fresh fixtures
      await client.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Surcharge & Cost Test Tenant', 'active')", [mockTenantId]);
      await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'test@surcharge.local', 'hash')", [mockUserId]);
      await client.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [mockTenantId, mockUserId]);

      // Set tenant context to seed ledger accounts
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [mockTenantId]);
      await initializeLedgerAccounts(client, mockTenantId);
    });

    console.log('[OK] Database fixtures & ledger accounts initialized.');

    // 2. Insert Client & Vendor & Settings with passGatewayFees = false
    let mockClientId = null;
    let mockVendorId = null;
    let mockInvoiceId1 = null;

    await runInTransaction(mockTenantId, async (client) => {
      // Client
      const clientRes = await client.query(
        "INSERT INTO clients (tenant_id, name, email) VALUES ($1, 'Bob Client', 'bob@client.local') RETURNING id",
        [mockTenantId]
      );
      mockClientId = clientRes.rows[0].id;

      // Vendor
      const vendorRes = await client.query(
        `INSERT INTO vendors (tenant_id, business_name, email, platform_fee_percentage, kyc_status)
         VALUES ($1, 'Bob Reseller', 'bob@reseller.local', 10.00, 'active') RETURNING id`,
        [mockTenantId]
      );
      mockVendorId = vendorRes.rows[0].id;

      // Linked Account for Razorpay Route routing
      await client.query(
        `INSERT INTO linked_accounts (vendor_id, tenant_id, razorpay_account_id, status)
         VALUES ($1, $2, 'acc_bob_test_12345', 'active')`,
        [mockVendorId, mockTenantId]
      );

      // Settings: passGatewayFees = false
      await client.query(
        `INSERT INTO tenant_settings (tenant_id, general_config, business_info, invoice_config, tax_config, email_templates, translations, payments_config)
         VALUES ($1, '{}', '{"businessName": "Surcharge Corp"}', '{}', '{"currencySymbol": "₹", "defaultTaxPercentage": 18.00}', '{}', '{}', '{"passGatewayFees": false}')`,
        [mockTenantId]
      );
    });

    console.log('[OK] Client, Vendor, Linked Account, and Settings (passGatewayFees: false) inserted.');

    // 3. Test Case A: Create invoice, verify postInvoiceLedger with custom vendor_cost
    await runInTransaction(mockTenantId, async (client) => {
      // Create Invoice
      const docRes = await client.query(
        `INSERT INTO documents (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date)
         VALUES ($1, $2, 'invoice', 'INV-SURCHARGE-101', 'published', 1000.00, 0, 180.00, 1180.00, NOW() + INTERVAL '7 days') RETURNING id`,
        [mockTenantId, mockClientId]
      );
      mockInvoiceId1 = docRes.rows[0].id;

      // Create Document Line with explicit vendor_cost (₹800.00 cost price instead of percent platform fee)
      await client.query(
        `INSERT INTO document_lines (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, vendor_cost, sort_order)
         VALUES ($1, $2, 1, 'Consulting Services', 1000.00, 0, 1000.00, $3, 800.00, 0)`,
        [mockInvoiceId1, mockTenantId, mockVendorId]
      );

      // Post Invoice Ledger
      await postInvoiceLedger(client, mockTenantId, 'INV-SURCHARGE-101', 1000.00, 180.00, 1180.00, mockInvoiceId1);

      // Validate postInvoiceLedger entries
      const entriesRes = await client.query(
        `SELECT la.code, le.debit, le.credit FROM ledger_entries le
         JOIN ledger_accounts la ON le.account_id = la.id
         WHERE le.tenant_id = $1
         ORDER BY la.code`,
        [mockTenantId]
      );

      console.log('-> Invoice Ledger Entries:');
      let foundAR = false;
      let foundVendorPayable = false;
      let foundRevenue = false;
      let foundTax = false;

      for (const row of entriesRes.rows) {
        console.log(`   * Account: ${row.code} | Debit: ${row.debit} | Credit: ${row.credit}`);
        if (row.code === 'AR_DEFAULT') {
          if (parseFloat(row.debit) !== 1180.00) throw new Error('Incorrect AR debit');
          foundAR = true;
        }
        if (row.code === 'VENDOR_PAYABLE_DEFAULT') {
          if (parseFloat(row.credit) !== 800.00) throw new Error('Incorrect Vendor Payable credit (should be vendor_cost * quantity)');
          foundVendorPayable = true;
        }
        if (row.code === 'REV_DEFAULT') {
          // REV_DEFAULT credit should be subtotal - totalVendorShare = 1000 - 800 = 200
          if (parseFloat(row.credit) !== 200.00) throw new Error('Incorrect Platform Revenue credit');
          foundRevenue = true;
        }
        if (row.code === 'TAX_DEFAULT') {
          if (parseFloat(row.credit) !== 180.00) throw new Error('Incorrect Tax credit');
          foundTax = true;
        }
      }

      if (!foundAR || !foundVendorPayable || !foundRevenue || !foundTax) {
        throw new Error('Missing invoice generation ledger postings.');
      }
    });

    console.log('[OK] Test Case A (postInvoiceLedger with vendor_cost) Passed.');

    // 4. Test Case B: initializePayment (passGatewayFees = false)
    console.log('-> Testing portal payment initialization (passGatewayFees: false)...');
    const token1 = jwt.sign(
      { documentId: mockInvoiceId1, tenantId: mockTenantId, type: 'invoice' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let initResponseData = null;
    const mockRes = {
      json: (data) => {
        initResponseData = data;
      }
    };

    await portalController.initializePayment(
      { params: { id: mockInvoiceId1 }, body: { token: token1 } },
      mockRes,
      (err) => { if (err) throw err; }
    );

    console.log('-> Payment Init Response:', initResponseData);
    if (parseFloat(initResponseData.data.amount) !== 1180.00) {
      throw new Error(`Expected checkout amount to be 1180.00, got ${initResponseData.data.amount}`);
    }
    if (parseFloat(initResponseData.data.surcharge) !== 0) {
      throw new Error(`Expected surcharge to be 0, got ${initResponseData.data.surcharge}`);
    }
    console.log('[OK] Test Case B (payment initialization without surcharge) Passed.');

    // 5. Test Case C: Update Settings to passGatewayFees = true, initializePayment again
    console.log('-> Updating payments settings to passGatewayFees = true...');
    await runInTransaction(mockTenantId, async (client) => {
      await client.query(
        `UPDATE tenant_settings SET payments_config = '{"passGatewayFees": true}' WHERE tenant_id = $1`,
        [mockTenantId]
      );
    });

    let mockInvoiceId2 = null;
    await runInTransaction(mockTenantId, async (client) => {
      // Create a second invoice
      const docRes = await client.query(
        `INSERT INTO documents (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date)
         VALUES ($1, $2, 'invoice', 'INV-SURCHARGE-102', 'published', 1000.00, 0, 180.00, 1180.00, NOW() + INTERVAL '7 days') RETURNING id`,
        [mockTenantId, mockClientId]
      );
      mockInvoiceId2 = docRes.rows[0].id;

      await client.query(
        `INSERT INTO document_lines (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, vendor_cost, sort_order)
         VALUES ($1, $2, 1, 'Consulting Services 2', 1000.00, 0, 1000.00, $3, 800.00, 0)`,
        [mockInvoiceId2, mockTenantId, mockVendorId]
      );

      await postInvoiceLedger(client, mockTenantId, 'INV-SURCHARGE-102', 1000.00, 180.00, 1180.00, mockInvoiceId2);
    });

    console.log('-> Testing portal payment initialization (passGatewayFees: true)...');
    const token2 = jwt.sign(
      { documentId: mockInvoiceId2, tenantId: mockTenantId, type: 'invoice' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let initResponseData2 = null;
    const mockRes2 = {
      json: (data) => {
        initResponseData2 = data;
      }
    };

    await portalController.initializePayment(
      { params: { id: mockInvoiceId2 }, body: { token: token2 } },
      mockRes2,
      (err) => { if (err) throw err; }
    );

    console.log('-> Surcharged Payment Init Response:', initResponseData2);
    const feeBase = 1180.00 * 0.02;
    const feeTax = feeBase * 0.18;
    const expectedSurchargedAmount = parseFloat((1180.00 + feeBase + feeTax).toFixed(4));
    const expectedSurcharge = parseFloat((feeBase).toFixed(4));

    console.log(`   * Expected payable: ${expectedSurchargedAmount} | Got: ${initResponseData2.data.amount}`);
    console.log(`   * Expected surcharge: ${expectedSurcharge} | Got: ${initResponseData2.data.surcharge}`);

    if (Math.abs(parseFloat(initResponseData2.data.amount) - expectedSurchargedAmount) > 0.01) {
      throw new Error('Surcharge payable calculation mismatch.');
    }
    if (Math.abs(parseFloat(initResponseData2.data.surcharge) - expectedSurcharge) > 0.01) {
      throw new Error('Surcharge calculation mismatch.');
    }
    console.log('[OK] Test Case C (payment initialization with surcharge) Passed.');

    // 6. Test Case D: verifyPayment webhook with passGatewayFees = true
    console.log('-> Simulating client checkout webhook verification with surcharge passGatewayFees = true...');
    // We invoke portalController.verifyPayment.
    // If passGatewayFees is true, verifyPayment calls postPaymentLedger with paidAmount = total_due, and gatewayFee = 0.
    const reqVerify = {
      params: { id: mockInvoiceId2 },
      body: {
        token: token2,
        razorpay_order_id: initResponseData2.data.orderId,
        razorpay_payment_id: 'pay_verify_surcharge_test_123',
        razorpay_signature: 'mock_signature' // Mock bypasses actual HMAC in mockMode
      }
    };

    let verifyResultData = null;
    const mockResVerify = {
      status: (code) => {
        return {
          json: (data) => {
            verifyResultData = data;
          }
        };
      },
      json: (data) => {
        verifyResultData = data;
      }
    };

    await portalController.verifyPayment(reqVerify, mockResVerify, (err) => { if (err) throw err; });
    console.log('-> Verify Payment Response:', verifyResultData);

    // Verify database status of document is updated to paid
    await runInTransaction(mockTenantId, async (client) => {
      const docCheck = await client.query('SELECT status FROM documents WHERE id = $1', [mockInvoiceId2]);
      console.log(`   * Document status: "${docCheck.rows[0].status}" (Expected: "paid")`);
      if (docCheck.rows[0].status !== 'paid') {
        throw new Error('Document status was not updated to paid after verification.');
      }

      // Check payment ledger entry: gatewayFee should be 0. Cash should receive full totalDue = 1180.00
      const ledgerCheck = await client.query(
        `SELECT la.code, SUM(COALESCE(le.debit, 0)) as debits, SUM(COALESCE(le.credit, 0)) as credits
         FROM ledger_entries le
         JOIN ledger_accounts la ON le.account_id = la.id
         JOIN ledger_transactions lt ON le.transaction_id = lt.id
         WHERE le.tenant_id = $1 AND lt.transaction_type = 'invoice_payment' AND lt.reference_id = $2
         GROUP BY la.code`,
        [mockTenantId, mockInvoiceId2]
      );

      console.log('-> Webhook Payment Ledger Postings:');
      let foundCASH = false;
      let foundFEE = false;
      let foundAR = false;

      for (const row of ledgerCheck.rows) {
        console.log(`   * Account: ${row.code} | Debit: ${row.debits} | Credit: ${row.credits}`);
        if (row.code === 'GATEWAY_CLEARING') {
          if (Math.abs(parseFloat(row.debits) - 1180.00) > 0.01) throw new Error('GATEWAY_CLEARING debit must be roughly 1180.00.');
          foundCASH = true;
        }
        if (row.code === 'AR_DEFAULT') {
          if (parseFloat(row.credits) !== 1180.00) throw new Error('AR_DEFAULT credit must be exactly total_due (1180.00) clearing receivables.');
          foundAR = true;
        }
        if (row.code === 'FEE_DEFAULT') {
          foundFEE = true;
        }
      }

      if (!foundCASH || !foundAR) {
        throw new Error('Missing GATEWAY_CLEARING or AR ledger entry in payment postings.');
      }
      if (!foundFEE) {
        throw new Error('Gateway fee expense was not recorded.');
      }
    });

    console.log('[OK] Test Case D (Verify payment ledger entries with surcharge) Passed.');

    console.log('\n========================================================');
    console.log('   ALL INTEGRATION TESTS VERIFIED SUCCESSFULLY!');
    console.log('========================================================');

  } catch (err) {
    console.error('\n[TEST FAILURE] Integration test run failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    // Clear tests fixtures
    await runWithoutRLS(async (client) => {
      await client.query('DELETE FROM platform_billing_invoices WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM transfers WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_accounts WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM document_lines WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM documents WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM vendors WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM clients WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);
    });
    await pool.end();
  }
};

runTests();
