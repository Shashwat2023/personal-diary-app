require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 5000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Account creation, Google sign-in, and email verification are all handled
// by Supabase Auth on the frontend — no custom mailer needed here anymore.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// CSP off for now — the frontend relies on inline <script> blocks and several
// CDNs/Google/Supabase origins; a default CSP would break it. Helmet's other
// headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS locked to known frontend origins (was: reflecting ANY origin with
// credentials on, since CORS_ORIGIN was never actually set in Vercel).
const ALLOWED_ORIGINS = [
  process.env.APP_URL,
  'https://personaldiary-beta.vercel.app',
  'http://localhost:5000'
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Basic abuse/DoS protection — no limiter existed on any route before.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
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

// Verifies the Supabase-issued JWT (Google sign-in). Supabase now signs
// tokens with ES256 using rotating keys, published at this JWKS endpoint —
// no static secret needed/possible.
const SUPABASE_URL = 'https://ctggukqyxdcjqfwectpz.supabase.co';
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token'
    });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated'
    });
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    console.error('Token verify failed:', err.message);
    return res.status(403).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Account creation/login is handled entirely by Supabase Auth (Google
// sign-in) on the frontend now — no custom register/login/verify endpoints.

// The mood buttons in the UI only ever send one of these — but the API never
// enforced that, so anyone calling it directly could store arbitrary strings.
const VALID_MOODS = ['happy', 'calm', 'reflective', 'anxious', 'sad', 'grateful'];

function validateEntryFields({ title, content, mood, tags, category }) {
  if (title != null && (typeof title !== 'string' || title.length > 200)) {
    return 'Title must be 200 characters or fewer';
  }
  if (content != null && (typeof content !== 'string' || content.length > 50000)) {
    return 'Content must be 50,000 characters or fewer';
  }
  if (mood != null && !VALID_MOODS.includes(mood)) {
    return `Mood must be one of: ${VALID_MOODS.join(', ')}`;
  }
  if (category != null && (typeof category !== 'string' || category.length > 50)) {
    return 'Category must be 50 characters or fewer';
  }
  if (tags != null) {
    if (!Array.isArray(tags) || tags.length > 20 || tags.some(t => typeof t !== 'string' || t.length > 30)) {
      return 'Tags must be an array of up to 20 strings, each 30 characters or fewer';
    }
  }
  return null;
}

app.post('/api/entries', authenticateToken, async (req, res) => {
  try {
    const { title, content, mood, tags, category } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    const validationError = validateEntryFields(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const result = await pool.query(
      `INSERT INTO entries
       (user_id, title, content, mood, tags, category)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.id,
        title || null,
        content,
        mood || null,
        tags || null,
        category || null
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
    const { title, content, mood, tags, category, is_favorite, is_pinned } = req.body;

    const validationError = validateEntryFields(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const result = await pool.query(
      `UPDATE entries
       SET title = $1,
           content = $2,
           mood = $3,
           tags = $4,
           category = $5,
           is_favorite = COALESCE($6, is_favorite),
           is_pinned = COALESCE($7, is_pinned)
       WHERE id = $8
       AND user_id = $9
       AND deleted_at IS NULL
       RETURNING *`,
      [
        title || null,
        content,
        mood || null,
        tags || null,
        category || null,
        typeof is_favorite === 'boolean' ? is_favorite : null,
        typeof is_pinned === 'boolean' ? is_pinned : null,
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

// ─── Trash (soft-deleted entries) ─────────────
app.get('/api/entries/trash', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM entries
       WHERE user_id = $1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, entries: result.rows });
  } catch (err) {
    console.error('Get trash error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/entries/:id/restore', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE entries SET deleted_at = NULL
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    res.json({ success: true, entry: result.rows[0] });
  } catch (err) {
    console.error('Restore entry error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/entries/:id/permanent', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    res.json({ success: true, message: 'Entry permanently deleted' });
  } catch (err) {
    console.error('Permanent delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Stats (mood/tag counts, streaks) ─────────
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mood, tags, category, created_at
       FROM entries WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    const rows = result.rows;
    const moodCounts = {};
    const tagCounts = {};
    rows.forEach(r => {
      if (r.mood) moodCounts[r.mood] = (moodCounts[r.mood] || 0) + 1;
      (r.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });

    // Daily writing streak: consecutive days (including today/yesterday) with an entry
    const days = new Set(rows.map(r => new Date(r.created_at).toISOString().slice(0, 10)));
    let streak = 0;
    let cursor = new Date();
    if (!days.has(cursor.toISOString().slice(0, 10))) {
      cursor.setDate(cursor.getDate() - 1); // allow "today not yet written" without breaking streak
    }
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    res.json({
      success: true,
      totalEntries: rows.length,
      moodCounts,
      tagCounts,
      streak
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
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