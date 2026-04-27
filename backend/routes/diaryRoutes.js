const express = require('express');
const router = express.Router();
const { getEntries, createEntry, updateEntry, deleteEntry } = require('../controllers/diaryController');
const { protect } = require('../middleware/authMiddleware');

// All routes below require a valid JWT token
router.use(protect);

// GET  /api/entries       → fetch all entries (with optional ?search= and ?date=)
router.get('/', getEntries);

// POST /api/entries       → create a new entry
router.post('/', createEntry);

// PUT  /api/entries/:id   → update an entry by ID
router.put('/:id', updateEntry);

// DELETE /api/entries/:id → soft-delete an entry by ID
router.delete('/:id', deleteEntry);

module.exports = router;
