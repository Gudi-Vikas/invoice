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
    await handleEvent('tenant_created', 'New Tenant Registered', `A new tenant registered: ${data.name}`, null, null, `/master/tenants/${data.tenantId}`);
  });

  eventBus.on('tenant.suspended', async (data) => {
    await handleEvent('tenant_suspended', 'Tenant Suspended', `Tenant "${data.name}" was suspended.${data.reason ? ` Reason: ${data.reason}` : ''}`, null, null, `/master/tenants/${data.tenantId}`);
  });

  eventBus.on('tenant.enabled', async (data) => {
    await handleEvent('tenant_enabled', 'Tenant Re-activated', `Tenant "${data.name}" was re-activated.`, null, null, `/master/tenants/${data.tenantId}`);
  });

  eventBus.on('platform_billing.created', async (data) => {
    await handleEvent('platform_billing_created', 'Platform Invoice Generated', `Invoice ${data.invoiceNumber} (₹${parseFloat(data.amount).toFixed(2)}) generated for tenant.`, null, null, '/master/billing');
  });

  eventBus.on('platform_billing.paid', async (data) => {
    await handleEvent('platform_billing_paid', 'Platform Invoice Paid', `Platform invoice ${data.invoiceNumber} (₹${parseFloat(data.amount).toFixed(2)}) has been marked as paid.`, null, null, '/master/billing');
  });

  eventBus.on('platform_billing.voided', async (data) => {
    await handleEvent('platform_billing_voided', 'Platform Invoice Voided', `Platform invoice ${data.invoiceNumber} was voided.`, null, null, '/master/billing');
  });

  eventBus.on('subscription.created', async (data) => {
    await handleEvent('subscription_created', 'Subscription Purchased', `Tenant "${data.tenantName || 'A tenant'}" subscribed to ${data.planName || 'a plan'}.`, null, null, data.tenantId ? `/master/tenants/${data.tenantId}` : '/master/tenants');
  });

  eventBus.on('subscription.overridden', async (data) => {
    await handleEvent('subscription_overridden', 'Subscription Overridden', `Subscription was manually overridden for tenant.`, null, null, `/master/tenants/${data.tenantId}`);
  });

  eventBus.on('master_admin.created', async (data) => {
    await handleEvent('master_admin_created', 'Co-Admin Created', `New master admin account created: ${data.email}`, null, null, '/master/admins');
  });

  eventBus.on('plan.created', async (data) => {
    await handleEvent('plan_created', 'SaaS Plan Created', `New subscription plan "${data.name}" created.`, null, null, '/master/plans');
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
