/**
 * Browser-side shims for Node builtins that page-agent's dependencies import
 * (chalk 6 pulls node:os / node:process / node:tty). Only used by code paths
 * that pretty-print terminal output; behavior-neutral in the browser.
 */

// ---- node:os ----
export const EOL = "\n";
export const arch = () => "browser";
export const platform = () => "browser";
export const cpus = () => [];
export const totalmem = () => 0;
export const freemem = () => 0;
export const hostname = () => "browser";
export const type = () => "browser";
export const release = () => "";
export const uptime = () => 0;
export const userInfo = () => ({ username: "browser" });
export const homedir = () => "/";
export const tmpdir = () => "/tmp";

// ---- node:process (default export = the process shim) ----
export const env = {};
export const argv = [];
export const pid = 0;
export const version = "v0.0.0";
export const exit = () => {
  throw new Error("process.exit called in browser shim");
};
export const cwd = () => "/";
export const nextTick = (fn) => queueMicrotask(fn);

const processShim = { env, argv, pid, version, platform, exit, cwd, nextTick };
export default processShim;

// ---- node:tty ----
export const isatty = () => false;
export const WriteStream = class {};
export const ReadStream = class {};
