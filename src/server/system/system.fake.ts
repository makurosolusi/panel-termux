import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Battery, ControlAction, DatabaseInfo } from "../../shared/panel.types";
import { createTarArchive } from "./archive.tar";
import { createTermuxCloudflared, parseRouteDns } from "./cloudflared.termux";
import { createOfflineClients } from "./external.fake";
import { FAKE_INTEGRATIONS, type FakeIntegration, writeFakeIntegration } from "./fake.integration";
import { createFakePm2, type FakePm2Behaviour } from "./pm2.fake";
import { createFakePostgres } from "./postgres.fake";
import type { RunitControlOptions, RunitService, SystemAdapters } from "./system.types";

export { fakeEcosystem } from "./fake.integration";

/**
 * Options for the fake adapters. `delayMs` slows control actions (lets tests overlap two clicks);
 * `home` = sandbox HOME for site files (default: a fresh temp dir); `listeningPorts` = ports that "accept" TCP;
 * `supervisorDown` = runit `pm2` starts down (pm2 unavailable); `exitsOnZeroAppsAtStart` = starting runit `pm2`
 * with no apps leaves it down (pm2-runtime auto-exit, lab E4); `panelPid` = pid in the fake `panel/supervise/pid`
 * (pass `process.pid` to look supervised); `offline` = S3/Telegram/DNS are offline fakes too (the panel's own fake
 * mode, D-W9-4; tests leave it off to hit their mock servers); `pm2UptimeSec` = how long runit `pm2` has run (default
 * 4 h); `integration` = sandbox scenario when FAKE_SCENARIO_FILE names none (default `ready`). Ports of online pm2 apps
 * always "accept" TCP.
 */
export type FakeOptions = FakePm2Behaviour & {
  offline?: boolean;
  delayMs?: number;
  home?: string;
  listeningPorts?: number[];
  supervisorDown?: boolean;
  exitsOnZeroAppsAtStart?: boolean;
  panelPid?: number;
  pm2UptimeSec?: number;
  integration?: FakeIntegration;
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
/** Folder under the panel data dir used as the fake HOME by boot (kept across restarts, written by the demo seed). */
export const FAKE_HOME_DIR = "fake-home";
/**
 * Optional JSON in the fake HOME that overrides demo readings: `{ battery?: Partial<Battery>, databases?,
 * integration?: FakeIntegration, pm2LostOnRestart?: string[] }` (`pm2LostOnRestart` = apps pm2 does not bring back
 * after a restart of runit `pm2`, to see the checked restart fail).
 */
export const FAKE_SCENARIO_FILE = ".panel-fake.json";
/** Shape of FAKE_SCENARIO_FILE. */
export type FakeScenario = {
  battery?: Partial<Battery>;
  databases?: DatabaseInfo[];
  integration?: FakeIntegration;
  pm2LostOnRestart?: string[];
};

/** Zone of the fake cloudflared cert.pem: `route dns` of a hostname outside it lands under it (dns_wrong_zone). */
export const FAKE_DNS_ZONE = "contoh.com";

function seedSandbox(home: string, integration: FakeIntegration): void {
  const cfDir = join(home, ".cloudflared");
  mkdirSync(cfDir, { recursive: true });
  if (!existsSync(join(cfDir, "config.yml"))) writeFileSync(join(cfDir, "config.yml"), FAKE_CONFIG);
  writeFakeIntegration(home, integration);
}

/** FAKE_SCENARIO_FILE of `home`, or {} when absent. A broken file is an error: the demo would silently lie. */
function readScenario(home: string): FakeScenario {
  const file = join(home, FAKE_SCENARIO_FILE);
  if (!existsSync(file)) return {};
  let scenario: FakeScenario;
  try {
    scenario = JSON.parse(readFileSync(file, "utf8")) as FakeScenario;
  } catch (e) {
    throw new Error(`fake system: ${file} is not valid JSON (${(e as Error).message})`, { cause: e });
  }
  if (scenario.integration !== undefined && !FAKE_INTEGRATIONS.includes(scenario.integration))
    throw new Error(`fake system: ${file}: unknown integration "${scenario.integration}"`);
  return scenario;
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

/** Temp sandbox HOMEs made by createFakeSystem without `home`, removed on process exit (bun test fires no exit: pass `home`). */
const tempHomes: string[] = [];
const tempHome = (): string => {
  if (tempHomes.length === 0) {
    process.on("exit", () => {
      for (const dir of tempHomes) rmSync(dir, { recursive: true, force: true });
    });
  }
  const dir = mkdtempSync(join(tmpdir(), "panel-fake-home-"));
  tempHomes.push(dir);
  return dir;
};

/** In-memory demo system for development on a non-Termux host and for tests; control actions mutate state. */
export function createFakeSystem({
  delayMs = 0,
  home = tempHome(),
  listeningPorts = [],
  supervisorDown = false,
  exitsOnZeroAppsAtStart = false,
  panelPid,
  offline = false,
  pm2UptimeSec,
  integration,
  ...behaviour
}: FakeOptions = {}): SystemAdapters {
  const scenario = readScenario(home);
  const setup = scenario.integration ?? integration ?? "ready";
  seedSandbox(home, setup);
  const cloudflared = createTermuxCloudflared(join(home, ".cloudflared", "config.yml"));
  const t0 = Date.now();
  let pid = 4000;
  const nextPid = () => pid++;
  const svcs: FakeSvc[] = ["cloudflared", "crond", "panel", "pm2", "postgres", "sshd"].map((name, i) => ({
    name,
    up: name !== "crond" && !(name === "pm2" && supervisorDown),
    pid: name === "panel" && panelPid !== undefined ? panelPid : 1000 + i,
    since: t0 - (name === "pm2" && pm2UptimeSec !== undefined ? pm2UptimeSec : (i + 1) * 3600) * MS_PER_SEC,
  }));
  const svc = (name: string) => svcs.find((x) => x.name === name);
  const pm2Svc = svc("pm2") as FakeSvc;
  const lost = [...(behaviour.pm2LostOnRestart ?? []), ...(scenario.pm2LostOnRestart ?? [])];
  const { pm2, appCount, listens, runtimeStarted } = createFakePm2({
    home,
    delayMs,
    nextPid,
    behaviour: { ...behaviour, pm2LostOnRestart: lost },
    seedSiteDirs: setup !== "no_sites_dir",
    supervisor: { isUp: () => pm2Svc.up, crash: () => Object.assign(pm2Svc, { up: false, since: Date.now() }) },
  });

  const svDir = join(home, "usr", "var", "service");
  const routed = new Set<string>();
  const listening = (port: number) => listeningPorts.includes(port) || listens(port);

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
    else if (action === "restart" || !s.up) {
      Object.assign(s, { up: true, pid: nextPid(), since: Date.now() });
      if (s === pm2Svc) runtimeStarted();
    }
    // pm2-runtime exits right away when its ecosystem has no apps (lab E4).
    if (s === pm2Svc && s.up && exitsOnZeroAppsAtStart && appCount() === 0) s.up = false;
  };

  return {
    mode: "fake",
    home,
    net: {
      isListening: async (port) => listening(port),
      httpStatus: async (port) => (listening(port) ? 200 : null),
    },
    runit: {
      list: async () => svcs.map(svcView),
      async supervise(name) {
        const s = svc(name);
        if (!s) return null;
        const v = svcView(s);
        return v.uptimeSec === null
          ? { state: v.state, pid: v.pid }
          : { state: v.state, pid: v.pid, uptimeSec: v.uptimeSec };
      },
      async control(name, action, opts: RunitControlOptions = {}) {
        const s = svc(name);
        if (!s) return null;
        await sleep(delayMs);
        // Same as termux: `down` under the sandbox SVDIR goes first, then the service starts.
        if (action === "start" && opts.removeDown) rmSync(join(svDir, name, "down"), { force: true });
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
      // Like cloudflared with a cert.pem of FAKE_DNS_ZONE: a hostname outside the zone gets the zone appended.
      async routeDns(_tunnel, hostname) {
        await sleep(delayMs);
        const fqdn = hostname.endsWith(`.${FAKE_DNS_ZONE}`) ? hostname : `${hostname}.${FAKE_DNS_ZONE}`;
        const out = routed.has(fqdn)
          ? `INF ${fqdn} is already configured to route to your tunnel`
          : `INF Added CNAME ${fqdn} which will route to this tunnel`;
        routed.add(fqdn);
        return parseRouteDns(out, hostname);
      },
    },
    postgres: createFakePostgres(scenario.databases),
    device: {
      read: async () => ({
        battery: {
          percent: 81,
          charging: false,
          status: "discharging",
          plugged: "unplugged",
          temperatureC: 31.5,
          health: "GOOD",
          ...scenario.battery,
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
    prefix: join(home, "usr"),
    ...(offline ? { offline: createOfflineClients(home) } : {}),
  };
}
