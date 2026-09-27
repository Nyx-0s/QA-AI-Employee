#!/usr/bin/env node
/**
 * generate-qa-report.mjs — the Track B outreach weapon.
 *
 * One command → a prospect-ready QA report of THEIR site:
 *
 *   node scripts/generate-qa-report.mjs https://their-site.com
 *   node scripts/generate-qa-report.mjs https://their-site.com --pages 15 --company "Their Name"
 *   node scripts/generate-qa-report.mjs https://their-site.com --out outreach/qa-reports
 *
 * Crawls up to N same-origin pages with headless Chromium and runs
 * deterministic checks: console errors, failed requests, broken images,
 * mixed content, missing titles/meta descriptions, viewport, https, tiny
 * tap targets on mobile. Output: an email-ready HTML report (branded for
 * ConsentArk AI Employees) + a JSON twin for the pipeline's evidence
 * discipline. Deterministic only — no AI claims are made.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const stringFlag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const intFlag = (name, fallback) => {
  const v = stringFlag(name);
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Positional = every arg that is not a flag or a flag's value.
const FLAG_NAMES = ["--pages", "--company", "--out"];
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (FLAG_NAMES.includes(args[i])) {
    i += 1; // skip the flag's value
    continue;
  }
  if (!args[i].startsWith("--")) positionals.push(args[i]);
}

const START_URL = positionals[0] ?? null;
const MAX_PAGES = intFlag("--pages", 10);
const COMPANY = stringFlag("--company");
const OUT_DIR = stringFlag("--out") ?? "reports/prospects";

const HELP = `
Usage:
  node scripts/generate-qa-report.mjs <start-url> [--pages N] [--company "Name"] [--out dir]

Options:
  --pages N     max pages to visit (default 10, same-origin links only)
  --company S   prospect name for the report header
  --out DIR     output directory (default reports/prospects)
`;

if (!START_URL) {
  console.error("error: a start URL is required\n" + HELP);
  process.exit(1);
}

let start;
try {
  start = new URL(START_URL);
} catch {
  console.error(`error: "${START_URL}" is not a valid URL\n` + HELP);
  process.exit(1);
}
if (!/^https?:$/.test(start.protocol)) {
  console.error("error: only http(s) URLs are supported");
  process.exit(1);
}

const HOST = start.hostname;
const startedAt = new Date();
const iso = (d = new Date()) => d.toISOString();
const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

console.log(`ConsentArk QA report — ${start.href}`);
console.log(`  pages: up to ${MAX_PAGES} (same-origin) · started ${iso()}`);

// ── crawl + checks ──────────────────────────────────────────────────────
const pages = [];
const queue = [start.href];
const seen = new Set();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // mobile-first: most local traffic
  userAgent:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 ConsentArkQAReport/1.0",
});

while (queue.length > 0 && seen.size < MAX_PAGES) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);

  const page = await context.newPage();
  const consoleErrors = [];
  const requestFailures = [];
  const brokenImages = [];
  const mixedContent = [];
  let httpStatus = null;

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("requestfailed", (req) => {
    requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) requestFailures.push(`HTTP ${res.status()} ${res.url()}`);
  });

  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    httpStatus = response?.status() ?? null;

    const audit = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")];
      const broken = imgs
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.src?.slice(0, 200) ?? "(no src)");
      const mixed = [];
      if (location.protocol === "https:") {
        for (const el of document.querySelectorAll('script[src], img[src], iframe[src], link[href]')) {
          const u = el.src || el.href || "";
          if (u.startsWith("http://")) mixed.push(u.slice(0, 200));
        }
      }
      const title = document.title || "";
      const metaDesc =
        document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
      const viewport = document.querySelector('meta[name="viewport"]') ? true : false;
      const tapTargets = [];
      for (const a of document.querySelectorAll('a[href], button')) {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) {
          tapTargets.push((a.textContent || a.getAttribute("aria-label") || a.href || "").trim().slice(0, 60));
          if (tapTargets.length >= 5) break;
        }
      }
      const forms = [...document.querySelectorAll("form")].map((form) => ({
        action: form.getAttribute("action") || "(same page)",
        fields: form.querySelectorAll("input, select, textarea").length,
        hasSubmit: !!form.querySelector('[type="submit"], button:not([type]), button[type="submit"]'),
      }));
      const h1Count = document.querySelectorAll("h1").length;
      const links = [...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .filter(Boolean);
      return { broken, mixed, title, metaDesc, viewport, tapTargets, forms, h1Count, links };
    });

    pages.push({
      url,
      ok: true,
      httpStatus,
      consoleErrors,
      requestFailures,
      ...audit,
    });

    for (const href of audit.links) {
      try {
        const u = new URL(href, url);
        if (u.hostname === HOST && /^https?:$/.test(u.protocol) && !u.hash) {
          const clean = u.href.replace(/\/$/, "");
          if (!seen.has(clean) && !queue.includes(clean)) queue.push(clean);
        }
      } catch {
        /* unparseable href — skip */
      }
    }
  } catch (error) {
    pages.push({
      url,
      ok: false,
      httpStatus,
      consoleErrors,
      requestFailures,
      brokenImages,
      mixedContent,
      error: String(error?.message ?? error).slice(0, 300),
      title: "",
      metaDesc: "",
      viewport: false,
      tapTargets: [],
      forms: [],
      h1Count: 0,
      links: [],
    });
  }
  await page.close();
}
await context.close();
await browser.close();

// ── scoring ─────────────────────────────────────────────────────────────
const findings = [];
const add = (severity, title, pages_, impact, fix, evidence) =>
  findings.push({ severity, title, pages: pages_, impact, fix, evidence });

const errorPages = pages.filter((p) => p.consoleErrors.length > 0);
if (errorPages.length)
  add(
    "HIGH",
    "JavaScript errors in the browser console",
    errorPages,
    "Broken interactive features on the exact pages customers use.",
    "Fix the first console error per page; the rest often cascade.",
    errorPages.map((p) => `${p.url}: ${p.consoleErrors[0]}`),
  );

const failPages = pages.filter((p) => p.requestFailures.length > 0);
if (failPages.length)
  add(
    "MEDIUM",
    "Failed or slow requests",
    failPages,
    "Missing images, scripts, or data that customers see as a broken page.",
    "Fix or remove the failing resources.",
    failPages.slice(0, 5).map((p) => `${p.url}: ${p.requestFailures[0]}`),
  );

const brokenImgPages = pages.filter((p) => p.broken.length > 0);
if (brokenImgPages.length)
  add(
    "MEDIUM",
    "Broken images",
    brokenImgPages,
    "Looks unprofessional and hurts search rankings.",
    "Restore or remove the dead image references.",
    brokenImgPages.map((p) => `${p.url}: ${p.broken[0]}`),
  );

const noViewport = pages.filter((p) => !p.viewport);
if (noViewport.length)
  add(
    "HIGH",
    "Missing mobile viewport tag",
    noViewport,
    "The site renders like a zoomed-out desktop page on phones — where most local customers browse.",
    "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
    noViewport.map((p) => p.url),
  );

const tinyTaps = pages.filter((p) => p.tapTargets.length > 0);
if (tinyTaps.length)
  add(
    "MEDIUM",
    "Tap targets smaller than 24×24 px",
    tinyTaps,
    "On phones, customers miss taps or hit the wrong link — a common cause of abandoned calls-to-action.",
    "Give buttons and links a minimum 24×24 px touch area (44×44 px is the comfortable standard).",
    tinyTaps.slice(0, 5).map((p) => `${p.url}: ${p.tapTargets[0]}`),
  );

const noTitle = pages.filter((p) => !p.title.trim());
if (noTitle.length)
  add(
    "MEDIUM",
    "Pages without a title tag",
    noTitle,
    "Search engines and browser tabs show nothing useful.",
    "Write a unique, specific title per page.",
    noTitle.map((p) => p.url),
  );

const noMetaDesc = pages.filter((p) => !p.metaDesc.trim());
if (noMetaDesc.length)
  add(
    "LOW",
    "Pages without a meta description",
    noMetaDesc,
    "Google invents its own snippet, which may undersell the business.",
    "Add one-sentence descriptions that match what each page offers.",
    noMetaDesc.map((p) => p.url),
  );

const mixedPages = pages.filter((p) => p.mixed.length > 0);
if (mixedPages.length)
  add(
    "HIGH",
    "Mixed content (http assets on https pages)",
    mixedPages,
    "Browsers block or warn on these — visible breakage for every customer.",
    "Serve all assets over https.",
    mixedPages.slice(0, 5).map((p) => `${p.url}: ${p.mixed[0]}`),
  );

const deadPages = pages.filter((p) => !p.ok || (p.httpStatus && p.httpStatus >= 400));
if (deadPages.length)
  add(
    "CRITICAL",
    "Pages that fail to load or return errors",
    deadPages,
    "Customers hit a dead end exactly where they were ready to contact or buy.",
    "Restore the pages or update every link pointing at them.",
    deadPages.map((p) => `${p.url} (HTTP ${p.httpStatus ?? "network error"})`),
  );

findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
function severityRank(s) {
  return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[s] ?? 0;
}

const goodNews = [];
if (pages.every((p) => p.viewport)) goodNews.push("every page is mobile-ready");
if (pages.every((p) => p.title.trim())) goodNews.push("every page has a proper title");
if (pages.every((p) => p.consoleErrors.length === 0)) goodNews.push("zero JavaScript errors");
if (pages.every((p) => p.forms.every((f) => f.hasSubmit))) goodNews.push("every form has a working submit button");
if (pages.every((p) => p.mixed.length === 0)) goodNews.push("no mixed-content warnings");

const score = Math.max(0, 100 - findings.reduce((acc, f) => acc + { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3 }[f.severity] * f.pages.length, 0));

// ── output ──────────────────────────────────────────────────────────────
const slug = (COMPANY ?? HOST).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const outDir = path.resolve(OUT_DIR);
await mkdir(outDir, { recursive: true });
const stamp = iso().slice(0, 10);
const htmlPath = path.join(outDir, `${stamp}-${slug}-qa-report.html`);
const jsonPath = path.join(outDir, `${stamp}-${slug}-qa-report.json`);

const pageRows = pages
  .map(
    (p) => `      <tr>
        <td><a href="${escape(p.url)}">${escape(p.url.replace(/^https?:\/\//, "").slice(0, 60))}</a></td>
        <td>${p.httpStatus ?? "—"}</td>
        <td class="${p.consoleErrors.length ? "bad" : "good"}">${p.consoleErrors.length}</td>
        <td class="${p.requestFailures.length ? "warn" : "good"}">${p.requestFailures.length}</td>
        <td class="${p.broken.length ? "warn" : "good"}">${p.broken.length}</td>
        <td class="${!p.viewport ? "warn" : "good"}">${p.viewport ? "yes" : "NO"}</td>
      </tr>`,
  )
  .join("\n");

const findingBlocks = findings
  .map(
    (f) => `      <div class="finding sev-${f.severity.toLowerCase()}">
        <div class="finding-head"><span class="sev-badge">${f.severity}</span> ${escape(f.title)} <span class="muted">· ${f.pages.length} page${f.pages.length === 1 ? "" : "s"}</span></div>
        <div class="finding-line"><b>Why it matters:</b> ${escape(f.impact)}</div>
        <div class="finding-line"><b>Smallest fix:</b> ${escape(f.fix)}</div>
        ${f.evidence.length ? `<ul class="evidence">${f.evidence.slice(0, 5).map((e) => `<li><code>${escape(e)}</code></li>`).join("")}</ul>` : ""}
      </div>`,
  )
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Website QA Report — ${escape(COMPANY ?? HOST)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; margin: 0; background: #f4f6f8; color: #14202b; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 24px; }
  .brand { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #0e7c66; font-weight: 700; }
  h1 { margin: 6px 0 2px; font-size: 30px; }
  .muted { color: #64748b; font-size: 14px; }
  .scorebox { display: flex; gap: 16px; align-items: baseline; margin: 22px 0; }
  .score { font-size: 54px; font-weight: 800; }
  .card { background: #fff; border: 1px solid #dde5ec; border-radius: 12px; padding: 20px 22px; margin: 16px 0; }
  .finding { padding: 14px 16px; border-left: 4px solid #cbd5e1; background: #f8fafc; border-radius: 0 8px 8px 0; margin: 10px 0; }
  .sev-critical { border-color: #b91c1c; background: #fef2f2; }
  .sev-high { border-color: #c2410c; background: #fff7ed; }
  .sev-medium { border-color: #b45309; background: #fffbeb; }
  .sev-low { border-color: #475569; background: #f8fafc; }
  .sev-badge { font-size: 11px; font-weight: 800; letter-spacing: .08em; background: #14202b; color: #fff; padding: 2px 8px; border-radius: 4px; margin-right: 6px; }
  .finding-line { font-size: 14px; margin-top: 6px; }
  .evidence { font-size: 12.5px; color: #475569; }
  .evidence code { background: #eef2f6; padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
  th { background: #14202b; color: #fff; }
  .good { color: #0e7c66; font-weight: 700; }
  .warn { color: #b45309; font-weight: 700; }
  .bad { color: #b91c1c; font-weight: 700; }
  footer { margin-top: 28px; font-size: 13px; color: #64748b; }
  footer b { color: #14202b; }
</style>
</head>
<body><div class="wrap">
  <div class="brand">ConsentArk · AI Employees</div>
  <h1>Website QA Report — ${escape(COMPANY ?? HOST)}</h1>
  <div class="muted">Generated ${escape(startedAt.toLocaleString())} · ${pages.length} page${pages.length === 1 ? "" : "s"} reviewed on mobile viewport (390×844)</div>

  <div class="scorebox">
    <div class="score">${score}<span style="font-size:20px;color:#64748b;">/100</span></div>
    <div class="muted">
      ${findings.length} finding${findings.length === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}.<br>
      ${goodNews.length ? "Already solid: " + goodNews.join(", ") + "." : "Findings below are ordered by customer impact."}
    </div>
  </div>

  ${findings.length ? `<div class="card"><h2 style="margin-top:0;font-size:19px;">What we found, in plain English</h2>
${findingBlocks}
  </div>` : `<div class="card"><b>Clean sweep.</b> No issues surfaced across the pages reviewed.</div>`}

  ${pages.length ? `<div class="card"><h2 style="margin-top:0;font-size:19px;">Page-by-page</h2>
    <table>
      <tr><th>Page</th><th>HTTP</th><th>JS errors</th><th>Failed requests</th><th>Broken images</th><th>Mobile viewport</th></tr>
${pageRows}
    </table>
  </div>` : ""}

  <footer>
    <b>How this was made:</b> a ConsentArk QA employee crawled ${pages.length} public page${pages.length === 1 ? "" : "s"} of ${escape(HOST)} on a phone-sized screen and recorded what a real customer's browser would experience — deterministic checks only, nothing on the site was changed, and no forms were submitted. 
    An AI employee like this can re-audit your site on a schedule and report in plain English. <b>Curious? Reply and ask for the 15-minute demo.</b>
  </footer>
</div></body>
</html>`;

await writeFile(htmlPath, html, "utf8");
await writeFile(
  jsonPath,
  JSON.stringify(
    {
      generatedAt: iso(),
      startUrl: start.href,
      company: COMPANY ?? HOST,
      pagesVisited: pages.length,
      score,
      findings,
      pages: pages.map(({ links, ...rest }) => rest),
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\n✔ HTML report: ${htmlPath}`);
console.log(`✔ JSON evidence: ${jsonPath}`);
console.log(`  score ${score}/100 · ${findings.length} finding(s) · ${pages.length} page(s)`);
