// ~/sites/apps.json: the panel-owned list of pm2 app objects spread into ecosystem.config.js (PLAN/03 D5/D6).
// The entry itself (`panelAppEntry`/`ensureAppsEntry`) lives with the deploy steps in deploy/run.script.ts.
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { SiteCtx } from "./site.checks";
import { sitePaths } from "./site.checks";
import { writeAtomic } from "./site.files";

/** Script of every panel entry (`run` is written from the ELF header of `app`, PLAN/03 D6). */
const RUN_SCRIPT = "./run";

const GRUN_NAMES = new Set(["grun", "glibc-runner"]);

/** Parses apps.json (null/absent = empty list); throws when it is not a JSON array of objects with a name. */
export function parseApps(text: string | null): Record<string, unknown>[] {
  if (text === null || text.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`apps.json is not valid JSON (${(e as Error).name})`, { cause: e });
  }
  if (!Array.isArray(data) || !data.every((a) => typeof a === "object" && a !== null && typeof a.name === "string")) {
    throw new Error("apps.json must be an array of pm2 app objects with a name");
  }
  return data;
}

/** pm2 names in apps.json. */
export const appNames = (text: string | null): string[] => parseApps(text).map((a) => a.name as string);

const listText = (apps: unknown[]) => `${JSON.stringify(apps, null, 2)}\n`;

/** apps.json text without app `name` (unchanged list if absent). */
export const removeApp = (text: string | null, name: string): string =>
  listText(parseApps(text).filter((a) => a.name !== name));

/**
 * Files an entry needs to run (integration check `apps_entries_runnable`): `./run` → run + app; grun → its first
 * arg (the binary); anything else → the script itself. Relative paths resolve against `cwd` (default sites dir).
 */
export function entryBinary(a: Record<string, unknown>, sitesDir: string): string[] {
  const cwd = typeof a.cwd === "string" ? a.cwd : sitesDir;
  const script = typeof a.script === "string" ? a.script : "";
  if (script === RUN_SCRIPT) return [join(cwd, "run"), join(cwd, "app")];
  if (GRUN_NAMES.has(basename(script))) {
    const first = Array.isArray(a.args) ? a.args[0] : typeof a.args === "string" ? a.args.split(/\s+/)[0] : "";
    return [resolve(cwd, String(first ?? ""))];
  }
  return [resolve(cwd, script)];
}

/** Writes `[]` to apps.json when `sites.dir` exists and the file does not (never overwrites; boot + verify, D3). */
export function ensureAppsJson(ctx: SiteCtx): boolean {
  const { sitesDir, appsJson } = sitePaths(ctx);
  if (!existsSync(sitesDir) || existsSync(appsJson)) return false;
  writeAtomic(appsJson, "[]\n");
  return true;
}
