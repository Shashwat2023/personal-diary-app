/* =============================================
   FOLIO — COUPON CONTROLLER
   Preview-only: validates a code and shows what it
   would discount, without creating an order or
   consuming a redemption. The real, binding check
   happens again inside checkout creation — this
   endpoint exists purely for UI feedback.
   ============================================= */

const razorpay = require('../services/razorpayService');

function createCouponController(pool, coupons) {

  async function validate(req, res) {
    const { code, type, plan, billing_cycle: billingCycle, item_id: itemId } = req.body || {};

    if (!code) {
      return res.status(400).json({ success: false, message: 'Enter a coupon code.' });
    }
    if (!['subscription', 'marketplace'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type.' });
    }

    try {
      let baseAmount;

      if (type === 'subscription') {
        if (!['chronicle', 'heirloom'].includes(plan) || !['monthly', 'yearly'].includes(billingCycle)) {
          return res.status(400).json({ success: false, message: 'Invalid plan.' });
        }
        baseAmount = razorpay.getPlanAmount(plan, billingCycle);
      } else {
        const { rows } = await pool.query(
          `SELECT price, is_active FROM marketplace_items WHERE id = $1`,
          [itemId]
        );
        if (rows.length === 0 || !rows[0].is_active) {
          return res.status(404).json({ success: false, message: 'Item not found.' });
        }
        baseAmount = Number(rows[0].price);
      }

      const result = await coupons.validateCoupon({
        code, userId: req.user.id, type,
        planRestriction: type === 'subscription' ? plan : undefined,
        itemId: type === 'marketplace' ? itemId : undefined,
        baseAmount
      });

      if (!result.valid) {
        return res.status(400).json({ success: false, message: result.message });
      }

      res.json({
        success: true,
        data: {
          base_amount: result.base_amount,
          discount_amount: result.discount_amount,
          final_amount: result.final_amount
        }
      });
    } catch (err) {
      console.error('coupon validate error:', err.message);
      res.status(500).json({ success: false, message: 'Could not check that code.' });
    }
  }

  return { validate };
}

module.exports = { createCouponController };
