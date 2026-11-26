// Pure polling schedule (PLAN/01 §3.5 rules P1–P8, DECISIONS B13). Timers, clock and visibility are injected so the
// rules are tested without a DOM; `use-poller.ts` is the only React wrapper.

/** Longest wait between polls while errors back off. */
export const POLL_BACKOFF_MAX_MS = 60_000;

/** Delay before the next poll: base, doubled per consecutive failure, capped at 60 s but never below base. */
export const pollDelay = (baseMs: number, failures: number): number =>
  Math.max(baseMs, Math.min(baseMs * 2 ** Math.min(failures, 6), POLL_BACKOFF_MAX_MS));

/** Outcome of one poll; "error" counts towards backoff. */
export type PollResult = "ok" | "error";

/** Injected effects of a poller. `baseMs` undefined = run only when started/reloaded, never on a timer. */
export type PollerDeps = {
  run: (signal: AbortSignal) => Promise<PollResult>;
  baseMs: number | undefined;
  isHidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
};

/** Controls of one polling cycle; `stop()` is final and aborts the request in flight. */
export type Poller = {
  start(): void;
  reload(): void;
  visible(): void;
  hidden(): void;
  online(): void;
  stop(): void;
};

/**
 * Single-flight poll loop: a tick during a request is skipped (never aborted), `reload()` during one queues exactly
 * one more run, the next run is scheduled after the response, and hidden tabs keep no timer.
 */
export function createPoller(deps: PollerDeps): Poller {
  const { baseMs } = deps;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let queued = false;
  let failures = 0;
  let lastOk: number | null = null;
  let lastFailed = false;
  let stopped = false;

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  const schedule = (ms: number) => {
    clear();
    if (stopped || baseMs === undefined || deps.isHidden()) return;
    timer = deps.setTimer(() => {
      timer = null;
      fire();
    }, ms);
  };

  const settle = (ctrl: AbortController, result: PollResult) => {
    if (inFlight !== ctrl) return; // stopped meanwhile
    inFlight = null;
    if (result === "ok") {
      failures = 0;
      lastOk = deps.now();
      lastFailed = false;
    } else {
      failures++;
      lastFailed = true;
    }
    if (queued) {
      queued = false;
      fire();
    } else if (baseMs !== undefined) schedule(pollDelay(baseMs, failures));
  };

  function fire() {
    if (stopped || inFlight) return;
    clear();
    const ctrl = new AbortController();
    inFlight = ctrl;
    deps.run(ctrl.signal).then(
      (result) => settle(ctrl, result),
      (cause: unknown) => {
        // `run` is expected to resolve "error" itself; a rejection is a bug in the caller, so surface it.
        console.error("poller: run rejected instead of resolving 'error'", cause);
        settle(ctrl, "error");
      },
    );
  }

  return {
    start: fire,
    reload() {
      if (inFlight) queued = true;
      else fire();
    },
    visible() {
      if (stopped || inFlight || baseMs === undefined) return;
      const since = lastOk === null ? Number.POSITIVE_INFINITY : deps.now() - lastOk;
      if (lastFailed || since >= baseMs) fire();
      else schedule(baseMs - since);
    },
    hidden: clear,
    online() {
      if (stopped || baseMs === undefined) return;
      failures = 0;
      if (!inFlight) fire();
    },
    stop() {
      stopped = true;
      queued = false;
      clear();
      inFlight?.abort();
      inFlight = null;
    },
  };
}
