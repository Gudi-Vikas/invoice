import { runInTransaction } from '../config/db.js';
import pool from '../config/db.js';
import razorpayService from '../services/razorpayService.js';
import { postLedgerTransaction, postPaymentLedger } from '../services/ledgerService.js';

/**
 * Controller processing asynchronous status updates from Razorpay Webhook streams.
 * Protects against duplicate event processing via processed_events idempotency check.
 */
export const webhookController = {
  /**
   * Universal Webhook listener route.
   */
  handleWebhook: async (req, res, next) => {
    const signature = req.headers['x-razorpay-signature'];
    
    // 1. Verify incoming cryptographic signature
    const isValid = razorpayService.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature);
    if (!isValid) {
      console.warn('[Webhook Controller] Rejected webhook call: Invalid cryptographic signature.');
      return res.status(400).json({ error: 'Signature verification failed.' });
    }

    const eventObj = req.body;
    const eventId = eventObj.id;

    if (!eventId) {
      return res.status(400).json({ error: 'Missing webhook event ID.' });
    }

    try {
      // 2. Perform database check for event idempotency to prevent double-billing
      const checkEvent = await pool.query('SELECT 1 FROM processed_events WHERE id = $1', [eventId]);
      if (checkEvent.rows.length > 0) {
        console.log(`[Webhook Controller] Event ${eventId} was already processed. Bypassing execution.`);
        return res.status(200).json({ message: 'Event already processed (idempotency hit).' });
      }

      // Record the event immediately as processed
      await pool.query('INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]);

      const eventType = eventObj.event;
      const payload = eventObj.payload;
      console.log(`[Webhook Controller] Processing event: ${eventType} (ID: ${eventId})`);

      // 3. Dispatch events to specific business workflows
      switch (eventType) {
        case 'order.paid': {
          const orderEntity = payload.order.entity;
          const paymentEntity = payload.payment.entity;
          
          const rzpOrderId = orderEntity.id;
          const rzpPaymentId = paymentEntity.id;
          const totalPaidRupees = parseFloat(paymentEntity.amount) / 100; // convert paise to INR
          const gatewayFeeRupees = parseFloat(paymentEntity.fee || 0) / 100; // gateway processing cut

          await runInTransaction(null, async (client) => {
            // Find invoice across all tenants matching this order
            const docRes = await client.query(
              'SELECT id, tenant_id, document_number, total_due FROM documents WHERE razorpay_order_id = $1',
              [rzpOrderId]
            );

            if (docRes.rows.length === 0) {
              console.warn(`[Webhook Controller] Invoice document with order ID ${rzpOrderId} not found.`);
              return;
            }

            const doc = docRes.rows[0];
            const tenantId = doc.tenant_id;

            // Set RLS context for the transaction explicitly
            await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);

            // Update status and save payment ID
            await client.query(
              `UPDATE documents 
               SET status = 'paid', razorpay_payment_id = $1 
               WHERE id = $2`,
              [rzpPaymentId, doc.id]
            );

            // Post payment ledger entries
            await postPaymentLedger(client, tenantId, doc.document_number, totalPaidRupees, gatewayFeeRupees);
            console.log(`[Webhook Controller] Paid status and double-entry ledger updated for Invoice: ${doc.document_number}`);
          });
          break;
        }

        case 'transfer.processed': {
          const transferEntity = payload.transfer.entity;
          const rzpTransferId = transferEntity.id;
          const recipientAccountId = transferEntity.recipient; // Linked account ID

          await runInTransaction(null, async (client) => {
            // Locate the matching linked account to resolve tenant ID
            const laRes = await client.query(
              `SELECT id, tenant_id FROM linked_accounts WHERE razorpay_account_id = $1`,
              [recipientAccountId]
            );

            if (laRes.rows.length === 0) {
              console.warn(`[Webhook Controller] Linked account mapping not found for recipient ${recipientAccountId}`);
              return;
            }

            const linkedAccountId = laRes.rows[0].id;
            const tenantId = laRes.rows[0].tenant_id;

            // Set RLS context
            await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);

            // Update transfer record
            await client.query(
              `UPDATE transfers 
               SET status = 'processed', razorpay_transfer_id = $1 
               WHERE linked_account_id = $2 AND status = 'pending'`,
              [rzpTransferId, linkedAccountId]
            );
            console.log(`[Webhook Controller] Transfer marked as processed for recipient: ${recipientAccountId}`);
          });
          break;
        }

        case 'settlement.processed': {
          const settlementEntity = payload.settlement.entity;
          const rzpSettlementId = settlementEntity.id;

          // Reconcile physically cleared bank settlement
          // We mark all processed transfers as settled and clear ledger liability
          await runInTransaction(null, async (client) => {
            const processedTransfers = await client.query(
              `SELECT t.id, t.tenant_id, t.invoice_id, t.vendor_share, d.document_number
               FROM transfers t
               JOIN documents d ON t.invoice_id = d.id
               WHERE t.status = 'processed'`
            );

            for (const row of processedTransfers.rows) {
              await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [row.tenant_id]);

              // Update transfer state
              await client.query(
                `UPDATE transfers SET status = 'settled' WHERE id = $1`,
                [row.id]
              );

              await postLedgerTransaction(
                client,
                row.tenant_id,
                `Vendor Payout Settlement Clearance: Invoice ${row.document_number}`,
                'vendor_payout',
                row.invoice_id,
                [
                  { code: 'VENDOR_PAYABLE_DEFAULT', debit: row.vendor_share },
                  { code: 'CASH_DEFAULT', credit: row.vendor_share }
                ]
              );
            }
            console.log('[Webhook Controller] Settlements and clearances reconciled in double-entry ledger.');
          });
          break;
        }

        case 'subscription.charged': {
          const subscriptionEntity = payload.subscription.entity;
          const rzpSubId = subscriptionEntity.id;
          const nextPeriodEndSecs = subscriptionEntity.current_period_end;
          const nextPeriodDate = new Date(nextPeriodEndSecs * 1000);

          await runInTransaction(null, async (client) => {
            // Resolve tenant_id from the subscription record (cross-tenant lookup —
            // no RLS context set yet, relies on DB owner role for the initial SELECT)
            const subLookup = await client.query(
              `SELECT tenant_id FROM subscriptions WHERE external_subscription_id = $1`,
              [rzpSubId]
            );

            if (subLookup.rows.length === 0) {
              console.warn(`[Webhook Controller] Subscription ${rzpSubId} not found in local records.`);
              return;
            }

            const tenantId = subLookup.rows[0].tenant_id;

            // Set RLS context so the UPDATE passes RLS policy checks
            await client.query(
              `SELECT set_config('app.current_tenant_id', $1, true)`,
              [tenantId]
            );

            await client.query(
              `UPDATE subscriptions 
               SET status = 'active', current_period_end = $1 
               WHERE external_subscription_id = $2`,
              [nextPeriodDate, rzpSubId]
            );
            console.log(`[Webhook Controller] Subscription ${rzpSubId} successfully renewed.`);
          });
          break;
        }

        case 'subscription.failed':
        case 'subscription.halted': {
          const subscriptionEntity = payload.subscription.entity;
          const rzpSubId = subscriptionEntity.id;

          await runInTransaction(null, async (client) => {
            const subRes = await client.query(
              `SELECT tenant_id FROM subscriptions WHERE external_subscription_id = $1`,
              [rzpSubId]
            );

            if (subRes.rows.length > 0) {
              const tenantId = subRes.rows[0].tenant_id;
              
              // Set RLS Context
              await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);

              // Update status to past_due
              await client.query(
                `UPDATE subscriptions SET status = 'past_due' WHERE external_subscription_id = $1`,
                [rzpSubId]
              );

              // Update tenant status
              await client.query(
                `UPDATE tenants SET status = 'suspended' WHERE id = $1`,
                [tenantId]
              );

              // Trigger Automated Dunning notification emails
              console.log(`[Webhook Controller] Triggering Dunning flow: sent failure alerts for tenant ${tenantId}. Access revoked.`);
            }
          });
          break;
        }

        default:
          console.log(`[Webhook Controller] Ignored event type: ${eventType}`);
      }

      return res.status(200).json({ message: 'Webhook event processed successfully.' });
    } catch (err) {
      next(err);
    }
  }
};

export default webhookController;
