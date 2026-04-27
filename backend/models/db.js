const { Pool } = require('pg');
const config = require('../config/config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  // Connection pool settings
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error connecting to PostgreSQL database:', err.message);
  } else {
    console.log('✅ PostgreSQL database connected successfully');
    release();
  }
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
