---
name: ledger_engine
description: >
  Double-entry accounting constraints for the financial ledger: schema structure,
  deferred zero-sum trigger, check_single_side constraint, chart of accounts,
  and posting patterns for invoices and payments.
triggers:
  - "ledger"
  - "accounting"
  - "double entry"
  - "journal entry"
  - "debit credit"
  - "postLedger"
  - "initializeLedger"
---

# Double-Entry Ledger Engine Skill

## Fundamental Accounting Equation
Every transaction must satisfy: **SUM(debits) = SUM(credits)**

Money never appears or disappears — it moves from one account node to another.
A ledger is not a balance table; it records every movement to reconstruct balances at any point in time.

---

## Schema Structure (3-Table Model)

### `ledger_accounts` — Account Nodes
```sql
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  code VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_tenant_account_code UNIQUE (tenant_id, code)
);
```

### `ledger_transactions` — Business Event Wrappers
```sql
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_type VARCHAR(100) NOT NULL DEFAULT 'general',
  -- Values: invoice_generation, invoice_payment, refund, fee_deduction, vendor_payout
  description TEXT,
  reference_id UUID,   -- links to document ID
  posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `ledger_entries` — Atomic Debit/Credit Records
```sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES ledger_accounts(tenant_id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE CASCADE,
  debit NUMERIC(15, 4),   -- populated OR null
  credit NUMERIC(15, 4),  -- populated OR null
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- check_single_side: exactly one of debit/credit must be non-null
  CONSTRAINT check_single_side CHECK (
    (debit IS NOT NULL AND credit IS NULL) OR
    (credit IS NOT NULL AND debit IS NULL)
  ),
  CONSTRAINT check_positive_amount CHECK (
    COALESCE(debit, credit) > 0
  )
);
```

---

## Zero-Sum Deferred Trigger

This trigger fires AFTER all entries for a transaction are inserted, and BEFORE commit.
It mathematically proves `SUM(debit) = SUM(credit)` for the transaction group.

```sql
-- Trigger function
CREATE OR REPLACE FUNCTION check_ledger_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debits  NUMERIC;
  total_credits NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO total_debits, total_credits
  FROM ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  IF ABS(total_debits - total_credits) > 0.0001 THEN
    RAISE EXCEPTION 'Ledger imbalance: debits (%) != credits (%) for transaction %',
      total_debits, total_credits, NEW.transaction_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deferred constraint trigger (fires at COMMIT time, not per row)
CREATE CONSTRAINT TRIGGER trg_ledger_balance
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();
```

The `DEFERRABLE INITIALLY DEFERRED` is critical: it allows multiple entries to be inserted
within the same transaction before the balance is checked. Without deferral, the trigger
would fire after the FIRST entry (which is always unbalanced alone) and reject the transaction.

---

## Default Chart of Accounts (seeded per tenant on signup)

```javascript
export const DEFAULT_ACCOUNTS = [
  { name: 'Accounts Receivable', type: 'asset',     code: 'AR_DEFAULT' },
  { name: 'Service Revenue',     type: 'revenue',   code: 'REV_DEFAULT' },
  { name: 'Cash',                type: 'asset',     code: 'CASH_DEFAULT' },
  { name: 'Tax Liability',       type: 'liability', code: 'TAX_DEFAULT' },
  { name: 'Platform Fee Expense',type: 'expense',   code: 'FEE_DEFAULT' },
  { name: 'Vendor Payable',      type: 'liability', code: 'VENDOR_PAYABLE_DEFAULT' },
];
```

---

## Posting Patterns

### Invoice Generation (status → 'published')
| Entry | Account | Debit | Credit |
|---|---|---|---|
| Cash expected | Accounts Receivable (AR_DEFAULT) | totalDue | — |
| Revenue earned | Service Revenue (REV_DEFAULT) | — | subTotal |
| Tax owed to govt | Tax Liability (TAX_DEFAULT) | — | taxAmount |

```javascript
const entries = [
  { code: 'AR_DEFAULT',  debit: totalDue,  credit: null },
  { code: 'REV_DEFAULT', debit: null,      credit: subTotal },
  { code: 'TAX_DEFAULT', debit: null,      credit: taxAmount },
];
```

### Payment Received (webhook: order.paid)
| Entry | Account | Debit | Credit |
|---|---|---|---|
| Cash in bank | Cash (CASH_DEFAULT) | netAmount | — |
| Gateway fee | Platform Fee (FEE_DEFAULT) | gatewayFee | — |
| Clears AR | Accounts Receivable (AR_DEFAULT) | — | totalPaid |

```javascript
const entries = [
  { code: 'CASH_DEFAULT', debit: netAmount,   credit: null },
  { code: 'FEE_DEFAULT',  debit: gatewayFee,  credit: null },
  { code: 'AR_DEFAULT',   debit: null,         credit: totalPaid },
];
```

---

## Balance Calculation Query

To compute a client's receivable balance:
```sql
SELECT
  COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance
FROM ledger_entries le
JOIN ledger_accounts la ON le.account_id = la.id
WHERE la.tenant_id = $1
  AND la.code = 'AR_DEFAULT';
```

---

## Application-Layer Balance Check (defense-in-depth)

Before calling the DB trigger, the service layer validates balance:
```javascript
const debitSum = entries.filter(e => e.debit).reduce((s, e) => s + e.debit, 0);
const creditSum = entries.filter(e => e.credit).reduce((s, e) => s + e.credit, 0);
if (Math.abs(debitSum - creditSum) > 0.0001) {
  throw new Error(`Imbalance: debits ${debitSum} ≠ credits ${creditSum}`);
}
```

This catches errors at the application layer before they even hit the DB trigger.
