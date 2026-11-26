// How pm2 runs a panel site (PLAN/03 D6): a fixed apps.json entry `script: "./run"` and a `run` sh script derived
// from the ELF header of `app` on every deploy/rollback/cleanup, so a runtime change never needs a new pm2 entry.
import { chmodSync, existsSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ScriptRuntime, SiteRuntime } from "../../shared/site.types";
import { termuxPrefix } from "../exec/termux.exec";
import { parseApps } from "../sites/apps.file";
import { readTextOrNull } from "../sites/site.files";
import type { Pm2Proc } from "../system/system.types";

/** Script of every panel apps.json entry. */
export const RUN_SCRIPT = "./run";
const RUN_MODE = 0o755;
/** pm2 restart back-off of panel entries (ms). */
const RESTART_DELAY_MS = 1000;
const GRUN_NAMES = new Set(["grun", "glibc-runner"]);

/** Text of `run` for a runtime: `exec ./app` or `exec $PREFIX/bin/grun ./app`. */
export function runScriptText(runtime: SiteRuntime, prefix = termuxPrefix()): string {
  const exec = runtime === "native" ? "exec ./app" : `exec ${prefix}/bin/grun ./app`;
  return `#!${prefix}/bin/sh\n# Panel Termux: written from the ELF header of ./app (${runtime}) on every deploy.\n${exec} "$@"\n`;
}

/** Writes `<dir>/run` for `runtime` atomically (temp `run.panel-tmp` + rename); returns the previous text. */
export function writeRunScript(dir: string, runtime: SiteRuntime): { changed: boolean; previous: string | null } {
  const path = join(dir, "run");
  const previous = readTextOrNull(path);
  const text = runScriptText(runtime);
  if (previous === text) return { changed: false, previous };
  const tmp = join(dir, "run.panel-tmp");
  try {
    writeFileSync(tmp, text, { mode: RUN_MODE });
    chmodSync(tmp, RUN_MODE); // writeFileSync's mode is masked by umask
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`write ${path}: ${(e as Error).message}`, { cause: e });
  }
  return { changed: true, previous };
}

/** Puts `run` back to `previous` (null = it did not exist). */
export function restoreRunScript(dir: string, previous: string | null): void {
  const path = join(dir, "run");
  if (previous === null) rmSync(path, { force: true });
  else {
    writeFileSync(path, previous, { mode: RUN_MODE });
    chmodSync(path, RUN_MODE);
  }
}

/** The fixed apps.json entry of a panel site (no `env`: `.env` is the only source, E6b). */
export const panelAppEntry = (name: string, cwd: string) => ({
  name,
  cwd,
  script: RUN_SCRIPT,
  interpreter: "none",
  exp_backoff_restart_delay: RESTART_DELAY_MS,
});

/** Result of ensureAppsEntry: new apps.json text (null = unchanged) and the outcome code. */
export type AppsEntryResult = { text: string | null; code: "apps_registered" | "apps_unchanged" | "apps_migrated" };

/** apps.json with the fixed entry for `name`: added, kept, or rewritten from an old `script: ./app`/grun entry. */
export function ensureAppsEntry(text: string | null, name: string, cwd: string): AppsEntryResult {
  const apps = parseApps(text);
  const i = apps.findIndex((a) => a.name === name);
  const entry = panelAppEntry(name, cwd);
  if (i !== -1 && apps[i]?.script === RUN_SCRIPT && apps[i]?.cwd === cwd) return { text: null, code: "apps_unchanged" };
  if (i === -1) apps.push(entry);
  else apps[i] = entry;
  return { text: `${JSON.stringify(apps, null, 2)}\n`, code: i === -1 ? "apps_registered" : "apps_migrated" };
}

/** What a hand-written pm2 entry runs: grun/glibc-runner, the binary `<cwd>/app` itself, or something else. */
export function scriptRuntimeOf(proc: Pick<Pm2Proc, "execPath" | "cwd">): ScriptRuntime {
  const exec = proc.execPath;
  if (!exec) return "other";
  const real = existsSync(exec) ? realpathSync(exec) : exec;
  if (GRUN_NAMES.has(basename(real)) || GRUN_NAMES.has(basename(exec))) return "grun";
  if (proc.cwd && (exec === join(proc.cwd, "app") || real === join(proc.cwd, "app"))) return "native";
  return "other";
}
