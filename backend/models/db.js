const { Pool } = require('pg');
const config = require('../config/config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  // Connection pool settings (kept small — serverless spawns many instances)
  max: process.env.VERCEL ? 1 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PG pool error:', err.message);
});

/**
 * Execute a parameterized query (prevents SQL injection)
 * @param {string} text - SQL query string with $1, $2... placeholders
 * @param {Array} params - Array of parameter values
 */
const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DB] Query executed in ${duration}ms — rows: ${res.rowCount}`);
  }
  return res;
};

module.exports = { query, pool };