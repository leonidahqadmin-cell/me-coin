/* ============================================================
   ME COIN — demo-pay.js  (the /demo-pay?session=... page, DEMO mode)
   window.__DEMO__ injected by the Worker (ARCHITECTURE §5.3):
     { session_id, amount_cents, card:{...} }
   Confirm → POST /api/demo-pay/confirm → location.href = /success?...
   (calls the SAME fulfillSale() the real webhook uses).
   Requires cardart.js (window.MECOIN).
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN;
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    var demo = window.__DEMO__;
    if (!demo || !demo.session_id || !demo.card || !demo.card.id) {
      M.byId('notfound').hidden = false;
      return;
    }
    M.byId('paybox').hidden = false;

    var card = demo.card;

    M.byId('pay-name').textContent = card.name;
    M.byId('pay-id').textContent = 'CARD ' + card.id.toUpperCase() +
      ' · ' + (card.supply - card.sold) + ' of ' + card.supply + ' left';
    M.byId('pay-amount').textContent = M.fmtUSD(demo.amount_cents);

    var thumb = M.byId('pay-thumb');
    if (card.photo && /^data:image\//.test(card.photo)) thumb.src = card.photo;
    else thumb.removeAttribute('src');

    M.byId('cancel-link').setAttribute('href', '/c/' + card.id);

    var btn = M.byId('confirm-btn');
    var errEl = M.byId('pay-err');
    btn.addEventListener('click', function () {
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'PROCESSING…';
      M.post('/api/demo-pay/confirm', { session_id: demo.session_id }).then(function (r) {
        btn.textContent = 'CONFIRMED — REDIRECTING…';
        location.href = r.url;
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'CONFIRM — SIMULATE PAYMENT';
        errEl.textContent = err.message || 'something broke. try again.';
        errEl.hidden = false;
      });
    });
  }
})();
