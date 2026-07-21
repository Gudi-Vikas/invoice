import pool from './config/db.js';

const migrate = async () => {
  try {
    console.log('Running migration...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          action_url VARCHAR(255),
          is_read BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notification_preferences (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          preferences JSONB NOT NULL DEFAULT '{"email": true, "in_app": true}'::jsonb,
          PRIMARY KEY (user_id, tenant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);

      ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
      ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS notifications_isolation ON notifications;
      DROP POLICY IF EXISTS notification_preferences_isolation ON notification_preferences;

      CREATE POLICY notifications_isolation ON notifications FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR tenant_id IS NULL);
      CREATE POLICY notification_preferences_isolation ON notification_preferences FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    `);
    console.log('Migration successful.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

migrate();
