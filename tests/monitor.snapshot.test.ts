import { describe, expect, test } from "bun:test";
import { createSnapshotCache, MAX_STALE_MS, type SnapshotSources } from "@/server/monitor/monitor.snapshot";
import { KeyMismatchError } from "@/server/settings.service";
import { type Pm2Proc, Pm2UnavailableError } from "@/server/system/system.types";
import type { BackupStatus } from "@/shared/backup.types";
import type { DeviceInfo, Service } from "@/shared/panel.types";
import type { SecurityStatus } from "@/shared/security.types";

// test-only fixtures
const DEVICE = { battery: null, cpuCores: 8, memory: { totalMb: 4000, availableMb: 1000 } } as unknown as DeviceInfo;
const svc = (name: string, pid: number): Service =>
  ({ name, state: "run", pid, uptimeSec: 100, wantUp: true, protected: false }) as Service;
const proc = (name: string, status = "online") => ({ name, status, restarts: 0, port: 3000 }) as unknown as Pm2Proc;

function harness() {
  let t = 1_000_000;
  const calls = { apps: 0, services: 0 };
  let release: (() => void) | null = null;
  let appsImpl: () => Promise<Pm2Proc[]> = async () => [proc("blog")];
  let backupImpl: () => BackupStatus = () => ({ configured: true }) as BackupStatus;
  const sources: SnapshotSources = {
    device: async () => DEVICE,
    services: async () => {
      calls.services++;
      return [svc("sshd", 10 + calls.services)];
    },
    apps: () => {
      calls.apps++;
      return appsImpl();
    },
    ingress: async () => [],
    backup: () => backupImpl(),
    security: () => ({}) as SecurityStatus,
  };
  const cache = createSnapshotCache(sources, () => t);
  return {
    cache,
    calls,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
    hangApps: () => {
      appsImpl = () =>
        new Promise((r) => {
          release = () => r([proc("blog", "errored")]);
        });
    },
    release: () => release?.(),
    failApps: (e: Error) => {
      appsImpl = async () => {
        throw e;
      };
    },
    failBackup: (e: Error) => {
      backupImpl = () => {
        throw e;
      };
    },
  };
}

describe("snapshot cache", () => {
  test("first read waits; every section carries its own `at`", async () => {
    const h = harness();
    const s = await h.cache.get();
    for (const sec of Object.values(s)) expect(sec).toMatchObject({ ok: true, at: h.now() });
    h.advance(6_000); // past the 5 s TTL, not the 15 s pm2 TTL
    const s2 = await h.cache.get();
    expect(h.calls).toEqual({ apps: 1, services: 2 });
    expect(s2.services.at).toBe(h.now());
    expect(s2.apps.at).toBe(s.apps.at);
  });

  test("single-flight: concurrent reads and refreshAll share one pm2 call", async () => {
    const h = harness();
    await h.cache.get();
    h.hangApps();
    h.advance(16_000);
    const reads = [h.cache.get(), h.cache.get(), h.cache.refreshAll()];
    const [first] = await Promise.all(reads.slice(0, 2)); // UI reads never wait for the hung jlist
    expect(first?.apps).toMatchObject({ ok: true, value: [{ status: "online" }] });
    expect(h.calls.apps).toBe(2);
    h.release();
    const after = await reads[2];
    expect(after?.apps).toMatchObject({ ok: true, value: [{ status: "errored" }], at: h.now() });
    expect(h.calls.apps).toBe(2);
  });

  test("a value older than MAX_STALE_MS waits for the refresh", async () => {
    const h = harness();
    await h.cache.get();
    h.advance(MAX_STALE_MS + 1);
    const s = await h.cache.get();
    expect(s.apps.at).toBe(h.now());
  });

  test("patch is visible at once and forces a refresh on the next read", async () => {
    const h = harness();
    await h.cache.get();
    h.cache.patch("apps", { ...proc("blog"), status: "stopped" });
    expect(h.cache.current().apps).toMatchObject({ ok: true, value: [{ name: "blog", status: "stopped" }] });
    await h.cache.get();
    expect(h.calls.apps).toBe(2);
    expect(h.cache.current().apps).toMatchObject({ value: [{ status: "online" }] });
  });

  test("failures keep the last value as stale; apps error names the pm2 reason, backup the error class", async () => {
    const h = harness();
    await h.cache.get();
    h.failApps(new Pm2UnavailableError("service_down"));
    h.failBackup(new KeyMismatchError("getSetting backup.s3_secret: bad tag"));
    const at = h.now();
    h.advance(20_000);
    const s = await h.cache.refreshAll();
    expect(s.apps).toMatchObject({ ok: false, at, stale: [{ name: "blog" }] });
    expect(s.apps.ok === false && s.apps.error).toContain("service_down");
    expect(s.backup.ok === false && s.backup.error).toContain("KeyMismatchError");
    expect(await h.cache.pm2Procs()).toMatchObject([{ name: "blog" }]); // stale list still served
  });

  test("pm2Procs rethrows the adapter error when nothing was ever read", async () => {
    const h = harness();
    h.failApps(new Pm2UnavailableError("no_daemon"));
    await expect(h.cache.pm2Procs()).rejects.toBeInstanceOf(Pm2UnavailableError);
    const s = await h.cache.get();
    expect(s.apps).toMatchObject({ ok: false, at: null, stale: null, error: "Pm2UnavailableError: no_daemon" });
  });
});
