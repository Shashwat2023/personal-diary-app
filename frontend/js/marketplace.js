/* =============================================
   FOLIO — MARKETPLACE.JS
   Browsing, preview, purchase, activation.
   Ownership and access are always server-decided.
   ============================================= */

const Marketplace = (() => {
  const SAMPLE_TEXT = 'Today I choose to remember.';

  const TABS = [
    { id: 'featured',  label: 'Featured',  filter: items => items.filter(i => Number(i.price) >= 3900) },
    { id: 'theme',     label: 'Themes',    filter: items => items.filter(i => i.type === 'theme') },
    { id: 'font',      label: 'Fonts',     filter: items => items.filter(i => i.type === 'font') },
    { id: 'animation', label: 'Animated',  filter: items => items.filter(i => i.type === 'animation') },
    { id: 'free',      label: 'Free',      filter: items => items.filter(i => i.is_free || Number(i.price) === 0) },
    { id: 'owned',     label: 'My Collection', filter: items => items.filter(i => i.owned) }
  ];

  const state = {
    items: [],
    activeTab: 'featured',
    currentPlan: 'journal',
    activeTheme: null,
    activeFont: null,
    previewing: null
  };

  let DOM = {};

  async function init() {
    DOM = {
      tabs:    document.getElementById('mk-tabs'),
      grid:    document.getElementById('mk-grid'),
      empty:   document.getElementById('mk-empty'),
      planTag: document.getElementById('mk-plan-tag')
    };

    renderTabs();
    await Promise.all([loadItems(), loadActive()]);
    render();
  }

  async function loadItems() {
    try {
      const res = await API.getMarketplaceItems();
      state.items = res.data.items;
      state.currentPlan = res.data.current_plan;
      if (DOM.planTag) {
        DOM.planTag.textContent = Subscription.planLabel(state.currentPlan);
      }
    } catch (err) {
      console.error('[Marketplace] load failed:', err.message);
      UI.showToast('Could not load the marketplace.', 'error');
    }
  }

  async function loadActive() {
    try {
      const res = await API.getAppearancePreferences();
      state.activeTheme = res.data.theme ? res.data.theme.slug : null;
      state.activeFont  = res.data.font  ? res.data.font.slug  : null;
    } catch (err) {
      console.error('[Marketplace] active load failed:', err.message);
    }
  }

  // ─── Tabs ───────────────────────────────────
  function renderTabs() {
    if (!DOM.tabs) return;
    DOM.tabs.innerHTML = TABS.map(t => `
      <button type="button" class="mk-tab${t.id === state.activeTab ? ' active' : ''}"
              data-tab="${t.id}" role="tab" aria-selected="${t.id === state.activeTab}">${t.label}</button>
    `).join('');

    DOM.tabs.querySelectorAll('.mk-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        renderTabs();
        render();
      });
    });
  }

  // ─── Grid ───────────────────────────────────
  function render() {
    if (!DOM.grid) return;
    const tab = TABS.find(t => t.id === state.activeTab);
    const items = tab ? tab.filter(state.items) : state.items;

    if (!items.length) {
      DOM.grid.innerHTML = '';
      if (DOM.empty) {
        DOM.empty.style.display = 'block';
        DOM.empty.textContent = state.activeTab === 'owned'
          ? 'Nothing in your collection yet. Anything you buy or unlock lives here.'
          : 'Nothing here just yet.';
      }
      return;
    }
    if (DOM.empty) DOM.empty.style.display = 'none';

    DOM.grid.innerHTML = items.map(cardHtml).join('');
    wireCards();
  }

  function cardHtml(item) {
    const price = Number(item.price);
    const isFree = item.is_free || price === 0;
    const isActive = (item.type === 'font' ? state.activeFont : state.activeTheme) === item.slug;

    return `
      <article class="mk-card${isActive ? ' is-active' : ''}" data-id="${item.id}" data-type="${item.type}">
        ${item.required_plan ? `<span class="mk-plan-badge">${Subscription.planLabel(item.required_plan)}</span>` : ''}
        ${preview(item)}
        <div class="mk-card-body">
          <h3 class="mk-card-name">${escapeHtml(item.name)}</h3>
          <p class="mk-card-desc">${escapeHtml(item.description || '')}</p>
          <div class="mk-card-foot">
            <span class="mk-price">${isFree ? 'Free' : '₹' + price / 100}</span>
            ${actionHtml(item, isActive, isFree)}
          </div>
        </div>
      </article>
    `;
  }

  function preview(item) {
    const data = item.preview_data || {};
    if (item.type === 'font') {
      const stack = data.stack || 'inherit';
      if (data.stack) Subscription.loadGoogleFont((item.preview_data || {}).google);
      return `<div class="mk-preview mk-preview-font" style="font-family:${stack}">${escapeHtml(data.sample || SAMPLE_TEXT)}</div>`;
    }
    const swatches = (data.swatches || []).map(c =>
      `<span class="mk-swatch" style="background:${escapeHtml(c)}"></span>`
    ).join('');
    return `<div class="mk-preview mk-preview-theme${data.animated ? ' is-animated' : ''}">${swatches}</div>`;
  }

  function actionHtml(item, isActive, isFree) {
    if (isActive) return `<button class="mk-btn is-active-btn" disabled>Active</button>`;
    if (item.access) {
      return `<button class="mk-btn mk-use" data-id="${item.id}">Use</button>`;
    }
    if (item.required_plan) {
      return `<a class="mk-btn mk-locked" href="pricing.html">View ${Subscription.planLabel(item.required_plan)}</a>`;
    }
    return `<button class="mk-btn mk-buy" data-id="${item.id}">${isFree ? 'Get' : 'Buy — ₹' + Number(item.price) / 100}</button>`;
  }

  // ─── Card interactions ──────────────────────
  function wireCards() {
    DOM.grid.querySelectorAll('.mk-buy').forEach(btn =>
      btn.addEventListener('click', () => buy(btn.dataset.id, btn)));
    DOM.grid.querySelectorAll('.mk-use').forEach(btn =>
      btn.addEventListener('click', () => use(btn.dataset.id, btn)));

    // Hovering a theme card previews it live; leaving restores the active one.
    DOM.grid.querySelectorAll('.mk-card[data-type="theme"], .mk-card[data-type="animation"]').forEach(card => {
      const item = state.items.find(i => i.id === card.dataset.id);
      if (!item || !item.access) return;
      card.addEventListener('mouseenter', () => previewTheme(item));
      card.addEventListener('mouseleave', restoreActive);
    });
  }

  async function previewTheme(item) {
    if (state.previewing === item.slug) return;
    try {
      const res = await API.getMarketplaceItem(item.id);
      if (res.data.item.item_data) {
        state.previewing = item.slug;
        Subscription.applyTheme(res.data.item);
      }
    } catch (err) { /* preview is best-effort */ }
  }

  async function restoreActive() {
    if (!state.previewing) return;
    state.previewing = null;
    await Subscription.loadAppearance();
  }

  // ─── Purchase ───────────────────────────────
  async function buy(itemId, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';

    try {
      const res = await API.createItemCheckout(itemId);

      // Free items are granted server-side with no payment round-trip.
      if (res.data.free) {
        UI.showToast('Added to your collection.', 'success');
        await refresh();
        return;
      }

      await Subscription.loadRazorpay();
      const order = res.data;
      const user = await Auth.getUser();

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'Folio',
        description: order.item.name,
        order_id: order.order_id,
        prefill: { name: user?.username || '', email: user?.email || '' },
        theme: { color: '#64745D' },
        modal: {
          ondismiss: () => { btn.disabled = false; btn.textContent = original; }
        },
        handler: async (response) => {
          btn.textContent = 'Verifying…';
          try {
            await API.verifyItemPurchase(itemId, {
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature
            });
            UI.showToast('Purchased — added to your collection.', 'success');
            await refresh();
          } catch (err) {
            UI.showToast(err.message || 'Could not verify your purchase.', 'error');
            btn.disabled = false;
            btn.textContent = original;
          }
        }
      });

      rzp.on('payment.failed', (resp) => {
        UI.showToast(resp?.error?.description || 'Payment failed.', 'error');
        btn.disabled = false;
        btn.textContent = original;
      });

      rzp.open();
    } catch (err) {
      UI.showToast(err.message || 'Could not start checkout.', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ─── Activate ───────────────────────────────
  async function use(itemId, btn) {
    btn.disabled = true;
    btn.textContent = 'Applying…';
    try {
      await API.activateItem(itemId);
      state.previewing = null;
      await Subscription.loadAppearance();
      await loadActive();
      render();
      UI.showToast('Applied.', 'success');
    } catch (err) {
      UI.showToast(err.message || 'Could not apply this item.', 'error');
      btn.disabled = false;
      btn.textContent = 'Use';
    }
  }

  async function refresh() {
    await Promise.all([loadItems(), loadActive()]);
    render();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, refresh };
})();
