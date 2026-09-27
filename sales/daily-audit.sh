#!/bin/sh
# Daily pipeline audit — the thing a scheduler calls every morning.
# Quiet when clean; exits 1 on drift or nudge-due rows (cron mail fires).
# Cron-safe (2026-09-20): cron's PATH is minimal and node lives in
# ~/.local/bin, so resolve node explicitly — PATH first, known path fallback.
cd "$(dirname "$0")/.." || exit 2
NODE="$(command -v node 2>/dev/null)"
[ -x "$NODE" ] || NODE="$HOME/.local/bin/node"
exec "$NODE" sales/morning-audit.mjs
