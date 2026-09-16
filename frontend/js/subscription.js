/* =============================================
   FOLIO — SUBSCRIPTION.JS
   Plan state, Razorpay checkout, appearance engine.
   The backend decides entitlements; this only reflects them.
   ============================================= */

const Subscription = (() => {
  const PLAN_RANK  = { journal: 0, chronicle: 1, heirloom: 2 };
  const PLAN_LABEL = { journal: 'Journal', chronicle: 'Chronicle', heirloom: 'Heirloom' };

  // Display prices in rupees; the backend holds the authoritative paise values.
  const PRICING = {
    chronicle: { monthly: 79,  yearly: 799  },
    heirloom:  { monthly: 149, yearly: 1499 }
  };

  let cached = null;
  let razorpayScriptPromise = null;

  // ─── Plan state ─────────────────────────────
  // Mirrors backend PLAN_FEATURES.journal — used only if /api/subscription
  // can't be reached. Failing safe to the strictest tier (rather than an
  // empty {} that silently disabled every limit) is the whole point: a
  // fetch failure should never accidentally grant unlimited access.
  const JOURNAL_FALLBACK_FEATURES = {
    unlimited_entries: false,
    unlimited_characters: false,
    entries_per_day: 2,
    characters_per_entry: 1000,
    premium_themes: false,
    animated_themes: false,
    premium_fonts: false,
    pdf_export: false,
    custom_pdf_cover: false,
    locked_entries: 0,
    advanced_statistics: false,
    advanced_search: false,
    marketplace: 'basic'
  };

  async function getCurrentPlan(force = false) {
    if (cached && !force) return cached;
    try {
      const res = await API.getSubscription();
      cached = res.data;
    } catch (err) {
      console.error('[Subscription] fetch failed:', err.message);
      cached = { plan: 'journal', status: 'active', billing_cycle: null, features: JOURNAL_FALLBACK_FEATURES };
    }
    return cached;
  }

  function clearCache() { cached = null; }

  async function hasAtLeast(minPlan) {
    const sub = await getCurrentPlan();
    return PLAN_RANK[sub.plan] >= PLAN_RANK[minPlan];
  }

  async function hasFeature(feature) {
    const sub = await getCurrentPlan();
    return !!(sub.features && sub.features[feature]);
  }

  function planLabel(plan) { return PLAN_LABEL[plan] || 'Journal'; }

  // ─── Razorpay loader ────────────────────────
  function loadRazorpay() {
    if (razorpayScriptPromise) return razorpayScriptPromise;
    razorpayScriptPromise = new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the payment window.'));
      document.head.appendChild(s);
    });
    return razorpayScriptPromise;
  }

  // ─── Subscription checkout ──────────────────
  // Resolves only after the backend has verified the signature — a frontend
  // "success" callback alone never grants access.
  async function startCheckout(plan, billingCycle, { onStateChange, couponCode } = {}) {
    const setState = onStateChange || (() => {});

    try {
      setState('loading');
      const res = await API.createSubscriptionCheckout(plan, billingCycle, couponCode);
      const order = res.data;

      await loadRazorpay();

      const user = await Auth.getUser();

      return await new Promise((resolve) => {
        const rzp = new window.Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'Folio',
          description: `${planLabel(plan)} — ${billingCycle}`,
          order_id: order.order_id,
          prefill: {
            name:  user?.username || '',
            email: user?.email || ''
          },
          theme: { color: '#64745D' },
          modal: {
            ondismiss: () => {
              setState('idle');
              resolve({ success: false, dismissed: true });
            }
          },
          handler: async (response) => {
            try {
              setState('verifying');
              await API.verifySubscriptionPayment({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature
              });
              clearCache();
              await getCurrentPlan(true);
              setState('success');
              resolve({ success: true });
            } catch (err) {
              console.error('[Subscription] verification failed:', err.message);
              setState('error');
              UI.showToast(err.message || 'Payment could not be verified.', 'error');
              resolve({ success: false, error: err.message });
            }
          }
        });

        rzp.on('payment.failed', (resp) => {
          setState('error');
          UI.showToast(resp?.error?.description || 'Payment failed. Please try again.', 'error');
          resolve({ success: false, error: 'payment_failed' });
        });

        rzp.open();
      });
    } catch (err) {
      setState('error');
      UI.showToast(err.message || 'Could not start checkout.', 'error');
      return { success: false, error: err.message };
    }
  }

  async function cancel() {
    const res = await API.cancelSubscription();
    clearCache();
    return res.data;
  }

  // ─── Appearance engine (themes + fonts) ─────
  // Applies whatever the backend says the user is entitled to. A crafted
  // localStorage value can't unlock anything, because item_data only ships
  // from the server when access checks pass.
  const loadedFonts = new Set();

  function loadGoogleFont(googleSpec) {
    if (!googleSpec || loadedFonts.has(googleSpec)) return;
    loadedFonts.add(googleSpec);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${googleSpec}&display=swap`;
    document.head.appendChild(link);
  }

  function applyTheme(item) {
    const root = document.documentElement;
    if (!item || !item.item_data) {
      root.removeAttribute('data-app-theme');
      clearThemeVars();
      stopEffect();
      return;
    }
    const data = item.item_data;
    root.setAttribute('data-app-theme', item.slug);

    clearThemeVars();
    Object.entries(data.vars || {}).forEach(([key, value]) => {
      root.style.setProperty(key, value);
      appliedVars.push(key);
    });

    if (data.effect) startEffect(data.effect);
    else stopEffect();
  }

  let appliedVars = [];
  function clearThemeVars() {
    appliedVars.forEach(v => document.documentElement.style.removeProperty(v));
    appliedVars = [];
  }

  function applyFont(item) {
    const root = document.documentElement;
    if (!item || !item.item_data) {
      root.style.removeProperty('--font-body');
      root.removeAttribute('data-app-font');
      return;
    }
    const data = item.item_data;
    loadGoogleFont(data.google);
    root.setAttribute('data-app-font', item.slug);
    if (data.stack) root.style.setProperty('--font-body', data.stack);
  }

  // ─── Ambient effects (animated themes) ──────
  let effectEl = null;
  function stopEffect() {
    if (effectEl) { effectEl.remove(); effectEl = null; }
  }

  function startEffect(name) {
    stopEffect();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    effectEl = document.createElement('div');
    effectEl.className = `ambient-effect ambient-${name}`;
    effectEl.setAttribute('aria-hidden', 'true');

    const count = name === 'snow' ? 40 : 28;
    let particles = '';
    for (let i = 0; i < count; i++) {
      const left  = Math.random() * 100;
      const delay = (Math.random() * 12).toFixed(2);
      const dur   = (8 + Math.random() * 10).toFixed(2);
      const scale = (0.4 + Math.random() * 0.9).toFixed(2);
      particles += `<span style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;transform:scale(${scale})"></span>`;
    }
    effectEl.innerHTML = particles;
    document.body.appendChild(effectEl);
  }

  // Called on every authenticated page load.
  async function loadAppearance() {
    try {
      const res = await API.getAppearancePreferences();
      applyTheme(res.data.theme);
      applyFont(res.data.font);
      return res.data;
    } catch (err) {
      console.error('[Subscription] appearance load failed:', err.message);
      return null;
    }
  }

  return {
    PRICING, PLAN_RANK,
    getCurrentPlan, clearCache, hasAtLeast, hasFeature, planLabel,
    startCheckout, cancel, loadRazorpay,
    applyTheme, applyFont, loadAppearance, loadGoogleFont
  };
})();
