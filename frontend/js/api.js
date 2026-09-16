/* =============================================
   PERSONAL DIARY — API.JS
   All fetch requests to backend
   ============================================= */

const API = (() => {
  const BASE_URL = '/api';

  // ─── Helpers ──────────────────────────────
  // Token now comes from the active Supabase session (Google sign-in).
  async function getToken() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session?.access_token || null;
  }

  async function authHeaders() {
    const token = await getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }

  async function request(method, path, body = null) {
    const options = {
      method,
      headers: await authHeaders()
    };
    if (body) options.body = JSON.stringify(body);

    console.log(`[API] ${method} ${BASE_URL}${path}`);

    try {
      const response = await fetch(`${BASE_URL}${path}`, options);
      const data = await response.json().catch(() => ({}));

      console.log(`[API] ${method} ${path} →`, response.status, data);

      if (!response.ok) {
        // 403 is now also used for plan limits (daily cap, character cap,
        // locked-entry limit). Only sign out on genuine auth failures —
        // otherwise hitting a free-plan limit would log the user out.
        const isPlanLimit = !!(data.code || data.upgrade_to || data.required_plan || data.feature);
        if (response.status === 401 || (response.status === 403 && !isPlanLimit)) {
          await supabaseClient.auth.signOut();
          window.location.href = 'login.html';
        }
        const error = new Error(data.message || data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = data.code;
        error.upgradeTo = data.upgrade_to || data.required_plan;
        error.payload = data;
        throw error;
      }
      return data;
    } catch (err) {
      console.error(`[API] ${method} ${path} failed:`, err.message);
      if (err.status) throw err;   // keep structured API errors intact
      throw new Error(err.message || 'Network error. Please try again.');
    }
  }

  // ─── Entries ───────────────────────────────
  async function getEntries() {
    return request('GET', '/entries');
  }

  async function createEntry({ content, mood, tags, category }) {
    return request('POST', '/entries', { content, mood, tags, category });
  }

  async function updateEntry(id, { content, mood, tags, category, is_favorite, is_pinned }) {
    return request('PUT', `/entries/${id}`, { content, mood, tags, category, is_favorite, is_pinned });
  }

  async function deleteEntry(id) {
    return request('DELETE', `/entries/${id}`);
  }

  async function getTrash() {
    return request('GET', '/entries/trash');
  }

  async function restoreEntry(id) {
    return request('POST', `/entries/${id}/restore`);
  }

  async function permanentDeleteEntry(id) {
    return request('DELETE', `/entries/${id}/permanent`);
  }

  async function getStats() {
    return request('GET', '/stats');
  }

  // ─── Subscription ──────────────────────────
  async function getSubscription() {
    return request('GET', '/subscription');
  }

  async function createSubscriptionCheckout(plan, billingCycle, couponCode) {
    return request('POST', '/subscription/checkout', {
      plan, billing_cycle: billingCycle,
      ...(couponCode ? { coupon_code: couponCode } : {})
    });
  }

  async function verifySubscriptionPayment(payload) {
    return request('POST', '/subscription/verify', payload);
  }

  async function cancelSubscription() {
    return request('POST', '/subscription/cancel');
  }

  async function getPaymentHistory() {
    return request('GET', '/subscription/payments');
  }

  // ─── Marketplace ───────────────────────────
  async function getMarketplaceItems(type) {
    return request('GET', type ? `/marketplace?type=${encodeURIComponent(type)}` : '/marketplace');
  }

  async function getMarketplaceItem(id) {
    return request('GET', `/marketplace/${id}`);
  }

  async function getOwnedItems() {
    return request('GET', '/marketplace/owned');
  }

  async function createItemCheckout(id, couponCode) {
    return request('POST', `/marketplace/${id}/checkout`,
      couponCode ? { coupon_code: couponCode } : undefined);
  }

  async function verifyItemPurchase(id, payload) {
    return request('POST', `/marketplace/${id}/verify`, payload);
  }

  async function activateItem(itemId) {
    return request('POST', '/marketplace/activate', { item_id: itemId });
  }

  async function getAppearancePreferences() {
    return request('GET', '/marketplace/preferences');
  }

  // ─── Locked entries ────────────────────────
  // ─── Coupons ────────────────────────────────
  async function validateCoupon(payload) {
    return request('POST', '/coupons/validate', payload);
  }

  async function lockEntry(id, { content, lockSalt, lockIv }) {
    return request('POST', `/entries/${id}/lock`, {
      content, lock_salt: lockSalt, lock_iv: lockIv
    });
  }

  async function unlockEntry(id, content) {
    return request('POST', `/entries/${id}/unlock`, { content });
  }

  // ─── Public API ────────────────────────────
  return {
    getEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    getTrash,
    restoreEntry,
    permanentDeleteEntry,
    getStats,
    getSubscription,
    createSubscriptionCheckout,
    verifySubscriptionPayment,
    cancelSubscription,
    getPaymentHistory,
    getMarketplaceItems,
    getMarketplaceItem,
    getOwnedItems,
    createItemCheckout,
    verifyItemPurchase,
    activateItem,
    getAppearancePreferences,
    validateCoupon,
    lockEntry,
    unlockEntry,
    getToken,
    isAuthenticated: async () => !!(await getToken())
  };
})();