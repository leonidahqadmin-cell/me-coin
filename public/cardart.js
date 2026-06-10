/* ============================================================
   ME COIN — cardart.js
   Shared kit: constants, helpers, API wrapper, demo-mode banner,
   the holo flip-card builder (tilt + flip + foil shimmer),
   rolling-digit counters, feed lines, confetti, and the
   600x840 @2x canvas PNG card renderer.
   Plain script — defines window.MECOIN. No frameworks.
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN = window.MECOIN || {};

  /* ---- shared constants (mirror of src/constants.js, ARCHITECTURE §2) ---- */
  M.AMOUNT_MIN_CENTS = 50;          /* $0.50 — Stripe hard minimum */
  M.AMOUNT_MAX_CENTS = 99999999;    /* $999,999.99 */
  M.SUPPLY_MIN = 1;
  M.SUPPLY_MAX = 1000;
  M.NAME_MAX = 40;
  M.TAGLINE_MAX = 100;
  M.REASON_MAX = 300;
  M.PHOTO_MAX_CHARS = 512000;
  M.QUICK_CHIPS_CENTS = [100, 500, 2000];

  M.REDUCED = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var HOLO_COLORS = ['#21e6e6', '#ff2d87', '#c8ff00', '#ffd75e', '#21e6e6'];

  /* ================= tiny DOM helpers ================= */
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

  /* compact sim-money formatter: $0.01 .. $10T -> "$4.20", "$4.2K", "$10T" */
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
    if (v >= 1e9) return neg + '$' + trim(v / 1e9) + 'B';
    if (v >= 1e6) return neg + '$' + trim(v / 1e6) + 'M';
    if (v >= 1e3) return neg + '$' + trim(v / 1e3) + 'K';
    if (v >= 100) return neg + '$' + Math.round(v).toLocaleString('en-US');
    return neg + '$' + v.toFixed(2);
  };

  /* serial format per ARCHITECTURE §2: #001/100, #0042/1000 */
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

  /* ================= API wrapper (error shape: {"error": "..."}) ================= */
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

  /* ================= manage-key storage =================
     Contract key:   localStorage['mecoin_key_<id>'] = manage_key
     Convenience:    localStorage['mecoin_cards'] = [{id, manage_key, name}] */
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
    } catch (e) { /* private mode etc. — mint still works, owner tools won't */ }
  };

  /* ================= demo-mode banner (every page) ================= */
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
    var strips = [];
    var cur = null;

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
        if (strips[i]) {
          strips[i].style.transform = 'translateY(-' + Number(str[i]) + 'em)';
        }
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

  /* ================= holo confetti burst ================= */
  M.confetti = function (host, n) {
    if (M.REDUCED) return;
    n = n || 56;
    for (var i = 0; i < n; i++) {
      var p = M.el('span', 'confetti');
      p.style.background = HOLO_COLORS[i % HOLO_COLORS.length];
      p.style.setProperty('--tx', (Math.random() * 520 - 260).toFixed(0) + 'px');
      p.style.setProperty('--ty', (Math.random() * -480 - 40).toFixed(0) + 'px');
      p.style.setProperty('--rot', (Math.random() * 900 - 450).toFixed(0) + 'deg');
      p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      host.appendChild(p);
      (function (node) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1700);
      })(p);
    }
  };

  /* ================= the flip card =================
     createCard() -> { el, set(data), setSoldOut(on, opts), flip(force) }
     data: { name, tagline, photo (dataURL|null), supply, serial (int|null) } */
  M.createCard = function (opts) {
    opts = opts || {};
    var stage = M.el('div', 'card-stage');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('role', 'button');
    stage.setAttribute('aria-label', 'Trading card. Activate to flip.');
    var tilt = M.el('div', 'card-tilt');
    var flip = M.el('div', 'card-flip');

    /* ----- FRONT ----- */
    var front = M.el('div', 'card-face front');
    var fcard = M.el('div', 'tcard');
    fcard.appendChild(M.el('div', 'holo-spin'));
    var inner = M.el('div', 'tcard-inner');

    var head = M.el('div', 'tc-head');
    head.appendChild(M.el('span', 'tc-brand', 'ME COIN'));
    head.appendChild(M.el('span', 'tc-series', 'LIMITED MINT'));
    inner.appendChild(head);

    var photoBox = M.el('div', 'tc-photo');
    var img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.hidden = true;
    var phEmpty = M.el('div', 'ph-empty');
    phEmpty.appendChild(M.el('span', null, 'NO ASSET LOADED'));
    phEmpty.appendChild(M.el('span', null, '— UPLOAD YOUR FACE —'));
    photoBox.appendChild(img);
    photoBox.appendChild(phEmpty);
    inner.appendChild(photoBox);

    var nameEl = M.el('div', 'tc-name', 'YOUR NAME');
    var tagEl = M.el('div', 'tc-tag', '');
    inner.appendChild(nameEl);
    inner.appendChild(tagEl);

    var bottom = M.el('div', 'tc-bottom');
    var supplyChip = M.el('span', 'tc-supply', '1 OF 100');
    var serialChip = M.el('span', 'holo-chip');
    var serialText = M.el('span', null, 'UNNUMBERED');
    serialChip.appendChild(serialText);
    var seal = M.el('span', 'tc-seal', 'MC');
    seal.title = 'ME COIN certified hologram';
    bottom.appendChild(supplyChip);
    bottom.appendChild(serialChip);
    bottom.appendChild(seal);
    inner.appendChild(bottom);

    fcard.appendChild(inner);
    fcard.appendChild(M.el('div', 'tc-shine'));

    var stampLayer = M.el('div', 'stamp-layer');
    var stamp = M.el('div', 'stamp', 'SOLD OUT');
    stampLayer.appendChild(stamp);
    fcard.appendChild(stampLayer);
    front.appendChild(fcard);

    /* ----- BACK: CERTIFICATE OF SELF-WORTH ----- */
    var back = M.el('div', 'card-face back');
    var bcard = M.el('div', 'tcard');
    bcard.appendChild(M.el('div', 'holo-spin'));
    var binner = M.el('div', 'tc-back-inner');
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
    var seal2 = M.el('span', 'tc-seal', 'MC');
    stampRow.appendChild(seal2);
    binner.appendChild(stampRow);

    binner.appendChild(M.el('div', 'cert-barcode'));
    var certSerial = M.el('div', 'cert-serial', 'MECOIN·UNNUMBERED');
    binner.appendChild(certSerial);

    bcard.appendChild(binner);
    bcard.appendChild(M.el('div', 'tc-shine'));
    back.appendChild(bcard);

    flip.appendChild(front);
    flip.appendChild(back);
    tilt.appendChild(flip);
    stage.appendChild(tilt);

    /* ----- interactivity: flip on click / Enter / Space ----- */
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

    /* ----- tilt + foil shimmer (pointer-tracked) ----- */
    if (!M.REDUCED && opts.tilt !== false) {
      var raf = 0;
      var faces = [fcard, bcard];
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        var py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          tilt.style.transform =
            'rotateX(' + ((0.5 - py) * 12).toFixed(2) + 'deg) ' +
            'rotateY(' + ((px - 0.5) * 16).toFixed(2) + 'deg)';
          for (var i = 0; i < faces.length; i++) {
            faces[i].style.setProperty('--mx', (px * 100).toFixed(1) + '%');
            faces[i].style.setProperty('--my', (py * 100).toFixed(1) + '%');
          }
        });
      });
      stage.addEventListener('pointerleave', function () {
        tilt.style.transform = '';
      });
    }

    /* ----- state ----- */
    var supportsCQ = (window.CSS && CSS.supports && CSS.supports('font-size', '1cqw'));

    function set(data) {
      data = data || {};
      var name = String(data.name || 'YOUR NAME');
      nameEl.textContent = name;
      certName.textContent = name.toUpperCase();
      /* shrink long names */
      var L = name.length;
      var cq = L > 30 ? 3.4 : L > 22 ? 3.9 : L > 15 ? 4.5 : L > 9 ? 5.0 : 5.6;
      var px = L > 30 ? 13 : L > 22 ? 15 : L > 15 ? 17 : L > 9 ? 19 : 22;
      nameEl.style.fontSize = supportsCQ ? (cq + 'cqw') : (px + 'px');

      tagEl.textContent = String(data.tagline || '');

      var photo = data.photo || null;
      if (photo && /^data:image\//.test(photo)) {
        img.src = photo;
        img.hidden = false;
        phEmpty.style.display = 'none';
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        phEmpty.style.display = '';
      }

      var supply = data.supply || 1;
      supplyChip.textContent = '1 OF ' + supply;
      if (data.serial) {
        serialText.textContent = M.fmtSerial(data.serial, supply);
        certSerial.textContent = 'MECOIN·' + M.fmtSerial(data.serial, supply);
      } else {
        serialText.textContent = 'UNNUMBERED';
        certSerial.textContent = 'MECOIN·PROOF·' + supply;
      }
    }

    function setSoldOut(on, o) {
      o = o || {};
      stamp.textContent = o.label || 'SOLD OUT';
      if (on) {
        stampLayer.classList.add('on');
        if (o.slam && !M.REDUCED) {
          stamp.classList.remove('slam');
          /* force reflow so the animation can replay */
          void stamp.offsetWidth;
          stamp.classList.add('slam');
          stage.classList.remove('shake');
          void stage.offsetWidth;
          stage.classList.add('shake');
          M.confetti(stage);
        }
      } else {
        stampLayer.classList.remove('on');
        stamp.classList.remove('slam');
      }
    }

    return { el: stage, set: set, setSoldOut: setSoldOut, flip: doFlip };
  };

  /* ================= canvas PNG renderer (600x840 @2x) ================= */

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function holoGradient(ctx, w, h) {
    if (typeof ctx.createConicGradient === 'function') {
      var g = ctx.createConicGradient(-Math.PI / 2, w / 2, h / 2);
      g.addColorStop(0.00, '#21e6e6');
      g.addColorStop(0.25, '#ff2d87');
      g.addColorStop(0.50, '#c8ff00');
      g.addColorStop(0.75, '#ffd75e');
      g.addColorStop(1.00, '#21e6e6');
      return g;
    }
    var lg = ctx.createLinearGradient(0, 0, w, h);
    lg.addColorStop(0.00, '#21e6e6');
    lg.addColorStop(0.30, '#ff2d87');
    lg.addColorStop(0.60, '#c8ff00');
    lg.addColorStop(0.85, '#ffd75e');
    lg.addColorStop(1.00, '#21e6e6');
    return lg;
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

  function fitText(ctx, text, family, weight, maxSize, minSize, maxWidth) {
    var size = maxSize;
    while (size > minSize) {
      ctx.font = weight + ' ' + size + 'px ' + family;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 3;
    }
    ctx.font = weight + ' ' + size + 'px ' + family;
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

  /* data: { name, tagline, photo, supply, serial (int|null) } -> Promise<canvas> */
  M.renderCardPNG = function (data) {
    var W = 1200, H = 1680;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var fontsReady = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      fontsReady = Promise.all([
        document.fonts.load('900 90px "Unbounded"'),
        document.fonts.load('700 40px "IBM Plex Mono"'),
        document.fonts.load('italic 400 34px "IBM Plex Mono"')
      ]).catch(function () {});
    }

    return Promise.all([fontsReady, loadImage(data.photo)]).then(function (res) {
      var photo = res[1];
      var name = String(data.name || 'YOUR NAME').toUpperCase();
      var tagline = String(data.tagline || '');
      var supply = data.supply || 1;
      var serial = data.serial || null;

      /* --- holo frame --- */
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      roundRectPath(ctx, 0, 0, W, H, 16);
      ctx.fillStyle = holoGradient(ctx, W, H);
      ctx.fill();

      /* --- inner slab --- */
      roundRectPath(ctx, 26, 26, W - 52, H - 52, 10);
      ctx.fillStyle = '#101016';
      ctx.fill();

      /* --- head row --- */
      try { ctx.letterSpacing = '4px'; } catch (e) {}
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#c8ff00';
      ctx.font = '900 34px "Unbounded", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('ME COIN', 72, 102);
      ctx.fillStyle = '#21e6e6';
      ctx.font = '500 22px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right';
      try { ctx.letterSpacing = '8px'; } catch (e) {}
      ctx.fillText('LIMITED MINT', W - 72, 100);
      try { ctx.letterSpacing = '0px'; } catch (e) {}

      /* --- photo window --- */
      var px = 72, py = 132, pw = W - 144, ph = 1010;
      ctx.save();
      roundRectPath(ctx, px, py, pw, ph, 8);
      ctx.clip();
      ctx.fillStyle = '#070709';
      ctx.fillRect(px, py, pw, ph);
      if (photo) {
        drawCover(ctx, photo, px, py, pw, ph);
      } else {
        ctx.fillStyle = 'rgba(244,241,228,.3)';
        ctx.font = '500 26px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('NO ASSET LOADED', px + pw / 2, py + ph / 2);
      }
      ctx.restore();
      /* inner cyan glow on the window */
      ctx.save();
      roundRectPath(ctx, px, py, pw, ph, 8);
      ctx.strokeStyle = 'rgba(33,230,230,.45)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(33,230,230,.5)';
      ctx.shadowBlur = 30;
      ctx.stroke();
      ctx.restore();

      /* --- name --- */
      ctx.fillStyle = '#f4f1e4';
      ctx.textAlign = 'left';
      fitText(ctx, name, '"Unbounded", sans-serif', '900', 84, 36, pw);
      ctx.fillText(name, 72, 1248);

      /* --- tagline (max 2 lines) --- */
      ctx.font = 'italic 400 33px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(244,241,228,.72)';
      var lines = wrapTwoLines(ctx, tagline, pw);
      for (var li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], 72, 1306 + li * 46);
      }

      /* --- dashed divider --- */
      ctx.save();
      ctx.strokeStyle = 'rgba(244,241,228,.25)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(72, 1414);
      ctx.lineTo(W - 72, 1414);
      ctx.stroke();
      ctx.restore();

      /* --- supply chip (left) --- */
      var chipText = '1 OF ' + supply;
      ctx.font = '700 30px "IBM Plex Mono", monospace';
      var chipW = ctx.measureText(chipText).width + 40;
      ctx.fillStyle = '#c8ff00';
      ctx.fillRect(72, 1448, chipW, 56);
      ctx.fillStyle = '#000';
      ctx.fillText(chipText, 92, 1487);

      /* --- holo seal (right) --- */
      var sealX = W - 138, sealY = 1494, sealR = 62;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sealX, sealY, sealR, 0, Math.PI * 2);
      ctx.fillStyle = holoGradient(ctx, W, H);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sealX, sealY, sealR - 12, 0, Math.PI * 2);
      ctx.fillStyle = '#101016';
      ctx.fill();
      ctx.fillStyle = '#f4f1e4';
      ctx.font = '900 30px "Unbounded", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MC', sealX, 1505);
      ctx.restore();

      /* --- serial (center, the hero number) --- */
      ctx.textAlign = 'center';
      if (serial) {
        ctx.fillStyle = '#c8ff00';
        ctx.font = '700 78px "IBM Plex Mono", monospace';
        ctx.shadowColor = 'rgba(200,255,0,.5)';
        ctx.shadowBlur = 26;
        ctx.fillText(M.fmtSerial(serial, supply), W / 2, 1590);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#21e6e6';
        ctx.font = '700 44px "IBM Plex Mono", monospace';
        try { ctx.letterSpacing = '10px'; } catch (e) {}
        ctx.fillText('UNNUMBERED PROOF', W / 2, 1578);
        try { ctx.letterSpacing = '0px'; } catch (e) {}
      }

      /* --- footer micro-line --- */
      ctx.fillStyle = 'rgba(244,241,228,.4)';
      ctx.font = '400 19px "IBM Plex Mono", monospace';
      ctx.fillText('CERTIFICATE OF SELF-WORTH · MECOIN HUMAN ASSET REGISTRY', W / 2, 1636);

      /* --- scanlines + grain for the holo vibe --- */
      ctx.fillStyle = 'rgba(0,0,0,.07)';
      for (var y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
      ctx.fillStyle = 'rgba(255,255,255,.04)';
      for (var g = 0; g < 1700; g++) {
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }

      return canvas;
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
