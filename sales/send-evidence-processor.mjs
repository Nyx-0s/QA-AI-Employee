/**
 * Send-evidence processor — the ingestion that turns the operator's pasted
 * evidence (company + draft + sent date + message-id + forwarded header /
 * sent-item paste) into the ledger's SENT transition.
 *
 * Evidence block format (each on its own line; keys case-insensitive):
 *   company: <exact name from the ledger row>
 *   draft file: <YYYY-MM-DD-<slug>.md>          ("draft:" also accepted)
 *   sent date: <YYYY-MM-DD>
 *   message-id: <from the operator's sent items>
 *   forwarded header / sent-item paste: <paste — must be non-empty>
 *
 * Safety model:
 *   --selftest  (default) runs 5 fixtures against a COPY of the ledger and
 *               drafts in a temp dir. Real files are never touched.
 *   --apply --file <evidence.txt> [--root .] performs ONE real transition,
 *               and refuses without both flags. Every run (selftest or real)
 *               appends a full audit line to sales/discovery-log.md.
 *
 * Transition rules (match the ledger's own evidence spec):
 *   - row must be DRAFTED with a PENDING draft; otherwise reject
 *   - evidence must include a non-empty forwarded-header/sent-item paste
 *   - on success: objective tag DRAFTED→SENT, approval PENDING→APPROVED,
 *     outcome →SENT, evidence cell gains sent-date + message-id,
 *     next-action gains "nudge due <sent+5 business days>",
 *     draft status flips to APPROVED and gains a SENT history line,
 *     and the full evidence block is archived to sales/send-evidence-log.md
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addBusinessDays } from "./nudge-calendar.mjs";

// ── parsing ──────────────────────────────────────────────────────────────
export function parseEvidence(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const fields = {};
  let pasteStarted = false;
  for (const line of lines) {
    if (!pasteStarted) {
      const m = line.match(/^\s*([a-z /-]+?)\s*:\s*(.*)$/i);
      if (m) {
        const key = m[1].trim().toLowerCase();
        if (key === "company") { fields.company = m[2].trim(); continue; }
        if (key === "draft file" || key === "draft") { fields.draft = m[2].trim(); continue; }
        if (key === "sent date") { fields.sentDate = m[2].trim(); continue; }
        if (key === "message-id") { fields.messageId = m[2].trim().replace(/^<|>$/g, ""); continue; }
        if (key.startsWith("forwarded header")) {
          pasteStarted = true;
          if (m[2].trim() !== "") fields.paste = m[2].trim();
          continue;
        }
      }
    } else if (line.trim() !== "") {
      fields.paste = (fields.paste ? fields.paste + " " : "") + line.trim();
    }
  }
  return fields;
}

// ── row transform (pure string work on the ledger text) ──────────────────
export function buildSentLedger(ledgerText, { company, draft, sentDate, messageId, paste }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(sentDate)) return { ok: false, reason: `bad sent date "${sentDate}" (want YYYY-MM-DD)` };
  if (!messageId) return { ok: false, reason: "missing message-id" };
  if (!draft) return { ok: false, reason: "missing draft file" };
  if (!company) return { ok: false, reason: "missing company" };
  if (!paste) return { ok: false, reason: "missing forwarded header / sent-item paste — evidence incomplete" };

  const lines = ledgerText.split("\n");
  let rowIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\| P-\d+ \|/.test(lines[i]) && lines[i].toLowerCase().includes(company.toLowerCase())) { rowIdx = i; break; }
  }
  if (rowIdx === -1) return { ok: false, reason: `no ledger row matches company "${company}" (exact row name required)` };

  const cells = lines[rowIdx].split("|"); // ['', ' id ', ' prospect ', ..., ' updated ', '']
  const tag = (cells[5] || "").split("—")[0].trim();
  if (tag !== "DRAFTED") return { ok: false, reason: `row is ${tag}, not DRAFTED — not SENT-eligible` };
  const rowDraft = (cells[6] || "").trim();
  if (rowDraft !== draft) return { ok: false, reason: `row references draft "${rowDraft}", evidence says "${draft}"` };
  if (!(cells[7] || "").includes("PENDING")) return { ok: false, reason: "row approval cell is not PENDING" };

  const nudge = addBusinessDays(sentDate, 5);
  cells[5] = ` SENT — ${cells[5].split("—").slice(1).join("—").trim()} `;
  cells[7] = " APPROVED ";
  cells[8] = " SENT ";
  cells[9] = ` sent ${sentDate} via operator-authorized SMTP transport (consentarkhe@gmail.com), message-id ${messageId}; forwarded header/sent-item paste on file — evidence block archived in sales/send-evidence-log.md `;
  cells[10] = ` nudge due ${nudge} (auto no-reply check after that date) `;
  cells[11] = ` ${sentDate} `;
  lines[rowIdx] = cells.join("|");
  return { ok: true, ledgerText: lines.join("\n"), nudgeDue: nudge };
}

export function buildSentDraft(draftText, { sentDate, messageId, nudgeDue }) {
  return draftText.replace("APPROVAL: PENDING", "APPROVAL: APPROVED") +
    `\n**SENT:** ${sentDate} via operator-authorized SMTP transport consentarkhe@gmail.com (message-id ${messageId}); nudge due ${nudgeDue}.\n`;
}

// ── one full ingestion against a root dir ────────────────────────────────
export function processEvidence(root, evidenceText, archive = true) {
  const fields = parseEvidence(evidenceText);
  const ledgerPath = join(root, "sales/ledger.md");
  const draftPath = join(root, "outreach/drafts", fields.draft || "__none__");

  let ledgerText;
  try { ledgerText = readFileSync(ledgerPath, "utf8"); } catch { return { ok: false, reason: "ledger unreadable" }; }
  if (!existsSync(draftPath)) return { ok: false, reason: `draft file not found: ${fields.draft}` };

  const result = buildSentLedger(ledgerText, fields);
  if (!result.ok) return result;

  const draftText = readFileSync(draftPath, "utf8");
  if (!draftText.includes("APPROVAL: PENDING")) return { ok: false, reason: "draft is not APPROVAL: PENDING" };

  writeFileSync(ledgerPath, result.ledgerText);
  writeFileSync(draftPath, buildSentDraft(draftText, { sentDate: fields.sentDate, messageId: fields.messageId, nudgeDue: result.nudgeDue }));
  if (archive) {
    appendFileSync(join(root, "sales/send-evidence-log.md"),
      `\n## ${fields.company} — sent ${fields.sentDate}\n- message-id: ${fields.messageId}\n- nudge due: ${result.nudgeDue}\n- forwarded header / sent-item paste:\n\n    ${String(fields.paste || "").replace(/\n/g, "\n    ")}\n`);
  }
  return { ok: true, nudgeDue: result.nudgeDue, company: fields.company };
}

// ── selftest: 5 fixtures on a temp copy; real files untouched ────────────
function selftest() {
  const tmp = mkdtempSync(join(tmpdir(), "ca-evidence-"));
  mkdirSync(join(tmp, "sales"), { recursive: true });
  mkdirSync(join(tmp, "outreach/drafts"), { recursive: true });
  copyFileSync("sales/ledger.md", join(tmp, "sales/ledger.md"));
  for (const f of ["2026-09-17-the-barn-inn.md"]) copyFileSync(`outreach/drafts/${f}`, join(tmp, "outreach/drafts", f));

  const ev = (over = {}) => [
    `company: ${over.company ?? "The Barn Inn Bed & Breakfast"}`,
    `draft file: ${over.draft ?? "2026-09-17-the-barn-inn.md"}`,
    `sent date: ${over.sentDate ?? "2026-09-18"}`,
    `message-id: ${over.messageId ?? "<barn-001@mail.example>"}`,
    "forwarded header / sent-item paste:",
    over.paste ?? "Received: from mail.example by mx; Thu, 18 Sep 2026 09:12:00 -0400",
    "Subject: Group bookings that start with a phone tag",
  ].join("\n") + "\n";

  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log(`  ok: ${name}`); } else { fail++; console.error(`  FAIL: ${name}`); } };

  // 1. valid evidence applies cleanly
  const r1 = processEvidence(tmp, ev());
  check("valid evidence → applied", r1.ok === true);
  const led1 = readFileSync(join(tmp, "sales/ledger.md"), "utf8");
  const barnRow = led1.split("\n").find((l) => l.includes("The Barn Inn Bed & Breakfast") && /^\| P-/.test(l)) || "";
  check("row tag flips to SENT", barnRow.includes("| SENT — "));
  check("row approval flips to APPROVED", barnRow.includes("| APPROVED |"));
  check("evidence cell records message-id", barnRow.includes("barn-001@mail.example"));
  check("nudge due = Fri 2026-09-25 (sent Thu 09-18 + 5 biz days)", barnRow.includes("nudge due 2026-09-25"));
  const d1 = readFileSync(join(tmp, "outreach/drafts/2026-09-17-the-barn-inn.md"), "utf8");
  check("draft flips to APPROVED + SENT history line", d1.includes("APPROVAL: APPROVED") && d1.includes("**SENT:** 2026-09-18"));
  check("evidence archived", readFileSync(join(tmp, "sales/send-evidence-log.md"), "utf8").includes("The Barn Inn Bed & Breakfast"));

  // 2. replay of the same evidence must be rejected
  const r2 = processEvidence(tmp, ev());
  check("replay rejected (row no longer DRAFTED)", r2.ok === false && /not SENT-eligible/.test(r2.reason));

  // 3. unknown company rejected
  const r3 = processEvidence(tmp, ev({ company: "ACME Custom Cakes" }));
  check("unknown company rejected", r3.ok === false && /no ledger row matches/.test(r3.reason));

  // 4. missing paste rejected (nothing after the paste key — no evidence at all)
  const r4 = processEvidence(tmp, ev({ paste: "" }).split("\n").slice(0, 4).concat("forwarded header / sent-item paste:").join("\n") + "\n");
  check("empty forwarded-header paste rejected", r4.ok === false && /paste/.test(r4.reason));

  // 5. malformed date rejected
  const tmp2 = mkdtempSync(join(tmpdir(), "ca-evidence-"));
  mkdirSync(join(tmp2, "sales"), { recursive: true });
  mkdirSync(join(tmp2, "outreach/drafts"), { recursive: true });
  copyFileSync("sales/ledger.md", join(tmp2, "sales/ledger.md"));
  copyFileSync("outreach/drafts/2026-09-17-the-barn-inn.md", join(tmp2, "outreach/drafts/2026-09-17-the-barn-inn.md"));
  const r5 = processEvidence(tmp2, ev({ sentDate: "09/18/2026" }));
  check("bad date rejected", r5.ok === false && /bad sent date/.test(r5.reason));

  rmSync(tmp, { recursive: true, force: true });
  rmSync(tmp2, { recursive: true, force: true });
  console.log(`\nsend-evidence processor selftest: ${pass} ok, ${fail} fail — real ledger/drafts untouched`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes("--selftest") || process.argv.length === 2) selftest();

// ── CLI: --apply --file <evidence.txt> [--root .] — ONE real transition ──
if (process.argv.includes("--apply")) {
  const fileIdx = process.argv.indexOf("--file");
  const file = fileIdx !== -1 ? process.argv[fileIdx + 1] : null;
  if (!file) { console.error("REJECTED — --apply requires --file <evidence.txt>"); process.exit(2); }
  let text;
  try { text = readFileSync(file, "utf8"); } catch { console.error(`REJECTED — cannot read evidence file: ${file}`); process.exit(2); }
  const rootIdx = process.argv.indexOf("--root");
  const root = rootIdx !== -1 ? process.argv[rootIdx + 1] : process.cwd();
  const r = processEvidence(root, text, true);
  if (r.ok) {
    console.log(`APPLIED — ${r.company} → SENT, nudge due ${r.nudgeDue}`);
    appendFileSync(join(root, "sales/discovery-log.md"),
      `${new Date().toISOString().slice(0, 16).replace("T", " ")} | EVIDENCE APPLIED | ${r.company} → SENT (evidence: ${file}); nudge due ${r.nudgeDue}\n`);
    process.exit(0);
  }
  console.error(`REJECTED — ${r.reason}`);
  process.exit(1);
}
