# Auth Flow — Context Snapshot
_Generated: 2026-06-15 | Read this file before touching any auth code._

## Stack
- Backend: Node.js + Express (ES Modules), PostgreSQL via `pg` pool
- Auth: JWT HS256, `x-tenant-id` header for tenant resolution
- DB: `runInTransaction(tenantId, callback)` from `backend/config/db.js`
- Schema applied via: `node backend/config/initDb.js` (reads schema.sql)

## Key Files
| File | Role |
|---|---|
| `backend/controllers/authController.js` | signup + login handlers |
| `backend/routes/auth.js` | mounts POST /signup, /login |
| `backend/middleware/auth.js` | authenticateToken, requireTenant, checkRole |
| `backend/config/schema.sql` | PostgreSQL schema (CREATE TABLE IF NOT EXISTS) |
| `backend/config/db.js` | pool + runInTransaction |
| `frontend/src/api.js` | API client (has mock fallback + HARDCODED tenant ID) |

## DB Tables (auth-relevant)
```
tenants          — id, name, domain, status, created_at
users            — id, email (UNIQUE), password_hash, created_at
tenant_users     — (tenant_id, user_id) PK, role (admin/billing/member)
tenant_settings  — tenant_id PK, general_config, business_info, ...JSONB
subscriptions    — id, tenant_id, plan_id, status, current_period_end
ledger_accounts  — seeded per tenant on signup
```

## Issues Found & Fixed in This Session

### ✅ FIXED — Problem 1: No duplicate email guard on signup
- Old: raw INSERT → PG 23505 unique_violation → 500 crash
- Fix: catch error code `23505`, return 400 with clear message
- **Tested**: ✅ returns `{ "error": "An account with this email address already exists." }`

### ✅ FIXED — Problem 2: No way to join an existing tenant
- Added `tenant_invites` table to schema.sql (**already migrated to Aiven**)
- Added `POST /auth/invite` (admin only) → creates invite record, returns token
- Added `POST /auth/join` (public) → redeems token, creates/links user
- **Tested**: ✅ new user joins, receives JWT; duplicate redeem → 410 Gone

### ✅ FIXED — Problem 3: No tenant switcher
- Added `POST /auth/switch-tenant` (authenticated) → verifies membership, re-issues JWT
- **Tested**: ✅ returns new JWT; invalid tenant → 403

### 🔴 PENDING — Problem 4: Frontend `api.js` hardcoded tenant ID
- Line 169 in `frontend/src/api.js`: `'x-tenant-id': 'a1111111-...'`
- Must be replaced with `localStorage.getItem('invoice_saas_tenantId')`
- DEFERRED — frontend work deferred by user

### 🔴 PENDING — Problem 5: No Login/Signup screen on frontend
- App.jsx renders dashboard unconditionally with no auth guard
- Need `Auth.jsx` component + auth guard in App.jsx
- DEFERRED — frontend work deferred by user

## New API Endpoints Added

### POST /api/v1/auth/invite
- Auth: `authenticateToken + requireTenant + checkRole(['admin'])`
- Body: `{ email: string, role: 'admin'|'billing'|'member' }`
- Creates row in `tenant_invites`, returns `{ inviteToken, expiresAt }`
- Token is a UUID (opaque), stored in DB, expires in 72h, single-use

### POST /api/v1/auth/join
- Auth: public (no token required)
- Body: `{ inviteToken: string, password: string }`
- Validates invite (not expired, not used)
- If email already has a `users` row → links existing user to tenant
- If email is new → creates user + links to tenant
- Marks invite `used_at = NOW()`
- Returns: `{ token (JWT), user, activeTenant }`

### POST /api/v1/auth/switch-tenant
- Auth: `authenticateToken` (any valid JWT, no requireTenant needed)
- Body: `{ tenantId: string }`
- Verifies `tenant_users` membership for requesting user
- Re-issues JWT with new `tenantId` claim
- Returns: `{ token, activeTenant }`

## tenant_invites Table (added to schema.sql)
```sql
CREATE TABLE IF NOT EXISTS tenant_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_pending_invite UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_token ON tenant_invites(token);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON tenant_invites(tenant_id);
```
_Note: No RLS on tenant_invites — public join redemption needs unguarded reads._

## JWT Payload Shape
```json
{ "id": "user-uuid", "email": "user@email.com", "tenantId": "tenant-uuid" }
```
Expiry: 24h. Secret: `process.env.JWT_SECRET || 'supersecretjwtkey123!'`

## runInTransaction Usage Pattern
```js
// tenantId = null → no SET LOCAL (used for global tables like users/tenants)
// tenantId = string → sets app.current_tenant_id for RLS
const result = await runInTransaction(null, async (client) => {
  // ... queries using client, NOT pool
});
```
