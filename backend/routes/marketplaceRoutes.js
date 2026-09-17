/* =============================================
   FOLIO — MARKETPLACE ROUTES
   ============================================= */

const express = require('express');
const rateLimit = require('express-rate-limit');

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many purchase attempts. Please try again shortly.' }
});

function createMarketplaceRoutes({ controller, authenticateToken }) {
  const router = express.Router();

  router.use(authenticateToken);

  // Static paths MUST precede '/:id', otherwise Express reads
  // "owned" / "preferences" as an item id and the UUID lookup fails.
  router.get('/',            controller.listItems);
  router.get('/owned',       controller.listOwned);
  router.get('/preferences', controller.getPreferences);
  router.post('/activate',   controller.activateItem);

  router.get('/:id',          controller.getItem);
  router.get('/:id/access',   controller.checkAccess);
  router.post('/:id/checkout', paymentLimiter, controller.createCheckout);
  router.post('/:id/verify',   paymentLimiter, controller.verifyPurchase);

  return router;
}

module.exports = { createMarketplaceRoutes };
