import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Packs page-agent (npm) + browser-entry.ts into ONE IIFE script string that
 * can be injected into any page via Playwright.
 *
 * Why esbuild: page-agent is ESM-only with bare imports (@page-agent/*, zod,
 * chalk, ai-motion) and the page has no import map. The browser build must be
 * one self-contained IIFE. chalk 6 imports node:os / node:process / node:tty,
 * which don't exist in the browser — tiny shims are injected via esbuild's
 * `alias` (the shims only serve terminal-pretty code paths, so they are
 * behavior-neutral here).
 *
 * The bundle is built once per process and cached; the entry uses a DOM event
 * + config-window-var contract so ONE injection can serve MANY tasks.
 */

/**
 * The entry source lives next to this module under tsx (src/…), but the
 * packaged container ships only dist/ — there the entry is copied to
 * dist/browser/browser-entry.ts at build time (see package.json "build").
 * Resolve whichever layout exists.
 */
function entryPoint(): string {
  const candidates = [join(here, "browser-entry.ts"), join(here, "../../src/browser/browser-entry.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `browser-entry.ts not found (looked in: ${candidates.join(", ")}) — the packaged image must ship the injection entry source`,
  );
}

let cached: string | null = null;

export async function buildInjectionBundle(): Promise<string> {
  if (cached) return cached;

  const result = await build({
    entryPoints: [entryPoint()],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    minify: true,
    alias: {
      "node:os": join(here, "shims-browser.mjs"),
      "node:process": join(here, "shims-browser.mjs"),
      "node:tty": join(here, "shims-browser.mjs"),
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      global: "globalThis",
    },
    // page-agent + deps are trusted; silence third-party warnings.
    logLevel: "silent",
  });

  cached = result.outputFiles[0]!.text;
  return cached;
}

/** Test/CLI hook to drop the cached bundle (e.g., after dependency changes). */
export function clearInjectionBundleCache(): void {
  cached = null;
}
