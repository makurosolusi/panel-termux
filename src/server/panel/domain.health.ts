// Domain list of GET /panel/domains and the overview: ingress rules + pm2 apps + the sampler's stored checks.
import type { Domain } from "../../shared/panel.types";
import type { IngressRule, Pm2Proc } from "../system/system.types";
import { isProbeFailure } from "./overview.problems";

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
