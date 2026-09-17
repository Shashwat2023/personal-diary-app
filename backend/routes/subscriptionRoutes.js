/* =============================================
   FOLIO — SUBSCRIPTION ROUTES
   ============================================= */

const express = require('express');
const rateLimit = require('express-rate-limit');

// Payment endpoints get a tighter limit than ordinary diary usage.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment attempts. Please try again shortly.' }
});

function createSubscriptionRoutes({ controller, authenticateToken }) {
  const router = express.Router();

  // Webhook first and unauthenticated — Razorpay calls it directly and
  // authenticates via signature, not a user token.
  router.post('/webhook', controller.handleWebhook);

  router.get('/',          authenticateToken, controller.getSubscription);
  router.get('/payments',  authenticateToken, controller.getPaymentHistory);

  router.post('/checkout', authenticateToken, paymentLimiter, controller.createCheckout);
  router.post('/verify',   authenticateToken, paymentLimiter, controller.verifyPayment);
  router.post('/cancel',   authenticateToken, controller.cancelSubscription);

  return router;
}

module.exports = { createSubscriptionRoutes };
