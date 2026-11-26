// Domain list of GET /panel/domains and the overview: ingress rules + pm2 apps + the sampler's stored checks.
import type { App, Domain } from "../../shared/panel.types";
import { PM2_GUARD_NAME } from "../../shared/site.types";
import { isProbeFailure } from "../monitor/monitor.state";
import { toApp } from "../system/pm2.termux";
import type { IngressRule, Pm2Proc } from "../system/system.types";

/** Checks shown per domain in the heartbeat strip (PLAN/02 §3.2 `recent`). */
export const RECENT_CHECKS = 30;

/** One stored probe (check_result row) as domain health needs it; `at` = epoch ms. */
export type StoredCheck = {
  hostname: string;
  at: number;
  status: number | null;
  ms: number | null;
  localStatus: number | null;
};

/**
 * Domains with health from the newest stored checks (oldest first per host). `failures` = trailing failed probes
 * (no answer or 5xx), like the sampler's streak; a host never checked has all-null health ("Belum dicek").
 */
export function buildDomains(
  rules: IngressRule[],
  apps: Pick<Pm2Proc, "name" | "port" | "site">[],
  checks: StoredCheck[],
  panelPort: number | null,
): Domain[] {
  const byHost = new Map<string, StoredCheck[]>();
  for (const c of checks) byHost.set(c.hostname, [...(byHost.get(c.hostname) ?? []), c]);
  return rules.map((r) => {
    const list = (byHost.get(r.hostname) ?? []).slice(-RECENT_CHECKS);
    const last = list.at(-1);
    let failures = 0;
    for (let i = list.length - 1; i >= 0 && isProbeFailure((list[i] as StoredCheck).status); i--) failures++;
    const app = r.port === null ? undefined : apps.find((a) => a.port === r.port);
    const target = r.port === null ? "none" : r.port === panelPort ? "panel" : app ? "app" : "other";
    return {
      ...r,
      app: app?.name ?? null,
      site: app?.site ?? null,
      target,
      health: {
        status: last?.status ?? null,
        ms: last?.ms ?? null,
        checkedAt: last ? new Date(last.at).toISOString() : null,
        failures,
        local: last?.localStatus ?? null,
      },
      recent: list.map((c) => ({ at: new Date(c.at).toISOString(), status: c.status })),
    };
  });
}

/** Site row fields that `siteApps` joins onto pm2 apps (`app` null = app named like the site). */
export type SiteLink = { name: string; app: string | null; port: number };

/**
 * pm2 apps as the UI sees them: pm2-guard hidden everywhere (B24, D-W9-1), each with its site. A panel site's pm2
 * entry has no env PORT (`.env` is read by its run script, E6b), so its port falls back to the site's: Aplikasi shows
 * it and its domains link to the site instead of "Layanan lain" (QA N8).
 */
export function siteApps(procs: readonly Pm2Proc[], sites: readonly SiteLink[]): App[] {
  return procs
    .filter((p) => p.name !== PM2_GUARD_NAME)
    .map((p) => {
      const s = sites.find((x) => (x.app ?? x.name) === p.name);
      return { ...toApp(p), port: p.port ?? s?.port ?? null, site: s?.name ?? null };
    });
}
