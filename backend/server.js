require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 5000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ─── Mailer (used to verify entered emails are real, deliverable addresses) ───
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function sendVerificationEmail(email, username, rawToken) {
  const link = `${APP_URL}/api/auth/verify?token=${rawToken}`;
  if (!mailer) {
    // No SMTP configured — log the link so registration still works in dev.
    console.warn(`[mailer] SMTP not configured. Verification link for ${email}: ${link}`);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Verify your Personal Diary account',
    html: `<p>Hi ${username},</p><p>Confirm this is your email address to activate your account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours. If you didn't request this, ignore this email.</p>`
  });
}

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

    const rawToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const result = await pool.query(
      `INSERT INTO users (username, email, password, is_verified, verification_token, verification_expires)
       VALUES ($1, $2, $3, FALSE, $4, $5)
       RETURNING id, username, email, created_at`,
      [username, email, hashedPassword, hashToken(rawToken), verificationExpires]
    );

    try {
      await sendVerificationEmail(email, username, rawToken);
    } catch (mailErr) {
      console.error('Verification email failed to send:', mailErr.message);
      // Roll back so the user can retry registration cleanly.
      await pool.query('DELETE FROM users WHERE id = $1', [result.rows[0].id]);
      return res.status(502).json({
        success: false,
        message: 'Could not send verification email. Check the address and try again.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Account created. Check your email to verify your address before logging in.',
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

// GET /api/auth/verify?token=...
app.get('/api/auth/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect(`${APP_URL}/login.html?verify=missing`);

  try {
    const result = await pool.query(
      `UPDATE users
       SET is_verified = TRUE, verification_token = NULL, verification_expires = NULL
       WHERE verification_token = $1 AND verification_expires > NOW()
       RETURNING id`,
      [hashToken(token)]
    );

    if (result.rows.length === 0) {
      return res.redirect(`${APP_URL}/login.html?verify=invalid`);
    }
    return res.redirect(`${APP_URL}/login.html?verify=success`);
  } catch (err) {
    console.error('Verify error:', err.message);
    return res.redirect(`${APP_URL}/login.html?verify=error`);
  }
});

// POST /api/auth/resend-verification
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const result = await pool.query(
      'SELECT id, username, email, is_verified FROM users WHERE email = $1',
      [email]
    );

    // Same response whether or not the account exists — avoids leaking which emails are registered.
    const generic = { success: true, message: 'If that account needs verifying, a new email is on its way.' };
    if (result.rows.length === 0) return res.json(generic);

    const user = result.rows[0];
    if (user.is_verified) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3',
      [hashToken(rawToken), verificationExpires, user.id]
    );

    await sendVerificationEmail(user.email, user.username, rawToken);
    res.json(generic);
  } catch (err) {
    console.error('Resend verification error:', err.message);
    res.status(500).json({ success: false, message: 'Could not resend verification email.' });
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

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Check your inbox for the verification link.'
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
    const { title, content, mood, tags, category } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
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