# Laptop Cinematic Rebuild — spec (igloo-style, laptop replaces vault)

Local only. No prod deploy. No deploy to c0nsen7.xyz.

## Goal
`startup-kit/site/index-laptop.html` — same cinematic grammar as `index-3d.html`
(fixed 3D stage + scrolling chambers + loader veil) but the 3D hero is an
original laptop (desk / audit-trail screen), not gates/vault/igloo.

## Hard constraints
1. ORIGINAL CODE ONLY — write `shared/laptop-webgl.v1.js` from scratch.
   Do not copy `igloo-webgl.js` / `igloo-hero*.js` / any `*.inc`. No igloo
   geometry, no gate rings, no copied functions. Laptop from primitives.
2. COPY/PRICES IDENTICAL — chambers reuse index-3d.html copy verbatim:
   H1 "Hire your first AI employee this week.", lede with "pauses for your
   approval before anything is submitted", trust rows, workforce cards
   (Data Clerk / QA Analyst / Outreach Assistant), rate line
   "Data Clerk $500+$300 · QA $750+$400 · Outreach $500+$300", rate-detail
   cards ($500+$300/mo $4,100 / $750+$400/mo $5,550 / $500+$300/mo $4,100),
   pilot + guarantee rows, footer "Prefer the classic page? Back to home".
3. FAIL-SAFE NEVER-BLACK — emerald gradient stage always under canvas;
   Canvas 2D laptop fallback paints in <1s with zero deps; transparent
   WebGL clear only (no fillRect black, no opaque clear); pure-CSS static
   laptop glyph carries page if all JS fails; veil lifts on first frame
   AND self-fades via CSS ~3s; <noscript> kills veil.
4. GUARDS — prefers-reduced-motion = one static frame, no rAF loop;
   JS-off = content + static glyph readable; 390px = reduced particle
   budget + single-column + smaller glyph; DPR capped 1.25; pause offscreen
   (IntersectionObserver) + on hidden tab; never trap scroll.
5. JS < 200KB — `laptop-webgl.v1.js` must be < 204800 bytes (target < 35KB).
6. VERSIONED FILENAMES — `laptop-webgl.v1.js` (v1 in name beats cache;
   bump to v2 on change, never overwrite unversioned).
7. FRESH-PORT NO-STORE SERVER — serve `startup-kit/site` on a fresh port
   (probe free, e.g. 8xxx) with `Cache-Control: no-store` on every response.
8. PROOF — curl (status, no-store, copy strings, size, no igloo refs) +
   screenshots (desktop 1280 + mobile 390 + reduced-motion + js-off) +
   console-zero (no pageerrors, no console errors).

## Order + file ownership
- UI Designer → `index-laptop.html` markup+CSS (owns HTML/CSS, copy lock)
- 3D Dev → `shared/laptop-webgl.v1.js` (owns WebGL + 2D fallback, no one else touches)
- Frontend → `scripts/serve-laptop-nostore.cjs` + `scripts/proof-laptop-5s.mjs` (owns wiring/servers/scripts)
- Verify → `evidence/laptop-rebuild/VERIFY.md` + screenshots (owns evidence only)
