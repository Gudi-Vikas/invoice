/**
 * Increments the document number count and returns a formatted code.
 * Implements a strict row-level write lock (`FOR UPDATE`) on the tenant settings row
 * within the active transaction to guarantee that duplicate numbers are never generated
 * under high concurrency.
 * 
 * @param {import('pg').Client} client - Database client with active transaction context.
 * @param {string} tenantId - Tenant ID UUID.
 * @param {'invoice'|'quote'} type - The type of document to generate.
 * @returns {Promise<string>} The constructed, unique document sequence code.
 */
export const getNextDocumentNumber = async (client, tenantId, type) => {
  // Query with row-lock to block other sessions until current transaction commits
  const result = await client.query(
    'SELECT invoice_config FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE',
    [tenantId]
  );

  if (result.rows.length === 0) {
    throw new Error('Database settings not initialized for the specified tenant.');
  }

  const invoiceConfig = result.rows[0].invoice_config || {};
  const docKey = type === 'quote' ? 'quote' : 'invoice';
  
  // Extract or set fallback configuration objects
  const docConfig = invoiceConfig[docKey] || {
    prefix: type === 'quote' ? 'QT-' : 'INV-',
    suffix: '',
    autoIncrement: true,
    nextNumber: 1
  };

  const nextNumVal = parseInt(docConfig.nextNumber || 1, 10);
  const formattedCode = `${docConfig.prefix || ''}${nextNumVal}${docConfig.suffix || ''}`;

  if (docConfig.autoIncrement) {
    // Increment the sequence counter locally
    docConfig.nextNumber = nextNumVal + 1;
    invoiceConfig[docKey] = docConfig;

    // Persist the updated configuration back within the locked transaction
    await client.query(
      'UPDATE tenant_settings SET invoice_config = $1 WHERE tenant_id = $2',
      [invoiceConfig, tenantId]
    );
  }

  return formattedCode;
};
