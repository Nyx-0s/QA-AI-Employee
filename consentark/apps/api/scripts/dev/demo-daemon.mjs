import { execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const CWD = join(HERE, "../../..");
const script = [
  { name: "input_text", args: { index: 1, text: "Arc Widget" } },
  { name: "input_text", args: { index: 3, text: "2" } },
  { name: "input_text", args: { index: 5, text: "grace@navy.mil" } },
  { name: "click_element_by_index", args: { index: 6 } },
  { name: "done", args: { text: "Order placed.", success: true } },
];
const daemon = `
import { startMockLlm } from "/app/apps/api/dist/browser/mockLlm.js";
import { DEMO_PAGES } from "/app/apps/api/dist/cli/demoPages.js";
await startMockLlm(${JSON.stringify(script)}, { authRequired: false, port: 3001 });
await DEMO_PAGES.start(8787);
console.log("READY");
await new Promise(() => {});
`;
execSync("docker compose restart app", { cwd: CWD, stdio: "inherit" });
for (let i = 0; i < 25; i++) {
  try { const h = await fetch("http://localhost:4000/api/health").then(r => r.json()); if (h.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 2000));
}
const p = spawn("docker", ["compose","exec","-T","app","node","--input-type=module","-e",daemon], { cwd: CWD, stdio: ["ignore","pipe","inherit"] });
let out = ""; p.stdout.on("data", d => (out += String(d)));
for (let i = 0; i < 20 && !out.includes("READY"); i++) await new Promise(r => setTimeout(r, 500));
if (!out.includes("READY")) { console.error("daemon failed"); process.exit(1); }
console.log("DAEMON READY");
p.kill("SIGKILL");
process.exit(0);
