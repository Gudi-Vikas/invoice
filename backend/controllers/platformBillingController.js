import { runWithoutRLS } from '../config/db.js';

// ─── Invoice Number Generator ──────────────────────────────────────────────
// Format: UKEY-BILL-YYYYMM-NNNN  (e.g. UKEY-BILL-202406-0001)
// Thread-safe: uses explicit row lock (FOR UPDATE) on a dedicated monthly sequence table
const generateInvoiceNumber = async (client) => {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `UKEY-BILL-${yyyymm}`;

  // Ensure sequence tracking row exists for this prefix
  await client.query(
    `INSERT INTO platform_invoice_sequences (prefix, last_seq)
     VALUES ($1, 0)
     ON CONFLICT (prefix) DO NOTHING`,
    [prefix]
  );

  // Lock the sequence row FOR UPDATE
  const lockRes = await client.query(
    `SELECT last_seq FROM platform_invoice_sequences WHERE prefix = $1 FOR UPDATE`,
    [prefix]
  );

  const nextSeq = lockRes.rows[0].last_seq + 1;

  // Increment the sequence counter
  await client.query(
    `UPDATE platform_invoice_sequences SET last_seq = $1 WHERE prefix = $2`,
    [nextSeq, prefix]
  );

  const seqStr = nextSeq.toString().padStart(4, '0');
  return `${prefix}-${seqStr}`;
};

export const createPlatformInvoice = async (client, { tenantId, planId, amount, taxPercentage = 18.00, razorpayOrderId, razorpayPaymentId, status = 'paid' }) => {
  const invoiceNumber = await generateInvoiceNumber(client);
  const now = new Date();
  const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const planAmount = parseFloat(amount);
  const taxPct = parseFloat(taxPercentage);
  const taxAmount = parseFloat(((planAmount * taxPct) / 100).toFixed(4));
  const totalAmount = parseFloat((planAmount + taxAmount).toFixed(4));

  const insertRes = await client.query(
    `INSERT INTO platform_billing_invoices
       (tenant_id, plan_id, invoice_number, billing_period_start, billing_period_end,
        amount, tax_percentage, tax_amount, total_amount, status, due_date, razorpay_order_id, razorpay_payment_id, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      tenantId, planId, invoiceNumber, billingPeriodStart, billingPeriodEnd,
      planAmount, taxPct, taxAmount, totalAmount, status, now, razorpayOrderId || null, razorpayPaymentId || null, status === 'paid' ? now : null
    ]
  );
  return insertRes.rows[0];
};

// ─── Cursor Helpers for Pagination ─────────────────────────────────────────
const encodeCursor = (createdAt, id) => {
  if (!createdAt || !id) return null;
  let dateStr;
  if (createdAt instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    const pad3 = (n) => String(n).padStart(3, '0');
    dateStr = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())}T${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}:${pad(createdAt.getSeconds())}.${pad3(createdAt.getMilliseconds())}`;
  } else {
    dateStr = createdAt;
  }
  return Buffer.from(JSON.stringify({ createdAt: dateStr, id })).toString('base64');
};

const decodeCursor = (cursorStr) => {
  if (!cursorStr) return null;
  try {
    const json = Buffer.from(cursorStr, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.createdAt && parsed.id) {
      return parsed;
    }
  } catch (err) {
    // Return null on malformed cursor
  }
  return null;
};

/**
 * Platform Billing Controller
 *
 * Manages the invoices that Ultrakey IT Solutions sends to its tenant customers
 * for their monthly/annual SaaS subscription fees.
 *
 * These invoices live in `platform_billing_invoices` — separate from the
 * tenant-owned `documents` table — because:
 *   1. They are cross-tenant (master admin owns them, not any tenant).
 *   2. They carry billing-specific fields (period_start/end, tax breakdown).
 *   3. No RLS complexity: master admin always has full access.
 *
 * All handlers require authenticateToken + requireMasterAdmin (enforced at route level).
 */
export const platformBillingController = {

  // ───────────────────────────────────────────────────────────────────────────
  // 1. GENERATE BILLING INVOICE
  //    Creates a new platform billing invoice for a specific tenant.
  //    Amount is auto-populated from the tenant's active plan unless overridden.
  //
  //    Body: {
  //      tenantId, billingPeriodStart, billingPeriodEnd,
  //      planId?         (defaults to tenant's current plan),
  //      amountOverride? (manual override for the pre-tax amount),
  //      taxPercentage?  (defaults to 18%),
  //      dueDate,
  //      notes?
  //    }
  // ───────────────────────────────────────────────────────────────────────────
  generateInvoice: async (req, res, next) => {
    const {
      tenantId,
      billingPeriodStart,
      billingPeriodEnd,
      planId,
      amountOverride,
      taxPercentage = 18.00,
      dueDate,
      notes
    } = req.body;

    if (!tenantId || !billingPeriodStart || !billingPeriodEnd || !dueDate) {
      return res.status(400).json({
        error: 'tenantId, billingPeriodStart, billingPeriodEnd, and dueDate are required.'
      });
    }

    try {
      const invoice = await runWithoutRLS(async (client) => {
        // A. Verify tenant exists
        const tenantRes = await client.query(
          'SELECT id, name, status FROM tenants WHERE id = $1',
          [tenantId]
        );
        if (tenantRes.rows.length === 0) {
          throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
        }

        // B. Resolve the plan to bill for
        let resolvedPlanId = planId;
        let planAmount;

        if (amountOverride !== undefined && amountOverride !== null) {
          // Manual override: use whatever amount was specified
          planAmount = parseFloat(amountOverride);
          if (isNaN(planAmount) || planAmount < 0) {
            throw Object.assign(
              new Error('amountOverride must be a non-negative number.'),
              { statusCode: 400 }
            );
          }
        } else {
          // Look up from plan (planId given, or tenant's current active subscription)
          let planRes;
          if (resolvedPlanId) {
            planRes = await client.query(
              'SELECT id, name, price_monthly FROM plans WHERE id = $1',
              [resolvedPlanId]
            );
          } else {
            planRes = await client.query(
              `SELECT p.id, p.name, p.price_monthly
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.tenant_id = $1 AND s.status = 'active'
               ORDER BY s.created_at DESC LIMIT 1`,
              [tenantId]
            );
          }

          if (planRes.rows.length === 0) {
            throw Object.assign(
              new Error('No plan found. Provide planId or ensure tenant has an active subscription.'),
              { statusCode: 400 }
            );
          }

          resolvedPlanId = planRes.rows[0].id;
          planAmount = parseFloat(planRes.rows[0].price_monthly);
        }

        // C. Calculate tax using NUMERIC(15,4) precision — all in JS integer-safe math
        const taxPct = parseFloat(taxPercentage);
        const taxAmount = parseFloat(((planAmount * taxPct) / 100).toFixed(4));
        const totalAmount = parseFloat((planAmount + taxAmount).toFixed(4));

        // D. Generate invoice number (idempotency guard via DB UNIQUE on invoice_number)
        const invoiceNumber = await generateInvoiceNumber(client);

        // E. Insert
        const insertRes = await client.query(
          `INSERT INTO platform_billing_invoices
             (tenant_id, plan_id, invoice_number, billing_period_start, billing_period_end,
              amount, tax_percentage, tax_amount, total_amount, status, due_date, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12)
           RETURNING *`,
          [
            tenantId, resolvedPlanId, invoiceNumber,
            billingPeriodStart, billingPeriodEnd,
            planAmount, taxPct, taxAmount, totalAmount,
            dueDate, notes || null, req.masterAdmin.id
          ]
        );

        return {
          invoice: insertRes.rows[0],
          tenant: tenantRes.rows[0]
        };
      });

      return res.status(201).json({
        message: `Billing invoice ${invoice.invoice.invoice_number} generated.`,
        invoice: invoice.invoice,
        tenant: invoice.tenant
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. LIST ALL BILLING INVOICES  (paginated + filterable with cursor support)
  //    Query params: cursor, limit, status, tenantId, from (date), to (date)
  // ───────────────────────────────────────────────────────────────────────────
  listInvoices: async (req, res, next) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { status, tenantId: filterTenantId, from, to, cursor } = req.query;

    try {
      const result = await runWithoutRLS(async (client) => {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status)         { conditions.push(`bi.status = $${idx++}`);             params.push(status); }
        if (filterTenantId) { conditions.push(`bi.tenant_id = $${idx++}`);          params.push(filterTenantId); }
        if (from)           { conditions.push(`bi.created_at >= $${idx++}`);        params.push(from); }
        if (to)             { conditions.push(`bi.created_at <= $${idx++}`);        params.push(to); }

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            conditions.push(`(bi.created_at, bi.id) < ($${idx++}::timestamp, $${idx++}::uuid)`);
            params.push(decoded.createdAt, decoded.id);
          }
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Query limit + 1 rows to determine if there is a next page
        const queryLimit = limit + 1;

        const queryRes = await client.query(
          `SELECT
             bi.id, bi.invoice_number, bi.status,
             bi.amount, bi.tax_amount, bi.total_amount, bi.tax_percentage,
             bi.billing_period_start, bi.billing_period_end,
             bi.due_date, bi.paid_at, bi.created_at,
             t.name  AS tenant_name,
             t.domain AS tenant_domain,
             p.name  AS plan_name
           FROM platform_billing_invoices bi
           JOIN tenants t ON t.id = bi.tenant_id
           LEFT JOIN plans p ON p.id = bi.plan_id
           ${where}
           ORDER BY bi.created_at DESC, bi.id DESC
           LIMIT $${idx}`,
          [...params, queryLimit]
        );

        const rows = queryRes.rows;
        const hasMore = rows.length > limit;
        const dataRows = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor = null;
        if (hasMore && dataRows.length > 0) {
          const lastItem = dataRows[dataRows.length - 1];
          nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
        }

        return { rows: dataRows, nextCursor };
      });

      return res.json({
        invoices: result.rows,
        pagination: {
          limit,
          nextCursor: result.nextCursor
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. GET SINGLE BILLING INVOICE DETAIL
  // ───────────────────────────────────────────────────────────────────────────
  getInvoice: async (req, res, next) => {
    const { id } = req.params;

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `SELECT
             bi.*,
             t.name AS tenant_name, t.domain AS tenant_domain, t.status AS tenant_status,
             p.name AS plan_name, p.price_monthly,
             ma.email AS created_by_email
           FROM platform_billing_invoices bi
           JOIN tenants t ON t.id = bi.tenant_id
           LEFT JOIN plans p ON p.id = bi.plan_id
           LEFT JOIN master_admins ma ON ma.id = bi.created_by
           WHERE bi.id = $1`,
          [id]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Billing invoice not found.' });
      }

      return res.json({ invoice: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. MARK PAID  —  Manually record a payment (bank transfer, cheque, etc.)
  //    Sets status = 'paid' and records paid_at timestamp.
  //    Body: { razorpayPaymentId? (optional, if paid via Razorpay manually) }
  // ───────────────────────────────────────────────────────────────────────────
  markPaid: async (req, res, next) => {
    const { id } = req.params;
    const { razorpayPaymentId } = req.body;

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE platform_billing_invoices
           SET status = 'paid',
               paid_at = NOW(),
               razorpay_payment_id = COALESCE($2, razorpay_payment_id)
           WHERE id = $1 AND status NOT IN ('paid', 'void')
           RETURNING *`,
          [id, razorpayPaymentId || null]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Invoice not found, already paid, or voided.'
        });
      }

      return res.json({
        message: `Invoice ${result.rows[0].invoice_number} marked as paid.`,
        invoice: result.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. VOID INVOICE  —  Cancels an invoice that should not be collected.
  //    Only pending/overdue invoices can be voided (not already-paid ones).
  //    Body: { reason? }
  // ───────────────────────────────────────────────────────────────────────────
  voidInvoice: async (req, res, next) => {
    const { id } = req.params;
    const { reason } = req.body;

    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE platform_billing_invoices
           SET status = 'void',
               notes = CASE
                 WHEN $2 IS NOT NULL THEN CONCAT(COALESCE(notes, ''), ' [VOID REASON: ', $2, ']')
                 ELSE notes
               END
           WHERE id = $1 AND status NOT IN ('paid', 'void')
           RETURNING id, invoice_number, status, notes`,
          [id, reason || null]
        );
      });

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Invoice not found, already voided, or already paid (paid invoices cannot be voided).'
        });
      }

      return res.json({
        message: `Invoice ${result.rows[0].invoice_number} has been voided.`,
        invoice: result.rows[0]
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. MARK OVERDUE  —  Bulk-marks all past-due pending invoices as 'overdue'.
  //    Intended to be called by a scheduled job (cron), but can also be
  //    triggered manually by the master admin.
  // ───────────────────────────────────────────────────────────────────────────
  markOverdueInvoices: async (req, res, next) => {
    try {
      const result = await runWithoutRLS(async (client) => {
        return client.query(
          `UPDATE platform_billing_invoices
           SET status = 'overdue'
           WHERE status = 'pending' AND due_date < CURRENT_DATE
           RETURNING id, invoice_number, tenant_id, due_date`
        );
      });

      return res.json({
        message: `${result.rows.length} invoice(s) marked as overdue.`,
        updated: result.rows
      });
    } catch (err) {
      next(err);
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. GET TENANT BILLING HISTORY  —  All billing invoices for one tenant.
  // ───────────────────────────────────────────────────────────────────────────
  getTenantBillingHistory: async (req, res, next) => {
    const { tenantId } = req.params;

    try {
      const result = await runWithoutRLS(async (client) => {
        const [tenant, invoices] = await Promise.all([
          client.query('SELECT id, name, domain, status FROM tenants WHERE id = $1', [tenantId]),
          client.query(
            `SELECT bi.*, p.name AS plan_name
             FROM platform_billing_invoices bi
             LEFT JOIN plans p ON p.id = bi.plan_id
             WHERE bi.tenant_id = $1
             ORDER BY bi.created_at DESC`,
            [tenantId]
          )
        ]);

        if (tenant.rows.length === 0) return null;

        // Billing summary
        const summary = invoices.rows.reduce(
          (acc, inv) => {
            acc.total += parseFloat(inv.total_amount);
            acc.paid  += inv.status === 'paid'   ? parseFloat(inv.total_amount) : 0;
            acc.outstanding += ['pending', 'overdue'].includes(inv.status)
              ? parseFloat(inv.total_amount) : 0;
            return acc;
          },
          { total: 0, paid: 0, outstanding: 0 }
        );

        return {
          tenant: tenant.rows[0],
          summary: {
            totalBilled:      parseFloat(summary.total.toFixed(2)),
            totalPaid:        parseFloat(summary.paid.toFixed(2)),
            totalOutstanding: parseFloat(summary.outstanding.toFixed(2)),
            invoiceCount:     invoices.rows.length
          },
          invoices: invoices.rows
        };
      });

      if (!result) {
        return res.status(404).json({ error: 'Tenant not found.' });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
};

export default platformBillingController;
