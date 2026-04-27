const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../models/db');
const config = require('../config/config');

/**
 * Sanitize string input — strip dangerous characters
 */
const sanitize = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/<[^>]*>/g, '');
};

/**
 * POST /api/auth/register
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    let { username, email, password } = req.body;

    // --- Input Validation ---
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password are required.',
      });
    }

    username = sanitize(username);
    email = sanitize(email).toLowerCase();

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format.',
      });
    }

    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    // Username length validation
    if (username.length < 2 || username.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Username must be between 2 and 50 characters.',
      });
    }

    // --- Check if email already exists (parameterized query) ---
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // --- Hash password ---
    const hashedPassword = await bcrypt.hash(password, config.bcryptSaltRounds);

    // --- Insert user into database ---
    const result = await query(
      `INSERT INTO users (username, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, hashedPassword]
    );

    const newUser = result.rows[0];

    // --- Generate JWT ---
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, username: newUser.username },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        created_at: newUser.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Authenticate user and return JWT
 */
const login = async (req, res, next) => {
  try {
    let { email, password } = req.body;

    // --- Input Validation ---
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    email = sanitize(email).toLowerCase();

    // --- Find user by email (parameterized query) ---
    const result = await query(
      'SELECT id, username, email, password, created_at FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const user = result.rows[0];

    // --- Verify password ---
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // --- Generate JWT ---
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login };
