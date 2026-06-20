import jwt from 'jsonwebtoken';
import pool, { runInTransaction, runWithoutRLS } from './config/db.js';
import { initializeLedgerAccounts, postInvoiceLedger } from './services/ledgerService.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const seedAndGetLink = async () => {
  const mockTenantId = crypto.randomUUID();
  const mockUserId = crypto.randomUUID();
  const mockClientId = crypto.randomUUID();
  const mockVendorId = crypto.randomUUID();
  const mockInvoiceId = crypto.randomUUID();

  try {
    await runWithoutRLS(async (client) => {
      await client.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Surcharge Demo Tenant', 'active')", [mockTenantId]);
      await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')", [mockUserId, `demo_${crypto.randomBytes(4).toString('hex')}@surcharge.local`]);
      await client.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [mockTenantId, mockUserId]);

      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [mockTenantId]);
      await initializeLedgerAccounts(client, mockTenantId);
    });

    await runInTransaction(mockTenantId, async (client) => {
      await client.query(
        "INSERT INTO clients (id, tenant_id, name, email) VALUES ($1, $2, 'Alice Client', 'alice@client.local')",
        [mockClientId, mockTenantId]
      );

      await client.query(
        `INSERT INTO vendors (id, tenant_id, business_name, email, platform_fee_percentage, kyc_status, pan_verified)
         VALUES ($1, $2, 'Alice Vendor', 'alice@vendor.local', 5.00, 'active', true)`,
        [mockVendorId, mockTenantId]
      );

      await client.query(
        `INSERT INTO linked_accounts (vendor_id, tenant_id, razorpay_account_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [mockVendorId, mockTenantId, `acc_alice_${crypto.randomBytes(4).toString('hex')}`]
      );

      await client.query(
        `INSERT INTO tenant_settings (tenant_id, general_config, business_info, invoice_config, tax_config, email_templates, translations, payments_config)
         VALUES ($1, '{}', '{"businessName": "Surcharge Demo"}', '{}', '{"currencySymbol": "₹", "defaultTaxPercentage": 18.00}', '{}', '{}', '{"passGatewayFees": true}')`,
        [mockTenantId]
      );

      await client.query(
        `INSERT INTO documents (id, tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date)
         VALUES ($1, $2, $3, 'invoice', 'INV-DEMO-999', 'published', 1000.00, 0, 180.00, 1180.00, NOW() + INTERVAL '7 days')`,
        [mockInvoiceId, mockTenantId, mockClientId]
      );

      await client.query(
        `INSERT INTO document_lines (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, sort_order)
         VALUES ($1, $2, 1, 'Development Work', 1000.00, 0, 1000.00, $3, 0)`,
        [mockInvoiceId, mockTenantId, mockVendorId]
      );

      await postInvoiceLedger(client, mockTenantId, 'INV-DEMO-999', 1000.00, 180.00, 1180.00, mockInvoiceId);
    });

    const token = jwt.sign(
      { documentId: mockInvoiceId, tenantId: mockTenantId, type: 'invoice' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log(`\n\nMAGIC LINK: http://localhost:5173/portal/documents/${token}\n\n`);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
};

seedAndGetLink();
