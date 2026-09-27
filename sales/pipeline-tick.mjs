/**
 * Pipeline tick — ONE command the operator (or any scheduled run) can use to
 * verify the whole pipeline in under a second, and to watch for nudge-due
 * rows once sends exist.
 *
 *   node sales/pipeline-tick.mjs
 *
 * Checks (mirrors the 8-point battery exactly):
 *   1 quality checker passes on all drafts
 *   2 nudge precompute clean
 *   3 ledger row count == Rows-line count
 *   4 draft files == rows (+1 SAMPLE)
 *   5 PENDING drafts == rows
 *   6 nudge calendar rows == rows
 *   7 evidence archives == SENT rows
 *   8 summary headline SENT count == ledger SENT count
 *   9 send-transport CLI branch-order guard (pins the --send-batch/--plan fix)
 * Plus: nudge watch (any SENT row whose due date has passed is listed).
 * Writes sales/last-tick.json so an unattended session can diff two ticks.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isNudgeDue } from "./nudge-calendar.mjs";

const ROOT = process.cwd();
const out = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", cwd: ROOT });

const ledgerText = readFileSync(join(ROOT, "sales/ledger.md"), "utf8");
const rows = ledgerText.split("\n").filter((l) => /^\| P-\d+ \|/.test(l));
const rowsLine = (ledgerText.match(/\*\*Rows:?\s*(\d+)/) || [])[1]; // "**Rows: 38**"
const sentRows = rows.filter((l) => /\| SENT —/.test(l));
const cutRows = rows.filter((l) => /\| CUT /.test(l)); // operator-killed prospects: excluded from the PENDING arithmetic
const draftFiles = readdirSync(join(ROOT, "outreach/drafts")).filter((f) => f.endsWith(".md"));
const realFiles = draftFiles.filter((f) => !f.includes("SAMPLE"));
// Reply-response drafts (sales/reply-playbooks.md, filename contains "-reply-")
// are responses to existing rows, not one-per-row discovery drafts — the battery
// counts them separately so the files==rows invariant survives a reply session.
const replyFiles = realFiles.filter((f) => f.includes("-reply-"));
const workFiles = realFiles.filter((f) => !f.includes("-reply-"));
const pendingFiles = realFiles.filter((f) => readFileSync(join(ROOT, "outreach/drafts", f), "utf8").includes("APPROVAL: PENDING"));
const pendingWork = workFiles.filter((f) => readFileSync(join(ROOT, "outreach/drafts", f), "utf8").includes("APPROVAL: PENDING"));
const rowsWithMid = rows.filter((l) => /message-id\s+\S+@/.test(l));
const calendarRows = existsSync(join(ROOT, "sales/nudge-due-dates.md"))
  ? (readFileSync(join(ROOT, "sales/nudge-due-dates.md"), "utf8").match(/^\| P-\d+/gm) || []).length
  : 0;
const archives = existsSync(join(ROOT, "sales/send-evidence-log.md"))
  ? (readFileSync(join(ROOT, "sales/send-evidence-log.md"), "utf8").match(/^## /gm) || []).length
  : 0;
let summarySent = -1;
for (const f of readdirSync(join(ROOT, "sales")).filter((x) => x.startsWith("summary-")).sort().reverse()) {
  const m = readFileSync(join(ROOT, "sales", f), "utf8").match(/\|\s*Sends?\s*\|\s*\**(\d+)\**/i); // "| Sends | **0** |"
  if (m) { summarySent = Number(m[1]); break; }
}

const quality = out("node", ["sales/quality-check.mjs"]);
const qualityOk = /(\d+)\/(\d+) drafts pass/.test(quality) && RegExp.$1 === RegExp.$2;
const precomp = out("node", ["sales/nudge-precompute.mjs"]);
const precompOk = /\d+ SENT-eligible rows, 0 problem/.test(precomp);

// check 9 — pins the transport CLI dispatch fix (2026-09-20): --send-batch must
// never be shadowed by --plan (or any sibling action flag). Runs the subprocess
// test; any failure here means the send path is not the branch it claims to be.
let cliGuard = { ok: false, detail: "test failed to run" };
try {
  const g = out("node", ["sales/test-send-transport-cli.mjs"]);
  cliGuard = { ok: /CLI guard checks pass/.test(g) && !/FAIL /.test(g), detail: (g.match(/\d+\/\d+ CLI guard checks pass/) || ["see sales/test-send-transport-cli.mjs"])[0] };
} catch { /* keep the failure state */ }

// check 7b — reply-log ↔ response drafts (reply playbooks, 2026-09-24):
// every classification block in the reply archive must have its response
// draft on disk, and every reply draft must point back at a reply-log entry.
// Link key: the draft FILENAME (schema-required in each entry's response-draft
// line) — unique and mechanical, unlike the H1 prose title.
const replyLogText = existsSync(join(ROOT, "sales/reply-log.md"))
  ? readFileSync(join(ROOT, "sales/reply-log.md"), "utf8") : "";
const replyEntries = (replyLogText.match(/^## .+ — received \d{4}-\d{2}-\d{2}/gm) || []);
const replyDrafts = replyFiles.map((f) => readFileSync(join(ROOT, "outreach/drafts", f), "utf8"));
const replyLogDraftRefs = [...replyLogText.matchAll(/outreach\/drafts\/(\S*-reply-\S*\.md)/g)]
  .map((m) => m[1])
  .filter((f) => /^\d{4}-\d{2}-\d{2}-/.test(f)); // exclude the schema placeholder line (YYYY-MM-DD template)
const replyEntriesMissingOnDisk = replyLogDraftRefs.filter((f) => !existsSync(join(ROOT, "outreach/drafts", f)));
const replyDraftsWithoutEntry = replyFiles.filter((f) => !replyLogText.includes(f)).length;
const replyArchiveOk = {
  ok: replyEntriesMissingOnDisk.length === 0 && replyDraftsWithoutEntry === 0,
  detail: `${replyEntries.length} logged repl(y|ies), ${replyFiles.length} response draft(s), ${replyDraftsWithoutEntry} draft(s) without an entry, ${replyEntriesMissingOnDisk.length} entry/entries missing on disk`,
};

const checks = [
  { name: "1 quality", ok: qualityOk, detail: (quality.match(/\d+\/\d+ drafts pass/) || ["?"])[0] },
  { name: "2 precompute", ok: precompOk, detail: (precomp.match(/\d+ SENT-eligible rows, 0 problem/) || ["see log"])[0] },
  { name: "3 ledger=Rows-line", ok: String(rows.length) === rowsLine, detail: `${rows.length} vs ${rowsLine}` },
  { name: "4 files=rows+SAMPLE", ok: workFiles.length === rows.length && draftFiles.length === rows.length + 1 + replyFiles.length, detail: `${workFiles.length}+1(+${replyFiles.length} reply) vs ${rows.length}` },
  { name: "5 PENDING=rows-not-SENT/CUT", ok: pendingWork.length === rows.length - rowsWithMid.length - cutRows.length, detail: `${pendingWork.length} vs ${rows.length - rowsWithMid.length - cutRows.length}` },
  { name: "6 calendar=rows", ok: calendarRows === rows.length, detail: `${calendarRows} vs ${rows.length}` },
  { name: "7 archives=SENT", ok: archives === rowsWithMid.length, detail: `${archives} vs ${rowsWithMid.length} (rows carrying message-id evidence)` },
  { name: "7b reply-log↔drafts", ok: replyArchiveOk.ok, detail: replyArchiveOk.detail },
  { name: "8 summary=SENT", ok: summarySent === sentRows.length, detail: `summary ${summarySent} vs ledger ${sentRows.length}` },
  { name: "9 cli-guard", ok: cliGuard.ok, detail: cliGuard.detail },
];

// nudge watch — only meaningful once rows are SENT
const today = new Date().toISOString().slice(0, 10);
const nudgesDue = [];
for (const l of sentRows) {
  const m = l.match(/nudge due (\d{4}-\d{2}-\d{2})/);
  if (m && isNudgeDue(m[1], today)) nudgesDue.push(`${l.split("|")[2].trim()} (due ${m[1]})`);
}

const allOk = checks.every((c) => c.ok);
const tick = {
  at: new Date().toISOString(),
  rows: rows.length, sent: sentRows.length, pending: pendingFiles.length,
  replies: replyFiles.length,
  checks, allOk, nudgesDue,
};
writeFileSync(join(ROOT, "sales/last-tick.json"), JSON.stringify(tick, null, 2) + "\n");

for (const c of checks) console.log(`${c.ok ? " OK " : "FAIL"} ${c.name.padEnd(22)} ${c.detail}`);
console.log(`---- rows=${rows.length} sent=${sentRows.length} pending=${pendingFiles.length}${cutRows.length ? ` cut=${cutRows.length}` : ""}${replyFiles.length ? ` replies=${replyFiles.length}` : ""}`);
if (nudgesDue.length) console.log(`NUDGES DUE (${nudgesDue.length}):\n  ` + nudgesDue.join("\n  "));
else if (sentRows.length) console.log("nudge watch: no nudges due today");
console.log(allOk ? "TICK: ALL GREEN" : "TICK: DRIFT DETECTED — fix files, never counts");
process.exit(allOk ? 0 : 1);
