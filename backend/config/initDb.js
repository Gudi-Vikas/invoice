import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const initDb = async () => {
  try {
    console.log('Reading schema.sql...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Executing schema script on PostgreSQL...');
    await pool.query(sql);
    console.log('Database initialized successfully with schemas, indexes, RLS policies, and seeds.');
  } catch (err) {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  } finally {
    // Release the pool connection since this script is a one-shot process
    await pool.end();
  }
};

initDb();
