#!/usr/bin/env node
import { CliError } from "./hireCore.js";

/**
 * npm run work — the employee's side of the desk (Phase 4).
 *
 * A THIN polling client: it authenticates with the hiring token, then loops
 * over the employee-scoped API (`/api/employee/*`) printing human-readable
 * status as the server's queue machinery claims and executes tasks. It
 * executes nothing itself — all execution logic lives server-side (Phase 1/2
 * runner). That keeps this file auditable at a glance: HTTP + printing only.
 *
 * Token sources, in order: --token flag → CONSENTARK_EMPLOYEE_TOKEN env →
 * a token file via --token-file. Ctrl-C exits cleanly; the SERVER owns
 * task durability (see the stale-task decision in docs/PHASE4-notes.md):
 * a killed run leaves tasks queued/running and the server's startup
 * recovery re-queues them — nothing is half-claimed by this process.
 */

export interface WorkCliOptions {
  argv: string[];
  io: WorkIo;
  /** Overrides for tests. */
  fetchImpl?: typeof fetch;
  /** Loop interval override (ms). */
  intervalMs?: number;
  /** Stop after this many polls (tests only; undefined = run until Ctrl-C). */
  maxPolls?: number;
}

export interface WorkIo {
  print(text: string): void;
}

const DEFAULT_INTERVAL_MS = 3000;

interface ParsedWorkArgs {
  token?: string;
  tokenFile?: string;
  apiUrl?: string;
  once: boolean;
  help: boolean;
}

function parseWorkArgs(argv: string[]): ParsedWorkArgs {
  const parsed: ParsedWorkArgs = { once: false, help: false };
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
        parsed.help = true;
        break;
      case "--token":
        parsed.token = next();
        break;
      case "--token-file":
        parsed.tokenFile = next();
        break;
      case "--api-url":
        parsed.apiUrl = next();
        break;
      case "--once":
        parsed.once = true;
        break;
      default:
        throw new CliError(`unknown option \"${arg}\" (see npm run work -- --help)`);
    }
  }
  return parsed;
}

const WORK_HELP = `npm run work — run a hired ConsentArk employee

Usage:
  npm run work -- --token <hiring-token>
  CONSENTARK_EMPLOYEE_TOKEN=<token> npm run work
  npm run work -- --token-file ./clerk.token --api-url http://localhost:4000

Options:
  --token <token>      the hiring token printed by npm run hire
  --token-file <path>  read the token from a file (first line)
  --api-url <url>      the API base (default http://localhost:4000)
  --once               single poll then exit (used by tests and cron)
  --help               this text
`;

/** Resolve the token: flag → env → file. */
export function resolveToken(args: ParsedWorkArgs): string {
  if (args.token !== undefined && args.token.length > 0) return args.token;
  const envToken = process.env.CONSENTARK_EMPLOYEE_TOKEN;
  if (envToken !== undefined && envToken.length > 0) return envToken;
  if (args.tokenFile !== undefined) {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const firstLine = readFileSync(args.tokenFile, "utf8").split("\n")[0]?.trim() ?? "";
    if (firstLine.length > 0) return firstLine;
  }
  throw new CliError(
    "no employee token — pass --token/--token-file or set CONSENTARK_EMPLOYEE_TOKEN",
  );
}

/** Human-readable one-liner for a task. */
function describeTask(task: { id: string; type: string; status: string; objective: string }): string {
  const short = task.objective.length > 60 ? `${task.objective.slice(0, 60)}…` : task.objective;
  return `${task.id} [${task.type}] ${task.status} — ${short}`;
}

/** One poll cycle. Returns the tasks seen. */
export async function pollOnce(
  options: { api: string; token: string; fetchImpl: typeof fetch; io: WorkIo },
): Promise<Array<{ id: string; type: string; status: string; objective: string }>> {
  const response = await options.fetchImpl(`${options.api}/api/employee/tasks`, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (response.status === 401) {
    throw new CliError("token rejected by the API (401) — is it valid? was it revoked?");
  }
  if (!response.ok) {
    throw new CliError(`API error ${response.status} listing tasks`);
  }
  const tasks = (await response.json()) as Array<{
    id: string;
    type: string;
    status: string;
    objective: string;
  }>;
  const active = tasks.filter((t) => t.status === "queued" || t.status === "running" || t.status === "awaiting_approval");
  if (active.length === 0) {
    options.io.print("no active tasks — idle");
  } else {
    for (const task of active) options.io.print(describeTask(task));
  }
  return tasks;
}

/** Testable CLI entry: returns the process exit code. */
export async function runWorkCli(options: WorkCliOptions): Promise<number> {
  const { io } = options;
  let args: ParsedWorkArgs;
  try {
    args = parseWorkArgs(options.argv);
  } catch (error) {
    io.print(`error: ${error instanceof CliError ? error.message : String(error)}`);
    return 1;
  }
  if (args.help) {
    io.print(WORK_HELP);
    return 0;
  }

  const api = args.apiUrl ?? process.env.CONSENTARK_API_URL ?? "http://localhost:4000";
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  try {
    const token = resolveToken(args);
    io.print(`Employee online — polling ${api} every ${Math.round(intervalMs / 1000)}s. Ctrl-C to stop.`);

    let polls = 0;
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      io.print("\nStopping cleanly — the server keeps task state; nothing is half-claimed.");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    for (;;) {
      await pollOnce({ api, token, fetchImpl, io });
      polls++;
      if (args.once || (options.maxPolls !== undefined && polls >= options.maxPolls) || stopping) {
        return 0;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } catch (error) {
    io.print(`error: ${error instanceof CliError ? error.message : String(error)}`);
    return 1;
  }
}

// Executed directly — under tsx (src/cli/work.ts) or compiled
// (dist/cli/work.js in the container). Not when imported by tests.
const invoked = process.argv[1]?.replace(/\.(js|ts)$/, "");
if (invoked?.endsWith("/cli/work")) {
  void runWorkCli({
    argv: process.argv.slice(2),
    io: { print: (text) => console.log(text) },
  }).then((code) => process.exit(code));
}
