require('express-async-errors');
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const cron      = require('node-cron');
const admin     = require('firebase-admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Firebase Admin init ──────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

// ── Security middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Payment rate limiter (stricter) ─────────────────────────────
const paymentLimiter = rateLimit({ windowMs: 60000, max: 10 }); // 10 payments/min

// ── Health check ────────────────────────────────────────────────
app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'paykaro-backend', version: '1.0.0', uptime: process.uptime() }));

// ── Routes ───────────────────────────────────────────────────────
app.use('/v1/auth',     require('./routes/auth'));
app.use('/v1/payment',  paymentLimiter, require('./routes/payment'));
app.use('/v1/split',    require('./routes/split'));
app.use('/v1/insights', require('./routes/insights'));
app.use('/v1/carbon',   require('./routes/carbon'));

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`, err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ── Cron Jobs ────────────────────────────────────────────────────
// Run monthly spending analysis on the 1st of each month
cron.schedule('0 0 1 * *', async () => {
  console.log('[CRON] Running monthly spending analysis...');
  // const { runMonthlyAnalysis } = require('./services/analyticsService');
  // await runMonthlyAnalysis();
});

// Recalculate carbon scores daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Recalculating carbon scores...');
  // const { runCarbonRecalculation } = require('./services/carbonService');
  // await runCarbonRecalculation();
});

app.listen(PORT, () =>
  console.log(`🚀 Pay Karo Backend running on port ${PORT} (${process.env.NODE_ENV})`));

module.exports = app;
