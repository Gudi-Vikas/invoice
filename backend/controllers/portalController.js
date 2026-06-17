import jwt from 'jsonwebtoken';
import { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger } from '../services/ledgerService.js';
import razorpayService from '../services/razorpayService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123!';

const verifyPortalToken = (token, expectedDocumentId, expectedType) => {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (String(decoded.documentId) !== String(expectedDocumentId)) {
    const err = new Error('Magic link does not match the requested document.');
    err.status = 403;
    throw err;
  }

  if (expectedType && decoded.type && decoded.type !== expectedType) {
    const err = new Error(`Magic link is not valid for ${expectedType} actions.`);
    err.status = 403;
    throw err;
  }

  return decoded;
};

/**
 * Controller managing secure, external client-facing portal endpoints.
 */
export const portalController = {
  /**
   * 1. Fetches a quote or invoice details using a signed magic token.
   */
  getDocumentByToken: async (req, res, next) => {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: 'Magic access token is required.' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const { documentId, tenantId } = decoded;

      const details = await runInTransaction(tenantId, async (client) => {
        const docRes = await client.query(
          `SELECT d.*, c.name as client_name, c.email as client_email, c.billing_address,
                  ts.business_info, ts.translations, ts.tax_config
           FROM documents d
           JOIN clients c ON d.client_id = c.id
           JOIN tenant_settings ts ON d.tenant_id = ts.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2`,
          [tenantId, documentId]
        );

        if (docRes.rows.length === 0) {
          return null;
        }

        const linesRes = await client.query(
          `SELECT dl.id, dl.quantity, dl.description, dl.unit_price, dl.adjust, dl.amount,
                  dl.vendor_id, dl.sort_order, v.business_name as vendor_name
           FROM document_lines dl
           LEFT JOIN vendors v ON dl.vendor_id = v.id
           WHERE dl.tenant_id = $1 AND dl.document_id = $2
           ORDER BY dl.sort_order ASC`,
          [tenantId, documentId]
        );

        return {
          document: docRes.rows[0],
          lines: linesRes.rows
        };
      });

      if (!details) {
        return res.status(404).json({ error: 'Requested document could not be found.' });
      }

      return res.json(details);
    } catch (err) {
      console.error('Magic link authorization failure:', err.message);
      return res.status(403).json({ error: 'The link has expired or is invalid.' });
    }
  },

  /**
   * 2. Handles quote acceptance.
   * Promotes accepted quotes to draft or published invoices according to settings.
   */
  acceptQuote: async (req, res, next) => {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Magic link token is required.' });
    }

    try {
      const decoded = verifyPortalToken(token, id, 'quote');
      const { tenantId } = decoded;

      const result = await runInTransaction(tenantId, async (client) => {
        // A. Verify and lock the quotation
        const quoteRes = await client.query(
          `SELECT * FROM documents WHERE tenant_id = $1 AND id = $2 AND type = 'quote' FOR UPDATE`,
          [tenantId, id]
        );

        if (quoteRes.rows.length === 0) {
          throw new Error('Quotation not found.');
        }

        const quote = quoteRes.rows[0];
        if (quote.status === 'accepted') {
          return { quote, invoice: null, status: 'already_accepted' };
        }

        // B. Update quote status
        await client.query(
          `UPDATE documents SET status = 'accepted' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id]
        );
        quote.status = 'accepted';

        // C. Fetch action settings
        const settingsRes = await client.query(
          `SELECT invoice_config FROM tenant_settings WHERE tenant_id = $1`,
          [tenantId]
        );
        const invoiceConfig = settingsRes.rows[0]?.invoice_config || {};
        const quoteSettings = invoiceConfig.quote || {};

        let newInvoice = null;

        // D. Perform auto-conversion to invoice if enabled
        if (quoteSettings.actionOnAccept === 'convert_to_invoice') {
          const invSettings = invoiceConfig.invoice || {};
          const docNumber = await getNextDocumentNumber(client, tenantId, 'invoice');

          const invoiceDueDate = new Date();
          invoiceDueDate.setDate(invoiceDueDate.getDate() + parseInt(invSettings.dueDateDays || 14, 10));

          // E. Create the duplicate invoice document
          const invoiceRes = await client.query(
            `INSERT INTO documents
               (tenant_id, client_id, type, document_number, status, sub_total, discount_amount, tax_amount, total_due, due_date, notes)
             VALUES ($1, $2, 'invoice', $3, 'published', $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              tenantId,
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
          newInvoice = invoiceRes.rows[0];

          // F. Fetch quote lines and clone them for the invoice
          const linesRes = await client.query(
            `SELECT * FROM document_lines WHERE tenant_id = $1 AND document_id = $2`,
            [tenantId, id]
          );

          for (const line of linesRes.rows) {
            await client.query(
              `INSERT INTO document_lines
                 (document_id, tenant_id, quantity, description, unit_price, adjust, amount, vendor_id, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                newInvoice.id,
                tenantId,
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

          // G. Automatically trigger double-entry ledger inputs for the new published invoice
          await postInvoiceLedger(client, tenantId, docNumber, quote.sub_total, quote.tax_amount, quote.total_due, newInvoice.id);
        }

        return { quote, invoice: newInvoice, status: 'accepted' };
      });

      return res.json({
        message: result.invoice 
          ? 'Quotation accepted and converted to invoice.' 
          : 'Quotation status set to accepted.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 3. Prepares payment initialization.
   * Compiles split transfers for marketplace vendors and constructs a Razorpay Order.
   */
  initializePayment: async (req, res, next) => {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Magic link token is required.' });
    }

    try {
      const decoded = verifyPortalToken(token, id, 'invoice');
      const { tenantId } = decoded;

      const paymentDetails = await runInTransaction(tenantId, async (client) => {
        // A. Fetch the invoice details
        const invoiceRes = await client.query(
          `SELECT id, document_number, total_due, status FROM documents WHERE tenant_id = $1 AND id = $2 AND type = 'invoice'`,
          [tenantId, id]
        );

        if (invoiceRes.rows.length === 0) {
          throw new Error('Invoice not found.');
        }

        const invoice = invoiceRes.rows[0];
        if (invoice.status === 'paid') {
          throw new Error('Invoice has already been settled.');
        }

        // B. Fetch line items to determine vendor components
        const linesRes = await client.query(
          `SELECT dl.*, la.razorpay_account_id, v.platform_fee_percentage, v.business_name
           FROM document_lines dl
           LEFT JOIN vendors v ON dl.vendor_id = v.id
           LEFT JOIN linked_accounts la ON v.id = la.vendor_id
           WHERE dl.tenant_id = $1 AND dl.document_id = $2`,
          [tenantId, id]
        );

        const transfers = [];
        const pendingTransfersToRecord = [];

        // C. Parse splits for line items managed by third-party marketplace vendors
        for (const line of linesRes.rows) {
          if (line.vendor_id && line.razorpay_account_id) {
            const lineAmount = parseFloat(line.amount);
            const feePercent = parseFloat(line.platform_fee_percentage || 5.00);

            const platformFee = lineAmount * (feePercent / 100);
            const vendorShare = lineAmount - platformFee;

            transfers.push({
              razorpayAccountId: line.razorpay_account_id,
              amount: vendorShare,
              vendorId: line.vendor_id,
              description: `Split share for line item: ${line.description}`
            });

            pendingTransfersToRecord.push({
              linkedAccountIdQuery: `SELECT id FROM linked_accounts WHERE razorpay_account_id = $1 AND tenant_id = $2`,
              razorpayAccountId: line.razorpay_account_id,
              totalAmount: lineAmount,
              vendorShare,
              platformFee
            });
          }
        }

        // D. Create Razorpay order containing the routing transfers specification
        const rzpOrder = await razorpayService.createOrderWithSplits(invoice.total_due, transfers);

        // Update the invoice document with the Razorpay order ID
        await client.query(
          `UPDATE documents SET razorpay_order_id = $1 WHERE tenant_id = $2 AND id = $3`,
          [rzpOrder.id, tenantId, id]
        );

        // E. Save pending transfer records for asynchronous webhook reconciliation
        for (const pt of pendingTransfersToRecord) {
          const laQuery = await client.query(pt.linkedAccountIdQuery, [pt.razorpayAccountId, tenantId]);
          const linkedAccountId = laQuery.rows[0]?.id;

          if (linkedAccountId) {
            await client.query(
              `INSERT INTO transfers (invoice_id, linked_account_id, tenant_id, total_amount, vendor_share, platform_fee, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
              [invoice.id, linkedAccountId, tenantId, pt.totalAmount, pt.vendorShare, pt.platformFee]
            );
          }
        }

        return {
          orderId: rzpOrder.id,
          amount: invoice.total_due,
          currency: 'INR',
          documentNumber: invoice.document_number
        };
      });

      // If in mock developer mode, trigger the order.paid webhook callback asynchronously
      const isMock = !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_mockkey');
      if (isMock) {
        setTimeout(async () => {
          try {
            const port = process.env.PORT || 5000;
            const webhookUrl = `http://localhost:${port}/api/webhooks`;
            const mockEventId = `evt_mock_${Date.now()}`;
            
            // Calculate amount in paise
            const amountInPaise = Math.round(parseFloat(paymentDetails.amount) * 100);
            
            await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': 'mock_sig_123'
              },
              body: JSON.stringify({
                id: mockEventId,
                event: 'order.paid',
                payload: {
                  order: {
                    entity: {
                      id: paymentDetails.orderId,
                      amount: amountInPaise
                    }
                  },
                  payment: {
                    entity: {
                      id: `pay_mock_${Date.now()}`,
                      amount: amountInPaise,
                      fee: Math.round(amountInPaise * 0.02)
                    }
                  }
                }
              })
            });
            console.log(`[Mock Webhook] Dispatched order.paid background hook successfully for order: ${paymentDetails.orderId}`);
          } catch (err) {
            console.error('[Mock Webhook] Error triggering local webhook:', err.message);
          }
        }, 500);
      }

      return res.json({
        message: 'Payment order prepared.',
        data: paymentDetails
      });
    } catch (err) {
      next(err);
    }
  }
};

export default portalController;
