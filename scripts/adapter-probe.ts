// Real-device check of the termux system adapters. Prints a sanitized summary (no env, no log contents).
// Usage: adapter-probe [--dummy panel-probe-<x>]
//   default: READ functions only (list/status/log line counts/ingress/health/databases/device).
//   --dummy: additionally runs stop/start/restart through the runit adapter, ONLY on a throwaway
//            service whose name starts with `panel-probe-` (refuses anything else).
import { createTermuxSystem } from "../src/server/system/system.select";

const DUMMY_PREFIX = "panel-probe-";
const LOG_SAMPLE_LINES = 50;

const sys = createTermuxSystem();
const out: string[] = [];
const say = (s: string) => out.push(s);

async function step<T>(label: string, fn: () => Promise<T>, fmt: (v: T) => string[]): Promise<T | null> {
  const t = performance.now();
  try {
    const v = await fn();
    say(`## ${label} ok (${Math.round(performance.now() - t)} ms)`);
    for (const l of fmt(v)) say(`  ${l}`);
    return v;
  } catch (e) {
    say(`## ${label} FAIL (${Math.round(performance.now() - t)} ms): ${(e as Error).message}`);
    return null;
  }
}

say(`platform=${process.platform} arch=${process.arch} bun=${Bun.version}`);

const services = await step("runit.list", sys.runit.list, (v) =>
  v.map((s) => `${s.name}: ${s.state} pid=${s.pid ?? "-"} up=${s.uptimeSec ?? "-"}s wantUp=${s.wantUp}`),
);
const firstSvc = services?.find((s) => !s.name.startsWith(DUMMY_PREFIX))?.name;
if (firstSvc) {
  await step(
    `runit.readLog(${firstSvc}, ${LOG_SAMPLE_LINES})`,
    () => sys.runit.readLog(firstSvc, LOG_SAMPLE_LINES),
    (v) => [`lines=${v?.length ?? "null"}`],
  );
}

const apps = await step("pm2.list", sys.pm2.list, (v) =>
  v.map(
    (a) =>
      `${a.name}: ${a.status} pid=${a.pid ?? "-"} mem=${a.memoryMb ?? "-"}MB cpu=${a.cpu ?? "-"} ` +
      `restarts=${a.restarts} up=${a.uptimeSec ?? "-"}s port=${a.port ?? "-"}`,
  ),
);
const firstApp = apps?.[0]?.name;
if (firstApp) {
  for (const stream of ["out", "err"] as const) {
    await step(
      `pm2.readLog(${firstApp}, ${stream}, ${LOG_SAMPLE_LINES})`,
      () => sys.pm2.readLog(firstApp, stream, LOG_SAMPLE_LINES),
      (v) => [`lines=${v?.length ?? "null"}`],
    );
  }
}

const ingress = await step("cloudflared.listIngress", sys.cloudflared.listIngress, (v) =>
  v.map((r) => `${r.hostname} -> ${r.service} port=${r.port ?? "-"}`),
);
if (ingress?.length) {
  await step(
    "cloudflared.probe (parallel)",
    () => Promise.all(ingress.map(async (r) => [r.hostname, await sys.cloudflared.probe(r.hostname)] as const)),
    (v) => v.map(([h, p]) => `${h}: status=${p.status ?? "-"} ms=${p.ms ?? "-"}`),
  );
}

await step("postgres.listDatabases", sys.postgres.listDatabases, (v) =>
  v.map((d) => `${d.name} owner=${d.owner} size=${(d.sizeBytes / 1e6).toFixed(1)}MB`),
);

await step("device.read", sys.device.read, (d) => [
  `battery=${d.battery ? `${d.battery.percent}% charging=${d.battery.charging} ${d.battery.temperatureC}C` : "null"}`,
  `memory=${d.memory.availableMb}/${d.memory.totalMb} MB available`,
  `disk=${(d.disk.freeBytes / 1e9).toFixed(1)}/${(d.disk.totalBytes / 1e9).toFixed(1)} GB free`,
  `load=${d.load.join("/")} uptime=${d.uptimeSec}s`,
]);

const dummyIdx = process.argv.indexOf("--dummy");
if (dummyIdx !== -1) {
  const dummy = process.argv[dummyIdx + 1] ?? "";
  if (!dummy.startsWith(DUMMY_PREFIX)) {
    say(`## refusing control on "${dummy}": name must start with ${DUMMY_PREFIX}`);
  } else {
    for (const action of ["stop", "start", "restart", "stop"] as const) {
      await step(
        `runit.control(${dummy}, ${action})`,
        () => sys.runit.control(dummy, action),
        (s) => [s ? `${s.state} pid=${s.pid ?? "-"} wantUp=${s.wantUp}` : "null (unknown service)"],
      );
    }
  }
}

console.log(out.join("\n"));
