require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const config = require('./config/config');
const authRoutes = require('./routes/authRoutes');
const diaryRoutes = require('./routes/diaryRoutes');

const app = express();

app.use(cors({
  origin: config.cors.origin,
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/entries', diaryRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

app.listen(config.port, () => {
  console.log(`\n🚀 Server running on http://localhost:${config.port}`);
});