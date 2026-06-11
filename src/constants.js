// ME COIN — shared constants (ARCHITECTURE.md §2 — EXACT values; changes land
// with a matching ARCHITECTURE.md edit in the same commit).

export const VERSION = 'v0.5.0';             // bumped on every release; live at /api/config

export const AMOUNT_MIN_CENTS = 100;         // $1.00 — creator net must never be $0
export const AMOUNT_MAX_CENTS = 99999999;    // schema bound only — launch caps below rule
export const LAUNCH_PRICE_CAP_CENTS = 50000; // $500 max per sale during launch
export const YOUNG_CARD_CAP_CENTS  = 10000;  // $100 max per sale, card's first 7 days
export const YOUNG_CARD_MS        = 7 * 86400000;
export const SUPPLY_MIN      = 1;
export const SUPPLY_MAX      = 1000;
export const NAME_MAX        = 40;           // characters (after .trim())
export const TAGLINE_MAX     = 100;          // characters (after .trim())
export const REASON_MAX      = 300;          // report reason characters
export const PHOTO_MAX_CHARS = 512000;       // dataURL STRING length ≤ 500 KiB
export const OG_MAX_CHARS    = 307200;       // og unfurl image dataURL cap (~300 KiB)
export const PHOTO_PREFIX_RE = /^data:image\/(jpeg|png|webp);base64,/;
// Additive platform fee: $0.30 + 10%, never more than the amount itself.
// Covers Stripe's ~2.9% + 30¢ so every sale is unit-positive.
export const FEE_FIXED_CENTS = 30;
export const FEE_RATE        = 0.10;
export const feeCents = (amountCents) =>
  Math.min(amountCents, FEE_FIXED_CENTS + Math.round(amountCents * FEE_RATE));
export const MINT_LIMIT_PER_IP = 20;         // per rolling 3600s window → 429
export const CHECKOUT_LIMIT_PER_IP = 10;     // checkout sessions per IP per hour → 429
export const REPORT_AUTOHIDE_COUNT = 3;      // distinct reports in 7 days → card hidden
export const REPORT_AUTOHIDE_MS    = 7 * 86400000;
export const DISPUTE_AUTOHIDE_COUNT = 2;     // disputes → card hidden
export const QUICK_CHIPS_CENTS = [100, 500, 2000];  // $1 / $5 / $20
