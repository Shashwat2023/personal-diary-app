/* =============================================
   PERSONAL DIARY — AUTH.JS
   Google sign-in via Supabase Auth
   ============================================= */

const Auth = (() => {
  // ─── Session ────────────────────────────────
  async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
  }

  async function isAuthenticated() {
    return !!(await getSession());
  }

  async function getUser() {
    const session = await getSession();
    if (!session) return null;
    const u = session.user;
    return {
      id: u.id,
      email: u.email,
      username: u.user_metadata?.full_name || u.user_metadata?.name || u.email
    };
  }

  // ─── Navigate with transition ───────────────
  function navigateTo(page) {
    const overlay = document.createElement('div');
    overlay.className = 'page-transition';
    document.body.appendChild(overlay);
    setTimeout(() => {
      window.location.href = page;
    }, 300);
  }

  // ─── Google sign-in (login + register both) ─
  async function signInWithGoogle() {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard.html` }
    });
    if (error) UI.showToast(error.message, 'error');
  }

  // ─── Logout ─────────────────────────────────
  async function logout() {
    await supabaseClient.auth.signOut();
    navigateTo('login.html');
  }

  // ─── Guards ─────────────────────────────────
  async function requireAuth() {
    if (!(await isAuthenticated())) {
      navigateTo('login.html');
      return false;
    }
    return true;
  }

  async function redirectIfAuth() {
    if (await isAuthenticated()) {
      navigateTo('dashboard.html');
      return true;
    }
    return false;
  }

  // ─── Public ─────────────────────────────────
  return {
    signInWithGoogle,
    logout,
    requireAuth,
    redirectIfAuth,
    isAuthenticated,
    getUser
  };
})();