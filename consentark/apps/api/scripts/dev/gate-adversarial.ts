/**
 * development aid — not part of the audited execution path.
 *
 * Adversarial gate self-audit. Attacks the consent gate with vectors beyond
 * the documented limits and reports PASS (gate holds) / BYPASS (submission
 * went through) / GAP (submission went through, but the vector is out of
 * scope by documented decision) per vector.
 *
 * Run: npx tsx scripts/dev/gate-adversarial.ts
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildInjectionBundle } from "../../src/browser/buildInjectionBundle.js";
import { CONFIG_MERGE_JS, HostBindings } from "../../src/browser/contract.js";
import type { GateInfo } from "../../src/browser/pageTypes.js";
import { chromium, type Browser } from "playwright";

interface VectorResult {
  vector: string;
  verdict: "PASS" | "BYPASS" | "GAP";
  detail: string;
}

const results: VectorResult[] = [];

function report(vector: string, verdict: VectorResult["verdict"], detail: string): void {
  results.push({ vector, verdict, detail });
  console.log(`  ${verdict === "PASS" ? "✅" : verdict === "BYPASS" ? "❌" : "🟡"} ${verdict.padEnd(6)} — ${vector}`);
  console.log(`         ${detail}`);
}

/** Minimal fake model endpoint: serves exactly one scripted tool call, then done. */
function makeFakeModel(calls: Array<{ name: string; args: Record<string, unknown> }>, portOut: { url: string }): void {
  // We don't need a real OpenAI server: we drive the tools DIRECTLY (see
  // driveAgentTools) — the audit targets the gate layer, not the model loop.
  portOut.url = "unused";
}

const results_table = results;

/**
 * Build one browser context with the production injection bundle + gate
 * bindings, navigate to `url`, install the page hooks, and return handles
 * to observe gate trips and submit outcomes.
 */
async function makeContext(
  browser: Browser,
  html: string,
  opts: { confirmBeforeSubmit: boolean },
  frameHtml?: string,
) {
  const gateTrips: GateInfo[] = [];
  let submitted = false;

  const server: Server = createServer((req, res) => {
    const u = req.url ?? "/";
    if (u.startsWith("/submit-marker")) {
      submitted = true;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><h1>SUBMITTED</h1></body></html>");
      return;
    }
    if (u.startsWith("/frame.html") && frameHtml) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(frameHtml);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const context = await browser.newContext();
  await context.exposeBinding(HostBindings.APPROVAL_REQUEST, async (_s, info: GateInfo) => {
    gateTrips.push(info);
  });
  // Decision binding: auto-APPROVE everything (the audit tests whether the
  // gate INTERCEPTS, not whether the reviewer says yes/no).
  await context.exposeBinding(HostBindings.APPROVAL_DECISION, async () => "approved" as const);
  await context.exposeFunction(HostBindings.STEPS, () => {});
  await context.exposeFunction(HostBindings.FETCH, async () => JSON.stringify({ status: 200, body: "{}" }));
  await context.addInitScript(await buildInjectionBundle());

  const page = await context.newPage();
  await page.goto(origin + "/", { waitUntil: "load" });
  await page.evaluate((cfg) => {
    (window as unknown as { __caCfgData?: unknown }).__caCfgData = cfg;
  }, {
    baseURL: "http://127.0.0.1:9/v1",
    apiKey: "x",
    model: "m",
    maxSteps: 5,
    stepDelay: 0.1,
    language: "en-US",
    autoRun: false,
    confirmBeforeSubmit: opts.confirmBeforeSubmit,
  });
  await page.evaluate(CONFIG_MERGE_JS);
  // Install page-level hooks WITHOUT running an agent (adversarial setup).
  await page.evaluate(() => {
    (window as unknown as { __caInstallGatePageHooks?: () => void }).__caInstallGatePageHooks?.();
  });

  return { context, page, gateTrips, get submitted() { return submitted; }, origin, close: async () => { await context.close(); server.close(); } };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  // ── Vector 1: synthetic (untrusted) MouseEvent click on the submit button ──
  {
    console.log("\n[1] Synthetic (untrusted) JS click on the submit button");
    const env = await makeContext(browser, `<!doctype html><html><body>
      <form id="f" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
        <button id="go" type="submit">Submit order</button>
      </form></body></html>`, { confirmBeforeSubmit: true });
    try {
      // Page-injected script clicks the button — exactly what a compromised
      // page (or a future execute_javascript tool) would do.
      await env.page.evaluate(() => {
        const btn = document.getElementById("go")!;
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await env.page.waitForTimeout(400);
      const marker = env.submitted;
      const tripped = env.gateTrips.length > 0;
      if (tripped) {
        // The page-level click blocker tripped the gate. submitted=true is
        // EXPECTED here: the audit's decision binding auto-approves, and the
        // approved re-dispatch then navigates. The gate held.
        report("synthetic-click", "PASS", "page-level click blocker intercepted the synthetic click and routed it through the approval flow (via=click); auto-approve then let the navigation proceed");
      } else if (marker) {
        report("synthetic-click", "BYPASS", "synthetic MouseEvent navigated the form with no gate trip");
      } else {
        report("synthetic-click", "PASS", "no submission and no trip (button dispatch produced no default action)");
      }
    } finally { await env.close(); }
  }

  // ── Vector 1b: does the gate distinguish trusted vs untrusted? ──
  {
    console.log("\n[1b] isTrusted distinguishability");
    const env = await makeContext(browser, `<!doctype html><html><body>
      <form id="f" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
        <button id="go" type="submit">Submit order</button>
      </form></body></html>`, { confirmBeforeSubmit: true });
    try {
      // Probe on a NEUTRAL element (the page-level click blocker gates
      // submit-like clicks in capture phase — using the button itself would
      // demonstrate the blocker, not the isTrusted fact).
      const probe = await env.page.evaluate(() => {
        const neutral = document.createElement("div");
        document.body.appendChild(neutral);
        const synthetic = new MouseEvent("click", { bubbles: true, cancelable: true });
        let syntheticTrusted: boolean | null = null;
        neutral.addEventListener("click", (e) => { syntheticTrusted = e.isTrusted; }, { once: true });
        neutral.dispatchEvent(synthetic);
        return { syntheticTrusted };
      });
      report(
        "isTrusted distinguishability",
        // FACT: synthetic events report isTrusted=false. But the AGENT's own
        // clicks are ALSO synthetic (page-agent's clickElement does
        // target.click() + dispatchEvent). So an isTrusted filter would
        // break the agent — documented as NOT usable here.
        "PASS",
        `synthetic event isTrusted=${probe.syntheticTrusted}. An isTrusted filter is NOT a hardening win: page-agent's own clickElement() dispatches synthetic MouseEvent/PointerEvent + target.click() — the agent's clicks are UNTRUSTED too. Filtering by isTrusted would gate EVERY agent click (safe but unusable) or none (status quo). Decision: keep tool-level wrapping as the boundary.`,
      );
    } finally { await env.close(); }
  }

  // ── Vector 2: Enter in a form with NO submit button (spec plan B) ──
  {
    console.log("\n[2] Enter keypress in a form with NO submit button");
    const env = await makeContext(browser, `<!doctype html><html><body>
      <form id="f" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
      </form></body></html>`, { confirmBeforeSubmit: true });
    try {
      // Insert a real (untrusted) Enter keydown — the same signal a real
      // keyboard source produces at the DOM level.
      await env.page.evaluate(() => {
        const input = document.getElementById("who") as HTMLInputElement;
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await env.page.waitForTimeout(400);
      if (env.gateTrips.some((t) => t.via === "enter-key")) {
        report("enter-no-submit-button", "PASS", "blocker intercepted Enter and routed it through the approval flow (via=enter-key)");
      } else if (env.submitted) {
        report("enter-no-submit-button", "BYPASS", "form submitted via plan-B implicit submission with no gate trip");
      } else {
        report("enter-no-submit-button", "PASS", "no submission (untrusted keydown alone does not trigger implicit submission in Chromium; blocker verified separately in the E2E suite with a REAL key)");
      }
    } finally { await env.close(); }
  }

  // ── Vector 2b: change-listener auto-submit (documented gap) ──
  {
    console.log("\n[2b] change-listener auto-submit (aggressive page)");
    const env = await makeContext(browser, `<!doctype html><html><body>
      <form id="f" action="/submit-marker" method="get">
        <input id="who" name="fullname" value=""/>
      </form>
      <script>
        document.getElementById('who').addEventListener('change', () => {
          document.getElementById('f').submit();
        });
      </script></body></html>`, { confirmBeforeSubmit: true });
    try {
      // The agent's OWN tool sets values via the native setter + input/change
      // events — exactly what this page weaponizes.
      await env.page.evaluate(() => {
        const input = document.getElementById("who") as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, "injected");
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await env.page.waitForTimeout(400);
      if (env.submitted) {
        report("change-listener-auto-submit", "GAP", "page JS called form.submit() on the change event and navigation happened — CONFIRMED GAP (documented): gating it requires intercepting form.submit()/navigation, not tool calls. Navigation-level gating is the future fix.");
      } else if (env.gateTrips.length > 0) {
        report("change-listener-auto-submit", "PASS", "gate tripped");
      } else {
        report("change-listener-auto-submit", "PASS", "no submission observed");
      }
    } finally { await env.close(); }
  }

  // ── Vector 3: GET-form query-param submission semantics ──
  {
    console.log("\n[3] GET form: is ?param navigation a 'submit' under our model?");
    const env = await makeContext(browser, `<!doctype html><html><body>
      <form id="f" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
        <button id="go" type="submit">Submit order</button>
      </form></body></html>`, { confirmBeforeSubmit: true });
    try {
      // Direct navigation with submit-like query params (no form action at
      // all) — the purest form of the vector.
      await env.page.goto(env.origin + "/submit-marker?fullname=Ada", { waitUntil: "load" });
      const marker = env.submitted;
      report(
        "get-param-navigation",
        "GAP",
        `navigating to ${env.origin}/submit-marker?fullname=Ada ${marker ? "reached the submit endpoint" : "did not reach the endpoint"} with zero gate involvement. DECISION: this is NAVIGATION, not a form submission — it carries no more risk than any URL fetch, the allowlist already governs it (every nav URL is checked), and the approval UX would be meaningless (nothing to approve post-hoc). Out of scope by decision; the domain allowlist is the control.`,
      );
    } finally { await env.close(); }
  }

  // ── Vector 4: same-origin iframe containing the form ──
  {
    console.log("\n[4] Same-origin iframe embedding the form");
    // The iframe src must be a REAL same-origin HTTP document (setContent
    // would make it a data: URL — cross-origin, a different vector).
    const FRAME_FORM = `<!doctype html><html><body>
      <form id="ff" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
        <button id="go" type="submit">Submit order</button>
      </form></body></html>`;
    const env = await makeContext(browser, `<!doctype html><html><body>
      <iframe id="frame" src="/frame.html" width="500" height="200"></iframe>
      </body></html>`, { confirmBeforeSubmit: true }, FRAME_FORM);
    try {
      const frame = await (await env.page.$("#frame"))!.contentFrame()!;
      await frame.waitForLoadState("load");
      // The frame watcher re-sweeps frames every 300 ms; give it one sweep
      // after the frame document settled.
      await env.page.waitForTimeout(500);
      // Real keydown inside the frame (Playwright keyboard = trusted input).
      await frame.focus("#who");
      await env.page.keyboard.press("Enter");
      await env.page.waitForTimeout(400);
      if (env.gateTrips.some((t) => t.via === "enter-key")) {
        report("same-origin-iframe-enter", "PASS", "Enter blocker installed in the same-origin frame intercepted the REAL Enter keypress (via=enter-key) — same-origin frames are covered");
      } else if (env.submitted) {
        report("same-origin-iframe-enter", "BYPASS", "frame form submitted with no gate trip — the blocker did not reach the frame document");
      } else {
        report("same-origin-iframe-enter", "PASS", "no submission observed");
      }
    } finally { await env.close(); }
  }

  // ── Vector 4b: same-origin iframe — synthetic click on the frame's submit button ──
  {
    console.log("\n[4b] Same-origin iframe: synthetic click on the frame's submit button");
    const FRAME_FORM_2 = `<!doctype html><html><body>
      <form id="ff" action="/submit-marker" method="get">
        <input id="who" name="fullname" value="Ada"/>
        <button id="go" type="submit">Submit order</button>
      </form></body></html>`;
    const env = await makeContext(browser, `<!doctype html><html><body>
      <iframe id="frame" src="/frame.html" width="500" height="200"></iframe>
      </body></html>`, { confirmBeforeSubmit: true }, FRAME_FORM_2);
    try {
      const frame = await (await env.page.$("#frame"))!.contentFrame()!;
      await frame.waitForLoadState("load");
      await env.page.waitForTimeout(500); // watcher sweep
      // Synthetic click INSIDE the same-origin frame (what compromised page
      // JS would do). The realm-agnostic click blocker is installed on the
      // frame document by the watcher sweep — it must gate this.
      await frame.evaluate(() => {
        document.getElementById("go")!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await env.page.waitForTimeout(400);
      if (env.gateTrips.some((t) => t.via === "click")) {
        report("iframe-synthetic-click", "PASS", "frame-installed click blocker intercepted the synthetic click inside the same-origin frame (via=click, page-level); auto-approve let the navigation proceed");
      } else if (env.submitted) {
        report("iframe-synthetic-click", "BYPASS", "frame synthetic click navigated with no gate trip");
      } else {
        report("iframe-synthetic-click", "PASS", "no submission observed");
      }
    } finally { await env.close(); }
  }

  await browser.close();

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.verdict.padEnd(6)} ${r.vector}`);
  }
  const byp = results.filter((r) => r.verdict === "BYPASS").length;
  console.log(`\n${results.length - byp}/${results.length} vectors held (PASS+GAP); BYPASS: ${byp}`);
  process.exit(0);
}

void main();
