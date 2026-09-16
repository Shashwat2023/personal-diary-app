/* =============================================
   FOLIO — SUBSCRIPTION CONTROLLER
   Razorpay-only. A subscription is never activated
   without server-side signature verification.
   ============================================= */

const razorpay = require('../services/razorpayService');

function createSubscriptionController(pool, entitlements, coupons) {

  // ─── GET /api/subscription ──────────────────
  async function getSubscription(req, res) {
    try {
      const sub = await entitlements.getUserPlan(req.user.id);
      const features = entitlements.featuresForPlan(sub.plan);

      res.json({
        success: true,
        data: {
          ...sub,
          features: serializeFeatures(features),
          payments_configured: razorpay.isConfigured()
        }
      });
    } catch (err) {
      console.error('getSubscription error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load your subscription.' });
    }
  }

  // ─── POST /api/subscription/checkout ────────
  async function createCheckout(req, res) {
    const { plan, billing_cycle: billingCycle, coupon_code: couponCode } = req.body || {};

    if (!['chronicle', 'heirloom'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan.' });
    }
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ success: false, message: 'Invalid billing cycle.' });
    }

    try {
      const current = await entitlements.getUserPlan(req.user.id);
      if (current.plan === plan && current.status === 'active') {
        return res.status(409).json({ success: false, message: `You're already on ${plan}.` });
      }

      // Base price comes only from the server's own pricing table — never
      // from anything in the request. A coupon can only ever discount THIS.
      const baseAmount = razorpay.getPlanAmount(plan, billingCycle);

      let finalAmount = baseAmount;
      let couponId = null;
      let discountAmount = 0;

      if (couponCode) {
        const result = await coupons.validateCoupon({
          code: couponCode, userId: req.user.id, type: 'subscription',
          planRestriction: plan, baseAmount
        });
        if (!result.valid) {
          return res.status(400).json({ success: false, message: result.message, code: 'INVALID_COUPON' });
        }
        finalAmount = result.final_amount;
        discountAmount = result.discount_amount;
        couponId = result.coupon.id;
      }

      // A coupon covering the full price activates immediately — no
      // Razorpay order, no card, nothing to verify. This also means a
      // 100%-off coupon works even before Razorpay keys are configured.
      if (finalAmount === 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const subscription = await activateSubscription(client, {
            userId: req.user.id, plan, billingCycle,
            orderId: null, paymentId: null
          });

          if (couponId) {
            await coupons.redeemCoupon(client, {
              couponId, userId: req.user.id, orderId: null, discountAmount
            });
          }

          await client.query(
            `INSERT INTO payments
               (user_id, subscription_id, amount, currency, plan, billing_cycle, status, coupon_id, discount_amount)
             VALUES ($1, $2, 0, 'INR', $3, $4, 'captured', $5, $6)`,
            [req.user.id, subscription.id, plan, billingCycle, couponId, discountAmount]
          );

          await client.query('COMMIT');
          return res.json({ success: true, data: { free: true, subscription } });
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }

      if (!razorpay.isConfigured()) {
        return res.status(503).json({ success: false, message: 'Payments are not configured.' });
      }

      const order = await razorpay.createOrder({
        amount: finalAmount,
        receipt: `sub_${Date.now()}`,
        notes: { kind: 'subscription', user_id: req.user.id, plan, billing_cycle: billingCycle }
      });

      // Record the intent so the webhook can reconcile even if the user
      // closes the browser before the verify call lands.
      await pool.query(
        `INSERT INTO payments
           (user_id, razorpay_order_id, amount, currency, plan, billing_cycle, status, coupon_id, discount_amount)
         VALUES ($1, $2, $3, 'INR', $4, $5, 'created', $6, $7)`,
        [req.user.id, order.id, finalAmount, plan, billingCycle, couponId, discountAmount]
      );

      res.json({
        success: true,
        data: {
          key_id: razorpay.KEY_ID,      // public key only
          order_id: order.id,
          amount: finalAmount,
          base_amount: baseAmount,
          discount_amount: discountAmount,
          currency: 'INR',
          plan,
          billing_cycle: billingCycle
        }
      });
    } catch (err) {
      console.error('createCheckout error:', err.message);
      const status = err.code === 'RAZORPAY_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({
        success: false,
        message: status === 503 ? 'Payments are not configured.' : 'Could not start checkout.'
      });
    }
  }

  // ─── POST /api/subscription/verify ──────────
  async function verifyPayment(req, res) {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    } = req.body || {};

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details.' });
    }

    const valid = razorpay.verifyPaymentSignature({ orderId, paymentId, signature });
    if (!valid) {
      await pool.query(
        `UPDATE payments SET status = 'failed'
         WHERE razorpay_order_id = $1 AND user_id = $2 AND status = 'created'`,
        [orderId, req.user.id]
      ).catch(() => {});
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // The order row proves this payment belongs to this user and tells us
      // which plan was purchased — never trust the plan from the request body.
      const { rows: payRows } = await client.query(
        `SELECT id, plan, billing_cycle, amount, status, coupon_id, discount_amount FROM payments
         WHERE razorpay_order_id = $1 AND user_id = $2
         FOR UPDATE`,
        [orderId, req.user.id]
      );

      if (payRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const payment = payRows[0];

      // Idempotent: replaying the same verification is a no-op success.
      if (payment.status === 'captured') {
        await client.query('COMMIT');
        const sub = await entitlements.getUserPlan(req.user.id);
        return res.json({ success: true, data: { already_processed: true, subscription: sub } });
      }

      await client.query(
        `UPDATE payments
         SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'captured'
         WHERE id = $3`,
        [paymentId, signature, payment.id]
      );

      // Redeemed only now — on confirmed, signature-verified capture. An
      // abandoned or failed checkout never consumes the user's one use.
      if (payment.coupon_id) {
        await coupons.redeemCoupon(client, {
          couponId: payment.coupon_id,
          userId: req.user.id,
          orderId,
          discountAmount: payment.discount_amount
        });
      }

      const subscription = await activateSubscription(client, {
        userId: req.user.id,
        plan: payment.plan,
        billingCycle: payment.billing_cycle,
        orderId,
        paymentId
      });

      await client.query(
        `UPDATE payments SET subscription_id = $1 WHERE id = $2`,
        [subscription.id, payment.id]
      );

      await client.query('COMMIT');

      res.json({ success: true, data: { subscription } });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('verifyPayment error:', err.message);
      res.status(500).json({ success: false, message: 'Could not verify payment.' });
    } finally {
      client.release();
    }
  }

  // Supersedes any existing active subscription, then inserts the new one.
  // Keeps the "one active per user" index satisfied.
  async function activateSubscription(client, { userId, plan, billingCycle, orderId, paymentId, subscriptionId }) {
    const start = new Date();
    const end = razorpay.periodEndFrom(start, billingCycle);

    await client.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    const { rows } = await client.query(
      `INSERT INTO subscriptions
         (user_id, plan, status, billing_cycle, razorpay_order_id,
          razorpay_payment_id, razorpay_subscription_id,
          current_period_start, current_period_end)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, plan, billingCycle, orderId || null, paymentId || null,
       subscriptionId || null, start, end]
    );

    return rows[0];
  }

  // ─── POST /api/subscription/webhook ─────────
  // Not authenticated — Razorpay calls this. Verified by signature instead.
  async function handleWebhook(req, res) {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody;

    if (!razorpay.isWebhookConfigured()) {
      console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting.');
      return res.status(503).json({ success: false, message: 'Webhook not configured.' });
    }
    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      console.error('[webhook] Invalid signature — rejecting.');
      return res.status(400).json({ success: false, message: 'Invalid signature.' });
    }

    const event = req.body?.event;
    const payload = req.body?.payload || {};

    try {
      switch (event) {
        case 'payment.captured':
          await onPaymentCaptured(payload);
          break;
        case 'payment.failed':
          await onPaymentFailed(payload);
          break;
        case 'subscription.cancelled':
        case 'subscription.halted':
        case 'subscription.completed':
        case 'subscription.expired':
          await onSubscriptionEnded(payload);
          break;
        default:
          // Unhandled events are acknowledged so Razorpay stops retrying.
          break;
      }
      res.json({ success: true });
    } catch (err) {
      console.error(`[webhook] ${event} handling failed:`, err.message);
      // 500 tells Razorpay to retry — safe because handlers are idempotent.
      res.status(500).json({ success: false, message: 'Webhook processing failed.' });
    }
  }

  async function onPaymentCaptured(payload) {
    const entity = payload.payment?.entity;
    if (!entity) return;

    const orderId = entity.order_id;
    const paymentId = entity.id;
    const notes = entity.notes || {};

    // Marketplace purchases are reconciled by their own controller path;
    // this webhook only finalizes subscription orders.
    if (notes.kind === 'marketplace') return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, user_id, plan, billing_cycle, status, coupon_id, discount_amount FROM payments
         WHERE razorpay_order_id = $1 FOR UPDATE`,
        [orderId]
      );
      if (rows.length === 0) { await client.query('ROLLBACK'); return; }

      const payment = rows[0];
      if (payment.status === 'captured') { await client.query('COMMIT'); return; }  // idempotent

      await client.query(
        `UPDATE payments SET razorpay_payment_id = $1, status = 'captured' WHERE id = $2`,
        [paymentId, payment.id]
      );

      if (payment.coupon_id) {
        await coupons.redeemCoupon(client, {
          couponId: payment.coupon_id,
          userId: payment.user_id,
          orderId,
          discountAmount: payment.discount_amount
        });
      }

      const subscription = await activateSubscription(client, {
        userId: payment.user_id,
        plan: payment.plan,
        billingCycle: payment.billing_cycle,
        orderId,
        paymentId
      });

      await client.query(
        `UPDATE payments SET subscription_id = $1 WHERE id = $2`,
        [subscription.id, payment.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function onPaymentFailed(payload) {
    const entity = payload.payment?.entity;
    if (!entity?.order_id) return;
    // Never activates anything — only records the failure.
    await pool.query(
      `UPDATE payments SET status = 'failed', razorpay_payment_id = $1
       WHERE razorpay_order_id = $2 AND status = 'created'`,
      [entity.id || null, entity.order_id]
    );
  }

  async function onSubscriptionEnded(payload) {
    const entity = payload.subscription?.entity;
    if (!entity?.id) return;
    await pool.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE razorpay_subscription_id = $1 AND status = 'active'`,
      [entity.id]
    );
  }

  // ─── POST /api/subscription/cancel ──────────
  // Keeps paid access until the period ends; diary data is never touched.
  async function cancelSubscription(req, res) {
    try {
      const sub = await entitlements.getUserPlan(req.user.id);
      if (sub.plan === 'journal' || !sub.subscription_id) {
        return res.status(400).json({ success: false, message: 'You have no active paid plan to cancel.' });
      }

      const { rows } = await pool.query(
        `UPDATE subscriptions SET cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [sub.subscription_id, req.user.id]
      );

      res.json({
        success: true,
        data: {
          subscription: rows[0],
          message: `Your plan stays active until ${new Date(rows[0].current_period_end).toDateString()}, then returns to Journal. Your entries are untouched.`
        }
      });
    } catch (err) {
      console.error('cancelSubscription error:', err.message);
      res.status(500).json({ success: false, message: 'Could not cancel your subscription.' });
    }
  }

  // ─── GET /api/subscription/payments ─────────
  async function getPaymentHistory(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT razorpay_payment_id, amount, currency, plan, billing_cycle, status, created_at
         FROM payments
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.id]
      );
      res.json({ success: true, data: { payments: rows } });
    } catch (err) {
      console.error('getPaymentHistory error:', err.message);
      res.status(500).json({ success: false, message: 'Could not load payment history.' });
    }
  }

  return {
    getSubscription,
    createCheckout,
    verifyPayment,
    handleWebhook,
    cancelSubscription,
    getPaymentHistory
  };
}

// Infinity doesn't survive JSON.stringify — send null for "unlimited".
function serializeFeatures(features) {
  const out = {};
  for (const [key, value] of Object.entries(features)) {
    out[key] = value === Infinity ? null : value;
  }
  return out;
}

module.exports = { createSubscriptionController };
