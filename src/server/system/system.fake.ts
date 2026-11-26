import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControlAction } from "../../shared/panel.types";
import { createTarArchive } from "./archive.tar";
import { createTermuxCloudflared } from "./cloudflared.termux";
import { createFakePm2, type FakePm2Behaviour } from "./pm2.fake";
import { createFakePostgres } from "./postgres.fake";
import type { RunitService, SystemAdapters } from "./system.types";

/**
 * Options for the fake adapters. `delayMs` slows control actions (lets tests overlap two clicks);
 * `home` = sandbox HOME for site files (default: a fresh temp dir); `listeningPorts` = ports that "accept" TCP;
 * `supervisorDown` = runit `pm2` starts down (pm2 unavailable); `exitsOnZeroAppsAtStart` = starting runit `pm2`
 * with no apps leaves it down (pm2-runtime auto-exit, lab E4); `panelPid` = pid in the fake `panel/supervise/pid`
 * (pass `process.pid` to look supervised).
 */
export type FakeOptions = FakePm2Behaviour & {
  delayMs?: number;
  home?: string;
  listeningPorts?: number[];
  supervisorDown?: boolean;
  exitsOnZeroAppsAtStart?: boolean;
  panelPid?: number;
};

/** Demo tunnel config seeded into the sandbox when absent (real files are only touched in termux mode). */
export const FAKE_TUNNEL_ID = "00000000-0000-4000-8000-000000000000";
const FAKE_CONFIG = `tunnel: ${FAKE_TUNNEL_ID}
credentials-file: /fake/.cloudflared/${FAKE_TUNNEL_ID}.json

ingress:
  - hostname: db.contoh.test
    service: http://localhost:3006
  - hostname: old.contoh.test
    service: http://localhost:3999
  - hostname: solusi.contoh.test
    service: http://localhost:3005
  - service: http_status:404
`;
const FAKE_ECOSYSTEM = `// hand-written entries live here; panel-managed ones come from apps.json
module.exports = { apps: [...require("./apps.json")] };
`;

function seedSandbox(home: string): void {
  const cfDir = join(home, ".cloudflared");
  const sitesDir = join(home, "sites");
  mkdirSync(cfDir, { recursive: true });
  mkdirSync(sitesDir, { recursive: true });
  if (!existsSync(join(cfDir, "config.yml"))) writeFileSync(join(cfDir, "config.yml"), FAKE_CONFIG);
  if (!existsSync(join(sitesDir, "ecosystem.config.js")))
    writeFileSync(join(sitesDir, "ecosystem.config.js"), FAKE_ECOSYSTEM);
}

/** What the fake `cloudflared ingress validate` accepts: parseable YAML whose last rule is a catch-all. */
async function fakeValidate(path: string): Promise<{ ok: boolean; message: string }> {
  try {
    const doc = Bun.YAML.parse(await Bun.file(path).text()) as { ingress?: { hostname?: unknown }[] } | null;
    const last = doc?.ingress?.at(-1);
    if (!last || last.hostname !== undefined) return { ok: false, message: "last ingress rule must be a catch-all" };
    return { ok: true, message: "OK" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const MS_PER_SEC = 1000;
const GB = 1024 ** 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FakeSvc = { name: string; up: boolean; pid: number; since: number };

const logLines = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z ${name}: demo line ${i + 1}`,
  );

/** In-memory demo system for development on a non-Termux host and for tests; control actions mutate state. */
export function createFakeSystem({
  delayMs = 0,
  home = mkdtempSync(join(tmpdir(), "panel-fake-home-")),
  listeningPorts = [],
  supervisorDown = false,
  exitsOnZeroAppsAtStart = false,
  panelPid,
  ...behaviour
}: FakeOptions = {}): SystemAdapters {
  seedSandbox(home);
  const cloudflared = createTermuxCloudflared(join(home, ".cloudflared", "config.yml"));
  const t0 = Date.now();
  let pid = 4000;
  const nextPid = () => pid++;
  const svcs: FakeSvc[] = ["cloudflared", "crond", "panel", "pm2", "postgres", "sshd"].map((name, i) => ({
    name,
    up: name !== "crond" && !(name === "pm2" && supervisorDown),
    pid: name === "panel" && panelPid !== undefined ? panelPid : 1000 + i,
    since: t0 - (i + 1) * 3600 * MS_PER_SEC,
  }));
  const svc = (name: string) => svcs.find((x) => x.name === name);
  const pm2Svc = svc("pm2") as FakeSvc;
  const { pm2, appCount } = createFakePm2({
    home,
    delayMs,
    nextPid,
    behaviour,
    supervisor: { isUp: () => pm2Svc.up, crash: () => Object.assign(pm2Svc, { up: false, since: Date.now() }) },
  });

  const svcView = (s: FakeSvc): RunitService => ({
    name: s.name,
    state: s.up ? "run" : "down",
    pid: s.up ? s.pid : null,
    uptimeSec: s.up ? Math.floor((Date.now() - s.since) / MS_PER_SEC) : null,
    downSec: s.up ? null : Math.floor((Date.now() - s.since) / MS_PER_SEC),
    wantUp: s.up,
  });
  const apply = (s: FakeSvc, action: ControlAction) => {
    if (action === "stop") Object.assign(s, { up: false, since: Date.now() });
    else if (action === "restart" || !s.up) Object.assign(s, { up: true, pid: nextPid(), since: Date.now() });
    // pm2-runtime exits right away when its ecosystem has no apps (lab E4).
    if (s === pm2Svc && s.up && exitsOnZeroAppsAtStart && appCount() === 0) s.up = false;
  };

  return {
    mode: "fake",
    home,
    net: {
      isListening: async (port) => listeningPorts.includes(port),
      httpStatus: async (port) => (listeningPorts.includes(port) ? 200 : null),
    },
    runit: {
      list: async () => svcs.map(svcView),
      async supervise(name) {
        const s = svc(name);
        return s ? { state: s.up ? "run" : "down", pid: s.up ? s.pid : null } : null;
      },
      async control(name, action) {
        const s = svc(name);
        if (!s) return null;
        await sleep(delayMs);
        apply(s, action);
        return svcView(s);
      },
      readLog: async (name, n) => (svc(name) ? logLines(name, n) : null),
    },
    pm2,
    cloudflared: {
      configPath: cloudflared.configPath,
      listIngress: cloudflared.listIngress,
      probe: async (hostname) => (hostname.startsWith("old.") ? { status: 502, ms: 40 } : { status: 200, ms: 12 }),
      validate: fakeValidate,
    },
    postgres: createFakePostgres(),
    device: {
      read: async () => ({
        battery: {
          percent: 81,
          charging: false,
          status: "discharging",
          plugged: "unplugged",
          temperatureC: 31.5,
          health: "GOOD",
        },
        cpuCores: 8,
        memory: { totalMb: 11_776, availableMb: 3_788 },
        disk: { freeBytes: 182 * GB, totalBytes: 249 * GB },
        load: [20.87, 20.73, 20.01],
        uptimeSec: Math.floor((Date.now() - t0) / MS_PER_SEC) + 86_400,
      }),
    },
    // Real tar on the host (macOS/Linux); site archives are small in tests.
    archive: createTarArchive(Bun.which("tar") ?? "/usr/bin/tar"),
  };
}
