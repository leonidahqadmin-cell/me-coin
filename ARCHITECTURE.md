# ME COIN — ARCHITECTURE.md (BINDING CONTRACT, v1.0 FINAL)

This document is the interface contract between two builder agents working in parallel
with NO communication channel. **Neither side may deviate from anything written here.**
Where SPEC.md describes behavior and this file pins an interface, this file wins.
There are no options and no TBDs in this document.

---

## 1. File ownership (hard boundary — never write outside your zone)

### BACKEND agent owns (and ONLY backend may create/edit):

| File | Required | Purpose |
|---|---|---|
| `src/index.js` | YES | Worker entry: router, ensureSchema, all handlers |
| `src/constants.js` | YES | The shared constants of §2, exported |
| `src/*.js` (any additional modules) | optional | Backend may freely add modules under `src/` only |
| `wrangler.jsonc` | YES | Exactly the contents of §7 |
| `package.json` | YES | Exactly the contents of §7 |
| `README.md` | YES | Run/deploy instructions + flip-to-real-Stripe runbook |

### FRONTEND agent owns (and ONLY frontend may create/edit) — everything under `public/`:

| File | Required | Purpose |
|---|---|---|
| `public/index.html` | YES | Home: hero, builder, sim market feed, recent gallery |
| `public/card.html` | YES | Card page template — MUST contain the two tokens of §5 |
| `public/success.html` | YES | Post-purchase page — MUST contain the `/*__SALE__*/` token of §5 |
| `public/demo-pay.html` | YES | Demo checkout page — MUST contain the `/*__DEMO__*/` token of §5 |
| `public/rules.html` | YES | Content rules + terms (fully static) |
| `public/styles.css` | YES | All styling per DESIGN.md |
| `public/cardart.js` | YES | Shared canvas PNG card renderer (builder, card page, success) |
| `public/app.js` | YES | Builder page logic: sim loop, mint, gallery |
| `public/card-page.js` | YES | Card page logic: buy box, sales feed, onboard, report |
| `public/success.js` | YES | Success page logic: pending poll, PNG download |
| `public/demo-pay.js` | YES | Demo checkout confirm logic |
| `public/_headers` | YES | Static-asset headers — MUST contain exactly the CSP of §9 for `/*` |
| `public/**` (anything else) | optional | Frontend may freely add files under `public/` only |

Backend NEVER touches `public/`. Frontend NEVER touches `src/`, `wrangler.jsonc`,
`package.json`, or `README.md`. No other top-level files may be created by either side
(this file, SPEC.md, DESIGN.md already exist).

---

## 2. Shared constants (both sides hard-code these EXACT values)

Backend exports them from `src/constants.js`; frontend duplicates them as literals.

```js
export const VERSION = 'v0.4.0';             // bumped every release; live at /api/config

export const AMOUNT_MIN_CENTS = 100;         // $1.00 — creator net must never be $0
export const AMOUNT_MAX_CENTS = 99999999;    // schema bound only — launch caps rule
export const LAUNCH_PRICE_CAP_CENTS = 50000; // $500 max per sale during launch
export const YOUNG_CARD_CAP_CENTS  = 10000;  // $100 max per sale, card's first 7 days
export const YOUNG_CARD_MS        = 7 * 86400000;
export const SUPPLY_MIN      = 1;
export const SUPPLY_MAX      = 1000;
export const NAME_MAX        = 40;           // characters (after .trim())
export const TAGLINE_MAX     = 100;          // characters (after .trim())
export const REASON_MAX      = 300;          // report reason characters
export const PHOTO_MAX_CHARS = 512000;       // dataURL STRING length ≤ 500 KiB
export const OG_MAX_CHARS    = 307200;       // og unfurl image cap (~300 KiB)
export const PHOTO_PREFIX_RE = /^data:image\/(jpeg|png|webp);base64,/;
// Additive platform fee: $0.30 + 10%, never more than the amount itself.
export const FEE_FIXED_CENTS = 30;
export const FEE_RATE        = 0.10;
export const feeCents = (a) => Math.min(a, FEE_FIXED_CENTS + Math.round(a * FEE_RATE));
export const MINT_LIMIT_PER_IP = 20;         // per rolling 3600s window → 429
export const CHECKOUT_LIMIT_PER_IP = 10;     // checkout sessions per IP/hour → 429
export const REPORT_AUTOHIDE_COUNT = 3;      // distinct reports in 7 days → hidden
export const DISPUTE_AUTOHIDE_COUNT = 2;     // disputes → hidden
export const QUICK_CHIPS_CENTS = [100, 500, 2000];  // $1 / $5 / $20
```

### Release checklist (every deploy, no exceptions)

1. Bump `VERSION` in `src/constants.js`.
2. Commit (PRs for fleet contributions; founder direct-commits push same-day).
3. `git tag vX.Y.Z && git push origin master --tags`.
4. `wrangler deploy`.
5. Verify `curl https://<host>/api/config` reports the new version.

There is no build step, so the version is maintained by this checklist and
verified externally by comparing `/api/config` to the latest tag — drift
between them is itself a detectable protocol violation, by design.

Additional fixed agreements:

- **Card id**: 10 chars, lowercase `[a-z0-9]{10}`, generated server-side from
  `crypto.getRandomValues`. URL shape: `/c/<id>`.
- **manage_key**: 32 lowercase hex chars (16 random bytes). Stored in D1 ONLY as
  SHA-256 hex digest. Frontend stores it in `localStorage` under key
  `mecoin_key_<card_id>`.
- **Serial display format** (frontend, everywhere a serial renders, incl. PNG):
  `#${String(serial).padStart(Math.max(3, String(supply).length), '0')}/${supply}`
  → e.g. `#001/100`, `#0042/1000`.
- **Demo session id format**: `demo_<card_id>_<amount_cents>_<8 lowercase hex>`
  matching `/^demo_[a-z0-9]{10}_\d{2,8}_[0-9a-f]{8}$/`. It is stateless: card id and
  amount are parsed back out of it (card ids never contain `_`).
- **Timestamps**: all `created_at` values are `Date.now()` — Unix epoch **milliseconds**,
  integer. API responses pass them through unchanged.
- **Money in API**: integers in cents, always. No floats, no dollar strings.
- **Error shape**: every non-2xx API response body is exactly `{"error": "<string>"}`
  with `Content-Type: application/json`. Statuses used: 400 (validation), 401 (bad
  manage_key / admin key), 404 (missing, hidden, or wrong-mode route), 405 (method),
  409 (sold out / not for sale), 429 (mint rate limit), 500 (internal).
- **Sim-only constants** (frontend only, never sent to server): sim pool $1,000,000;
  sim price input $0.01–$10,000,000,000,000; bands r≤1.5 / 1.5<r≤100 / r>100.

---

## 3. D1 schema (binding `DB`, database `me-coin-db`)

Exactly three tables. Backend creates them lazily — **no migration step ever**.

```sql
CREATE TABLE IF NOT EXISTS cards (
  id               TEXT PRIMARY KEY,            -- [a-z0-9]{10}
  name             TEXT NOT NULL,               -- ≤40 chars, trimmed
  tagline          TEXT NOT NULL DEFAULT '',    -- ≤100 chars, trimmed
  photo            TEXT NOT NULL,               -- data:image/...;base64 dataURL ≤512000 chars
  supply           INTEGER NOT NULL,            -- 1..1000
  sold             INTEGER NOT NULL DEFAULT 0,  -- 0..supply
  manage_key_hash  TEXT NOT NULL,               -- SHA-256 hex of manage_key
  stripe_account_id TEXT,                       -- NULL | 'acct_...' | 'acct_demo_...'
  charges_enabled  INTEGER NOT NULL DEFAULT 0,  -- 0|1
  hidden           INTEGER NOT NULL DEFAULT 0,  -- 0|1 (admin hide / owner delist)
  mint_ip          TEXT,                        -- CF-Connecting-IP at mint time
  created_at       INTEGER NOT NULL             -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_cards_created ON cards (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_mint_ip ON cards (mint_ip, created_at);

CREATE TABLE IF NOT EXISTS sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      TEXT NOT NULL,
  serial       INTEGER NOT NULL,                -- 1..supply (the post-increment sold value)
  amount_cents INTEGER NOT NULL,                -- 50..99999999
  fee_cents    INTEGER NOT NULL,                -- Math.round(amount_cents * 0.10)
  mode         TEXT NOT NULL CHECK (mode IN ('demo','real')),
  session_id   TEXT NOT NULL UNIQUE,            -- idempotency key (cs_... or demo_...)
  created_at   INTEGER NOT NULL                 -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_sales_card ON sales (card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,                     -- ≤300 chars
  created_at INTEGER NOT NULL                   -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at DESC);
```

### ensureSchema() — lazy, once per isolate

```js
let schemaReady = null;                       // module-level in src/index.js (or src/schema.js)
export function ensureSchema(env) {
  schemaReady ??= env.DB.batch([ /* the 7 statements above, one prepare() each */ ]);
  return schemaReady;
}
```

The fetch handler awaits `ensureSchema(env)` as its FIRST action on every request it
serves (static-asset requests never reach the Worker, so cost is negligible). If the
batch rejects, reset `schemaReady = null` before rethrowing so the next request retries.
Local dev (`wrangler dev`) and production both bootstrap themselves with zero manual steps.

---

## 4. API contract — every route, exact shapes

General rules: request bodies are JSON (`Content-Type: application/json`); all responses
are JSON unless marked HTML; wrong method on a known path → `405 {"error":"method not allowed"}`;
unknown `/api/*` path → `404 {"error":"not found"}`. `:id` segments not matching
`[a-z0-9]{10}` → 404. Cards with `hidden=1` behave as nonexistent on every public route.

### 4.1 `GET /api/config`
No request body.
- DEMO mode 200: `{"mode":"demo"}`
- REAL mode 200: `{"mode":"real","publishable_key":"pk_..."}`
  (`publishable_key` is `env.STRIPE_PUBLISHABLE_KEY`, or `null` if unset; the key is
  present in the object only in real mode.)

### 4.2 `POST /api/cards` — mint
Request:
```json
{"name":"BIG NICK ENERGY","tagline":"limited. like my patience.","photo":"data:image/jpeg;base64,...","supply":100}
```
Validation (in order, first failure wins, all 400): `name` string, trimmed length 1–40;
`tagline` string, trimmed length 0–100; `photo` string, matches `PHOTO_PREFIX_RE`,
length ≤ 512000; `supply` integer 1–1000. Then rate limit: count of `cards` rows with
this `mint_ip` in last 3600000 ms ≥ 20 → `429 {"error":"rate limit: 20 mints per hour"}`.
Success 201:
```json
{"id":"k3x9w2m1p0","manage_key":"3f8a...32hex...c1"}
```
`manage_key` is returned exactly once, never again, never retrievable.

### 4.3 `GET /api/card/:id`
Success 200 — **this exact object is also the `window.__CARD__` payload (§5)**:
```json
{
  "id":"k3x9w2m1p0",
  "name":"BIG NICK ENERGY",
  "tagline":"limited. like my patience.",
  "photo":"data:image/jpeg;base64,...",
  "supply":100,
  "sold":3,
  "onboarded":true,
  "created_at":1760000000000,
  "stats":{"last_paid_cents":500,"avg_paid_cents":433,"total_raised_cents":1300,"sales_count":3}
}
```
`onboarded` = `charges_enabled === 1`. With zero sales: `"stats":{"last_paid_cents":null,
"avg_paid_cents":null,"total_raised_cents":0,"sales_count":0}`. `avg_paid_cents` =
`Math.round(total/count)`. Never includes `manage_key_hash`, `stripe_account_id`,
`mint_ip`, or `hidden`. Missing/hidden → `404 {"error":"not found"}`.

### 4.4 `GET /api/card/:id/sales` — live sales feed
Success 200, newest first, max 20:
```json
{"sales":[{"serial":3,"amount_cents":500,"created_at":1760000300000}]}
```
Frontend polls this every 5000 ms on the card page.

### 4.5 `GET /api/card/:id/photo` — OG image bytes
Decodes the stored dataURL and returns raw image bytes with the matching
`Content-Type` (`image/jpeg|png|webp`) and `Cache-Control: public, max-age=3600`.
This URL (absolute) is what goes into `og:image`. Missing/hidden → 404 JSON error.

### 4.6 `GET /api/cards/recent`
Success 200 — latest 12 non-hidden cards, newest first:
```json
{"cards":[{"id":"k3x9w2m1p0","name":"...","tagline":"...","photo":"data:...","supply":100,"sold":3,"created_at":1760000000000}]}
```

### 4.7 `POST /api/checkout`
Request: `{"card_id":"k3x9w2m1p0","amount_cents":500}`
Validation: `card_id` exists & not hidden (404); `amount_cents` integer 50–99999999
(400 `{"error":"amount must be between $0.50 and $999,999.99"}`); card onboarded
(`charges_enabled=1`) else `409 {"error":"not for sale yet"}`; `sold < supply` else
`409 {"error":"sold out"}`.
Success 200 (both modes, same shape): `{"url":"<string>"}` — frontend does
`location.href = url`.
- DEMO: `url` = `/demo-pay?session=demo_<card_id>_<amount_cents>_<hex8>`
- REAL: `url` = Stripe-hosted Checkout URL. Session created via raw
  `fetch POST https://api.stripe.com/v1/checkout/sessions` (form-encoded) with exactly:
  `mode=payment`, `line_items[0][quantity]=1`,
  `line_items[0][price_data][currency]=usd`,
  `line_items[0][price_data][unit_amount]=<amount_cents>`,
  `line_items[0][price_data][product_data][name]=ME COIN — <card name>`,
  `payment_intent_data[application_fee_amount]=<feeCents(amount_cents)>`,
  `payment_intent_data[transfer_data][destination]=<stripe_account_id>`,
  `success_url=<origin>/success?session={CHECKOUT_SESSION_ID}`,
  `cancel_url=<origin>/c/<card_id>`, `metadata[card_id]=<card_id>`.

### 4.8 `POST /api/onboard` — idempotent; also used to poll on return
Request: `{"card_id":"k3x9w2m1p0","manage_key":"<32hex>"}`
`SHA-256(manage_key)` must equal stored hash else `401 {"error":"bad manage key"}`.
- Already `charges_enabled=1` → 200 `{"status":"onboarded"}`
- DEMO mode → set `stripe_account_id='acct_demo_'+<12hex>`, `charges_enabled=1` →
  200 `{"status":"onboarded"}`
- REAL, no account yet → `POST /v1/accounts` (type=express), store id, then
  `POST /v1/account_links` (`type=account_onboarding`,
  `refresh_url=<origin>/c/<id>?onboard=refresh`, `return_url=<origin>/c/<id>?onboard=return`)
  → 200 `{"status":"redirect","url":"https://connect.stripe.com/..."}`
- REAL, account exists, not yet enabled → `GET /v1/accounts/:id`; if now
  `charges_enabled` → update DB → `{"status":"onboarded"}`; else fresh account link →
  `{"status":"redirect","url":"..."}`.
Card page JS: on load with `?onboard=return` in the URL and a stored manage_key, call
this route once and update the UI from the answer.

### 4.9 `POST /api/delist` — owner hides own card
Request: `{"card_id":"k3x9w2m1p0","manage_key":"<32hex>"}` → 401 on bad key.
Success 200: `{"ok":true}`. Sets `hidden=1`.

### 4.10 `POST /api/report`
Request: `{"card_id":"k3x9w2m1p0","reason":"impersonation"}`
Validation: card exists & not hidden (404); `reason` string, trimmed length 1–300 (400).
Success 201: `{"ok":true}`.

### 4.11 `GET /api/sale/:session_id` — success-page poll
`:session_id` = full session id string (`cs_...` or `demo_...`). Always 200:
- Fulfilled: `{"status":"complete","serial":7,"amount_cents":500,"card":{<full §4.3 card object>}}`
- Not (yet) fulfilled: `{"status":"pending"}`
Frontend polls every 2000 ms for up to 90 s while pending, then shows a
"still processing — refresh in a minute" state.

### 4.12 `POST /api/demo-pay/confirm` — DEMO MODE ONLY (404 in real mode)
Request: `{"session_id":"demo_k3x9w2m1p0_500_a1b2c3d4"}`
Validation: format regex of §2 (400); parsed card exists, not hidden (404); parsed
amount in 50–99999999 (400). Calls the same `fulfillSale()` as the webhook with
`mode='demo'`. Sold out → `409 {"error":"sold out"}`. Success (including idempotent
replay of an already-fulfilled session) 200:
`{"url":"/success?session=<session_id>"}` — frontend does `location.href = url`.

### 4.13 `POST /webhook` — REAL MODE ONLY (404 in demo mode)
Stripe webhook. Verify `stripe-signature` manually: parse `t=...,v1=...`, HMAC-SHA256
over `` `${t}.${rawBody}` `` with `env.STRIPE_WEBHOOK_SECRET` via SubtleCrypto,
constant-time compare, reject `400 {"error":"bad signature"}` if invalid or
`|now/1000 − t| > 300`. Event `checkout.session.completed` → `fulfillSale()` with
`session_id=event.data.object.id`, `card_id=event.data.object.metadata.card_id`,
`amount_cents=event.data.object.amount_total`, `mode='real'`. If sold out: create
refund (`POST /v1/refunds`, `payment_intent=<session.payment_intent>`), `console.error`
it, still return 200. All recognized-and-handled or ignored events → 200
`{"received":true}`.

### 4.14 HTML routes served by the Worker

| Route | Behavior |
|---|---|
| `GET /c/:id` | Load `/card.html` via `env.ASSETS.fetch`, substitute both tokens (§5), return `text/html` + CSP (§9). Hidden/missing → 404 with a minimal Worker-generated dark "404 — NOT FOUND" HTML page. |
| `GET /success?session=...` | Load `/success.html`, substitute `/*__SALE__*/` (§5). Unknown session is NOT an error → pending payload. Missing `session` param → 404 page. |
| `GET /demo-pay?session=...` | DEMO only (real mode → 404 page). Load `/demo-pay.html`, substitute `/*__DEMO__*/` (§5). Bad session format / unknown card → 404 page. |
| `GET /admin/reports?key=...` | `key` must equal `env.ADMIN_KEY` (and ADMIN_KEY must be set) else `401 {"error":"unauthorized"}`. Returns Worker-generated HTML (backend-owned, NOT in public/): table of reports (id, card_id link, reason escaped, date) with a hide button per row that POSTs `/admin/hide`. |
| `POST /admin/hide` | JSON `{"key":"...","card_id":"..."}`; key check as above. Sets `hidden=1`. 200 `{"ok":true}`. |

### 4.15 Static (never reach the Worker — served by ASSETS)
`GET /` → `index.html`; `GET /rules` → `rules.html` (assets html_handling default);
`/styles.css`, `/*.js`, anything else under `public/`.

---

## 5. Server-render token contract (frontend MUST place tokens; backend MUST substitute)

Substitution is `html.split(TOKEN).join(payload)` (split/join — immune to `$` patterns).
The Worker always serves these pages with `Content-Type: text/html; charset=utf-8` and
the CSP of §9.

### 5.1 `public/card.html` — TWO tokens, both literal, both required

1. **`<!--OG-->`** — on its own line inside `<head>`. Replaced with exactly these tags
   (every interpolated value passed through `escapeHtml`, §9):
```html
<meta property="og:type" content="website">
<meta property="og:title" content="{name} — ME COIN">
<meta property="og:description" content="{tagline} — {remaining} of {supply} remaining. Pay what you want.">
<meta property="og:image" content="{origin}/api/card/{id}/photo">
<meta property="og:url" content="{origin}/c/{id}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{name} — ME COIN">
<meta name="twitter:description" content="{tagline} — {remaining} of {supply} remaining. Pay what you want.">
<meta name="twitter:image" content="{origin}/api/card/{id}/photo">
<title>{name} — ME COIN</title>
```
   `{remaining}` = `supply - sold`, computed at render time.
   (Frontend must NOT also hard-code a `<title>` in card.html.)

2. **`/*__CARD__*/`** — inside a dedicated inline script tag that frontend writes exactly as:
```html
<script id="card-data">/*__CARD__*/</script>
```
   Backend replaces the token with `window.__CARD__ = <json>;` where `<json>` is the
   full §4.3 card object passed through `jsonForScript` (§9). Frontend JS treats
   `window.__CARD__ === undefined` (e.g. `/card.html` fetched directly as a static
   asset) as an error state: render "CARD NOT FOUND".

### 5.2 `public/success.html` — ONE token
```html
<script id="sale-data">/*__SALE__*/</script>
```
Replaced with `window.__SALE__ = <jsonForScript payload>;` where payload is the §4.11
response object — `{"status":"complete","serial":...,"amount_cents":...,"card":{...}}`
or `{"status":"pending","session_id":"<escaped via JSON>"}`. Pending → frontend polls
`GET /api/sale/:session_id`.

### 5.3 `public/demo-pay.html` — ONE token
```html
<script id="demo-data">/*__DEMO__*/</script>
```
Replaced with `window.__DEMO__ = <jsonForScript payload>;` where payload is:
```json
{"session_id":"demo_k3x9w2m1p0_500_a1b2c3d4","amount_cents":500,"card":{<full §4.3 card object>}}
```

### 5.4 Escaping rules (backend implements; the security gate of SPEC.md)
- `escapeHtml(s)`: replace `& < > " '` with `&amp; &lt; &gt; &quot; &#39;`. Applied to
  EVERY user-derived value interpolated into HTML (OG tags, admin page).
- `jsonForScript(obj)`: `JSON.stringify(obj)`, then replace every `<` with the six
  characters `\u003c`, every `>` with `\u003e`, every `&` with `\u0026`, every raw
  U+2028 char with `\u2028`, and every raw U+2029 char with `\u2029` — all valid escape
  sequences inside JSON string literals. This makes `</script>` breakout impossible
  inside the payloads. Reference implementation (backend MUST match exactly):
```js
const jsonForScript = (obj) => JSON.stringify(obj)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
```
- Frontend renders ALL user data (names, taglines, feed entries) via `textContent` /
  attribute assignment — `innerHTML` with user data is forbidden.

---

## 6. Demo-vs-real mode behavior matrix

Detection — single source of truth, computed per request:
```js
const REAL = Boolean(env.STRIPE_SECRET_KEY); // non-empty secret ⇒ real mode
```

| Concern | DEMO (no `STRIPE_SECRET_KEY`) | REAL (`STRIPE_SECRET_KEY` set) |
|---|---|---|
| `GET /api/config` | `{"mode":"demo"}` | `{"mode":"real","publishable_key":...}` |
| Banner | Frontend fetches `/api/config` on every page; mode `demo` ⇒ persistent "DEMO MODE — payments are simulated" banner | No banner |
| `POST /api/checkout` | Returns `/demo-pay?session=demo_...` URL; no Stripe call | Creates Stripe Checkout Session; returns hosted URL |
| `POST /api/onboard` | Instant: `acct_demo_<12hex>`, `charges_enabled=1`, `{"status":"onboarded"}` | Express account + Account Link redirect; idempotent re-poll on return |
| `GET /demo-pay` | Serves demo checkout page | 404 page |
| `POST /api/demo-pay/confirm` | Fulfills via `fulfillSale()` | `404 {"error":"not found"}` |
| `POST /webhook` | `404 {"error":"not found"}` | Signature-verified; fulfills via `fulfillSale()` |
| Sold out discovered at fulfillment | Confirm returns `409 {"error":"sold out"}` | Refund the payment_intent via Stripe API, log, return 200 to Stripe |
| `sales.mode` column | `'demo'` | `'real'` |
| Session id shape | `demo_<card>_<cents>_<8hex>` | Stripe `cs_...` |
| Env vars in play | none required (`ADMIN_KEY` optional) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `ADMIN_KEY` |

Fulfillment is ONE shared function in both modes:

### `fulfillSale(env, {session_id, card_id, amount_cents, mode})` — exact algorithm
1. `SELECT serial FROM sales WHERE session_id = ?` → row exists ⇒ return
   `{replayed:true, serial}` (idempotent; never double-fulfill).
2. `UPDATE cards SET sold = sold + 1 WHERE id = ? AND sold < supply AND hidden = 0
   RETURNING sold` → no row ⇒ throw `SoldOut` (caller maps per the matrix above).
3. `INSERT INTO sales (card_id, serial, amount_cents, fee_cents, mode, session_id,
   created_at) VALUES (?,?,?,?,?,?,?)` with `serial = <returned sold>`,
   `fee_cents = feeCents(amount_cents)`. If this insert fails on the
   `session_id` UNIQUE constraint (replay race), compensate with
   `UPDATE cards SET sold = sold - 1 WHERE id = ?`, re-select the existing sale, and
   return it as a replay. Otherwise return `{replayed:false, serial}`.

---

## 7. wrangler.jsonc & package.json (backend writes these EXACT contents)

`wrangler.jsonc`:
```jsonc
{
  "name": "me-coin",
  "main": "src/index.js",
  "compatibility_date": "2025-01-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/c/*", "/webhook", "/demo-pay", "/success", "/admin/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "me-coin-db",
      "database_id": "REPLACE_AT_DEPLOY"
    }
  ]
}
```
`database_id` stays the literal string `REPLACE_AT_DEPLOY` until deploy time
(`wrangler d1 create me-coin-db` output id is pasted in then). `wrangler dev` works
locally with this placeholder unchanged.

`package.json`:
```json
{
  "name": "me-coin",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
```
NO runtime dependencies. NO build step. NO TypeScript.

---

## 8. Worker routing table (backend `src/index.js`)

Order of checks inside `fetch(request, env)`:
1. `await ensureSchema(env)`
2. Exact-path and prefix dispatch per §4. Anything the Worker receives that matches no
   route (possible under `/c/*`, `/admin/*` prefixes) → 404 (JSON for `/api/*` and
   `/admin/hide`, minimal HTML page otherwise).
3. The Worker never proxies to ASSETS except to fetch its own HTML templates
   (`/card.html`, `/success.html`, `/demo-pay.html`) — static traffic never reaches it
   thanks to `run_worker_first`.

Client IP for rate limiting: `request.headers.get('CF-Connecting-IP') ?? 'local'`.

---

## 9. Security invariants (both sides)

- **CSP** — this exact value, sent (a) by backend on every Worker-rendered HTML
  response, and (b) by frontend in `public/_headers` for `/*`:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'
```
  `public/_headers` format:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'
```
  Documented choice: `'unsafe-inline'` for scripts is REQUIRED because the §5 payload
  scripts are inline; this is safe because every inline payload is server-escaped JSON
  (`jsonForScript`) and user data is never interpolated into HTML unescaped.
- All Stripe calls are raw `fetch` with form-encoded bodies; the stripe npm SDK is
  forbidden. Secrets only via `env.*`, never in git.
- Server validates everything per §2/§4 even though the frontend also validates
  (frontend validation is UX only).
- Photos: `PHOTO_PREFIX_RE` + length cap enforced server-side at mint; frontend
  client-resizes to ≤700px JPEG before upload.
- Disclaimer (frontend, footer of card page, success page, and home): "ME COIN cards
  are digital collectibles for fun. They are not investments, securities, or stores of
  value. No resale market is provided or promised."

---

## 10. Integration smoke list (what "done" means at the seam)

1. `npx wrangler dev` from a fresh clone: home loads, mint succeeds (schema
   self-creates), `/c/:id` renders OG + `window.__CARD__` after hard reload.
2. Demo flow: onboard (instant) → buy $5 → `/demo-pay` → confirm → `/success` shows
   serial `#001/...` → PNG downloads → card-page feed shows the sale.
3. `$0.49` checkout → 400. 21st mint from one IP in an hour → 429. Buying the last
   copy → SOLD OUT; next checkout → 409. Replayed confirm with same session → same
   serial, `sold` unchanged.
4. XSS probe card (name `<img src=x onerror=alert(1)>`, tagline
   `"><script>window.xss=1</script>`) renders as literal text everywhere; no execution.
