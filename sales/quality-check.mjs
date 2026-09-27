/**
 * Quality checker for outreach drafts (development aid for the operator gate).
 * Scores every non-SAMPLE draft in outreach/drafts/ against the drafter rules:
 *   R1: body <= 90 words (body = subject line through the paragraph text,
 *       excluding the metadata header and the Pain-quote/STATUS footer)
 *   R2: no hype words
 *   R3: no claimed traction/customers
 *   R4: exactly one 15-minute ask
 *   R5: exactly one "APPROVAL: PENDING" status line
 *   R6: has a "Pain quote (verbatim)" block citing a source URL
 * Reply-response drafts (filename contains "-reply-", per
 * sales/reply-playbooks.md) are exempt from R4 and R6: an opt-out or
 * wrong-person response legitimately carries no 15-minute ask and no
 * discovery footer. All other rules apply to them unchanged.
 * Run: node sales/quality-check.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "outreach/drafts";
const HYPE = /revolutionary|game-?chang|cutting-?edge|transformative|supercharg|unleash|hassle-?free|seamlessly|next-?level|blow.?your.?mind/i;
const TRACTION = /our customers|trusted by|companies love|\b\d+\s+(businesses|companies|customers|teams)\b|we already serve/i;
const ASK = /15[ -]?min/i;

function check(file) {
  const raw = readFileSync(join(DIR, file), "utf8");
  const lines = raw.split("\n");
  const subjectIdx = lines.findIndex((l) => /\*\*Subject|Subject:/.test(l));
  // Footer starts at the quote footer ("---" followed by "Pain quote"), or at
  // a legacy "*Word count:" note (session-1 format), or runs to EOF.
  const footerIdx = lines.findIndex((l, i) => (l.trim().startsWith("---") && lines[i + 1]?.includes("Pain quote")) || l.trim().startsWith("*Word count"));
  const endIdx = footerIdx === -1 ? lines.length : footerIdx;
  if (subjectIdx === -1) return { file, fail: ["no subject line"] };
  const bodyLines = lines.slice(subjectIdx, endIdx).filter((l) => !/^\*\*Subject/.test(l) && l.trim() !== "---");
  const body = bodyLines.join(" ");
  const words = body.split(/\s+/).filter(Boolean).length;
  const pending = (raw.match(/APPROVAL: PENDING/g) || []).length;
  const approvedSent = raw.includes("APPROVAL: APPROVED") && /\n\*\*SENT:\*\* /.test(raw); // flipped by the evidence processor at SENT time
  const cut = /APPROVAL: CUT \d{4}-\d{2}-\d{2}/.test(raw); // operator-killed prospect: valid terminal state, never sendable
  const quote = /Pain quotes? \(verbatim\)/i.test(raw) && /https?:\/\//.test(raw);
  const isReply = /-reply-/.test(file); // reply-response draft (sales/reply-playbooks.md)
  const fails = [];
  if (words > 90) fails.push(`R1 body=${words} words (>90)`);
  if (HYPE.test(body)) fails.push("R2 hype word present");
  if (TRACTION.test(body)) fails.push("R3 traction claim");
  const asks = (body.match(new RegExp(ASK, "gi")) || []).length;
  if (!isReply && asks !== 1) fails.push(`R4 asks=${asks} (want 1)`);
  // R5: exactly one valid gate state — PENDING (at the gate), or APPROVED
  // with a SENT history line (flipped by the evidence processor). Anything
  // else (PENDING count != 1 on an un-flipped draft, APPROVED without the
  // SENT line, both markers, or neither) fails.
  if (!approvedSent && !cut && pending !== 1) fails.push(`R5 gate state invalid: PENDING lines=${pending}${approvedSent ? " + APPROVED" : ""}${cut ? " + CUT" : ""} (want exactly 1 PENDING, APPROVED+SENT history, or a dated CUT)`);
  if (approvedSent && pending !== 0) fails.push(`R5 both PENDING(${pending}) and APPROVED markers present`);
  if (cut && pending !== 0) fails.push(`R5 both PENDING(${pending}) and CUT markers present`);
  if (approvedSent && !/\n\*\*SENT:\*\* \d{4}-\d{2}-\d{2}/.test(raw)) fails.push("R5 APPROVED but SENT history line missing/dated");
  if (!isReply && !quote) fails.push("R6 missing verbatim-quote block or source URL");
  return { file, words, ok: fails.length === 0, fails };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.includes("SAMPLE"));
let bad = 0;
for (const f of files) {
  const r = check(f);
  if (r.ok) console.log(`PASS  ${String(r.words).padStart(3)}w  ${f}`);
  else { bad++; console.log(`FAIL  ${String(r.words ?? "?").padStart(3)}w  ${f}  → ${r.fails.join("; ")}`); }
}
console.log(`\n${files.length - bad}/${files.length} drafts pass. SAMPLE excluded.`);
process.exit(bad === 0 ? 0 : 1);
