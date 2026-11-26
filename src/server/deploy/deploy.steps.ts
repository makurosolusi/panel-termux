// Job steps shared by site.deploy and site.rollback: binary swap, apps.json runtime, pm2 restart, health wait.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { SiteRuntime } from "../../shared/site.types";
import type { site } from "../db/schema";
import { termuxPrefix } from "../exec/termux.exec";
import { parseApps } from "../sites/apps.file";
import type { StepDef } from "../sites/job.runner";
import { type SiteCtx, sitePaths } from "../sites/site.checks";
import { readTextOrNull, restoreText, writeAtomic } from "../sites/site.files";
import { detectRuntime } from "./elf.runtime";
import { chunkPath, type Upload } from "./upload.store";

type SiteRow = typeof site.$inferSelect;

/** Mutable state of one deploy/rollback job, shared by its steps and the final status hooks. */
export type DeployState = {
  runtime: SiteRuntime;
  swapped: boolean;
  appsChanged: boolean;
  restarted: boolean;
  undoFailed: boolean;
};

const POLL_MS = 500;
const BIN_MODE = 0o755;
const HTTP_SERVER_ERROR = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Binary paths of a site: live `app`, the one previous `app.prev`, the staged `app.new`. */
export const binPaths = (s: SiteRow) => ({
  app: join(s.dir, "app"),
  prev: join(s.dir, "app.prev"),
  next: join(s.dir, "app.new"),
  /** Old app.prev kept aside during a deploy, deleted once it succeeded. */
  drop: join(s.dir, ".app.prev.drop"),
  tmp: join(s.dir, ".app.swap"),
});

/** pm2 process name of a site. */
export const appName = (s: SiteRow) => s.app ?? s.name;

/** Wraps an undo so the job knows whether the files really went back. */
const tracked = (st: DeployState, fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } catch (e) {
    st.undoFailed = true;
    throw e;
  }
};

/** Concatenates the chunks into app.new, checks size + sha256, and always deletes the staged upload. */
export function assembleStep(s: SiteRow, u: Upload): StepDef {
  const { next } = binPaths(s);
  return {
    key: "assemble",
    label: "Assemble upload",
    async run() {
      if (!existsSync(s.dir)) throw new Error(`site folder ${s.dir} does not exist`);
      const hash = createHash("sha256");
      const fd = openSync(next, "w", 0o600);
      let size = 0;
      try {
        for (let i = 0; i < u.chunks; i++) {
          const b = readFileSync(chunkPath(u, i));
          hash.update(b);
          writeSync(fd, b);
          size += b.length;
        }
      } finally {
        closeSync(fd);
        rmSync(u.dir, { recursive: true, force: true });
      }
      const sha = hash.digest("hex");
      if (size !== u.sizeBytes) throw new Error(`assembled ${size} bytes, expected ${u.sizeBytes}`);
      if (sha !== u.sha256) throw new Error(`sha256 mismatch: got ${sha}, expected ${u.sha256}`);
      return `${size} bytes, sha256 ok`;
    },
    async undo() {
      rmSync(next, { force: true });
    },
  };
}

/** Reads the runtime of app.new from its ELF header (rejects non-aarch64/non-ELF files). */
export const detectStep = (s: SiteRow, st: DeployState): StepDef => ({
  key: "detect",
  label: "Detect runtime",
  async run() {
    st.runtime = detectRuntime(binPaths(s).next);
    return st.runtime === "native" ? "native (Android linker)" : "grun (glibc linker)";
  },
});

/** chmod 755 app.new. */
export const chmodStep = (s: SiteRow): StepDef => ({
  key: "chmod",
  label: "Make executable",
  async run() {
    chmodSync(binPaths(s).next, BIN_MODE);
    return "mode 755";
  },
});

/** app → app.prev, app.new → app. The old app.prev is set aside until the job succeeded; undo restores all three. */
export function swapStep(s: SiteRow, st: DeployState): StepDef {
  const p = binPaths(s);
  let hadApp = false;
  let hadPrev = false;
  return {
    key: "swap",
    label: "Swap binary",
    async run() {
      hadApp = existsSync(p.app);
      hadPrev = existsSync(p.prev);
      if (hadPrev) renameSync(p.prev, p.drop);
      if (hadApp) renameSync(p.app, p.prev);
      renameSync(p.next, p.app);
      st.swapped = true;
      return hadApp ? "previous binary kept as app.prev" : "first deploy, no previous binary";
    },
    undo: tracked(st, async () => {
      if (hadApp) renameSync(p.prev, p.app);
      else rmSync(p.app, { force: true });
      if (hadPrev) renameSync(p.drop, p.prev);
    }),
  };
}

/** Rollback swap: app ↔ app.prev. Undo swaps back. */
export function swapBackStep(s: SiteRow, st: DeployState): StepDef {
  const p = binPaths(s);
  const swap = () => {
    renameSync(p.app, p.tmp);
    renameSync(p.prev, p.app);
    renameSync(p.tmp, p.prev);
  };
  return {
    key: "swap",
    label: "Swap app and app.prev",
    async run() {
      swap();
      st.swapped = true;
      return "app.prev is live, the replaced binary is now app.prev";
    },
    undo: tracked(st, async () => swap()),
  };
}

/** pm2 script/args for a runtime. */
export function runCommand(runtime: SiteRuntime): { script: string; args?: string[] } {
  return runtime === "native" ? { script: "./app" } : { script: `${termuxPrefix()}/bin/grun`, args: ["./app"] };
}

/** apps.json text with app `name` set to run `runtime` (other fields kept); throws if the entry is missing. */
export function setAppRuntime(text: string | null, name: string, runtime: SiteRuntime): string {
  const apps = parseApps(text);
  const entry = apps.find((a) => a.name === name);
  if (!entry) throw new Error(`apps.json has no app named ${name}`);
  delete entry.args;
  Object.assign(entry, runCommand(runtime));
  return `${JSON.stringify(apps, null, 2)}\n`;
}

/** Managed sites: point the apps.json entry at the runtime (atomic, .bak). Adopted: skipped. Undo restores bytes. */
export function appsRuntimeStep(ctx: SiteCtx, s: SiteRow, st: DeployState): StepDef {
  const { appsJson } = sitePaths(ctx);
  let prev: string | null = null;
  return {
    key: "apps",
    label: "Update pm2 entry",
    async run() {
      if (!s.managed) {
        return { skipped: `adopted site: hand-written pm2 entry untouched (it must run a ${st.runtime} binary)` };
      }
      prev = readTextOrNull(appsJson);
      const next = setAppRuntime(prev, appName(s), st.runtime);
      if (next === prev) return { skipped: `apps.json already runs ${st.runtime}` };
      writeAtomic(appsJson, next, { backup: true });
      st.appsChanged = true;
      return `apps.json: ${st.runtime}`;
    },
    undo: tracked(st, async () => restoreText(appsJson, prev)),
  };
}

/**
 * Restarts the site's pm2 app. A managed app whose apps.json entry changed, or that pm2 never started (first
 * deploy), is (re)loaded from ecosystem.config.js, since `pm2 restart` keeps the old script.
 * ponytail: delete+start leaves a short gap; pm2-runtime exits if that was its only app (POCO has others).
 */
export async function restartApp(ctx: SiteCtx, s: SiteRow, reload: boolean): Promise<string> {
  const name = appName(s);
  const known = (await ctx.system.pm2.list()).some((a) => a.name === name);
  if (s.managed && (reload || !known)) {
    if (known) await ctx.system.pm2.remove(name);
    const a = await ctx.system.pm2.startFromEcosystem(sitePaths(ctx).ecosystem, name);
    if (!a) throw new Error(`pm2 did not load ${name} from ecosystem.config.js (does it include apps.json?)`);
    return `pm2 started ${name} from ecosystem.config.js`;
  }
  const a = await ctx.system.pm2.control(name, "restart");
  if (!a) throw new Error(`pm2 has no app named ${name}`);
  return `pm2 restarted ${name}`;
}

/**
 * Rollback hook: brings pm2 back in line with the restored files. Without any binary left (a first deploy was
 * undone) a managed app is removed again (back to "not deployed") and an adopted one stopped.
 */
export async function revertApp(ctx: SiteCtx, s: SiteRow, st: DeployState): Promise<string | null> {
  if (!st.restarted) return null;
  if (existsSync(binPaths(s).app)) return restartApp(ctx, s, st.appsChanged);
  if (s.managed) return (await ctx.system.pm2.remove(appName(s))) ? `pm2 removed ${appName(s)}` : null;
  return (await ctx.system.pm2.control(appName(s), "stop")) ? `pm2 stopped ${appName(s)}` : null;
}

/** Restart as a step; the job's rollback hook restarts again with the restored files. */
export const restartStep = (ctx: SiteCtx, s: SiteRow, st: DeployState): StepDef => ({
  key: "restart",
  label: "Restart app",
  async run() {
    st.restarted = true;
    return restartApp(ctx, s, st.appsChanged);
  },
});

/** Polls TCP connect then `GET /` on 127.0.0.1:<port> until a status < 500 or `timeoutMs` passed. */
export const healthStep = (ctx: SiteCtx, s: SiteRow, timeoutMs: number): StepDef => ({
  key: "health",
  label: "Wait until healthy",
  async run() {
    const t0 = Date.now();
    let last = "port not accepting connections";
    for (;;) {
      if (await ctx.system.net.isListening(s.port)) {
        const code = await ctx.system.net.httpStatus(s.port);
        if (code !== null && code < HTTP_SERVER_ERROR) return `HTTP ${code} after ${Date.now() - t0} ms`;
        last = code === null ? "GET / got no answer" : `GET / returned ${code}`;
      }
      if (Date.now() - t0 > timeoutMs)
        throw new Error(`not healthy on port ${s.port} after ${timeoutMs / 1000}s (${last})`);
      await sleep(POLL_MS);
    }
  },
});
