#!/usr/bin/env node
/**
 * outreach-audit.mjs — end-to-end drift audit across the outreach system of record.
 *
 * Cross-checks (read-only):
 *   A. every SENT ledger row's message-id exists in send-evidence-log.md, and
 *      every send-evidence entry maps back to a SENT row (orphans).
 *   B. every nudge file stamped SENT has a nudge-evidence-log entry + a ledger
 *      "nudged <date>" annotation, and every nudge-evidence entry has such a file.
 *   C. every ledger row carrying a (first) nudge due date has exactly one staged
 *      nudge file; every row carrying "next nudge due" (second wave) has one
 *      second-nudge file; staged due files map back to exactly one such row.
 *   D. every nudge file's PARENT DRAFT exists and is not APPROVAL: PENDING.
 *   E. every nudge file's recipient matches its ledger row's public email;
 *      gate lines are structurally valid (HOLD+due / SENT / GO); no duplicate
 *      recipients across staged nudges; no orphan nudge files.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const ledger = readFileSync("sales/ledger.md", "utf8");
const sendLog = readFileSync("sales/send-evidence-log.md", "utf8");
const nudgeLog = readFileSync("sales/nudge-evidence-log.md", "utf8");
const nudgesDir = "outreach/nudges";
const draftsDir = "outreach/drafts";

const problems = [];
const notes = [];
const P = (msg) => problems.push(msg);
const N = (msg) => notes.push(msg);

// ── Parse ledger rows ──────────────────────────────────────────────────────
const rows = [];
for (const line of ledger.split("\n")) {
  const m = line.match(/^\| (P-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/);
  if (!m) continue;
  const [, id, company, , channel, angle, draftRef, approval, status, evidence, due, dateCol] = m.map(s => s.trim());
  rows.push({ id, company, channel, angle, draftRef, approval, status, evidence, due, dateCol, raw: line });
}
const sentRows = rows.filter(r => r.status === "SENT");
console.log(`ledger rows parsed: ${rows.length} (SENT: ${sentRows.length})`);

// ── Parse evidence logs ───────────────────────────────────────────────────
const cleanId = (s) => s?.replace(/[,;)\]]+$/, "");
const sendIds = new Map(); // message-id -> company header
for (const block of sendLog.split(/^## /m).slice(1)) {
  const company = block.split(" — ")[0]?.trim();
  const mid = cleanId(block.match(/message-id:\s*(\S+)/)?.[1]);
  if (company && mid) sendIds.set(mid, company);
}
const nudgeEntries = new Map(); // nudge filename -> { mid, nudgedDate, originalMid }
for (const block of nudgeLog.split(/^## /m).slice(1)) {
  const fname = block.split(" — ")[0]?.trim();
  const mid = cleanId(block.match(/message-id:\s*<([^>]+)>/)?.[1]);
  const date = block.match(/sent date:\s*(\S+)/)?.[1];
  const orig = cleanId(block.match(/original send message-id\s*(\S+)/)?.[1]);
  if (fname) nudgeEntries.set(fname, { mid, date, orig });
}
console.log(`send-evidence entries: ${sendIds.size} | nudge-evidence entries: ${nudgeEntries.size}`);

// ── Parse nudge files ─────────────────────────────────────────────────────
const nudgeFiles = new Map(); // filename -> parsed
for (const f of readdirSync(nudgesDir).filter(x => x.endsWith(".md"))) {
  const t = readFileSync(`${nudgesDir}/${f}`, "utf8");
  const gate = t.split("\n").find(l => l.startsWith("NUDGE-GATE:")) ?? "";
  const recipient = t.match(/\*\*Recipient:\*\*\s*(\S+)/)?.[1] ?? "";
  const origMid = cleanId(t.match(/Original:.*message-id\s+(\S+)/)?.[1] ?? "");
  const firstMid = cleanId(t.match(/First nudge:.*message-id\s+(\S+)/)?.[1] ?? "");
  const parent = t.match(/PARENT DRAFT:\s*(\S+)/)?.[1] ?? "";
  const isSecond = /#\d/.test(t.match(/^# .*$/m)?.[0] ?? "");
  const gateState = gate.startsWith("NUDGE-GATE: SENT") ? "SENT"
    : /NUDGE-GATE:\s*GO/.test(gate) ? "GO"
    : /NUDGE-GATE:\s*HOLD/.test(gate) ? "HOLD"
    : /NUDGE-GATE:\s*CANCELLED/.test(gate) ? "CANCELLED" // reply received (sales/reply-playbooks.md): permanent never-send, same skip class as the transport
    : "INVALID";
  nudgeFiles.set(f, { gate, gateState, recipient, origMid, firstMid, parent, isSecond, body: t });
}
console.log(`nudge files: ${nudgeFiles.size}`);

// ── A. ledger rows carrying message-id evidence <-> send-evidence-log ─────
// Anchored on evidence (the message-id), not the status token: a row that
// later receives a reply (REPLIED/CLOSED annotations) keeps its send evidence
// — the send is historical fact and its evidence entry must never orphan.
const rowsWithMid = rows.filter(r => /message-id\s+\S+@/.test(r.evidence));
for (const r of rowsWithMid) {
  const mid = cleanId(r.evidence.match(/message-id\s+(\S+)/)?.[1]);
  if (!mid) P(`A ${r.id}: row carries message-id evidence but it failed to parse`);
  else if (!sendIds.has(mid)) P(`A ${r.id}: message-id ${mid} NOT in send-evidence-log`);
}
for (const [mid, company] of sendIds) {
  if (!rowsWithMid.some(r => r.evidence.includes(mid)))
    P(`A orphan send-evidence entry: ${company} (${mid}) has no ledger row carrying its message-id`);
}

// ── B. SENT-gated nudge files <-> nudge-evidence-log <-> ledger ───────────
for (const [f, nf] of nudgeFiles) {
  if (nf.gateState === "SENT") {
    const mid = nf.gate.match(/message-id <([^>]+)>/)?.[1];
    const entry = nudgeEntries.get(f);
    if (!entry) P(`B ${f}: gate says SENT but no nudge-evidence-log entry`);
    else if (mid && entry.mid !== mid) P(`B ${f}: gate message-id ${mid} != evidence-log ${entry.mid}`);
    const nudged = sentRows.find(r => r.due.includes("nudged") && (entry && r.evidence.includes(entry.orig ?? "")));
    if (entry?.orig && !nudged) P(`B ${f}: original message-id ${entry.orig} row not annotated "nudged"`);
  }
}
for (const [f, entry] of nudgeEntries) {
  if (!nudgeFiles.has(f)) P(`B orphan nudge-evidence entry: ${f} — no such nudge file`);
}

// ── C. due rows <-> staged due files ──────────────────────────────────────
// ── C. due rows <-> staged due files (reply-aware) ────────────────────────
// Membership anchored on evidence (message-id), not the status token: a row
// whose reply arrived (tag flips toward REPLIED, due cell says CANCELLED)
// stays covered by its now-CANCELLED file instead of orphaning it.
const dueMap = new Map(); // due date -> Set(rowId)
for (const r of rowsWithMid) {
  const first = r.due.match(/(?:^|\()nudge due (\d{4}-\d{2}-\d{2})/)?.[1]
    ?? r.due.match(/next nudge due (\d{4}-\d{2}-\d{2})/)?.[1];
  if (first) {
    if (!dueMap.has(first)) dueMap.set(first, new Set());
    dueMap.get(first).add(r.id);
  }
}
const monthRe = (d) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-nudge-.*\\.md$`);
const byDue = (d) => [...nudgeFiles.keys()].filter(f => f.startsWith(d));
const dueDates = [...dueMap.keys()].sort();
console.log(`due dates in ledger: ${dueDates.join(", ")}`);
for (const due of dueDates) {
  const rowIds = dueMap.get(due);
  const files = byDue(due);
  // rows for this due date
  const rowsForDue = rowsWithMid.filter(r =>
    (r.due.includes(`nudge due ${due}`) || r.due.includes(`next nudge due ${due}`)));
  if (files.length !== rowsForDue.length)
    N(`C ${due}: ${rowsForDue.length} ledger rows vs ${files.length} staged files`);
  for (const r of rowsForDue) {
    const mid = cleanId(r.evidence.match(/message-id\s+(\S+@[^\s;]+)/)?.[1]);
    const matches = [...nudgeFiles.entries()].filter(([f, nf]) =>
      (nf.gateState === "HOLD" || nf.gateState === "GO") && // live staged files; CANCELLED files are the receipt, not pending coverage
      (nf.origMid === mid || nf.firstMid === mid));
    if (matches.length === 0) {
      if (r.due.includes("CANCELLED"))
        N(`C ${r.id} (${r.company}): nudge CANCELLED (reply received) — no live file staged, correct`);
      else
        P(`C ${r.id} (${r.company}): no staged nudge file references its message-id ${mid}`);
    }
    else if (matches.length > 1) P(`C ${r.id}: MULTIPLE staged files match (${matches.map(m => m[0]).join(", ")})`);
    else {
      const [f, nf] = matches[0];
      const fileDue = f.slice(0, 10);
      if (fileDue !== due) P(`C ${r.id}: row due ${due} but file dated ${fileDue} (${f})`);
      if (!nf.gate.includes(due) && nf.gateState === "HOLD") P(`C ${f}: gate line missing due date ${due}`);
    }
  }
  for (const f of files) {
    const nf = nudgeFiles.get(f);
    const mid = nf.origMid || nf.firstMid;
    const r = rowsForDue.find(r => mid && r.evidence.includes(mid));
    if (!r) P(`C orphan staged file ${f}: message-id ${mid} not on any ${due}-due row`);
  }
}

// ── D. parents exist + approved ───────────────────────────────────────────
for (const [f, nf] of nudgeFiles) {
  if (!nf.parent) { P(`D ${f}: no PARENT DRAFT line`); continue; }
  if (!existsSync(nf.parent)) { P(`D ${f}: parent missing on disk: ${nf.parent}`); continue; }
  const pt = readFileSync(nf.parent, "utf8");
  const approval = pt.match(/APPROVAL:\s*(\S+)/)?.[1];
  if (!approval) P(`D ${f}: parent ${nf.parent} has no APPROVAL line`);
  else if (approval === "PENDING") P(`D ${f}: parent ${nf.parent} still PENDING (drift guard would block)`);
  // D2: ledger draftRef should match the parent file for SENT rows
  const r = sentRows.find(r => (cleanId(r.evidence.match(/message-id\s+(\S+@[^\s;]+)/)?.[1])) === (nf.origMid || undefined));
  if (r && nf.origMid) {
    const refFile = `outreach/drafts/${r.draftRef}`;
    const parentFile = nf.parent.replace(/\.md$/, "");
    if (existsSync(refFile) && !parentFile.includes(r.draftRef.replace(/\.md$/, "").replace("outreach/drafts/", "")))
      N(`D2 ${r.id}: ledger draftRef ${r.draftRef} vs nudge parent ${nf.parent}`);
  }
}

// ── E. recipients, gate integrity, duplicates, orphans ────────────────────
const emailFromRow = (r) => r.channel.match(/([\w.+-]+@[\w.-]+)/)?.[1]?.toLowerCase();
const recipientSeen = new Map();
for (const [f, nf] of nudgeFiles) {
  if (nf.gateState === "INVALID") P(`E ${f}: malformed NUDGE-GATE line: ${nf.gate.slice(0, 60)}`);
  if (!nf.recipient) P(`E ${f}: no Recipient line`);
  const mid = nf.origMid || nf.firstMid;
  const r = rows.find(r => mid && r.evidence.includes(mid));
  if (r) {
    const rowEmail = emailFromRow(r);
    if (rowEmail && nf.recipient && rowEmail !== nf.recipient.toLowerCase())
      P(`E ${f}: recipient ${nf.recipient} != ledger email ${rowEmail} (${r.id})`);
  } else if (nf.gateState !== "SENT" && nf.gateState !== "CANCELLED") {
    P(`E ${f}: recipient/owner row not found by message-id ${mid}`);
  }
  if (nf.gateState !== "SENT" && nf.gateState !== "CANCELLED" && nf.recipient) {
    // duplicate-recipient guard applies to SENDABLE files only — CANCELLED
    // files are historical records and may share a recipient with a live file.
    const key = nf.recipient.toLowerCase();
    if (recipientSeen.has(key)) P(`E duplicate recipient across staged nudges: ${key} (${recipientSeen.get(key)} + ${f})`);
    recipientSeen.set(key, f);
  }
}
// nudge files with neither origMid nor firstMid
for (const [f, nf] of nudgeFiles) {
  if (!nf.origMid && !nf.firstMid) P(`E ${f}: carries no original message-id`);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n===== FINDINGS (${problems.length} problems, ${notes.length} notes) =====`);
for (const p of problems) console.log("PROBLEM  " + p);
for (const n of notes) console.log("note     " + n);
if (!problems.length) console.log("NO STRUCTURAL DRIFT FOUND — all cross-checks pass.");
console.log(`\nCounts: SENT rows ${sentRows.length} | send-evidence ${sendIds.size} | nudge files ${nudgeFiles.size} (SENT-gated ${[...nudgeFiles.values()].filter(x => x.gateState === "SENT").length}, HOLD ${[...nudgeFiles.values()].filter(x => x.gateState === "HOLD").length}, GO ${[...nudgeFiles.values()].filter(x => x.gateState === "GO").length}, CANCELLED ${[...nudgeFiles.values()].filter(x => x.gateState === "CANCELLED").length}) | nudge-evidence ${nudgeEntries.size}`);
