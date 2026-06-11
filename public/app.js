/* ============================================================
   ME COIN — app.js (home / builder page)
   The card builder: photo press, scarcity dial, floor price +
   net-payout math, attestations, mint flow (with OG unfurl
   render + ?via attribution + immediate payout onboarding),
   and the recent gallery.
   Requires cardart.js (window.MECOIN).
   ============================================================ */
(function () {
  'use strict';

  var M = window.MECOIN;

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
    var mintBtn = M.byId('mint-btn');
    var mintErr = M.byId('mint-err');
    var floorIn = M.byId('floor');
    var floorRead = M.byId('floor-read');
    var adultCheck = M.byId('adult-check');

    var card = M.createCard({});
    M.byId('card-stage').appendChild(card.el);

    var netRoll = M.makeRoller(M.byId('net-read'));

    /* ---------- state ---------- */
    var state = {
      name: '',
      tagline: '',
      photo: null,
      supply: 100,
      floorCents: 1000
    };

    /* ?via=<card_id> — referral attribution for measurable share chains */
    var via = new URLSearchParams(location.search).get('via');
    if (!(typeof via === 'string' && /^[a-z0-9]{10}$/.test(via))) via = null;

    function renderCard() {
      card.set({
        name: state.name || 'YOUR NAME',
        tagline: state.tagline || 'limited. like my patience.',
        photo: state.photo,
        supply: state.supply,
        serial: null,
        stats: { floor_cents: state.floorCents }
      });
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
        photoMeta.textContent = Math.round(dataURL.length / 1024) + ' KB PRESS-READY';
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
    }
    supplyIn.addEventListener('input', function () { setSupply(supplyIn.value, true); });
    supplyNum.addEventListener('change', function () { setSupply(supplyNum.value, false); });

    /* ---------- floor price + net payout ---------- */
    function renderNet() {
      netRoll.set(M.fmtUSD(state.floorCents - M.feeCents(state.floorCents)));
    }

    function setFloor() {
      var raw = String(floorIn.value || '').replace(/[$,\s]/g, '');
      var dollars = parseFloat(raw);
      if (!isFinite(dollars) || dollars < M.AMOUNT_MIN_CENTS / 100) {
        floorRead.textContent = 'min ' + M.fmtUSD(M.AMOUNT_MIN_CENTS);
        state.floorCents = M.AMOUNT_MIN_CENTS;
        renderNet();
        renderCard();
        return;
      }
      var cents = Math.min(M.LAUNCH_PRICE_CAP_CENTS, Math.max(M.AMOUNT_MIN_CENTS, Math.round(dollars * 100)));
      state.floorCents = cents;
      floorRead.textContent = M.fmtUSD(cents);
      renderNet();
      renderCard();
    }
    floorIn.addEventListener('input', setFloor);

    /* ---------- mint ---------- */
    function showErr(msg) {
      mintErr.textContent = msg;
      mintErr.hidden = false;
    }
    function hideErr() { mintErr.hidden = true; }

    function attestation() {
      var checked = document.querySelector('input[name="att"]:checked');
      return checked ? checked.value : 'self';
    }

    mintBtn.addEventListener('click', function () {
      hideErr();
      var name = state.name.trim();
      if (!name) { showErr('the card needs a name. yours, ideally.'); nameIn.focus(); return; }
      if (name.length > M.NAME_MAX) { showErr('name caps at ' + M.NAME_MAX + ' characters.'); return; }
      if (!state.photo) { showErr('no asset loaded. upload your face — the card needs something to shine on.'); return; }
      var tagline = state.tagline.trim().slice(0, M.TAGLINE_MAX);
      if (!(state.supply >= M.SUPPLY_MIN && state.supply <= M.SUPPLY_MAX)) {
        showErr('supply must be 1–1000.');
        return;
      }
      var floorCents = state.floorCents;
      if (!floorCents || floorCents < M.AMOUNT_MIN_CENTS || floorCents > M.LAUNCH_PRICE_CAP_CENTS) {
        showErr('floor price must be between ' + M.fmtUSD(M.AMOUNT_MIN_CENTS) + ' and ' + M.fmtUSD(M.LAUNCH_PRICE_CAP_CENTS) + '.');
        floorIn.focus();
        return;
      }
      if (!adultCheck.checked) {
        showErr('confirm the 18+ box — no minors on cards, no exceptions.');
        return;
      }

      mintBtn.disabled = true;
      mintBtn.textContent = 'PRESSING…';

      /* render the social unfurl image first so shares look like a card,
         not a raw selfie — failure is non-fatal (server falls back). */
      M.renderOgJPEG({
        name: name, tagline: tagline, photo: state.photo,
        supply: state.supply, floor_cents: floorCents
      }).catch(function () { return null; }).then(function (ogDataURL) {
        var body = {
          name: name,
          tagline: tagline,
          photo: state.photo,
          supply: state.supply,
          price_floor_cents: floorCents,
          attestation: attestation(),
          adult_attested: true
        };
        if (ogDataURL && ogDataURL.length <= M.OG_MAX_CHARS) body.og_image = ogDataURL;
        if (via) body.referred_by = via;
        return M.post('/api/cards', body);
      }).then(function (r) {
        M.saveKey(r.id, r.manage_key, name);
        mintBtn.textContent = 'MINTED. SETTING UP PAYOUTS…';
        /* dead-share fix: connect payouts BEFORE the link gets shared.
           Demo mode onboards instantly; real mode goes to Stripe first. */
        return M.post('/api/onboard', { card_id: r.id, manage_key: r.manage_key })
          .then(function (o) {
            if (o && o.status === 'redirect' && o.url) { location.href = o.url; return; }
            location.href = '/c/' + r.id;
          })
          .catch(function () { location.href = '/c/' + r.id; });
      }).catch(function (err) {
        mintBtn.disabled = false;
        mintBtn.textContent = "MINT ME — IT'S FREE";
        if (err && err.status === 429) {
          showErr('Easy, machine. ' + err.message + ' — even scarcity needs scarcity.');
        } else {
          showErr((err && err.message) || 'mint failed. the press jammed. try again.');
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
    setFloor();
    loadGallery();
  }
})();
