/**
 * Send transport (autopilot path B) — the ONLY component that ever talks to
 * a real mail server, and only when the operator has pasted credentials.
 *
 * Authority model (fixed by the operator, 2026-09-19):
 *   - Credentials arrive in chat → written to consentark/.env as
 *     CA_SMTP_USER / CA_SMTP_APP_PASSWORD / CA_SMTP_HOST / CA_SMTP_PORT /
 *     CA_FROM / CA_TEST_TO. Never printed, never logged, never accepted on
 *     the command line (argv is visible in `ps`).
 *   - Every send is FROM the operator's own mailbox using their app password
 *     — it IS their mail client, programmatized. The archived evidence keeps
 *     the real message-id, so every row is evidence-backed like any other.
 *   - --test sends exactly one email to CA_TEST_TO and stops.
 *   - --send-batch refuses unless BOTH creds exist AND CA_SEND_ARMED=1 (the
 *     two-step interlock the operator was shown), sends at most --limit
 *     (default 5) email-eligible drafts from sales/batch1-send-plan.json,
 *     and for each one immediately invokes the evidence processor
 *     (--apply) — DRAFT→SENT in the same motion, as promised.
 *
 * This file never reads ledger rows for secrets and never writes the
 * password anywhere: transcripts are scrubbed of the password AND its
 * base64 form before hitting disk.
 *
 * Modes:
 *   node sales/send-transport.mjs --verify      check config, print names/lengths only
 *   node sales/send-transport.mjs --selftest    offline: local fake SMTP on 127.0.0.1
 *   node sales/send-transport.mjs --test        ONE real email to CA_TEST_TO, then stop
 *   node sales/send-transport.mjs --plan [--batch N]   (re)build sales/batchN-send-plan.json
 *                                               from draft headers (email-eligible only;
 *                                               excludes drafts staged/sent in earlier
 *                                               batches — batch 1 = batch1-send-plan.json)
 *   CA_SEND_ARMED=1 node sales/send-transport.mjs --send-batch [--batch N] [--limit 5]
 *   CA_SEND_ARMED=1 node sales/send-transport.mjs --send-nudges
 *                                               (built 2026-09-20) sends ONLY
 *                                               nudge files in outreach/nudges/
 *                                               whose NUDGE-GATE line says GO —
 *                                               a second, per-file gate on top of
 *                                               CA_SEND_ARMED. Same motion as
 *                                               batches: evidence archived to
 *                                               sales/nudge-evidence-{auto,log}.md,
 *                                               ledger row annotated with the
 *                                               next nudge due (+5 business
 *                                               days), gate line stamped SENT so
 *                                               a re-run can never double-send.
 *   (test-only override: CA_NUDGES_DIR=<dir> points the scan elsewhere —
 *    used by sales/test-send-transport-cli.mjs; never set in production)
 */
import { spawn, spawnSync } from "node:child_process"; // spawnSync: evidence-processor invocation in sendBatch
import { createServer } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DRAFTS = join(ROOT, "outreach/drafts");
const planPath = (n) => join(ROOT, `sales/batch${n}-send-plan.json`); // one plan file per batch
const BLOCKS_DIR = join(ROOT, "sales/evidence-auto");
// Nudge paths (declared here, before the top-level dispatch — a const declared
// below the dispatch chain is in the TDZ when the branch body runs, which is
// exactly how the first nudge test run failed):
const NUDGES_DIR = process.env.CA_NUDGES_DIR
  ? resolve(ROOT, process.env.CA_NUDGES_DIR) // resolve, not join: an ABSOLUTE override must not be glued onto ROOT
  : join(ROOT, "outreach/nudges");
const NUDGE_BLOCKS_DIR = join(ROOT, "sales/nudge-evidence-auto");
const NUDGE_LOG = join(ROOT, "sales/nudge-evidence-log.md");

// ── config (env only) ────────────────────────────────────────────────────
function loadConfig() {
  const env = readEnvFile(join(ROOT, "consentark/.env"));
  const get = (k) => process.env[k] || env[k] || "";
  const cfg = {
    host: get("CA_SMTP_HOST"),
    port: get("CA_SMTP_PORT") || "587",
    user: get("CA_SEND_USER"),
    pass: get("CA_SEND_PASS"),
    from: get("CA_FROM"),
    fromName: get("CA_FROM_NAME"),
    testTo: get("CA_TEST_TO"),
  };
  // shell env wins for arming; credentials come from .env or env
  cfg.armed = process.env.CA_SEND_ARMED === "1";
  return cfg;
}

/** Minimal .env parser (KEY=VALUE lines, # comments) — no values printed. */
function readEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function missingCreds(cfg) {
  const miss = [];
  if (!cfg.host) miss.push("CA_SMTP_HOST");
  if (!cfg.user) miss.push("CA_SEND_USER");
  if (!cfg.pass) miss.push("CA_SEND_PASS");
  if (!cfg.from) miss.push("CA_FROM");
  return miss;
}

// ── RFC 5322 composition ─────────────────────────────────────────────────
export function composeEmail({ from, to, subject, body, fromName }) {
  const domain = from.split("@")[1] || "localhost";
  const messageId = `<${randomUUID()}@${domain}>`;
  const date = new Date().toUTCString().replace("GMT", "+0000");
  // fold + RFC 2047 not needed: our subjects/bodies are ASCII; assert it.
  if (!/^[\x20-\x7E\r\n]*$/.test(subject)) throw new Error("non-ASCII subject unsupported (keep subjects ASCII)");
  // multipart/alternative (operator requirement 2026-09-19): EVERY message
  // carries a plain-text part first, with an HTML alternative generated
  // from it — never HTML-only.
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const htmlBody = esc(body)
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${p.replace(/\r?\n/g, "<br>")}</p>`)
    .join("\r\n");
  const boundary = `=_ca_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const fromHeader = fromName ? `From: ${fromName} <${from}>` : `From: ${from}`;
  const raw = [
    fromHeader,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body.replace(/\r?\n/g, "\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `<html><body>${htmlBody}</body></html>`,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  // one dot-stuffing pass over the WHOLE payload (any body line starting
  // with "."; boundary/html lines never do, so this is safe and simple)
  const stuffed = raw.replace(/(^|\r\n)\./g, "$1..");
  return { msg: stuffed, messageId };
}

// ── SMTP via curl (no deps; STARTTLS enforced for real hosts) ────────────
// Async on purpose: the offline selftest's fake server needs the event loop
// alive during the conversation; a blocking spawn would deadlock it.
export function sendViaCurl(cfg, to, msg) {
  // unique per send: a shared path raced under the first (broken, un-awaited)
  // batch run — later composes truncated the file while earlier curls read it
  const tmp = join(ROOT, `sales/.outbound-${randomUUID().slice(0, 8)}.eml`);
  writeFileSync(tmp, msg);
  const isLocal = /^(127\.0\.0\.1|localhost)$/.test(cfg.host);
  const args = [
    "--silent", "--show-error",
    "--url", `smtp://${cfg.host}:${cfg.port}`,
    "--mail-from", cfg.from,
    "--mail-rcpt", to,
    "--upload-file", tmp,
    "--user", `${cfg.user}:${cfg.pass}`,
    "--max-time", "60",
  ];
  if (!isLocal) args.push("--ssl-reqd"); // STARTTLS mandatory for real relays
  const scrub = scrubber(cfg);
  return new Promise((resolve) => {
    const cleanup = () => { try { rmSync(tmp); } catch { /* already gone */ } };
    const child = spawn("curl", args);
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => { cleanup(); resolve({ ok: false, transcript: scrub(String(e)), status: -1 }); });
    child.on("close", (code) => { cleanup(); resolve({ ok: code === 0, transcript: scrub(out), status: code }); });
  });
}

/** Remove the password and its base64 form from any captured output. */
function scrubber(cfg) {
  const b64 = Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64");
  return (s) => s.split(cfg.pass).join("[REDACTED]").split(b64).join("[REDACTED]");
}

// ── draft parsing (mirrors quality-check's body rule) ────────────────────
export function parseDraft(text) {
  const lines = text.split("\n");
  const subjectIdx = lines.findIndex((l) => /\*\*Subject|Subject:/.test(l));
  if (subjectIdx === -1) return null;
  const subject = lines[subjectIdx].replace(/^\*\*Subject:\*\*|^\*\*Subject:|^Subject:/, "").replace(/\*\*$/, "").trim();
  const footerIdx = lines.findIndex((l, i) => i > subjectIdx && l.trim().startsWith("---") && lines[i + 1]?.includes("Pain quote"));
  const endIdx = footerIdx === -1 ? lines.length : footerIdx;
  const bodyLines = lines.slice(subjectIdx + 1, endIdx).filter((l) => l.trim() !== "---");
  const body = bodyLines.join("\n").trim();
  const channelLine = lines.find((l) => /^\*\*Channel:/i.test(l)) || "";
  const emails = channelLine.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  return { subject, body, emails, channelLine, pending: text.includes("APPROVAL: PENDING") };
}

// ── plan builder: email-eligible drafts only, ranked by recency ──────────
export function buildPlan(limit = 5, exclude = new Set()) {
  const files = readdirSync(DRAFTS).filter((f) => f.endsWith(".md") && !f.includes("SAMPLE")).sort();
  const plan = [];
  for (const f of files) {
    if (exclude.has(f)) continue; // staged or sent in an earlier batch
    const d = parseDraft(readFileSync(join(DRAFTS, f), "utf8"));
    if (!d || !d.pending || d.emails.length === 0) continue;
    plan.push({ file: f, to: d.emails[0], channel: d.channelLine.replace(/^\*\*Channel:\*\*\s*/i, "") });
    if (plan.length >= limit) break;
  }
  return plan;
}

/** Drafts that must never re-enter a later batch: everything staged in an
 *  earlier batch plan, plus everything with an evidence block (a block means
 *  the send happened — evidence-auto filenames mirror the draft names). */
export function excludedDrafts(batch) {
  const out = new Set();
  for (const f of readdirSync(join(ROOT, "sales"))) {
    const m = f.match(/^batch(\d+)-send-plan\.json$/);
    if (m && Number(m[1]) < batch) {
      for (const p of JSON.parse(readFileSync(join(ROOT, "sales", f), "utf8"))) out.add(p.file);
    }
  }
  if (existsSync(BLOCKS_DIR)) {
    for (const f of readdirSync(BLOCKS_DIR)) if (f.endsWith(".txt")) out.add(f.replace(/\.txt$/, ".md"));
  }
  return out;
}

// ── evidence block emitter (runbook format, what the processor parses) ──
export function evidenceBlock(plan, sentDate, messageId) {
  return [
    `company: ${plan.company}`,
    `draft file: ${plan.file}`,
    `sent date: ${sentDate}`,
    `message-id: ${messageId}`,
    "forwarded header / sent-item paste:",
    `Sent via operator-authorized SMTP transport (operator grant 2026-09-19); curl smtp session to ${plan.to}; Message-ID ${messageId} accepted by relay.`,
    "",
  ].join("\n");
}

// ── modes ────────────────────────────────────────────────────────────────
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

// Run the CLI dispatch only when executed directly (not on import) —
// lets tests and tooling import composeEmail/parseDraft without side effects.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain)
// GUARD (2026-09-20): the dispatch is a first-match chain, so an invocation
// like `--send-batch --plan X` used to match --plan first — it built a plan
// file and exited 0 while the operator believed a send had fired (this exact
// trap hit batch 3; nothing was sent, but only luck + evidence checks showed it).
// Rule: exactly ONE action per invocation. Any two → loud refusal, exit 2,
// BEFORE any config load, plan write, or SMTP touch.
if (["--verify", "--selftest", "--plan", "--test", "--send-batch", "--send-nudges"].filter(has).length > 1) {
  console.error("REFUSED — mutually exclusive actions in one invocation (exactly one of: --verify --selftest --plan --test --send-batch --send-nudges)");
  console.error("  send a staged plan:   CA_SEND_ARMED=1 node sales/send-transport.mjs --send-batch --batch N");
  console.error("  (re)build a plan:     node sales/send-transport.mjs --plan --batch N");
  console.error("  send gated nudges:    CA_SEND_ARMED=1 node sales/send-transport.mjs --send-nudges");
  process.exit(2);
}
if (has("--verify")) {
  const cfg = loadConfig();
  const miss = missingCreds(cfg);
  console.log(miss.length === 0
    ? `transport config READY (host=${cfg.host} port=${cfg.port} user=${cfg.user} from=${cfg.from} armed=${cfg.armed})`
    : `transport NOT configured — missing env vars: ${miss.join(", ")}`);
  process.exit(miss.length === 0 ? 0 : 2);
}

else if (has("--selftest")) selftest();
else if (has("--plan")) {
  const batch = Number(arg("--batch")) || 1;
  const exclude = excludedDrafts(batch);
  const plan = buildPlan(Number(arg("--limit")) || 5, exclude);
  const path = planPath(batch);
  writeFileSync(path, JSON.stringify(plan, null, 2) + "\n");
  console.log(`plan written: ${path} (batch ${batch}; excluded ${exclude.size} earlier-batch/sent draft(s))`);
  for (const p of plan) console.log(`  ${p.file} → ${p.to}`);
  if (plan.length === 0) console.log("  (no email-eligible drafts found — all channels are forms/phones)");
}

else if (has("--test")) {
  const cfg = loadConfig();
  const miss = missingCreds(cfg);
  if (miss.length) { console.error(`CANNOT TEST — missing env vars: ${miss.join(", ")}`); process.exit(2); }
  const to = arg("--to") || cfg.testTo;
  if (!to) { console.error("CANNOT TEST — no CA_TEST_TO and no --to"); process.exit(2); }  const { msg, messageId } = composeEmail({
    from: cfg.from, to,
    fromName: cfg.fromName,
    // Human-shaped test (operator order 2026-09-19 after test #1 hit spam):
    // no timestamps, no "operator", no machine phrasing — the way a person
    // would check their own setup.
    subject: `Quick test - ConsentArk email setup`,
    body: "Hi,\n\nJust a quick check that our new business address reaches your inbox like any normal email would. Nothing to click here - a plain hello from ConsentArk.\n\nThanks,\nConsentArk\n",
  });
  const r = await sendViaCurl(cfg, to, msg);
  log(`TRANSPORT TEST ${r.ok ? "SENT" : "FAILED"} to ${to} message-id ${messageId}`);
  console.log(r.ok ? `TEST SENT — message-id ${messageId} (check your inbox)` : `TEST FAILED (curl exit ${r.status})\n${r.transcript}`);
  process.exit(r.ok ? 0 : 1);
}

else if (has("--send-batch")) {
  const cfg = loadConfig();
  const miss = missingCreds(cfg);
  if (miss.length) { console.error(`REFUSED — missing env vars: ${miss.join(", ")}`); process.exit(2); }
  if (!cfg.armed) { console.error("REFUSED — CA_SEND_ARMED=1 not set (two-step interlock)"); process.exit(2); }
  await sendBatch(cfg, Number(arg("--limit")) || 5);
}

else if (has("--send-nudges")) {
  const cfg = loadConfig();
  const miss = missingCreds(cfg);
  if (miss.length) { console.error(`REFUSED — missing env vars: ${miss.join(", ")}`); process.exit(2); }
  if (!cfg.armed) { console.error("REFUSED — CA_SEND_ARMED=1 not set (two-step interlock)"); process.exit(2); }
  await sendNudges(cfg);
}

else {
  console.log("usage (ONE action per invocation): --verify | --selftest | --test | --plan [--batch N] | CA_SEND_ARMED=1 --send-batch [--batch N] [--limit 5] | CA_SEND_ARMED=1 --send-nudges");
  process.exit(1);
}


// ── do-not-contact: the permanent opt-out list (sales/do-not-contact.md) ───
// The transport refuses ANY send to a listed address — batches and nudges
// alike (playbook PB-3: opt-outs are honored immediately and permanently).
// Parsing is deliberately loose (any email-looking token on a bullet line) so
// hand-written entries always match; comparison is case-insensitive.
function parseDnc(text) {
  const set = new Set();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("-")) continue;
    const m = line.match(/[\w.+-]+@[\w.-]+/);
    if (m) set.add(m[0].toLowerCase());
  }
  return set;
}
function loadDnc() {
  const path = join(ROOT, "sales/do-not-contact.md");
  return existsSync(path) ? parseDnc(readFileSync(path, "utf8")) : new Set();
}

// ── batch: send → evidence → processor, per draft, same motion ───────────
async function sendBatch(cfg, limit) {
  const batch = Number(arg("--batch")) || 1;
  const planFile = planPath(batch);
  if (!existsSync(planFile)) { console.error(`REFUSED — no plan file ${planFile}; run --plan --batch ${batch} first`); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, "utf8")).slice(0, limit);
  if (!existsSync(BLOCKS_DIR)) mkdirSync(BLOCKS_DIR, { recursive: true });
  const sentDate = new Date().toISOString().slice(0, 10);
  let sent = 0, failed = 0, skipped = 0;
  const dnc = loadDnc();
  if (dnc.size) console.log(`DNC guard: ${dnc.size} permanent opt-out address(es) on file`);
  for (const p of plan) {
    const raw = readFileSync(join(DRAFTS, p.file), "utf8");
    const d = parseDraft(raw);
    if (!d?.pending) { console.log(`SKIP ${p.file} — already processed (not APPROVAL: PENDING)`); skipped++; continue; }
    if (dnc.has(p.to.toLowerCase())) { console.log(`SKIP ${p.file} — ${p.to} is on the do-not-contact list (permanent opt-out, sales/do-not-contact.md)`); skipped++; continue; }
    const { msg, messageId } = composeEmail({ from: cfg.from, to: p.to, fromName: cfg.fromName, subject: d.subject, body: d.body });
    const r = await sendViaCurl(cfg, p.to, msg); // MUST await: sendViaCurl is async (deadlock fix); sync-inspecting the Promise is what broke batch 1's first run
    const tsv = `${new Date().toISOString()} ${p.file} → ${p.to} exit=${r.status}`;
    appendFileSync(join(ROOT, "sales/send-transcript.log"), `${r.transcript}\n--- ${tsv} ---\n`);
    if (!r.ok) { console.error(`SEND FAILED ${p.file} (curl exit ${r.status}) — evidence NOT generated, row untouched`); failed++; continue; }
    const company = p.company || readLedgerCompany(p.file);
    const block = evidenceBlock({ ...p, company }, sentDate, messageId);
    const blockPath = join(BLOCKS_DIR, `${p.file.replace(/\.md$/, "")}.txt`);
    writeFileSync(blockPath, block);
    const pr = spawnSync("node", ["sales/send-evidence-processor.mjs", "--apply", "--file", blockPath], { encoding: "utf8" });
    const okApply = pr.status === 0 && !/not SENT-eligible|rejected|missing/i.test(pr.stdout + pr.stderr);
    if (okApply) { sent++; console.log(`SENT+PROCESSED ${p.file} → ${p.to} (message-id ${messageId})`); }
    else { failed++; console.error(`SENT but PROCESSOR REJECTED ${p.file}: ${(pr.stdout || pr.stderr).trim()}`); }
  }
  log(`BATCH RESULT sent=${sent} skipped=${skipped} failed=${failed} limit=${limit}`);
  console.log(`\nbatch done: ${sent} sent+processed, ${skipped} skipped (already SENT), ${failed} not completed`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Exact ledger company name for a draft filename (processor requires it). */
function readLedgerCompany(file) {
  for (const line of readFileSync(join(ROOT, "sales/ledger.md"), "utf8").split("\n")) {
    if (/^\| P-\d+ \|/.test(line) && line.includes(file)) {
      return line.split("|")[2].split("—")[0].trim();
    }
  }
  throw new Error(`no ledger row references draft ${file}`);
}

// ── nudges: operator-gated follow-ups from outreach/nudges/ ─────────────
// Two independent gates must BOTH be open before any nudge leaves:
//   1. CA_SEND_ARMED=1 (process-level, same as batches)
//   2. the file's own `NUDGE-GATE: GO <date>` line, flipped ONLY on explicit
//      per-row operator go ("nudge the Barn Inn, hold Country Coach").
// Evidence lands in sales/nudge-evidence-{auto,log}.md — deliberately NOT
// sales/evidence-auto / send-evidence-log.md, because the battery's check 7
// counts send-evidence-log sections against SENT rows and nudge sends must
// not disturb that invariant (rows stay SENT; they get annotated, not flipped).
// Paths NUDGES_DIR/NUDGE_BLOCKS_DIR/NUDGE_LOG are declared with the other
// path constants at the top of the file (TDZ note there).

/** Parse one nudge draft (header block written by the 2026-09-20 nudge pass). */
function parseNudge(raw, file) {
  const company = raw.match(/^# NUDGE follow-up — (.+?) \(/m)?.[1]?.trim() || "";
  const recipient = raw.match(/^\*\*Recipient:\*\*\s*(\S+)/m)?.[1] || "";
  const subject = raw.match(/^\*\*Subject:\*\*\s*(.+)$/m)?.[1]?.trim() || "";
  const parent = raw.match(/^PARENT DRAFT:\s*(\S+)/m)?.[1] || "";
  const origMsgId = raw.match(/message-id (\S+@\S+)/)?.[1] || "";
  const gate = raw.match(/^NUDGE-GATE:\s*([A-Z]+)/m)?.[1] || "ABSENT";
  const subjIdx = raw.indexOf("**Subject:**");
  const bodyStart = subjIdx === -1 ? -1 : raw.indexOf("\n", subjIdx) + 1;
  const footerIdx = raw.lastIndexOf("\n---\n");
  const body = bodyStart > 0 && footerIdx > bodyStart ? raw.slice(bodyStart, footerIdx).trim() : "";
  return { file, company, recipient, subject, body, parent, origMsgId, gate };
}

/** +N business days (Mon–Fri), matching sales/nudge-calendar.mjs's rule. */
function addBusinessDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n--;
  }
  return d.toISOString().slice(0, 10);
}

/** Ratified five-field block, nudge flavor (parent + original id in the paste field). */
function nudgeEvidenceBlock(p, sentDate, messageId) {
  return [
    `company: ${p.company}`,
    `draft file: ${p.file} (nudge; parent ${p.parent})`,
    `sent date: ${sentDate}`,
    `message-id: ${messageId}`,
    `forwarded header / sent-item paste: (transport curl session — transcript in sales/send-transcript.log${p.origMsgId ? `; original send message-id ${p.origMsgId}` : ""})`,
    "",
  ].join("\n");
}

/** Annotate the ledger row (matched via the nudge's PARENT DRAFT filename):
 *  'nudge due YYYY-MM-DD' → 'nudged <sent>; next nudge due <+5bd>'.
 *  Reports (never throws) if the row can't be found — the send already happened
 *  and is evidenced; a missing annotation is surfaced, not hidden. */
function annotateLedger(p, sentDate, nextDue) {
  const path = join(ROOT, "sales/ledger.md");
  const lines = readFileSync(path, "utf8").split("\n");
  const base = p.parent.split("/").pop();
  const hit = lines.findIndex((l) => /^\| P-\d+ \|/.test(l) && l.includes(base));
  if (hit === -1) return `WARN: no ledger row references parent ${base} — row NOT annotated`;
  if (!/nudge due \d{4}-\d{2}-\d{2}/.test(lines[hit])) return `WARN: ledger row for ${base} has no 'nudge due' date — row NOT annotated`;
  lines[hit] = lines[hit].replace(/nudge due \d{4}-\d{2}-\d{2}/, `nudged ${sentDate}; next nudge due ${nextDue}`);
  writeFileSync(path, lines.join("\n"));
  return `ledger row annotated: nudged ${sentDate}, next nudge due ${nextDue}`;
}

/** Stamp the gate line so a re-run can never double-send this nudge. */
function stampGate(p, sentDate, messageId) {
  const path = join(NUDGES_DIR, p.file);
  const stamped = readFileSync(path, "utf8").replace(
    /^NUDGE-GATE:.*$/m,
    `NUDGE-GATE: SENT ${sentDate} (message-id ${messageId} archived in sales/nudge-evidence-log.md) — cannot re-send`,
  );
  writeFileSync(path, stamped);
}

async function sendNudges(cfg) {
  if (!existsSync(NUDGES_DIR)) { console.error(`REFUSED — no nudges directory ${NUDGES_DIR}`); process.exit(2); }
  const parsed = readdirSync(NUDGES_DIR).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseNudge(readFileSync(join(NUDGES_DIR, f), "utf8"), f));
  // CANCELLED (reply received, sales/reply-playbooks.md) is a permanent
  // never-send state — listed loudly so the operator sees WHY it will not fire.
  const cancelled = parsed.filter((p) => p.gate === "CANCELLED");
  for (const c of cancelled) console.log(`CANCELLED ${c.file} — reply received; will never send (sales/reply-playbooks.md)`);
  const holds = parsed.filter((p) => p.gate !== "GO" && p.gate !== "CANCELLED");
  const gos = parsed.filter((p) => p.gate === "GO");
  for (const h of holds) console.log(`HOLD ${h.file} (gate=${h.gate})`);
  if (gos.length === 0) {
    console.error(`REFUSED — 0 nudges gated GO (${holds.length} on HOLD/other). On explicit per-row operator go, flip that nudge file's NUDGE-GATE line to 'GO <date>' first.`);
    process.exit(2);
  }
  // Pre-flight EVERY GO nudge before touching SMTP: structurally complete, and
  // its parent draft must show the row actually went out (never nudge a row
  // that was never sent — that would be manufacturing a follow-up). A DNC hit
  // is a hard refusal (exit 2): a GO gate flipped for an opted-out address is
  // operator error, and the opt-out is permanent — the fix is never "send anyway".
  const dnc = loadDnc();
  if (dnc.size) console.log(`DNC guard: ${dnc.size} permanent opt-out address(es) on file`);
  for (const p of gos) {
    const problems = [];
    if (dnc.has(p.recipient.toLowerCase())) problems.push("recipient is on the do-not-contact list (sales/do-not-contact.md) — permanent opt-out");
    if (!p.recipient) problems.push("no **Recipient:** header");
    if (!p.subject) problems.push("no **Subject:** header");
    if (!p.body) problems.push("no body between Subject and footer");
    if (!p.parent) problems.push("no PARENT DRAFT line");
    else {
      const parentPath = join(ROOT, p.parent);
      if (!existsSync(parentPath)) problems.push(`parent draft missing: ${p.parent}`);
      else if (/APPROVAL: PENDING/.test(readFileSync(parentPath, "utf8"))) problems.push("parent draft still APPROVAL: PENDING — row may never have been sent (drift; run the battery first)");
    }
    if (problems.length) { console.error(`REFUSED ${p.file}: ${problems.join("; ")}`); process.exit(2); }
  }
  if (!existsSync(NUDGE_BLOCKS_DIR)) mkdirSync(NUDGE_BLOCKS_DIR, { recursive: true });
  const sentDate = new Date().toISOString().slice(0, 10);
  let sent = 0, failed = 0;
  for (const p of gos) {
    const { msg, messageId } = composeEmail({ from: cfg.from, to: p.recipient, fromName: cfg.fromName, subject: p.subject, body: p.body });
    const r = await sendViaCurl(cfg, p.recipient, msg); // awaited: see the batch-1 deadlock note in sendBatch
    const tsv = `${new Date().toISOString()} ${p.file} → ${p.recipient} exit=${r.status}`;
    appendFileSync(join(ROOT, "sales/send-transcript.log"), `${r.transcript}\n--- ${tsv} ---\n`);
    if (!r.ok) { console.error(`SEND FAILED ${p.file} (curl exit ${r.status}) — evidence NOT generated, ledger untouched`); failed++; continue; }
    const nextDue = addBusinessDays(sentDate, 5);
    const block = nudgeEvidenceBlock(p, sentDate, messageId);
    writeFileSync(join(NUDGE_BLOCKS_DIR, `${p.file.replace(/\.md$/, "")}.txt`), block);
    appendFileSync(NUDGE_LOG, `\n## ${p.file} — nudged ${sentDate}\n\`\`\`\n${block}\n\`\`\`\n`);
    const note = annotateLedger(p, sentDate, nextDue);
    stampGate(p, sentDate, messageId);
    sent++;
    console.log(`NUDGE SENT ${p.file} → ${p.recipient} (message-id ${messageId}); ${note}`);
  }
  log(`NUDGE RESULT sent=${sent} failed=${failed} (holds=${holds.length} cancelled=${cancelled.length})`);
  console.log(`\nnudge run done: ${sent} sent, ${failed} failed, ${holds.length} still gated HOLD${cancelled.length ? `, ${cancelled.length} CANCELLED (reply received — never sends)` : ""}`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── offline selftest: fake SMTP server, no external side effects ─────────
function selftest() {
  const received = [];
  const server = createServer((sock) => {
    let inData = false, buf = "";
    sock.write("220 selftest ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (inData) {
          if (line === ".") { inData = false; received.push(dataBuf); sock.write("250 ok\r\n"); dataBuf = ""; }
          else dataBuf += line + "\n";
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) sock.write("250-selftest\r\n250 OK\r\n");
        else if (cmd.startsWith("MAIL FROM")) sock.write("250 OK\r\n");
        else if (cmd.startsWith("RCPT TO")) sock.write("250 OK\r\n");
        else if (cmd.startsWith("DATA")) { inData = true; dataBuf = ""; sock.write("354 go\r\n"); }
        else if (cmd.startsWith("QUIT")) { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
    let dataBuf = "";
  });
  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "  ok" : "  FAIL"}: ${n}`); };

  server.listen(2525, "127.0.0.1", async () => {
    const cfg = { host: "127.0.0.1", port: "2525", user: "t@e.st", pass: "fake-pass-123", from: "t@e.st" };
    const { msg, messageId } = composeEmail({ from: cfg.from, to: "dest@example.com", subject: "selftest subject", body: "line one\n.important dotline\nline three" });
    const r = await sendViaCurl(cfg, "dest@example.com", msg);
    check("curl exit 0 against local SMTP", r.ok);
    const got = received[0] || "";
    check("message received", got.includes("Subject: selftest subject"));
    check("message-id matches emitted evidence value", got.includes(messageId));
    check("From header is the operator address", got.includes(`From: ${cfg.from}`)); // bare-address check: display name (when set) still contains the address
    check("dot-stuffing applied (..important)", got.includes("..important dotline"));
    check("transcript carries no password material", !r.transcript.includes("fake-pass-123") && !r.transcript.includes(Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")));
    const block = evidenceBlock({ company: "Selftest Co", file: "2026-01-01-x.md" }, "2026-01-02", messageId);
    check("evidence block has all five fields", block.includes("company: Selftest Co") && block.includes("draft file: 2026-01-01-x.md") && block.includes("sent date: 2026-01-02") && block.includes(`message-id: ${messageId}`) && block.includes("forwarded header / sent-item paste:"));
    const d = parseDraft(readFileSync(join(DRAFTS, "2026-09-18-millers-creamery.md"), "utf8"));
    check("real draft parses (subject + body + address)", !!d && d.emails.includes("Mandi@millerscreamery.com") && d.body.length > 50 && !d.body.includes("Pain quote"));
    check("dnc parser extracts bullet addresses case-insensitively", (() => { const s = parseDnc("- Foo@Bar.COM — opted out 2026-09-24 (P-001)\n- baz@qux.org — opted out (reply-log)\nnot a bullet with an email@x.org"); return s.size === 2 && s.has("foo@bar.com") && s.has("baz@qux.org"); })());
    server.close();
    console.log(`\nsend-transport selftest: ${pass} ok, ${fail} fail — no external mail, no real credentials used`);
    process.exit(fail === 0 ? 0 : 1);
  });
}

function log(line) {
  appendFileSync(join(ROOT, "sales/discovery-log.md"), `${new Date().toISOString().slice(0, 16).replace("T", " ")} | TRANSPORT | ${line}\n`);
}
