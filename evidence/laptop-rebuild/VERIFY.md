# Laptop rebuild — VERIFY log (local only, no prod deploy)

Date: 2026-10-05. Server: `scripts/serve-laptop-nostore.cjs` on fresh port 60103,
every response `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`.
Page: `startup-kit/site/index-laptop.v1.html` → `shared/laptop-webgl.v1.js`.
Nothing was pushed, committed, or deployed; no traffic to c0nsen7.xyz.

## curl
- `GET /index-laptop.v1.html` → 200, `Cache-Control: no-store` ✓
- `GET /shared/laptop-webgl.v1.js` → 200, `Cache-Control: no-store`, 27574 bytes (< 204800) ✓
- Copy strings present (7/7): H1, approval lede, Data Clerk $500+$300,
  QA $750+$400, Outreach $500+$300, $4,100 ×2, $5,550, free 7-day pilot, 30-day guarantee ✓
- Original-code grep (`igloo|vault-gl|.inc`): 0 matches in HTML + JS ✓
- Served md5 == disk md5 (7104ccccc4e0738bf19f22fc94c99858) ✓

## Playwright (Chromium, 4 contexts, scroll-hint asserted per context)
- desktop-1280: hint "Scroll to open the laptop ↓", veil lifted, laptop screen +
  sparks visible over emerald, zero errors ✓
- mobile-390: same hint, single column, readable, zero errors ✓
- reduced-motion: same hint, one static frame (no rAF loop in code path), zero errors ✓
- js-off: same hint, veil removed by <noscript>, static CSS laptop glyph behind
  panel, full copy readable on emerald, zero errors ✓
- CONSOLE-ZERO: no pageerrors, no console errors across all 4 contexts ✓

## Screenshots
`screenshots/laptop-rebuild/v1-{desktop-1280,mobile-390,reduced-motion,js-off}.png`
plus `-ch0/-ch1/-ch2` per-chamber frames (16 files). Viewed: desktop hero,
mobile 390, js-off — all emerald, never black, correct copy.

## Guards (code + observed)
- never-black: emerald CSS gradient under transparent canvas; 2D sketch uses
  clearRect only; WebGL setClearColor alpha 0; static CSS glyph needs no JS.
- veil: lifts on first painted frame AND CSS self-fade ~2.8s; noscript hides it.
- reduced-motion: single frame, no loop (both 2D + WebGL paths).
- 390px: reduced budgets (120/70 GL, 70/36 fallback), 1fr grids, 70vmin glyph.
- DPR ≤ 1.25; IntersectionObserver + visibilitychange pause; passive listeners.

## Collision note
A sibling session (live `opencode` PID 45469) overwrote `index-laptop.html`
mid-run with its own laptop variant. My crew's deliverable moved to the
collision-proof versioned `index-laptop.v1.html`; integrity md5 held through
the full proof. Sibling files (`index-laptop.html`, `laptop-3d*.js`) untouched.
