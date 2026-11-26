// Post-restart health check (PLAN/03 D16 / §4.8): pm2 `online` alone proves nothing (E3: online with no pid and a dead
// port), so healthy = the port answers as expected twice in a row AND pm2 shows the same valid pid with no new
// restarts, still true after a settle window.
import type { HealthExpect, JobParams } from "../../shared/site.types";
import { StepError, type StepOutcome } from "../sites/job.step";
import type { NetAdapter, Pm2Adapter } from "../system/system.types";

/** Probe cadence; tests shrink it. */
export type HealthTiming = { pollMs: number; pm2EveryMs: number; settleMs: number; probeTimeoutMs: number };
/** PLAN/03 §4.8: probe every 1 s, read pm2 every 10 s, confirm again after 5 s, 5 s per HTTP probe. */
export const HEALTH_TIMING: HealthTiming = { pollMs: 1000, pm2EveryMs: 10_000, settleMs: 5000, probeTimeoutMs: 5000 };
/** Consecutive passing probes before pm2 is asked to confirm. */
const STREAK_NEEDED = 2;
const HTTP_OK_MIN = 200;
const HTTP_REDIRECT_END = 400;
const HTTP_SERVER_ERROR = 500;
const MS_PER_SEC = 1000;

/** pm2 state right after the restart; `pid` null = not known yet (taken from the first valid one). */
export type HealthBaseline = { pid: number | null; restarts: number };
/** What to probe: pm2 app, local port, the site's health settings and its main hostname (sent as Host). */
export type HealthTarget = {
  app: string;
  port: number;
  path: string;
  expect: HealthExpect;
  timeoutMs: number;
  host?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validPid = (pid: number | null | undefined): pid is number => typeof pid === "number" && pid > 0;

/** Whether an HTTP status counts as healthy for `expect`. */
export const passes = (code: number | null, expect: HealthExpect): boolean =>
  code !== null && (expect === "lt500" ? code < HTTP_SERVER_ERROR : code >= HTTP_OK_MIN && code < HTTP_REDIRECT_END);

/** pm2 pid/restarts of `app` now (one jlist); null when pm2 has no such app. */
export async function baselineOf(pm2: Pm2Adapter, app: string): Promise<HealthBaseline | null> {
  const p = (await pm2.procs()).find((a) => a.name === app);
  return p ? { pid: validPid(p.pid) ? p.pid : null, restarts: p.restarts } : null;
}

/** Waits until `t` is healthy; returns `healthy {status, ms, path, seconds}` or throws a coded StepError. */
export async function waitHealthy(
  sys: { pm2: Pm2Adapter; net: NetAdapter },
  t: HealthTarget,
  baseline: HealthBaseline | null,
  timing: HealthTiming = HEALTH_TIMING,
): Promise<StepOutcome> {
  const t0 = Date.now();
  const base: HealthBaseline = baseline ? { ...baseline } : { pid: null, restarts: 0 };
  const name: JobParams = { name: t.app };
  let last: string | number = "refused";
  let lastPm2 = t0;

  const probe = async (): Promise<{ ok: boolean; code: number | null; ms: number }> => {
    const s = Date.now();
    if (!(await sys.net.isListening(t.port))) {
      last = "refused";
      return { ok: false, code: null, ms: Date.now() - s };
    }
    const code = await sys.net.httpStatus(t.port, t.path, timing.probeTimeoutMs, t.host);
    last = code ?? "no_answer";
    return { ok: passes(code, t.expect), code, ms: Date.now() - s };
  };
  /** One jlist: errored → app_errored; pid lost/changed or new restarts → app_no_pid/app_unstable. */
  const confirm = async (requirePid: boolean) => {
    const p = (await sys.pm2.procs()).find((a) => a.name === t.app);
    if (!p) throw new StepError("app_no_pid", name, `pm2 no longer lists ${t.app}`);
    if (p.status === "errored") throw new StepError("app_errored", name, `pm2 reports ${t.app} errored`);
    if (p.restarts > base.restarts) {
      throw new StepError("app_unstable", { restarts: p.restarts - base.restarts }, `${t.app} restarted by pm2`);
    }
    if (!validPid(p.pid)) {
      if (requirePid) throw new StepError("app_no_pid", name, `pm2 shows ${t.app} ${p.status} without a pid`);
      return;
    }
    if (base.pid === null) base.pid = p.pid;
    else if (p.pid !== base.pid) {
      throw new StepError("app_unstable", { restarts: 1 }, `${t.app} pid changed ${base.pid} → ${p.pid}`);
    }
  };

  let streak = 0;
  for (;;) {
    if (Date.now() - lastPm2 >= timing.pm2EveryMs) {
      lastPm2 = Date.now();
      await confirm(false);
    }
    const r = await probe();
    streak = r.ok ? streak + 1 : 0;
    if (streak >= STREAK_NEEDED) {
      await confirm(true);
      await sleep(timing.settleMs);
      await confirm(true);
      const again = await probe();
      if (again.ok) {
        const seconds = Math.round((Date.now() - t0) / MS_PER_SEC);
        return { code: "healthy", params: { status: again.code, ms: again.ms, path: t.path, seconds } };
      }
      streak = 0;
    }
    if (Date.now() - t0 >= t.timeoutMs) {
      const seconds = Math.round(t.timeoutMs / MS_PER_SEC);
      throw new StepError(
        "health_timeout",
        { seconds, last, path: t.path },
        `${t.app} not healthy on port ${t.port}${t.path} after ${seconds}s (last: ${last})`,
      );
    }
    await sleep(timing.pollMs);
  }
}
