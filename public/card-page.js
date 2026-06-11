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
    var mode = null;                 // 'real' | 'demo' | null (unknown until config loads)

    /* ---- the flip card ---- */
    var view = M.createCard({});
    M.byId('card-stage').appendChild(view.el);

    /* ---- header text (textContent only — never innerHTML with user data) ---- */
    M.byId('cp-kicker').textContent = '/// CARD ' + card.id.toUpperCase();
    M.byId('cp-name').textContent = card.name;
    if (card.attestation && card.attestation !== 'self') {
      M.byId('cp-name').appendChild(
        M.el('span', 'att-badge', card.attestation === 'parody' ? 'PARODY' : 'FAN TRIBUTE')
      );
    }
    var tagEl = M.byId('cp-tagline');
    if (card.tagline) { tagEl.textContent = '“' + card.tagline + '”'; }
    else { tagEl.hidden = true; }

    /* every mint CTA on this page carries attribution back to this card */
    document.querySelectorAll('a[href="/#builder"]').forEach(function (a) {
      a.href = '/?via=' + card.id + '#builder';
    });

    /* price bounds: creator floor (never under the platform min) and the
       launch cap ($100/sale while a card is under a week old, $500 after) */
    function effFloor() {
      return Math.max(card.price_floor_cents || M.AMOUNT_MIN_CENTS, M.AMOUNT_MIN_CENTS);
    }
    function capCents() {
      var base = (Date.now() - card.created_at < M.YOUNG_CARD_MS)
        ? M.YOUNG_CARD_CAP_CENTS : M.LAUNCH_PRICE_CAP_CENTS;
      // paying the creator's floor is always allowed (no floor/cap deadlock)
      return Math.max(base, effFloor());
    }

    /* ---- buy box elements ---- */
    var amtIn = M.byId('amt');
    var buyBtn = M.byId('buy-btn');
    var buyErr = M.byId('buy-err');

    /* quick-price chips (floor / 2× / 5×, clamped to the cap) + CUSTOM */
    var chipsEl = M.byId('chips');
    var chipSeen = {};
    [effFloor(), effFloor() * 2, effFloor() * 5].forEach(function (cents) {
      cents = Math.min(cents, capCents());
      if (chipSeen[cents]) return;
      chipSeen[cents] = true;
      var b = M.el('button', 'chip', M.fmtUSD(cents));
      b.type = 'button';
      b.addEventListener('click', function () {
        amtIn.value = String(cents / 100);
        markChip(b);
        clearBuyErr();
        renderNetLine();
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
    amtIn.addEventListener('input', function () { markChip(null); clearBuyErr(); renderNetLine(); });

    function showBuyErr(msg) { buyErr.textContent = msg; buyErr.hidden = false; }
    function clearBuyErr() { buyErr.hidden = true; }

    /* live fee transparency under the amount field */
    function renderNetLine() {
      var fine = M.byId('buy-fine');
      var base = 'Pay the floor (' + M.fmtUSD(effFloor()) + ') or more — launch cap ' + M.fmtUSD(capCents()) + ' per sale.';
      var dollars = parseFloat(String(amtIn.value).replace(/[$,\s]/g, ''));
      if (isFinite(dollars) && dollars > 0) {
        var cents = Math.round(dollars * 100);
        if (cents >= effFloor() && cents <= capCents()) {
          base += ' ' + card.name + ' receives ' + M.fmtUSD(cents - M.feeCents(cents)) + ' of this.';
        }
      }
      fine.textContent = base;
    }

    /* ---- render state from `card` ---- */
    function render() {
      var remaining = card.supply - card.sold;
      var soldOut = card.sold >= card.supply;
      var onboarded = !!card.onboarded;
      // In real mode, unreviewed cards silently 409 at checkout — surface that here.
      var pendingReview = (mode === 'real' && !card.reviewed && !soldOut);

      view.set({
        name: card.name, tagline: card.tagline, photo: card.photo,
        supply: card.supply, serial: null,
        stats: { floor_cents: card.price_floor_cents, avg_paid_cents: card.stats.avg_paid_cents, high_paid_cents: card.stats.high_paid_cents }
      });
      view.setSoldOut(soldOut);

      M.byId('st-floor').textContent = M.fmtUSD(card.price_floor_cents);
      M.byId('st-avg').textContent = M.fmtUSD(card.stats.avg_paid_cents);
      M.byId('st-high').textContent = M.fmtUSD(card.stats.high_paid_cents);
      M.byId('st-left').textContent = remaining + ' / ' + card.supply;

      M.byId('soldout').hidden = !soldOut;
      M.byId('pending-review').hidden = !pendingReview;
      if (pendingReview && manageKey) {
        M.byId('pending-review-fine').textContent = 'Your card is waiting for photo review. Once approved, the BUY button goes live.';
      }
      M.byId('buybox').hidden = !(onboarded && !soldOut && !pendingReview);
      M.byId('nfs').hidden = !(!onboarded && !soldOut && !pendingReview);
      if (!onboarded && !soldOut && !pendingReview) {
        M.byId('nfs-fine').textContent = manageKey
          ? 'Payouts aren\'t connected, so the BUY button is off and shares lead to a dead end. Hit SELL FOR REAL below to finish setup.'
          : 'The owner hasn\'t connected payouts yet, so this card can\'t take money. Check back — or mint your own.';
      }
      renderNetLine();

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
      if (cents < effFloor()) { showBuyErr('minimum is ' + M.fmtUSD(effFloor()) + ' — that\'s the floor the creator set.'); return; }
      if (cents > capCents()) { showBuyErr('launch cap is ' + M.fmtUSD(capCents()) + ' per sale' + (capCents() === M.YOUNG_CARD_CAP_CENTS ? ' while a card is under a week old.' : '.')); return; }

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
        if (mode === 'real' && !card.reviewed) {
          status.textContent = '⏳ LISTED — pending photo review';
          status.className = 'own-status wait';
        } else {
          status.textContent = '✓ LISTED FOR REAL SALE';
          status.className = 'own-status ok';
        }
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
    // Fetch mode once; re-render so review gate reflects real vs. demo.
    M.api('/api/config').then(function (cfg) {
      var m = cfg && cfg.mode;
      if (m !== mode) { mode = m; render(); }
    }).catch(function () {});
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
