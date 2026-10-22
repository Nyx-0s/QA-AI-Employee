#!/bin/bash
# 5-second proof script (local only, no deploy).
# Usage: bash scripts/proof-laptop-5s.sh [port]
# Boots the no-store server if needed, then: curl checks + playwright
# screenshots (desktop 1280, mobile 390, reduced-motion, js-off) + console-zero.
set -u
PORT="${1:-}"
SRV_PID=""
if [ -z "$PORT" ]; then
  node scripts/serve-laptop-nostore.cjs 0 > /tmp/laptop-srv.log 2>&1 &
  SRV_PID=$!
  for i in $(seq 1 50); do
    PORT=$(sed -n 's/.*port=\([0-9]*\).*/\1/p' /tmp/laptop-srv.log | head -1)
    [ -n "$PORT" ] && break
    sleep 0.2
  done
fi
echo "== proof on http://127.0.0.1:${PORT}/index-laptop.html =="
echo "--- curl: status + no-store ---"
curl -sI "http://127.0.0.1:${PORT}/index-laptop.html" | grep -iE "HTTP/|cache-control"
echo "--- curl: copy/price strings ---"
for s in "Hire your first AI employee this week" "Data Clerk \$500+\$300" "QA \$750+\$400" "Outreach \$500+\$300" "First-year total \$4,100" "First-year total \$5,550" "free 7-day pilot" "30-day guarantee"; do
  curl -s "http://127.0.0.1:${PORT}/index-laptop.html" | grep -qF "$s" && echo "OK: $s" || echo "MISS: $s"
done
echo "--- curl: original-code + size guards ---"
JSBYTES=$(curl -s "http://127.0.0.1:${PORT}/shared/laptop-webgl.v1.js" | wc -c)
echo "laptop-webgl.v1.js bytes=${JSBYTES} (limit 204800)"
curl -s "http://127.0.0.1:${PORT}/index-laptop.html" | grep -qiE "igloo|vault-gl|vault-gate|\.inc" && echo "FAIL: igloo/vault/inc ref found" || echo "OK: no igloo/vault/inc refs"
echo "--- playwright: screenshots + console-zero ---"
URL="http://127.0.0.1:${PORT}/index-laptop.html" node --input-type=module -e '
import { chromium } from "@playwright/test";
const url = process.env.URL || process.argv[1];
const errs = [];
const b = await chromium.launch();
const p = async (name, opts = {}) => {
  const ctx = await b.newContext({ viewport: opts.vp || { width: 1280, height: 800 }, reducedMotion: opts.rm || "no-preference", javaScriptEnabled: opts.js === undefined ? true : opts.js });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errs.push(name + " pageerror: " + e.message));
  pg.on("console", m => { if (m.type() === "error") errs.push(name + " console: " + m.text()); });
  await pg.goto(url, { waitUntil: "load", timeout: 20000 });
  await pg.waitForTimeout(opts.wait ?? 5000);
  await pg.screenshot({ path: `screenshots/laptop-rebuild/${name}.png` });
  // scroll per chamber for cinematic frames
  const chambers = await pg.$$("[data-chamber]");
  for (let i = 0; i < chambers.length; i++) {
    try { await chambers[i].scrollIntoViewIfNeeded(); await pg.waitForTimeout(900); await pg.screenshot({ path: `screenshots/laptop-rebuild/${name}-ch${i}.png` }); } catch {}
  }
  await ctx.close();
};
await p("desktop-1280");
await p("mobile-390", { vp: { width: 390, height: 844 } });
await p("reduced-motion", { rm: "reduce" });
await p("js-off", { js: false, wait: 2500 });
await b.close();
if (errs.length) { console.log("CONSOLE-ERRORS:\n" + errs.join("\n")); process.exit(2); }
console.log("CONSOLE-ZERO: no pageerrors, no console errors across 4 contexts");
'
RC=$?
if [ -n "$SRV_PID" ]; then kill "$SRV_PID" 2>/dev/null; fi
echo "proof exit=${RC}"
exit $RC
