#!/usr/bin/env node
/**
 * track-b-crawl.mjs — run the free-QA-report generator over the Track B
 * prospect list (session 11, 2026-09-24). One HTML report + one JSON
 * evidence twin per prospect under outreach/qa-reports/, plus a one-line
 * scorecard. The crawl IS the verification: what the report found is the
 * only thing a draft may claim. No AI, no fabrication — deterministic
 * checks only.
 *
 *   node scripts/track-b-crawl.mjs
 *   node scripts/track-b-crawl.mjs --only cybershift,viztech360
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Track B candidates (session 11). slug | start url | label. */
const PROSPECTS = [
  { slug: "webact", url: "https://www.webact.com/", label: "WebAct (New Philadelphia, OH)" },
  { slug: "cybershift", url: "https://cybershifttech.com/", label: "Cyber Shift Technologies (Sugarcreek, OH)" },
  { slug: "viztech360", url: "https://viztech360.com/", label: "VizTech360 (Dover/New Philly area, OH)" },
  { slug: "grantstreet", url: "https://grantstreetcreative.com/", label: "Grantstreet Creative (Dover, OH)" },
  { slug: "aenfinite", url: "https://aenfinite.com/locations/ohio/new-philadelphia/", label: "aEnfinite (New Philadelphia, OH)" },
  { slug: "snyder", url: "https://www.snyderadvertising.com/", label: "Snyder Advertising (Canal Fulton, OH)" },
  { slug: "tlwebdesign", url: "https://www.tlwebdesign.net/", label: "TL Web Design (Cleveland, OH)" },
  { slug: "wisesites", url: "https://wisesites.io/", label: "Wise Sites (Ohio small-business web/SEO)" },
  { slug: "otherworlds", url: "https://www.otherworldsinc.com/", label: "Otherworlds Inc (Cleveland–Akron, OH)" },
  { slug: "isynergy", url: "https://isynergy.io/", label: "iSynergy (Wooster, OH)" },
];

const OUT_DIR = path.resolve("outreach/qa-reports");
mkdirSync(OUT_DIR, { recursive: true });

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1].split(",")
  : null;

const results = [];
for (const p of PROSPECTS) {
  if (only && !only.includes(p.slug)) continue;
  const started = new Date().toISOString();
  try {
    // One page is enough for first-hand evidence of their OWN site's health;
    // agencies get a taste, a full audit is the paid conversation.
    await run("node", ["scripts/generate-qa-report.mjs", p.url, "--pages", "3", "--company", p.label, "--out", "outreach/qa-reports"], { timeout: 180_000 });
  } catch (error) {
    console.error(`  (crawl issue) ${p.slug}: ${String(error.message).slice(0, 140)}`);
  }
  results.push({ ...p, started });
}

// Summarize what actually landed on disk, matched by report filename.
const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("scorecard"));
const scorecard = [];
for (const p of results) {
  const match = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, mtime: statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .find(({ f }) => f.includes(p.slug.split("-")[0]) || f.toLowerCase().includes(p.label.toLowerCase().split(/[\s(]/)[0].toLowerCase()));
  if (!match) {
    scorecard.push({ slug: p.slug, status: "NO_REPORT" });
    console.log(`✖ ${p.slug.padEnd(12)} no report on disk`);
    continue;
  }
  const data = JSON.parse(readFileSync(path.join(OUT_DIR, match.f), "utf8"));
  const sev = {};
  for (const f of data.findings) sev[f.severity] = (sev[f.severity] ?? 0) + 1;
  const line = `✔ ${p.slug.padEnd(12)} score ${String(data.score).padStart(3)}/100 · ${data.pagesVisited}p · ${JSON.stringify(sev)}`;
  console.log(line);
  scorecard.push({ slug: p.slug, label: p.label, report: match.f, score: data.score, pages: data.pagesVisited, findings: data.findings, started: p.started });
}

writeFileSync(path.join(OUT_DIR, `scorecard-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(scorecard, null, 2));
console.log(`\nscorecard → outreach/qa-reports/scorecard-${new Date().toISOString().slice(0, 10)}.json`);
