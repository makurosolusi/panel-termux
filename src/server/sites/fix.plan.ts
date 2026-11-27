// Reads the files an integration fix touches and decides the change (PLAN/06 §3.3, §3.6, §6.2). One code path for
// GET /integration (`fixes[]`), preview and apply, so the three never disagree. Validation of candidates lives here too.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type {
  FixAvailability,
  FixBackup,
  FixBlockReason,
  FixChange,
  FixEffects,
  FixFile,
  FixKey,
} from "../../shared/fix.types";
import { type IntegrationCheckKey, PM2_GUARD_NAME } from "../../shared/site.types";
import { runTermux, termuxPrefix } from "../exec/termux.exec";
import { redactLines } from "../system/log.redact";
import { entryBinary, parseApps } from "./apps.file";
import { BLOCK_VERSION, ECOSYSTEM_CANDIDATE, planEcosystemFix } from "./ecosystem.patch";
import { type EcosystemProbe, probeEcosystem } from "./ecosystem.probe";
import { type FixBackupEntry, latestFixBackups } from "./fix.backup";
import { planRunScriptFix, syntaxShell } from "./runscript.patch";
import { type SiteCtx, sitePaths } from "./site.checks";
import { readBytesOrNull, readTextOrNull, writeFileSynced } from "./site.files";

/** Site context plus the panel data dir (fix backups); without it `lastFixes` is empty. */
export type FixCtx = SiteCtx & { dataDir?: string };
/** Every fix, in the order the card lists them. */
export const FIX_KEYS: readonly FixKey[] = ["sites_dir_create", "ecosystem_block", "pm2_auto_exit"];
/** A file change ready to validate and write; `line` = patched line of the run script (0 for the ecosystem). */
export type FilePatch = {
  file: FixFile;
  path: string;
  original: Buffer;
  sha: string;
  mode: number;
  candidate: Buffer;
  changes: FixChange[];
  line: number;
};
/** What a fix would do now; `patch` null = no file is written (sites_dir_create). */
export type FixPlan =
  | { kind: "patch"; patch: FilePatch | null; effects: FixEffects; probe: EcosystemProbe | null }
  | { kind: "unchanged" }
  | { kind: "manual"; reason: FixBlockReason };

/** Effects of a fix that changes nothing visible (preview of `unchanged`). */
export const NO_EFFECTS: FixEffects = {
  keepApps: [],
  addApps: [],
  guard: false,
  oldSpread: false,
  appliesOnRestart: false,
  dir: null,
};
const DETAIL_MAX = 300;
const SYNTAX_TIMEOUT_MS = 10_000;
const PERM_BITS = 0o777;
/** Checks each fix resolves; the first ones listed (TRIGGERS) decide whether the fix is offered at all. */
const RESOLVES: Record<FixKey, IntegrationCheckKey[]> = {
  sites_dir_create: ["sites_dir"],
  ecosystem_block: ["ecosystem_spreads_apps_json", "snippet_current", "pm2_guard"],
  pm2_auto_exit: ["pm2_auto_exit"],
};
const TRIGGERS: Record<FixKey, IntegrationCheckKey[]> = {
  sites_dir_create: ["sites_dir"],
  ecosystem_block: ["ecosystem_spreads_apps_json", "snippet_current"],
  pm2_auto_exit: ["pm2_auto_exit"],
};
/** A failing check the patcher calls `unchanged` is a file shape it does not know. */
const UNKNOWN_SHAPE: Record<FixKey, FixBlockReason> = {
  sites_dir_create: "sites_dir_outside_home",
  ecosystem_block: "unknown_apps_json_use",
  pm2_auto_exit: "run_script_unknown",
};

/** sha256 hex of bytes. */
export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** Termux prefix of this system (the sandbox `<home>/usr` in fake mode). */
export const prefixOf = (ctx: SiteCtx) => ctx.system.prefix ?? termuxPrefix();
/** The runit run script of pm2. */
export const runScriptPath = (ctx: SiteCtx) => join(prefixOf(ctx), "var", "service", "pm2", "run");

const manual = (reason: FixBlockReason): FixPlan => ({ kind: "manual", reason });
const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw new Error(`realpath ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Live path of a fixed file (the ecosystem through its symlink, if any). */
export function fixTargetPath(ctx: SiteCtx, file: FixFile): string {
  if (file === "pm2_run") return runScriptPath(ctx);
  const eco = sitePaths(ctx).ecosystem;
  return realOrNull(eco) ?? eco;
}

/** apps.json entries, or [] when the file is missing or invalid (its own check reports that). */
function panelEntries(ctx: SiteCtx): Record<string, unknown>[] {
  try {
    return parseApps(readTextOrNull(sitePaths(ctx).appsJson));
  } catch {
    return []; // apps_json check shows the parse error
  }
}

/** Names of apps.json entries the block loads: a non-empty string `script` and every binary present (§3.1). */
export function runnablePanelApps(ctx: SiteCtx): string[] {
  const { sitesDir } = sitePaths(ctx);
  return panelEntries(ctx)
    .filter((a) => typeof a.script === "string" && a.script !== "")
    .filter((a) => entryBinary(a, sitesDir).every((f) => existsSync(f)))
    .map((a) => a.name as string);
}

async function planEcosystem(ctx: SiteCtx, probe?: EcosystemProbe): Promise<FixPlan> {
  const p = sitePaths(ctx);
  const real = realOrNull(p.ecosystem);
  const bytes = real === null ? null : readBytesOrNull(real);
  if (real === null || bytes === null) return manual("ecosystem_missing");
  const st = statSync(real);
  const probeBefore = probe ?? (await probeEcosystem(ctx.system, p.ecosystem, p.sitesDir));
  const plan = planEcosystemFix({
    bytes,
    path: real,
    realDir: dirname(real),
    sitesDirReal: realOrNull(p.sitesDir) ?? p.sitesDir,
    nlink: st.nlink,
    probeBefore,
    prefix: prefixOf(ctx),
    panelApps: runnablePanelApps(ctx),
  });
  if (plan.kind !== "patch") return plan;
  const { candidate, changes, effects } = plan;
  const patch = { file: "ecosystem" as const, path: real, original: bytes, sha: sha256(bytes), candidate, changes };
  return { kind: "patch", effects, probe: probeBefore, patch: { ...patch, mode: st.mode & PERM_BITS, line: 0 } };
}

function planRunScript(ctx: SiteCtx): FixPlan {
  const path = runScriptPath(ctx);
  let st: ReturnType<typeof lstatSync> | null = null;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (errno(e) !== "ENOENT") throw new Error(`stat ${path}: ${(e as Error).message}`, { cause: e });
  }
  const bytes = st === null ? null : readBytesOrNull(path);
  const plan = planRunScriptFix({ bytes, isSymlink: st?.isSymbolicLink() ?? false, nlink: st?.nlink ?? 1 });
  if (plan.kind !== "patch") return plan;
  const stat = st as NonNullable<typeof st>; // a patch implies the file was read
  return {
    kind: "patch",
    probe: null,
    effects: { ...NO_EFFECTS, appliesOnRestart: true },
    patch: {
      file: "pm2_run",
      path,
      original: bytes as Buffer,
      sha: sha256(bytes as Buffer),
      mode: stat.mode & PERM_BITS,
      candidate: plan.candidate,
      changes: plan.changes,
      line: plan.line,
    },
  };
}

function planSitesDir(ctx: SiteCtx): FixPlan {
  const dir = resolve(sitePaths(ctx).sitesDir);
  if (existsSync(dir)) return { kind: "unchanged" };
  let parent = dirname(dir);
  while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
  const home = realOrNull(ctx.system.home);
  const real = realOrNull(parent);
  if (!home || !real || (real !== home && !real.startsWith(home + sep))) return manual("sites_dir_outside_home");
  return { kind: "patch", patch: null, probe: null, effects: { ...NO_EFFECTS, dir } };
}

/** Plan of fix `key` from the files as they are now; `probe` = an ecosystem probe of the current file, if at hand. */
export function planFix(ctx: SiteCtx, key: FixKey, probe?: EcosystemProbe): Promise<FixPlan> | FixPlan {
  if (key === "ecosystem_block") return planEcosystem(ctx, probe);
  return key === "pm2_auto_exit" ? planRunScript(ctx) : planSitesDir(ctx);
}

/** `Integration.fixes`: a fix is listed when one of its trigger checks fails; `checks` = the failing ones it resolves. */
export async function fixAvailability(
  ctx: SiteCtx,
  failing: ReadonlySet<IntegrationCheckKey>,
  probe: EcosystemProbe,
): Promise<FixAvailability[]> {
  const out: FixAvailability[] = [];
  for (const key of FIX_KEYS) {
    if (!TRIGGERS[key].some((k) => failing.has(k))) continue;
    const checks = RESOLVES[key].filter((k) => failing.has(k));
    const plan = await planFix(ctx, key, probe);
    if (plan.kind === "patch") out.push({ key, checks, available: true });
    else out.push({ key, checks, available: false, reason: plan.kind === "manual" ? plan.reason : UNKNOWN_SHAPE[key] });
  }
  return out;
}

/** FixBackup view of a backup entry: edited since (sha8 of the live file differs) and the sites a restore affects. */
export function fixBackupView(ctx: SiteCtx, e: FixBackupEntry): FixBackup {
  const cur = readBytesOrNull(fixTargetPath(ctx, e.file));
  return {
    id: e.id,
    file: e.file,
    at: e.at,
    changedSince: cur === null || sha256(cur).slice(0, 8) !== e.sha8,
    affectedSites: e.file === "ecosystem" ? panelEntries(ctx).map((a) => a.name as string) : [],
  };
}

/** `Integration.lastFixes`: newest backup of each fixed file, newest first (undo is per file). */
export const lastFixesOf = (ctx: FixCtx): FixBackup[] =>
  ctx.dataDir ? latestFixBackups(ctx.dataDir).map((e) => fixBackupView(ctx, e)) : [];

/**
 * Loads `bytes` as `<sites>/.ecosystem.panel-candidate.config.js` (deleted in `finally`). With `before` (a patch) it
 * must also pass PLAN/06 §3.4 step 6; without it (a restore) loading is enough. Returns null when valid, else a
 * short redacted reason. I/O errors throw (the caller maps ENOSPC/EACCES).
 */
export async function validateEcosystem(
  ctx: SiteCtx,
  bytes: Uint8Array,
  mode: number,
  before: EcosystemProbe | null,
): Promise<string | null> {
  const { sitesDir } = sitePaths(ctx);
  const cand = join(sitesDir, ECOSYSTEM_CANDIDATE);
  let after: EcosystemProbe;
  try {
    writeFileSynced(cand, bytes, mode);
    after = await probeEcosystem(ctx.system, cand, sitesDir);
  } finally {
    rmSync(cand, { force: true });
  }
  if (!after.ok) return (after.detail ?? `candidate does not load (${after.reason})`).slice(0, DETAIL_MAX);
  if (before === null || !before.ok) return null;
  if (after.block?.v !== BLOCK_VERSION || !after.block.listed) return "the panel block did not run to its end";
  if (!after.spreads) return "panel sites do not reach the apps list";
  const changed = Object.keys(before.digests).filter((n) => after.digests[n] !== before.digests[n]);
  if (changed.length) return `hand-written apps changed: ${changed.join(", ")}`.slice(0, DETAIL_MAX);
  const guardWanted = before.names.length === 0 || before.names.includes(PM2_GUARD_NAME);
  if (after.names.includes(PM2_GUARD_NAME) !== guardWanted)
    return guardWanted ? "pm2-guard is missing" : "pm2-guard added next to hand-written apps";
  const dupes = (n: string[]) => n.length - new Set(n).size;
  if (dupes(after.names) > dupes(before.names)) return "duplicate app names";
  return null;
}

/** `<shell> -n` on `bytes` written next to `runPath`; null when the syntax is fine, else a short redacted reason. */
export async function checkRunScriptSyntax(
  ctx: SiteCtx,
  runPath: string,
  bytes: Uint8Array,
  mode: number,
): Promise<string | null> {
  const tmp = join(dirname(runPath), `.${basename(runPath)}.panel-restore`);
  try {
    writeFileSynced(tmp, bytes, mode);
    const text = Buffer.from(bytes).toString("utf8");
    let r: Awaited<ReturnType<typeof runTermux>>;
    try {
      r = await runTermux(syntaxShell(text, prefixOf(ctx)), ["-n", tmp], { timeoutMs: SYNTAX_TIMEOUT_MS });
    } catch (e) {
      return `syntax check of ${runPath}: ${(e as Error).message}`.slice(0, DETAIL_MAX);
    }
    if (r.code === 0) return null;
    const detail = redactLines(r.stderr.trim().split("\n")).lines.join("\n").slice(0, DETAIL_MAX);
    return detail || `syntax check exited ${r.code}`;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Deletes a leftover `<sites>/.ecosystem.panel-candidate.config.js` (boot; it may hold `env` secrets). */
export function removeFixCandidate(ctx: SiteCtx): void {
  rmSync(join(sitePaths(ctx).sitesDir, ECOSYSTEM_CANDIDATE), { force: true });
}
