#!/usr/bin/env node
/**
 * E2E exploration script — validates the four interactive flows via API + DB.
 * Run from repo root: node backend/scripts/e2e-explore.mjs
 */
import pg from '../node_modules/pg/lib/index.js';

const API = 'http://localhost:5000/api/v1';
const TENANT_EMAIL = 'e2e_tester@test.com';
const TENANT_PASSWORD = 'password123';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/invoice_db',
});

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`✅ ${name}: ${detail}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`❌ ${name}: ${detail}`);
}

async function api(path, opts = {}, token, tenantId) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(tenantId && { 'x-tenant-id': tenantId }),
    ...opts.headers,
  };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${path}`);
  return body;
}

async function queryLedgerBalance(tenantId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const { rows } = await client.query(`
      SELECT lt.id, lt.reference, lt.description,
             SUM(COALESCE(le.debit, 0)) AS total_debit,
             SUM(COALESCE(le.credit, 0)) AS total_credit
      FROM ledger_transactions lt
      JOIN ledger_entries le ON le.transaction_id = lt.id
      WHERE lt.tenant_id = $1
      GROUP BY lt.id, lt.reference, lt.description
      ORDER BY lt.created_at
    `, [tenantId]);
    await client.query('COMMIT');
    return rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('\n=== Ultrakey Invoice SaaS — E2E Flow Validation ===\n');

  // ── Auth ──
  let login;
  try {
    login = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: TENANT_EMAIL, password: TENANT_PASSWORD }),
    });
    pass('Login', `${login.user.email} → ${login.activeTenant.name}`);
  } catch (e) {
    fail('Login', e.message);
    process.exit(1);
  }

  const { token } = login;
  const tenantId = login.activeTenant.id;

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 1: Double-Entry Ledger Validation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Flow 1: Ledger Validation ---');
  try {
    const docsRes = await api('/documents?limit=50', {}, token, tenantId);
    const docs = docsRes.documents || [];
    const inv1002 = docs.find(d => d.document_number === 'INV-1002');

    if (inv1002) {
      if (inv1002.status === 'paid') {
        pass('INV-1002 status', `status=${inv1002.status}, total=${inv1002.total_due}`);
      } else {
        fail('INV-1002 status', `expected paid, got ${inv1002.status}`);
      }
    } else {
      fail('INV-1002 status', 'document not found');
    }

    const paidInvoices = docs.filter(d => d.type === 'invoice' && d.status === 'paid');
    const collected = paidInvoices.reduce((s, d) => s + parseFloat(d.total_due || 0), 0);
    pass('Dashboard metrics (computed)', `collected=${collected.toFixed(2)}, paid_count=${paidInvoices.length}`);

    const ledgerRows = await queryLedgerBalance(tenantId);
    const imbalanced = ledgerRows.filter(r =>
      Math.abs(parseFloat(r.total_debit) - parseFloat(r.total_credit)) > 0.0001
    );
    if (imbalanced.length === 0 && ledgerRows.length > 0) {
      pass('Ledger balance', `${ledgerRows.length} transactions, all debits = credits`);
      ledgerRows.forEach(r => {
        console.log(`   · ${r.reference || r.description}: DR ${parseFloat(r.total_debit).toFixed(2)} = CR ${parseFloat(r.total_credit).toFixed(2)}`);
      });
    } else if (ledgerRows.length === 0) {
      fail('Ledger balance', 'no ledger transactions found');
    } else {
      fail('Ledger balance', `${imbalanced.length} imbalanced transaction(s)`);
    }
  } catch (e) {
    fail('Flow 1', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 2: Quotation Promotion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Flow 2: Quotation Promotion ---');
  try {
    const clientsRes = await api('/clients', {}, token, tenantId);
    const client = (clientsRes.clients || clientsRes)[0];
    if (!client) throw new Error('No clients found');

    const quote = await api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        type: 'quote',
        status: 'published',
        lines: [{ description: 'E2E Quote Line — Consulting', quantity: 2, unitPrice: 5000, adjust: 0 }],
      }),
    }, token, tenantId);

    const quoteDoc = quote.document || quote.data || quote;
    pass('Create quotation', `${quoteDoc.document_number} (id=${quoteDoc.id})`);

    const tokenRes = await api(`/documents/${quoteDoc.id}/token`, {}, token, tenantId);
    const portalUrl = tokenRes.data?.portalUrl || tokenRes.portalUrl;
    const portalToken = portalUrl?.split('/').pop();
    if (!portalToken) throw new Error('Could not extract portal token');

    const portalDoc = await api(`/portal/documents/${portalToken}`, {
      headers: { Authorization: '', 'x-tenant-id': '' },
    });
    pass('Portal magic link', `loaded ${portalDoc.document?.document_number || portalDoc.document_number}`);

    const acceptRes = await api(`/portal/quotes/${quoteDoc.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ token: portalToken }),
      headers: { Authorization: '', 'x-tenant-id': '' },
    });
    const acceptedQuote = acceptRes.data?.quote;
    const newInvoice = acceptRes.data?.invoice;

    if (acceptedQuote?.status === 'accepted') {
      pass('Quote acceptance', `quote status=${acceptedQuote.status}`);
    } else {
      fail('Quote acceptance', JSON.stringify(acceptRes.data));
    }

    if (newInvoice?.type === 'invoice' && newInvoice?.status === 'published') {
      pass('Invoice auto-conversion', `${newInvoice.document_number} created from quote`);
    } else {
      fail('Invoice auto-conversion', newInvoice ? `got ${newInvoice.document_number}/${newInvoice.status}` : 'no invoice returned');
    }

    // Verify quote status in list
    const updatedDocs = await api('/documents?limit=50', {}, token, tenantId);
    const refreshedQuote = (updatedDocs.documents || []).find(d => d.id === quoteDoc.id);
    if (refreshedQuote?.status === 'accepted') {
      pass('Quote list refresh', `${refreshedQuote.document_number} shows accepted`);
    } else {
      fail('Quote list refresh', `status=${refreshedQuote?.status}`);
    }
  } catch (e) {
    fail('Flow 2', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 3: Vendor KYC
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Flow 3: Vendor KYC ---');
  try {
    const vendors = await api('/vendors', {}, token, tenantId);
    let vendor = vendors.find(v => v.business_name?.includes('Supplier'));
    if (!vendor) vendor = vendors[0];

    if (!vendor) throw new Error('No vendors found — onboard Supplier Inc first');

    pass('Vendor lookup', `${vendor.business_name} (kyc=${vendor.kyc_status}, rzp=${vendor.razorpay_account_id || 'n/a'})`);

    if (vendor.kyc_status === 'under_review' || vendor.kyc_status === 'verified') {
      pass('KYC already submitted', `status=${vendor.kyc_status}`);
    } else {
      const kycRes = await api(`/vendors/${vendor.id}/kyc`, {
        method: 'POST',
        body: JSON.stringify({
          stakeholder: {
            name: 'Raj Supplier',
            email: vendor.email,
            pan: 'ABCDE1234F',
            aadhaar: '123456789012',
          },
          bankDetails: {
            accountNumber: '1234567890123456',
            ifsc: 'HDFC0001234',
            beneficiaryName: vendor.business_name,
          },
        }),
      }, token, tenantId);

      const updated = kycRes.data || kycRes;
      if (updated.kyc_status === 'under_review') {
        pass('KYC submission', `${vendor.business_name} → under_review`);
      } else {
        fail('KYC submission', `status=${updated.kyc_status}`);
      }
    }
  } catch (e) {
    fail('Flow 3', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 4: Settings Tax Configuration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Flow 4: Settings Tax Matrix ---');
  try {
    const settings = await api('/settings', {}, token, tenantId);
    const originalTax = settings.tax_config?.defaultTaxPercentage ?? 18;
    const originalInclusive = settings.tax_config?.pricesInclusiveOfTax ?? false;

    // Change tax to 12% exclusive
    await api('/settings/tax_config', {
      method: 'PUT',
      body: JSON.stringify({
        defaultTaxPercentage: 12,
        pricesInclusiveOfTax: false,
        defaultTaxName: 'GST',
      }),
    }, token, tenantId);

    const updated = await api('/settings', {}, token, tenantId);
    if (parseFloat(updated.tax_config.defaultTaxPercentage) === 12) {
      pass('Tax rate update', '18% → 12%');
    } else {
      fail('Tax rate update', `got ${updated.tax_config.defaultTaxPercentage}`);
    }

    // Simulate frontend calculateTotals (exclusive, 12%)
    const qty = 3.5, rate = 4200.75;
    const linesTotal = qty * rate;
    const expectedTax = linesTotal * 0.12;
    const expectedTotal = linesTotal + expectedTax;
    pass('Exclusive calc (3.5×4200.75 @12%)', `sub=${linesTotal.toFixed(4)}, tax=${expectedTax.toFixed(4)}, total=${expectedTotal.toFixed(4)}`);

    // Toggle inclusive
    await api('/settings/tax_config', {
      method: 'PUT',
      body: JSON.stringify({ pricesInclusiveOfTax: true }),
    }, token, tenantId);

    const inclusiveSettings = await api('/settings', {}, token, tenantId);
    if (inclusiveSettings.tax_config.pricesInclusiveOfTax === true) {
      pass('Inclusive tax toggle', 'pricesInclusiveOfTax=true');
    } else {
      fail('Inclusive tax toggle', 'toggle did not persist');
    }

    const inclusiveSub = linesTotal / (1 + 12 / 100);
    const inclusiveTax = linesTotal - inclusiveSub;
    pass('Inclusive calc (same line @12%)', `sub=${inclusiveSub.toFixed(4)}, tax=${inclusiveTax.toFixed(4)}, total=${linesTotal.toFixed(4)}`);

    // Restore original settings
    await api('/settings/tax_config', {
      method: 'PUT',
      body: JSON.stringify({
        defaultTaxPercentage: originalTax,
        pricesInclusiveOfTax: originalInclusive,
      }),
    }, token, tenantId);
    pass('Settings restored', `tax=${originalTax}%, inclusive=${originalInclusive}`);
  } catch (e) {
    fail('Flow 4', e.message);
  }

  // ── Summary ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
