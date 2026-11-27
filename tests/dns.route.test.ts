// DNS step without an API token (PLAN/06 §6.4 B): CNAME via `cloudflared tunnel route dns` when cert.pem exists.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiteDnsProvider } from "@/server/cloudflare/dns.provider";
import { DnsNotConfiguredError } from "@/server/cloudflare/dns.types";
import { dnsEnsureStep } from "@/server/sites/site.steps";
import { type CloudflaredAdapter, DnsWrongZoneError, SystemError } from "@/server/system/system.types";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const TUNNEL = "00000000-0000-4000-8000-000000000000"; // test-only

const noToken = {
  ensureTunnelCname: mock(async () => {
    throw new DnsNotConfiguredError();
  }),
  deleteManaged: mock(async () => {}),
} as unknown as SiteDnsProvider;

/** cloudflared stub in a temp ~/.cloudflared, with or without cert.pem; `route` answers routeDns. */
function cf(cert: boolean, route: (host: string) => Promise<{ created: boolean }>) {
  const dir = mkdtempSync(join(tmpdir(), "panel-cf-"));
  dirs.push(dir);
  if (cert) writeFileSync(join(dir, "cert.pem"), "test-only");
  const routeDns = mock(async (_t: string, h: string) => route(h));
  return { adapter: { configPath: join(dir, "config.yml"), routeDns } as unknown as CloudflaredAdapter, routeDns };
}
const run = (hosts: string[], adapter: CloudflaredAdapter | undefined, owned = new Set<string>()) =>
  dnsEnsureStep(noToken, hosts, () => TUNNEL, owned, null, adapter).run({} as never);

describe("dnsEnsureStep without a token", () => {
  test("cert.pem present → routeDns per hostname → dns_routed, record not owned", async () => {
    const { adapter, routeDns } = cf(true, async () => ({ created: true }));
    const owned = new Set<string>();
    const out = await run(["blog.contoh.com", "www.contoh.com"], adapter, owned);
    expect(out).toEqual({ code: "dns_routed", params: { hostnames: "blog.contoh.com, www.contoh.com" } });
    expect(routeDns.mock.calls).toEqual([
      [TUNNEL, "blog.contoh.com"],
      [TUNNEL, "www.contoh.com"],
    ]);
    expect(owned.size).toBe(0); // dnsManaged false: only a token can delete it
  });

  test("cloudflared names another zone → dns_wrong_zone with the wrong fqdn, routing stops, job goes on", async () => {
    const { adapter, routeDns } = cf(true, async () => {
      throw new DnsWrongZoneError("blog.lain.com.contoh.com");
    });
    expect(await run(["blog.lain.com", "www.lain.com"], adapter)).toMatchObject({
      code: "dns_wrong_zone",
      skipped: true,
      params: { hostname: "blog.lain.com", fqdn: "blog.lain.com.contoh.com", hostnames: "blog.lain.com, www.lain.com" },
    });
    expect(routeDns).toHaveBeenCalledTimes(1);
  });

  test("cloudflared refuses (record exists) → dns_route_failed skipped, the job goes on", async () => {
    const { adapter } = cf(true, async () => {
      throw new SystemError("record with that host already exists");
    });
    expect(await run(["blog.contoh.com"], adapter)).toMatchObject({
      code: "dns_route_failed",
      skipped: true,
      params: { hostname: "blog.contoh.com" },
      detail: "record with that host already exists",
    });
  });

  test("no cert.pem → dns_no_token with the hostnames for the manual record card", async () => {
    const { adapter, routeDns } = cf(false, async () => ({ created: true }));
    expect(await run(["blog.contoh.com"], adapter)).toEqual({
      code: "dns_no_token",
      params: { hostnames: "blog.contoh.com" },
      skipped: true,
    });
    expect(routeDns).not.toHaveBeenCalled();
    expect((await run(["a.contoh.com"], undefined)).code).toBe("dns_no_token");
  });
});
