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

// `verify` stashes the raw bytes before parsing — Razorpay webhook signatures
// are computed over the exact raw body, which JSON.parse would destroy.
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
}));

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

const { createEntitlementService }      = require('./services/entitlementService');
const { createCouponService }           = require('./services/couponService');
const { createPlanMiddleware }          = require('./middleware/planMiddleware');
const { createSubscriptionController }  = require('./controllers/subscriptionController');
const { createMarketplaceController }   = require('./controllers/marketplaceController');
const { createCouponController }        = require('./controllers/couponController');
const { createSubscriptionRoutes }      = require('./routes/subscriptionRoutes');
const { createMarketplaceRoutes }       = require('./routes/marketplaceRoutes');
const { createCouponRoutes }            = require('./routes/couponRoutes');

const entitlements   = createEntitlementService(pool);
const coupons        = createCouponService(pool);
const planMiddleware = createPlanMiddleware(entitlements);


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

    // Plan limits are enforced here, server-side — the frontend is never the
    // only thing standing between a Journal user and unlimited writing.
    const limitCheck = await entitlements.canCreateEntry(req.user.id, content);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        code: limitCheck.code,
        upgrade_to: 'chronicle'
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

    const validationError = validateEntryFields(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // Character cap applies to edits too; editing never consumes a daily entry.
    const limitCheck = await entitlements.canEditEntry(req.user.id, content);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        code: limitCheck.code,
        upgrade_to: 'chronicle'
      });
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
// ─── Locked entries ─────────────────────────────
// Content is encrypted in the browser before it ever reaches us: the server
// stores ciphertext plus the salt/IV and can never read a locked entry.
app.post('/api/entries/:id/lock', authenticateToken, async (req, res) => {
  try {
    const { content, lock_salt: lockSalt, lock_iv: lockIv } = req.body || {};

    if (!content || !lockSalt || !lockIv) {
      return res.status(400).json({
        success: false,
        message: 'Encrypted content, salt and IV are all required.'
      });
    }

    const lockCheck = await entitlements.canLockEntry(req.user.id, req.params.id);
    if (!lockCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: lockCheck.message,
        code: lockCheck.code,
        upgrade_to: lockCheck.code === 'LOCKED_ENTRIES_LIMIT' ? 'heirloom' : 'chronicle'
      });
    }

    const result = await pool.query(
      `UPDATE entries
       SET content = $1, is_locked = TRUE, lock_salt = $2, lock_iv = $3
       WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL
       RETURNING id, is_locked`,
      [content, lockSalt, lockIv, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    res.json({ success: true, data: { entry: result.rows[0] } });
  } catch (err) {
    console.error('Lock entry error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Unlocking happens client-side after successful decryption; this just stores
// the plaintext back and clears the lock metadata.
app.post('/api/entries/:id/unlock', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ success: false, message: 'Decrypted content is required.' });
    }

    const result = await pool.query(
      `UPDATE entries
       SET content = $1, is_locked = FALSE, lock_salt = NULL, lock_iv = NULL
       WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
       RETURNING id, is_locked`,
      [content, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    res.json({ success: true, data: { entry: result.rows[0] } });
  } catch (err) {
    console.error('Unlock entry error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

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

    // Basic stats stay available on every plan (existing response shape is
    // preserved so the current dashboard keeps working unchanged).
    const payload = {
      success: true,
      totalEntries: rows.length,
      moodCounts,
      tagCounts,
      streak
    };

    // Advanced stats are additive and only attached for Chronicle+.
    const sub = await entitlements.getUserPlan(req.user.id);
    const features = entitlements.featuresForPlan(sub.plan);
    payload.plan = sub.plan;
    payload.advanced_available = !!features.advanced_statistics;

    if (features.advanced_statistics) {
      const byMonth = {};
      const byWeekday = [0, 0, 0, 0, 0, 0, 0];
      const categoryCounts = {};
      let longestStreak = 0;
      let run = 0;

      rows.forEach(r => {
        const d = new Date(r.created_at);
        const monthKey = d.toISOString().slice(0, 7);
        byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
        byWeekday[d.getDay()]++;
        if (r.category) categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
      });

      // Longest run of consecutive days, walking the sorted day set backwards.
      const sortedDays = [...days].sort();
      let prev = null;
      sortedDays.forEach(day => {
        if (prev) {
          const diff = (new Date(day) - new Date(prev)) / 86400000;
          run = diff === 1 ? run + 1 : 1;
        } else {
          run = 1;
        }
        longestStreak = Math.max(longestStreak, run);
        prev = day;
      });

      payload.advanced = {
        byMonth,
        byWeekday,
        categoryCounts,
        longestStreak,
        daysWritten: days.size,
        firstEntry: rows.length ? rows[rows.length - 1].created_at : null
      };
    }

    res.json(payload);
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Subscriptions & Marketplace ────────────────
// Plans: 'journal' (free, default) → 'chronicle' → 'heirloom'.
// All entitlement decisions live in entitlementService — never in the frontend.

app.use('/api/subscription', createSubscriptionRoutes({
  controller: createSubscriptionController(pool, entitlements, coupons),
  authenticateToken
}));

app.use('/api/marketplace', createMarketplaceRoutes({
  controller: createMarketplaceController(pool, entitlements, coupons),
  authenticateToken
}));

app.use('/api/coupons', createCouponRoutes({
  controller: createCouponController(pool, coupons),
  authenticateToken
}));

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