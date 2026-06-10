# ME COIN — Build Specification (v2.1, FINAL)

Satirical-but-real marketplace: mint yourself as a limited-supply digital trading card, share it, and let people buy it for REAL money at **whatever price the buyer chooses** (pay-what-you-want). The card is "worth" what people actually pay.

## Core mechanic change vs v1
There is NO fixed asking price. Buyers name their own amount on the card page.
- Real-money floor: **$0.50 USD** (Stripe hard minimum). Ceiling: **$999,999.99**.
- A card's displayed "market value" = real sales data: last paid, average paid, total raised.
- The old "$1,000,000 pie ÷ supply" mechanic survives ONLY in the client-side SIMULATION on the builder page (clearly labeled SIMULATION).

## Architecture (LOCKED)
- **Cloudflare Worker** (plain modern JS, ES modules, NO TypeScript, NO npm runtime dependencies, NO frameworks). Wrangler bundles it; there is no separate build step.
- **D1** database, binding name `DB`, database name `me-coin-db`. All persistent state lives here, including card photos (as data-URL strings — photos are client-side resized to ≤700px JPEG and hard-capped at 500 KB server-side).
- **Static assets** from `./public` via wrangler assets binding `ASSETS`, with `run_worker_first` for dynamic routes: `/api/*`, `/c/*`, `/webhook`, `/demo-pay*`, `/admin*`.
- **Stripe via raw `fetch`** to `https://api.stripe.com` (form-encoded bodies, `Authorization: Bearer ${env.STRIPE_SECRET_KEY}`). Do NOT use the stripe npm SDK. Webhook signatures verified manually: parse `stripe-signature` header (`t=...,v1=...`), compute HMAC-SHA256 over `` `${t}.${rawBody}` `` with `env.STRIPE_WEBHOOK_SECRET` via SubtleCrypto, constant-time compare, reject if |now − t| > 5 min.
- **Two payment modes, same code path for fulfillment:**
  - **REAL mode** (when `env.STRIPE_SECRET_KEY` is set): Stripe Checkout Session, `mode=payment`, `line_items[0][price_data][unit_amount]=<buyer-chosen cents>`, currency usd, `payment_intent_data[application_fee_amount]=<10% rounded>` + `payment_intent_data[transfer_data][destination]=<seller acct_...>` (destination charge; platform is merchant of record; US-only V1). Fulfillment happens ONLY in the `checkout.session.completed` webhook.
  - **DEMO mode** (no key set): `/api/checkout` returns a `/demo-pay?session=...` URL — a styled, clearly-labeled DEMO checkout page served by the Worker. Confirming it calls the SAME internal `fulfillSale()` function the webhook uses. A persistent "DEMO MODE — payments are simulated" banner shows on every page when in demo mode (expose mode via `/api/config`).
- **Seller onboarding (Connect Express):** "Sell for real" → REAL mode: create Express account (`POST /v1/accounts`, type=express) + Account Link onboarding redirect; card is sellable once `charges_enabled` (poll on return via `GET /v1/accounts/:id`). DEMO mode: one click instantly marks the card onboarded with `acct_demo_...`. Until a card is onboarded it shows "NOT YET FOR SALE" with the owner-only onboard button.
- **Creator identity without accounts:** minting returns a `manage_key` (crypto-random, stored in D1 hashed with SHA-256, given to the client once and kept in localStorage). All owner actions (onboard, delist) require it.

## Pages & routes
- `GET /` — home: hero, the card BUILDER (the toy: name, photo upload, tagline, supply dial 1–1000, sim price up to $10T, live sim "value per card" = $1M ÷ supply, fake market feed game loop), MINT button, recently-minted gallery (`/api/cards/recent`).
- `GET /c/:id` — card page, **server-rendered by the Worker**: it loads `public/card.html` via the ASSETS binding and string-replaces tokens `<!--OG-->` (og:title/og:image/og:description/twitter card) and `/*__CARD__*/` (a `window.__CARD__ = {...}` JSON payload, HTML-escaped safely — see Security). Shows: flip card, supply remaining / sold count, market value stats (last/avg/total), pay-what-you-want BUY box (amount input + quick chips $1 / $5 / $20 / custom), live real-sales feed, share/copy-link, report link, collectible disclaimer.
- `GET /success?session=...` — post-purchase: "YOU OWN #NNN/SSS", buyer's numbered card PNG download.
- `GET /rules` — content rules + terms (static page).
- `POST /api/cards` — mint {name ≤40 chars, tagline ≤100 chars, photo dataURL ≤500KB, supply 1–1000} → {id, manage_key}.
- `GET /api/card/:id` — card JSON (public fields only; never manage_key hash).
- `GET /api/cards/recent` — latest 12 minted, public fields.
- `POST /api/checkout` — {card_id, amount_cents 50–99999999} → checkout URL (real or demo). Validates amount server-side; rejects sold-out.
- `POST /api/onboard` — {card_id, manage_key} → onboarding URL (real) or instant (demo).
- `POST /api/report` — {card_id, reason ≤300} → stored in D1.
- `POST /webhook` — Stripe webhook (real mode), signature-verified, handles `checkout.session.completed` → `fulfillSale()`.
- `GET /demo-pay` + `POST /api/demo-pay/confirm` — demo checkout (demo mode only; both return 404 in real mode).
- `GET /api/config` — {mode: "demo"|"real", publishable_key?}.
- `GET /admin/reports?key=` — requires `env.ADMIN_KEY`; lists reports; `POST /admin/hide` hides a card.

## fulfillSale() — the critical transaction
Oversell protection is mandatory: decrement with a conditional write —
`UPDATE cards SET sold = sold + 1 WHERE id = ? AND sold < supply RETURNING sold` (D1 supports RETURNING). If no row returned → sold out → (real mode: refund via Stripe API and log; demo: reject). Serial number = returned `sold`. Insert a row into `sales` (card_id, serial, amount_cents, fee_cents, mode, session_id UNIQUE — idempotency: a replayed webhook must not double-fulfill).

## Sim market game loop (client-side, builder page only)
Fair value = $1,000,000 ÷ supply. r = simPrice / fair.
- r ≤ 1.5: frequent buys, hype messages; supply ticks down; total-raised counter climbs; reaching 0 → SIM SOLD OUT celebration + reset.
- 1.5 < r ≤ 100: occasional buys, mixed/skeptical messages, lowball offers.
- r > 100: near-zero buys, open mockery; rare "ironic whale" buys one.
Feed messages are randomized from pools per band, with fake usernames. Clearly labeled SIMULATION. Price input accepts $0.01 up to $10,000,000,000,000 (sim only) with compact formatting ($4.2K, $10T).

## PNG export (verified feasible on this machine)
Draw the card DIRECTLY on a `<canvas>` (do NOT use html2canvas/DOM capture): holo-gradient frame, photo (data URL — never taints), name, tagline, supply, serial (#001/100 style), ME COIN branding. Export 600×840 @2x via `toDataURL`, download as `mecoin-<slug>.png`. Used on builder (preview), card page (owner), success page (buyer, with their serial).

## Security & compliance (review lenses will hunt for these)
- **XSS:** user-supplied name/tagline/photo render on home, card page, OG tags, feeds. Escape EVERYTHING: server-side HTML-escape for template injection (including `</script>` sequences inside the JSON payload — escape `<` as `<`); client-side use `textContent`, never `innerHTML`, for user data. Photos: enforce `data:image/(jpeg|png|webp);base64,` prefix server-side.
- **CSP header** on HTML responses: default-src 'self'; img-src 'self' data:; style/font allowances for Google Fonts; no inline-script ban required if needed (document the choice).
- Validate every input server-side (lengths, ranges, types). Amounts are integers in cents only.
- Webhook: async SubtleCrypto verification as above. Never trust client-reported payment success in real mode.
- **No investment language** anywhere near the real BUY flow. Every card page footer: "ME COIN cards are digital collectibles for fun. They are not investments, securities, or stores of value. No resale market is provided or promised."
- `/rules`: no adult content, no impersonation, no harassment; reports reviewed; cards can be removed.
- Basic abuse caps: max 20 mints per IP per hour (D1 count check), photo size cap, report length cap.

## Aesthetic
See DESIGN.md. Non-negotiable: it must NOT look like generic AI slop. Commit fully.

## Definition of Done (each verified end-to-end before delivery)
1. Home loads; builder works; sim feed tone/buy-rate tracks the price band; sim sellout reachable; $10T formats compactly.
2. Mint with photo → persists → `/c/:id` renders with correct OG tags and card data after full page reload.
3. PNG download round-trip-decodes as a valid image with serial number.
4. Demo checkout: pay $5 → success page with serial; supply decremented; sale appears in card-page feed; $0.49 rejected server-side; buying the final copy triggers SOLD OUT and further checkouts are refused.
5. XSS probe: mint a card named `<img src=x onerror=alert(1)>` with tagline `"><script>window.xss=1</script>` — no script execution anywhere it renders; page still renders the literal text.
6. Replayed fulfill call with the same session id does not double-sell (idempotency).
7. Disclaimer on every card page; /rules reachable; report POST stores a row.
8. Deployed at me-coin.deadbeatradar.workers.dev with all of the above re-verified live (demo mode).
9. README.md contains the flip-to-real-Stripe runbook (test keys → webhook → Connect → restricted-business preapproval for live).
