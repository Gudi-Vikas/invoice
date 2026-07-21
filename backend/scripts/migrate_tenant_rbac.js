import pool from '../config/db.js';

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL');
    await client.query('ALTER TABLE tenant_invites ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL');
    console.log('✅ Migration complete: permissions column added to tenant_users and tenant_invites.');

    const res1 = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenant_users' ORDER BY ordinal_position"
    );
    console.log('tenant_users columns:', res1.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    
    const res2 = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenant_invites' ORDER BY ordinal_position"
    );
    console.log('tenant_invites columns:', res2.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
};

migrate();
