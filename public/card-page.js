/* ============================================================
   ME COIN — card-page.js  (the /c/:id page)
   Buy box (pay-what-you-want), live stats + sales feed,
   owner panel (onboard / delist), share, report, PNG.
   window.__CARD__ is injected by the Worker (ARCHITECTURE §5.1).
   Requires cardart.js (window.MECOIN).
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN;
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    var data = window.__CARD__;
    if (!data || !data.id) {
      M.byId('notfound').hidden = false;
      return;
    }
    M.byId('card-main').hidden = false;

    var card = data;                 // reassigned by refresh()
    var manageKey = M.keyFor(card.id);

    /* ---- the flip card ---- */
    var view = M.createCard({});
    M.byId('card-stage').appendChild(view.el);

    /* ---- header text (textContent only — never innerHTML with user data) ---- */
    M.byId('cp-kicker').textContent = '/// CARD ' + card.id.toUpperCase();
    M.byId('cp-name').textContent = card.name;
    var tagEl = M.byId('cp-tagline');
    if (card.tagline) { tagEl.textContent = '“' + card.tagline + '”'; }
    else { tagEl.hidden = true; }

    /* ---- buy box elements ---- */
    var amtIn = M.byId('amt');
    var buyBtn = M.byId('buy-btn');
    var buyErr = M.byId('buy-err');

    /* quick-price chips ($1 / $5 / $20) + CUSTOM */
    var chipsEl = M.byId('chips');
    M.QUICK_CHIPS_CENTS.forEach(function (cents) {
      var b = M.el('button', 'chip', '$' + (cents / 100));
      b.type = 'button';
      b.addEventListener('click', function () {
        amtIn.value = String(cents / 100);
        markChip(b);
        clearBuyErr();
      });
      chipsEl.appendChild(b);
    });
    var custom = M.el('button', 'chip', 'CUSTOM');
    custom.type = 'button';
    custom.addEventListener('click', function () {
      markChip(null);
      amtIn.value = '';
      amtIn.focus();
      clearBuyErr();
    });
    chipsEl.appendChild(custom);

    function markChip(active) {
      var all = chipsEl.querySelectorAll('.chip');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('sel', all[i] === active);
    }
    amtIn.addEventListener('input', function () { markChip(null); clearBuyErr(); });

    function showBuyErr(msg) { buyErr.textContent = msg; buyErr.hidden = false; }
    function clearBuyErr() { buyErr.hidden = true; }

    /* ---- render state from `card` ---- */
    function render() {
      var remaining = card.supply - card.sold;
      var soldOut = card.sold >= card.supply;
      var onboarded = !!card.onboarded;

      view.set({
        name: card.name, tagline: card.tagline, photo: card.photo,
        supply: card.supply, serial: null
      });
      view.setSoldOut(soldOut, { label: 'SOLD OUT' });

      M.byId('st-last').textContent = M.fmtUSD(card.stats.last_paid_cents);
      M.byId('st-avg').textContent = M.fmtUSD(card.stats.avg_paid_cents);
      M.byId('st-raised').textContent = M.fmtUSD(card.stats.total_raised_cents);
      M.byId('st-left').textContent = remaining + ' / ' + card.supply;

      M.byId('soldout').hidden = !soldOut;
      M.byId('buybox').hidden = !(onboarded && !soldOut);
      M.byId('nfs').hidden = !(!onboarded && !soldOut);

      if (manageKey) renderOwner();
    }

    /* ---- buy: pay-what-you-want ---- */
    buyBtn.addEventListener('click', function () {
      clearBuyErr();
      var raw = String(amtIn.value).replace(/[$,\s]/g, '');
      var dollars = parseFloat(raw);
      if (!isFinite(dollars) || dollars <= 0) {
        showBuyErr('type a number. any number. naming the price is the whole point.');
        amtIn.focus();
        return;
      }
      var cents = Math.round(dollars * 100);
      if (cents < M.AMOUNT_MIN_CENTS) { showBuyErr("minimum is $0.50 — Stripe won't move less. blame physics, not us."); return; }
      if (cents > M.AMOUNT_MAX_CENTS) { showBuyErr('ceiling is $999,999.99. dream slightly smaller.'); return; }

      buyBtn.disabled = true;
      buyBtn.textContent = 'OPENING CHECKOUT…';
      M.post('/api/checkout', { card_id: card.id, amount_cents: cents }).then(function (r) {
        buyBtn.textContent = 'REDIRECTING…';
        location.href = r.url;
      }).catch(function (err) {
        buyBtn.disabled = false;
        buyBtn.textContent = 'NAME YOUR PRICE';
        showBuyErr(err.message || 'checkout failed — try again.');
        if (err.status === 409) refresh(); // sold out / delisted in the meantime
      });
    });

    /* ---- owner panel (onboard / delist) ---- */
    function renderOwner() {
      var ownerEl = M.byId('owner');
      ownerEl.hidden = false;
      var status = M.byId('own-status');
      var actions = M.byId('owner-actions');
      actions.textContent = '';

      if (card.onboarded) {
        status.textContent = '✓ LISTED FOR REAL SALE';
        status.className = 'own-status ok';
      } else {
        status.textContent = 'NOT LISTED — buyers can’t pay yet';
        status.className = 'own-status no';
        var sell = M.el('button', 'btn', 'SELL FOR REAL');
        sell.type = 'button';
        sell.addEventListener('click', function () { startOnboard(sell); });
        actions.appendChild(sell);
      }

      var delist = M.el('button', 'btn btn-ghost', 'DELIST (HIDE FOREVER)');
      delist.type = 'button';
      delist.addEventListener('click', function () { doDelist(delist); });
      actions.appendChild(delist);
    }

    function ownerErr(msg) {
      var e = M.byId('owner-err');
      e.textContent = msg; e.hidden = false;
    }

    function startOnboard(btn) {
      M.byId('owner-err').hidden = true;
      btn.disabled = true;
      btn.textContent = 'SETTING UP…';
      M.post('/api/onboard', { card_id: card.id, manage_key: manageKey }).then(function (r) {
        if (r.status === 'redirect' && r.url) { location.href = r.url; return; }
        // demo (or already onboarded): instant
        btn.textContent = 'LISTED ✓';
        refresh();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'SELL FOR REAL';
        ownerErr(err.message || 'onboarding failed — try again.');
      });
    }

    function doDelist(btn) {
      if (!window.confirm('Delist this card? It vanishes from every page and cannot be undone.')) return;
      M.byId('owner-err').hidden = true;
      btn.disabled = true;
      btn.textContent = 'HIDING…';
      M.post('/api/delist', { card_id: card.id, manage_key: manageKey }).then(function () {
        location.href = '/';
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'DELIST (HIDE FOREVER)';
        ownerErr(err.message || 'delist failed — try again.');
      });
    }

    /* on return from Stripe onboarding, poll once to flip the listing on */
    var params = new URLSearchParams(location.search);
    if (manageKey && params.get('onboard') === 'return') {
      M.post('/api/onboard', { card_id: card.id, manage_key: manageKey }).then(function (r) {
        if (r.status === 'redirect' && r.url) { /* still incomplete — leave a hint */ ownerErr('Onboarding isn’t finished yet. Click SELL FOR REAL to resume.'); }
        else refresh();
      }).catch(function () {});
    }

    /* ---- share / PNG / report ---- */
    M.byId('share-btn').addEventListener('click', function () {
      var url = location.origin + '/c/' + card.id;
      var btn = M.byId('share-btn');
      copyText(url).then(function (ok) {
        var prev = 'COPY SHARE LINK';
        btn.textContent = ok ? 'COPIED ✓' : 'COPY FAILED';
        setTimeout(function () { btn.textContent = prev; }, 1600);
      });
    });

    M.byId('png-btn').addEventListener('click', function () {
      var btn = M.byId('png-btn');
      btn.disabled = true; btn.textContent = 'RENDERING…';
      M.downloadPNG({
        name: card.name, tagline: card.tagline, photo: card.photo,
        supply: card.supply, serial: null
      }).then(done).catch(done);
      function done() { btn.disabled = false; btn.textContent = 'DOWNLOAD PNG'; }
    });

    M.byId('report-link').addEventListener('click', function (e) {
      e.preventDefault();
      var link = e.currentTarget;
      var reason = window.prompt('Report this card. What’s wrong? (impersonation, harassment, stolen photo, etc.)');
      if (reason === null) return;
      reason = reason.trim();
      if (!reason) return;
      M.post('/api/report', { card_id: card.id, reason: reason.slice(0, M.REASON_MAX) }).then(function () {
        link.textContent = '✓ Reported — thanks. We review every report.';
      }).catch(function (err) {
        link.textContent = '⚑ Report failed: ' + (err.message || 'try again');
      });
    });

    /* ---- live sales feed ---- */
    var feedEl = M.byId('sales-feed');
    function loadSales() {
      M.api('/api/card/' + card.id + '/sales').then(function (r) {
        var sales = (r && r.sales) || [];
        M.byId('sales-wrap').hidden = false;
        feedEl.textContent = '';
        if (!sales.length) {
          var empty = M.el('div', 'feed-empty fine', 'No real sales yet. Be the first to name a price.');
          feedEl.appendChild(empty);
          return;
        }
        sales.forEach(function (s) {
          M.feedLine(feedEl, {
            tag: M.fmtSerial(s.serial, card.supply),
            cls: 'buy', quiet: true, max: 20,
            text: 'paid ' + M.fmtUSD(s.amount_cents) + ' · ' + M.relTime(s.created_at)
          });
        });
      }).catch(function () {});
    }

    /* ---- refresh card json (stats, sold, onboarded) ---- */
    function refresh() {
      M.api('/api/card/' + card.id).then(function (r) {
        if (r && r.id) { card = r; render(); }
      }).catch(function () {});
    }

    /* ---- boot ---- */
    render();
    loadSales();
    setInterval(function () {
      if (!document.hidden) { refresh(); loadSales(); }
    }, 5000);
  }

  /* clipboard with a legacy fallback → Promise<boolean> */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(text); });
    }
    return Promise.resolve(legacy(text));
  }
  function legacy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
})();
