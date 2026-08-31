/* =============================================
   PERSONAL DIARY — UI.JS
   Animations, DOM helpers, toasts, cursor
   ============================================= */

const UI = (() => {

  // ─── Ripple Effect ──────────────────────────
  function addRipple(e) {
    const btn  = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x    = e.clientX - rect.left - size / 2;
    const y    = e.clientY - rect.top  - size / 2;

    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function initRipples() {
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', addRipple);
    });
  }

  function initRipplesFor(buttons) {
    buttons.forEach(btn => btn.addEventListener('click', addRipple));
  }

  // ─── Dark Mode Toggle ────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('diary_theme') || 'dark';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('diary_theme', theme);
    // Update all toggle buttons
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.textContent = theme === 'dark' ? '☀' : '◑';
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  function toggleTheme() {
    const current = localStorage.getItem('diary_theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';

    // Spin animation
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.classList.add('spinning');
      setTimeout(() => btn.classList.remove('spinning'), 420);
    });

    applyTheme(next);
  }

  // ─── Toast Notifications ─────────────────────
  let toastContainer;

  function getToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  const ICONS = { success: '✓', error: '✕', info: '◆' };

  function showToast(message, type = 'info', duration = 3500) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
      <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 260);
    }, duration);

    return toast;
  }

  // ─── Confirm Modal ───────────────────────────
  function showConfirm({ title, body, confirmText = 'Confirm', onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">${title}</h3>
        <p class="modal-body">${body}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
          <button class="btn btn-danger btn-sm" id="modal-confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function close() {
      overlay.classList.add('closing');
      overlay.querySelector('.modal').classList.add('closing');
      setTimeout(() => overlay.remove(), 220);
    }

    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#modal-confirm').addEventListener('click', () => {
      close();
      if (onConfirm) onConfirm();
    });

    initRipplesFor(overlay.querySelectorAll('.btn'));
    return overlay;
  }

  // ─── Skeleton Loaders ────────────────────────
  function renderSkeletons(container, count = 5) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.className = 'skeleton-item';
      item.innerHTML = `
        <div class="skeleton-line skeleton-date"></div>
        <div class="skeleton-line skeleton-text-1"></div>
        <div class="skeleton-line skeleton-text-2"></div>
      `;
      container.appendChild(item);
    }
  }

  // ─── Live Clock ──────────────────────────────
  function startLiveClock(el) {
    if (!el) return;
    function tick() {
      el.textContent = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    tick();
    return setInterval(tick, 1000);
  }

  // ─── Format Dates ────────────────────────────
  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  function formatDateShort(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      day: 'numeric', month: 'short'
    });
  }

  function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  function getMonthYear(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    });
  }

  function getPreview(content, len = 80) {
    const stripped = content.replace(/\n+/g, ' ').trim();
    return stripped.length > len ? stripped.slice(0, len) + '…' : stripped;
  }

  // ─── Mood pill HTML ──────────────────────────
  function getMoodPill(mood) {
    if (!mood) return '';
    return `<span class="entry-mood-pill mood-pill-${mood}">${mood}</span>`;
  }

  // ─── Sticky header shadow ────────────────────
  function initStickyHeader(header, scrollEl) {
    if (!header || !scrollEl) return;
    scrollEl.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', scrollEl.scrollTop > 5);
    });
  }

  // ─── Initials (avatar) ────────────────────────
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ─── Word count ──────────────────────────────
  function wordCount(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  // ─── Stagger items ───────────────────────────
  function staggerItems(items, delayStep = 40) {
    items.forEach((item, i) => {
      item.style.animationDelay = `${i * delayStep}ms`;
    });
  }

  // ─── Page transition ─────────────────────────
  function navigateWithTransition(url) {
    const overlay = document.createElement('div');
    overlay.className = 'page-transition';
    document.body.appendChild(overlay);
    setTimeout(() => { window.location.href = url; }, 300);
  }

  // ─── Public ─────────────────────────────────
  return {
    initRipples,
    initRipplesFor,
    initTheme,
    toggleTheme,
    showToast,
    showConfirm,
    renderSkeletons,
    startLiveClock,
    formatDate,
    formatDateShort,
    formatTime,
    getMonthYear,
    getPreview,
    getMoodPill,
    getInitials,
    initStickyHeader,
    wordCount,
    staggerItems,
    navigateWithTransition
  };
})();