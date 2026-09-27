/**
 * CLI branch-order guard test — pins the fix for the 2026-09-20 batch-3 trap.
 *
 * The dispatch is a first-match chain. Before the guard, `--send-batch --plan X`
 * matched --plan first: it WROTE a plan file and exited 0 while the operator
 * believed a send had fired. This test pins, at the subprocess level:
 *
 *   1. --send-batch --plan X        → exit 2, "mutually exclusive", NO plan file written
 *   2. --test --send-batch          → exit 2, "mutually exclusive"
 *   3. --send-batch --batch 99 (armed) → exit 2 "no plan file" (proves the SEND
 *      branch is the branch reached — never the plan builder, never usage)
 *   4. --plan --batch 99 --limit 0  → exit 0, "plan written" (plan path unshadowed
 *      when used alone; file cleaned up after)
 *   5. --send-nudges --plan X       → exit 2, "mutually exclusive" (nudge mode
 *      joined the exclusive set, 2026-09-20)
 *   6. --send-nudges unarmed        → exit 2, names CA_SEND_ARMED
 *   7. --send-nudges armed, zero GO-gated files (temp CA_NUDGES_DIR) → exit 2,
 *      "0 nudges gated GO" (proves the NUDGE branch is reached and that the
 *      per-file NUDGE-GATE gate is enforced independently of CA_SEND_ARMED)
 *   8. --send-nudges armed, GO nudge whose parent draft is missing (temp dir)
 *      → exit 2, "parent draft missing" (drift guard: never nudge a row that
 *      may never have been sent)
 *
 * Run: node sales/test-send-transport-cli.mjs   (exit 0 = all pass)
 * Wired into the daily battery as pipeline-tick check 9.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const TMP_PLAN = join(ROOT, "sales", "batch99-guard-test-PLAN.json");
const REAL_B99_PLAN = join(ROOT, "sales", "batch99-send-plan.json");
let failures = 0;
const results = [];

function run(args, env) {
  return spawnSync("node", ["sales/send-transport.mjs", ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: env,
    timeout: 30000,
  });
}
const output = (r) => `${r.stdout || ""}\n${r.stderr || ""}`;
function check(n, cond, detail) {
  results.push(`${cond ? "PASS" : "FAIL"}  ${n}${cond ? "" : ` — ${detail}`}`);
  if (!cond) failures++;
}

// ── 1. the exact trap: --send-batch --plan X must refuse, not build ──────
rmSync(TMP_PLAN, { force: true });
const noArm = { ...process.env };
delete noArm.CA_SEND_ARMED; // guard must fire before any env-dependent branch
const r1 = run(["--send-batch", "--plan", TMP_PLAN], noArm);
check("1 --send-batch --plan refuses (exit 2)", r1.status === 2, `exit=${r1.status}`);
check("1 names the conflict", /mutually exclusive/i.test(output(r1)), output(r1).slice(0, 200));
check("1 writes NO plan file", !existsSync(TMP_PLAN), "plan file exists after refusal");
check("1 no 'plan written' on stdout", !/plan written/.test(r1.stdout || ""), "plan-builder ran");

// ── 2. the sibling shadow: --test --send-batch ───────────────────────────
const r2 = run(["--test", "--send-batch"], noArm);
check("2 --test --send-batch refuses (exit 2)", r2.status === 2, `exit=${r2.status}`);
check("2 names the conflict", /mutually exclusive/i.test(output(r2)), output(r2).slice(0, 200));

// ── 3. send branch is REACHED (armed, batch 99 has no plan file) ─────────
const armed = { ...process.env, CA_SEND_ARMED: "1" };
const r3 = run(["--send-batch", "--batch", "99"], armed);
const o3 = output(r3);
check("3 --send-batch alone exits 2 (refusal, not silence)", r3.status === 2, `exit=${r3.status}`);
check("3 reached the SEND branch (no-plan / no-creds refusal)", /no plan file|missing env vars/i.test(o3), o3.slice(0, 200));
check("3 did NOT run the plan builder", !/plan written/.test(o3), "plan builder ran");
check("3 did NOT fall through to usage", !/^usage:/m.test(o3), "usage branch ran");

// ── 4. --plan alone still works (non-shadowed happy path) ────────────────
rmSync(REAL_B99_PLAN, { force: true });
const r4 = run(["--plan", "--batch", "99", "--limit", "0"], noArm);
check("4 --plan alone exits 0", r4.status === 0, `exit=${r4.status} ${output(r4).slice(0, 200)}`);
check("4 writes the plan file", existsSync(REAL_B99_PLAN), "no plan file after --plan run");  rmSync(REAL_B99_PLAN, { force: true }); // cleanup — do not pollute the workspace
  rmSync(TMP_PLAN, { force: true });

// ── 5. --send-nudges joined the mutually-exclusive set ─────────────────
const r5 = run(["--send-nudges", "--plan", TMP_PLAN], noArm);
check("5 --send-nudges --plan refuses (exit 2)", r5.status === 2, `exit=${r5.status}`);
check("5 names the conflict", /mutually exclusive/i.test(output(r5)), output(r5).slice(0, 200));
check("5 writes NO plan file", !existsSync(TMP_PLAN), "plan file exists after refusal");

// ── 6. unarmed --send-nudges refuses — same two-step interlock as batches ──
const r6 = run(["--send-nudges"], noArm);
check("6 unarmed --send-nudges refuses (exit 2)", r6.status === 2, `exit=${r6.status}`);
check("6 names the interlock", /CA_SEND_ARMED/i.test(output(r6)), output(r6).slice(0, 200));

// ── 7/8. nudge branch reached, in a THROWAWAY nudges dir (CA_NUDGES_DIR).
// The subprocess can never touch the real outreach/nudges here: dir override
// is a test-only surface, and case 8's GO nudge is refused at pre-flight
// (missing parent) BEFORE any SMTP touch.
const nudgeTmp = mkdtempSync(join(tmpdir(), "nudge-guard-test-"));
const holdNudge = join(nudgeTmp, "hold-nudge.md");
writeFileSync(holdNudge, "# NUDGE follow-up — Test Co (batch T)\n\n**Recipient:** x@example.com\n**Hold-state:** test fixture\n\n---\n\n**Subject:** fixture\n\nBody.\n\n---\nNUDGE-GATE: HOLD\nPARENT DRAFT: outreach/drafts/nonexistent.md\n");
const nudEnv = { ...process.env, CA_NUDGES_DIR: nudgeTmp };
const r7b = spawnSync("node", ["sales/send-transport.mjs", "--send-nudges"], {
  encoding: "utf8", cwd: ROOT, timeout: 30000,
  env: (() => { const e = { ...nudEnv }; delete e.CA_SEND_ARMED; return e; })(),
});
check("7 unarmed --send-nudges (temp dir) refuses (exit 2)", r7b.status === 2, `exit=${r7b.status}`);
const r7c = run(["--send-nudges"], (() => { const e = { ...nudEnv, CA_SEND_ARMED: "1" }; return e; })());
check("7 armed, zero GO-gated → refuses (exit 2)", r7c.status === 2, `exit=${r7c.status}`);
check("7 names '0 nudges gated GO'", /0 nudges gated GO/i.test(output(r7c)), output(r7c).slice(0, 200));
check("7 lists the HOLD fixture", /hold-nudge\.md/.test(output(r7c)), output(r7c).slice(0, 300));
check("7 sends NOTHING", !/NUDGE SENT/.test(output(r7c)), "a send left the nudge branch");

// case 8: NOW add the GO fixture — with it present, the branch pre-flights and
// refuses on the missing parent draft BEFORE any SMTP touch.
const goNudge = join(nudgeTmp, "go-nudge.md");
writeFileSync(goNudge, "# NUDGE follow-up — Drift Co (batch T)\n\n**Recipient:** x@example.com\n**Hold-state:** test fixture\n\n---\n\n**Subject:** fixture\n\nBody.\n\n---\nNUDGE-GATE: GO 2026-09-25\nPARENT DRAFT: outreach/drafts/nonexistent-parent.md\n");
const r8b = run(["--send-nudges"], { ...nudEnv, CA_SEND_ARMED: "1" });
check("8 GO nudge with missing parent refuses (exit 2)", r8b.status === 2, `exit=${r8b.status}`);
check("8 names the drift reason", /parent draft missing/i.test(output(r8b)), output(r8b).slice(0, 300));
check("8 sends NOTHING", !/NUDGE SENT/.test(output(r8b)), "a send left the nudge branch");
rmSync(nudgeTmp, { recursive: true, force: true });

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} CLI guard checks pass`);
process.exit(failures === 0 ? 0 : 1);
