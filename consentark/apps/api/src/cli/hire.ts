#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { SupportedTool } from "@consentark/shared";
import {
  DATA_CLERK_TEMPLATE,
  TEMPLATE_ALIASES,
  TOOL_EXPLANATIONS,
  CliError,
  getTemplate,
  normalizeDomainEntry,
  parseAllowlist,
  parseBackend,
  parseMaxSteps,
  parseTools,
  performHire,
  resolveHireInput,
  type HireDeps,
  type HireFlags,
} from "./hireCore.js";
import type { EmployeeCreateInput } from "@consentark/shared";

/**
 * npm run hire — the interactive hiring desk (Phase 4).
 *
 * Walks the operator through: name → tool grants → allowlist (browser) →
 * consent gate → backend → model → maxSteps → (system prompt when custom) →
 * write → summary card. Non-interactive mode (--name …) is fully scriptable
 * and is what the tests drive.
 *
 * After writing, it prints the employee id and the hiring token ONCE — the
 * server keeps only the token's sha256 (see docs/PHASE4-notes.md).
 *
 * runHireCli(argv, io?, deps?) is the testable entry: io and deps can be
 * injected (in-memory prompts, temp-dir repositories) or defaulted to the
 * real terminal + database.
 */

export interface HireCliOptions {
  argv: string[];
  io: HireIo;
  /** Pre-resolved repositories; defaults load config + open the DB. */
  deps?: HireDeps;
}

export interface HireIo {
  question(prompt: string): Promise<string>;
  print(text: string): void;
}

interface ParsedArgs {
  flags: HireFlags;
  template?: string;
  demo: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: HireFlags = {};
  let template: string | undefined;
  let demo = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new CliError(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--name":
        flags.name = next();
        break;
      case "--tools":
        flags.tools = next();
        break;
      case "--allowlist":
        flags.allowlist = next();
        break;
      case "--confirm":
        flags.confirm = true;
        break;
      case "--no-confirm":
        flags.confirm = false;
        break;
      case "--backend":
        flags.backend = next();
        break;
      case "--model":
        flags.model = next();
        break;
      case "--max-steps":
        flags.maxSteps = next();
        break;
      case "--schedule-cron":
        flags.scheduleCron = next();
        break;
      case "--schedule-task":
        flags.scheduleTask = next();
        break;
      case "--system-prompt":
        flags.systemPrompt = next();
        break;
      case "--template":
        template = next();
        break;
      case "--demo":
        demo = true;
        break;
      default:
        throw new CliError(`unknown option \"${arg}\" (see npm run hire -- --help)`);
    }
  }
  return { flags, template, demo, help };
}

const HELP_TEXT = `npm run hire — hire a ConsentArk AI employee

Usage:
  npm run hire                          interactive walkthrough
  npm run hire -- --template data-clerk [--allowlist "..."]   flagship persona
  npm run hire -- --template qa-analyst --allowlist "prospect.com"  QA persona
  npm run hire -- --name "Night Clerk" --tools chat_task,browser_task \\
      --allowlist "crm.example.com" --no-confirm --backend local \\
      --system-prompt "You are a meticulous clerk."

Options:
  --name <name>            employee name (non-interactive when given)
  --tools <list>           comma-separated: chat_task,browser_task
  --allowlist <list>       comma-separated hostnames the browser may visit
  --confirm | --no-confirm require human approval before each form submit
  --backend <cloud|local>  FreeLLMAPI (cloud) or Colibrì (local)
  --model <model>          model id ("auto" lets the cloud router pick)
  --max-steps <n>          automation step cap per task (1–200)
  --system-prompt <text>   the employee's standing instructions
  --schedule-cron <expr>   recurring runs on a 5-field cron, e.g. "0 8 * * 1-5"
  --schedule-task <text>   objective for each scheduled run (needs --schedule-cron)
  --template <alias>       pre-fill a catalog persona: ${TEMPLATE_ALIASES}
  --demo                   also enqueue 1–2 example tasks against local demo pages
  --help                   this text
`;

/** The interactive walkthrough. Returns flags the core can resolve. */
async function interactiveHire(io: HireIo, flags: HireFlags): Promise<HireFlags> {
  io.print("Hiring a new ConsentArk employee. Ctrl-C aborts.\n");

  // 1 — name (skip when --name was given: partial non-interactive is allowed)
  let name = flags.name;
  if (name === undefined) {
    name = (await io.question("1. Name: ")).trim();
    if (name.length === 0) throw new CliError("name is required");
  }

  // 2 — tool grants
  let tools: string[] | undefined =
    flags.tools !== undefined ? (parseTools(flags.tools) as unknown as string[]) : undefined;
  if (tools === undefined) {
    io.print("\n2. Tool grants (comma-separated).");
    for (const tool of Object.keys(TOOL_EXPLANATIONS) as SupportedTool[]) {
      io.print(`   - ${tool}: ${TOOL_EXPLANATIONS[tool]}`);
    }
    const raw = (await io.question("   Grant which tools? [chat_task,browser_task]: ")).trim();
    tools = parseTools(raw.length === 0 ? "chat_task,browser_task" : raw) as unknown as string[];
  }

  // 3 — allowlist (only meaningful with the browser tool)
  let allowlist: string[] | undefined =
    flags.allowlist !== undefined ? parseAllowlist(flags.allowlist as string) : undefined;
  if (allowlist === undefined && tools.includes("browser_task")) {
    io.print("\n3. URL allowlist — the ONLY hosts this employee's browser may touch.");
    io.print("   Entries are hostnames (example.com, app.example.com); suffix matching applies.");
    const entries: string[] = [];
    for (;;) {
      const raw = await io.question(
        entries.length === 0
          ? "   First domain (blank to finish with an EMPTY allowlist = no browsing): "
          : "   Next domain (blank to finish): ",
      );
      const trimmed = raw.trim();
      if (trimmed.length === 0) break;
      entries.push(normalizeDomainEntry(trimmed));
    }
    allowlist = entries;
  }

  // 4 — consent gate
  let confirm = flags.confirm;
  if (confirm === undefined) {
    io.print(
      "\n4. Consent gate — when ON, the employee pauses for human approval before any form submit.",
    );
    const raw = (await io.question("   Require approval before submits? [Y/n]: ")).trim().toLowerCase();
    confirm = raw === "" || raw === "y" || raw === "yes";
  }

  // 5 — backend
  let backend = flags.backend !== undefined ? parseBackend(flags.backend as string) : undefined;
  if (backend === undefined) {
    io.print("\n5. LLM backend.");
    io.print("   - cloud: FreeLLMAPI — free providers behind one OpenAI-compatible API.");
    io.print("   - local: Colibrì (coli serve) — on this machine, privacy-first.");
    for (;;) {
      const raw = (await io.question("   Backend? [cloud/local]: ")).trim().toLowerCase();
      if (raw === "cloud" || raw === "local") {
        backend = raw;
        break;
      }
      io.print("   Please answer cloud or local.");
    }
  }

  // 6 — model
  let model = flags.model;
  if (model === undefined) {
    model = (await io.question(`6. Model [${backend === "local" ? "OLMoE-7B" : "auto"}]: `)).trim();
    if (model.length === 0) model = backend === "local" ? "OLMoE-7B" : "auto";
  }

  // 7 — max steps
  let maxSteps = flags.maxSteps;
  if (maxSteps === undefined) {
    const raw = (await io.question("7. Max steps per task [25]: ")).trim();
    if (raw.length === 0) {
      maxSteps = "25";
    } else {
      parseMaxSteps(raw); // validate up front for a friendly message
      maxSteps = raw;
    }
  }

  // 8 — system prompt (custom path only; the Data Clerk template ships one)
  let systemPrompt = flags.systemPrompt;
  if (systemPrompt === undefined && name !== DATA_CLERK_TEMPLATE.name) {
    io.print("\n8. System prompt — the employee's standing instructions (one line; it matters).");
    systemPrompt = (await io.question("   Instructions: ")).trim();
    if (systemPrompt.length === 0) throw new CliError("systemPrompt is required");
  }

  io.print(""); // spacing before the summary
  return {
    name,
    tools: tools === undefined ? undefined : tools.join(","),
    allowlist: allowlist === undefined ? undefined : allowlist.join(","),
    confirm: confirm ?? true,
    backend: backend ?? "cloud",
    model,
    maxSteps,
    systemPrompt,
  };
}

/**
 * The pre-write summary card (spec: "show a summary card at the end and
 * require explicit confirm before writing"). Pure display — no prompts.
 */
function printSummaryCard(io: HireIo, input: EmployeeCreateInput): void {
  io.print("\n── About to create ──────────────────────────");
  io.print(`  name:        ${input.name}`);
  io.print(`  role:        ${input.role}`);
  io.print(`  tools:       ${input.toolsEnabled.join(", ") || "(none)"}`);
  io.print(`  allowlist:   ${input.allowedDomains.join(", ") || "(empty — no browsing)"}`);
  io.print(`  consent:     ${input.confirmBeforeSubmit ? "human approval before each submit" : "auto-submit (audit-logged)"}`);
  io.print(`  backend:     ${input.backend} (model: ${input.model})`);
  io.print(`  max steps:   ${input.maxStepsPerTask}`);
  io.print(
    `  schedule:    ${
      input.schedule
        ? `${input.schedule.cron} → ${input.schedule.taskTemplate.slice(0, 60)}`
        : "(manual runs only)"
    }`,
  );
  io.print("─────────────────────────────────────────────");
}

/**
 * --demo: enqueue the two example tasks against the local demo pages.
 *
 * Deliberately goes through the employee-token API (fetch), exactly as the
 * work runner would — this doubles as a live check that the freshly issued
 * token and the scoped routes actually work end-to-end.
 */
async function enqueueDemoTasks(io: HireIo, result: { employeeId: string; token: string }): Promise<void> {
  const { DEMO_PAGES } = await import("./demoPages.js");
  const api = process.env.CONSENTARK_API_URL ?? `http://localhost:${process.env.PORT ?? "4000"}`;
  const headers = { authorization: `Bearer ${result.token}`, "content-type": "application/json" };

  // Spin up the demo pages for the allowlist note; the tasks target their URLs.
  io.print("\n📦 Demo tasks (enqueue via the employee API — proof the token works):");
  io.print(`   demo pages: ${DEMO_PAGES.describe()}`);

  const tasks = [
    {
      name: "extraction",
      payload: {
        employeeId: result.employeeId,
        type: "browser_task",
        objective:
          "Read the price list and extract every product name with its price into JSON: {\"items\":[{\"name\":string,\"price\":number}]}",
        url: DEMO_PAGES.listUrl("127.0.0.1"),
        outputSchema: {
          type: "object",
          required: ["items"],
          properties: { items: { type: "array", minItems: 2 } },
        },
      },
    },
    {
      name: "form entry (gated)",
      payload: {
        employeeId: result.employeeId,
        type: "browser_task",
        objective:
          "Fill the order form with: item 'Blue Widget', quantity 3, email clerk@example.com — then stop; the consent gate will ask a human before submitting.",
        url: DEMO_PAGES.formUrl("127.0.0.1"),
      },
    },
  ];

  for (const task of tasks) {
    try {
      const response = await fetch(`${api}/api/employee/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify(task.payload),
      });
      if (response.status === 202) {
        const body = (await response.json()) as { id: string };
        io.print(`   ✔ ${task.name}: ${body.id}`);
      } else {
        const detail = await response.text();
        io.print(`   ✖ ${task.name}: API ${response.status} — ${detail.slice(0, 140)}`);
        io.print("      (is the API running? npm run dev)");
      }
    } catch {
      io.print(`   ✖ ${task.name}: cannot reach the API at ${api}`);
      io.print("      start it with `npm run dev`, then run `npm run work -- --token <token>` to execute.");
    }
  }
  io.print("   run `npm run work -- --token <token>` to execute; approve in the dashboard.");
}

/**
 * Load the real repositories. The CLI is a DB writer, not a server: it
 * needs only DATA_DIR (same default as the server config), NOT the full
 * server env — an exported-but-unused PORT in the operator's shell must not
 * block hiring. dotenv is loaded for parity with index.ts.
 */
async function defaultDeps(): Promise<HireDeps> {
  await import("dotenv/config");
  const { openDatabase } = await import("../db/sqlite.js");
  const { EmployeeRepository } = await import("../db/repositories/employees.js");
  const { TokenRepository } = await import("../db/repositories/tokens.js");
  const dataDir = process.env.DATA_DIR?.trim() || "./data";
  const db = openDatabase(dataDir);
  return { employees: new EmployeeRepository(db), tokens: new TokenRepository(db) };
}

function printSummary(io: HireIo, result: ReturnType<typeof performHire>): void {
  io.print("\n✅ Employee hired\n");
  io.print(`  id:          ${result.employeeId}`);
  io.print(`  name:        ${result.employee.name}`);
  io.print(`  tools:       ${result.employee.toolsEnabled.join(", ") || "(none)"}`);
  io.print(`  allowlist:   ${result.employee.allowedDomains.join(", ") || "(empty — no browsing)"}`);
  io.print(`  consent:     ${result.employee.confirmBeforeSubmit ? "human approval required before each submit" : "auto-submit (audit-logged)"}`);
  io.print(`  backend:     ${result.employee.backend} (model: ${result.employee.model})`);
  io.print(`  max steps:   ${result.employee.maxStepsPerTask}`);
  io.print(
    `  schedule:    ${
      result.employee.schedule
        ? `${result.employee.schedule.cron} → ${result.employee.schedule.taskTemplate.slice(0, 60)}`
        : "(manual runs only)"
    }`,
  );
  io.print("");
  io.print("  🔑 Hiring token (shown ONCE — the server stores only its sha256):");
  io.print(`     ${result.token}`);
  io.print("");
  io.print("Next steps:");
  io.print("  npm run work -- --token <the token above>");
  io.print("  (or export CONSENTARK_EMPLOYEE_TOKEN=<token> and run: npm run work)");
}

/** Testable CLI entry: returns the process exit code. */
export async function runHireCli(options: HireCliOptions): Promise<number> {
  const { io } = options;
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(options.argv);
  } catch (error) {
    io.print(`error: ${error instanceof CliError ? error.message : String(error)}`);
    return 1;
  }

  if (parsed.help) {
    io.print(HELP_TEXT);
    return 0;
  }

  if (parsed.template !== undefined && getTemplate(parsed.template) === null) {
    io.print(`error: unknown template \"${parsed.template}\" — available: ${TEMPLATE_ALIASES}`);
    return 1;
  }

  try {
    const deps = options.deps ?? (await defaultDeps());

    let flags: HireFlags = parsed.flags;
    if (parsed.template !== undefined) {
      const template = getTemplate(parsed.template)!;
      io.print(
        `Template: ${parsed.template} (${template.name} — consent gate ${
          template.confirmBeforeSubmit ? "ON" : "OFF"
        } by default)\n`,
      );
      flags = {
        ...parsed.flags,
        templateAlias: parsed.template, // resolveHireInput bases the profile on the template
        // Defaults below; explicit flags win over the template.
        name: parsed.flags.name ?? template.name,
        systemPrompt: parsed.flags.systemPrompt ?? template.systemPrompt,
        tools: parsed.flags.tools ?? template.toolsEnabled.join(","),
        confirm: parsed.flags.confirm ?? template.confirmBeforeSubmit,
        backend: parsed.flags.backend ?? template.backend,
        model: parsed.flags.model ?? template.model,
        maxSteps: parsed.flags.maxSteps ?? String(template.maxStepsPerTask),
      };
      // The template ships no allowlist — ask unless the operator passed one.
      if (flags.allowlist === undefined) {
        io.print("Allowlist for browsing (comma-separated hostnames, blank = none):");
        const raw = await io.question("> ");
        flags = { ...flags, allowlist: raw };
      }
    }

    const interactive =
      flags.name === undefined ||
      flags.tools === undefined ||
      flags.backend === undefined ||
      flags.systemPrompt === undefined;

    if (interactive) {
      flags = await interactiveHire(io, flags);
    }

    // Explicit confirm before any write. Non-interactive mode skips this:
    // passing complete flags IS the explicit intent (scriptable/testable).
    if (interactive) {
      printSummaryCard(io, resolveHireInput(flags));
      const answer = (await io.question("Create this employee? [y/N]: ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        io.print("Aborted — nothing was written.");
        return 1;
      }
    }

    const result = performHire(deps, flags);
    printSummary(io, result);

    if (parsed.demo) {
      await enqueueDemoTasks(io, result);
    }
    return 0;
  } catch (error) {
    io.print(`error: ${error instanceof CliError ? error.message : String(error)}`);
    return 1;
  }
}

// Executed directly — under tsx (src/cli/hire.ts) or compiled
// (dist/cli/hire.js in the container). Not when imported by tests.
const invoked = process.argv[1]?.replace(/\.(js|ts)$/, "");
if (invoked?.endsWith("/cli/hire")) {
  void runHireCli({
    argv: process.argv.slice(2),
    io: {
      question: async (prompt) => {
        const rl = createInterface({ input: stdin, output: stdout });
        try {
          return await rl.question(prompt);
        } finally {
          rl.close();
        }
      },
      print: (text) => console.log(text),
    },
  }).then((code) => process.exit(code));
}
