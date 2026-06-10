# ME COIN — Design Direction (LOCKED — execute with precision)

## Concept: "BLACK-MARKET HOLO FOIL"
A back-alley trading-card shop at 3 A.M. crossed with a late-night infomercial. The product is satire — selling yourself, literally — so the design plays it dead straight, like a luxury drop site for something absurd. Confidence sells the joke.

The ONE thing people remember: **the card itself looks genuinely valuable** — a slab-graded, light-reactive holo-foil collectible of *you* — while the copy around it screams carnival barker.

## Palette (CSS variables, exactly these)
- `--void: #060608` — page background (near-black, slightly blue)
- `--paper: #f4f1e4` — primary text (warm off-white, not pure white)
- `--acid: #c8ff00` — primary accent: CTAs, prices, live numbers (acid chartreuse)
- `--heat: #ff2d87` — secondary accent: warnings, mockery, SOLD OUT (hot magenta)
- `--cyan: #21e6e6` — tertiary: links, sim labels
- `--ink: #101016` — card/panel surfaces
- Holo foil = animated conic-gradient (cyan → magenta → lime → gold → cyan) used ONLY on the card frame, serial badges, and the SOLD OUT moment. Scarcity of the effect keeps it precious.
- NO purple gradients. NO white backgrounds.

## Typography (Google Fonts)
- Display / headings / card name: **Unbounded** (700, 900) — wide, weird, crypto-brutal.
- Everything else (body, numbers, feed, labels): **IBM Plex Mono** (400, 500, 700) — terminal/ledger energy. Tabular numerals for all money figures.
- Money figures render OVERSIZED relative to labels (the number is the hero).

## Texture & atmosphere
- Full-page CRT scanline overlay (repeating-linear-gradient, ~3% opacity) + a subtle SVG-noise grain layer. Dark vignette at edges.
- Panels: 1px borders in rgba(244,241,228,.12), sharp corners (border-radius ≤ 6px) — ledger, not bubble.
- Dashed "cut here" borders and barcode/serial motifs as decorative details.

## The card (the centerpiece)
- Aspect 5:7. Holo-foil border frame (animated conic gradient, slow 8s rotation). Photo window with slight inner glow. Name in Unbounded caps. Tagline in mono italic. Bottom row: supply badge `1 OF 100`, serial, ME COIN hologram stamp.
- 3D hover: tilt toward cursor (perspective + rotateX/Y) with a moving specular light sweep; FLIP on click/hover (CSS 3D) — the back is fake fine-print: "CERTIFICATE OF SELF-WORTH", joke contract clauses, barcode, disclaimer.
- A foil shimmer that tracks the mouse across the card face (radial-gradient highlight following pointer).

## Layout
- Home: asymmetric split — the giant live card preview LEFT (sticky), the controls RIGHT stacked like a mixing desk (inputs, supply dial as a chunky range slider with tick marks, sim price, MINT button). Market feed runs as a full-width ticker/terminal strip beneath. Recently-minted gallery = slab grid at bottom.
- Card page: card centered-left, BUY box right — amount input is HUGE (the buyer types their number into a giant acid-green field), quick chips beneath, stats row (LAST PAID / AVG / RAISED / LEFT) in oversized mono.
- Section breaks: diagonal clip-path edges, not straight lines.

## Motion (high-impact moments only)
- Page load: staggered reveal (card slams in with a slight overshoot, controls cascade 60ms apart).
- Value-per-card and counters: rolling digit animation when they change.
- Feed entries: slide-in from right with a typewriter-cursor blink on the newest line.
- SOLD OUT: full-card rubber-stamp slam (scale 3→1 with rotate −12°, heat-magenta, screen shake 200ms) + holo confetti burst.
- Respect `prefers-reduced-motion`.

## Voice (copy)
Carnival-barker confidence, zero hedging: "MINT YOURSELF. SOMEONE WILL PAY." / "SUPPLY IS WHATEVER YOU SAY IT IS." / "VALUE IS A GROUP HALLUCINATION. JOIN ONE." Buy button: "NAME YOUR PRICE". Sim labels honest: "SIMULATION — THESE PEOPLE ARE NOT REAL". Legal footer plays it straight (the one serious voice on the page).

## Forbidden
Inter/Roboto/Arial/system-ui as display faces, purple-on-white, rounded-2xl cards, emoji as design elements, generic SaaS hero layouts, timid evenly-spread color.
