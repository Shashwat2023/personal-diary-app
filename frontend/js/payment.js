/* =============================================
   FOLIO — PAYMENT.JS
   One dedicated checkout page for both subscription
   plans and marketplace items, with a coupon field.

   IMPORTANT: nothing displayed here is ever sent back
   as a price. The coupon preview call and the final
   checkout call both only ever send a CODE STRING —
   the backend looks up the real price and the real
   discount itself. Changing any number on this page
   via devtools has zero effect on what gets charged.
   ============================================= */

const Payment = (() => {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');           // 'subscription' | 'marketplace'
  const plan = params.get('plan');            // chronicle | heirloom
  const cycle = params.get('cycle') || 'monthly';
  const itemId = params.get('item');

  let DOM = {};
  let baseAmount = 0;       // paise — display only, refreshed from server responses
  let appliedCoupon = null; // { code, discount_amount, final_amount }
  let itemMeta = null;      // marketplace item details, if applicable

  function bindDOM() {
    DOM = {
      title:        document.getElementById('pay-title'),
      subtitle:     document.getElementById('pay-subtitle'),
      baseRow:      document.getElementById('pay-base-row'),
      baseAmount:   document.getElementById('pay-base-amount'),
      discountRow:  document.getElementById('pay-discount-row'),
      discountAmount: document.getElementById('pay-discount-amount'),
      totalAmount:  document.getElementById('pay-total-amount'),
      couponInput:  document.getElementById('coupon-input'),
      couponApply:  document.getElementById('coupon-apply'),
      couponMsg:    document.getElementById('coupon-message'),
      couponApplied:document.getElementById('coupon-applied'),
      couponRemove: document.getElementById('coupon-remove'),
      payBtn:       document.getElementById('pay-btn'),
      errorBox:     document.getElementById('pay-error')
    };
  }

  async function init() {
    bindDOM();

    if (!(await Auth.requireAuth())) return;

    if (type === 'subscription') {
      if (!['chronicle', 'heirloom'].includes(plan) || !['monthly', 'yearly'].includes(cycle)) {
        showFatalError('This plan link looks incorrect.');
        return;
      }
      baseAmount = Subscription.PRICING[plan][cycle] * 100; // rupees -> paise, display only
      DOM.title.textContent = `${Subscription.planLabel(plan)}`;
      DOM.subtitle.textContent = `Billed ${cycle}`;
    } else if (type === 'marketplace') {
      if (!itemId) { showFatalError('This item link looks incorrect.'); return; }
      try {
        const res = await API.getMarketplaceItem(itemId);
        itemMeta = res.data.item;
        if (res.data.access) {
          showFatalError('You already have access to this item.');
          return;
        }
        baseAmount = Number(itemMeta.price);
        DOM.title.textContent = itemMeta.name;
        DOM.subtitle.textContent = itemMeta.description || '';
      } catch (err) {
        showFatalError(err.message || 'Could not load this item.');
        return;
      }
    } else {
      showFatalError('Nothing to pay for here.');
      return;
    }

    renderAmounts();
    wireEvents();
  }

  function showFatalError(message) {
    if (DOM.errorBox) {
      DOM.errorBox.textContent = message;
      DOM.errorBox.style.display = 'block';
    }
    if (DOM.payBtn) DOM.payBtn.disabled = true;
    if (DOM.couponApply) DOM.couponApply.disabled = true;
  }

  function renderAmounts() {
    const final = appliedCoupon ? appliedCoupon.final_amount : baseAmount;

    DOM.baseAmount.textContent = formatRupees(baseAmount);

    if (appliedCoupon) {
      DOM.discountRow.style.display = 'flex';
      DOM.discountAmount.textContent = '−' + formatRupees(appliedCoupon.discount_amount);
    } else {
      DOM.discountRow.style.display = 'none';
    }

    DOM.totalAmount.textContent = formatRupees(final);
    DOM.payBtn.textContent = final === 0 ? 'Claim for free' : `Pay ${formatRupees(final)}`;
  }

  function formatRupees(paise) {
    return '₹' + (paise / 100).toLocaleString('en-IN');
  }

  function wireEvents() {
    DOM.couponApply.addEventListener('click', applyCoupon);
    DOM.couponInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
    });
    DOM.couponRemove.addEventListener('click', removeCoupon);
    DOM.payBtn.addEventListener('click', pay);
  }

  async function applyCoupon() {
    const code = DOM.couponInput.value.trim();
    if (!code) return;

    DOM.couponApply.disabled = true;
    DOM.couponApply.textContent = 'Checking…';
    DOM.couponMsg.style.display = 'none';

    try {
      const payload = type === 'subscription'
        ? { code, type, plan, billing_cycle: cycle }
        : { code, type, item_id: itemId };

      const res = await API.validateCoupon(payload);
      appliedCoupon = { code, ...res.data };

      DOM.couponInput.style.display = 'none';
      DOM.couponApply.style.display = 'none';
      DOM.couponApplied.style.display = 'flex';
      DOM.couponApplied.querySelector('.coupon-code-label').textContent = code.toUpperCase();
      renderAmounts();
    } catch (err) {
      DOM.couponMsg.textContent = err.message || 'That code didn\'t work.';
      DOM.couponMsg.style.display = 'block';
    } finally {
      DOM.couponApply.disabled = false;
      DOM.couponApply.textContent = 'Apply';
    }
  }

  function removeCoupon() {
    appliedCoupon = null;
    DOM.couponInput.value = '';
    DOM.couponInput.style.display = '';
    DOM.couponApply.style.display = '';
    DOM.couponApplied.style.display = 'none';
    DOM.couponMsg.style.display = 'none';
    renderAmounts();
  }

  async function pay() {
    const original = DOM.payBtn.textContent;
    DOM.payBtn.disabled = true;
    DOM.payBtn.textContent = 'Opening checkout…';

    try {
      const couponCode = appliedCoupon ? appliedCoupon.code : undefined;

      // Every field the server needs to compute the REAL price already
      // lives in its own database (plan pricing table / item price column /
      // coupon row) — this call sends only identifiers, never amounts.
      const res = type === 'subscription'
        ? await API.createSubscriptionCheckout(plan, cycle, couponCode)
        : await API.createItemCheckout(itemId, couponCode);

      // A 100%-off coupon is granted directly server-side — no order,
      // nothing for Razorpay to do.
      if (res.data.free) {
        DOM.payBtn.textContent = 'Done';
        if (type === 'subscription') {
          Subscription.clearCache();
          UI.showToast(`Welcome to ${Subscription.planLabel(plan)}.`, 'success');
          setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        } else {
          UI.showToast('Added to your collection.', 'success');
          setTimeout(() => { window.location.href = 'marketplace.html'; }, 1000);
        }
        return;
      }

      const order = res.data;
      await Subscription.loadRazorpay();
      const user = await Auth.getUser();

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,        // this is the server's number, not ours
        currency: order.currency,
        name: 'Folio',
        description: type === 'subscription'
          ? `${Subscription.planLabel(plan)} — ${cycle}`
          : order.item.name,
        order_id: order.order_id,
        prefill: { name: user?.username || '', email: user?.email || '' },
        theme: { color: '#64745D' },
        modal: {
          ondismiss: () => { DOM.payBtn.disabled = false; DOM.payBtn.textContent = original; }
        },
        handler: async (response) => {
          DOM.payBtn.textContent = 'Verifying…';
          try {
            const verifyPayload = {
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature
            };

            if (type === 'subscription') {
              await API.verifySubscriptionPayment(verifyPayload);
              Subscription.clearCache();
              UI.showToast(`Welcome to ${Subscription.planLabel(plan)}.`, 'success');
              setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
            } else {
              await API.verifyItemPurchase(itemId, verifyPayload);
              UI.showToast('Purchased — added to your collection.', 'success');
              setTimeout(() => { window.location.href = 'marketplace.html'; }, 1000);
            }
          } catch (err) {
            UI.showToast(err.message || 'Could not verify your payment.', 'error');
            DOM.payBtn.disabled = false;
            DOM.payBtn.textContent = original;
          }
        }
      });

      rzp.on('payment.failed', (resp) => {
        UI.showToast(resp?.error?.description || 'Payment failed.', 'error');
        DOM.payBtn.disabled = false;
        DOM.payBtn.textContent = original;
      });

      rzp.open();
    } catch (err) {
      UI.showToast(err.message || 'Could not start checkout.', 'error');
      DOM.payBtn.disabled = false;
      DOM.payBtn.textContent = original;
    }
  }

  return { init };
})();
