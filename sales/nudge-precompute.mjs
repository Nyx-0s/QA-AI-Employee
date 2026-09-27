/**
 * Nudge precompute — validates the FULL ledger against drafts on disk and
 * prints the precomputed nudge-due date for every SENT-eligible row.
 *
 * For each ledger row it checks:
 *   - status tag is a known tag
 *   - the referenced draft file exists in outreach/drafts/
 *   - a DRAFTED row's draft really is APPROVAL: PENDING
 * Then, for every still-PENDING row (SENT-eligible the moment the operator
 * sends), it prints the nudge-due date that WILL be recorded at the SENT
 * transition: sent + 5 business days (per sales/nudge-calendar.mjs).
 *
 * Read-only: this tool never writes to the ledger.
 * Run: node sales/nudge-precompute.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { addBusinessDays } from "./nudge-calendar.mjs";

const LEDGER = "sales/ledger.md";
const DRAFTS = "outreach/drafts";
const KNOWN_TAGS = ["DRAFTED", "APPROVED", "SENT", "REPLIED", "MEETING-SET", "CLOSED", "NO-REPLY", "CUT"]; // CUT = operator-killed prospect (e.g. no real fit) — never SENT-eligible
// Preview date for "if you sent today" — the real date always comes from the
// operator's send evidence, never from this file.
const PREVIEW_SEND = "2026-09-17";

const ledger = readFileSync(LEDGER, "utf8");
const rows = [...ledger.matchAll(/^\| (P-\d+) \|([^|]*)\|[^|]*\|[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)];

if (rows.length === 0) {
  console.error("NUDGE-PRECOMPUTE FAIL: no ledger rows parsed");
  process.exit(1);
}

let eligible = 0;
let problems = 0;
const out = [];

for (const [, id, prospect, objective, draftFile, approval] of rows) {
  const tag = (objective.split("—")[0] || "").trim().split(/\s+/)[0];
  const draft = draftFile.trim();
  const appr = approval.trim();

  if (!KNOWN_TAGS.includes(tag)) { problems++; out.push(`${id} UNKNOWN TAG "${tag}"`); continue; }

  const path = `${DRAFTS}/${draft}`;
  if (!existsSync(path)) { problems++; out.push(`${id} draft missing on disk: ${draft}`); continue; }

  if (tag === "DRAFTED") {
    const text = readFileSync(path, "utf8");
    if (!text.includes("APPROVAL: PENDING")) {
      problems++; out.push(`${id} tag=DRAFTED but ${draft} is not APPROVAL: PENDING`); continue;
    }
    const due = addBusinessDays(PREVIEW_SEND, 5);
    eligible++;
    out.push(`${id}  ${prospect.trim().slice(0, 44).padEnd(44)}  nudge-due if sent ${PREVIEW_SEND}: ${due}`);
  } else {
    out.push(`${id}  tag=${tag} (approval cell: ${appr}) — not SENT-eligible, skipped`);
  }
}

console.log(out.join("\n"));
console.log(`\nnudge-precompute: ${eligible} SENT-eligible rows, ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
