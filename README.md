# ME COIN

Mint yourself as a limited-supply digital trading card. Share the link. People buy it for
real money at **whatever price they choose** (pay-what-you-want, $0.50 floor). The card is
"worth" what people actually pay. Satirical, but the payments are real.

- **Stack:** one Cloudflare Worker (plain JS ES modules, zero runtime dependencies), D1 for
  all state, static assets from `public/`. Stripe is called with raw `fetch` — no SDK.
- **Two modes, same fulfillment code path:**
  - **DEMO** (default — no Stripe key set): checkout goes to a clearly-labeled simulated
    payment page, onboarding is instant. Great for local dev and staging.
  - **REAL** (Stripe secret key set): Stripe Checkout destination charges with a 10%
    platform fee, Connect Express seller onboarding, signature-verified webhooks.

## Quick start (demo mode)

```sh
npm install        # installs wrangler (the only dependency, dev-only)
npx wrangler dev   # http://localhost:8787
```

That's it. The D1 schema creates itself lazily on the first request — no migration step,
locally or in production. With no `STRIPE_SECRET_KEY` set you are in DEMO mode: mint a
card, click onboard (instant), buy it with play money, watch the supply tick down.

## Deploy

```sh
npx wrangler d1 create me-coin-db
# copy the database_id from the output into wrangler.jsonc
# (replace the literal string REPLACE_AT_DEPLOY)

npx wrangler deploy
```

The Worker serves everything: static pages from `public/`, dynamic routes
(`/api/*`, `/c/*`, `/webhook`, `/demo-pay`, `/success`, `/admin/*`) run worker-first.

### Admin (optional)

```sh
npx wrangler secret put ADMIN_KEY
```

Then visit `/admin/reports?key=<your key>` to review user reports and hide cards.
Without `ADMIN_KEY` set, admin routes always answer 401.

## Project layout

```
src/index.js       Worker entry: router, schema bootstrap, all handlers, fulfillSale
src/constants.js   Shared limits/constants (mirrors ARCHITECTURE.md §2)
src/stripe.js      Raw-fetch Stripe client + manual webhook signature verification
public/            Frontend (owned by the frontend build — do not edit from backend)
wrangler.jsonc     Worker config: ASSETS binding, D1 binding, run_worker_first routes
```

## Environment variables

| Variable | Required | Effect |
|---|---|---|
| `STRIPE_SECRET_KEY` | no | Setting it flips the app from DEMO to REAL mode |
| `STRIPE_WEBHOOK_SECRET` | in real mode | Verifies `/webhook` signatures (`whsec_...`) |
| `STRIPE_PUBLISHABLE_KEY` | no | Exposed to the frontend via `GET /api/config` in real mode |
| `ADMIN_KEY` | no | Enables `/admin/reports` and `POST /admin/hide` |

All of these are Wrangler secrets in production (`npx wrangler secret put NAME`). Never
put them in `wrangler.jsonc` or git.

---

## FLIP-TO-REAL-STRIPE runbook

Demo mode needs nothing. Going real is a staged process — do it in this order.

### Phase 1 — Stripe test mode

1. Create/log into your Stripe account at <https://dashboard.stripe.com> and toggle
   **Test mode** on.
2. Grab the **test** API keys (Developers → API keys): `sk_test_...` and `pk_test_...`.
3. Set them on the deployed Worker:

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY        # paste sk_test_...
   npx wrangler secret put STRIPE_PUBLISHABLE_KEY   # paste pk_test_...
   ```

   The moment `STRIPE_SECRET_KEY` exists, the app is in REAL mode (test money):
   `/demo-pay` and `/api/demo-pay/confirm` start returning 404, checkout goes to
   Stripe-hosted pages, and fulfillment moves to the webhook.

   For local testing instead, put the keys in a `.dev.vars` file (git-ignored):

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### Phase 2 — webhook endpoint (fulfillment depends on this)

In REAL mode a sale is fulfilled ONLY when Stripe delivers `checkout.session.completed`.
No webhook → buyers pay but never get a serial.

1. Dashboard → Developers → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://me-coin.<your-subdomain>.workers.dev/webhook`
3. Events: select exactly **`checkout.session.completed`**.
4. Copy the endpoint's **Signing secret** (`whsec_...`) and set it:

   ```sh
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   (For `wrangler dev`, use `stripe listen --forward-to localhost:8787/webhook` from the
   Stripe CLI and put the printed `whsec_...` into `.dev.vars`.)

The Worker verifies signatures manually (HMAC-SHA256 over `t.rawBody`, constant-time
compare, 5-minute staleness window) — bad or stale signatures are rejected with 400.

### Phase 3 — Connect Express (sellers), still in test mode

1. Dashboard → **Connect** → finish the Connect onboarding for your platform and enable
   **Express** accounts.
2. On a card page, click the owner onboarding button. You'll be redirected to a
   Stripe-hosted Express test onboarding flow. Use Stripe's test data to complete it:
   - Phone: `000 000 0000`, SMS code: `000-000`
   - SSN last 4: `0000` (or full SSN `000-00-0000`)
   - Any future date of birth that makes the person 18+, any address
   - Test bank account: routing `110000000`, account `000123456789`
3. Back on the card page (`?onboard=return`), the app re-polls `charges_enabled` and the
   card flips to buyable.
4. Run a full test purchase with card `4242 4242 4242 4242` (any future expiry, any CVC):
   buyer pays → webhook fires → success page shows the serial → seller's Express balance
   shows the amount minus the 10% application fee.

### Phase 4 — go-live checklist

1. **Activate your Stripe account** (Dashboard → complete business activation) so live
   charges are allowed.
2. **Complete the platform profile**: <https://dashboard.stripe.com/settings/connect/platform-profile>.
   Stripe requires this before a platform can process live Connect charges.
3. **Restricted-business preapproval:** user-generated-content marketplaces / content
   platforms sit on Stripe's restricted list and may need written preapproval. Contact
   Stripe support, describe ME COIN (digital collectible cards, pay-what-you-want,
   platform as merchant of record, 10% application fee, destination charges) and get
   confirmation BEFORE taking live money.
4. **Per-country onboarding:** V1 is US-only. Express availability, identity
   requirements, and payout rules differ per country — if you later allow non-US sellers,
   set `country` explicitly at account creation and review each country's requirements.
   Until then, expect non-US sellers to fail onboarding.
5. **Swap to live keys** (Dashboard with Test mode OFF → Developers → API keys):

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_...
   npx wrangler secret put STRIPE_PUBLISHABLE_KEY   # pk_live_...
   ```

6. **Create a LIVE webhook endpoint** (live mode has its own endpoints and secrets):
   same URL, same single event, then:

   ```sh
   npx wrangler secret put STRIPE_WEBHOOK_SECRET    # the live whsec_...
   ```

7. Re-run the full smoke flow with a real card for a small amount ($0.50 floor), confirm
   the webhook delivers, the serial is assigned, the fee splits correctly, and a sold-out
   replay refunds automatically (watch `wrangler tail` for refund logs).

### Rollback to demo

```sh
npx wrangler secret delete STRIPE_SECRET_KEY
```

No secret key → the very next request is back in DEMO mode (simulated payments,
404 webhook). Existing real sales rows stay in D1 untouched.

---

## Behavior notes

- **Oversell protection:** `UPDATE cards SET sold = sold + 1 WHERE id = ? AND sold < supply ... RETURNING sold`
  — the conditional write is the lock. A purchase that lands after sellout is refunded
  automatically (real mode) or rejected with 409 (demo mode).
- **Idempotency:** `sales.session_id` is UNIQUE. Replayed webhooks / demo confirms return
  the original serial and never double-decrement supply.
- **Creator identity:** minting returns a `manage_key` exactly once; only its SHA-256
  digest is stored. Losing the key means losing owner actions (onboard/delist) — there is
  no recovery, by design.
- **Rate limiting:** max 20 mints per IP per rolling hour (429 after that).
- **Content safety:** every user string is HTML-escaped server-side; JSON payloads
  embedded in HTML escape `<`, `>`, `&`, U+2028/U+2029 so `</script>` breakout is
  impossible; photos must be `data:image/(jpeg|png|webp);base64,` and ≤ 500 KiB.
  CSP is sent on every HTML response. Reports land in D1; `/admin/reports` reviews them.
