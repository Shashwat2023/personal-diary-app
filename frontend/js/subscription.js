/* =============================================
   FOLIO — SUBSCRIPTION.JS
   Plan lookup + checkout (Razorpay wiring: Phase 2)
   ============================================= */

const Subscription = (() => {
  const PLAN_RANK = { journal: 0, chronicle: 1, heirloom: 2 };
  let cached = null;

  async function getCurrentPlan(force = false) {
    if (cached && !force) return cached;
    try {
      const res = await API.getSubscription();
      cached = res.subscription;
    } catch (err) {
      console.error('[Subscription] fetch failed:', err.message);
      cached = { plan: 'journal', status: 'active', billing_cycle: null };
    }
    return cached;
  }

  async function hasAtLeast(minPlan) {
    const sub = await getCurrentPlan();
    return PLAN_RANK[sub.plan] >= PLAN_RANK[minPlan];
  }

  // ┌─────────────────────────────────────────────────────────────┐
  // │ TODO (Phase 2 — Razorpay): fill this in once keys are ready. │
  // │ 1. Load https://checkout.razorpay.com/v1/checkout.js         │
  // │ 2. const order = await API.startCheckout(plan, cycle)         │
  // │ 3. new Razorpay({ key: '<RAZORPAY_KEY_ID>', ...order }).open()│
  // │ 4. On success callback, call API.getSubscription(force) again │
  // └─────────────────────────────────────────────────────────────┘
  async function startCheckout(plan, billingCycle) {
    try {
      await API.startCheckout(plan, billingCycle);
    } catch (err) {
      UI.showToast(err.message, 'info');
    }
  }

  return { getCurrentPlan, hasAtLeast, startCheckout };
})();
