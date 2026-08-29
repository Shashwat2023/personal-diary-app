const { query } = require('../models/db');

/**
 * Sanitize string input — strip dangerous characters
 */
const sanitize = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/<script[^>]*>.*?<\/script>/gi, '').replace(/<[^>]*>/g, '');
};

/**
 * GET /api/entries
 * Get all diary entries for the authenticated user
 * Supports optional ?search= and ?date= query params
 */
const getEntries = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { search, date } = req.query;

    let queryText = `
      SELECT id, user_id, title, content, mood, tags, created_at, updated_at
      FROM entries
      WHERE user_id = $1
    `;
    const params = [userId];

    // Optional keyword search (parameterized)
    if (search) {
      params.push(`%${sanitize(search)}%`);
      queryText += ` AND (content ILIKE $${params.length} OR title ILIKE $${params.length})`;
    }

    // Optional date filter (YYYY-MM-DD)
    if (date) {
      params.push(sanitize(date));
      queryText += ` AND DATE(created_at) = $${params.length}`;
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await query(queryText, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      entries: result.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/entries
 * Create a new diary entry
 */
const createEntry = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let { content, title, mood, tags } = req.body;

    // --- Input Validation ---
    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required.',
      });
    }

    content = sanitize(content);
    title = title ? sanitize(title) : null;
    mood = mood ? sanitize(mood) : null;

    if (content.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Content cannot be empty.',
      });
    }

    if (content.length > 50000) {
      return res.status(400).json({
        success: false,
        message: 'Content exceeds maximum length of 50,000 characters.',
      });
    }

    // Validate and sanitize tags (array of strings)
    let sanitizedTags = null;
    if (tags && Array.isArray(tags)) {
      sanitizedTags = tags.map((t) => sanitize(String(t))).filter((t) => t.length > 0);
    }

    // --- Insert entry ---
    const result = await query(
      `INSERT INTO entries (user_id, title, content, mood, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, title, content, mood, tags, created_at, updated_at`,
      [userId, title, content, mood, sanitizedTags]
    );

    return res.status(201).json({
      success: true,
      message: 'Entry created successfully.',
      entry: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/entries/:id
 * Update an existing diary entry
 */
const updateEntry = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const entryId = req.params.id;
    let { content, title, mood, tags } = req.body;

    // --- Input Validation ---
    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required.',
      });
    }

    content = sanitize(content);
    title = title ? sanitize(title) : null;
    mood = mood ? sanitize(mood) : null;

    if (content.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Content cannot be empty.',
      });
    }

    // Validate tags
    let sanitizedTags = null;
    if (tags && Array.isArray(tags)) {
      sanitizedTags = tags.map((t) => sanitize(String(t))).filter((t) => t.length > 0);
    }

    // --- Check entry exists and belongs to user (parameterized) ---
    const existing = await query(
      'SELECT id FROM entries WHERE id = $1 AND user_id = $2',
      [entryId, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found.',
      });
    }

    // --- Update entry ---
    const result = await query(
      `UPDATE entries
       SET title = $1, content = $2, mood = $3, tags = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id, title, content, mood, tags, created_at, updated_at`,
      [title, content, mood, sanitizedTags, entryId, userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Entry updated successfully.',
      entry: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/entries/:id
 * Soft-delete a diary entry (sets deleted_at timestamp)
 */
const deleteEntry = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const entryId = req.params.id;

    // --- Check entry exists and belongs to user ---
    const existing = await query(
      'SELECT id FROM entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [entryId, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found.',
      });
    }

    // --- Soft delete ---
    await query(
      'UPDATE entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
      [entryId, userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Entry deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getEntries, createEntry, updateEntry, deleteEntry };
