# ME COIN — safety runbook

The product sells photographs of people. That makes safety the load-bearing
system, not a feature. This runbook covers what is enforced in code today,
what is process, and what to do when something bad arrives.

## Enforced in code (grep-able)

| Control | Where | Behavior |
|---|---|---|
| 18+ / adult-subject attestation | `handleMint` (`src/index.js`) | Mint 400s without `adult_attested: true` and a valid `attestation` of `self`/`parody`/`tribute` |
| Disclosure badges | `card-page.js` | Non-`self` cards render a visible PARODY / FAN TRIBUTE badge |
| Public-figure blocklist | `src/blocklist.js` | Normalized name match → mint 400s, manual contact required |
| Human photo review before real money | `handleCheckout` | Real-mode checkout 409s until `reviewed = 1`; demo unaffected |
| Review queue | `GET /admin/queue` + `POST /admin/approve` | Founder reviews every card photo before approving real charges |
| Report auto-hide | `handleReport` | 3+ reports within 7 days hides the card pending review |
| Dispute auto-hide | `handleWebhook` (`charge.dispute.created`) | 2+ disputes hides the card; every dispute is recorded in the `disputes` table |
| Launch price caps | `handleCheckout` / `handleDemoConfirm` | $500/sale, $100/sale for cards under 7 days old |
| Checkout velocity | `handleCheckout` | 10 checkout sessions per IP per hour |

## Review procedure (invite-only scale: review 100%)

1. Open `/admin/queue?key=<ADMIN_KEY>` daily, or whenever a mint notification arrives.
2. For each card: open the photo. Approve ONLY if the subject is clearly an
   adult and the card isn't impersonation, harassment, or sexual content.
3. Unsure about age → do not approve. Hide and wait for contact.
4. `APPROVE` switches real charges on. `HIDE` makes the card nonexistent on
   every public route.

## If CSAM arrives

1. Do NOT download, screenshot, or forward the image.
2. Hide the card immediately (`/admin/queue` → HIDE, or `/admin/hide`).
3. Preserve the D1 row (do not delete — law enforcement may need it).
4. Report to NCMEC: https://report.cybertip.org (CyberTipline). Include the
   card id, mint IP (`cards.mint_ip`), and timestamp.
5. Cloudflare CSAM scanning is enabled on the zone when the dedicated domain
   lands (30-day window item) — until then, human review is the gate, which is
   why no card takes real money unreviewed.

## Takedowns ("that's me and I didn't agree")

1. Reports arrive via the card-page Report link → `/admin/reports`.
2. Identity-theft / right-of-publicity claims: hide first, ask questions after.
   Hiding is reversible by re-running the review; harm isn't.
3. Three reports in 7 days auto-hide without waiting for a human.

## Escalation

- Disputes ≥ 0.3% of sales: stop. Pause real-mode (unset `STRIPE_SECRET_KEY`)
  and investigate before the processor investigates us.
- Anything involving a minor: the NCMEC flow above, same day.
- Legal contact lands: preserve everything, respond through counsel
  (retained from day-30 funds per the roadmap).
