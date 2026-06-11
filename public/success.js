/* ============================================================
   ME COIN — success.js  (the /success?session=... page)
   window.__SALE__ injected by the Worker (ARCHITECTURE §5.2):
     { status:'complete', serial, amount_cents, card:{...} }
   or { status:'pending', session_id }.
   Pending → poll GET /api/sale/:session_id every 2s up to 90s.
   Requires cardart.js (window.MECOIN).
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN;
  var POLL_MS = 2000;
  var MAX_MS = 90000;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    var sale = window.__SALE__;
    if (!sale || (sale.status !== 'complete' && sale.status !== 'pending')) {
      // opened without server injection (e.g. /success.html direct) — treat as stale.
      showStale();
      return;
    }
    if (sale.status === 'complete') { showComplete(sale); return; }

    // pending: poll until complete or timeout
    showPending();
    var sessionId = sale.session_id;
    if (!sessionId) { showStale(); return; }
    var started = Date.now();

    function poll() {
      M.api('/api/sale/' + encodeURIComponent(sessionId)).then(function (r) {
        if (r && r.status === 'complete') { showComplete(r); return; }
        if (Date.now() - started >= MAX_MS) { showStale(); return; }
        setTimeout(poll, POLL_MS);
      }).catch(function () {
        if (Date.now() - started >= MAX_MS) { showStale(); return; }
        setTimeout(poll, POLL_MS);
      });
    }
    setTimeout(poll, POLL_MS);
  }

  function showPending() {
    M.byId('pending').hidden = false;
    M.byId('complete').hidden = true;
    M.byId('stale').hidden = true;
  }

  function showStale() {
    M.byId('stale').hidden = false;
    M.byId('pending').hidden = true;
    M.byId('complete').hidden = true;
  }

  function showComplete(sale) {
    var card = sale.card;
    M.byId('pending').hidden = true;
    M.byId('stale').hidden = true;
    M.byId('complete').hidden = false;

    if (!card || !card.id) { showStale(); return; }

    M.byId('serial').textContent = M.fmtSerial(sale.serial, card.supply);
    M.byId('paid-line').textContent =
      'You paid ' + M.fmtUSD(sale.amount_cents) + ' for ' + card.name +
      ' — copy ' + M.fmtSerial(sale.serial, card.supply) + '. Numbered, witnessed, final. Congratulations, probably.';

    /* mint CTAs from a success page carry attribution back to this card */
    document.querySelectorAll('a[href="/#builder"]').forEach(function (a) {
      a.href = '/?via=' + card.id + '#builder';
    });

    var view = M.createCard({});
    M.byId('card-stage').appendChild(view.el);
    view.set({
      name: card.name, tagline: card.tagline, photo: card.photo,
      supply: card.supply, serial: sale.serial
    });

    M.byId('view-link').href = '/c/' + card.id;

    M.byId('png-btn').addEventListener('click', function () {
      var btn = M.byId('png-btn');
      btn.disabled = true;
      var prev = btn.textContent;
      btn.textContent = 'RENDERING…';
      M.downloadPNG({
        name: card.name, tagline: card.tagline, photo: card.photo,
        supply: card.supply, serial: sale.serial
      }).then(done).catch(done);
      function done() { btn.disabled = false; btn.textContent = prev; }
    });
  }
})();
