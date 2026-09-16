/* =============================================
   FOLIO — COUPON ROUTES
   ============================================= */

const express = require('express');
const rateLimit = require('express-rate-limit');

// Coupon guessing is the one thing worth throttling hard here — a tight
// limit makes brute-forcing codes impractical.
const couponLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again shortly.' }
});

function createCouponRoutes({ controller, authenticateToken }) {
  const router = express.Router();
  router.post('/validate', authenticateToken, couponLimiter, controller.validate);
  return router;
}

module.exports = { createCouponRoutes };
