import pool from './config/db.js';

const runAlters = async () => {
  try {
    await pool.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS offline_payment_info JSONB;
    `);
    console.log('Alters successful');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
};

runAlters();
