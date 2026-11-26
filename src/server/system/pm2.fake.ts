import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { App, ControlAction } from "../../shared/panel.types";
import { PM2_GUARD_NAME } from "../../shared/site.types";
import { termuxPrefix } from "../exec/termux.exec";
import { toApp } from "./pm2.termux";
import { type Pm2Adapter, type Pm2Proc, Pm2UnavailableError, SystemError } from "./system.types";

/**
 * pm2 behaviours seen in the POCO lab that tests need to reproduce (PLAN/03 C18):
 * `onlineWithoutPid` — (re)started apps report `online` with no pid (E3);
 * `runtimeExitsOnMissingNativeScript` — `startFromEcosystem` loads the real ecosystem file and, when any entry's
 * script is missing, the pm2 runtime dies: every app stops and the supervisor goes down (E1).
 */
export type FakePm2Behaviour = { onlineWithoutPid?: boolean; runtimeExitsOnMissingNativeScript?: boolean };

/** The runit `pm2` service as the fake pm2 sees it. */
export type FakeSupervisor = { isUp(): boolean; crash(): void };

/** `listen` = the port the app's process would accept TCP on while online (fake net, D-W9 health checks). */
type FakeApp = Omit<Pm2Proc, "uptimeSec"> & { since: number; listen: number | null };
type EcosystemEntry = { name?: unknown; cwd?: unknown; script?: unknown; args?: unknown; env?: { PORT?: unknown } };

const MS_PER_SEC = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logLines = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z ${name}: demo line ${i + 1}`,
  );

/** A stopped app with no data yet; `run` starts it. */
const blank = (name: string, cwd: string, execPath: string): FakeApp => ({
  name,
  status: "stopped",
  pid: null,
  memoryMb: null,
  cpu: null,
  restarts: 0,
  port: null,
  module: false,
  outLog: null,
  errLog: null,
  cwd,
  execPath,
  args: [],
  startedAtMs: null,
  since: Date.now(),
  listen: null,
});

const validPort = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
/** Port a started entry listens on: pm2 `env.PORT`, else `PORT=` in `<cwd>/.env` (what a panel binary reads). */
function listenPortOf(e: EcosystemEntry, cwd: string): number | null {
  const env = validPort(e.env?.PORT);
  if (env !== null) return env;
  const file = join(cwd, ".env");
  return existsSync(file) ? validPort(readFileSync(file, "utf8").match(/^PORT=(\d+)\s*$/m)?.[1]) : null;
}
/** `<sites>/apps.json` entries (empty when absent or unreadable: the fake then starts nothing from it). */
function appsJsonEntries(sitesDir: string): EcosystemEntry[] {
  try {
    const list = JSON.parse(readFileSync(join(sitesDir, "apps.json"), "utf8")) as unknown;
    return Array.isArray(list) ? list.filter((e) => typeof e?.name === "string") : [];
  } catch {
    return []; // absent or invalid apps.json: pm2-runtime would skip it too (ecosystem snippet, B18)
  }
}
/** An ecosystem/apps.json entry as a stopped app (cwd/script resolved like pm2, listen port from env or .env). */
function entryApp(e: EcosystemEntry, baseDir: string): FakeApp {
  const cwd = String(e.cwd ?? baseDir);
  return Object.assign(blank(String(e.name), cwd, resolve(cwd, String(e.script ?? ""))), {
    port: validPort(e.env?.PORT),
    args: Array.isArray(e.args) ? e.args.map(String) : [],
    listen: listenPortOf(e, cwd),
  });
}

/** Demo apps shaped like the phone's: glibc via grun, php, a native site without its binary, modules, one errored. */
function seedApps(home: string): FakeApp[] {
  const bin = join(termuxPrefix(), "bin");
  const site = (name: string) => join(home, "sites", name);
  for (const [dir, file] of [
    ["makuro-solusi", "app"],
    ["adminneo", "index.php"],
  ] as const) {
    mkdirSync(site(dir), { recursive: true });
    if (!existsSync(join(site(dir), file))) writeFileSync(join(site(dir), file), "fake site file\n");
  }
  mkdirSync(site("demo-api"), { recursive: true });
  const t0 = Date.now();
  const on = (a: FakeApp, pid: number, memoryMb: number, extra: Partial<FakeApp> = {}): FakeApp => {
    Object.assign(a, { status: "online", pid, memoryMb, startedAtMs: t0, since: t0 }, extra);
    a.listen ??= a.port;
    return a;
  };
  const logrotate = join(home, ".pm2", "modules", "pm2-logrotate");
  // pm2-runtime starts the runnable apps.json entries at boot (a demo seed writes them into the sandbox).
  const fromAppsJson = appsJsonEntries(site(""))
    .map((e) => entryApp(e, site("")))
    .filter((a) => a.execPath !== null && existsSync(a.execPath))
    .map((a, i) => on(a, 2100 + i, 54.3));
  const fixed = [
    on(blank("adminneo", site("adminneo"), join(bin, "php")), 2001, 61.2, {
      port: 3006,
      args: ["-S", "127.0.0.1:3006", "index.php"],
    }),
    Object.assign(blank("demo-api", site("demo-api"), join(site("demo-api"), "run")), { restarts: 4, port: 3007 }),
    Object.assign(blank("kasir-lama", site("kasir-lama"), join(site("kasir-lama"), "run")), {
      status: "errored" as const,
      restarts: 15,
      port: 3008,
    }),
    on(blank("makuro-solusi", site("makuro-solusi"), join(bin, "grun")), 2002, 88.5, {
      restarts: 2,
      port: 3005,
      args: ["./app"],
    }),
    on(blank(PM2_GUARD_NAME, home, join(bin, "sleep")), 2004, 1, { args: ["infinity"], module: true }),
    on(blank("pm2-logrotate", logrotate, join(logrotate, "app.js")), 2003, 40, { module: true }),
  ];
  return [...fixed.filter((a) => !fromAppsJson.some((x) => x.name === a.name)), ...fromAppsJson];
}

/** Loads `apps` of an ecosystem file the way pm2 does (fresh require, its apps.json too). */
function loadEcosystem(file: string): EcosystemEntry[] {
  try {
    // Cache keys are real paths (macOS tmpdir is a symlink to /private/var).
    const dir = realpathSync(dirname(file));
    for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
    const apps = (require(file) as { apps?: unknown }).apps;
    return Array.isArray(apps) ? apps : [];
  } catch (e) {
    throw new SystemError(`pm2 start ${file}: cannot load ecosystem (${(e as Error).message})`, { cause: e });
  }
}

/**
 * In-memory pm2 whose availability follows the fake runit `pm2` service; `appCount` = apps that are not modules,
 * `listens(port)` = an online app accepts TCP on that port.
 */
export function createFakePm2(opts: {
  home: string;
  delayMs: number;
  supervisor: FakeSupervisor;
  nextPid: () => number;
  behaviour: FakePm2Behaviour;
}): { pm2: Pm2Adapter; appCount: () => number; listens: (port: number) => boolean } {
  const { home, delayMs, supervisor, nextPid, behaviour } = opts;
  const apps = seedApps(home);
  const proc = ({ since, listen, ...a }: FakeApp): Pm2Proc => ({
    ...a,
    uptimeSec: a.status === "online" ? Math.floor((Date.now() - since) / MS_PER_SEC) : null,
  });
  const view = (a: FakeApp): App => toApp(proc(a));
  const guard = () => {
    if (!supervisor.isUp()) throw new Pm2UnavailableError("service_down");
  };
  const run = (a: FakeApp) => {
    const now = Date.now();
    const pid = behaviour.onlineWithoutPid ? null : nextPid();
    Object.assign(a, { status: "online", pid, since: now, startedAtMs: now, memoryMb: 50 });
  };
  const stop = (a: FakeApp) => Object.assign(a, { status: "stopped", pid: null, memoryMb: null });

  /** Ecosystem entry `name` as a new app; undefined when absent. Crashes the runtime on a missing script. */
  function fromEcosystem(ecosystem: string, name: string): FakeApp | undefined {
    const entries = loadEcosystem(ecosystem);
    const cwdOf = (e: EcosystemEntry) => String(e.cwd ?? dirname(ecosystem));
    const scriptOf = (e: EcosystemEntry) => resolve(cwdOf(e), String(e.script ?? ""));
    if (entries.some((e) => !existsSync(scriptOf(e)))) {
      apps.forEach(stop);
      supervisor.crash();
      throw new Pm2UnavailableError("service_down");
    }
    const e = entries.find((x) => x.name === name);
    return e ? entryApp(e, dirname(ecosystem)) : undefined;
  }

  const pm2: Pm2Adapter = {
    async list() {
      guard();
      return apps.map(view);
    },
    async procs() {
      guard();
      return apps.map(proc);
    },
    async control(name, action: ControlAction) {
      guard();
      const a = apps.find((x) => x.name === name);
      if (!a) return null;
      await sleep(delayMs);
      if (action === "stop") stop(a);
      else if (action === "restart" || a.status !== "online") run(a);
      if (action === "restart") a.restarts++;
      return view(a);
    },
    async readLog(name, stream, n) {
      guard();
      return apps.some((x) => x.name === name) ? logLines(`${name}[${stream}]`, n) : null;
    },
    async remove(name) {
      guard();
      const i = apps.findIndex((x) => x.name === name);
      if (i === -1) return false;
      apps.splice(i, 1);
      return true;
    },
    async startFromEcosystem(ecosystem, name) {
      guard();
      await sleep(delayMs);
      const loaded = behaviour.runtimeExitsOnMissingNativeScript ? fromEcosystem(ecosystem, name) : null;
      // Like `pm2 start --only`: an already known app is left as it is.
      const existing = apps.find((x) => x.name === name);
      if (existing) return view(existing);
      if (loaded === undefined) return null;
      // Without the strict loader: the apps.json entry next to the ecosystem file, as the real snippet spreads it.
      const sitesDir = dirname(ecosystem);
      const entry = appsJsonEntries(sitesDir).find((e) => e.name === name);
      const a =
        loaded ??
        (entry ? entryApp(entry, sitesDir) : blank(name, join(home, "sites", name), join(home, "sites", name, "run")));
      run(a);
      apps.push(a);
      return view(a);
    },
  };
  return {
    pm2,
    appCount: () => apps.filter((a) => !a.module).length,
    listens: (port) => apps.some((a) => a.status === "online" && a.listen === port),
  };
}
