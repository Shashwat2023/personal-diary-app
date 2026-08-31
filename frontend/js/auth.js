/* =============================================
   PERSONAL DIARY — AUTH.JS
   Login / Register logic
   ============================================= */

const Auth = (() => {
  // ─── Storage ────────────────────────────────
  function saveSession(token, user) {
    localStorage.setItem('diary_token', token);
    localStorage.setItem('diary_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('diary_token');
    localStorage.removeItem('diary_user');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('diary_user')) || null;
    } catch {
      return null;
    }
  }

  function isAuthenticated() {
    return !!localStorage.getItem('diary_token');
  }

  // ─── Validation ─────────────────────────────
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function validatePassword(password) {
    return password.length >= 6;
  }

  function validateUsername(username) {
    return username.trim().length >= 2;
  }

  function showFieldError(input, message) {
    const group = input.closest('.form-group');
    if (!group) return;
    group.classList.add('has-error');
    let errEl = group.querySelector('.form-error');
    if (!errEl) {
      errEl = document.createElement('span');
      errEl.className = 'form-error';
      group.appendChild(errEl);
    }
    errEl.textContent = message;
  }

  function clearFieldError(input) {
    const group = input.closest('.form-group');
    if (!group) return;
    group.classList.remove('has-error');
    const errEl = group.querySelector('.form-error');
    if (errEl) errEl.textContent = '';
  }

  function clearAllErrors(form) {
    form.querySelectorAll('.form-group').forEach(g => {
      g.classList.remove('has-error');
      const e = g.querySelector('.form-error');
      if (e) e.textContent = '';
    });
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

  // ─── Login ──────────────────────────────────
  async function handleLogin(form) {
    clearAllErrors(form);

    const emailInput = form.querySelector('#email');
    const passwordInput = form.querySelector('#password');
    const submitBtn = form.querySelector('[type="submit"]');

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    let valid = true;

    if (!validateEmail(email)) {
      showFieldError(emailInput, 'Please enter a valid email address.');
      valid = false;
    }

    if (!password) {
      showFieldError(passwordInput, 'Password is required.');
      valid = false;
    }

    if (!valid) return;

    submitBtn.classList.add('loading');
    submitBtn.textContent = '';

    try {
      const data = await API.login({ email, password });
      saveSession(data.token, data.user || { email, username: email.split('@')[0] });
      UI.showToast('Welcome back!', 'success');
      setTimeout(() => navigateTo('dashboard.html'), 600);
    } catch (err) {
      submitBtn.classList.remove('loading');
      submitBtn.textContent = 'Sign In';
      UI.showToast(err.message, 'error');
    }
  }

  // ─── Register ───────────────────────────────
  async function handleRegister(form) {
    clearAllErrors(form);

    const usernameInput = form.querySelector('#username');
    const emailInput = form.querySelector('#email');
    const passwordInput = form.querySelector('#password');
    const submitBtn = form.querySelector('[type="submit"]');

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    let valid = true;

    if (!validateUsername(username)) {
      showFieldError(usernameInput, 'Username must be at least 2 characters.');
      valid = false;
    }

    if (!validateEmail(email)) {
      showFieldError(emailInput, 'Please enter a valid email address.');
      valid = false;
    }

    if (!validatePassword(password)) {
      showFieldError(passwordInput, 'Password must be at least 6 characters.');
      valid = false;
    }

    if (!valid) return;

    submitBtn.classList.add('loading');
    submitBtn.textContent = '';

    try {
      await API.register({ username, email, password });
      UI.showToast('Check your email to verify your account.', 'success', 5000);
      setTimeout(() => navigateTo('login.html'), 1200);
    } catch (err) {
      submitBtn.classList.remove('loading');
      submitBtn.textContent = 'Create Account';
      UI.showToast(err.message, 'error');
    }
  }

  // ─── Logout ─────────────────────────────────
  function logout() {
    clearSession();
    navigateTo('login.html');
  }

  // ─── Guard ──────────────────────────────────
  function requireAuth() {
    if (!isAuthenticated()) {
      navigateTo('login.html');
      return false;
    }
    return true;
  }

  function redirectIfAuth() {
    if (isAuthenticated()) {
      navigateTo('dashboard.html');
      return true;
    }
    return false;
  }

  // ─── Public ─────────────────────────────────
  return {
    handleLogin,
    handleRegister,
    logout,
    requireAuth,
    redirectIfAuth,
    isAuthenticated,
    getUser,
    clearSession
  };
})();
