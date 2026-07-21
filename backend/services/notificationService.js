import eventBus from './eventBus.js';
import pool, { runInTransaction } from '../config/db.js';

let ioInstance;

export const initNotificationService = (io) => {
  ioInstance = io;

  // Listen to all events and log them or handle them appropriately
  eventBus.on('invoice.paid', async (data) => {
    await handleEvent('invoice_paid', 'Invoice Paid', `Invoice ${data.invoiceNumber} has been successfully paid.`, data.tenantId, data.userId, `/invoices?highlight=${data.invoiceId}`);
  });

  eventBus.on('quote.accepted', async (data) => {
    await handleEvent('quote_accepted', 'Quote Accepted', `Quote ${data.quoteNumber} was accepted by the client.`, data.tenantId, data.userId, `/quotes?highlight=${data.quoteId}`);
  });

  eventBus.on('quote.declined', async (data) => {
    await handleEvent('quote_declined', 'Quote Declined', `Quote ${data.quoteNumber} was declined by the client.`, data.tenantId, data.userId, `/quotes?highlight=${data.quoteId}`);
  });

  eventBus.on('invoice.offline_payment_submitted', async (data) => {
    await handleEvent('offline_payment', 'Offline Payment Submitted', `Payment reference ${data.reference} submitted for Invoice ${data.invoiceNumber}. Verification required.`, data.tenantId, data.userId, `/invoices?highlight=${data.invoiceId}`);
  });

  eventBus.on('document.created', async (data) => {
    await handleEvent('document_created', 'New Document', `A new ${data.type} was created: ${data.documentNumber}.`, data.tenantId, null, `/${data.type}s/${data.documentId}`);
  });

  // Master events
  eventBus.on('tenant.created', async (data) => {
    await handleEvent('tenant_created', 'New Tenant', `A new tenant registered: ${data.name}`, null, null, `/master/tenants/${data.tenantId}`);
  });
};

const handleEvent = async (type, title, message, tenantId, userId, actionUrl) => {
  console.log(`[NotificationService] Handling event: ${type} for tenant: ${tenantId}`);
  try {
    // 1. Insert into persistent DB
    const client = await pool.connect();
    let notification;
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      }

      const result = await client.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, message, action_url) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId || null, userId || null, type, title, message, actionUrl]
      );
      notification = result.rows[0];

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // 2. Push to WebSocket
    console.log(`[NotificationService] Emitting via socket to ${tenantId ? `tenant_${tenantId}` : 'master'}`);
    if (ioInstance) {
      if (tenantId) {
        ioInstance.to(`tenant_${tenantId}`).emit('notification', notification);
      } else {
        ioInstance.to('master').emit('notification', notification);
      }
    } else {
      console.warn('[NotificationService] ioInstance is not defined!');
    }

    // 3. (Optional) Email Logic
    // Depending on notification_preferences, we would dispatch emails here.

  } catch (error) {
    console.error('Failed to process notification event:', error);
  }
};
