import type { DomainHealth } from "../../shared/panel.types";
import type { ProbeResult } from "../system/system.types";

/** How long a hostname's check result is reused. */
export const HEALTH_TTL_MS = 60_000;

type Entry = { at: number; result: Promise<DomainHealth> };

const isProbeable = (hostname: string) => !hostname.includes("*");

/**
 * Health cache: `check(hosts)` returns each host's last result, re-probing stale/missing ones in parallel.
 * Concurrent callers share one in-flight probe per host. Wildcard hostnames are never probed.
 */
export function createHealthCache(probe: (hostname: string) => Promise<ProbeResult>, now = () => Date.now()) {
  const cache = new Map<string, Entry>();
  const empty: DomainHealth = { status: null, ms: null, checkedAt: null };
  return async function check(hostnames: string[]): Promise<Map<string, DomainHealth>> {
    const t = now();
    const pending = hostnames.map(async (h): Promise<[string, DomainHealth]> => {
      if (!isProbeable(h)) return [h, empty];
      let e = cache.get(h);
      if (!e || t - e.at > HEALTH_TTL_MS) {
        e = { at: t, result: probe(h).then((r) => ({ ...r, checkedAt: new Date(now()).toISOString() })) };
        cache.set(h, e);
      }
      return [h, await e.result];
    });
    return new Map(await Promise.all(pending));
  };
}
