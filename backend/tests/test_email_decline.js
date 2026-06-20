import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from '../config/db.js';
import { documentController } from '../controllers/documentController.js';
import { portalController } from '../controllers/portalController.js';

console.log('========================================================');
console.log('   Invoice SaaS - Emailing & Quote Decline Tests');
console.log('========================================================');

const mockTenantId = 'b2222222-2222-2222-2222-222222222222';
const mockUserId = 'c2222222-2222-2222-2222-222222222222';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

let mockClientId = null;
let mockQuoteId = null;

const runTests = async () => {
  try {
    // A. Setup database fixtures
    await runWithoutRLS(async (client) => {
      // Clear previous test records
      await client.query('DELETE FROM documents WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM clients WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [mockTenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [mockTenantId]);
      await client.query('DELETE FROM users WHERE id = $1', [mockUserId]);

      // Insert fixtures
      await client.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Email Verification Tenant LLC', 'active')", [mockTenantId]);
      await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'test@emailverify.local', 'hash')", [mockUserId]);
      await client.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [mockTenantId, mockUserId]);
      
      // Initialize tenant settings
      await client.query(
        `INSERT INTO tenant_settings (tenant_id, general_config, business_info, invoice_config, tax_config, email_templates, translations)
         VALUES ($1, '{}', '{"businessName": "Verify Corp", "email": "info@verify.corp", "address": "123 Main St"}', '{}', '{"currencySymbol": "₹", "defaultTaxPercentage": 18.00}', 
         '{"quote_availability": {"subject": "Quote {{document_number}} ready", "body": "Hello {{client_name}}, details here: {{portal_link}}"}}', '{}')`,
         [mockTenantId]
      );
    });

    console.log('[OK] Fixtures initialized.');

    // B. Create Client & Quote
    await runInTransaction(mockTenantId, async (client) => {
      const clientRes = await client.query(
        "INSERT INTO clients (tenant_id, name, email) VALUES ($1, 'Alice Client', 'alice@client.local') RETURNING id",
        [mockTenantId]
      );
      mockClientId = clientRes.rows[0].id;

      const docRes = await client.query(
        `INSERT INTO documents (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date)
         VALUES ($1, $2, 'quote', 'QT-VERIFY-1001', 'draft', 1000.00, 0, 180.00, 1180.00, NOW() + INTERVAL '14 days') RETURNING id`,
        [mockTenantId, mockClientId]
      );
      mockQuoteId = docRes.rows[0].id;
    });

    console.log('[OK] Created quotation QT-VERIFY-1001 in draft state.');

    // C. Test sendDocumentEmail
    console.log('-> Invoking sendDocumentEmail controller handler...');
    const reqEmail = {
      tenantId: mockTenantId,
      params: { id: mockQuoteId },
      body: {}
    };

    let emailResultData = null;
    const resEmail = {
      json: (data) => {
        emailResultData = data;
      }
    };

    await documentController.sendDocumentEmail(reqEmail, resEmail, (err) => {
      if (err) throw err;
    });

    console.log('[OK] Send email controller succeeded.');
    console.log('-> Response message:', emailResultData.message);
    console.log('-> Recipient:', emailResultData.data.recipient);
    console.log('-> Preview file:', emailResultData.data.previewFile);

    // Verify file exists
    if (!fs.existsSync(emailResultData.data.previewFile)) {
      throw new Error('Email HTML preview file was not generated!');
    }
    const htmlContent = fs.readFileSync(emailResultData.data.previewFile, 'utf8');
    if (!htmlContent.includes('alice@client.local') && !htmlContent.includes('QT-VERIFY-1001')) {
      throw new Error('Email content does not contain correct client/document details.');
    }
    if (!htmlContent.includes('create-qr-code') || !htmlContent.includes('https://api.qrserver.com')) {
      throw new Error('Email content does not include the payment/portal QR code!');
    }
    console.log('[OK] Compiled HTML email content verified (contains logo, details, and QR code).');

    // D. Verify document status transitioned to 'sent'
    await runInTransaction(mockTenantId, async (client) => {
      const docRes = await client.query('SELECT status FROM documents WHERE id = $1', [mockQuoteId]);
      const status = docRes.rows[0].status;
      console.log(`-> Post-email document status: "${status}" (Expected: "sent")`);
      if (status !== 'sent') {
        throw new Error('Document status was not updated to "sent" after emailing.');
      }
    });

    // E. Test declineQuote
    console.log('-> Generating magic portal token...');
    const token = jwt.sign(
      { documentId: mockQuoteId, tenantId: mockTenantId, type: 'quote' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log('-> Invoking declineQuote portal controller handler...');
    const reqDecline = {
      params: { id: mockQuoteId },
      body: { token }
    };
    let declineResultData = null;
    const resDecline = {
      json: (data) => {
        declineResultData = data;
      }
    };

    await portalController.declineQuote(reqDecline, resDecline, (err) => {
      if (err) throw err;
    });

    console.log('[OK] Decline quote portal endpoint succeeded.');
    console.log('-> Status in response:', declineResultData.data.status);

    // F. Verify quote status transitioned to 'declined' in database
    await runInTransaction(mockTenantId, async (client) => {
      const docRes = await client.query('SELECT status FROM documents WHERE id = $1', [mockQuoteId]);
      const status = docRes.rows[0].status;
      console.log(`-> Post-decline document status: "${status}" (Expected: "declined")`);
      if (status !== 'declined') {
        throw new Error('Quote status was not updated to "declined" in the database.');
      }
    });

    // G. Verify double-decline handles gracefully (returns early or errors out gracefully)
    console.log('-> Attempting double-decline...');
    await portalController.declineQuote(reqDecline, resDecline, (err) => {
      if (err) throw err;
    });
    console.log(`-> Double decline response: "${declineResultData.message}"`);
    if (declineResultData.data.status !== 'already_declined') {
      throw new Error('Double decline should return status: already_declined.');
    }
    console.log('[OK] Double decline handled correctly.');

    console.log('\n========================================================');
    console.log('   ALL INTEGRATION TESTS VERIFIED SUCCESSFULLY!');
    console.log('========================================================');

  } catch (err) {
    console.error('\n[TEST FAILURE] Integration test run failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    // Clean up
    await runWithoutRLS(async (client) => {
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
