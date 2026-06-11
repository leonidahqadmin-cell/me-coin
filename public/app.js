/* ============================================================
   ME COIN — app.js (home / builder page)
   The card builder, photo press, scarcity dial, the SIM MARKET
   game loop (band rules per SPEC), mint flow, recent gallery.
   Requires cardart.js (window.MECOIN).
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN;
  var SIM_POOL = 1000000;          /* $1,000,000 imaginary pie */
  var SIM_PRICE_MIN = 0.01;
  var SIM_PRICE_MAX = 1e13;        /* $10T */

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    /* ---------- elements ---------- */
    var nameIn = M.byId('name');
    var nameCount = M.byId('name-count');
    var tagIn = M.byId('tagline');
    var tagCount = M.byId('tagline-count');
    var photoIn = M.byId('photo');
    var photoMeta = M.byId('photo-meta');
    var dropzone = M.byId('dropzone');
    var supplyIn = M.byId('supply');
    var supplyNum = M.byId('supply-num');
    var priceIn = M.byId('simprice');
    var priceRead = M.byId('simprice-read');
    var mintBtn = M.byId('mint-btn');
    var mintErr = M.byId('mint-err');
    var feedEl = M.byId('sim-feed');
    var moodEl = M.byId('sim-mood');
    var simPriceEl = M.byId('sim-price');
    var floorIn = M.byId('floor');
    var floorRead = M.byId('floor-read');

    var card = M.createCard({});
    M.byId('card-stage').appendChild(card.el);

    var vpcRoll = M.makeRoller(M.byId('vpc'));
    var leftRoll = M.makeRoller(M.byId('sim-left'));
    var raisedRoll = M.makeRoller(M.byId('sim-raised'));

    /* ---------- state ---------- */
    var state = {
      name: '',
      tagline: '',
      photo: null,
      supply: 100,
      simPrice: 10,
      floorCents: 1000
    };

    function renderCard() {
      card.set({
        name: state.name || 'YOUR NAME',
        tagline: state.tagline || 'limited. like my patience.',
        photo: state.photo,
        supply: state.supply,
        serial: null
      });
    }

    function vpcCents() {
      return Math.round((SIM_POOL / state.supply) * 100);
    }

    function renderVpc() {
      vpcRoll.set(M.fmtUSD(vpcCents()));
    }

    /* ---------- name / tagline ---------- */
    nameIn.addEventListener('input', function () {
      state.name = nameIn.value.slice(0, M.NAME_MAX);
      nameCount.textContent = state.name.length + '/' + M.NAME_MAX;
      renderCard();
    });
    tagIn.addEventListener('input', function () {
      state.tagline = tagIn.value.slice(0, M.TAGLINE_MAX);
      tagCount.textContent = state.tagline.length + '/' + M.TAGLINE_MAX;
      renderCard();
    });

    /* ---------- photo: client-side press to <=700px JPEG ---------- */
    function pressPhoto(file) {
      return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) {
          reject(new Error('that is not an image. the press only takes images.'));
          return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) throw new Error('unreadable image');
            var out = encodeAt(img, w, h, 700, 0.85);
            /* shrink harder until it fits the 500 KB dataURL cap */
            var quality = 0.85;
            while (out.length > M.PHOTO_MAX_CHARS && quality > 0.35) {
              quality -= 0.15;
              out = encodeAt(img, w, h, 700, quality);
            }
            if (out.length > M.PHOTO_MAX_CHARS) out = encodeAt(img, w, h, 480, 0.7);
            if (out.length > M.PHOTO_MAX_CHARS) out = encodeAt(img, w, h, 360, 0.6);
            URL.revokeObjectURL(url);
            if (out.length > M.PHOTO_MAX_CHARS) {
              reject(new Error('that image refuses to compress. try a different one.'));
            } else {
              resolve(out);
            }
          } catch (err) {
            URL.revokeObjectURL(url);
            reject(err);
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("couldn't decode that image — try a plain JPG or PNG."));
        };
        img.src = url;
      });
    }

    function encodeAt(img, w, h, maxDim, quality) {
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#101016'; /* flatten transparency onto ink */
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return c.toDataURL('image/jpeg', quality);
    }

    function handleFile(file) {
      photoMeta.textContent = 'PRESSING…';
      pressPhoto(file).then(function (dataURL) {
        state.photo = dataURL;
        photoMeta.textContent = Math.round(dataURL.length / 1024) + ' KB FOIL-READY';
        dropzone.classList.add('has-photo');
        hideErr();
        renderCard();
      }).catch(function (err) {
        state.photo = null;
        photoMeta.textContent = 'NO FILE';
        dropzone.classList.remove('has-photo');
        showErr(err.message);
        renderCard();
      });
    }

    photoIn.addEventListener('change', function () {
      if (photoIn.files && photoIn.files[0]) handleFile(photoIn.files[0]);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    /* ---------- supply dial ---------- */
    function setSupply(v, fromSlider) {
      v = Math.round(Number(v));
      if (isNaN(v)) v = M.SUPPLY_MIN;
      v = Math.min(M.SUPPLY_MAX, Math.max(M.SUPPLY_MIN, v));
      state.supply = v;
      if (!fromSlider) supplyIn.value = String(v);
      supplyNum.value = String(v);
      renderCard();
      renderVpc();
      simReset(false);
    }
    supplyIn.addEventListener('input', function () { setSupply(supplyIn.value, true); });
    supplyNum.addEventListener('change', function () { setSupply(supplyNum.value, false); });

    /* ---------- sim price ---------- */
    function parseSimPrice(raw) {
      var m = String(raw || '').trim()
        .replace(/^\$/, '').replace(/,/g, '')
        .match(/^(\d*\.?\d+)\s*([kmbt])?$/i);
      if (!m) return null;
      var v = parseFloat(m[1]);
      var mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] || '').toLowerCase()] || 1;
      v *= mult;
      if (!isFinite(v)) return null;
      return Math.min(SIM_PRICE_MAX, Math.max(SIM_PRICE_MIN, v));
    }

    function setSimPrice() {
      var v = parseSimPrice(priceIn.value);
      if (v === null) {
        priceRead.textContent = '??? — type a number';
        return;
      }
      state.simPrice = v;
      priceRead.textContent = M.fmtCompactUSD(v);
      simPriceEl.textContent = M.fmtCompactUSD(v);
      renderMood();
    }
    priceIn.addEventListener('input', setSimPrice);

    /* ---------- floor price ---------- */
    function setFloor() {
      var raw = String(floorIn.value || '').replace(/[$,\s]/g, '');
      var dollars = parseFloat(raw);
      if (!isFinite(dollars) || dollars < 0.5) {
        floorRead.textContent = 'min $0.50';
        state.floorCents = 50;
        return;
      }
      var cents = Math.min(99999999, Math.max(50, Math.round(dollars * 100)));
      state.floorCents = cents;
      floorRead.textContent = M.fmtUSD(cents);
    }
    floorIn.addEventListener('input', setFloor);

    /* ============================================================
       SIM MARKET — the game loop (client-side only, 0% real)
       fair = $1,000,000 / supply ;  r = simPrice / fair
       r <= 1.5        : frenzy   — frequent buys, hype
       1.5 < r <= 100  : mixed    — occasional buys, skepticism, lowballs
       r > 100         : hostile  — near-zero buys, mockery, rare ironic whale
       ============================================================ */
    var SIM = { left: 100, raised: 0, timer: null, soldOut: false, started: false };

    var FIRST = ['xX_', '', '', '', 'lil_', 'DJ_', '0x', 'yung_', 'dr_', 'avg_', 'certified_', 'her_majesty_'];
    var CORE = ['HODLgoblin', 'moonrat', 'gasfee', 'rugwatch', 'fomo', 'alphaleak', 'degen',
      'bagholder', 'candlestick', 'wagmi', 'apefather', 'shrimp', 'whalebait', 'pumpkin',
      'chartgazer', 'liquidity', 'mintcondition', 'foilhunter', 'slabber', 'breakroom'];
    var LAST = ['_69', '420', '_eth', '2000', '_irl', 'XL', '_dao', '9000', '.exe', '_Xx', '', '', '_jr'];

    function fakeUser() {
      return FIRST[(Math.random() * FIRST.length) | 0] +
        CORE[(Math.random() * CORE.length) | 0] +
        LAST[(Math.random() * LAST.length) | 0];
    }

    var HYPE_CHATTER = [
      '"this is the floor. SCREENSHOT ME."',
      '"undervalued. generationally."',
      '"I was early. you will all see."',
      '"fair value is a myth but this is below it"',
      '"told my group chat. they\'re coming."',
      '"do NOT tell my wife about this one"',
      '"set it as my phone wallpaper already"',
      '"the supply dial alone is worth the price"'
    ];
    var MIXED_CHATTER = [
      '"at {p}? in this economy?"',
      'offers $0.03 — offer ignored',
      '"I\'d pay half that, and I\'m being generous"',
      'is "watching the chart" (there is no chart)',
      '"hmm. hmmmm. hm."',
      'lowballs: "{p}? I\'ll give you a firm handshake"',
      'added to cart. removed from cart. added again.',
      '"need to ask my financial advisor (my cat)"'
    ];
    var MOCK_CHATTER = [
      '"{p}??? for a JPEG of a PERSON???"',
      'screenshotted this for the group chat',
      '"sir, this is not the Louvre"',
      'laughed in 4 currencies',
      '"the audacity IS the product at this point"',
      'reported this to the imaginary SEC',
      '"I\'ve seen confidence. THIS is performance art."',
      '"my landlord wants {p} too. he\'s also dreaming."'
    ];
    var HYPE_BUYS = [
      'bought {q} without reading anything',
      'market-bought {q} — "thank me later"',
      'bought {q}. hands: diamond. plan: none.',
      'swept {q} off the floor',
      'bought {q} "for the culture"'
    ];
    var MIXED_BUYS = [
      'bought 1 — "don\'t make it weird"',
      'caved and bought 1 after 20 minutes of hovering',
      'bought 1 "as a joke" (the receipt is real)',
      'bought 1 to win an argument'
    ];
    var WHALE_BUYS = [
      '(whale) bought 1 "ironically" — the money was real to them',
      '(whale) bought 1. did not blink. did not explain.'
    ];

    function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
    function fill(t, q) {
      return t.replace('{p}', M.fmtCompactUSD(state.simPrice)).replace('{q}', String(q || 1));
    }

    function bandOf() {
      var r = state.simPrice / (SIM_POOL / state.supply);
      if (r <= 1.5) return 'hype';
      if (r <= 100) return 'mixed';
      return 'mock';
    }

    function renderMood() {
      var b = bandOf();
      moodEl.textContent = b === 'hype' ? 'FRENZY' : b === 'mixed' ? 'SUSPICIOUS' : 'OPENLY HOSTILE';
      moodEl.className = 'val ' + (b === 'hype' ? 'acid' : b === 'mixed' ? 'cyan' : 'heat');
    }

    function renderSimStats() {
      leftRoll.set(String(SIM.left));
      var raised = SIM.raised;
      raisedRoll.set(raised >= 1e6 ? M.fmtCompactUSD(raised) : M.fmtUSD(Math.round(raised * 100)));
    }

    function simReset(announce) {
      SIM.left = state.supply;
      SIM.raised = 0;
      SIM.soldOut = false;
      card.setSoldOut(false);
      renderSimStats();
      renderMood();
      if (announce) {
        M.feedLine(feedEl, {
          tag: 'PRESS', cls: 'sys',
          text: 'NEW SIM BATCH PRESSED — ' + state.supply + ' UNITS AT ' + M.fmtCompactUSD(state.simPrice)
        });
      }
    }

    function schedule() {
      clearTimeout(SIM.timer);
      var b = bandOf();
      var range = b === 'hype' ? [700, 1700] : b === 'mixed' ? [1400, 3200] : [1900, 4200];
      SIM.timer = setTimeout(tick, range[0] + Math.random() * (range[1] - range[0]));
    }

    function tick() {
      if (document.hidden || SIM.soldOut) { schedule(); return; }
      var b = bandOf();
      var buyP = b === 'hype' ? 0.78 : b === 'mixed' ? 0.22 : 0.03;
      if (Math.random() < buyP && SIM.left > 0) {
        simBuy(b);
      } else {
        var pool = b === 'hype' ? HYPE_CHATTER : b === 'mixed' ? MIXED_CHATTER : MOCK_CHATTER;
        M.feedLine(feedEl, {
          tag: fakeUser(),
          cls: b === 'mock' ? 'mock' : '',
          text: fill(pick(pool))
        });
      }
      schedule();
    }

    function simBuy(b) {
      var qty = 1;
      if (b === 'hype' && Math.random() < 0.4) qty = 1 + ((Math.random() * 3) | 0);
      qty = Math.min(qty, SIM.left);
      SIM.left -= qty;
      SIM.raised += state.simPrice * qty;
      var msg = b === 'mock' ? pick(WHALE_BUYS) : b === 'hype' ? pick(HYPE_BUYS) : pick(MIXED_BUYS);
      M.feedLine(feedEl, {
        tag: fakeUser(),
        cls: 'buy',
        text: fill(msg, qty) + ' — ' + M.fmtCompactUSD(state.simPrice * qty)
      });
      renderSimStats();
      if (SIM.left <= 0) simSoldOut();
    }

    function simSoldOut() {
      SIM.soldOut = true;
      clearTimeout(SIM.timer);
      card.setSoldOut(true, { label: 'SIM SOLD OUT', slam: true });
      M.feedLine(feedEl, {
        tag: 'MARKET', cls: 'sys',
        text: 'SIM SUPPLY EXHAUSTED — ' + state.supply + ' UNITS GONE. TOTAL: ' +
          M.fmtCompactUSD(SIM.raised) + '. THE HALLUCINATION HELD.'
      });
      setTimeout(function () {
        simReset(true);
        schedule();
      }, 4200);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && SIM.started) schedule();
    });

    /* ---------- mint ---------- */
    function showErr(msg) {
      mintErr.textContent = msg;
      mintErr.hidden = false;
    }
    function hideErr() { mintErr.hidden = true; }

    mintBtn.addEventListener('click', function () {
      hideErr();
      var name = state.name.trim();
      if (!name) { showErr('the card needs a name. yours, ideally.'); nameIn.focus(); return; }
      if (name.length > M.NAME_MAX) { showErr('name caps at ' + M.NAME_MAX + ' characters.'); return; }
      if (!state.photo) { showErr('no asset loaded. upload your face — the foil needs something to shine on.'); return; }
      var tagline = state.tagline.trim().slice(0, M.TAGLINE_MAX);
      if (!(state.supply >= M.SUPPLY_MIN && state.supply <= M.SUPPLY_MAX)) {
        showErr('supply must be 1–1000.');
        return;
      }
      var floorCents = state.floorCents;
      if (!floorCents || floorCents < 50 || floorCents > 99999999) {
        showErr('floor price must be at least $0.50.');
        floorIn.focus();
        return;
      }

      mintBtn.disabled = true;
      mintBtn.textContent = 'PRESSING THE FOIL…';
      M.post('/api/cards', {
        name: name,
        tagline: tagline,
        photo: state.photo,
        supply: state.supply,
        price_floor_cents: floorCents
      }).then(function (r) {
        M.saveKey(r.id, r.manage_key, name);
        mintBtn.textContent = 'MINTED. REDIRECTING…';
        location.href = '/c/' + r.id;
      }).catch(function (err) {
        mintBtn.disabled = false;
        mintBtn.textContent = "MINT ME — IT'S FREE";
        if (err.status === 429) {
          showErr('Easy, machine. ' + err.message + ' — even scarcity needs scarcity.');
        } else {
          showErr(err.message || 'mint failed. the press jammed. try again.');
        }
      });
    });

    /* ---------- recent gallery ---------- */
    function loadGallery() {
      M.api('/api/cards/recent').then(function (r) {
        var cards = (r && r.cards) || [];
        var grid = M.byId('gallery');
        var empty = M.byId('gallery-empty');
        grid.textContent = '';
        if (!cards.length) { empty.hidden = false; return; }
        empty.hidden = true;
        cards.forEach(function (c) {
          var a = M.el('a', 'slab');
          a.href = '/c/' + encodeURIComponent(c.id);
          var frame = M.el('span', 'slab-frame');
          var box = M.el('span', 'slab-imgbox');
          if (c.photo && /^data:image\//.test(c.photo)) {
            var img = document.createElement('img');
            img.src = c.photo;
            img.alt = '';
            img.loading = 'lazy';
            box.appendChild(img);
          }
          frame.appendChild(box);
          a.appendChild(frame);
          a.appendChild(M.el('span', 'slab-name', c.name));
          var meta = M.el('span', 'slab-meta');
          var soldN = M.el('span', 'sold-n', String(c.sold));
          meta.appendChild(soldN);
          meta.appendChild(document.createTextNode('/' + c.supply + ' sold — ' + M.relTime(c.created_at)));
          a.appendChild(meta);
          grid.appendChild(a);
        });
      }).catch(function () {
        M.byId('gallery-empty').hidden = false;
      });
    }

    /* ---------- boot ---------- */
    nameCount.textContent = '0/' + M.NAME_MAX;
    tagCount.textContent = '0/' + M.TAGLINE_MAX;
    renderCard();
    renderVpc();
    setSimPrice();
    setFloor();
    simReset(false);
    M.feedLine(feedEl, {
      tag: 'MARKET', cls: 'sys', quiet: true,
      text: 'SIM MARKET OPEN — these people are not real. the math is.'
    });
    SIM.started = true;
    schedule();
    loadGallery();
  }
})();
