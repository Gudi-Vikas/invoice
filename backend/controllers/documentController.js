import jwt from 'jsonwebtoken';
import { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger, postPaymentLedger } from '../services/ledgerService.js';
import emailService from '../services/emailService.js';
import eventBus from '../services/eventBus.js';

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Controller orchestrating Quotation and Invoicing document lifecycles.
 * All DB operations run within runInTransaction to enforce tenant RLS isolation.
 */
export const documentController = {
  /**
   * 1. Creates a new invoice or quotation.
   * Handles tax calculations, sequence assignment, line-item storage, and ledger posting.
   */
  createDocument: async (req, res, next) => {
    const { clientId, type, lines, status, dueDate, notes } = req.body;

    if (!clientId || !type || !lines || lines.length === 0) {
      return res.status(400).json({ error: 'Client ID, document type, and line items are required.' });
    }

    if (!['quote', 'invoice'].includes(type)) {
      return res.status(400).json({ error: 'Invalid document type. Must be "quote" or "invoice".' });
    }

    try {
      const newDoc = await runInTransaction(req.tenantId, async (client) => {
        // A. Load tax and invoice configuration
        const settingsRes = await client.query(
          'SELECT tax_config, invoice_config FROM tenant_settings WHERE tenant_id = $1',
          [req.tenantId]
        );

        if (settingsRes.rows.length === 0) {
          throw new Error('Tenant settings are not initialized.');
        }

        const taxConfig = settingsRes.rows[0].tax_config || {};
        const isInclusive = taxConfig.pricesInclusiveOfTax === true;
        const taxRate = parseFloat(taxConfig.defaultTaxPercentage || 18.00);

        // B. Parse line items and compute amounts
        let linesTotal = 0;
        let totalAdjust = 0;
        const parsedLines = lines.map((line, idx) => {
          const qty = parseFloat(line.quantity || 0);
          const price = parseFloat(line.unitPrice || 0);
          const adjust = parseFloat(line.adjust || 0);
          const lineAmount = (qty * price) + adjust;
          linesTotal += lineAmount;
          totalAdjust += adjust;
          return {
            quantity: qty,
            description: line.description || '',
            unitPrice: price,
            adjust: adjust,
            amount: lineAmount,
            vendorId: line.vendorId || null,
            vendorCost: line.vendorCost !== undefined && line.vendorCost !== null && line.vendorCost !== '' ? parseFloat(line.vendorCost) : null,
            sortOrder: idx
          };
        });

        let subTotal, taxAmount, totalDue, discountAmount;

        if (isInclusive) {
          // Lines contain the tax — extract net base
          subTotal = linesTotal / (1 + taxRate / 100);
          taxAmount = linesTotal - subTotal;
          totalDue = linesTotal;
        } else {
          subTotal = linesTotal;
          taxAmount = linesTotal * (taxRate / 100);
          totalDue = linesTotal + taxAmount;
        }
        discountAmount = totalAdjust < 0 ? Math.abs(totalAdjust) : 0;

        // C. Calculate due date from settings if not provided
        let calculatedDueDate = dueDate;
        if (!calculatedDueDate) {
          const configKey = type === 'quote' ? 'quote' : 'invoice';
          const limitsConfig = settingsRes.rows[0].invoice_config || {};
          const days = parseInt(limitsConfig[configKey]?.dueDateDays || limitsConfig[configKey]?.validityDays || 14, 10);
          const date = new Date();
          date.setDate(date.getDate() + days);
          calculatedDueDate = date.toISOString();
        }

        // D. Generate unique document number under row-lock protection
        const docNumber = await getNextDocumentNumber(client, req.tenantId, type);

        // E. Insert Document record
        const documentResult = await client.query(
          `INSERT INTO documents
             (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [req.tenantId, clientId, type, docNumber, status || 'draft',
           subTotal, discountAmount || 0, taxAmount, totalDue, calculatedDueDate, notes || null]
        );
        const savedDoc = documentResult.rows[0];

        // F. Bulk-insert line items
        for (const line of parsedLines) {
          await client.query(
            `INSERT INTO document_lines
               (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, vendor_cost, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [savedDoc.id, req.tenantId, line.quantity, line.description,
             line.unitPrice, line.adjust, line.amount, line.vendorId, line.vendorCost, line.sortOrder]
          );
        }

        // G. Post to ledger if publishing an invoice immediately
        if (type === 'invoice' && ['published', 'sent'].includes(savedDoc.status)) {
          await postInvoiceLedger(client, req.tenantId, docNumber, subTotal, taxAmount, totalDue, savedDoc.id);
        }

        return savedDoc;
      });

      eventBus.emit('document.created', {
        tenantId: req.tenantId,
        type: newDoc.type,
        documentNumber: newDoc.document_number,
        documentId: newDoc.id
      });

      return res.status(201).json({
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} generated successfully.`,
        data: newDoc
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 1b. Converts an accepted quotation into a new invoice.
   */
  convertToInvoice: async (req, res, next) => {
    const { id } = req.params;
    try {
      const newInvoice = await runInTransaction(req.tenantId, async (client) => {
        // Fetch the quote
        const quoteRes = await client.query(
          `SELECT * FROM documents WHERE tenant_id = $1 AND id = $2 AND type = 'quote'`,
          [req.tenantId, id]
        );

        if (quoteRes.rows.length === 0) {
          throw Object.assign(new Error('Quotation not found.'), { status: 404 });
        }

        const quote = quoteRes.rows[0];

        // Fetch settings
        const settingsRes = await client.query(
          `SELECT invoice_config FROM tenant_settings WHERE tenant_id = $1`,
          [req.tenantId]
        );
        const invSettings = settingsRes.rows[0]?.invoice_config?.invoice || {};

        // Generate invoice number
        const docNumber = await getNextDocumentNumber(client, req.tenantId, 'invoice');

        // Due date
        const invoiceDueDate = new Date();
        invoiceDueDate.setDate(invoiceDueDate.getDate() + parseInt(invSettings.dueDateDays || 14, 10));

        // Create Invoice
        const invoiceRes = await client.query(
          `INSERT INTO documents
             (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date, notes)
           VALUES ($1, $2, 'invoice', $3, 'published', $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            req.tenantId,
            quote.client_id,
            docNumber,
            quote.sub_total,
            quote.discount_amount || 0,
            quote.tax_amount,
            quote.total_due,
            invoiceDueDate,
            quote.notes || null
          ]
        );
        const invoice = invoiceRes.rows[0];

        // Clone lines
        const linesRes = await client.query(
          `SELECT * FROM document_lines WHERE tenant_id = $1 AND document_id = $2`,
          [req.tenantId, id]
        );

        for (const line of linesRes.rows) {
          await client.query(
            `INSERT INTO document_lines
               (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              invoice.id,
              req.tenantId,
              line.quantity,
              line.description,
              line.unit_price,
              line.adjust || 0,
              line.amount,
              line.vendor_id,
              line.sort_order || 0
            ]
          );
        }

        // Post to ledger
        await postInvoiceLedger(client, req.tenantId, docNumber, quote.sub_total, quote.tax_amount, quote.total_due, invoice.id);

        // Mark quote as converted
        await client.query(
          `UPDATE documents SET is_converted_to_invoice = true WHERE tenant_id = $1 AND id = $2`,
          [req.tenantId, id]
        );

        return invoice;
      });

      eventBus.emit('document.created', {
        tenantId: req.tenantId,
        type: 'invoice',
        documentNumber: newInvoice.document_number,
        documentId: newInvoice.id
      });

      return res.status(201).json({
        message: 'Quotation successfully converted to an invoice.',
        data: newInvoice
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. Retrieves a paginated list of documents with optional status, type, and date filters.
   */
  getDocuments: async (req, res, next) => {
    const { type, status, dateFrom, dateTo, clientId } = req.query;
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 50, 10);
    const offset = (page - 1) * limit;

    try {
      const results = await runInTransaction(req.tenantId, async (client) => {
        let sql = `
          SELECT d.id, d.type, d.document_number, d.status,
                 d.sub_total, d.discount_amount, d.tax_amount, d.total_due,
                 d.due_date, d.issue_date, d.created_at, d.razorpay_order_id, d.offline_payment_info,
                 d.is_converted_to_invoice,
                 c.name as client_name, c.email as client_email
          FROM documents d
          JOIN clients c ON d.client_id = c.id
          WHERE d.tenant_id = $1
        `;
        const params = [req.tenantId];

        if (type) { params.push(type); sql += ` AND d.type = $${params.length}`; }
        if (status) { params.push(status); sql += ` AND d.status = $${params.length}`; }
        if (dateFrom) { params.push(dateFrom); sql += ` AND d.created_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); sql += ` AND d.created_at <= $${params.length}`; }
        if (clientId) { params.push(clientId); sql += ` AND d.client_id = $${params.length}`; }

        sql += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const dataQuery = await client.query(sql, [...params, limit, offset]);

        let countSql = 'SELECT COUNT(*) as count FROM documents WHERE tenant_id = $1';
        const countParams = [req.tenantId];
        if (type) { countParams.push(type); countSql += ` AND type = $${countParams.length}`; }
        if (status) { countParams.push(status); countSql += ` AND status = $${countParams.length}`; }
        if (clientId) { countParams.push(clientId); countSql += ` AND client_id = $${countParams.length}`; }

        const countQuery = await client.query(countSql, countParams);
        const totalCount = parseInt(countQuery.rows[0].count, 10);

        return { documents: dataQuery.rows, totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) };
      });

      return res.json(results);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 3. Retrieves counts of documents grouped by status for a specific type.
   */
  getDocumentStats: async (req, res, next) => {
    const { type, clientId } = req.query;
    try {
      const stats = await runInTransaction(req.tenantId, async (client) => {
        let sql = `
          SELECT status, COUNT(*) as count 
          FROM documents 
          WHERE tenant_id = $1 
        `;
        const params = [req.tenantId];
        if (type) {
          params.push(type);
          sql += ` AND type = $${params.length}`;
        }
        if (clientId) {
          params.push(clientId);
          sql += ` AND client_id = $${params.length}`;
        }
        sql += ` GROUP BY status`;

        const result = await client.query(sql, params);
        
        let totalCount = 0;
        const statusCounts = result.rows.reduce((acc, row) => {
          const count = parseInt(row.count, 10);
          acc[row.status] = count;
          totalCount += count;
          return acc;
        }, {});
        
        statusCounts['all'] = totalCount;
        return statusCounts;
      });

      return res.json(stats);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 4. Retrieves detailed record of a specific document including line items.
   */
  getDocumentDetails: async (req, res, next) => {
    const { id } = req.params;

    try {
      const details = await runInTransaction(req.tenantId, async (client) => {
        const docRes = await client.query(
          `SELECT d.*, c.name as client_name, c.email as client_email, c.billing_address, c.extra_info as client_extra_info,
                  ts.business_info, ts.translations, ts.tax_config, ts.invoice_config
           FROM documents d
           JOIN clients c ON d.client_id = c.id
           JOIN tenant_settings ts ON d.tenant_id = ts.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2`,
          [req.tenantId, id]
        );

        if (docRes.rows.length === 0) return null;

        const linesRes = await client.query(
          `SELECT dl.id, dl.quantity, dl.description, dl.unit_price, dl.adjust, dl.amount, dl.vendor_id, dl.vendor_cost, dl.sort_order,
                  v.business_name as vendor_name
           FROM document_lines dl
           LEFT JOIN vendors v ON dl.vendor_id = v.id
           WHERE dl.tenant_id = $1 AND dl.document_id = $2
           ORDER BY dl.sort_order ASC`,
          [req.tenantId, id]
        );

        return { ...docRes.rows[0], lines: linesRes.rows };
      });

      if (!details) {
        return res.status(404).json({ error: 'Document not found or access denied.' });
      }

      return res.json(details);
    } catch (err) {
      next(err);
    }
  },

  /**
   * 5. Updates a document's status. Triggers ledger posting when moving to published/sent.
   */
  updateDocumentStatus: async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'published', 'sent', 'accepted', 'declined', 'paid', 'overdue', 'voided', 'pending_verification'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    try {
      const result = await runInTransaction(req.tenantId, async (client) => {
        // Fetch current document state with row lock
        const currentRes = await client.query(
          'SELECT * FROM documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [req.tenantId, id]
        );

        if (currentRes.rows.length === 0) {
          throw Object.assign(new Error('Document not found.'), { status: 404 });
        }

        const doc = currentRes.rows[0];
        const wasPublished = ['published', 'sent', 'pending_verification'].includes(doc.status);
        const isNowPublished = ['published', 'sent', 'pending_verification', 'paid'].includes(status);

        // Update status
        const updateRes = await client.query(
          `UPDATE documents SET status = $1 WHERE tenant_id = $2 AND id = $3 RETURNING *`,
          [status, req.tenantId, id]
        );
        const updated = updateRes.rows[0];

        // Trigger ledger posting if invoice first moves to published/sent/pending_verification/paid
        if (doc.type === 'invoice' && !wasPublished && isNowPublished) {
          await postInvoiceLedger(
            client, req.tenantId, doc.document_number,
            doc.sub_total, doc.tax_amount, doc.total_due, doc.id
          );
        }

        // Trigger payment ledger posting if invoice moves to paid
        if (doc.type === 'invoice' && doc.status !== 'paid' && status === 'paid') {
          await postPaymentLedger(
            client,
            req.tenantId,
            doc.document_number,
            parseFloat(doc.total_due),
            0, // gatewayFee (0 for manual/offline payments)
            doc.id,
            0, // convenienceFeeAmount
            0, // convenienceFeeTax
            parseFloat(doc.total_due), // baseInvoiceTotal
            true // isOffline
          );
        }

        return updated;
      });

      return res.json({ message: `Document status updated to '${status}'.`, data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 6. Soft-deletes a document (set status to 'voided') or hard-deletes if draft.
   */
  deleteDocument: async (req, res, next) => {
    const { id } = req.params;

    try {
      await runInTransaction(req.tenantId, async (client) => {
        const docRes = await client.query(
          'SELECT status FROM documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [req.tenantId, id]
        );

        if (docRes.rows.length === 0) {
          throw Object.assign(new Error('Document not found.'), { status: 404 });
        }

        const { status } = docRes.rows[0];

        if (status === 'draft') {
          // Hard delete for drafts (no financial history yet)
          await client.query('DELETE FROM documents WHERE tenant_id = $1 AND id = $2', [req.tenantId, id]);
        } else {
          // Soft delete for published/paid docs — preserve audit trail
          await client.query(
            `UPDATE documents SET status = 'voided' WHERE tenant_id = $1 AND id = $2`,
            [req.tenantId, id]
          );
        }
      });

      return res.json({ message: 'Document removed from active records.' });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 7. Generates a signed JWT magic link token for client portal access.
   * The token encodes documentId + tenantId and expires in 72 hours.
   */
  generateMagicToken: async (req, res, next) => {
    const { id } = req.params;

    try {
      // Verify document exists and belongs to this tenant
      const doc = await runInTransaction(req.tenantId, async (client) => {
        const res = await client.query(
          'SELECT id, type, document_number FROM documents WHERE tenant_id = $1 AND id = $2',
          [req.tenantId, id]
        );
        return res.rows[0] || null;
      });

      if (!doc) {
        return res.status(404).json({ error: 'Document not found.' });
      }

      const token = jwt.sign(
        { documentId: doc.id, tenantId: req.tenantId, type: doc.type },
        JWT_SECRET,
        { expiresIn: '72h' }
      );

      const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/documents/${token}`;

      return res.json({
        message: 'Magic link generated.',
        data: { token, portalUrl, documentNumber: doc.document_number, expiresIn: '72 hours' }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 8. Compiles email templates and sends document link/QR code to client.
   * Updates status to 'sent' if in draft/published state.
   */
  sendDocumentEmail: async (req, res, next) => {
    const { id } = req.params;
    const { subjectOverride, bodyOverride } = req.body || {};

    try {
      const emailResult = await runInTransaction(req.tenantId, async (client) => {
        // A. Load document, client, and tenant settings
        const docRes = await client.query(
          `SELECT d.*, c.name as client_name, c.email as client_email,
                  ts.business_info, ts.email_templates, ts.tax_config
           FROM documents d
           JOIN clients c ON d.client_id = c.id
           JOIN tenant_settings ts ON d.tenant_id = ts.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2`,
          [req.tenantId, id]
        );

        if (docRes.rows.length === 0) {
          throw Object.assign(new Error('Document not found.'), { status: 404 });
        }

        const doc = docRes.rows[0];
        const businessInfo = doc.business_info || {};
        const emailTemplates = doc.email_templates || {};
        const taxConfig = doc.tax_config || {};
        const currencySymbol = taxConfig.currencySymbol || '₹';

        // B. Generate portal magic token
        const token = jwt.sign(
          { documentId: doc.id, tenantId: req.tenantId, type: doc.type },
          JWT_SECRET,
          { expiresIn: '72h' }
        );

        const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/documents/${token}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(portalUrl)}`;

        // C. Select template based on type
        const templateKey = doc.type === 'quote' ? 'quote_availability' : 'invoice_availability';
        const template = emailTemplates[templateKey] || {
          subject: doc.type === 'quote' ? 'Quotation {{document_number}} is ready' : 'Invoice {{document_number}} generated',
          body: 'Hello {{client_name}},\n\nYour {{type}} is available here: {{portal_link}}'
        };

        let subject = subjectOverride || template.subject;
        let body = bodyOverride || template.body;

        // D. Replace placeholders
        const placeholders = {
          '{{document_number}}': doc.document_number,
          '{{client_name}}': doc.client_name,
          '{{portal_link}}': portalUrl,
          '{{due_date}}': new Date(doc.due_date).toLocaleDateString(),
          '{{amount}}': `${currencySymbol}${parseFloat(doc.total_due).toFixed(2)}`,
          '{{type}}': doc.type
        };

        for (const [key, value] of Object.entries(placeholders)) {
          subject = subject.replaceAll(key, value);
          body = body.replaceAll(key, value);
        }

        // E. Transition status to sent if draft/published BEFORE sending email
        // This ensures that if the email service fails and throws an error, the transaction rolls back these DB changes.
        if (['draft', 'published'].includes(doc.status)) {
          await client.query(
            `UPDATE documents SET status = 'sent' WHERE tenant_id = $1 AND id = $2`,
            [req.tenantId, id]
          );

          if (doc.type === 'invoice' && doc.status === 'draft') {
            await postInvoiceLedger(
              client, req.tenantId, doc.document_number,
              doc.sub_total, doc.tax_amount, doc.total_due, doc.id
            );
          }
        }

        // F. Build beautiful premium HTML email body with QR code and styling
        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #fafafa;
      color: #1e293b;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #fafafa;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 36px 30px;
      color: #ffffff;
      text-align: center;
    }
    .header img {
      max-height: 48px;
      margin-bottom: 16px;
      border-radius: 8px;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.025em;
    }
    .content {
      padding: 40px 35px;
    }
    .content p {
      line-height: 1.625;
      font-size: 15px;
      color: #334155;
      margin-bottom: 24px;
    }
    .card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
      text-align: center;
    }
    .card-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    .card-value {
      font-size: 30px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .card-meta {
      font-size: 14px;
      color: #475569;
    }
    .btn-container {
      text-align: center;
      margin-bottom: 30px;
    }
    .btn {
      display: inline-block;
      background-color: #3b82f6;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      padding: 14px 30px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
    }
    .qr-container {
      text-align: center;
      padding: 24px 20px;
      border-top: 1px dashed #e2e8f0;
      margin-top: 32px;
    }
    .qr-container p {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 12px;
    }
    .qr-code {
      border: 1px solid #e2e8f0;
      padding: 8px;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
    }
    .footer {
      background-color: #f8fafc;
      padding: 24px 30px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        ${businessInfo.logoUrl ? `<img src="${businessInfo.logoUrl}" alt="Logo">` : ''}
        <h1>${businessInfo.businessName || 'Business Document'}</h1>
      </div>
      <div class="content">
        <p style="white-space: pre-wrap; margin-top: 0;">${body.replace(portalUrl, '')}</p>
        
        <div class="card">
          <div class="card-label">${doc.type === 'quote' ? 'Quotation Estimate' : 'Amount Due'}</div>
          <div class="card-value">${currencySymbol}${parseFloat(doc.total_due).toFixed(2)}</div>
          <div class="card-meta">
            <strong>${doc.type === 'quote' ? 'Valid Until' : 'Due Date'}:</strong> ${new Date(doc.due_date).toLocaleDateString()}
          </div>
        </div>

        <div class="btn-container">
          <a href="${portalUrl}" class="btn" target="_blank">
            ${doc.type === 'quote' ? 'View & Respond to Quotation' : 'View & Pay Invoice Online'}
          </a>
        </div>

        <div class="qr-container">
          <p>${doc.type === 'quote' ? 'Scan the QR code below to view and accept this quotation on your mobile device:' : 'Scan the QR code below to view and pay on your mobile device:'}</p>
          <img src="${qrCodeUrl}" width="150" height="150" alt="${doc.type === 'quote' ? 'Quotation QR Code' : 'Payment QR Code'}" class="qr-code">
        </div>
      </div>
      <div class="footer">
        <p>This email was automatically generated by ${businessInfo.businessName || 'our systems'} on behalf of your vendor.</p>
        ${businessInfo.address ? `<p>${businessInfo.address}</p>` : ''}
      </div>
    </div>
  </div>
</body>
</html>
        `;

        // G. Send the email LAST as the external side-effect
        const sendRes = await emailService.sendEmail({
          to: doc.client_email,
          subject,
          body,
          html
        });

        return {
          success: true,
          recipient: doc.client_email,
          previewFile: sendRes.previewFile,
          portalUrl
        };
      });

      return res.json({
        message: `Document emailed successfully to ${emailResult.recipient}.`,
        data: emailResult
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 9. Returns notification badge counts for the sidebar.
   * Aggregates: pendingQuotes, overdueInvoices, unpaidInvoices.
   * Also returns subscription expiry info for the Subscription nav badge.
   */
  getNotificationCounts: async (req, res, next) => {
    try {
      const counts = await runInTransaction(req.tenantId, async (client) => {
        const result = await client.query(
          `SELECT
             COUNT(*) FILTER (WHERE type = 'quote'   AND status = 'sent')    AS pending_quotes,
             COUNT(*) FILTER (WHERE type = 'invoice' AND status = 'overdue') AS overdue_invoices,
             COUNT(*) FILTER (WHERE type = 'invoice' AND status = 'sent')    AS unpaid_invoices,
             COUNT(*) FILTER (WHERE type = 'invoice' AND status = 'pending_verification') AS pending_verification_invoices
           FROM documents
           WHERE tenant_id = $1`,
          [req.tenantId]
        );

        // Fetch subscription status for expiry badge
        const subResult = await client.query(
          `SELECT status, current_period_end, plan_id
           FROM subscriptions
           WHERE tenant_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.tenantId]
        );

        const row = result.rows[0];
        const sub = subResult.rows[0] || null;

        let subscription = null;
        if (sub) {
          const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
          const daysRemaining = periodEnd
            ? Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : null;
          subscription = {
            status: sub.status,
            daysRemaining,
            expiresAt: periodEnd ? periodEnd.toISOString() : null
          };
        }

        const feedQuery = await client.query(
          `SELECT id, type, document_number, status, due_date, total_due, client_id
           FROM documents
           WHERE tenant_id = $1 
             AND ((type = 'quote' AND status IN ('sent', 'accepted')) 
               OR (type = 'invoice' AND status IN ('overdue', 'pending_verification')))
           ORDER BY updated_at DESC
           LIMIT 15`,
          [req.tenantId]
        );

        const feed = feedQuery.rows.map(doc => ({
          id: doc.id,
          type: doc.type,
          title: doc.type === 'quote' 
            ? doc.status === 'accepted' 
              ? `Quote ${doc.document_number} accepted` 
              : `Quote ${doc.document_number} pending review`
            : doc.status === 'overdue' 
              ? `Invoice ${doc.document_number} is overdue`
              : `Invoice ${doc.document_number} pending UTR verification`,
          message: `Total: ₹${parseFloat(doc.total_due).toFixed(2)}`,
          actionUrl: doc.type === 'quote' ? `/quotes/${doc.id}` : `/invoices/${doc.id}`,
          date: doc.due_date,
          status: doc.status
        }));

        if (subscription && subscription.daysRemaining !== null && subscription.daysRemaining <= 14) {
          feed.unshift({
            id: 'sub-alert',
            type: 'subscription',
            title: `Subscription Expires in ${subscription.daysRemaining} days`,
            message: 'Please renew your subscription to avoid service interruption.',
            actionUrl: '/subscription',
            date: subscription.expiresAt,
            status: 'warning'
          });
        }

        return {
          pendingQuotes:               parseInt(row.pending_quotes,                10),
          overdueInvoices:             parseInt(row.overdue_invoices,              10),
          unpaidInvoices:              parseInt(row.unpaid_invoices,               10),
          pendingVerificationInvoices: parseInt(row.pending_verification_invoices, 10),
          subscription,
          feed
        };
      });

      return res.json(counts);
    } catch (err) {
      next(err);
    }
  }
};

export default documentController;
