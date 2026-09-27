/**
 * Morning audit — the pipeline's daily self-check, designed for a scheduler.
 *
 *   node sales/morning-audit.mjs          (or via sales/daily-audit.sh)
 *
 * Behavior (per the operator's spec):
 *   - runs sales/pipeline-tick.mjs (the full check battery) fresh every run
 *   - appends ONE line to sales/audit-log.md recording the verdict + counts
 *   - prints ONLY what needs a human: drift (failing checks), nudge-due rows,
 *     or an empty FREELLMAPI key (the real-model unblock stays blocked)
 *   - all green + no nudges + key present → a single "OK" line, exit 0
 *   - anything needs attention → those exact lines, exit 1 (scheduler-visible)
 *
 * Never edits files to make checks pass — reporting is its whole job.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const AUDIT_LOG = join(HERE, "audit-log.md");
const LAST_TICK = join(ROOT, "sales/last-tick.json");

const ts = new Date().toISOString().replace("T", " ").slice(0, 16);

// 1. fresh tick — never trust a stale last-tick.json.
// NOTE (bug found by the injected-drift test, 2026-09-19): pipeline-tick exits
// 1 when checks FAIL — a non-zero exit here is usually DRIFT, not a crash.
// It always writes last-tick.json before exiting, so read the verdict either
// way; only a missing/unparseable file is a genuine AUDIT ERROR.
let tickError = null;
try {
  execFileSync("node", ["sales/pipeline-tick.mjs"], { cwd: ROOT, stdio: "pipe" });
} catch (e) {
  tickError = e;
}

// 2. read the tick's verdict
if (!existsSync(LAST_TICK)) {
  appendFileSync(AUDIT_LOG, `${ts} | AUDIT ERROR | last-tick.json missing${tickError ? ` (tick exit != 0: ${String(tickError).slice(0, 100)})` : ""}\n`);
  console.log("AUDIT ERROR — last-tick.json missing after tick");
  process.exit(1);
}
let tick;
try {
  tick = JSON.parse(readFileSync(LAST_TICK, "utf8"));
} catch (e) {
  appendFileSync(AUDIT_LOG, `${ts} | AUDIT ERROR | last-tick.json unparseable: ${String(e).slice(0, 100)}\n`);
  console.log("AUDIT ERROR — last-tick.json unparseable");
  process.exit(1);
}
const drift = tick.checks.filter((c) => !c.ok);
const nudges = Array.isArray(tick.nudgesDue) ? tick.nudgesDue : [];

// 2b. empty-key watch (added 2026-09-24): an unsaved key paste silently blocks
// the real-model unblock (consentark/docs/real-model-findings.md — the .env
// sat with an empty FREELLMAPI_KEY for days while pastes landed elsewhere).
// Presence-only: the value is NEVER printed, logged, or stored — same
// discipline as keycheck (length/presence at most).
const ENV_PATH = join(ROOT, "consentark/.env");
let keyState = "FILE-MISSING";
if (existsSync(ENV_PATH)) {
  const envLine = readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .find((l) => /^\s*FREELLMAPI_KEY\s*=/.test(l));
  if (!envLine) keyState = "LINE-MISSING";
  else {
    const raw = envLine
      .slice(envLine.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    keyState = raw.length === 0 ? "EMPTY" : "SET";
  }
}
const keyFlags =
  keyState === "SET"
    ? []
    : [
        keyState === "FILE-MISSING"
          ? "consentark/.env not found"
          : keyState === "LINE-MISSING"
            ? "consentark/.env has no FREELLMAPI_KEY line"
            : "FREELLMAPI_KEY in consentark/.env is still empty",
      ];

// 3. one line in the audit log — the daily system of record
const verdict =
  drift.length === 0 && nudges.length === 0 && keyFlags.length === 0
    ? "OK"
    : "ATTENTION";
let line = `${ts} | ${verdict} | rows=${tick.rows} sent=${tick.sent} pending=${tick.pending} | drift=${drift.length} nudges=${nudges.length} key=${keyState}`;
if (drift.length) line += ` | ${drift.map((c) => `${c.name}(${c.detail})`).join("; ")}`;
if (nudges.length) line += ` | nudge-due: ${nudges.join("; ")}`;
if (keyFlags.length) line += ` | ${keyFlags.join("; ")}`;
appendFileSync(AUDIT_LOG, line + "\n");

// 4. report ONLY what needs a human (quiet when clean)
if (verdict === "OK") {
  console.log(`OK ${ts} — rows=${tick.rows} sent=${tick.sent}, nothing needs you.`);
  process.exit(0);
}
for (const c of drift) console.log(`DRIFT ${c.name}: ${c.detail} — fix files, never counts`);
for (const n of nudges) console.log(`NUDGE DUE: ${n}`);
for (const k of keyFlags)
  console.log(
    `KEY EMPTY: ${k} — the real-model unblock stays blocked. Save the key, then: bash consentark/scripts/real-model-unblock.sh (see consentark/docs/real-model-findings.md)`,
  );
process.exit(1);
