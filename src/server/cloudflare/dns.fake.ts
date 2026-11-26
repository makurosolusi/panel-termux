import { DnsConflictError, type DnsProvider } from "./dns.types";

type FakeRecord = { recordId: string; target: string; managed: boolean };

/** In-memory DnsProvider for tests. `seedForeign` plants a record the panel did not create (→ DnsConflictError). */
export function createFakeDnsProvider() {
  const records = new Map<string, FakeRecord>();
  let seq = 0;
  const provider: DnsProvider & {
    records: Map<string, FakeRecord>;
    seedForeign(hostname: string): void;
  } = {
    records,
    seedForeign(hostname) {
      records.set(hostname.toLowerCase(), { recordId: `foreign${++seq}`, target: "elsewhere.example", managed: false });
    },
    async verify() {
      return { ok: true, message: "fake DNS provider" };
    },
    async ensureTunnelCname(hostname, tunnelId) {
      const h = hostname.trim().toLowerCase();
      const target = `${tunnelId}.cfargotunnel.com`;
      const r = records.get(h);
      if (r && !r.managed)
        throw new DnsConflictError(`DNS record for ${h} already exists and was not created by the panel`);
      if (r) {
        r.target = target;
        return { recordId: r.recordId, created: false };
      }
      const recordId = `fake${++seq}`;
      records.set(h, { recordId, target, managed: true });
      return { recordId, created: true };
    },
    async deleteManaged(hostname) {
      const h = hostname.trim().toLowerCase();
      if (records.get(h)?.managed) records.delete(h);
    },
  };
  return provider;
}
