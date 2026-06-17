/**
 * Double-Entry Accounting Ledger Service.
 * Updated to use the normalized debit/credit column model on ledger_entries,
 * replacing the direction VARCHAR + amount pattern.
 *
 * @dba: ledger_entries.debit and ledger_entries.credit are mutually exclusive columns
 *       enforced by the check_single_side DB constraint and trg_ledger_balance trigger.
 */

// Default chart of accounts seeded for every new tenant
export const DEFAULT_ACCOUNTS = [
  { name: 'Accounts Receivable',  type: 'asset',     code: 'AR_DEFAULT' },
  { name: 'Service Revenue',      type: 'revenue',   code: 'REV_DEFAULT' },
  { name: 'Cash',                 type: 'asset',     code: 'CASH_DEFAULT' },
  { name: 'Tax Liability',        type: 'liability', code: 'TAX_DEFAULT' },
  { name: 'Platform Fee Expense', type: 'expense',   code: 'FEE_DEFAULT' },
  { name: 'Vendor Payable',       type: 'liability', code: 'VENDOR_PAYABLE_DEFAULT' },
];

/**
 * Seeds the default chart of accounts for a newly onboarded tenant.
 * Must be called within an active transaction context.
 *
 * @param {import('pg').Client} client - Active transaction client.
 * @param {string} tenantId - UUID of the new tenant.
 */
export const initializeLedgerAccounts = async (client, tenantId) => {
  console.log(`[Ledger] Seeding ${DEFAULT_ACCOUNTS.length} default accounts for tenant: ${tenantId}`);
  for (const acct of DEFAULT_ACCOUNTS) {
    await client.query(
      `INSERT INTO ledger_accounts (tenant_id, name, type, code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, acct.name, acct.type, acct.code]
    );
  }
};

/**
 * Posts a balanced journal transaction to the ledger.
 * Validates debit/credit balance at the application layer as defense-in-depth.
 * The DB trigger (trg_ledger_balance) provides a second, kernel-level enforcement.
 *
 * @param {import('pg').Client} client - Active transaction client.
 * @param {string} tenantId - Tenant UUID.
 * @param {string} description - Description of the business event.
 * @param {string} transactionType - Enum: invoice_generation|invoice_payment|refund|vendor_payout|fee_deduction
 * @param {UUID|null} referenceId - Optional reference to a document UUID.
 * @param {Array<{code: string, debit?: number, credit?: number}>} entries - Journal entries (exactly one of debit/credit per entry).
 * @returns {Promise<string>} The created transaction UUID.
 */
export const postLedgerTransaction = async (client, tenantId, description, transactionType = 'general', referenceId = null, entries) => {
  if (!entries || entries.length < 2) {
    throw new Error('A valid ledger transaction requires at least two entries (one debit, one credit).');
  }

  // Application-layer balance check (defense-in-depth before DB trigger fires)
  let debitSum = 0;
  let creditSum = 0;

  for (const entry of entries) {
    if (entry.debit !== undefined && entry.debit !== null) {
      const val = parseFloat(entry.debit);
      if (isNaN(val) || val <= 0) throw new Error(`Invalid debit amount: ${entry.debit} for account: ${entry.code}`);
      if (entry.credit !== undefined && entry.credit !== null) throw new Error(`Entry for ${entry.code} has both debit and credit — violates check_single_side.`);
      debitSum += val;
    } else if (entry.credit !== undefined && entry.credit !== null) {
      const val = parseFloat(entry.credit);
      if (isNaN(val) || val <= 0) throw new Error(`Invalid credit amount: ${entry.credit} for account: ${entry.code}`);
      creditSum += val;
    } else {
      throw new Error(`Entry for account '${entry.code}' has neither debit nor credit — invalid.`);
    }
  }

  if (Math.abs(debitSum - creditSum) > 0.0001) {
    throw new Error(
      `Journal entry is out of balance. Total debits (${debitSum.toFixed(4)}) ≠ total credits (${creditSum.toFixed(4)}).`
    );
  }

  // 1. Create the parent transaction record
  const txResult = await client.query(
    `INSERT INTO ledger_transactions (tenant_id, transaction_type, description, reference_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [tenantId, transactionType, description, referenceId || null]
  );
  const transactionId = txResult.rows[0].id;

  // 2. Resolve account codes → UUIDs in a single query
  const codes = entries.map(e => e.code);
  const accountResult = await client.query(
    'SELECT id, code FROM ledger_accounts WHERE tenant_id = $1 AND code = ANY($2)',
    [tenantId, codes]
  );

  const accountMap = {};
  accountResult.rows.forEach(row => { accountMap[row.code] = row.id; });

  // 3. Insert individual ledger entries (debit OR credit, never both)
  for (const entry of entries) {
    const accountId = accountMap[entry.code];
    if (!accountId) {
      throw new Error(`Ledger account code '${entry.code}' not found for tenant context.`);
    }

    const debitVal = (entry.debit !== undefined && entry.debit !== null) ? parseFloat(entry.debit) : null;
    const creditVal = (entry.credit !== undefined && entry.credit !== null) ? parseFloat(entry.credit) : null;

    await client.query(
      `INSERT INTO ledger_entries (transaction_id, tenant_id, account_id, debit, credit)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, tenantId, accountId, debitVal, creditVal]
    );
  }

  // The deferred trigger (trg_ledger_balance) will verify balance at COMMIT time
  return transactionId;
};

/**
 * Posts journal entries when an invoice is finalized (status → published/sent).
 * Journal:
 *   DEBIT  AR_DEFAULT    totalDue   (asset increases — money owed to us)
 *   CREDIT REV_DEFAULT   subTotal   (revenue recognized)
 *   CREDIT TAX_DEFAULT   taxAmount  (tax liability owed to government)
 */
export const postInvoiceLedger = async (client, tenantId, documentNumber, subTotal, taxAmount, totalDue, documentId = null) => {
  const description = `Invoice Generation: ${documentNumber}`;
  const entries = [
    { code: 'AR_DEFAULT',  debit: totalDue },
    { code: 'REV_DEFAULT', credit: subTotal },
  ];

  if (parseFloat(taxAmount) > 0) {
    entries.push({ code: 'TAX_DEFAULT', credit: taxAmount });
  }

  return postLedgerTransaction(client, tenantId, description, 'invoice_generation', documentId, entries);
};

/**
 * Posts journal entries when a payment is received (webhook: order.paid).
 * Journal:
 *   DEBIT  CASH_DEFAULT   netAmount    (cash received, net of gateway fee)
 *   DEBIT  FEE_DEFAULT    gatewayFee   (gateway fee recognized as expense)
 *   CREDIT AR_DEFAULT     totalPaid    (clears accounts receivable)
 */
export const postPaymentLedger = async (client, tenantId, documentNumber, paidAmount, gatewayFee, documentId = null) => {
  const description = `Invoice Payment Received: ${documentNumber}`;
  const feeAmount = parseFloat(gatewayFee || 0);
  const cashAmount = parseFloat(paidAmount) - feeAmount;

  const entries = [
    { code: 'AR_DEFAULT',   credit: paidAmount },
    { code: 'CASH_DEFAULT', debit: cashAmount },
  ];

  if (feeAmount > 0) {
    entries.push({ code: 'FEE_DEFAULT', debit: feeAmount });
  }

  return postLedgerTransaction(client, tenantId, description, 'invoice_payment', documentId, entries);
};

/**
 * Computes the current balance of a specific ledger account by summing all entries.
 * balance = SUM(debit) - SUM(credit) for asset/expense accounts
 * balance = SUM(credit) - SUM(debit) for liability/revenue/equity accounts
 *
 * @param {import('pg').Client} client - Active transaction client.
 * @param {string} tenantId - Tenant UUID.
 * @param {string} accountCode - Account code (e.g. 'AR_DEFAULT').
 * @returns {Promise<number>}
 */
export const getAccountBalance = async (client, tenantId, accountCode) => {
  const result = await client.query(
    `SELECT
       COALESCE(SUM(le.debit), 0) AS total_debits,
       COALESCE(SUM(le.credit), 0) AS total_credits,
       la.type AS account_type
     FROM ledger_entries le
     JOIN ledger_accounts la ON le.account_id = la.id
     WHERE la.tenant_id = $1 AND la.code = $2
     GROUP BY la.type`,
    [tenantId, accountCode]
  );

  if (result.rows.length === 0) return 0;

  const { total_debits, total_credits, account_type } = result.rows[0];
  const debits = parseFloat(total_debits);
  const credits = parseFloat(total_credits);

  // Asset and Expense accounts have natural debit balances
  if (['asset', 'expense'].includes(account_type)) {
    return debits - credits;
  }
  // Liability, Equity, Revenue have natural credit balances
  return credits - debits;
};

/**
 * Fetches summarized balances for all ledger accounts of a tenant.
 * Used by the Dashboard to display the immutable accounting ledger summary.
 *
 * @param {import('pg').Client} client - Active transaction client.
 * @param {string} tenantId - Tenant UUID.
 * @returns {Promise<Array>}
 */
export const getAllAccountBalances = async (client, tenantId) => {
  const result = await client.query(
    `SELECT
       la.id,
       la.name,
       la.type,
       la.code,
       COALESCE(SUM(le.debit), 0)   AS total_debits,
       COALESCE(SUM(le.credit), 0)  AS total_credits
     FROM ledger_accounts la
     LEFT JOIN ledger_entries le ON la.id = le.account_id
     WHERE la.tenant_id = $1
     GROUP BY la.id, la.name, la.type, la.code
     ORDER BY la.type, la.code`,
    [tenantId]
  );

  return result.rows.map(row => {
    const debits = parseFloat(row.total_debits);
    const credits = parseFloat(row.total_credits);
    const isNaturalDebit = ['asset', 'expense'].includes(row.type);
    const balance = isNaturalDebit ? (debits - credits) : (credits - debits);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      code: row.code,
      balance: parseFloat(balance.toFixed(4))
    };
  });
};
