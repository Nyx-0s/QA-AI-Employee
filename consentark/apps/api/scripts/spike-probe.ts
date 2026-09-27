/**
 * Manual probe for the Phase 2 browser path — drives BrowserService directly
 * (no API server, no queue). Optional live-site gates:
 *
 *   npx tsx scripts/spike-probe.ts                     # local form task
 *   RUN_HN=1 npx tsx scripts/spike-probe.ts            # + live news.ycombinator.com
 *
 * Uses the scripted mock LLM — evidence of mechanism, not model strength
 * (see docs/PHASE2-notes.md for the real-model caveat).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BrowserService, BrowserError } from "../src/browser/BrowserService.js";
import { startMockLlm } from "../src/browser/mockLlm.js";
import { resolve } from "node:path";

const FORM_HTML = `<!doctype html><html><head><title>Probe</title></head><body>
  <h1>Register</h1>
  <form onsubmit="return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <input id="mail" name="email" placeholder="Email address" />
    <button id="go" type="button">Submit form</button>
  </form>
  <div id="out" role="status"></div>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('out').textContent =
        'Registered ' + document.getElementById('who').value;
    });
  </script>
</body></html>`;

async function main(): Promise<void> {
  const staticServer = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/form")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(FORM_HTML);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;
  console.log(`static page: ${origin}/form`);

  const mockLlm = await startMockLlm(
    [
      { name: "input_text", args: { index: 0, text: "Grace Hopper" } },
      { name: "input_text", args: { index: 1, text: "grace@navy.mil" } },
      { name: "click_element_by_index", args: { index: 2 } },
      { name: "done", args: { text: "Registration complete for Grace Hopper.", success: true } },
    ],
    { authRequired: true, expectedApiKey: "probe-key" },
  );

  const service = new BrowserService({
    poolSize: 1,
    timeoutMs: 60_000,
    maxStepsHardCap: 500,
  });

  const result = await service.runTask({
    url: `${origin}/form`,
    objective: "Register Grace Hopper with email grace@navy.mil, then submit.",
    allowedDomains: ["127.0.0.1"],
    upstreamUrl: mockLlm.url,
    upstreamApiKey: "probe-key",
    llmModel: "mock-model",
    maxSteps: 8,
    confirmBeforeSubmit: false,
    dataDir: resolve("runtime/spike/probe"),
    onStep: (step, i) => {
      if (step.type === "step") {
        console.log(`  step ${i}: ${step.tool}`);
      }
    },
    onLlmRequest: (r) => console.log(`  llm: ${r.status} ${r.durationMs}ms (${r.promptChars} chars)`),
    onGateTripped: (info) => console.log(`  GATE: ${info.summary}`),
  });

  console.log("\n=== result ===");
  console.log(JSON.stringify(
    {
      ok: result.ok,
      agentSuccess: result.agentSuccess,
      steps: result.steps,
      llmRequests: result.llmRequests.length,
      screenshots: result.screenshots.map((s) => s.name),
    },
    null,
    2,
  ));

  if (process.env.RUN_HN) {
    console.log("\n=== live HN (RUN_HN=1) ===");
    const hnMock = await startMockLlm(
      [{ name: "done", args: { text: "extraction channel verified", success: true } }],
      { authRequired: false },
    );
    const hn = await service.runTask({
      url: "https://news.ycombinator.com/",
      objective: "Extract the top 5 story titles from this page as a JSON array.",
      allowedDomains: ["news.ycombinator.com"],
      upstreamUrl: hnMock.url,
      llmModel: "mock-model",
      maxSteps: 6,
      confirmBeforeSubmit: false,
      dataDir: resolve("runtime/spike/live"),
      onStep: () => {},
      onLlmRequest: () => {},
      onGateTripped: () => {},
    });
    console.log(JSON.stringify({ ok: hn.ok, steps: hn.steps, llm: hn.llmRequests.length }, null, 2));
    await hnMock.close();
  }

  await service.close();
  await mockLlm.close();
  staticServer.close();
  process.exit(0);
}

main().catch((err) => {
  const code = err instanceof BrowserError ? err.code : "unexpected";
  console.error(`probe failed (${code}):`, err instanceof Error ? err.message : err);
  process.exit(1);
});
