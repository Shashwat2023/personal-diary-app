/* =============================================
   FOLIO — MARKETPLACE CONTROLLER
   Ownership is permanent; plan entitlement is not.
   Access decisions always happen server-side.
   ============================================= */

const razorpay = require('../services/razorpayService');

function createMarketplaceController(pool, entitlements, coupons) {

  // ─── GET /api/marketplace ───────────────────
  // Returns every active item annotated with this user's access state, so
  // the frontend can render Buy / Owned / Included without a second call.
  async function listItems(req, res) {
    try {
      const { type } = req.query;

      const params = [req.user.id];
      let typeFilter = '';
      if (type) {
        params.push(type);
        typeFilter = ` AND i.type = $${params.length}`;
      }

      const { rows } = await pool.query(
        `SELECT i.id, i.name, i.slug, i.description, i.type, i.price, i.currency,
                i.preview_image, i.preview_data, i.required_plan, i.is_free,
                (p.id IS NOT NULL) AS owned,
                p.purchased_at
         FROM marketplace_items i
         LEFT JOIN marketplace_purchases p
           ON p.item_id = i.id AND p.user_id = $1 AND p.status = 'completed'
         WHERE i.is_active = TRUE${typeFilter}
         ORDER BY i.type, i.price, i.name`,
        params
      );

      const sub = await entitlements.getUserPlan(req.user.id);

      const items = rows.map(item => {
        const includedInPlan = !!item.required_plan
          && entitlements.planAtLeast(sub.plan, item.required_plan);
        const free = item.is_free || Number(item.price) === 0;

        return {
          ...item,
          price: Number(item.price),
          access: item.owned || free || includedInPlan,
          access_reason: item.owned ? 'owned'
            : free ? 'free'
            : includedInPlan ? 'plan_included'
            : 'locked'
        };
      });

      res.json({ success: true, data: { items, current_plan: sub.plan } });
    } catch (err) {
      console.error('listItems error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load the marketplace.' });
    }
  }

  // ─── GET /api/marketplace/owned ─────────────
  // Declared before /:id in the router so "owned" isn't read as an id.
  async function listOwned(req, res) {
    try {
      const items = await entitlements.getOwnedItems(req.user.id);
      res.json({
        success: true,
        data: { items: items.map(i => ({ ...i, price: Number(i.price) })) }
      });
    } catch (err) {
      console.error('listOwned error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load your collection.' });
    }
  }

  // ─── GET /api/marketplace/:id ───────────────
  async function getItem(req, res) {
    try {
      const result = await entitlements.canAccessItem(req.user.id, req.params.id);
      if (result.reason === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Item not found.' });
      }

      // item_data is the payload that actually applies the theme/font — only
      // send it to users who are entitled to it.
      const { rows } = await pool.query(
        `SELECT id, name, slug, description, type, price, currency, preview_image,
                preview_data, required_plan, is_free, is_active,
                CASE WHEN $2 THEN item_data ELSE NULL END AS item_data
         FROM marketplace_items WHERE id = $1`,
        [req.params.id, result.access]
      );

      res.json({
        success: true,
        data: {
          item: { ...rows[0], price: Number(rows[0].price) },
          access: result.access,
          access_reason: result.reason.toLowerCase()
        }
      });
    } catch (err) {
      console.error('getItem error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load this item.' });
    }
  }

  // ─── GET /api/marketplace/:id/access ────────
  async function checkAccess(req, res) {
    try {
      const result = await entitlements.canAccessItem(req.user.id, req.params.id);
      if (result.reason === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Item not found.' });
      }
      res.json({
        success: true,
        data: { access: result.access, reason: result.reason.toLowerCase() }
      });
    } catch (err) {
      console.error('checkAccess error:', err.message);
      res.status(500).json({ success: false, message: 'Could not check access.' });
    }
  }

  // ─── POST /api/marketplace/:id/checkout ─────
  async function createCheckout(req, res) {
    const { coupon_code: couponCode } = req.body || {};

    try {
      const { rows } = await pool.query(
        `SELECT id, name, slug, price, is_free, is_active FROM marketplace_items WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found.' });
      }

      const item = rows[0];
      if (!item.is_active) {
        return res.status(410).json({ success: false, message: 'This item is no longer available.' });
      }

      // Already owned → nothing to pay for.
      const { rows: owned } = await pool.query(
        `SELECT id FROM marketplace_purchases
         WHERE user_id = $1 AND item_id = $2 AND status = 'completed'`,
        [req.user.id, item.id]
      );
      if (owned.length > 0) {
        return res.status(409).json({ success: false, message: 'You already own this item.' });
      }

      // Free items are claimed directly, no Razorpay round-trip.
      if (item.is_free || Number(item.price) === 0) {
        await pool.query(
          `INSERT INTO marketplace_purchases (user_id, item_id, amount, currency, status)
           VALUES ($1, $2, 0, 'INR', 'completed')
           ON CONFLICT DO NOTHING`,
          [req.user.id, item.id]
        );
        return res.json({ success: true, data: { free: true, owned: true } });
      }

      if (!razorpay.isConfigured()) {
        return res.status(503).json({ success: false, message: 'Payments are not configured.' });
      }

      // Base price is the DB column we just queried — never anything the
      // client sent. A coupon can only ever discount THIS value.
      const baseAmount = Number(item.price);

      let finalAmount = baseAmount;
      let couponId = null;
      let discountAmount = 0;

      if (couponCode) {
        const result = await coupons.validateCoupon({
          code: couponCode, userId: req.user.id, type: 'marketplace',
          itemId: item.id, baseAmount
        });
        if (!result.valid) {
          return res.status(400).json({ success: false, message: result.message, code: 'INVALID_COUPON' });
        }
        finalAmount = result.final_amount;
        discountAmount = result.discount_amount;
        couponId = result.coupon.id;
      }

      const order = await razorpay.createOrder({
        amount: finalAmount,
        receipt: `mkt_${Date.now()}`,
        notes: { kind: 'marketplace', user_id: req.user.id, item_id: item.id, slug: item.slug }
      });

      await pool.query(
        `INSERT INTO marketplace_purchases
           (user_id, item_id, razorpay_order_id, amount, currency, status, coupon_id, discount_amount)
         VALUES ($1, $2, $3, $4, 'INR', 'pending', $5, $6)`,
        [req.user.id, item.id, order.id, finalAmount, couponId, discountAmount]
      );

      res.json({
        success: true,
        data: {
          key_id: razorpay.KEY_ID,
          order_id: order.id,
          amount: finalAmount,
          base_amount: baseAmount,
          discount_amount: discountAmount,
          currency: 'INR',
          item: { id: item.id, name: item.name }
        }
      });
    } catch (err) {
      console.error('marketplace createCheckout error:', err.message);
      const status = err.code === 'RAZORPAY_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({
        success: false,
        message: status === 503 ? 'Payments are not configured.' : 'Could not start checkout.'
      });
    }
  }

  // ─── POST /api/marketplace/:id/verify ───────
  async function verifyPurchase(req, res) {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    } = req.body || {};

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details.' });
    }

    if (!razorpay.verifyPaymentSignature({ orderId, paymentId, signature })) {
      await pool.query(
        `UPDATE marketplace_purchases SET status = 'failed'
         WHERE razorpay_order_id = $1 AND user_id = $2 AND status = 'pending'`,
        [orderId, req.user.id]
      ).catch(() => {});
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, item_id, status, coupon_id, discount_amount FROM marketplace_purchases
         WHERE razorpay_order_id = $1 AND user_id = $2
         FOR UPDATE`,
        [orderId, req.user.id]
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const purchase = rows[0];

      // Idempotent — replaying verification returns the same success.
      if (purchase.status === 'completed') {
        await client.query('COMMIT');
        return res.json({ success: true, data: { already_processed: true, owned: true } });
      }

      await client.query(
        `UPDATE marketplace_purchases
         SET status = 'completed', razorpay_payment_id = $1, purchased_at = NOW()
         WHERE id = $2`,
        [paymentId, purchase.id]
      );

      if (purchase.coupon_id) {
        await coupons.redeemCoupon(client, {
          couponId: purchase.coupon_id,
          userId: req.user.id,
          orderId,
          discountAmount: purchase.discount_amount
        });
      }

      await client.query('COMMIT');

      res.json({ success: true, data: { owned: true, item_id: purchase.item_id } });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('verifyPurchase error:', err.message);
      res.status(500).json({ success: false, message: 'Could not verify your purchase.' });
    } finally {
      client.release();
    }
  }

  // ─── POST /api/marketplace/activate ─────────
  // Sets the user's active theme/font. Entitlement is re-checked here so a
  // crafted request can't activate something the user doesn't have.
  async function activateItem(req, res) {
    const { item_id: itemId } = req.body || {};
    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Missing item.' });
    }

    try {
      const result = await entitlements.canAccessItem(req.user.id, itemId);
      if (result.reason === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Item not found.' });
      }
      if (!result.access) {
        return res.status(403).json({
          success: false,
          message: 'You don\'t have access to this item yet.',
          reason: result.reason.toLowerCase()
        });
      }

      const item = result.item;
      const column = item.type === 'font' ? 'active_font' : 'active_theme';

      await pool.query(
        `INSERT INTO user_preferences (user_id, ${column}, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET ${column} = $2, updated_at = NOW()`,
        [req.user.id, item.slug]
      );

      res.json({ success: true, data: { active: item.slug, type: item.type } });
    } catch (err) {
      console.error('activateItem error:', err.message);
      res.status(500).json({ success: false, message: 'Could not activate this item.' });
    }
  }

  // ─── GET /api/marketplace/preferences ───────
  // Returns the active theme/font with their item_data, re-validating access
  // so a lapsed plan stops applying a theme it no longer includes.
  async function getPreferences(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT active_theme, active_font FROM user_preferences WHERE user_id = $1`,
        [req.user.id]
      );
      const prefs = rows[0] || { active_theme: null, active_font: null };

      const theme = await resolveActive(req.user.id, prefs.active_theme);
      const font  = await resolveActive(req.user.id, prefs.active_font);

      res.json({ success: true, data: { theme, font } });
    } catch (err) {
      console.error('getPreferences error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load your preferences.' });
    }
  }

  async function resolveActive(userId, slug) {
    if (!slug) return null;
    const { rows } = await pool.query(
      `SELECT id, name, slug, type, item_data FROM marketplace_items
       WHERE slug = $1 AND is_active = TRUE`,
      [slug]
    );
    if (rows.length === 0) return null;

    const check = await entitlements.canAccessItem(userId, rows[0].id);
    if (!check.access) return null;   // entitlement lapsed → silently fall back

    return rows[0];
  }

  return {
    listItems,
    listOwned,
    getItem,
    checkAccess,
    createCheckout,
    verifyPurchase,
    activateItem,
    getPreferences
  };
}

module.exports = { createMarketplaceController };
