// ME COIN — Cloudflare Worker backend.
// Plain JS ES modules, NO runtime dependencies, NO TypeScript, NO frameworks.
// Interface contract: ARCHITECTURE.md (binding). Behavior: SPEC.md.

import {
  VERSION,
  AMOUNT_MIN_CENTS,
  AMOUNT_MAX_CENTS,
  LAUNCH_PRICE_CAP_CENTS,
  YOUNG_CARD_CAP_CENTS,
  YOUNG_CARD_MS,
  SUPPLY_MIN,
  SUPPLY_MAX,
  NAME_MAX,
  TAGLINE_MAX,
  REASON_MAX,
  PHOTO_MAX_CHARS,
  OG_MAX_CHARS,
  PHOTO_PREFIX_RE,
  FEE_FIXED_CENTS,
  FEE_RATE,
  feeCents,
  MINT_LIMIT_PER_IP,
  CHECKOUT_LIMIT_PER_IP,
  REPORT_AUTOHIDE_COUNT,
  REPORT_AUTOHIDE_MS,
  DISPUTE_AUTOHIDE_COUNT,
} from './constants.js';
import { stripePost, stripeGet, verifyStripeSignature, timingSafeEqualStr } from './stripe.js';
import { isBlockedName } from './blocklist.js';

// ---------------------------------------------------------------------------
// Security invariants (ARCHITECTURE.md §9)
// ---------------------------------------------------------------------------

// Exact CSP, sent on every Worker-rendered HTML response. 'unsafe-inline' for
// scripts is REQUIRED because the §5 payload scripts are inline; this is safe
// because every inline payload is server-escaped JSON (jsonForScript) and user
// data is never interpolated into HTML unescaped.
// img-src includes blob: so the builder can load an uploaded photo via
// URL.createObjectURL() for client-side resizing before it becomes a data URL.
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'";

const CARD_ID_RE = /^[a-z0-9]{10}$/;
const MANAGE_KEY_RE = /^[0-9a-f]{32}$/;
const DEMO_SESSION_RE = /^demo_[a-z0-9]{10}_\d{2,8}_[0-9a-f]{8}$/;
const PHOTO_DATAURL_RE = /^data:image\/(jpeg|png|webp);base64,(.*)$/;

/** escapeHtml — applied to EVERY user-derived value interpolated into HTML. */
const escapeHtml = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** jsonForScript — reference implementation from ARCHITECTURE.md §5.4 (exact). */
const jsonForScript = (obj) => JSON.stringify(obj)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

// ---------------------------------------------------------------------------
// D1 schema — lazy, once per isolate (ARCHITECTURE.md §3)
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cards (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    tagline          TEXT NOT NULL DEFAULT '',
    photo            TEXT NOT NULL,
    supply           INTEGER NOT NULL,
    sold             INTEGER NOT NULL DEFAULT 0,
    manage_key_hash  TEXT NOT NULL,
    stripe_account_id TEXT,
    charges_enabled  INTEGER NOT NULL DEFAULT 0,
    hidden           INTEGER NOT NULL DEFAULT 0,
    mint_ip          TEXT,
    created_at       INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cards_created ON cards (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_cards_mint_ip ON cards (mint_ip, created_at)',
  `CREATE TABLE IF NOT EXISTS sales (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id      TEXT NOT NULL,
    serial       INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    fee_cents    INTEGER NOT NULL,
    mode         TEXT NOT NULL CHECK (mode IN ('demo','real')),
    session_id   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sales_card ON sales (card_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    TEXT NOT NULL,
    reason     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_reports_card ON reports (card_id, created_at)',
  `CREATE TABLE IF NOT EXISTS disputes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dispute_id     TEXT UNIQUE,
    payment_intent TEXT,
    card_id        TEXT,
    amount_cents   INTEGER,
    status         TEXT,
    created_at     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS checkout_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_checkout_log_ip ON checkout_log (ip, created_at)',
];

// Column migrations — each silently ignored once the column exists.
const MIGRATION_STATEMENTS = [
  "ALTER TABLE cards ADD COLUMN price_floor_cents INTEGER NOT NULL DEFAULT 50",
  "ALTER TABLE cards ADD COLUMN attestation TEXT NOT NULL DEFAULT 'self'",
  'ALTER TABLE cards ADD COLUMN adult_attested INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE cards ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE cards ADD COLUMN og_image TEXT',
  'ALTER TABLE cards ADD COLUMN referred_by TEXT',
  'ALTER TABLE sales ADD COLUMN payment_intent TEXT',
  'ALTER TABLE sales ADD COLUMN buyer_email TEXT',
];

let schemaReady = null; // module-level (per isolate)

export function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
      for (const sql of MIGRATION_STATEMENTS) {
        try {
          await env.DB.prepare(sql).run();
        } catch { /* column exists */ }
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const err = (status, message) => json({ error: message }, status);
const err404 = () => err(404, 'not found');
const err405 = () => err(405, 'method not allowed');

const htmlResponse = (html, status = 200) =>
  new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
    },
  });

/** Minimal Worker-generated dark error page (DESIGN.md palette). */
function errorPage(status, heading, message) {
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} — ME COIN</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#fafaf9;font-family:'Inter',system-ui,-apple-system,sans-serif}
  .slab{border:1px solid #27272a;background:#111114;padding:48px 56px;text-align:center;max-width:560px;border-radius:8px}
  h1{margin:0 0 12px;font-size:48px;font-weight:700;letter-spacing:-.02em;color:#f87171}
  p{margin:0 0 24px;color:#a1a1aa;line-height:1.6;font-size:15px}
  a{color:#c8a462;text-decoration:underline}
</style>
</head>
<body>
<div class="slab">
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
<a href="/">&larr; BACK TO THE MINT</a>
</div>
</body>
</html>`;
  return htmlResponse(page, status);
}

const notFoundPage = () =>
  errorPage(404, '404 — NOT FOUND', 'This card does not exist, was never minted, or got pulled from the shelf.');

/** Parse a JSON request body; returns a plain object or null. */
async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** crypto-random string over [a-z0-9] (rejection sampling — no modulo bias). */
function randomId(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (out.length === length) break;
      if (b < 252) out += alphabet[b % 36]; // 252 = 7 × 36
    }
  }
  return out;
}

function randomHex(byteLength) {
  return [...crypto.getRandomValues(new Uint8Array(byteLength))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** manage_key check: hash the provided key, constant-time compare digests. */
async function verifyManageKey(provided, storedHash) {
  if (typeof provided !== 'string' || !MANAGE_KEY_RE.test(provided)) return false;
  return timingSafeEqualStr(await sha256Hex(provided), storedHash);
}

/** Demo session ids are stateless: parse card id + amount back out (§2). */
function parseDemoSession(sessionId) {
  const parts = sessionId.split('_'); // ['demo', card_id, cents, hex8] — card ids never contain '_'
  return { cardId: parts[1], amountCents: Number(parts[2]) };
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

/** Full row (internal fields included) — hidden cards behave as nonexistent. */
function loadCardRow(env, id) {
  if (typeof id !== 'string' || !CARD_ID_RE.test(id)) return Promise.resolve(null);
  return env.DB.prepare('SELECT * FROM cards WHERE id = ? AND hidden = 0').bind(id).first();
}

/** The exact §4.3 public card object (also the window.__CARD__ payload). */
async function loadCardPublic(env, id, row = undefined) {
  const card = row === undefined ? await loadCardRow(env, id) : row;
  if (!card) return null;
  const [agg, last] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS cnt, SUM(amount_cents) AS total, MAX(amount_cents) AS high FROM sales WHERE card_id = ?').bind(card.id),
    env.DB.prepare('SELECT amount_cents FROM sales WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(card.id),
  ]);
  const aggRow = (agg.results && agg.results[0]) || {};
  const lastRow = (last.results && last.results[0]) || null;
  const count = aggRow.cnt || 0;
  const total = aggRow.total || 0;
  const high = aggRow.high || null;
  return {
    id: card.id,
    name: card.name,
    tagline: card.tagline,
    photo: card.photo,
    supply: card.supply,
    sold: card.sold,
    onboarded: card.charges_enabled === 1,
    created_at: card.created_at,
    price_floor_cents: card.price_floor_cents || 50,
    attestation: card.attestation || 'self',
    reviewed: card.reviewed === 1,
    stats: {
      last_paid_cents: lastRow ? lastRow.amount_cents : null,
      avg_paid_cents: count > 0 ? Math.round(total / count) : null,
      high_paid_cents: high,
      total_raised_cents: total,
      sales_count: count,
    },
  };
}

// ---------------------------------------------------------------------------
// fulfillSale — the critical transaction (ARCHITECTURE.md §6, exact algorithm)
// ---------------------------------------------------------------------------

class SoldOutError extends Error {
  constructor() {
    super('sold out');
    this.name = 'SoldOutError';
  }
}

async function fulfillSale(env, { session_id, card_id, amount_cents, mode, payment_intent = null, buyer_email = null }) {
  // 1. Idempotency: a replayed session id must never double-fulfill.
  const existing = await env.DB
    .prepare('SELECT serial FROM sales WHERE session_id = ?')
    .bind(session_id)
    .first();
  if (existing) return { replayed: true, serial: existing.serial };

  // 2. Oversell protection: conditional increment with RETURNING.
  const row = await env.DB
    .prepare('UPDATE cards SET sold = sold + 1 WHERE id = ? AND sold < supply AND hidden = 0 RETURNING sold')
    .bind(card_id)
    .first();
  if (!row) throw new SoldOutError();
  const serial = row.sold;

  // 3. Record the sale. ON CONFLICT DO NOTHING guards the replay race —
  //    check the insert actually landed before counting it.
  const insert = await env.DB
    .prepare(
      'INSERT INTO sales (card_id, serial, amount_cents, fee_cents, mode, session_id, created_at, payment_intent, buyer_email) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO NOTHING',
    )
    .bind(card_id, serial, amount_cents, feeCents(amount_cents), mode, session_id, Date.now(), payment_intent, buyer_email)
    .run();

  const changes = insert.meta ? insert.meta.changes : 1;
  if (changes === 0) {
    // Replay race lost: another request fulfilled this session between steps
    // 1 and 3. Compensate the increment, return the existing sale as a replay.
    await env.DB.prepare('UPDATE cards SET sold = sold - 1 WHERE id = ?').bind(card_id).run();
    const replay = await env.DB
      .prepare('SELECT serial FROM sales WHERE session_id = ?')
      .bind(session_id)
      .first();
    if (replay) return { replayed: true, serial: replay.serial };
    throw new Error(`fulfillSale: insert conflict for session ${session_id} but no existing sale row`);
  }

  return { replayed: false, serial };
}

// ---------------------------------------------------------------------------
// JSON API handlers (ARCHITECTURE.md §4)
// ---------------------------------------------------------------------------

async function handleMint(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');

  // Validation in order — first failure wins (§4.2).
  const name = typeof body.name === 'string' ? body.name.trim() : null;
  if (name === null || name.length < 1 || name.length > NAME_MAX) {
    return err(400, `name must be 1-${NAME_MAX} characters`);
  }
  const tagline = typeof body.tagline === 'string' ? body.tagline.trim() : null;
  if (tagline === null || tagline.length > TAGLINE_MAX) {
    return err(400, `tagline must be at most ${TAGLINE_MAX} characters`);
  }
  const photo = body.photo;
  if (typeof photo !== 'string' || !PHOTO_PREFIX_RE.test(photo) || photo.length > PHOTO_MAX_CHARS) {
    return err(400, 'photo must be a jpeg, png, or webp data URL of at most 500 KiB');
  }
  const supply = body.supply;
  if (!Number.isInteger(supply) || supply < SUPPLY_MIN || supply > SUPPLY_MAX) {
    return err(400, `supply must be an integer between ${SUPPLY_MIN} and ${SUPPLY_MAX}`);
  }
  const floorCents = body.price_floor_cents;
  if (!Number.isInteger(floorCents) || floorCents < AMOUNT_MIN_CENTS || floorCents > LAUNCH_PRICE_CAP_CENTS) {
    return err(400, `price_floor_cents must be an integer between ${AMOUNT_MIN_CENTS} and ${LAUNCH_PRICE_CAP_CENTS}`);
  }

  // Safety attestations — required, stored, and disclosed on the card page.
  const attestation = body.attestation;
  if (attestation !== 'self' && attestation !== 'parody' && attestation !== 'tribute') {
    return err(400, "attestation must be one of 'self', 'parody', 'tribute'");
  }
  if (body.adult_attested !== true) {
    return err(400, 'you must confirm you are 18+ and the person on this card is an adult');
  }

  // Public-figure blocklist — a normalized name match requires manual contact.
  if (isBlockedName(name)) {
    return err(400, 'this name requires manual verification — contact us via the report link on any card');
  }

  // Optional pre-rendered OG unfurl image (client-generated, same format rules).
  let ogImage = null;
  if (body.og_image != null) {
    if (typeof body.og_image !== 'string' || !PHOTO_PREFIX_RE.test(body.og_image) || body.og_image.length > OG_MAX_CHARS) {
      return err(400, 'og_image must be a jpeg, png, or webp data URL of at most 300 KiB');
    }
    ogImage = body.og_image;
  }

  // Optional referral attribution (?via=<card_id> share chains → measurable K).
  let referredBy = null;
  if (typeof body.referred_by === 'string' && CARD_ID_RE.test(body.referred_by)) {
    const ref = await env.DB.prepare('SELECT 1 FROM cards WHERE id = ?').bind(body.referred_by).first();
    if (ref) referredBy = body.referred_by;
  }

  // Rate limit: max 20 mints per IP per rolling hour (D1 count).
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM cards WHERE mint_ip = ? AND created_at > ?')
    .bind(ip, Date.now() - 3600000)
    .first();
  if (((recent && recent.n) || 0) >= MINT_LIMIT_PER_IP) {
    return err(429, 'rate limit: 20 mints per hour');
  }

  const id = randomId(10);
  const manageKey = randomHex(16); // 32 lowercase hex chars
  const keyHash = await sha256Hex(manageKey); // only the digest is stored
  await env.DB
    .prepare(
      'INSERT INTO cards (id, name, tagline, photo, supply, sold, manage_key_hash, charges_enabled, hidden, mint_ip, created_at, price_floor_cents, attestation, adult_attested, reviewed, og_image, referred_by) VALUES (?,?,?,?,?,0,?,0,0,?,?,?,?,1,0,?,?)',
    )
    .bind(id, name, tagline, photo, supply, keyHash, ip, Date.now(), floorCents, attestation, ogImage, referredBy)
    .run();

  return json({ id, manage_key: manageKey }, 201);
}

async function handleRecent(env) {
  const { results } = await env.DB
    .prepare(
      'SELECT id, name, tagline, photo, supply, sold, created_at FROM cards WHERE hidden = 0 ORDER BY created_at DESC LIMIT 12',
    )
    .all();
  return json({ cards: results });
}

async function handleSales(env, id) {
  const card = await loadCardRow(env, id);
  if (!card) return err404();
  const { results } = await env.DB
    .prepare(
      'SELECT serial, amount_cents, created_at FROM sales WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
    )
    .bind(card.id)
    .all();
  return json({ sales: results });
}

function dataUrlResponse(dataUrl) {
  const m = PHOTO_DATAURL_RE.exec(dataUrl);
  if (!m) return err(500, 'internal error');
  let bytes;
  try {
    const bin = atob(m[2]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return err(500, 'internal error');
  }
  return new Response(bytes, {
    headers: {
      'Content-Type': `image/${m[1]}`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function handlePhoto(env, id) {
  const card = await loadCardRow(env, id);
  if (!card) return err404();
  return dataUrlResponse(card.photo);
}

/** OG unfurl image — the share-rendered card if the client provided one,
    otherwise the raw photo. */
async function handleOg(env, id) {
  const card = await loadCardRow(env, id);
  if (!card) return err404();
  return dataUrlResponse(card.og_image || card.photo);
}

async function handleCheckout(request, env, REAL, origin) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');

  const card = await loadCardRow(env, body.card_id);
  if (!card) return err404();

  const amount = body.amount_cents;
  // Effective floor: creator's floor, never below the platform minimum
  // (pre-restructure cards may carry floors under $1.00).
  const floorCents = Math.max(card.price_floor_cents || AMOUNT_MIN_CENTS, AMOUNT_MIN_CENTS);
  if (!Number.isInteger(amount) || amount < floorCents) {
    const floorStr = '$' + (floorCents / 100).toFixed(2);
    return err(400, `amount must be at least ${floorStr}`);
  }
  // Launch caps: $500/sale globally, $100/sale while a card is under 7 days old.
  const cap = Date.now() - card.created_at < YOUNG_CARD_MS ? YOUNG_CARD_CAP_CENTS : LAUNCH_PRICE_CAP_CENTS;
  if (amount > cap) {
    return err(400, `launch cap: $${(cap / 100).toFixed(0)} max per sale${cap === YOUNG_CARD_CAP_CENTS ? ' while a card is under a week old' : ''}`);
  }
  if (card.charges_enabled !== 1) return err(409, 'not for sale yet');
  if (card.sold >= card.supply) return err(409, 'sold out');
  // Real charges require a human to have reviewed the card photo first.
  if (REAL && card.reviewed !== 1) return err(409, 'this card is pending review — real purchases unlock once a human has looked at it');

  // Velocity: max 10 checkout sessions per IP per rolling hour.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const recentCheckouts = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM checkout_log WHERE ip = ? AND created_at > ?')
    .bind(ip, Date.now() - 3600000)
    .first();
  if (((recentCheckouts && recentCheckouts.n) || 0) >= CHECKOUT_LIMIT_PER_IP) {
    return err(429, 'rate limit: too many checkouts this hour');
  }
  await env.DB.prepare('INSERT INTO checkout_log (ip, created_at) VALUES (?,?)').bind(ip, Date.now()).run();

  if (!REAL) {
    // Stateless demo session id: demo_<card_id>_<amount_cents>_<8 lowercase hex>
    const sessionId = `demo_${card.id}_${amount}_${randomHex(4)}`;
    return json({ url: `/demo-pay?session=${sessionId}` });
  }

  try {
    const session = await stripePost(env, '/v1/checkout/sessions', [
      ['mode', 'payment'],
      ['line_items[0][quantity]', '1'],
      ['line_items[0][price_data][currency]', 'usd'],
      ['line_items[0][price_data][unit_amount]', String(amount)],
      ['line_items[0][price_data][product_data][name]', `ME COIN — ${card.name}`],
      ['payment_intent_data[application_fee_amount]', String(feeCents(amount))],
      ['payment_intent_data[transfer_data][destination]', card.stripe_account_id],
      // Reads as a trading-card purchase on a bank statement — deliberately
      // not "MECOIN" (memecoin optics invite disputes and processor risk).
      ['payment_intent_data[statement_descriptor_suffix]', 'CARD'],
      ['success_url', `${origin}/success?session={CHECKOUT_SESSION_ID}`],
      ['cancel_url', `${origin}/c/${card.id}`],
      ['metadata[card_id]', card.id],
    ]);
    return json({ url: session.url });
  } catch (e) {
    console.error('checkout: stripe session creation failed:', e);
    return err(500, 'payment provider error');
  }
}

async function handleOnboard(request, env, REAL, origin) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');

  const card = await loadCardRow(env, body.card_id);
  if (!card) return err404();
  if (!(await verifyManageKey(body.manage_key, card.manage_key_hash))) {
    return err(401, 'bad manage key');
  }

  if (card.charges_enabled === 1) return json({ status: 'onboarded' });

  if (!REAL) {
    const acct = `acct_demo_${randomHex(6)}`;
    await env.DB
      .prepare('UPDATE cards SET stripe_account_id = ?, charges_enabled = 1 WHERE id = ?')
      .bind(acct, card.id)
      .run();
    return json({ status: 'onboarded' });
  }

  try {
    let accountId = card.stripe_account_id;
    if (!accountId) {
      const account = await stripePost(env, '/v1/accounts', [['type', 'express']]);
      accountId = account.id;
      await env.DB
        .prepare('UPDATE cards SET stripe_account_id = ? WHERE id = ?')
        .bind(accountId, card.id)
        .run();
    } else {
      // Poll on return: has onboarding completed since we last looked?
      const account = await stripeGet(env, `/v1/accounts/${accountId}`);
      if (account.charges_enabled) {
        await env.DB
          .prepare('UPDATE cards SET charges_enabled = 1 WHERE id = ?')
          .bind(card.id)
          .run();
        return json({ status: 'onboarded' });
      }
    }
    const link = await stripePost(env, '/v1/account_links', [
      ['account', accountId],
      ['refresh_url', `${origin}/c/${card.id}?onboard=refresh`],
      ['return_url', `${origin}/c/${card.id}?onboard=return`],
      ['type', 'account_onboarding'],
    ]);
    return json({ status: 'redirect', url: link.url });
  } catch (e) {
    console.error('onboard: stripe call failed:', e);
    return err(500, 'payment provider error');
  }
}

async function handleDelist(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');
  const card = await loadCardRow(env, body.card_id);
  if (!card) return err404();
  if (!(await verifyManageKey(body.manage_key, card.manage_key_hash))) {
    return err(401, 'bad manage key');
  }
  await env.DB.prepare('UPDATE cards SET hidden = 1 WHERE id = ?').bind(card.id).run();
  return json({ ok: true });
}

async function handleReport(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');
  const card = await loadCardRow(env, body.card_id);
  if (!card) return err404();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
  if (reason === null || reason.length < 1 || reason.length > REASON_MAX) {
    return err(400, `reason must be 1-${REASON_MAX} characters`);
  }
  await env.DB
    .prepare('INSERT INTO reports (card_id, reason, created_at) VALUES (?,?,?)')
    .bind(card.id, reason, Date.now())
    .run();

  // Auto-hide: 3+ reports inside 7 days pulls the card pending human review.
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM reports WHERE card_id = ? AND created_at > ?')
    .bind(card.id, Date.now() - REPORT_AUTOHIDE_MS)
    .first();
  if (((recent && recent.n) || 0) >= REPORT_AUTOHIDE_COUNT && card.hidden === 0) {
    await env.DB.prepare('UPDATE cards SET hidden = 1 WHERE id = ?').bind(card.id).run();
    console.error(`MODERATION: card ${card.id} auto-hidden — ${recent.n} reports in 7 days`);
  }
  return json({ ok: true }, 201);
}

/** Shared by GET /api/sale/:session_id and the /success page payload. */
async function saleStatusPayload(env, sessionId) {
  const sale = await env.DB
    .prepare('SELECT card_id, serial, amount_cents FROM sales WHERE session_id = ?')
    .bind(sessionId)
    .first();
  if (sale) {
    const card = await loadCardPublic(env, sale.card_id);
    if (card) {
      return { status: 'complete', serial: sale.serial, amount_cents: sale.amount_cents, card };
    }
  }
  return { status: 'pending' };
}

async function handleDemoConfirm(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');
  const sessionId = body.session_id;
  if (typeof sessionId !== 'string' || !DEMO_SESSION_RE.test(sessionId)) {
    return err(400, 'bad session id');
  }
  const { cardId, amountCents } = parseDemoSession(sessionId);
  const card = await loadCardRow(env, cardId);
  if (!card) return err404();
  const demoFloor = Math.max(card.price_floor_cents || AMOUNT_MIN_CENTS, AMOUNT_MIN_CENTS);
  const demoCap = Date.now() - card.created_at < YOUNG_CARD_MS ? YOUNG_CARD_CAP_CENTS : LAUNCH_PRICE_CAP_CENTS;
  if (amountCents < demoFloor || amountCents > demoCap) {
    return err(400, 'amount is outside the floor/cap bounds');
  }
  try {
    await fulfillSale(env, {
      session_id: sessionId,
      card_id: cardId,
      amount_cents: amountCents,
      mode: 'demo',
    });
  } catch (e) {
    if (e instanceof SoldOutError) return err(409, 'sold out');
    throw e;
  }
  // Idempotent replays land here too — same success URL, same serial.
  return json({ url: `/success?session=${sessionId}` });
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const valid = await verifyStripeSignature(
    rawBody,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) return err(400, 'bad signature');

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return err(400, 'bad payload');
  }

  if (event && event.type === 'charge.dispute.created') {
    const dispute = (event.data && event.data.object) || {};
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
    if (dispute.id && pi) {
      const sale = await env.DB
        .prepare('SELECT card_id FROM sales WHERE payment_intent = ?')
        .bind(pi)
        .first();
      const cardId = sale ? sale.card_id : null;
      await env.DB
        .prepare('INSERT OR IGNORE INTO disputes (dispute_id, payment_intent, card_id, amount_cents, status, created_at) VALUES (?,?,?,?,?,?)')
        .bind(dispute.id, pi, cardId, Number.isInteger(dispute.amount) ? dispute.amount : null, String(dispute.status || 'open'), Date.now())
        .run();
      if (cardId) {
        const n = await env.DB
          .prepare('SELECT COUNT(*) AS n FROM disputes WHERE card_id = ?')
          .bind(cardId)
          .first();
        if (((n && n.n) || 0) >= DISPUTE_AUTOHIDE_COUNT) {
          await env.DB.prepare('UPDATE cards SET hidden = 1 WHERE id = ?').bind(cardId).run();
          console.error(`DISPUTES: card ${cardId} auto-hidden — ${n.n} disputes (dispute ${dispute.id})`);
        } else {
          console.error(`DISPUTES: dispute ${dispute.id} recorded against card ${cardId}`);
        }
      } else {
        console.error(`DISPUTES: dispute ${dispute.id} has no matching sale (payment_intent ${pi})`);
      }
    }
    return json({ received: true });
  }

  if (event && event.type === 'checkout.session.completed') {
    const session = (event.data && event.data.object) || {};
    const cardId = session.metadata && session.metadata.card_id;
    const amount = session.amount_total;
    if (!session.id || !cardId || !Number.isInteger(amount)) {
      console.error('webhook: checkout.session.completed missing id/metadata.card_id/amount_total:', session.id);
      return json({ received: true });
    }
    try {
      await fulfillSale(env, {
        session_id: session.id,
        card_id: cardId,
        amount_cents: amount,
        mode: 'real',
        payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        buyer_email: (session.customer_details && session.customer_details.email) || null,
      });
    } catch (e) {
      if (e instanceof SoldOutError) {
        // Paid for a card that sold out between checkout and fulfillment:
        // refund the payment, log it, still return 200 to Stripe.
        console.error(
          `webhook: card ${cardId} sold out at fulfillment — refunding payment_intent ${session.payment_intent} (session ${session.id})`,
        );
        try {
          // Destination charge: pull the transfer back from the connected
          // account and return our application fee, or the platform eats
          // the refund while the creator keeps the money.
          await stripePost(env, '/v1/refunds', [
            ['payment_intent', String(session.payment_intent)],
            ['reverse_transfer', 'true'],
            ['refund_application_fee', 'true'],
          ]);
        } catch (refundErr) {
          console.error('webhook: refund attempt failed (manual follow-up needed):', refundErr);
        }
        return json({ received: true });
      }
      throw e; // unexpected failure → 500 → Stripe retries
    }
  }

  return json({ received: true });
}

// ---------------------------------------------------------------------------
// Worker-rendered HTML routes (ARCHITECTURE.md §4.14, §5)
// ---------------------------------------------------------------------------

/** Load an HTML template from the ASSETS binding (follows asset redirects). */
async function fetchAssetText(env, origin, assetPath) {
  let response = await env.ASSETS.fetch(new Request(origin + assetPath));
  for (let hops = 0; hops < 3 && response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('Location');
    if (!location) break;
    response = await env.ASSETS.fetch(new Request(new URL(location, origin).toString()));
  }
  if (!response.ok) {
    throw new Error(`asset ${assetPath} unavailable (status ${response.status})`);
  }
  return response.text();
}

async function handleCardPage(env, id, origin) {
  const card = await loadCardPublic(env, id);
  if (!card) return notFoundPage();

  const template = await fetchAssetText(env, origin, '/card.html');
  const remaining = card.supply - card.sold;
  // Scarcity copy only — never valuation copy (no prices, no "worth").
  const lowStock = remaining > 0 && remaining <= Math.max(1, Math.ceil(card.supply * 0.1));
  const scarcity = remaining === 0 ? 'SOLD OUT — ' : lowStock ? `ONLY ${remaining} LEFT — ` : '';
  const description = `${scarcity}${card.tagline} — ${remaining} of ${card.supply} numbered copies remaining.`;
  const og = [
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapeHtml(card.name)} — ME COIN">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(origin)}/api/card/${escapeHtml(card.id)}/og">`,
    `<meta property="og:url" content="${escapeHtml(origin)}/c/${escapeHtml(card.id)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(card.name)} — ME COIN">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(origin)}/api/card/${escapeHtml(card.id)}/og">`,
    `<title>${escapeHtml(card.name)} — ME COIN</title>`,
  ].join('\n');

  // split/join substitution — immune to `$` replacement patterns (§5).
  const html = template
    .split('<!--OG-->').join(og)
    .split('/*__CARD__*/').join(`window.__CARD__ = ${jsonForScript(card)};`);
  return htmlResponse(html);
}

async function handleSuccessPage(env, url) {
  const sessionId = url.searchParams.get('session');
  if (!sessionId) return notFoundPage();
  const payload = await saleStatusPayload(env, sessionId);
  if (payload.status === 'pending') payload.session_id = sessionId; // §5.2 pending shape
  const template = await fetchAssetText(env, url.origin, '/success.html');
  const html = template.split('/*__SALE__*/').join(`window.__SALE__ = ${jsonForScript(payload)};`);
  return htmlResponse(html);
}

async function handleDemoPayPage(env, url) {
  const sessionId = url.searchParams.get('session');
  if (!sessionId || !DEMO_SESSION_RE.test(sessionId)) return notFoundPage();
  const { cardId, amountCents } = parseDemoSession(sessionId);
  if (amountCents < AMOUNT_MIN_CENTS || amountCents > AMOUNT_MAX_CENTS) return notFoundPage();
  const card = await loadCardPublic(env, cardId);
  if (!card) return notFoundPage();
  const payload = { session_id: sessionId, amount_cents: amountCents, card };
  const template = await fetchAssetText(env, url.origin, '/demo-pay.html');
  const html = template.split('/*__DEMO__*/').join(`window.__DEMO__ = ${jsonForScript(payload)};`);
  return htmlResponse(html);
}

// ---------------------------------------------------------------------------
// Admin (backend-owned, Worker-generated HTML — NOT in public/)
// ---------------------------------------------------------------------------

function adminAuthorized(env, key) {
  return (
    Boolean(env.ADMIN_KEY) &&
    typeof key === 'string' &&
    key.length > 0 &&
    timingSafeEqualStr(key, env.ADMIN_KEY)
  );
}

async function handleAdminReports(env, url) {
  if (!adminAuthorized(env, url.searchParams.get('key'))) return err(401, 'unauthorized');

  const { results } = await env.DB
    .prepare('SELECT id, card_id, reason, created_at FROM reports ORDER BY created_at DESC LIMIT 200')
    .all();

  const rows = results
    .map(
      (r) => `<tr>
<td>${escapeHtml(r.id)}</td>
<td><a href="/c/${escapeHtml(r.card_id)}">${escapeHtml(r.card_id)}</a></td>
<td class="reason">${escapeHtml(r.reason)}</td>
<td>${escapeHtml(new Date(r.created_at).toISOString())}</td>
<td><button class="hide-btn" data-card="${escapeHtml(r.card_id)}">HIDE CARD</button></td>
</tr>`,
    )
    .join('\n');

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>REPORTS — ME COIN ADMIN</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0a0a0b;color:#fafaf9;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:32px;font-size:14px}
  h1{font-size:18px;font-weight:700;color:#fafaf9;margin:0 0 4px}
  .sub{color:#71717a;margin:0 0 24px;font-size:13px}
  table{border-collapse:collapse;width:100%;background:#111114;border:1px solid #27272a}
  th,td{border:1px solid #27272a;padding:8px 12px;text-align:left;font-size:13px;vertical-align:top}
  th{color:#a1a1aa;letter-spacing:.04em;font-weight:600}
  td.reason{max-width:420px;word-break:break-word}
  a{color:#c8a462;text-decoration:underline}
  button{background:transparent;border:1px solid #f87171;color:#f87171;font-family:inherit;font-size:12px;padding:5px 10px;cursor:pointer;border-radius:4px}
  button:hover{background:#f87171;color:#0a0a0b}
  button:disabled{opacity:.4;cursor:default}
  .empty{color:#71717a;padding:32px;text-align:center}
</style>
</head>
<body>
<h1>ME COIN — REPORT QUEUE</h1>
<p class="sub">${escapeHtml(results.length)} report(s), newest first (max 200 shown). Hiding a card makes it nonexistent on every public route.</p>
${results.length === 0 ? '<p class="empty">No reports. The streets are clean.</p>' : `<table>
<thead><tr><th>ID</th><th>CARD</th><th>REASON</th><th>DATE</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`}
<script>
(function () {
  var key = new URLSearchParams(location.search).get('key');
  document.querySelectorAll('.hide-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'HIDING…';
      fetch('/admin/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, card_id: btn.dataset.card })
      }).then(function (res) {
        btn.textContent = res.ok ? 'HIDDEN' : 'FAILED';
        if (!res.ok) btn.disabled = false;
      }).catch(function () {
        btn.textContent = 'FAILED';
        btn.disabled = false;
      });
    });
  });
})();
</script>
</body>
</html>`;
  return htmlResponse(page);
}

async function handleAdminHide(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');
  if (!adminAuthorized(env, body.key)) return err(401, 'unauthorized');
  if (typeof body.card_id !== 'string' || !CARD_ID_RE.test(body.card_id)) {
    return err(400, 'bad card_id');
  }
  await env.DB.prepare('UPDATE cards SET hidden = 1 WHERE id = ?').bind(body.card_id).run();
  return json({ ok: true });
}

/** Review queue — every card a human hasn't approved for real charges yet.
    Real-mode checkout 409s until reviewed = 1; demo mode is unaffected. */
async function handleAdminQueue(env, url) {
  if (!adminAuthorized(env, url.searchParams.get('key'))) return err(401, 'unauthorized');

  const { results } = await env.DB
    .prepare('SELECT id, name, attestation, supply, created_at FROM cards WHERE reviewed = 0 AND hidden = 0 ORDER BY created_at ASC LIMIT 200')
    .all();

  const rows = results
    .map(
      (c) => `<tr>
<td><a href="/c/${escapeHtml(c.id)}">${escapeHtml(c.id)}</a></td>
<td>${escapeHtml(c.name)}</td>
<td>${escapeHtml(c.attestation)}</td>
<td>${escapeHtml(c.supply)}</td>
<td><a href="/api/card/${escapeHtml(c.id)}/photo">photo</a></td>
<td>${escapeHtml(new Date(c.created_at).toISOString())}</td>
<td><button class="ok-btn" data-card="${escapeHtml(c.id)}">APPROVE</button>
<button class="hide-btn" data-card="${escapeHtml(c.id)}">HIDE</button></td>
</tr>`,
    )
    .join('\n');

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>REVIEW QUEUE — ME COIN ADMIN</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0a0a0b;color:#fafaf9;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:32px;font-size:14px}
  h1{font-size:18px;font-weight:700;margin:0 0 4px}
  .sub{color:#71717a;margin:0 0 24px;font-size:13px}
  table{border-collapse:collapse;width:100%;background:#111114;border:1px solid #27272a}
  th,td{border:1px solid #27272a;padding:8px 12px;text-align:left;font-size:13px;vertical-align:top}
  th{color:#a1a1aa;letter-spacing:.04em;font-weight:600}
  a{color:#c8a462;text-decoration:underline}
  button{background:transparent;font-family:inherit;font-size:12px;padding:5px 10px;cursor:pointer;border-radius:4px;margin-right:6px}
  .ok-btn{border:1px solid #34d399;color:#34d399}
  .ok-btn:hover{background:#34d399;color:#0a0a0b}
  .hide-btn{border:1px solid #f87171;color:#f87171}
  .hide-btn:hover{background:#f87171;color:#0a0a0b}
  button:disabled{opacity:.4;cursor:default}
  .empty{color:#71717a;padding:32px;text-align:center}
</style>
</head>
<body>
<h1>ME COIN — REVIEW QUEUE</h1>
<p class="sub">${escapeHtml(results.length)} card(s) awaiting human review (oldest first, max 200). No card takes a real charge until approved here.</p>
${results.length === 0 ? '<p class="empty">Queue is clear. Every live card has been looked at by a human.</p>' : `<table>
<thead><tr><th>CARD</th><th>NAME</th><th>ATTESTATION</th><th>SUPPLY</th><th>PHOTO</th><th>MINTED</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`}
<script>
(function () {
  var key = new URLSearchParams(location.search).get('key');
  function wire(sel, path, doneText) {
    document.querySelectorAll(sel).forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: key, card_id: btn.dataset.card })
        }).then(function (res) {
          btn.textContent = res.ok ? doneText : 'FAILED';
          if (!res.ok) btn.disabled = false;
        }).catch(function () {
          btn.textContent = 'FAILED';
          btn.disabled = false;
        });
      });
    });
  }
  wire('.ok-btn', '/admin/approve', 'APPROVED');
  wire('.hide-btn', '/admin/hide', 'HIDDEN');
})();
</script>
</body>
</html>`;
  return htmlResponse(page);
}

async function handleAdminApprove(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, 'invalid json body');
  if (!adminAuthorized(env, body.key)) return err(401, 'unauthorized');
  if (typeof body.card_id !== 'string' || !CARD_ID_RE.test(body.card_id)) {
    return err(400, 'bad card_id');
  }
  await env.DB.prepare('UPDATE cards SET reviewed = 1 WHERE id = ?').bind(body.card_id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Router (ARCHITECTURE.md §8)
// ---------------------------------------------------------------------------

async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  // Mode detection — single source of truth, computed per request (§6).
  const REAL = Boolean(env.STRIPE_SECRET_KEY);
  let m;

  // ---- JSON API ----
  if (path === '/api/config') {
    if (method !== 'GET') return err405();
    const base = {
      version: VERSION,
      fee_formula: { fixed_cents: FEE_FIXED_CENTS, rate: FEE_RATE },
      min_cents: AMOUNT_MIN_CENTS,
      launch_cap_cents: LAUNCH_PRICE_CAP_CENTS,
      young_card_cap_cents: YOUNG_CARD_CAP_CENTS,
    };
    return json(
      REAL
        ? { mode: 'real', publishable_key: env.STRIPE_PUBLISHABLE_KEY || null, ...base }
        : { mode: 'demo', ...base },
    );
  }
  if (path === '/api/cards') {
    if (method !== 'POST') return err405();
    return handleMint(request, env);
  }
  if (path === '/api/cards/recent') {
    if (method !== 'GET') return err405();
    return handleRecent(env);
  }
  if ((m = path.match(/^\/api\/card\/([^/]+)\/photo$/))) {
    if (method !== 'GET') return err405();
    return handlePhoto(env, m[1]);
  }
  if ((m = path.match(/^\/api\/card\/([^/]+)\/og$/))) {
    if (method !== 'GET') return err405();
    return handleOg(env, m[1]);
  }
  if ((m = path.match(/^\/api\/card\/([^/]+)\/sales$/))) {
    if (method !== 'GET') return err405();
    return handleSales(env, m[1]);
  }
  if ((m = path.match(/^\/api\/card\/([^/]+)$/))) {
    if (method !== 'GET') return err405();
    const card = await loadCardPublic(env, m[1]);
    return card ? json(card) : err404();
  }
  if (path === '/api/checkout') {
    if (method !== 'POST') return err405();
    return handleCheckout(request, env, REAL, url.origin);
  }
  if (path === '/api/onboard') {
    if (method !== 'POST') return err405();
    return handleOnboard(request, env, REAL, url.origin);
  }
  if (path === '/api/delist') {
    if (method !== 'POST') return err405();
    return handleDelist(request, env);
  }
  if (path === '/api/report') {
    if (method !== 'POST') return err405();
    return handleReport(request, env);
  }
  if ((m = path.match(/^\/api\/sale\/([^/]+)$/))) {
    if (method !== 'GET') return err405();
    let sessionId = m[1];
    try {
      sessionId = decodeURIComponent(sessionId);
    } catch {
      // keep raw segment if malformed percent-encoding
    }
    return json(await saleStatusPayload(env, sessionId));
  }
  if (path === '/api/demo-pay/confirm') {
    if (method !== 'POST') return err405();
    if (REAL) return err404(); // demo mode only
    return handleDemoConfirm(request, env);
  }
  if (path.startsWith('/api/')) return err404();

  // ---- Stripe webhook ----
  if (path === '/webhook') {
    if (method !== 'POST') return err405();
    if (!REAL) return err404(); // real mode only
    return handleWebhook(request, env);
  }

  // ---- Worker-rendered HTML ----
  if ((m = path.match(/^\/c\/([^/]+)$/))) {
    if (method !== 'GET') return err405();
    return handleCardPage(env, m[1], url.origin);
  }
  if (path === '/success') {
    if (method !== 'GET') return err405();
    return handleSuccessPage(env, url);
  }
  if (path === '/demo-pay') {
    if (method !== 'GET') return err405();
    if (REAL) return notFoundPage(); // demo mode only
    return handleDemoPayPage(env, url);
  }

  // ---- Admin ----
  if (path === '/admin/reports') {
    if (method !== 'GET') return err405();
    return handleAdminReports(env, url);
  }
  if (path === '/admin/hide') {
    if (method !== 'POST') return err405();
    return handleAdminHide(request, env);
  }
  if (path === '/admin/queue') {
    if (method !== 'GET') return err405();
    return handleAdminQueue(env, url);
  }
  if (path === '/admin/approve') {
    if (method !== 'POST') return err405();
    return handleAdminApprove(request, env);
  }

  // Anything else the Worker receives (deep /c/*, unknown /admin/*) → HTML 404.
  return notFoundPage();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureSchema(env); // FIRST action on every request (§3)
      return await route(request, env, url);
    } catch (e) {
      console.error('internal error:', e && e.stack ? e.stack : e);
      const path = url.pathname;
      if (path.startsWith('/api/') || path === '/webhook' || path === '/admin/hide' || path === '/admin/approve') {
        return err(500, 'internal error');
      }
      return errorPage(500, '500 — MARKET MALFUNCTION', 'Something broke behind the counter. Refresh and try again.');
    }
  },
};
