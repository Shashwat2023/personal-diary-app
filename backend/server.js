require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

app.use(
  morgan(
    process.env.NODE_ENV === 'production'
      ? 'combined'
      : 'dev'
  )
);

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, '../frontend/login.html')
  );
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      success: true,
      message: 'API running',
      database: 'connected'
    });
  } catch (err) {
    console.error('Database health check failed:', err.message);

    res.status(503).json({
      success: false,
      message: 'Database unavailable'
    });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token'
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET,
    (err, user) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: 'Invalid token'
        });
      }

      req.user = user;
      next();
    }
  );
};

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email and password are required'
      });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Register error:', err);

    res.status(500).json({
      success: false,
      message: err.message,
      code: err.code
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
      }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.post('/api/entries', authenticateToken, async (req, res) => {
  try {
    const { title, content, mood, tags } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    const result = await pool.query(
      `INSERT INTO entries
       (user_id, title, content, mood, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.user.id,
        title || null,
        content,
        mood || null,
        tags || null
      ]
    );

    res.status(201).json({
      success: true,
      entry: result.rows[0]
    });
  } catch (err) {
    console.error('Create entry error:', err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/entries', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM entries
       WHERE user_id = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      entries: result.rows
    });
  } catch (err) {
    console.error('Get entries error:', err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.put('/api/entries/:id', authenticateToken, async (req, res) => {
  try {
    const { title, content, mood, tags } = req.body;

    const result = await pool.query(
      `UPDATE entries
       SET title = $1,
           content = $2,
           mood = $3,
           tags = $4
       WHERE id = $5
       AND user_id = $6
       AND deleted_at IS NULL
       RETURNING *`,
      [
        title || null,
        content,
        mood || null,
        tags || null,
        req.params.id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found'
      });
    }

    res.json({
      success: true,
      entry: result.rows[0]
    });
  } catch (err) {
    console.error('Update entry error:', err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.delete('/api/entries/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE entries
       SET deleted_at = NOW()
       WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Entry deleted'
    });
  } catch (err) {
    console.error('Delete entry error:', err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
