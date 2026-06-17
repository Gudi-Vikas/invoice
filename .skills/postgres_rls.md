---
name: postgres_rls
description: >
  SQL execution scripts, connection pool configurations, and transaction wrapper mechanics
  for enforcing Row-Level Security (RLS) in the multi-tenant PostgreSQL database.
  Load this skill when working on schema migrations, RLS policies, or DB connection logic.
triggers:
  - "RLS"
  - "row level security"
  - "tenant isolation"
  - "runInTransaction"
  - "schema migration"
  - "SET LOCAL"
---

# PostgreSQL Row-Level Security Skill

## The Core Problem
Standard connection pools recycle connections. If Tenant A's `app.current_tenant_id` session var
leaks into Tenant B's recycled connection, cross-tenant data exposure occurs.

## The Solution: Transaction-Scoped SET LOCAL

All tenant-scoped DB operations MUST use `SET LOCAL` (not `SET`) inside a transaction block.
`SET LOCAL` restricts the variable to the current transaction. On COMMIT or ROLLBACK, Postgres
automatically discards it — the pool connection is returned clean.

---

## The runInTransaction Wrapper (backend/config/db.js)

```javascript
export const runInTransaction = async (tenantId, callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) {
      // set_config(key, value, is_local=true) — LOCAL scope = transaction only
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // returns connection to pool — SET LOCAL is already cleared
  }
};
```

**NEVER use**: `await client.query('SET app.current_tenant_id = $1', [tenantId])` — this is session-level and persists after pool recycling.

---

## RLS Policy Pattern (for every tenant-scoped table)

```sql
-- Step 1: Enable RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Step 2: Read/Write isolation policy (SELECT, UPDATE, DELETE)
CREATE POLICY tenant_isolation_policy ON public.invoices
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Step 3: Insert isolation policy (prevents spoofed tenant_id on INSERT)
CREATE POLICY tenant_insert_policy ON public.invoices
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
```

The second argument `true` in `current_setting('app.current_tenant_id', true)` means:
"return NULL if the setting is missing" (instead of throwing an error).
This is critical — global queries (e.g., tenant lookup during auth) run without tenant context.

---

## Tables Requiring RLS

| Table | Reason |
|---|---|
| `tenant_users` | Role membership isolation |
| `tenant_settings` | Config isolation |
| `subscriptions` | Billing isolation |
| `clients` | Client data isolation |
| `documents` | Invoice/Quote isolation |
| `document_lines` | Line item isolation |
| `vendors` | Marketplace vendor isolation |
| `linked_accounts` | Razorpay account isolation |
| `transfers` | Split payment isolation |
| `ledger_accounts` | Chart of accounts isolation |
| `ledger_transactions` | Journal isolation |
| `ledger_entries` | Entry isolation |

**Global tables** (NO RLS): `tenants`, `users`, `plans`, `plan_features`, `processed_events`

---

## Bypassing RLS for Global Queries

During authentication, we need to query `users` and `tenant_users` globally.
Use the raw pool (not runInTransaction) for these global registry queries:

```javascript
// auth middleware — direct pool query, no RLS context needed
const memberCheck = await pool.query(
  'SELECT role FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
  [tenantId, userId]
);
```

`tenant_users` has RLS enabled, but `pool.query()` runs without `SET LOCAL` so
`current_setting('app.current_tenant_id', true)` returns NULL.
The policy `USING (tenant_id = NULL::UUID)` evaluates to FALSE for all rows — silent empty result.
This is correct for the global auth check (it's checking a separate lookup).

---

## Webhook Tenant Resolution (No Prior Tenant Context)

Webhooks arrive without a tenant context. The pattern is:
1. Query a GLOBAL table or run without RLS to find tenant_id from the payload
2. Then set RLS context before tenant-scoped queries

```javascript
// In webhook handler — find tenant from order ID (cross-tenant query)
await runInTransaction(null, async (client) => {
  const docRes = await client.query(
    'SELECT id, tenant_id FROM documents WHERE razorpay_order_id = $1',
    [rzpOrderId]
  );
  // NOTE: With tenantId=null, RLS blocks this query if RLS is active.
  // documents table has RLS, so we need to run this as the db owner / with bypassrls role
  // OR: use a separate pool connection that bypasses RLS for this initial lookup.
  const tenantId = docRes.rows[0]?.tenant_id;

  // Now re-set context with correct tenant
  await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
  // ... proceed with tenant-scoped queries
});
```

---

## Index Strategy

All tenant-scoped tables have composite indexes with `tenant_id` as the leading column:

```sql
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_status ON documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_type ON documents(tenant_id, type);
```

This ensures Postgres uses the index even when RLS filters are applied implicitly.

---

## Connection Pool Configuration

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/invoice_db',
  max: 20,               // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});
```

Keep `max` reasonable. High concurrency with many tenants and SET LOCAL per transaction
is safe because each transaction clears the state before releasing.
