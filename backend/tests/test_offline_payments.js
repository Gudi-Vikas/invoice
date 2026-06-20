import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { initializeLedgerAccounts } from '../services/ledgerService.js';
import { portalController } from '../controllers/portalController.js';
import { documentController } from '../controllers/documentController.js';
import { postInvoiceLedger } from '../services/ledgerService.js';

console.log('========================================================');
console.log('   Invoice SaaS - Offline Payment & Ledger Tests');
console.log('========================================================');

const mockTenantId = 'b4444444-4444-4444-4444-444444444444';
const mockUserId = 'c4444444-4444-4444-4444-444444444444';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const runTests = async () => {
  try {
    // 1. Setup Database Fixtures
    await runWithoutRLS(async (client) => {
      // Clear previous test records
      await client.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_accounts WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM document_lines WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM documents WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM clients WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);

      // Insert fresh fixtures
      await client.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Offline Payments Test Tenant', 'active')", [mockTenantId]);
      await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'test@offline.local', 'hash')", [mockUserId]);
      await client.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [mockTenantId, mockUserId]);

      // Seed ledger accounts
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [mockTenantId]);
      await initializeLedgerAccounts(client, mockTenantId);
    });

    console.log('[OK] Database fixtures & ledger accounts initialized.');

    let mockClientId = null;
    let mockInvoiceId = null;

    // 2. Setup Client, Settings, and Invoice
    await runInTransaction(mockTenantId, async (client) => {
      // Create Client
      const clientRes = await client.query(
        "INSERT INTO clients (tenant_id, name, email) VALUES ($1, 'Offline Client', 'offline@client.local') RETURNING id",
        [mockTenantId]
      );
      mockClientId = clientRes.rows[0].id;

      // Settings: configure UPI and Bank Transfer
      await client.query(
        `INSERT INTO tenant_settings (tenant_id, general_config, business_info, invoice_config, tax_config, email_templates, translations, payments_config)
         VALUES ($1, '{}', '{"businessName": "Offline Corp"}', '{}', '{"currencySymbol": "₹", "defaultTaxPercentage": 18.00}', '{}', '{}', 
         '{"upiId": "merchant@okaxis", "bankDetails": "HDFC Account: 502000000000\\nIFSC: HDFC0000001"}')`,
        [mockTenantId]
      );

      // Create Invoice
      const docRes = await client.query(
        `INSERT INTO documents (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date)
         VALUES ($1, $2, 'invoice', 'INV-OFFLINE-101', 'published', 2000.00, 0, 360.00, 2360.00, NOW() + INTERVAL '7 days') RETURNING id`,
        [mockTenantId, mockClientId]
      );
      mockInvoiceId = docRes.rows[0].id;

      // Create Invoice Line Item
      await client.query(
        `INSERT INTO document_lines (document_id, tenant_id, quantity, description, unit_price, adjust, amount, sort_order)
         VALUES ($1, $2, 2, 'Hourly Software Development Services', 1000.00, 0, 2000.00, 0)`,
        [mockInvoiceId, mockTenantId]
      );

      // Post Invoice Ledger (AR / Revenue)
      await postInvoiceLedger(client, mockTenantId, 'INV-OFFLINE-101', 2000.00, 360.00, 2360.00, mockInvoiceId);
    });

    console.log('[OK] Client, Settings, Invoice created & AR ledger posted.');

    // 3. Client submits offline payment reference
    console.log('-> Simulating client submitting offline payment proof...');
    const token = jwt.sign(
      { documentId: mockInvoiceId, tenantId: mockTenantId, type: 'invoice' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const reqSubmit = {
      params: { id: mockInvoiceId },
      body: {
        token,
        paymentMethod: 'upi',
        transactionReference: 'UTR_UPI_999999999',
        notes: 'Transferred via PhonePe'
      }
    };

    let submitResponseData = null;
    const resSubmit = {
      json: (data) => {
        submitResponseData = data;
      }
    };

    await portalController.verifyOfflinePayment(reqSubmit, resSubmit, (err) => {
      if (err) throw err;
    });

    console.log('[OK] Offline payment reference submitted successfully.');
    console.log('-> Status in response:', submitResponseData.data.status);
    console.log('-> Reference in response:', submitResponseData.data.offline_payment_info.reference);

    // 4. Verify status updated to pending_verification in database
    await runInTransaction(mockTenantId, async (client) => {
      const docCheck = await client.query('SELECT status, offline_payment_info FROM documents WHERE id = $1', [mockInvoiceId]);
      const { status, offline_payment_info } = docCheck.rows[0];
      
      console.log(`-> Document status in DB: "${status}" (Expected: "pending_verification")`);
      if (status !== 'pending_verification') {
        throw new Error('Invoice status was not updated to pending_verification.');
      }
      if (offline_payment_info.reference !== 'UTR_UPI_999999999') {
        throw new Error('Reference mismatch in offline_payment_info.');
      }
      if (offline_payment_info.method !== 'upi') {
        throw new Error('Payment method mismatch in offline_payment_info.');
      }
    });

    // 5. Tenant approves payment, updating status to paid
    console.log('-> Simulating tenant approving payment (status update to paid)...');
    
    const reqApprove = {
      tenantId: mockTenantId,
      params: { id: mockInvoiceId },
      body: { status: 'paid' }
    };

    let approveResponseData = null;
    const resApprove = {
      json: (data) => {
        approveResponseData = data;
      }
    };

    await documentController.updateDocumentStatus(reqApprove, resApprove, (err) => {
      if (err) throw err;
    });

    console.log('[OK] Tenant approved status change successfully.');

    // 6. Verify ledger entries are posted correctly for the offline payment
    await runInTransaction(mockTenantId, async (client) => {
      const docCheck = await client.query('SELECT status FROM documents WHERE id = $1', [mockInvoiceId]);
      if (docCheck.rows[0].status !== 'paid') {
        throw new Error('Document status was not updated to paid after approval.');
      }

      // Check payment ledger entries: CASH_DEFAULT or GATEWAY_CLEARING (debit) vs AR_DEFAULT (credit)
      const ledgerCheck = await client.query(
        `SELECT la.code, SUM(COALESCE(le.debit, 0)) as debits, SUM(COALESCE(le.credit, 0)) as credits
         FROM ledger_entries le
         JOIN ledger_accounts la ON le.account_id = la.id
         JOIN ledger_transactions lt ON le.transaction_id = lt.id
         WHERE le.tenant_id = $1 AND lt.transaction_type = 'invoice_payment' AND lt.reference_id = $2
         GROUP BY la.code`,
        [mockTenantId, mockInvoiceId]
      );

      console.log('-> Payment Ledger Postings:');
      let foundCashDebit = false;
      let foundARCredit = false;

      for (const row of ledgerCheck.rows) {
        console.log(`   * Account: ${row.code} | Debit: ${row.debits} | Credit: ${row.credits}`);
        if (row.code === 'CASH_DEFAULT') {
          if (parseFloat(row.debits) !== 2360.00) throw new Error('CASH_DEFAULT debit amount must equal full paid amount (2360.00).');
          foundCashDebit = true;
        }
        if (row.code === 'AR_DEFAULT') {
          if (parseFloat(row.credits) !== 2360.00) throw new Error('AR_DEFAULT credit amount must equal full paid amount (2360.00).');
          foundARCredit = true;
        }
      }

      if (!foundCashDebit || !foundARCredit) {
        throw new Error('Missing balanced payment ledger postings in double-entry ledger.');
      }
    });

    console.log('[OK] Balanced double-entry payment ledger postings verified successfully.');

    console.log('\n========================================================');
    console.log('   ALL OFFLINE PAYMENT TESTS VERIFIED SUCCESSFULLY!');
    console.log('========================================================');

  } catch (err) {
    console.error('\n[TEST FAILURE] Offline payment test run failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    // 7. Clear Database Fixtures
    await runWithoutRLS(async (client) => {
      await client.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM ledger_accounts WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM document_lines WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM documents WHERE tenant_id = $1', [mockTenantId]);
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
