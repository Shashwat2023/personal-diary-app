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
        if (response.status === 401 || response.status === 403) {
          await supabaseClient.auth.signOut();
          window.location.href = 'login.html';
        }
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`[API] ${method} ${path} failed:`, err.message);
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

  async function getSubscription() {
    return request('GET', '/subscription');
  }

  async function startCheckout(plan, billingCycle) {
    return request('POST', '/subscription/checkout', { plan, billing_cycle: billingCycle });
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
    startCheckout,
    getToken,
    isAuthenticated: async () => !!(await getToken())
  };
})();