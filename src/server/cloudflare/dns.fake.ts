import { DnsConflictError, DnsNotConfiguredError, type SiteDnsProvider } from "./dns.types";

type FakeRecord = { recordId: string; target: string; managed: boolean };

/**
 * In-memory SiteDnsProvider for tests. `seedForeign` plants a record the panel did not create: pointing elsewhere
 * (→ DnsConflictError) or, given `target`, at a tunnel (accepted with `owned: false` when it is this tunnel).
 */
export function createFakeDnsProvider() {
  const records = new Map<string, FakeRecord>();
  let seq = 0;
  const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;
  const provider: Required<SiteDnsProvider> & {
    records: Map<string, FakeRecord>;
    seedForeign(hostname: string, target?: string): void;
  } = {
    records,
    seedForeign(hostname, target = "elsewhere.example") {
      records.set(hostname.toLowerCase(), { recordId: `foreign${++seq}`, target, managed: false });
    },
    async verify() {
      return { ok: true, message: "fake DNS provider" };
    },
    async inspect(hostname, tunnelId) {
      const r = records.get(hostname.trim().toLowerCase());
      if (!r) return "absent";
      if (r.managed) return "owned";
      return r.target === tunnelTarget(tunnelId) ? "same_tunnel" : "conflict";
    },
    async ensureTunnelCname(hostname, tunnelId) {
      const h = hostname.trim().toLowerCase();
      const target = tunnelTarget(tunnelId);
      const r = records.get(h);
      if (r && !r.managed) {
        if (r.target === target) return { recordId: r.recordId, created: false, owned: false };
        throw new DnsConflictError(`DNS record for ${h} already exists and was not created by the panel`);
      }
      if (r) {
        r.target = target;
        return { recordId: r.recordId, created: false, owned: true };
      }
      const recordId = `fake${++seq}`;
      records.set(h, { recordId, target, managed: true });
      return { recordId, created: true, owned: true };
    },
    async deleteManaged(hostname) {
      const h = hostname.trim().toLowerCase();
      if (records.get(h)?.managed) records.delete(h);
    },
  };
  return provider;
}

/**
 * `provider` that acts like the real one without a token: record calls throw DnsNotConfiguredError while `tokenSet()`
 * is false. Fake mode wraps its offline DNS in it, so "no token → cloudflared cert → fake zone" runs there too.
 */
export function tokenGated<P extends SiteDnsProvider>(provider: P, tokenSet: () => boolean): P {
  const gate = () => {
    if (!tokenSet()) throw new DnsNotConfiguredError("Cloudflare API token is not set (/dev settings)");
  };
  return {
    ...provider,
    async ensureTunnelCname(hostname: string, tunnelId: string, actorId?: string | null) {
      gate();
      return provider.ensureTunnelCname(hostname, tunnelId, actorId);
    },
    async deleteManaged(hostname: string, actorId?: string | null) {
      gate();
      return provider.deleteManaged(hostname, actorId);
    },
    ...(provider.inspect
      ? {
          async inspect(hostname: string, tunnelId: string) {
            gate();
            return (provider.inspect as NonNullable<SiteDnsProvider["inspect"]>)(hostname, tunnelId);
          },
        }
      : {}),
  };
}
