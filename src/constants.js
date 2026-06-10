// ME COIN — shared constants (ARCHITECTURE.md §2 — EXACT values, do not edit).

export const AMOUNT_MIN_CENTS = 50;          // $0.50 — Stripe hard minimum
export const AMOUNT_MAX_CENTS = 99999999;    // $999,999.99
export const SUPPLY_MIN      = 1;
export const SUPPLY_MAX      = 1000;
export const NAME_MAX        = 40;           // characters (after .trim())
export const TAGLINE_MAX     = 100;          // characters (after .trim())
export const REASON_MAX      = 300;          // report reason characters
export const PHOTO_MAX_CHARS = 512000;       // dataURL STRING length ≤ 500 KiB
export const PHOTO_PREFIX_RE = /^data:image\/(jpeg|png|webp);base64,/;
export const FEE_RATE        = 0.10;         // platform fee
export const feeCents = (amountCents) => Math.round(amountCents * 0.10);
export const MINT_LIMIT_PER_IP = 20;         // per rolling 3600s window → 429
export const QUICK_CHIPS_CENTS = [100, 500, 2000];  // $1 / $5 / $20
