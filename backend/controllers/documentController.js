import jwt from 'jsonwebtoken';
import { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger } from '../services/ledgerService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

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
               (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [savedDoc.id, req.tenantId, line.quantity, line.description,
             line.unitPrice, line.adjust, line.amount, line.vendorId, line.sortOrder]
          );
        }

        // G. Post to ledger if publishing an invoice immediately
        if (type === 'invoice' && ['published', 'sent'].includes(savedDoc.status)) {
          await postInvoiceLedger(client, req.tenantId, docNumber, subTotal, taxAmount, totalDue, savedDoc.id);
        }

        return savedDoc;
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
   * 2. Retrieves a paginated list of documents with optional status, type, and date filters.
   */
  getDocuments: async (req, res, next) => {
    const { type, status, dateFrom, dateTo } = req.query;
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 50, 10);
    const offset = (page - 1) * limit;

    try {
      const results = await runInTransaction(req.tenantId, async (client) => {
        let sql = `
          SELECT d.id, d.type, d.document_number, d.status,
                 d.sub_total, d.discount_amount, d.tax_amount, d.total_due,
                 d.due_date, d.issue_date, d.created_at, d.razorpay_order_id,
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

        sql += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const dataQuery = await client.query(sql, [...params, limit, offset]);

        let countSql = 'SELECT COUNT(*) as count FROM documents WHERE tenant_id = $1';
        const countParams = [req.tenantId];
        if (type) { countParams.push(type); countSql += ` AND type = $${countParams.length}`; }
        if (status) { countParams.push(status); countSql += ` AND status = $${countParams.length}`; }

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
   * 3. Retrieves detailed record of a specific document including line items.
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
          `SELECT dl.id, dl.quantity, dl.description, dl.unit_price, dl.adjust, dl.amount, dl.vendor_id, dl.sort_order,
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
   * 4. Updates a document's status. Triggers ledger posting when moving to published/sent.
   */
  updateDocumentStatus: async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'published', 'sent', 'accepted', 'paid', 'overdue', 'voided'];
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
        const wasPublished = ['published', 'sent'].includes(doc.status);
        const isNowPublished = ['published', 'sent'].includes(status);

        // Update status
        const updateRes = await client.query(
          `UPDATE documents SET status = $1 WHERE tenant_id = $2 AND id = $3 RETURNING *`,
          [status, req.tenantId, id]
        );
        const updated = updateRes.rows[0];

        // Trigger ledger posting if invoice first moves to published/sent
        if (doc.type === 'invoice' && !wasPublished && isNowPublished) {
          await postInvoiceLedger(
            client, req.tenantId, doc.document_number,
            doc.sub_total, doc.tax_amount, doc.total_due, doc.id
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
   * 5. Soft-deletes a document (set status to 'voided') or hard-deletes if draft.
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
   * 6. Generates a signed JWT magic link token for client portal access.
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
  }
};

export default documentController;
