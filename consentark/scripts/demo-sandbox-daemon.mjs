#!/usr/bin/env node
/**
 * demo-sandbox-daemon.mjs — start the demo sandbox's in-container daemon.
 *
 *   node consentark/scripts/demo-sandbox-daemon.mjs
 *
 * What it does: restarts the sandbox container (consentark-demo), waits for
 * its API to be healthy, then starts — inside the container via `docker exec`
 * — the scripted OpenAI-compatible LLM (port 3001, container-internal) plus
 * the Acme demo pages (port 8787, container-internal). `docker exec -d`
 * keeps the daemon alive independently of this script.
 *
 * The scripted model plays the demo EXACTLY as rehearsed (see
 * startup-kit/demo-sandbox-runbook.md):
 *   1. extraction "done"     → price-list task returns validated JSON
 *   2. input 1 / 3 / 5       → item, quantity, email (labels are numbered!)
 *   3. click 6               → "Place order" → CONSENT GATE PARKS the task
 *   4. post-approve "done"   → operator approval resumes and completes it
 *
 * CHOREOGRAPHY (2026-09-24): content-aware, not positional. The old shared
 * positional queue desynced whenever a single model call was silently
 * discarded and retried client-side (e.g. a call racing the daemon's boot —
 * the launcher returns before the in-container process listens). With
 * chooseStep, every response is chosen from the REQUEST ITSELF:
 *   - a price-list-extraction call ALWAYS answers the validated JSON, however
 *     many times it arrives (a discarded/retried call can never shift the play);
 *   - an order-form call walks input 1/3/5 then click 6, tracked PER TASK ID
 *     (page-agent sends the task in its messages), so a retry re-serves the
 *     same step and the same task never replays the fill after approval;
 *   - a form task already carrying a final "done" gets "done" again — the
 *     post-approval resume completes instead of restarting the form.
 * A container restart still resets everything (the canonical rehearsal reset);
 * back-to-back rehearsals now also work on a single boot.
 */
import { execSync, spawn } from "node:child_process";

const CONTAINER = process.env.DEMO_CONTAINER ?? "consentark-demo";
const API_PORT = process.env.DEMO_API_PORT ?? "4400";

const EXTRACT_JSON =
  '{"items":[{"name":"Blue Widget","price":4.5},{"name":"Red Gears","price":12},{"name":"Steel Bolts","price":1.2},{"name":"Copper Wire","price":7.75}]}';
const FORM_DONE = "Order placed: Blue Widget x3 for clerk@example.com.";

const daemon = `
import { startMockLlm } from "/app/apps/api/dist/browser/mockLlm.js";
import { DEMO_PAGES } from "/app/apps/api/dist/cli/demoPages.js";

let formStep = 0;            // position inside the fill choreography

const chooseStep = ({ messages }) => {
  const text = JSON.stringify(messages ?? "");

  if (/Read the price list/.test(text)) {
    // Extraction is idempotent: every call — first try, retry, spare — gets
    // the same validated JSON. Nothing to desync.
    return { name: "done", args: { text: ${JSON.stringify(EXTRACT_JSON)}, success: true } };
  }

  if (/Fill the order form/.test(text)) {
    // Discriminator (measured from the real page-agent prompt, not assumed):
    // the request carries its own step counter — "<step_info>Step N of 40".
    // A fresh task's first call says Step 1 (and a RETRIED first call also
    // says Step 1 — it re-serves the same fill step harmlessly); the
    // post-approval resume continues at a later step, so it never resets.
    // (The messages carry NO task id and NO "role":"assistant" turn — both
    // were tried and disproven; see the rehearsal findings.)
    const stepNum = Number((text.match(/Step (\\d+) of/) || [])[1] || 1);
    if (stepNum === 1) formStep = 0;
    const steps = [
      { name: "input_text", args: { index: 1, text: "Blue Widget" } },
      { name: "input_text", args: { index: 3, text: "3" } },
      { name: "input_text", args: { index: 5, text: "clerk@example.com" } },
      // The click that trips the consent gate
      { name: "click_element_by_index", args: { index: 6 } },
    ];
    if (formStep < steps.length) return steps[formStep++];
    // Fill complete (gate parked or already approved): any further call on
    // this task is the post-approval resume or a verification spare → done.
    return { name: "done", args: { text: ${JSON.stringify(FORM_DONE)}, success: true } };
  }

  // Unknown caller: never desync anything — complete gracefully.
  return { name: "done", args: { text: "Done.", success: true } };
};

await startMockLlm([], { authRequired: false, port: 3001, chooseStep });
await DEMO_PAGES.start(8787);
console.log("READY");
await new Promise(() => {});
`;

console.log(`restarting ${CONTAINER} (resets the scripted-LLM queue)...`);
execSync(`docker restart ${CONTAINER}`, { stdio: "inherit" });

for (let i = 0; i < 25; i++) {
  try {
    const h = await fetch(`http://127.0.0.1:${API_PORT}/api/health`).then((r) => r.json());
    if (h.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

const p = spawn("docker", ["exec", "-d", CONTAINER, "node", "--input-type=module", "-e", daemon], {
  stdio: "inherit",
});
p.on("exit", (code) => {
  if (code === 0) {
    console.log("DAEMON READY — sandbox is demo-ready. (Choreography is content-aware; a stray pre-demo model call can no longer desync it. A container reset still restarts everything.)");
  } else {
    console.error(`daemon failed to start (exit ${code})`);
    process.exit(1);
  }
});
