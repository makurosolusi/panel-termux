// Integration status of pm2 + cloudflared for panel-managed sites (PLAN/03 §3.6): checks, snippet, 30 s cache.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Integration, IntegrationCheck, IntegrationCheckKey, JobParams } from "../../shared/site.types";
import { termuxPrefix } from "../exec/termux.exec";
import { describeSetting } from "../settings.service";
import { Pm2UnavailableError } from "../system/system.types";
import { ensureAppsJson, entryBinary, parseApps } from "./apps.file";
import { type EcosystemProbe, probeEcosystem } from "./ecosystem.probe";
import { readTunnelId } from "./ingress.editor";
import { type SiteCtx, sitePaths } from "./site.checks";
import { readTextOrNull } from "./site.files";

/** The block the owner pastes above `module.exports` (plus `...panelApps,` last in `apps`). Exact text, lab E1e/E5. */
export const ECOSYSTEM_SNIPPET = `// Panel Termux: situs buatan panel tercatat di apps.json (dikelola panel, jangan diedit tangan).
// Aman bila apps.json belum ada, kosong, atau rusak; entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi.
const panelApps = (() => {
  try {
    const fs = require("fs");
    const path = require("path");
    const list = require("./apps.json");
    return Array.isArray(list)
      ? list.filter(
          (a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")),
        )
      : [];
  } catch (e) {
    console.error(\`[ecosystem] apps.json dilewati: \${e.message}\`);
    return [];
  }
})();
`;

const CACHE_MS = 30_000;
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
/** Snippet text is current when it has the panelApps block with the existsSync filter (B18). */
export const snippetCurrent = (eco: string | null) => eco !== null && /panelApps/.test(eco) && /existsSync/.test(eco);

const check = (key: IntegrationCheckKey, ok: boolean, bad: "warning" | "error", params: JobParams = {}) =>
  ({ key, state: ok ? "ok" : bad, params, detail: null }) as IntegrationCheck;

async function compute(ctx: SiteCtx, probe: EcosystemProbe): Promise<Integration> {
  const p = sitePaths(ctx);
  const eco = readTextOrNull(p.ecosystem);
  const appsText = readTextOrNull(p.appsJson);
  let apps: Record<string, unknown>[] | null = null;
  try {
    apps = appsText === null ? null : parseApps(appsText);
  } catch {
    apps = null; // reported as apps_json invalid below
  }
  const runnable = (apps ?? []).filter((a) => entryBinary(a, p.sitesDir).every((f) => existsSync(f)));
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
  const autoExitOff = (run: string | null) =>
    (run ?? "").split("\n").some((l) => !l.trimStart().startsWith("#") && l.includes("--no-auto-exit"));
  const svRun = readTextOrNull(join(ctx.system.prefix ?? termuxPrefix(), "var", "service", "pm2", "run"));
  const tokenSet = describeSetting(ctx.db, "cloudflare.api_token").isSet;
  const spreads = probe.ok && probe.loadedAppsJson && runnable.every((a) => probe.names.includes(a.name as string));
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
    check("ecosystem_spreads_apps_json", spreads, "error"),
    check("snippet_current", snippet, "error"),
    check("apps_entries_runnable", runnable.length === (apps ?? []).length, snippet ? "warning" : "error", {
      count: (apps ?? []).length - runnable.length,
    }),
    check("pm2_runtime", pm2Reason === null, "error", pm2Reason ? { reason: pm2Reason } : {}),
    check("pm2_auto_exit", autoExitOff(svRun), "warning"),
    check("pm2_guard", probe.ok && probe.names.some((n) => !panelNames.has(n)), "warning"),
    { ...check("tunnel", tunnelId !== null, "error"), detail: tunnelDetail },
    check("cloudflare_token", tokenSet, "warning"),
  ];
  // Without the file, "cannot load / old block / no guard" only restate ecosystem_file: show the root cause alone.
  // `ready` stays false: the hidden READY_KEYS are missing, so they do not count as ok.
  const shown = eco === null ? checks.filter((c) => !NEEDS_ECOSYSTEM.has(c.key)) : checks;
  const failing = shown.filter((c) => c.state !== "ok");
  return {
    ready: READY_KEYS.every((k) => shown.find((c) => c.key === k)?.state === "ok"),
    checks: shown,
    snippet: ECOSYSTEM_SNIPPET,
    ecosystemPath: p.ecosystem,
    appsJsonPath: p.appsJson,
    appNames: probe.ok ? probe.names : [],
    checkedAt: new Date().toISOString(),
    // 0.2.x fields, read by the web until its Persiapan card lands (W5).
    ecosystemIncludesAppsJson: spreads,
    appsJsonExists: appsText !== null,
    tunnelId,
    cloudflareTokenSet: tokenSet,
    issues: failing.map((c) => `${c.key}: ${c.state}${c.detail ? ` (${c.detail})` : ""}`),
  };
}

/** Integration status with a ≤ 30 s cache keyed by the sites dir (a sites.dir change recomputes). */
export function createIntegration(ctx: SiteCtx) {
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
