import { describe, expect, test } from "bun:test";
import { BACKUP_STALE_MS, computeProblems, type ProblemInput } from "@/server/panel/overview.problems";
import type { BackupRun } from "@/shared/backup.types";
import type { App, DeviceInfo, Domain, Service } from "@/shared/panel.types";

const NOW = new Date("2026-11-26T12:00:00Z"); // test-only fixed clock
const GB = 1024 ** 3;
const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  battery: { percent: 80, charging: false, temperatureC: 30 },
  cpuCores: 8,
  memory: { totalMb: 8000, availableMb: 4000 },
  disk: { freeBytes: 50 * GB, totalBytes: 100 * GB },
  load: [0, 0, 0],
  uptimeSec: 1,
  ...over,
});
const run = (status: BackupRun["status"], ageMs = 0): BackupRun => ({
  id: "r1",
  trigger: "schedule",
  status,
  startedAt: new Date(NOW.getTime() - ageMs).toISOString(),
  finishedAt: null,
  items: [],
  error: null,
});
const healthy: ProblemInput = {
  services: [],
  apps: [],
  domains: [],
  device: device(),
  backup: { configured: true, running: false, lastRun: run("succeeded") },
  now: NOW,
};
const svc = (name: string, state: Service["state"], wantUp: boolean): Service => ({
  name,
  state,
  wantUp,
  pid: null,
  uptimeSec: null,
  protected: false,
});
const app = (name: string, status: App["status"]): App => ({
  name,
  status,
  pid: null,
  memoryMb: null,
  cpu: null,
  restarts: 0,
  uptimeSec: null,
  port: null,
});
const dom = (hostname: string, status: number | null, checked = true): Domain => ({
  hostname,
  service: "http://localhost:1",
  port: 1,
  app: null,
  health: { status, ms: 1, checkedAt: checked ? NOW.toISOString() : null },
});
const problems = (over: Partial<ProblemInput>) =>
  computeProblems({ ...healthy, ...over }).map((p) => [p.kind, p.target, p.severity]);

describe("overview problems", () => {
  test("healthy snapshot → none", () => {
    expect(computeProblems(healthy)).toEqual([]);
  });

  test("service: wantUp but not running → danger; intentionally down → none", () => {
    expect(
      problems({ services: [svc("sshd", "down", true), svc("crond", "down", false), svc("pm2", "run", true)] }),
    ).toEqual([["service", "sshd", "danger"]]);
  });

  test("app: errored → danger, stopped → warning, online → none", () => {
    expect(problems({ apps: [app("a", "errored"), app("b", "stopped"), app("c", "online")] })).toEqual([
      ["app", "a", "danger"],
      ["app", "b", "warning"],
    ]);
  });

  test("domain: unreachable/5xx → danger, 4xx → warning, 2xx/3xx or unchecked → none", () => {
    const domains = [
      dom("u.t", null),
      dom("e.t", 502),
      dom("f.t", 404),
      dom("ok.t", 200),
      dom("r.t", 301),
      dom("n.t", null, false),
    ];
    expect(problems({ domains })).toEqual([
      ["domain", "u.t", "danger"],
      ["domain", "e.t", "danger"],
      ["domain", "f.t", "warning"],
    ]);
  });

  test("backup: not configured / partial / stale / never → warning; failed → danger; running → none", () => {
    const b = (backup: Partial<ProblemInput["backup"]>) => problems({ backup: { ...healthy.backup, ...backup } });
    expect(b({ configured: false, lastRun: null })).toEqual([["backup", "backup", "warning"]]);
    expect(b({ lastRun: run("failed") })).toEqual([["backup", "backup", "danger"]]);
    expect(b({ lastRun: run("partial") })).toEqual([["backup", "backup", "warning"]]);
    expect(b({ lastRun: null })).toEqual([["backup", "backup", "warning"]]);
    expect(b({ lastRun: run("succeeded", BACKUP_STALE_MS + 1) })).toEqual([["backup", "backup", "warning"]]);
    expect(b({ lastRun: run("succeeded", BACKUP_STALE_MS - 1) })).toEqual([]);
    expect(b({ running: true, lastRun: run("failed") })).toEqual([]);
  });

  test("disk: <10% free → warning, <5% → danger", () => {
    const disk = (free: number) =>
      problems({ device: device({ disk: { freeBytes: free * GB, totalBytes: 100 * GB } }) });
    expect(disk(10)).toEqual([]);
    expect(disk(9)).toEqual([["disk", "disk", "warning"]]);
    expect(disk(4)).toEqual([["disk", "disk", "danger"]]);
  });

  test("battery: <20% not charging → warning (charging → none); ≥45 °C → warning", () => {
    const bat = (percent: number, charging: boolean, temperatureC = 30) =>
      problems({ device: device({ battery: { percent, charging, temperatureC } }) });
    expect(bat(19, false)).toEqual([["battery", "battery", "warning"]]);
    expect(bat(19, true)).toEqual([]);
    expect(bat(20, false)).toEqual([]);
    expect(bat(90, true, 45)).toEqual([["battery", "battery", "warning"]]);
    expect(problems({ device: device({ battery: null }) })).toEqual([]);
  });

  test("danger sorts before warning", () => {
    const list = computeProblems({ ...healthy, apps: [app("b", "stopped")], services: [svc("s", "down", true)] });
    expect(list.map((p) => p.severity)).toEqual(["danger", "warning"]);
    expect(list[0]?.message).toContain("s");
  });
});
