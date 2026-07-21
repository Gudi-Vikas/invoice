    -- ==========================================================================
    -- Invoice SaaS Platform — PostgreSQL Schema
    -- Multi-Tenant Pool Model with Row-Level Security (RLS)
    -- @dba: All tenant-scoped tables enforce USING (tenant_id = current_setting(...))
    -- ==========================================================================

    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    -- =========================================================================
    -- GLOBAL TABLES (No Row-Level Security — Accessible without tenant context)
    -- =========================================================================

    -- 1. Tenants Table
    CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, suspended, trial
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Users Table (Global registry for authentication)
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. SaaS Plans Table
    CREATE TABLE IF NOT EXISTS plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        price_monthly NUMERIC(10, 2) NOT NULL,
        external_product_id VARCHAR(255), -- Razorpay product ID(used for communication with payment gateway)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. SaaS Plan Features Table
    CREATE TABLE IF NOT EXISTS plan_features (
        plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
        feature_key VARCHAR(255) NOT NULL,
        usage_limit INTEGER NOT NULL, -- -1 for unlimited, 0 for disabled
        PRIMARY KEY (plan_id, feature_key)
    );

    -- 5. Webhook Idempotency Table — Prevents double-processing of payment events (Idempotency is the property of an operation where applying it multiple times yields the same outcome as applying it just once. ex:if a user clicks "Pay Now" multiple times, only one payment should be processed and recorded in the system.)
    CREATE TABLE IF NOT EXISTS processed_events (   
        id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(100),
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Master Admins (Platform Owner Control Plane — Ultrakey IT Solutions)
    -- No RLS — master admins are a cross-tenant identity, bootstrapped via CLI only.
    -- is_active flag allows disabling a co-admin without deleting their audit record.
    CREATE TABLE IF NOT EXISTS master_admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        -- RBAC: JSON array of allowed section keys.
        -- NULL = full (unrestricted) access. Example: '["dashboard","tenants"]'
        -- Allowed keys: dashboard, plans, tenants, billing, admins
        permissions JSONB DEFAULT NULL,
        created_by UUID REFERENCES master_admins(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP
    );

    -- 7. Platform Billing Invoices (Ultrakey → Tenant subscription billing)
    -- Separate from tenant documents: these are OWNED by the master admin system,
    -- not by any tenant. They represent what Ultrakey charges its customers.
    -- Invoice number format: UKEY-BILL-YYYYMM-NNNN (e.g. UKEY-BILL-202406-0001)
    CREATE TABLE IF NOT EXISTS platform_billing_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id UUID REFERENCES plans(id),
        invoice_number VARCHAR(100) NOT NULL UNIQUE,
        billing_period_start DATE NOT NULL,
        billing_period_end DATE NOT NULL,
        amount NUMERIC(15, 4) NOT NULL,            -- pre-tax amount
        tax_percentage NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
        tax_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        total_amount NUMERIC(15, 4) NOT NULL,       -- amount + tax_amount
        status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, sent, paid, overdue, void
        due_date DATE NOT NULL,
        notes TEXT,
        razorpay_order_id VARCHAR(255),
        razorpay_payment_id VARCHAR(255),
        paid_at TIMESTAMP,
        created_by UUID REFERENCES master_admins(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 7b. Platform Invoice Sequences (Thread-safe sequence tracking)
    CREATE TABLE IF NOT EXISTS platform_invoice_sequences (
        prefix VARCHAR(20) PRIMARY KEY,
        last_seq INTEGER NOT NULL DEFAULT 0
    );


    -- =========================================================================
    -- TENANT-SCOPED TABLES (Row-Level Security Enabled)
    -- =========================================================================

    -- 6. Tenant Users Mapping (Associates global users with specific tenants and roles)
    CREATE TABLE IF NOT EXISTS tenant_users (
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL DEFAULT 'member', -- admin, billing, member
        PRIMARY KEY (tenant_id, user_id) -- composite PK ensures a user can only have one role per tenant 
    );

    -- 6b. Tenant Invites (One-time invite tokens so new/existing users can join a tenant)
    --     @dba: No RLS — the public join endpoint must read this without a tenant context.
    --     UNIQUE(tenant_id, email) prevents spamming duplicate invites to the same address.
    CREATE TABLE IF NOT EXISTS tenant_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member', -- admin, billing, member
        token UUID NOT NULL DEFAULT gen_random_uuid(),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP, -- NULL = still valid; populated when redeemed
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_pending_invite UNIQUE (tenant_id, email)
    );

    -- 7. Tenant Settings (Stores configuration JSONB blocks per functional domain)
    CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        general_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        business_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        invoice_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        tax_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        payments_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        email_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
        translations JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    -- 8. Subscriptions
    CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id UUID NOT NULL REFERENCES plans(id),
        status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, past_due, canceled
        current_period_end TIMESTAMP NOT NULL,
        external_subscription_id VARCHAR(255), -- Razorpay subscription ID
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Clients (End-customers of the tenant)
    CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        extra_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_tenant_client_email UNIQUE (tenant_id, email)
    );

    -- 10. Documents (Quotes and Invoices)
    CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL, -- quote, invoice
        document_number VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, published, sent, accepted, paid, overdue, voided
        issue_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        due_date TIMESTAMP NOT NULL,
        sub_total NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        discount_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        tax_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        total_due NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        razorpay_order_id VARCHAR(255),
        razorpay_payment_id VARCHAR(255),
        notes TEXT,
        convenience_fee_enabled BOOLEAN NOT NULL DEFAULT false,
        convenience_fee_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        convenience_fee_tax_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0000,
        offline_payment_info JSONB,
        is_converted_to_invoice BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_tenant_document_number UNIQUE (tenant_id, document_number)
    );

    -- 11. Document Line Items
    CREATE TABLE IF NOT EXISTS document_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        quantity NUMERIC(15, 4) NOT NULL,
        description TEXT NOT NULL,
        unit_price NUMERIC(15, 4) NOT NULL,
        adjust NUMERIC(15, 4) NOT NULL DEFAULT 0.0000, -- per-line discount (+) or markup (-)
        amount NUMERIC(15, 4) NOT NULL,               -- (quantity * unit_price) + adjust
        vendor_id UUID, -- If associated with a marketplace vendor
        vendor_cost NUMERIC(15, 4), -- Dedicated cost/payout for this line item (optional)
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 12. Marketplace Vendors
    CREATE TABLE IF NOT EXISTS vendors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_name VARCHAR(255) NOT NULL,
        kyc_status VARCHAR(50) NOT NULL DEFAULT 'uninitiated', -- uninitiated, under_review, active, needs_clarification
        platform_fee_percentage NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        address JSONB DEFAULT '{}'::jsonb,
        razorpay_account_id VARCHAR(255) UNIQUE,
        pan_number VARCHAR(255),
        pan_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_tenant_vendor_email UNIQUE (tenant_id, email)
    );

    -- 13. Linked Accounts (Razorpay Route account details mapped to vendors)
    CREATE TABLE IF NOT EXISTS linked_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        razorpay_account_id VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'created', -- created, active, suspended
        auth_token TEXT, -- OAuth token for fund transfers
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 14. Transfers (Split payment tracking per invoice payout)
    CREATE TABLE IF NOT EXISTS transfers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        linked_account_id UUID NOT NULL REFERENCES linked_accounts(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        total_amount NUMERIC(15, 4) NOT NULL,
        vendor_share NUMERIC(15, 4) NOT NULL,
        platform_fee NUMERIC(15, 4) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processed, settled, failed
        razorpay_transfer_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 15. Double-Entry Ledger Accounts (Chart of Accounts)
    CREATE TABLE IF NOT EXISTS ledger_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        code VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_tenant_account_code UNIQUE (tenant_id, code)
    );

    -- 16. Double-Entry Ledger Transactions (Business Event Wrappers)
    CREATE TABLE IF NOT EXISTS ledger_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        transaction_type VARCHAR(100) NOT NULL DEFAULT 'general',
        description TEXT,
        reference_id UUID, -- optional link to document ID
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 17. Double-Entry Ledger Entries (Atomic Debit/Credit Records)
    -- @dba: check_single_side ensures EXACTLY ONE of debit/credit is populated per row
    CREATE TABLE IF NOT EXISTS ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE CASCADE,
        debit NUMERIC(15, 4),
        credit NUMERIC(15, 4),
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        -- Structural constraint: one side only
        CONSTRAINT check_single_side CHECK (
            (debit IS NOT NULL AND credit IS NULL) OR
            (credit IS NOT NULL AND debit IS NULL)
        ),
        -- Ensure amounts are strictly positive
        CONSTRAINT check_positive_amount CHECK (
            COALESCE(debit, credit) > 0
        )
    );

    -- 18. Persistent Notifications (Point-in-Time Events)
    CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for master admins
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,     -- NULL for tenant-wide broadcasts
        type VARCHAR(50) NOT NULL,                               -- 'invoice_paid', 'quote_accepted'
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        action_url VARCHAR(255),
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. User Notification Preferences
    CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        preferences JSONB NOT NULL DEFAULT '{"email": true, "in_app": true}'::jsonb,
        PRIMARY KEY (user_id, tenant_id)
    );


    -- =========================================================================
    -- INDEX STRUCTURE (tenant_id as the leading column on all tenant-scoped tables)
    -- =========================================================================
    CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_invites_token  ON tenant_invites(token);
    CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON tenant_invites(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_documents_tenant_type ON documents(tenant_id, type);
    CREATE INDEX IF NOT EXISTS idx_documents_tenant_status ON documents(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_document_lines_tenant ON document_lines(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_document_lines_document ON document_lines(document_id);
    CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON vendors(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_linked_accounts_tenant ON linked_accounts(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_transfers_tenant ON transfers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_accounts_tenant ON ledger_accounts(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_transactions_tenant ON ledger_transactions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_tenant ON ledger_entries(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction ON ledger_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);
    CREATE INDEX IF NOT EXISTS idx_documents_rzp_order ON documents(razorpay_order_id);
    -- Platform billing indexes
    CREATE INDEX IF NOT EXISTS idx_platform_billing_tenant  ON platform_billing_invoices(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_platform_billing_status  ON platform_billing_invoices(status);
    CREATE INDEX IF NOT EXISTS idx_platform_billing_created ON platform_billing_invoices(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);


    -- =========================================================================
    -- ROW-LEVEL SECURITY ENABLERS & POLICIES
    -- =========================================================================
    ALTER TABLE tenant_users       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant_settings    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE subscriptions      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE clients            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE documents          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE document_lines     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE vendors            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE linked_accounts    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE transfers          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ledger_accounts    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ledger_entries     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

    -- Dynamic tenant authorization: SET LOCAL 'app.current_tenant_id' within each transaction
    -- The second arg (true) = return NULL if unset (not an error), making global queries safe
    CREATE POLICY tenant_users_isolation        ON tenant_users        FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY tenant_settings_isolation     ON tenant_settings      FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY subscriptions_isolation       ON subscriptions        FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY clients_isolation             ON clients              FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY documents_isolation           ON documents            FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY document_lines_isolation      ON document_lines       FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY vendors_isolation             ON vendors              FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY linked_accounts_isolation     ON linked_accounts      FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY transfers_isolation           ON transfers            FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY ledger_accounts_isolation     ON ledger_accounts      FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY ledger_transactions_isolation ON ledger_transactions   FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY ledger_entries_isolation      ON ledger_entries        FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    CREATE POLICY notifications_isolation       ON notifications         FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR tenant_id IS NULL);
    CREATE POLICY notification_preferences_isolation ON notification_preferences FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


    -- =========================================================================
    -- DEFERRED ZERO-SUM TRIGGER — Enforces SUM(debit) = SUM(credit) per transaction
    -- @dba: DEFERRABLE INITIALLY DEFERRED fires at COMMIT, not per row insert
    -- =========================================================================
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
            RAISE EXCEPTION 'Ledger imbalance detected: debits (%) != credits (%) for transaction %',
                total_debits, total_credits, NEW.transaction_id;
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Drop and recreate to ensure idempotent schema initialization
    DROP TRIGGER IF EXISTS trg_ledger_balance ON ledger_entries;

    CREATE CONSTRAINT TRIGGER trg_ledger_balance
    AFTER INSERT OR UPDATE ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();

    -- =========================================================================
    -- AUTOMATIC UPDATED_AT TRIGGER FOR DOCUMENTS
    -- =========================================================================
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
    CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


    -- =========================================================================
    -- SEED DATA (SaaS Plans and Plan Features)
    -- =========================================================================
    INSERT INTO plans (id, name, price_monthly, external_product_id) VALUES
    ('b3310000-0000-0000-0000-000000000001', 'Starter Plan', 999.00, 'plan_T386GQb9xDOYte')
    ON CONFLICT DO NOTHING;

    INSERT INTO plan_features (plan_id, feature_key, usage_limit) VALUES
    ('b3310000-0000-0000-0000-000000000001', 'max_invoices_per_month', 50),
    ('b3310000-0000-0000-0000-000000000001', 'max_vendors',             2),
    ('b3310000-0000-0000-0000-000000000001', 'custom_branding',         1)
    ON CONFLICT DO NOTHING;
