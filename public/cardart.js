/* ============================================================
   ME COIN — cardart.js
   Shared kit: constants, helpers, API wrapper, demo banner,
   clean flip-card builder (tilt + flip), rolling counters,
   feed lines, confetti, and canvas PNG renderer.
   Plain script — defines window.MECOIN. No frameworks.
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN = window.MECOIN || {};

  /* ---- constants (mirror of src/constants.js) ---- */
  M.AMOUNT_MIN_CENTS = 100;
  M.AMOUNT_MAX_CENTS = 99999999;
  M.LAUNCH_PRICE_CAP_CENTS = 50000;
  M.YOUNG_CARD_CAP_CENTS = 10000;
  M.YOUNG_CARD_MS = 7 * 86400000;
  M.SUPPLY_MIN = 1;
  M.SUPPLY_MAX = 1000;
  M.NAME_MAX = 40;
  M.TAGLINE_MAX = 100;
  M.REASON_MAX = 300;
  M.PHOTO_MAX_CHARS = 512000;
  M.OG_MAX_CHARS = 307200;
  M.QUICK_CHIPS_CENTS = [100, 500, 2000];

  /* additive platform fee: $0.30 + 10%, never above the amount */
  M.feeCents = function (amountCents) {
    return Math.min(amountCents, 30 + Math.round(amountCents * 0.10));
  };

  M.REDUCED = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var CONFETTI_COLORS = ['#c8a462', '#e8e8e8', '#34d399', '#60a5fa', '#f59e0b'];

  /* ================= DOM helpers ================= */
  M.byId = function (id) { return document.getElementById(id); };

  M.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  /* ================= formatting ================= */
  M.fmtUSD = function (cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '—';
    return '$' + (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };

  M.fmtCompactUSD = function (dollars) {
    if (dollars === null || dollars === undefined || isNaN(dollars)) return '—';
    var neg = dollars < 0 ? '-' : '';
    var v = Math.abs(dollars);
    function trim(x) {
      if (x >= 100) return Math.round(x).toLocaleString('en-US');
      var s = x >= 10 ? x.toFixed(1) : x.toFixed(2);
      return s.replace(/\.?0+$/, '');
    }
    if (v >= 1e12) return neg + '$' + trim(v / 1e12) + 'T';
    if (v >= 1e9)  return neg + '$' + trim(v / 1e9)  + 'B';
    if (v >= 1e6)  return neg + '$' + trim(v / 1e6)  + 'M';
    if (v >= 1e3)  return neg + '$' + trim(v / 1e3)  + 'K';
    if (v >= 100)  return neg + '$' + Math.round(v).toLocaleString('en-US');
    return neg + '$' + v.toFixed(2);
  };

  M.fmtSerial = function (serial, supply) {
    return '#' + String(serial).padStart(Math.max(3, String(supply).length), '0') +
      '/' + supply;
  };

  M.slugify = function (name) {
    return (String(name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')) || 'card';
  };

  M.relTime = function (ms) {
    var d = Date.now() - ms;
    if (d < 0) d = 0;
    var s = Math.floor(d / 1000);
    if (s < 45) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24);
    if (days < 30) return days + 'd ago';
    return Math.floor(days / 30) + 'mo ago';
  };

  /* ================= API wrapper ================= */
  M.api = function (path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) {
          var err = new Error((body && body.error) ? body.error : ('request failed (' + r.status + ')'));
          err.status = r.status;
          throw err;
        }
        return body;
      });
    });
  };

  M.post = function (path, data) {
    return M.api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  };

  /* ================= manage-key storage ================= */
  M.keyFor = function (cardId) {
    try { return localStorage.getItem('mecoin_key_' + cardId); }
    catch (e) { return null; }
  };

  M.saveKey = function (cardId, manageKey, name) {
    try {
      localStorage.setItem('mecoin_key_' + cardId, manageKey);
      var list = [];
      try { list = JSON.parse(localStorage.getItem('mecoin_cards') || '[]'); }
      catch (e2) { list = []; }
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (c) { return c && c.id !== cardId; });
      list.unshift({ id: cardId, manage_key: manageKey, name: String(name || '') });
      localStorage.setItem('mecoin_cards', JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
  };

  /* ================= demo banner ================= */
  M.config = (typeof fetch === 'function')
    ? fetch('/api/config').then(function (r) {
        return r.ok ? r.json() : { mode: null };
      }).catch(function () { return { mode: null }; })
    : Promise.resolve({ mode: null });

  function bootBanner() {
    M.config.then(function (cfg) {
      M.mode = cfg ? cfg.mode : null;
      if (M.mode === 'demo' && !document.querySelector('.demo-banner')) {
        var b = M.el('div', 'demo-banner',
          'DEMO MODE — payments are simulated. No real money moves.');
        document.body.prepend(b);
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBanner);
  } else {
    bootBanner();
  }

  /* ================= rolling digit counters ================= */
  M.makeRoller = function (host) {
    host.classList.add('roll');
    var strips = [], cur = null;

    function rebuild(str) {
      host.textContent = '';
      strips = [];
      for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        if (/\d/.test(ch)) {
          var col = M.el('span', 'rcol');
          var strip = M.el('span', 'rstrip');
          for (var d = 0; d < 10; d++) strip.appendChild(M.el('span', null, d));
          col.appendChild(strip);
          host.appendChild(col);
          strips.push(strip);
        } else {
          host.appendChild(M.el('span', 'rchr', ch));
          strips.push(null);
        }
      }
    }

    function set(value) {
      var str = String(value);
      if (str === cur) return;
      var skel = str.replace(/\d/g, '0');
      if (cur === null || skel !== cur.replace(/\d/g, '0')) rebuild(str);
      for (var i = 0; i < str.length; i++) {
        if (strips[i]) strips[i].style.transform = 'translateY(-' + Number(str[i]) + 'em)';
      }
      cur = str;
    }

    return { set: set };
  };

  /* ================= feed lines ================= */
  M.feedLine = function (feedEl, opts) {
    var line = M.el('div', 'feed-line' + (opts.cls ? ' ' + opts.cls : ''));
    line.appendChild(M.el('span', 'fl-tag', opts.tag || '·'));
    line.appendChild(M.el('span', 'fl-text', opts.text || ''));
    var prevNew = feedEl.querySelector('.feed-line.new');
    if (prevNew) prevNew.classList.remove('new');
    if (!opts.quiet) line.classList.add('new');
    feedEl.prepend(line);
    var max = opts.max || 9;
    while (feedEl.children.length > max) feedEl.removeChild(feedEl.lastChild);
    return line;
  };

  /* ================= confetti burst ================= */
  M.confetti = function (host, n) {
    if (M.REDUCED) return;
    n = n || 48;
    for (var i = 0; i < n; i++) {
      var p = M.el('span', 'confetti');
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      p.style.setProperty('--tx', (Math.random() * 480 - 240).toFixed(0) + 'px');
      p.style.setProperty('--ty', (Math.random() * -400 - 40).toFixed(0) + 'px');
      p.style.setProperty('--rot', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      host.appendChild(p);
      (function (node) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1500);
      })(p);
    }
  };

  /* ================= the flip card =================
     createCard() -> { el, set(data), setSoldOut(on, opts), flip(force) }
     data: {
       name, tagline, photo (dataURL|null), supply,
       serial (int|null),
       stats: { floor_cents, avg_paid_cents, high_paid_cents }
     } */
  M.createCard = function (opts) {
    opts = opts || {};
    var stage = M.el('div', 'mc-card');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('role', 'button');
    stage.setAttribute('aria-label', 'Trading card. Activate to flip.');

    var tilt = M.el('div', 'mc-tilt');
    var flip = M.el('div', 'mc-flip');

    /* ----- FRONT ----- */
    var front = M.el('div', 'mc-face mc-front');
    var fcard = M.el('div');

    fcard.appendChild(M.el('div', 'mc-strip'));

    var photoBox = M.el('div', 'mc-photo');
    var img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.hidden = true;
    var phEl = M.el('div', 'mc-ph');
    phEl.appendChild(M.el('span', null, 'Upload your photo'));
    photoBox.appendChild(img);
    photoBox.appendChild(phEl);
    fcard.appendChild(photoBox);

    var badgeEl = M.el('div', 'mc-badge', '/ 1');
    fcard.appendChild(badgeEl);

    var soldEl = M.el('div', 'mc-sold');
    var stampEl = M.el('div', 'mc-sold-stamp', 'SOLD OUT');
    soldEl.appendChild(stampEl);
    fcard.appendChild(soldEl);

    var infoEl = M.el('div', 'mc-info');
    var nameEl = M.el('div', 'mc-name', 'YOUR NAME');
    var tagEl = M.el('div', 'mc-tag', '');
    var statsEl = M.el('div', 'mc-stats');

    function mkStat(label) {
      var s = M.el('div', 'mc-stat');
      s.appendChild(M.el('span', 'mc-stat-l', label));
      var vEl = M.el('span', 'mc-stat-v', '—');
      s.appendChild(vEl);
      return { el: s, v: vEl };
    }
    var sFloor = mkStat('FLOOR');
    var sAvg   = mkStat('AVG');
    var sHigh  = mkStat('HIGH');
    statsEl.appendChild(sFloor.el);
    statsEl.appendChild(sAvg.el);
    statsEl.appendChild(sHigh.el);

    infoEl.appendChild(nameEl);
    infoEl.appendChild(tagEl);
    infoEl.appendChild(statsEl);
    fcard.appendChild(infoEl);
    front.appendChild(fcard);

    /* ----- BACK: certificate ----- */
    var back = M.el('div', 'mc-face mc-back');
    var bcard = M.el('div');
    bcard.appendChild(M.el('div', 'mc-strip'));

    var binner = M.el('div', 'mc-back-inner');
    binner.appendChild(M.el('div', 'cert-title', 'Certificate of Self-Worth'));
    binner.appendChild(M.el('div', 'cert-sub', 'ME COIN HUMAN ASSET REGISTRY'));
    binner.appendChild(M.el('hr', 'cert-rule'));

    var p1 = M.el('p', 'cert-text');
    p1.appendChild(document.createTextNode('This certifies that the BEARER has acquired one (1) numbered unit of '));
    var certName = M.el('b', null, 'THE UNDERSIGNED');
    p1.appendChild(certName);
    p1.appendChild(document.createTextNode(', a limited-edition human asset, in spirit and in JPEG only.'));
    binner.appendChild(p1);

    binner.appendChild(M.el('p', 'cert-text',
      'CLAUSE 1. Ownership confers no rights to the underlying person, their time, ' +
      'attention, affection, or group-chat membership. CLAUSE 2. Value is a group ' +
      'hallucination; the issuer makes no promise that anyone else will join it. ' +
      'CLAUSE 3. Supply was chosen by the asset themself, possibly at 3 A.M. ' +
      'CLAUSE 4. No refunds, except where the universe (or Stripe) requires one.'));
    binner.appendChild(M.el('p', 'cert-text',
      'CLAUSE 5. This card is a digital collectible for fun. It is not an investment, ' +
      'not a security, and not a store of value. No resale market is provided or ' +
      'promised. If you bought this expecting returns, please read CLAUSE 2 again, slowly.'));

    var stampRow = M.el('div', 'cert-stamp-row');
    stampRow.appendChild(M.el('span', 'cert-sig', 'authorized: the self-worth desk'));
    stampRow.appendChild(M.el('span', 'cert-seal', 'MC'));
    binner.appendChild(stampRow);
    binner.appendChild(M.el('div', 'cert-barcode'));
    var certSerial = M.el('div', 'cert-serial', 'MECOIN·UNNUMBERED');
    binner.appendChild(certSerial);

    bcard.appendChild(binner);
    back.appendChild(bcard);

    flip.appendChild(front);
    flip.appendChild(back);
    tilt.appendChild(flip);
    stage.appendChild(tilt);

    /* ----- flip interaction ----- */
    var canFlip = opts.flip !== false;
    function doFlip(force) {
      if (!canFlip) return;
      if (force === true) flip.classList.add('flipped');
      else if (force === false) flip.classList.remove('flipped');
      else flip.classList.toggle('flipped');
      stage.setAttribute('aria-pressed', flip.classList.contains('flipped') ? 'true' : 'false');
    }
    stage.addEventListener('click', function () { doFlip(); });
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doFlip(); }
    });

    /* ----- tilt on pointer move ----- */
    if (!M.REDUCED && opts.tilt !== false) {
      var raf = 0;
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        var py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          tilt.style.transform =
            'rotateX(' + ((0.5 - py) * 10).toFixed(2) + 'deg) ' +
            'rotateY(' + ((px - 0.5) * 14).toFixed(2) + 'deg)';
        });
      });
      stage.addEventListener('pointerleave', function () { tilt.style.transform = ''; });
    }

    var supportsCQ = !!(window.CSS && CSS.supports && CSS.supports('font-size', '1cqw'));

    /* ----- set(data) ----- */
    function set(data) {
      data = data || {};
      var name = String(data.name || 'YOUR NAME');
      nameEl.textContent = name;
      certName.textContent = name.toUpperCase();

      if (supportsCQ) {
        var L = name.length;
        var cq = L > 30 ? 3.8 : L > 22 ? 4.6 : L > 15 ? 5.2 : L > 9 ? 5.8 : 6.4;
        nameEl.style.fontSize = cq + 'cqw';
      }

      tagEl.textContent = String(data.tagline || '');

      var photo = data.photo || null;
      if (photo && /^data:image\//.test(photo)) {
        img.src = photo;
        img.hidden = false;
        phEl.style.display = 'none';
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        phEl.style.display = '';
      }

      var supply = data.supply || 1;
      if (data.serial) {
        badgeEl.textContent = M.fmtSerial(data.serial, supply);
        certSerial.textContent = 'MECOIN·' + M.fmtSerial(data.serial, supply);
      } else {
        badgeEl.textContent = '/ ' + supply;
        certSerial.textContent = 'MECOIN·PROOF·' + supply;
      }

      var st = data.stats || {};
      sFloor.v.textContent = st.floor_cents  != null ? M.fmtUSD(st.floor_cents)       : '—';
      sAvg.v.textContent   = st.avg_paid_cents  != null ? M.fmtUSD(st.avg_paid_cents)  : '—';
      sHigh.v.textContent  = st.high_paid_cents != null ? M.fmtUSD(st.high_paid_cents) : '—';
    }

    /* ----- setSoldOut(on, opts) ----- */
    function setSoldOut(on, o) {
      o = o || {};
      stampEl.textContent = o.label || 'SOLD OUT';
      if (on) {
        soldEl.classList.add('on');
        if (o.slam && !M.REDUCED) {
          stampEl.classList.remove('slam');
          void stampEl.offsetWidth;
          stampEl.classList.add('slam');
          stage.classList.remove('shake');
          void stage.offsetWidth;
          stage.classList.add('shake');
          M.confetti(stage);
        }
      } else {
        soldEl.classList.remove('on');
        stampEl.classList.remove('slam');
      }
    }

    return { el: stage, set: set, setSoldOut: setSoldOut, flip: doFlip };
  };

  /* ================= canvas PNG renderer (1200×1680 = 600×840 @2x) ================= */

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(ctx, image, x, y, w, h) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    var scale = Math.max(w / iw, h / ih);
    var sw = w / scale, sh = h / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function loadImage(dataURL) {
    return new Promise(function (resolve) {
      if (!dataURL) { resolve(null); return; }
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = function () { resolve(null); };
      i.src = dataURL;
    });
  }

  function fitText(ctx, text, maxSize, minSize, maxWidth) {
    var size = maxSize;
    while (size > minSize) {
      ctx.font = '700 ' + size + 'px "Inter", sans-serif';
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    ctx.font = '700 ' + size + 'px "Inter", sans-serif';
    return size;
  }

  function wrapTwoLines(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxWidth || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length === 2) break;
      }
    }
    if (cur && lines.length < 2) lines.push(cur);
    if (lines.length === 2) {
      while (ctx.measureText(lines[1] + '…').width > maxWidth && lines[1].length > 1) {
        lines[1] = lines[1].slice(0, -1);
      }
      if (words.join(' ') !== lines.join(' ')) lines[1] += '…';
    }
    return lines;
  }

  /* data: { name, tagline, photo, supply, serial, stats: { floor_cents, avg_paid_cents, high_paid_cents } }
     -> Promise<canvas> */
  M.renderCardPNG = function (data) {
    var W = 1200, H = 1680;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var fontsReady = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      fontsReady = Promise.all([
        document.fonts.load('700 80px "Inter"'),
        document.fonts.load('400 34px "Inter"'),
        document.fonts.load('600 28px "Inter"')
      ]).catch(function () {});
    }

    return Promise.all([fontsReady, loadImage(data.photo)]).then(function (res) {
      var photo = res[1];
      var name    = String(data.name || 'YOUR NAME');
      var tagline = String(data.tagline || '');
      var supply  = data.supply || 1;
      var serial  = data.serial || null;
      var st      = data.stats || {};

      /* card background */
      ctx.fillStyle = '#0d0d10';
      roundRectPath(ctx, 0, 0, W, H, 20);
      ctx.fill();

      /* metallic strip */
      var mGrad = ctx.createLinearGradient(0, 0, W, 0);
      mGrad.addColorStop(0,    '#5a5a5a');
      mGrad.addColorStop(0.18, '#c8a462');
      mGrad.addColorStop(0.34, '#e8d9b0');
      mGrad.addColorStop(0.50, '#c8a462');
      mGrad.addColorStop(0.66, '#9a8060');
      mGrad.addColorStop(0.82, '#c8a462');
      mGrad.addColorStop(1,    '#5a5a5a');
      ctx.fillStyle = mGrad;
      roundRectPath(ctx, 0, 0, W, 52, 20);
      ctx.fill();
      ctx.fillRect(0, 32, W, 20); /* square off strip bottom */

      /* photo area */
      var photoY = 52, photoH = 1110;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, photoY, W, photoH);
      ctx.clip();
      ctx.fillStyle = '#111114';
      ctx.fillRect(0, photoY, W, photoH);
      if (photo) {
        drawCover(ctx, photo, 0, photoY, W, photoH);
      } else {
        ctx.font = '400 32px "Inter", sans-serif';
        ctx.fillStyle = '#71717a';
        ctx.textAlign = 'center';
        ctx.fillText('No photo uploaded', W / 2, photoY + photoH / 2);
      }
      /* gradient fade at bottom of photo */
      var fadeGrad = ctx.createLinearGradient(0, photoY + photoH * 0.46, 0, photoY + photoH);
      fadeGrad.addColorStop(0,    'rgba(13,13,16,0)');
      fadeGrad.addColorStop(0.5,  'rgba(13,13,16,0.5)');
      fadeGrad.addColorStop(1,    'rgba(13,13,16,0.94)');
      ctx.fillStyle = fadeGrad;
      ctx.fillRect(0, photoY, W, photoH);
      ctx.restore();

      /* serial badge */
      var badgeText = serial ? M.fmtSerial(serial, supply) : '/ ' + supply;
      ctx.font = '600 26px "Inter", sans-serif';
      ctx.textBaseline = 'alphabetic';
      var bw = ctx.measureText(badgeText).width;
      var bpad = 14, by = 86, bh = 40;
      var bx = W - bw - bpad * 2 - 30;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      roundRectPath(ctx, bx, by - bh + 10, bw + bpad * 2, bh, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,164,98,0.5)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, bx, by - bh + 10, bw + bpad * 2, bh, 4);
      ctx.stroke();
      ctx.fillStyle = '#c8a462';
      ctx.textAlign = 'left';
      ctx.fillText(badgeText, bx + bpad, by);

      /* name */
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fafaf9';
      fitText(ctx, name, 96, 38, W - 100);
      ctx.fillText(name, 60, 1280);

      /* tagline */
      if (tagline) {
        ctx.font = '400 34px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(250,250,249,0.62)';
        var lines = wrapTwoLines(ctx, tagline, W - 120);
        for (var li = 0; li < lines.length; li++) {
          ctx.fillText(lines[li], 60, 1338 + li * 50);
        }
      }

      /* stats row */
      var stats = [
        { label: 'FLOOR', val: st.floor_cents      != null ? M.fmtUSD(st.floor_cents)       : '—' },
        { label: 'AVG',   val: st.avg_paid_cents    != null ? M.fmtUSD(st.avg_paid_cents)    : '—' },
        { label: 'HIGH',  val: st.high_paid_cents   != null ? M.fmtUSD(st.high_paid_cents)   : '—' }
      ];
      var statW = W / 3, statY = 1462, statH = 182;
      for (var si = 0; si < 3; si++) {
        ctx.fillStyle = 'rgba(10,10,11,0.82)';
        ctx.fillRect(si * statW + 1, statY, statW - 2, statH);
        if (si > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(si * statW, statY, 1, statH);
        }
        ctx.font = '500 22px "Inter", sans-serif';
        ctx.fillStyle = '#71717a';
        ctx.textAlign = 'center';
        ctx.fillText(stats[si].label, si * statW + statW / 2, statY + 46);
        ctx.font = '600 38px "Inter", sans-serif';
        ctx.fillStyle = si === 0 ? '#c8a462' : '#fafaf9';
        ctx.fillText(stats[si].val, si * statW + statW / 2, statY + 110);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, statY, W, statH);

      /* footer line */
      ctx.font = '400 20px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(113,113,122,0.65)';
      ctx.textAlign = 'center';
      ctx.fillText('ME COIN — Certificate of Self-Worth', W / 2, H - 24);

      return canvas;
    });
  };

  /* ================= OG unfurl renderer (1200×630 landscape) =================
     Shares should look like a trading card, not a raw selfie.
     data: { name, tagline, photo, supply, floor_cents } -> Promise<dataURL|null> */
  M.renderOgJPEG = function (data) {
    var W = 1200, H = 630;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var fontsReady = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      fontsReady = Promise.all([
        document.fonts.load('700 76px "Inter"'),
        document.fonts.load('400 30px "Inter"'),
        document.fonts.load('600 26px "Inter"')
      ]).catch(function () {});
    }

    return Promise.all([fontsReady, loadImage(data.photo)]).then(function (res) {
      var photo = res[1];
      var name = String(data.name || 'YOUR NAME');
      var tagline = String(data.tagline || '');
      var supply = data.supply || 1;

      /* background */
      ctx.fillStyle = '#0a0a0b';
      ctx.fillRect(0, 0, W, H);

      /* gold strip along the top */
      var mGrad = ctx.createLinearGradient(0, 0, W, 0);
      mGrad.addColorStop(0,    '#5a5a5a');
      mGrad.addColorStop(0.18, '#c8a462');
      mGrad.addColorStop(0.34, '#e8d9b0');
      mGrad.addColorStop(0.50, '#c8a462');
      mGrad.addColorStop(0.66, '#9a8060');
      mGrad.addColorStop(0.82, '#c8a462');
      mGrad.addColorStop(1,    '#5a5a5a');
      ctx.fillStyle = mGrad;
      ctx.fillRect(0, 0, W, 14);

      /* card art on the left — 5:7 mini-card with strip + photo */
      var cardX = 56, cardY = 54, cardW = 372, cardH = 521;
      ctx.save();
      roundRectPath(ctx, cardX, cardY, cardW, cardH, 14);
      ctx.clip();
      ctx.fillStyle = '#111114';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      if (photo) drawCover(ctx, photo, cardX, cardY, cardW, cardH);
      var fade = ctx.createLinearGradient(0, cardY + cardH * 0.55, 0, cardY + cardH);
      fade.addColorStop(0, 'rgba(13,13,16,0)');
      fade.addColorStop(1, 'rgba(13,13,16,0.92)');
      ctx.fillStyle = fade;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.fillStyle = mGrad;
      ctx.fillRect(cardX, cardY, cardW, 12);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, cardX, cardY, cardW, cardH, 14);
      ctx.stroke();

      /* supply badge on the mini-card */
      ctx.font = '600 22px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var badge = '/ ' + supply;
      var bw = ctx.measureText(badge).width;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      roundRectPath(ctx, cardX + cardW - bw - 44, cardY + 28, bw + 26, 36, 4);
      ctx.fill();
      ctx.fillStyle = '#c8a462';
      ctx.fillText(badge, cardX + cardW - bw - 31, cardY + 53);

      /* text block on the right */
      var tx = 490;
      ctx.fillStyle = '#71717a';
      ctx.font = '600 24px "Inter", sans-serif';
      ctx.fillText('ME COIN — NUMBERED HUMAN, LIMITED RUN', tx, 130);

      ctx.fillStyle = '#fafaf9';
      var size = 84;
      while (size > 34) {
        ctx.font = '700 ' + size + 'px "Inter", sans-serif';
        if (ctx.measureText(name).width <= W - tx - 56) break;
        size -= 4;
      }
      ctx.fillText(name, tx, 150 + size);

      if (tagline) {
        ctx.font = '400 30px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(250,250,249,0.66)';
        var lines = wrapTwoLines(ctx, tagline, W - tx - 56);
        for (var li = 0; li < lines.length; li++) {
          ctx.fillText(lines[li], tx, 196 + size + li * 42);
        }
      }

      /* floor + supply row */
      var rowY = 470;
      ctx.font = '500 22px "Inter", sans-serif';
      ctx.fillStyle = '#71717a';
      ctx.fillText('FLOOR', tx, rowY);
      ctx.fillText('SUPPLY', tx + 260, rowY);
      ctx.font = '700 44px "Inter", sans-serif';
      ctx.fillStyle = '#c8a462';
      ctx.fillText(data.floor_cents != null ? M.fmtUSD(data.floor_cents) : '—', tx, rowY + 52);
      ctx.fillStyle = '#fafaf9';
      ctx.fillText(String(supply) + ' copies', tx + 260, rowY + 52);

      ctx.font = '400 20px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(113,113,122,0.8)';
      ctx.fillText('name your price — floor or above', tx, rowY + 96);

      var out = canvas.toDataURL('image/jpeg', 0.82);
      if (out.length > M.OG_MAX_CHARS) out = canvas.toDataURL('image/jpeg', 0.6);
      return out.length <= M.OG_MAX_CHARS ? out : null;
    });
  };

  M.downloadPNG = function (data) {
    return M.renderCardPNG(data).then(function (canvas) {
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'mecoin-' + M.slugify(data.name) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  };
})();
