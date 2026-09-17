/* =============================================
   FOLIO — RAZORPAY SERVICE
   The only payment integration. No fake success path:
   if credentials are missing, every call fails loudly.
   ============================================= */

const crypto = require('crypto');
const Razorpay = require('razorpay');

const KEY_ID         = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ─── Plan pricing (paise) — single source of truth ──────────
const PLAN_PRICING = {
  chronicle: { monthly: 7900,  yearly: 79900  },   // ₹79 / ₹799
  heirloom:  { monthly: 14900, yearly: 149900 }    // ₹149 / ₹1,499
};

function isConfigured() {
  return !!(KEY_ID && KEY_SECRET);
}

function isWebhookConfigured() {
  return !!WEBHOOK_SECRET;
}

let client = null;
function getClient() {
  if (!isConfigured()) {
    const err = new Error('Payments are not configured.');
    err.code = 'RAZORPAY_NOT_CONFIGURED';
    throw err;
  }
  if (!client) {
    client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return client;
}

function getPlanAmount(plan, billingCycle) {
  const planPricing = PLAN_PRICING[plan];
  if (!planPricing) {
    const err = new Error('Invalid plan.');
    err.code = 'INVALID_PLAN';
    throw err;
  }
  const amount = planPricing[billingCycle];
  if (!amount) {
    const err = new Error('Invalid billing cycle.');
    err.code = 'INVALID_BILLING_CYCLE';
    throw err;
  }
  return amount;
}

// ─── Orders ─────────────────────────────────────────────────
// One-time order model: each subscription period is a discrete payment.
// Keeps the flow simple and avoids Razorpay Plan/Subscription pre-setup.
async function createOrder({ amount, receipt, notes }) {
  return getClient().orders.create({
    amount,                 // paise
    currency: 'INR',
    receipt,
    notes: notes || {}
  });
}

async function createSubscriptionOrder({ userId, plan, billingCycle }) {
  const amount = getPlanAmount(plan, billingCycle);
  const order = await createOrder({
    amount,
    receipt: `sub_${Date.now()}`,
    notes: { kind: 'subscription', user_id: userId, plan, billing_cycle: billingCycle }
  });
  return { order, amount };
}

async function createMarketplaceOrder({ userId, item }) {
  const amount = Number(item.price);
  if (!amount || amount <= 0) {
    const err = new Error('This item is not a paid item.');
    err.code = 'NOT_PAID_ITEM';
    throw err;
  }
  const order = await createOrder({
    amount,
    receipt: `mkt_${Date.now()}`,
    notes: { kind: 'marketplace', user_id: userId, item_id: item.id, slug: item.slug }
  });
  return { order, amount };
}

// ─── Signature verification ─────────────────────────────────
// Checkout callback: HMAC-SHA256 of "<order_id>|<payment_id>" with KEY_SECRET.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!isConfigured()) return false;
  if (!orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

// Webhook: HMAC-SHA256 of the RAW request body with WEBHOOK_SECRET.
function verifyWebhookSignature(rawBody, signature) {
  if (!isWebhookConfigured()) return false;
  if (!rawBody || !signature) return false;

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Period calculation ─────────────────────────────────────
// Naive setMonth(+1) overflows: Jan 31 becomes Mar 3, silently skipping a
// month. Clamp to the last valid day of the target month instead.
function periodEndFrom(startDate, billingCycle) {
  const start = new Date(startDate);
  const end = new Date(start);
  const day = start.getDate();

  if (billingCycle === 'yearly') {
    end.setFullYear(start.getFullYear() + 1, start.getMonth(), 1);
  } else {
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
  }

  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(day, lastDay));
  return end;
}

module.exports = {
  PLAN_PRICING,
  KEY_ID,
  isConfigured,
  isWebhookConfigured,
  getPlanAmount,
  createOrder,
  createSubscriptionOrder,
  createMarketplaceOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  periodEndFrom
};
