// Coded file steps of site.deploy / site.rollback (PLAN/03 §3.4): stage → detect → chmod → swap → run_script →
// apps_entry (app_restart and health live in deploy.restart.ts). Every failure is a StepError with a PLAN code.
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import type { SiteRuntime } from "../../shared/site.types";
import type { site } from "../db/schema";
import { errMsg, type StepDef, StepError } from "../sites/job.step";
import { type SiteCtx, sitePaths } from "../sites/site.checks";
import { readTextOrNull, restoreText, writeAtomic } from "../sites/site.files";
import { identityOf, rowFor, setIdentity } from "./binary.identity";
import { BinaryError, detectRuntime } from "./elf.runtime";
import type { HealthBaseline } from "./health.check";
import { ensureAppsEntry, restoreRunScript, writeRunScript } from "./run.script";
import {
  type BinPaths,
  binPaths,
  type DeploySwap,
  deploySwap,
  rollbackSwap,
  type SwapHook,
  undoDeploySwap,
} from "./swap";

/** Site table row. */
export type SiteRow = typeof site.$inferSelect;

/** Mutable state of one deploy/rollback/cleanup job, shared by its steps and the final status hooks. */
export type DeployState = {
  runtime: SiteRuntime;
  swapped: boolean;
  /** apps_entry outcome when it wrote apps.json (registered/migrated need `pm2 start` instead of restart). */
  appsWrite: "apps_registered" | "apps_migrated" | null;
  restarted: boolean;
  undoFailed: boolean;
  baseline: HealthBaseline | null;
};

/** Fresh job state. */
export const newState = (runtime: SiteRuntime): DeployState => ({
  runtime,
  swapped: false,
  appsWrite: null,
  restarted: false,
  undoFailed: false,
  baseline: null,
});

const BIN_MODE = 0o755;

/** pm2 process name of a site. */
export const appName = (s: SiteRow) => s.app ?? s.name;
/** Binary paths of a site row. */
export const binsOf = (s: SiteRow): BinPaths => binPaths(s.dir);

/** Wraps an undo so the job knows whether the files really went back. */
const tracked = (st: DeployState, fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } catch (e) {
    st.undoFailed = true;
    throw e;
  }
};

/** stage: upload.bin → app.new (rename; copy when the data dir is on another filesystem). Undo removes app.new. */
export function stageStep(s: SiteRow, upload: { path: string; sizeBytes: number }, done: () => void): StepDef {
  const { next } = binsOf(s);
  return {
    key: "stage",
    async run() {
      try {
        if (!existsSync(s.dir)) throw new StepError("folder_missing", { path: s.dir });
        if (!existsSync(upload.path)) throw new StepError("upload_missing", {}, `${upload.path} is gone`);
        try {
          renameSync(upload.path, next);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
          copyFileSync(upload.path, next);
        }
        const size = identityOf(next)?.size ?? -1;
        if (size !== upload.sizeBytes) throw new StepError("size_mismatch", { got: size, expected: upload.sizeBytes });
        return { code: "staged", params: { sizeBytes: size } };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOSPC") throw new StepError("disk_full", {}, errMsg(e));
        throw e;
      } finally {
        done();
      }
    },
    async undo() {
      rmSync(next, { force: true });
    },
  };
}

/** Runtime of a binary file as a coded failure (`invalid_binary {reason}`). */
export function runtimeOf(path: string): SiteRuntime {
  try {
    return detectRuntime(path);
  } catch (e) {
    if (e instanceof BinaryError) throw new StepError("invalid_binary", { reason: e.reason }, e.message);
    throw e;
  }
}

/** detect: runtime of app.new; an adopted site must keep what its hand-written entry runs (`expected`). */
export const detectStep = (s: SiteRow, st: DeployState, expected: SiteRuntime | null): StepDef => ({
  key: "detect",
  async run() {
    st.runtime = runtimeOf(binsOf(s).next);
    if (expected && expected !== st.runtime) {
      throw new StepError("runtime_mismatch", { expected, got: st.runtime });
    }
    return { code: st.runtime === "native" ? "runtime_native" : "runtime_grun" };
  },
});

/** chmod 755 app.new. */
export const chmodStep = (s: SiteRow): StepDef => ({
  key: "chmod",
  async run() {
    try {
      chmodSync(binsOf(s).next, BIN_MODE);
    } catch (e) {
      throw new StepError("chmod_failed", {}, errMsg(e));
    }
    return { code: "chmod_done" };
  },
});

/** Points deploy row `rowId` at the file now at `to` (the swap moved or copied its binary; a copy has a new inode). */
function repoint(ctx: SiteCtx, rowId: string | undefined, to: string): void {
  if (rowId) setIdentity(ctx.db, rowId, identityOf(to));
}

/** swap (deploy, D23). Undo puts the replaced binary back; `app` exists throughout. */
export function swapStep(ctx: SiteCtx, s: SiteRow, st: DeployState, hook?: SwapHook): StepDef {
  const p = binsOf(s);
  let done: DeploySwap | null = null;
  return {
    key: "swap",
    async run() {
      const liveRow = rowFor(ctx.db, s.name, identityOf(p.app))?.id;
      try {
        done = deploySwap(p, hook);
      } catch (e) {
        throw new StepError("swap_failed", {}, errMsg(e));
      }
      st.swapped = true;
      if (done.linked === null) return { code: "swap_first" };
      repoint(ctx, liveRow, p.prev);
      return { code: "swap_kept_previous", params: { linked: done.linked } };
    },
    undo: tracked(st, async () => {
      if (done) undoDeploySwap(p, done);
    }),
  };
}

/** swap (rollback): app ↔ app.prev, D23 order. Its undo is the same exchange. */
export function rollbackSwapStep(ctx: SiteCtx, s: SiteRow, st: DeployState, hook?: SwapHook): StepDef {
  const p = binsOf(s);
  const exchange = () => {
    const liveRow = rowFor(ctx.db, s.name, identityOf(p.app))?.id;
    const r = rollbackSwap(p, hook);
    repoint(ctx, liveRow, p.prev);
    return r;
  };
  return {
    key: "swap",
    async run() {
      let linked: boolean;
      try {
        linked = exchange().linked;
      } catch (e) {
        throw new StepError("swap_failed", {}, errMsg(e));
      }
      st.swapped = true;
      return { code: "swap_back", params: { linked } };
    },
    undo: tracked(st, async () => {
      exchange();
    }),
  };
}

/** run_script (managed): `run` rewritten from the ELF header of the live `app`. Adopted sites: skipped. */
export function runScriptStep(s: SiteRow, st: DeployState): StepDef {
  let previous: string | null = null;
  let changed = false;
  return {
    key: "run_script",
    async run() {
      if (!s.managed) return { code: "run_unchanged", skipped: true };
      if (!existsSync(binsOf(s).app)) return { code: "run_unchanged", skipped: true };
      st.runtime = runtimeOf(binsOf(s).app);
      try {
        ({ changed, previous } = writeRunScript(s.dir, st.runtime));
      } catch (e) {
        throw new StepError("run_failed", {}, errMsg(e));
      }
      return changed ? { code: "run_written", params: { runtime: st.runtime } } : { code: "run_unchanged" };
    },
    undo: tracked(st, async () => {
      if (changed) restoreRunScript(s.dir, previous);
    }),
  };
}

/** apps_entry (managed): the fixed `./run` entry in apps.json (atomic, .bak). Undo restores the old bytes. */
export function appsEntryStep(ctx: SiteCtx, s: SiteRow, st: DeployState): StepDef {
  const { appsJson } = sitePaths(ctx);
  let prev: string | null = null;
  return {
    key: "apps_entry",
    async run() {
      if (!s.managed) return { code: "apps_adopted_skip", skipped: true };
      prev = readTextOrNull(appsJson);
      let r: ReturnType<typeof ensureAppsEntry>;
      try {
        r = ensureAppsEntry(prev, appName(s), s.dir);
      } catch (e) {
        throw new StepError("apps_json_invalid", {}, errMsg(e));
      }
      if (r.text === null) return { code: r.code };
      writeAtomic(appsJson, r.text, { backup: true });
      st.appsWrite = r.code === "apps_unchanged" ? null : r.code;
      return { code: r.code };
    },
    undo: tracked(st, async () => {
      if (st.appsWrite) restoreText(appsJson, prev);
    }),
  };
}
