import type { App, ControlAction, DatabaseInfo } from "../../shared/panel.types";
import type { IngressRule, RunitService, SystemAdapters } from "./system.types";

/** Options for the fake adapters; `delayMs` slows control actions (lets tests overlap two clicks). */
export type FakeOptions = { delayMs?: number };

const MS_PER_SEC = 1000;
const GB = 1024 ** 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FakeSvc = { name: string; up: boolean; pid: number; since: number };
type FakeApp = Omit<App, "uptimeSec"> & { since: number };

const logLines = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z ${name}: demo line ${i + 1}`,
  );

/** In-memory demo system for development on a non-Termux host and for tests; control actions mutate state. */
export function createFakeSystem({ delayMs = 0 }: FakeOptions = {}): SystemAdapters {
  const t0 = Date.now();
  let nextPid = 4000;
  const svcs: FakeSvc[] = ["cloudflared", "crond", "panel", "pm2", "postgres", "sshd"].map((name, i) => ({
    name,
    up: name !== "crond",
    pid: 1000 + i,
    since: t0 - (i + 1) * 3600 * MS_PER_SEC,
  }));
  const apps: FakeApp[] = [
    { name: "adminneo", status: "online", pid: 2001, memoryMb: 61.2, cpu: 0.3, restarts: 0, port: 3006, since: t0 },
    { name: "demo-api", status: "stopped", pid: null, memoryMb: null, cpu: null, restarts: 4, port: 3007, since: t0 },
    {
      name: "makuro-solusi",
      status: "online",
      pid: 2002,
      memoryMb: 88.5,
      cpu: 1.1,
      restarts: 2,
      port: 3005,
      since: t0,
    },
    { name: "pm2-logrotate", status: "online", pid: 2003, memoryMb: 40, cpu: 0, restarts: 0, port: null, since: t0 },
  ];
  const ingress: IngressRule[] = [
    { hostname: "db.example.test", service: "http://localhost:3006", port: 3006 },
    { hostname: "old.example.test", service: "http://localhost:3999", port: 3999 },
    { hostname: "solusi.example.test", service: "http://localhost:3005", port: 3005 },
  ];
  const databases: DatabaseInfo[] = [
    { name: "adminneo", owner: "postgres", sizeBytes: 8_000_000 },
    { name: "solusi", owner: "solusi", sizeBytes: 24_500_000 },
  ];

  const svcView = (s: FakeSvc): RunitService => ({
    name: s.name,
    state: s.up ? "run" : "down",
    pid: s.up ? s.pid : null,
    uptimeSec: s.up ? Math.floor((Date.now() - s.since) / MS_PER_SEC) : null,
    wantUp: s.up,
  });
  const appView = ({ since, ...a }: FakeApp): App => ({
    ...a,
    uptimeSec: a.status === "online" ? Math.floor((Date.now() - since) / MS_PER_SEC) : null,
  });
  const apply = (target: { up: boolean; pid: number; since: number }, action: ControlAction) => {
    if (action === "stop") target.up = false;
    else if (action === "restart" || !target.up) Object.assign(target, { up: true, pid: nextPid++, since: Date.now() });
  };

  return {
    mode: "fake",
    runit: {
      list: async () => svcs.map(svcView),
      async control(name, action) {
        const s = svcs.find((x) => x.name === name);
        if (!s) return null;
        await sleep(delayMs);
        apply(s, action);
        return svcView(s);
      },
      readLog: async (name, n) => (svcs.some((x) => x.name === name) ? logLines(name, n) : null),
    },
    pm2: {
      list: async () => apps.map(appView),
      async control(name, action) {
        const a = apps.find((x) => x.name === name);
        if (!a) return null;
        await sleep(delayMs);
        const st = { up: a.status === "online", pid: a.pid ?? 0, since: a.since };
        apply(st, action);
        if (action === "restart") a.restarts++;
        Object.assign(
          a,
          st.up
            ? { status: "online", pid: st.pid, since: st.since, memoryMb: 50, cpu: 0.5 }
            : {
                status: "stopped",
                pid: null,
                memoryMb: null,
                cpu: null,
              },
        );
        return appView(a);
      },
      readLog: async (name, stream, n) =>
        apps.some((x) => x.name === name) ? logLines(`${name}[${stream}]`, n) : null,
    },
    cloudflared: {
      listIngress: async () => ingress.map((r) => ({ ...r })),
      probe: async (hostname) => (hostname.startsWith("old.") ? { status: 502, ms: 40 } : { status: 200, ms: 12 }),
    },
    postgres: { listDatabases: async () => databases.map((d) => ({ ...d })) },
    device: {
      read: async () => ({
        battery: { percent: 76, charging: true, temperatureC: 31.5 },
        memory: { totalMb: 11_776, availableMb: 3_788 },
        disk: { freeBytes: 182 * GB, totalBytes: 249 * GB },
        load: [1.2, 0.9, 0.7],
        uptimeSec: Math.floor((Date.now() - t0) / MS_PER_SEC) + 86_400,
      }),
    },
  };
}
