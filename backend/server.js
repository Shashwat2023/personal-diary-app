require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'personal_diary',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

// Test DB connection
pool.connect()
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(err => console.error('❌ DB Error:', err.message));

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json());
app.use(morgan('dev'));

// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

const path = require('path');

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});





// Health
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API running' });
});

// ───────── REGISTER ─────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      user: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── LOGIN ─────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM users WHERE email=$1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Wrong password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── CREATE ENTRY ─────────
app.post('/api/entries', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;

    const result = await pool.query(
      `INSERT INTO entries (user_id, content, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING *`,
      [req.user.id, content]
    );

    res.status(201).json({ success: true, entry: result.rows[0] });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── GET ALL ENTRIES ─────────
app.get('/api/entries', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM entries
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, entries: result.rows });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── UPDATE ENTRY ─────────
app.put('/api/entries/:id', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;

    const result = await pool.query(
      `UPDATE entries
       SET content=$1, updated_at=NOW()
       WHERE id=$2 AND user_id=$3
       RETURNING *`,
      [content, req.params.id, req.user.id]
    );

    res.json({ success: true, entry: result.rows[0] });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── DELETE ENTRY ─────────
app.delete('/api/entries/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM entries
       WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );

    res.json({ success: true, message: 'Deleted' });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───────── 404 ─────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// ───────── ERROR HANDLER ─────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n🚀 Server running on http://localhost:' + PORT);
});