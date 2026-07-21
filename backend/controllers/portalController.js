import jwt from 'jsonwebtoken';
import pool, { runInTransaction } from '../config/db.js';
import { getNextDocumentNumber } from '../utils/sequence.js';
import { postInvoiceLedger, postPaymentLedger } from '../services/ledgerService.js';
import razorpayService from '../services/razorpayService.js';
import eventBus from '../services/eventBus.js';

const JWT_SECRET = process.env.JWT_SECRET;

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
                  ts.business_info, ts.translations, ts.tax_config, ts.payments_config, ts.invoice_config
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
                  dl.vendor_id, dl.vendor_cost, dl.sort_order, v.business_name as vendor_name, v.platform_fee_percentage
           FROM document_lines dl
           LEFT JOIN vendors v ON dl.vendor_id = v.id
           LEFT JOIN linked_accounts la ON v.id = la.vendor_id
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

          // H. Mark quote as converted
          await client.query(
            `UPDATE documents SET is_converted_to_invoice = true WHERE tenant_id = $1 AND id = $2`,
            [tenantId, id]
          );
        }

        eventBus.emit('quote.accepted', {
          tenantId,
          quoteNumber: quote.document_number,
          quoteId: quote.id
        });

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
   * 2b. Handles quote rejection/decline.
   */
  declineQuote: async (req, res, next) => {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Magic link token is required.' });
    }

    try {
      const decoded = verifyPortalToken(token, id, 'quote');
      const { tenantId } = decoded;

      const result = await runInTransaction(tenantId, async (client) => {
        // Verify and lock the quotation
        const quoteRes = await client.query(
          `SELECT * FROM documents WHERE tenant_id = $1 AND id = $2 AND type = 'quote' FOR UPDATE`,
          [tenantId, id]
        );

        if (quoteRes.rows.length === 0) {
          throw new Error('Quotation not found.');
        }

        const quote = quoteRes.rows[0];
        if (quote.status === 'accepted') {
          throw new Error('Quotation has already been accepted.');
        }
        if (quote.status === 'declined') {
          return { quote, status: 'already_declined' };
        }

        // Update quote status to declined
        await client.query(
          `UPDATE documents SET status = 'declined' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id]
        );
        quote.status = 'declined';

        eventBus.emit('quote.declined', {
          tenantId,
          quoteNumber: quote.document_number,
          quoteId: quote.id
        });

        return { quote, status: 'declined' };
      });

      return res.json({
        message: 'Quotation declined successfully.',
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
        // A. Fetch the invoice details alongside settings
        const invoiceRes = await client.query(
          `SELECT d.id, d.document_number, d.total_due, d.status, ts.payments_config
           FROM documents d
           JOIN tenant_settings ts ON d.tenant_id = ts.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2 AND d.type = 'invoice'`,
          [tenantId, id]
        );

        if (invoiceRes.rows.length === 0) {
          throw new Error('Invoice not found.');
        }

        const invoice = invoiceRes.rows[0];
        if (invoice.status === 'paid') {
          throw new Error('Invoice has already been settled.');
        }

        const paymentsConfig = invoice.payments_config || {};
        const passGatewayFees = paymentsConfig.passGatewayFees === true;

        let finalPayableAmount = parseFloat(invoice.total_due);
        let surcharge = 0;
        let surchargeTax = 0;

        if (passGatewayFees) {
          const feeBase = finalPayableAmount * 0.02;
          const feeTax = feeBase * 0.18;
          surcharge = feeBase;
          surchargeTax = feeTax;
          finalPayableAmount = finalPayableAmount + feeBase + feeTax;
        }

        let rzpOrder;
        const isOAuthPayment = paymentsConfig.razorpayConnected === true && paymentsConfig.razorpayAccessToken;

        if (isOAuthPayment) {
          // A1. OAuth Direct Payment: Create a plain order on the tenant's connected merchant account
          const amountInPaise = Math.round(finalPayableAmount * 100);
          if (razorpayService.isMockMode) {
            rzpOrder = {
              id: `order_oauth_${Math.random().toString(36).substring(7)}`,
              amount: amountInPaise,
              currency: 'INR',
              status: 'created'
            };
          } else {
            // Direct REST call to Razorpay API on behalf of the tenant
            const response = await fetch('https://api.razorpay.com/v1/orders', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${paymentsConfig.razorpayAccessToken}`
              },
              body: JSON.stringify({
                amount: amountInPaise,
                currency: 'INR',
                receipt: invoice.document_number
              })
            });
            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`Razorpay direct order creation failed: ${errText}`);
            }
            rzpOrder = await response.json();
          }

          // Update the invoice document with the Razorpay order ID and surcharge details
          await client.query(
            `UPDATE documents 
             SET razorpay_order_id = $1, 
                 convenience_fee_enabled = $4, 
                 convenience_fee_amount = $5, 
                 convenience_fee_tax_amount = $6 
             WHERE tenant_id = $2 AND id = $3`,
            [rzpOrder.id, tenantId, id, passGatewayFees, surcharge, surchargeTax]
          );
        } else {
          // Route-based payments (Platform admin account splits payments to marketplace vendors)
          // B. Fetch line items to determine vendor components
          const linesRes = await client.query(
            `SELECT dl.*, la.razorpay_account_id, v.platform_fee_percentage, v.business_name, v.pan_verified
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
              let vendorGross = 0;
              let platformFee = 0;

              if (line.vendor_cost !== null && line.vendor_cost !== undefined) {
                vendorGross = parseFloat(line.vendor_cost) * parseFloat(line.quantity || 1);
                platformFee = lineAmount - vendorGross;
              } else {
                const feePercent = parseFloat(line.platform_fee_percentage || 5.00);
                platformFee = lineAmount * (feePercent / 100);
                vendorGross = lineAmount - platformFee;
              }
              
              const tdsRate = line.pan_verified ? 0.001 : 0.05;
              const tdsAmount = vendorGross * tdsRate;
              const vendorNetTransfer = vendorGross - tdsAmount;

              transfers.push({
                razorpayAccountId: line.razorpay_account_id,
                amount: vendorNetTransfer,
                vendorId: line.vendor_id,
                description: `Split share for line item: ${line.description}`,
                on_hold: true,
                notes: {
                  vendor_name: line.business_name || 'Vendor',
                  tds_deducted_inr: parseFloat(tdsAmount.toFixed(4))
                }
              });

              pendingTransfersToRecord.push({
                linkedAccountIdQuery: `SELECT id FROM linked_accounts WHERE razorpay_account_id = $1 AND tenant_id = $2`,
                razorpayAccountId: line.razorpay_account_id,
                totalAmount: lineAmount,
                vendorShare: vendorNetTransfer,
                platformFee
              });
            }
          }

          // D. Create Razorpay order containing the routing transfers specification
          rzpOrder = await razorpayService.createOrderWithSplits(finalPayableAmount, transfers);

          // Update the invoice document with the Razorpay order ID and convenience fee specifics
          await client.query(
            `UPDATE documents 
             SET razorpay_order_id = $1, 
                 convenience_fee_enabled = $4, 
                 convenience_fee_amount = $5, 
                 convenience_fee_tax_amount = $6 
             WHERE tenant_id = $2 AND id = $3`,
            [rzpOrder.id, tenantId, id, passGatewayFees, surcharge, surchargeTax]
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
        }

        return {
          orderId: rzpOrder.id,
          amount: finalPayableAmount,
          surcharge: surcharge,
          currency: 'INR',
          documentNumber: invoice.document_number,
          keyId: isOAuthPayment ? paymentsConfig.razorpayKeyId : (process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey'),
          mockMode: razorpayService.isMockMode
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

            // Delay split and settlement events to mimic real-life delays
            setTimeout(async () => {
              try {
                const transfersRes = await pool.query(
                  `SELECT t.vendor_share, la.razorpay_account_id
                   FROM transfers t
                   JOIN linked_accounts la ON t.linked_account_id = la.id
                   WHERE t.invoice_id = $1`,
                  [id]
                );

                for (const row of transfersRes.rows) {
                  const transferEventId = `evt_trsf_${Math.random().toString(36).substring(7)}`;
                  await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-razorpay-signature': 'mock_sig_123'
                    },
                    body: JSON.stringify({
                      id: transferEventId,
                      event: 'transfer.processed',
                      payload: {
                        transfer: {
                          entity: {
                            id: `trsf_${Math.random().toString(36).substring(7)}`,
                            recipient: row.razorpay_account_id,
                            amount: Math.round(parseFloat(row.vendor_share) * 100)
                          }
                        }
                      }
                    })
                  });
                  console.log(`[Mock Webhook] Dispatched transfer.processed background hook for recipient: ${row.razorpay_account_id}`);
                }

                // Fire settlement.processed after transfers are processed
                setTimeout(async () => {
                  try {
                    const settlementEventId = `evt_setl_${Math.random().toString(36).substring(7)}`;
                    await fetch(webhookUrl, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-razorpay-signature': 'mock_sig_123'
                      },
                      body: JSON.stringify({
                        id: settlementEventId,
                        event: 'settlement.processed',
                        payload: {
                          settlement: {
                            entity: {
                              id: `setl_${Math.random().toString(36).substring(7)}`,
                              amount: amountInPaise
                            }
                          }
                        }
                      })
                    });
                    console.log(`[Mock Webhook] Dispatched settlement.processed background hook successfully.`);
                  } catch (err) {
                    console.error('[Mock Webhook] Error triggering settlement webhook:', err.message);
                  }
                }, 1000);

              } catch (err) {
                console.error('[Mock Webhook] Error triggering transfer webhooks:', err.message);
              }
            }, 1000);

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
  },

  verifyPayment: async (req, res, next) => {
    const { id } = req.params;
    const { token, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!token || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification payload is incomplete.' });
    }

    try {
      const decoded = verifyPortalToken(token, id, 'invoice');
      const { tenantId } = decoded;

      const isValid = razorpayService.verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });

      if (!isValid) {
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }

      const result = await runInTransaction(tenantId, async (client) => {
        // A. Verify and lock the invoice alongside settings
        const docRes = await client.query(
          `SELECT d.id, d.document_number, d.sub_total, d.tax_amount, d.total_due, d.status, ts.payments_config,
                  d.convenience_fee_amount, d.convenience_fee_tax_amount
           FROM documents d
           JOIN tenant_settings ts ON d.tenant_id = ts.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2 AND d.type = 'invoice' FOR UPDATE`,
          [tenantId, id]
        );

        if (docRes.rows.length === 0) {
          throw new Error('Invoice not found.');
        }

        const invoice = docRes.rows[0];
        if (invoice.status === 'paid') {
          return invoice;
        }

        // B. Update status to paid and save payment ID
        await client.query(
          `UPDATE documents 
           SET status = 'paid', razorpay_payment_id = $1 
           WHERE id = $2`,
          [razorpay_payment_id, id]
        );

        // C. Record double-entry ledger inputs for the payment (estimate 2% fee, pass invoice UUID reference)
        const paymentsConfig = invoice.payments_config || {};
        const passGatewayFees = paymentsConfig.passGatewayFees === true;

        let totalPaidRupees = parseFloat(invoice.total_due);
        let gatewayFeeRupees = totalPaidRupees * 0.02;

        if (passGatewayFees) {
          totalPaidRupees = parseFloat(invoice.total_due) + parseFloat(invoice.convenience_fee_amount) + parseFloat(invoice.convenience_fee_tax_amount);
          // When passing gateway fees, the fee charged by razorpay is precisely the sum of these variables
          gatewayFeeRupees = parseFloat(invoice.convenience_fee_amount) + parseFloat(invoice.convenience_fee_tax_amount);
        }

        await postPaymentLedger(
          client, 
          tenantId, 
          invoice.document_number, 
          totalPaidRupees, 
          gatewayFeeRupees, 
          id,
          parseFloat(invoice.convenience_fee_amount || 0),
          parseFloat(invoice.convenience_fee_tax_amount || 0),
          parseFloat(invoice.total_due)
        );

        eventBus.emit('invoice.paid', {
          tenantId,
          invoiceNumber: invoice.document_number,
          invoiceId: invoice.id,
          paymentId: razorpay_payment_id
        });

        return { ...invoice, status: 'paid' };
      });

      return res.json({
        message: 'Payment verified and invoice marked as paid.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Submits offline payment details (UTR reference, notes, method) from the Client Portal.
   * Transitions invoice to 'pending_verification' status.
   */
  verifyOfflinePayment: async (req, res, next) => {
    const { id } = req.params;
    const { token, paymentMethod, transactionReference, notes } = req.body;

    if (!token || !paymentMethod || !transactionReference) {
      return res.status(400).json({ error: 'Magic access token, payment method, and transaction reference are required.' });
    }

    try {
      const decoded = verifyPortalToken(token, id, 'invoice');
      const { tenantId } = decoded;

      const result = await runInTransaction(tenantId, async (client) => {
        // Fetch matching document details
        const docRes = await client.query(
          `SELECT id, status, document_number FROM documents WHERE tenant_id = $1 AND id = $2 AND type = 'invoice'`,
          [tenantId, id]
        );

        if (docRes.rows.length === 0) {
          throw new Error('Invoice not found.');
        }

        const invoice = docRes.rows[0];
        if (invoice.status === 'paid') {
          throw new Error('Invoice has already been settled.');
        }

        const offlineInfo = {
          method: paymentMethod,
          reference: transactionReference,
          notes: notes || '',
          submittedAt: new Date().toISOString()
        };

        // Update document status to pending_verification and save offline payment details
        await client.query(
          `UPDATE documents 
           SET status = 'pending_verification', offline_payment_info = $1 
           WHERE id = $2`,
          [offlineInfo, id]
        );

        eventBus.emit('invoice.offline_payment_submitted', {
          tenantId,
          invoiceNumber: invoice.document_number,
          invoiceId: invoice.id,
          reference: transactionReference
        });

        return { ...invoice, status: 'pending_verification', offline_payment_info: offlineInfo };
      });

      return res.json({
        message: 'Offline payment details submitted for verification successfully.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
};

export default portalController;
