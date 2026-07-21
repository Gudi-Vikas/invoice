import pool from '../config/db.js';

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE master_admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL');
    await client.query('ALTER TABLE master_admins ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES master_admins(id) ON DELETE SET NULL');
    console.log('✅ Migration complete: permissions + created_by columns added to master_admins.');

    const res = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'master_admins' ORDER BY ordinal_position"
    );
    console.log('Current columns:', res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
};

migrate();
