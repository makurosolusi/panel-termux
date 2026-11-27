// Per-file planners of the integration fixes (ecosystem, pm2 run script, sites folder, apps.json) and which fixes
// GET /integration offers (`fixes[]`). Split out of fix.plan.ts (file health); preview, apply and the list share them.
import { existsSync, lstatSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { FixAvailability, FixBlockReason, FixKey } from "../../shared/fix.types";
import type { IntegrationCheckKey } from "../../shared/site.types";
import { planAppsRebuild } from "./apps.rebuild";
import { planEcosystemFix } from "./ecosystem.patch";
import { type EcosystemProbe, probeEcosystem } from "./ecosystem.probe";
import {
  errno,
  FIX_KEYS,
  type FixPlan,
  NO_EFFECTS,
  prefixOf,
  realOrNull,
  runnablePanelApps,
  runScriptPath,
  sha256,
} from "./fix.plan";
import { planRunScriptFix } from "./runscript.patch";
import { type SiteCtx, sitePaths } from "./site.checks";
import { readBytesOrNull } from "./site.files";

const PERM_BITS = 0o777;
/** Checks each fix resolves; the first ones listed (TRIGGERS) decide whether the fix is offered at all. */
// One missing folder is one problem row: sites_dir_create also claims the apps.json and ecosystem checks it makes good.
const RESOLVES: Record<FixKey, IntegrationCheckKey[]> = {
  sites_dir_create: ["sites_dir", "apps_json", "ecosystem_file"],
  apps_json_rebuild: ["apps_json"],
  ecosystem_block: ["ecosystem_spreads_apps_json", "snippet_current", "pm2_guard"],
  pm2_auto_exit: ["pm2_auto_exit"],
};
const TRIGGERS: Record<FixKey, IntegrationCheckKey[]> = {
  sites_dir_create: ["sites_dir", "ecosystem_file"],
  apps_json_rebuild: ["apps_json"],
  ecosystem_block: ["ecosystem_spreads_apps_json", "snippet_current"],
  pm2_auto_exit: ["pm2_auto_exit"],
};
/**
 * A failing check the patcher calls `unchanged` is a file shape it does not know; null = not this fix's problem (a
 * missing apps.json is made by sites_dir_create / verify, not rebuilt).
 */
const UNKNOWN_SHAPE: Record<FixKey, FixBlockReason | null> = {
  // Folder there, ecosystem "missing" but its name taken (a dangling symlink): never written over.
  sites_dir_create: "ecosystem_linked",
  apps_json_rebuild: null,
  ecosystem_block: "unknown_apps_json_use",
  pm2_auto_exit: "run_script_unknown",
};

const manual = (reason: FixBlockReason): FixPlan => ({ kind: "manual", reason });

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

const lexists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if (errno(e) === "ENOENT") return false;
    throw new Error(`stat ${path}: ${(e as Error).message}`, { cause: e });
  }
};

/** Folder and/or ecosystem.config.js missing → make them (+ apps.json); pm2 loads a new ecosystem when it starts. */
function planSitesDir(ctx: SiteCtx): FixPlan {
  const p = sitePaths(ctx);
  const dir = resolve(p.sitesDir);
  const newEcosystem = lexists(p.ecosystem) ? null : p.ecosystem;
  const effects = { ...NO_EFFECTS, newEcosystem, appliesOnRestart: newEcosystem !== null };
  if (existsSync(dir))
    return newEcosystem === null ? { kind: "unchanged" } : { kind: "patch", patch: null, probe: null, effects };
  let parent = dirname(dir);
  while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
  const home = realOrNull(ctx.system.home);
  const real = realOrNull(parent);
  if (!home || !real || (real !== home && !real.startsWith(home + sep))) return manual("sites_dir_outside_home");
  return { kind: "patch", patch: null, probe: null, effects: { ...effects, dir } };
}

function planAppsJson(ctx: SiteCtx): FixPlan {
  const r = planAppsRebuild(ctx);
  if (r === null) return { kind: "unchanged" };
  const st = statSync(r.path);
  return {
    kind: "patch",
    probe: null,
    effects: { ...NO_EFFECTS, addApps: r.names, appliesOnRestart: true },
    patch: {
      file: "apps_json",
      path: r.path,
      original: r.original,
      sha: sha256(r.original),
      mode: st.mode & PERM_BITS,
      candidate: r.candidate,
      changes: r.changes,
      line: 0,
    },
  };
}

/** Plan of fix `key` from the files as they are now; `probe` = an ecosystem probe of the current file, if at hand. */
export function planFix(ctx: SiteCtx, key: FixKey, probe?: EcosystemProbe): Promise<FixPlan> | FixPlan {
  switch (key) {
    case "ecosystem_block":
      return planEcosystem(ctx, probe);
    case "pm2_auto_exit":
      return planRunScript(ctx);
    case "apps_json_rebuild":
      return planAppsJson(ctx);
    case "sites_dir_create":
      return planSitesDir(ctx);
  }
}

/**
 * `Integration.fixes`: a fix is listed when one of its trigger checks fails and no earlier fix claimed them all;
 * `checks` = the failing ones it resolves (the web shows them as one row).
 */
export async function fixAvailability(
  ctx: SiteCtx,
  failing: ReadonlySet<IntegrationCheckKey>,
  probe: EcosystemProbe,
): Promise<FixAvailability[]> {
  const out: FixAvailability[] = [];
  const claimed = new Set<IntegrationCheckKey>();
  for (const key of FIX_KEYS) {
    if (!TRIGGERS[key].some((k) => failing.has(k) && !claimed.has(k))) continue;
    const checks = RESOLVES[key].filter((k) => failing.has(k) && !claimed.has(k));
    const plan = await planFix(ctx, key, probe);
    const reason = plan.kind === "manual" ? plan.reason : plan.kind === "unchanged" ? UNKNOWN_SHAPE[key] : null;
    if (plan.kind === "patch") out.push({ key, checks, available: true });
    else if (reason !== null) out.push({ key, checks, available: false, reason });
    else continue;
    for (const k of checks) claimed.add(k);
  }
  return out;
}
