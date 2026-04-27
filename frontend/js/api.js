/* =============================================
   PERSONAL DIARY — API.JS
   All fetch requests to backend
   ============================================= */

const API = (() => {
  const BASE_URL = 'http://localhost:5000/api';

  // ─── Helpers ──────────────────────────────
  // FIX: auth.js saves the token under 'diary_token'.
  //      diary.js was reading it as 'token' (wrong key) — all API calls
  //      were sending no Authorization header, causing 401 errors.
  function getToken() {
    return localStorage.getItem('diary_token');
  }

  function authHeaders() {
    const token = getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }

  async function request(method, path, body = null) {
    const options = {
      method,
      headers: authHeaders()
    };
    if (body) options.body = JSON.stringify(body);

    console.log(`[API] ${method} ${BASE_URL}${path}`);

    try {
      const response = await fetch(`${BASE_URL}${path}`, options);
      const data = await response.json().catch(() => ({}));

      console.log(`[API] ${method} ${path} →`, response.status, data);

      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`[API] ${method} ${path} failed:`, err.message);
      throw new Error(err.message || 'Network error. Please try again.');
    }
  }

  // ─── Auth ──────────────────────────────────
  async function register({ username, email, password }) {
    return request('POST', '/auth/register', { username, email, password });
  }

  async function login({ email, password }) {
    return request('POST', '/auth/login', { email, password });
  }

  // ─── Entries ───────────────────────────────
  async function getEntries() {
    return request('GET', '/entries');
  }

  async function createEntry({ content, mood }) {
    return request('POST', '/entries', { content, mood });
  }

  async function updateEntry(id, { content, mood }) {
    return request('PUT', `/entries/${id}`, { content, mood });
  }

  async function deleteEntry(id) {
    return request('DELETE', `/entries/${id}`);
  }

  // ─── Public API ────────────────────────────
  return {
    register,
    login,
    getEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    getToken,
    isAuthenticated: () => !!getToken()
  };
})();