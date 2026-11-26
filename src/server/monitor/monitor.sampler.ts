// The one background sampler (PLAN/02 K9, §4.1): a setTimeout chain that refreshes the snapshot, probes the
// domains, advances the rule state and hands each tick's result to the monitor service (DB write + alerts).
import type { DomainHealth } from "../../shared/panel.types";
import { log } from "../log.service";
import { computeProblems, isProbeFailure, observe, type ProblemContext, recordProbe } from "../panel/overview.problems";
import type { ProbeResult } from "../system/system.types";
import type { MonitorSnapshot, MonitorState, MonitorStatus, ProblemResult } from "./monitor.contract";
import type { SnapshotCache } from "./monitor.snapshot";

/** First tick after start (gives boot a moment). */
export const FIRST_TICK_DELAY_MS = 10_000;
/** Shortest gap between two ticks. */
export const MIN_TICK_GAP_MS = 5_000;
/** A tick slower than this logs a warning. */
export const SLOW_TICK_MS = 20_000;
/** Per-domain public probe timeout. */
export const DOMAIN_PROBE_TIMEOUT_MS = 8_000;

/** One domain probe of this tick (also written to check_result). */
export type TickCheck = {
  hostname: string;
  at: number;
  status: number | null;
  ms: number | null;
  localStatus: number | null;
};

/** What one tick produced; `commit` stores it and runs the alert engine. */
export type TickResult = { snap: MonitorSnapshot; result: ProblemResult; checks: TickCheck[]; now: number };

/** Timer functions (fake ones in tests). */
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/** What the sampler needs; settings-backed values are functions because they are re-read every tick. */
export type SamplerDeps = {
  snapshot: SnapshotCache;
  state: MonitorState;
  /** Public HTTPS probe of a hostname (cloudflared adapter). */
  probe: (hostname: string) => Promise<ProbeResult>;
  /** HTTP status of 127.0.0.1:<port>, asked only when the public probe failed. */
  localStatus: (port: number) => Promise<number | null>;
  /** Whether the phone reaches the internet at all (asked only when every probe got no answer). */
  connectivity: () => Promise<boolean>;
  /** `monitor.sample_interval_sec`, re-read each tick. */
  intervalSec: () => number;
  context: (intervalSec: number) => ProblemContext;
  commit: (tick: TickResult) => Promise<void>;
  now?: () => number;
  timers?: Timers;
};

const CONNECTIVITY_TIMEOUT_MS = 5_000;

/** Connectivity probe (K18): any answer below 500 from `url` means the phone is online. */
export async function httpReachable(url: string): Promise<boolean> {
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(CONNECTIVITY_TIMEOUT_MS) });
  return res.status < 500;
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as Timer) };

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: Timer | undefined;
  const late = new Promise<T>((r) => {
    t = setTimeout(() => r(fallback), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** Builds the sampler; nothing runs until start(). */
export function createSampler(deps: SamplerDeps) {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;
  let running: Promise<void> | null = null;
  let handle: unknown = null;
  let stopped = true;
  let sampledAt: number | null = null;
  let lastTickMs: number | null = null;
  let intervalSec = deps.intervalSec();

  async function probeDomains(snap: MonitorSnapshot): Promise<TickCheck[]> {
    const rules = (snap.ingress.ok ? snap.ingress.value : snap.ingress.stale) ?? [];
    const probeable = rules.filter((r) => !r.hostname.includes("*"));
    return Promise.all(
      probeable.map(async (r): Promise<TickCheck> => {
        const res = await timeout(
          deps.probe(r.hostname).catch((e: unknown) => {
            log.warn(`[monitor] probe ${r.hostname} failed: ${(e as Error).message}`);
            return { status: null, ms: null };
          }),
          DOMAIN_PROBE_TIMEOUT_MS,
          { status: null, ms: null },
        );
        const local =
          isProbeFailure(res.status) && r.port !== null
            ? await deps.localStatus(r.port).catch((e: unknown) => {
                log.warn(`[monitor] local probe :${r.port} failed: ${(e as Error).message}`);
                return null;
              })
            : null;
        return { hostname: r.hostname, at: now(), status: res.status, ms: res.ms, localStatus: local };
      }),
    );
  }

  async function runTick(): Promise<void> {
    const started = now();
    intervalSec = deps.intervalSec();
    const snap = await deps.snapshot.refreshAll();
    const checks = await probeDomains(snap);
    for (const c of checks) {
      const last: DomainHealth = {
        status: c.status,
        ms: c.ms,
        checkedAt: new Date(c.at).toISOString(),
        local: c.localStatus,
      };
      recordProbe(deps.state, c.hostname, last);
    }
    // A failing connectivity check means "no internet" (K18); that is its answer, not an error to propagate.
    const allSilent = checks.length > 0 && checks.every((c) => c.status === null);
    deps.state.internetDown = allSilent ? !(await deps.connectivity().catch(() => false)) : false;
    const t = now();
    observe(deps.state, snap, t, intervalSec);
    const result = computeProblems(snap, deps.state, deps.context(intervalSec), t);
    await deps.commit({ snap, result, checks, now: t });
    sampledAt = t;
    lastTickMs = now() - started;
    if (lastTickMs > SLOW_TICK_MS) log.warn(`[monitor] tick ${lastTickMs}ms`);
    else log.debug(`[monitor] tick ${lastTickMs}ms`);
  }

  /** Runs one tick now; an overlapping call is skipped (warns) and shares the running tick. */
  function tick(): Promise<void> {
    if (running) {
      log.warn("[monitor] tick skipped: previous tick still running");
      return running;
    }
    running = runTick()
      .catch((e: unknown) => log.error(`[monitor] tick failed: ${(e as Error).message}`))
      .finally(() => {
        running = null;
      });
    return running;
  }

  function schedule(ms: number): void {
    if (stopped) return;
    handle = timers.set(() => {
      const started = now();
      void tick().then(() => schedule(Math.max(MIN_TICK_GAP_MS, intervalSec * 1000 - (now() - started))));
    }, ms);
  }

  function stop(): void {
    stopped = true;
    if (handle !== null) timers.clear(handle);
    handle = null;
  }

  return {
    tick,

    /** Starts the chain (first tick after FIRST_TICK_DELAY_MS); returns stop. */
    start(): () => void {
      if (stopped) {
        stopped = false;
        schedule(FIRST_TICK_DELAY_MS);
      }
      return stop;
    },

    /** Stops scheduling; a running tick finishes (await idle()). */
    stop,

    /** Resolves when no tick is running. */
    idle: async (): Promise<void> => {
      await running;
    },

    /** B5: sampler state behind /dev/health. */
    status: (): MonitorStatus => ({
      sampledAt: sampledAt === null ? null : new Date(sampledAt).toISOString(),
      intervalSec,
      lastTickMs,
      running: !stopped,
    }),
  };
}

/** The sampler of one monitor. */
export type Sampler = ReturnType<typeof createSampler>;
