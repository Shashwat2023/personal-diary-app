/* =============================================
   FOLIO — COUPON SERVICE
   The security property this whole file exists for:
   a coupon's discount is ALWAYS looked up from the
   database by its code. The amount being discounted
   is ALWAYS the server's own trusted base price
   (PLAN_PRICING or marketplace_items.price). Nothing
   the client sends is ever treated as a price or a
   discount — only as a lookup key (the coupon code).
   ============================================= */

// Minimum a Razorpay order can be for — also our floor so a coupon can
// never discount something all the way to ₹0.
// A coupon can legitimately bring the price to ₹0 (e.g. a 100%-off test
// or promo code) — floor is 0, not ₹1. When that happens, checkout skips
// Razorpay entirely rather than trying to create a ₹0 order (which
// Razorpay itself won't accept anyway).

function createCouponService(pool) {

  // ─── Validate (no side effects) ─────────────
  // baseAmount is paise, and MUST come from the caller's own trusted
  // source (getPlanAmount() or a freshly-queried item.price) — never from
  // anything the client sent.
  async function validateCoupon({ code, userId, type, planRestriction, itemId, baseAmount }) {
    if (!code || typeof code !== 'string') {
      return { valid: false, message: 'Enter a coupon code.' };
    }

    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)`,
      [code.trim()]
    );
    if (rows.length === 0) {
      return { valid: false, message: 'That code isn\'t valid.' };
    }

    const coupon = rows[0];

    if (!coupon.is_active) {
      return { valid: false, message: 'That code is no longer active.' };
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { valid: false, message: 'That code has expired.' };
    }
    if (coupon.applies_to !== 'all' && coupon.applies_to !== type) {
      return { valid: false, message: `That code doesn't apply to ${type === 'subscription' ? 'plans' : 'marketplace items'}.` };
    }
    if (coupon.plan_restriction && coupon.plan_restriction !== planRestriction) {
      return { valid: false, message: `That code only applies to ${coupon.plan_restriction}.` };
    }
    if (coupon.item_restriction && coupon.item_restriction !== itemId) {
      return { valid: false, message: 'That code doesn\'t apply to this item.' };
    }
    if (coupon.min_amount && baseAmount < coupon.min_amount) {
      return { valid: false, message: `That code needs a minimum order of ₹${coupon.min_amount / 100}.` };
    }
    if (coupon.max_redemptions != null && coupon.redemptions_count >= coupon.max_redemptions) {
      return { valid: false, message: 'That code has been fully redeemed.' };
    }

    // Per-user limit — counted from actual redemptions, not attempts.
    const { rows: userRedemptions } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
      [coupon.id, userId]
    );
    if (userRedemptions[0].count >= coupon.max_redemptions_per_user) {
      return { valid: false, message: 'You\'ve already used this code.' };
    }

    const discountAmount = computeDiscount(coupon, baseAmount);
    const finalAmount = Math.max(0, baseAmount - discountAmount);
    // Recompute the *actual* discount applied, in case the floor clamped it.
    const appliedDiscount = baseAmount - finalAmount;

    return {
      valid: true,
      coupon,
      base_amount: baseAmount,
      discount_amount: appliedDiscount,
      final_amount: finalAmount
    };
  }

  function computeDiscount(coupon, baseAmount) {
    if (coupon.discount_type === 'percent') {
      return Math.round(baseAmount * (coupon.discount_value / 100));
    }
    return Math.min(coupon.discount_value, baseAmount); // fixed, paise
  }

  // ─── Redeem (call inside the SAME transaction as marking a payment
  // captured — never before, so an abandoned checkout never burns a use) ──
  async function redeemCoupon(client, { couponId, userId, orderId, discountAmount }) {
    await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_amount)
       VALUES ($1, $2, $3, $4)`,
      [couponId, userId, orderId || null, discountAmount]
    );
    await client.query(
      `UPDATE coupons SET redemptions_count = redemptions_count + 1 WHERE id = $1`,
      [couponId]
    );
  }

  return { validateCoupon, redeemCoupon };
}

module.exports = { createCouponService };
