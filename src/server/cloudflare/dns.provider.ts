import { eq } from "drizzle-orm";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { dnsRecord } from "../db/schema";
import { log } from "../log.service";
import { getSetting } from "../settings.service";
import { type CfClient, type CfClientOptions, CloudflareApiError, createCfClient } from "./cloudflare.client";
import { DnsConflictError, DnsNotConfiguredError, type DnsProvider } from "./dns.types";

export { createFakeDnsProvider } from "./dns.fake";

/** Comment set on every record the panel creates (visible in the Cloudflare dashboard). */
export const MANAGED_COMMENT = "managed by panel-termux";
const ZONE_CACHE_MS = 60_000;
const ZONES_PER_PAGE = 50; // API maximum for GET /zones
const HTTP_NOT_FOUND = 404;

/** Thrown when none of the token's zones is a suffix of the hostname. */
export class DnsZoneNotFoundError extends Error {}

/** db + data secret (to read the encrypted token); the rest is for tests. */
export type DnsProviderDeps = { db: Db; secret: string } & CfClientOptions;

type Zone = { id: string; name: string };
type CfRecord = { id: string; type: string; name: string; content: string };

export const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;

/** Cloudflare-backed DnsProvider. Reads the token on every call so a /dev change applies without restart. */
export function createDnsProvider(deps: DnsProviderDeps): DnsProvider {
  const { db, secret } = deps;
  let zoneCache: { token: string; at: number; zones: Zone[] } | null = null;

  type Session = { cf: CfClient; token: string };
  function session(): Session {
    const token = getSetting({ db, secret }, "cloudflare.api_token");
    if (!token) throw new DnsNotConfiguredError("Cloudflare API token is not set (/dev settings)");
    return { cf: createCfClient(token, deps), token };
  }

  async function zones({ cf, token }: Session): Promise<Zone[]> {
    if (zoneCache && zoneCache.token === token && Date.now() - zoneCache.at < ZONE_CACHE_MS) return zoneCache.zones;
    const all: Zone[] = [];
    for (let page = 1, pages = 1; page <= pages; page++) {
      const r = await cf.request<Zone[]>("list zones", "GET", `/zones?per_page=${ZONES_PER_PAGE}&page=${page}`);
      all.push(...r.result.map(({ id, name }) => ({ id, name: name.toLowerCase() })));
      pages = r.result_info?.total_pages ?? 1;
    }
    zoneCache = { token, at: Date.now(), zones: all };
    return all;
  }

  /** Zone whose name is the longest suffix of hostname (label-aligned). */
  async function zoneFor(s: Session, hostname: string): Promise<Zone> {
    const match = (await zones(s))
      .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!match) throw new DnsZoneNotFoundError(`no Cloudflare zone accessible to the token matches ${hostname}`);
    return match;
  }

  const rowOf = (hostname: string) => db.select().from(dnsRecord).where(eq(dnsRecord.hostname, hostname)).get();

  return {
    async verify() {
      try {
        const s = session();
        const accountId = getSetting({ db, secret }, "cloudflare.account_id");
        // Account-owned tokens only verify on the account endpoint; user tokens on /user/tokens/verify.
        const path = accountId ? `/accounts/${accountId}/tokens/verify` : "/user/tokens/verify";
        const r = await s.cf.request<{ status: string }>("verify token", "GET", path);
        if (r.result.status !== "active") return { ok: false, message: `token status is ${r.result.status}` };
        zoneCache = null;
        const n = (await zones(s)).length;
        if (n === 0) return { ok: false, message: "token is active but has access to no zones (needs Zone:Read)" };
        return { ok: true, message: `token is active; ${n} zone(s) accessible` };
      } catch (e) {
        // Errors here carry operation + Cloudflare code, never the token; surface them to /dev as-is.
        return { ok: false, message: (e as Error).message };
      }
    },

    async ensureTunnelCname(rawHostname, tunnelId) {
      const hostname = rawHostname.trim().toLowerCase();
      const target = tunnelTarget(tunnelId);
      const s = session();
      const { cf } = s;
      const zone = await zoneFor(s, hostname);
      const existing = (
        await cf.request<CfRecord[]>(
          `list records ${hostname}`,
          "GET",
          `/zones/${zone.id}/dns_records?name.exact=${encodeURIComponent(hostname)}`,
        )
      ).result;
      const row = rowOf(hostname);

      if (existing.length > 0) {
        const mine = row && existing.length === 1 && existing[0]?.id === row.recordId ? existing[0] : undefined;
        if (mine?.type !== "CNAME") {
          throw new DnsConflictError(`DNS record for ${hostname} already exists and was not created by the panel`);
        }
        if (mine.content !== target) {
          // Panel-owned record pointing at an old tunnel: repoint it.
          await cf.request(`update record ${hostname}`, "PATCH", `/zones/${zone.id}/dns_records/${mine.id}`, {
            content: target,
            proxied: true,
          });
          log.info(`[dns] repointed ${hostname} to tunnel ${tunnelId}`);
        }
        return { recordId: mine.id, created: false };
      }

      const created = await cf.request<CfRecord>(`create record ${hostname}`, "POST", `/zones/${zone.id}/dns_records`, {
        type: "CNAME",
        name: hostname,
        content: target,
        proxied: true,
        ttl: 1, // 1 = automatic (required value for proxied records)
        comment: MANAGED_COMMENT,
      });
      const recordId = created.result.id;
      db.insert(dnsRecord)
        .values({ hostname, zoneId: zone.id, recordId })
        .onConflictDoUpdate({ target: dnsRecord.hostname, set: { zoneId: zone.id, recordId } })
        .run();
      recordAudit(db, { actorId: null, action: "dns.create", target: hostname, meta: { zoneId: zone.id, recordId } });
      log.info(`[dns] created CNAME ${hostname} -> tunnel ${tunnelId}`);
      return { recordId, created: true };
    },

    async deleteManaged(rawHostname) {
      const hostname = rawHostname.trim().toLowerCase();
      const row = rowOf(hostname);
      if (!row) return; // not panel-owned: never touch it
      const { cf } = session();
      try {
        await cf.request(`delete record ${hostname}`, "DELETE", `/zones/${row.zoneId}/dns_records/${row.recordId}`);
      } catch (e) {
        if (!(e instanceof CloudflareApiError && e.status === HTTP_NOT_FOUND)) throw e;
        log.warn(`[dns] record for ${hostname} already gone in Cloudflare; dropping ownership row`);
      }
      db.delete(dnsRecord).where(eq(dnsRecord.hostname, hostname)).run();
      recordAudit(db, { actorId: null, action: "dns.delete", target: hostname, meta: { zoneId: row.zoneId } });
      log.info(`[dns] deleted CNAME ${hostname}`);
    },
  };
}
