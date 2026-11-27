// Integration status of pm2 + cloudflared for panel-managed sites (PLAN/03 §3.6): checks, snippet, 30 s cache.
import { existsSync, statSync } from "node:fs";
import type { Integration, IntegrationCheck, IntegrationCheckKey, JobParams } from "../../shared/site.types";
import { describeSetting } from "../settings.service";
import { Pm2UnavailableError } from "../system/system.types";
import { ensureAppsJson, parseApps } from "./apps.file";
import { ecosystemBlock, snippetCurrent } from "./ecosystem.patch";
import { type EcosystemProbe, probeEcosystem } from "./ecosystem.probe";
import { type FixCtx, fixAvailability, lastFixOf, prefixOf, runnablePanelApps, runScriptPath } from "./fix.plan";
import { readTunnelId } from "./ingress.editor";
import { sitePaths } from "./site.checks";
import { readTextOrNull } from "./site.files";

const CACHE_MS = 30_000;
const MS_PER_SEC = 1000;
const READY_KEYS: IntegrationCheckKey[] = [
  "sites_dir",
  "apps_json",
  "ecosystem_loads",
  "ecosystem_spreads_apps_json",
  "snippet_current",
  "pm2_runtime",
  "tunnel",
];
/** Checks that only mean something once ecosystem.config.js exists. */
const NEEDS_ECOSYSTEM: ReadonlySet<IntegrationCheckKey> = new Set([
  "ecosystem_loads",
  "ecosystem_spreads_apps_json",
  "snippet_current",
  "pm2_guard",
]);

/** Kept for callers of the 0.3.0 location; the rule itself lives with the patcher (PLAN/06 §3.2). */
export { snippetCurrent } from "./ecosystem.patch";

/** The old block is only worth a row when the file uses apps.json at all (POCO bug, R&D/07 §1). */
const MENTIONS_APPS_JSON = /apps\.json|\.\/apps["']/;

const check = (key: IntegrationCheckKey, ok: boolean, bad: "warning" | "error", params: JobParams = {}) =>
  ({ key, state: ok ? "ok" : bad, params, detail: null }) as IntegrationCheck;

/** `pm2_auto_exit` params: `{ pending: 1 }` when the run script changed after runit pm2 last started (PLAN/06 F4). */
async function autoExitParams(ctx: FixCtx, runPath: string): Promise<JobParams> {
  // ponytail: any edit of the run script (a comment too) counts as pending; acceptable per PLAN/06 §3.6.
  const sup = await ctx.system.runit.supervise("pm2");
  if (sup?.state !== "run" || sup.uptimeSec === undefined) return {};
  const startedAt = Date.now() - sup.uptimeSec * MS_PER_SEC;
  return statSync(runPath).mtimeMs > startedAt ? { pending: 1 } : {};
}

async function compute(ctx: FixCtx, probe: EcosystemProbe): Promise<Integration> {
  const p = sitePaths(ctx);
  const eco = readTextOrNull(p.ecosystem);
  const appsText = readTextOrNull(p.appsJson);
  let apps: Record<string, unknown>[] | null = null;
  try {
    apps = appsText === null ? null : parseApps(appsText);
  } catch {
    apps = null; // reported as apps_json invalid below
  }
  const runnable = runnablePanelApps(ctx);
  const panelNames = new Set((apps ?? []).map((a) => a.name as string));
  const snippet = snippetCurrent(eco);
  let tunnelId: string | null = null;
  let tunnelDetail: string | null = null;
  try {
    const cfg = readTextOrNull(p.cfConfig);
    tunnelId = cfg === null ? null : readTunnelId(cfg);
    if (cfg === null) tunnelDetail = `${p.cfConfig} not found`;
  } catch (e) {
    tunnelDetail = (e as Error).message;
  }
  let pm2Reason: string | null = null;
  try {
    await ctx.system.pm2.list();
  } catch (e) {
    pm2Reason = e instanceof Pm2UnavailableError ? e.reason : (e as Error).message;
  }
  // The flag must be on a command line: the shipped script also names it in a comment.
  const runPath = runScriptPath(ctx);
  const svRun = readTextOrNull(runPath);
  const autoExitOff = (svRun ?? "")
    .split("\n")
    .some((l) => !l.trimStart().startsWith("#") && l.includes("--no-auto-exit"));
  const tokenSet = describeSetting(ctx.db, "cloudflare.api_token").isSet;
  // The probe serves a sentinel as apps.json: it reaching the list proves the spread/block (debat C3).
  const spreads = probe.ok && probe.spreads;
  const noSites: JobParams = !spreads && (apps ?? []).length === 0 ? { noSites: 1 } : {};
  const loads = check("ecosystem_loads", probe.ok, "error", probe.ok ? {} : { reason: probe.reason });
  if (!probe.ok) loads.detail = probe.detail;
  const checks: IntegrationCheck[] = [
    check("sites_dir", existsSync(p.sitesDir), "error", { path: p.sitesDir }),
    check(
      "apps_json",
      apps !== null,
      "error",
      apps !== null ? {} : { reason: appsText === null ? "missing" : "invalid" },
    ),
    check("ecosystem_file", eco !== null, "error", { path: p.ecosystem }),
    loads,
    check("ecosystem_spreads_apps_json", spreads, "error", noSites),
    check("snippet_current", snippet, "error"),
    check("apps_entries_runnable", runnable.length === (apps ?? []).length, snippet ? "warning" : "error", {
      count: (apps ?? []).length - runnable.length,
    }),
    check("pm2_runtime", pm2Reason === null, "error", pm2Reason ? { reason: pm2Reason } : {}),
    check("pm2_auto_exit", autoExitOff, "warning", autoExitOff ? await autoExitParams(ctx, runPath) : {}),
    check("pm2_guard", probe.ok && probe.names.some((n) => !panelNames.has(n)), "warning"),
    { ...check("tunnel", tunnelId !== null, "error"), detail: tunnelDetail },
    check("cloudflare_token", tokenSet, "warning"),
  ];
  // Without the file, "cannot load / old block / no guard" only restate ecosystem_file: show the root cause alone.
  // `ready` stays false: the hidden READY_KEYS are missing, so they do not count as ok. A file that never names
  // apps.json has no "old block" either: ecosystem_spreads_apps_json alone is the root cause.
  const noOldBlock = eco !== null && !MENTIONS_APPS_JSON.test(eco);
  const moot = (k: IntegrationCheckKey) =>
    (eco === null && NEEDS_ECOSYSTEM.has(k)) || (k === "snippet_current" && noOldBlock);
  const shown = checks.filter((c) => !moot(c.key));
  const failing = shown.filter((c) => c.state !== "ok");
  const ok = (k: IntegrationCheckKey) =>
    shown.find((c) => c.key === k)?.state === "ok" || (k === "snippet_current" && noOldBlock);
  return {
    ready: READY_KEYS.every(ok),
    checks: shown,
    snippet: ecosystemBlock(prefixOf(ctx)),
    ecosystemPath: p.ecosystem,
    appsJsonPath: p.appsJson,
    appNames: probe.ok ? [...new Set([...probe.names, ...runnable])] : [],
    checkedAt: new Date().toISOString(),
    fixes: await fixAvailability(ctx, new Set(failing.map((c) => c.key)), probe),
    lastFix: lastFixOf(ctx),
    // 0.2.x fields, read by the web until its Persiapan card lands (W5).
    ecosystemIncludesAppsJson: spreads,
    appsJsonExists: appsText !== null,
    tunnelId,
    cloudflareTokenSet: tokenSet,
    issues: failing.map((c) => `${c.key}: ${c.state}${c.detail ? ` (${c.detail})` : ""}`),
  };
}

/** Integration status with a ≤ 30 s cache keyed by the sites dir (a sites.dir change recomputes). */
export function createIntegration(ctx: FixCtx) {
  let cache: { at: number; dir: string; value: Integration; probe: EcosystemProbe } | null = null;

  async function refresh(): Promise<Integration> {
    const p = sitePaths(ctx);
    const probe = await probeEcosystem(ctx.system, p.ecosystem, p.sitesDir);
    const value = await compute(ctx, probe);
    cache = { at: Date.now(), dir: p.sitesDir, value, probe };
    return value;
  }
  const fresh = () => cache && Date.now() - cache.at < CACHE_MS && cache.dir === sitePaths(ctx).sitesDir;

  return {
    /** GET /integration: cached status, no writes. */
    get: async (): Promise<Integration> => (fresh() ? (cache?.value as Integration) : refresh()),
    /** Recomputes now (after a fix wrote a file). */
    refresh,
    /** POST /integration/verify: creates apps.json `[]` when missing (D3), then re-checks. */
    async verify(): Promise<Integration> {
      ensureAppsJson(ctx);
      return refresh();
    },
    /** Names of `env` keys of pm2 entry `app` in the ecosystem (they override .env, E6b); [] when unknown. */
    async envKeysOf(app: string): Promise<string[]> {
      if (!fresh()) await refresh();
      const probe = cache?.probe;
      return probe?.ok ? (probe.envKeys[app] ?? []) : [];
    },
    /** Sync 0.2.x view for /dev/setup: the last computed status, else a text-only guess (no probe). */
    snapshot(): Pick<Integration, "ecosystemIncludesAppsJson" | "ready"> {
      if (cache) return cache.value;
      const eco = readTextOrNull(sitePaths(ctx).ecosystem);
      return { ecosystemIncludesAppsJson: eco !== null && /apps\.json/.test(eco), ready: false };
    },
  };
}

/** The integration instance type. */
export type IntegrationService = ReturnType<typeof createIntegration>;
