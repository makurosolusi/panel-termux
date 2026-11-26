import { describe, expect, test } from "bun:test";
import { createPoller, POLL_BACKOFF_MAX_MS, type PollResult, pollDelay } from "@/web/shared/poller";

/** Deterministic clock + timers + controllable run promises (test-only). */
function harness(baseMs: number | undefined) {
  let clock = 0;
  let hidden = false;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const pending: { resolve: (r: PollResult) => void; signal: AbortSignal }[] = [];
  const runs: string[] = [];
  let cursor = 0;

  const poller = createPoller({
    run: (signal) =>
      new Promise<PollResult>((resolve) => {
        runs.push(`after=${cursor}`);
        pending.push({ resolve, signal });
      }),
    baseMs,
    isHidden: () => hidden,
    now: () => clock,
    setTimer: (fn, ms) => {
      const handle = nextId++;
      timers.set(handle, { at: clock + ms, fn });
      return handle;
    },
    clearTimer: (h) => timers.delete(h as number),
  });

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    poller,
    runs,
    timers,
    setHidden: (h: boolean) => {
      hidden = h;
    },
    /** Resolves the oldest in-flight run and lets the poller react. */
    async finish(result: PollResult) {
      const p = pending.shift();
      if (!p) throw new Error("finish: no run in flight");
      cursor++; // every response moves the cursor, URL stays fixed
      p.resolve(result);
      await flush();
    },
    inFlight: () => pending.length,
    lastSignal: () => pending.at(-1)?.signal,
    /** Delay of the only pending timer. */
    nextDelay() {
      const [t] = [...timers.values()];
      return t ? t.at - clock : null;
    },
    /** Advances the clock, firing timers that come due. */
    advance(ms: number) {
      const until = clock + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        clock = due[1].at;
        due[1].fn();
      }
      clock = until;
    },
  };
}

describe("pollDelay", () => {
  test("doubles per failure up to 60 s, never below base", () => {
    expect([0, 1, 2, 3, 4, 5].map((f) => pollDelay(10_000, f))).toEqual([
      10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
    ]);
    expect(pollDelay(120_000, 0)).toBe(120_000);
    expect(pollDelay(120_000, 5)).toBe(120_000);
    expect(pollDelay(1_000, 100)).toBe(POLL_BACKOFF_MAX_MS);
  });
});

describe("createPoller", () => {
  test("single flight: a due tick during a request does not start a second run", async () => {
    const h = harness(10_000);
    h.poller.start();
    h.poller.start(); // e.g. a tick racing the first run
    expect(h.inFlight()).toBe(1);
    expect(h.timers.size).toBe(0); // next run is scheduled only after the response
    await h.finish("ok");
    expect(h.nextDelay()).toBe(10_000);
  });

  test("reload() during a request queues exactly one extra run", async () => {
    const h = harness(10_000);
    h.poller.start();
    h.poller.reload();
    h.poller.reload();
    h.poller.reload();
    expect(h.runs).toHaveLength(1);
    await h.finish("ok");
    expect(h.runs).toHaveLength(2);
    await h.finish("ok");
    expect(h.runs).toHaveLength(2);
    expect(h.nextDelay()).toBe(10_000);
  });

  test("backoff 10 → 20 → 40 → 60 → 60 s with a cursor that changes every response; success resets", async () => {
    const h = harness(10_000);
    h.poller.start();
    const results: PollResult[] = ["ok", "error", "error", "error", "error", "error"];
    const delays: (number | null)[] = [];
    for (const r of results) {
      await h.finish(r);
      delays.push(h.nextDelay());
      h.advance(h.nextDelay() ?? 0);
    }
    expect(delays).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(new Set(h.runs).size).toBe(h.runs.length); // each run used a new cursor, backoff still applied
    await h.finish("ok");
    expect(h.nextDelay()).toBe(10_000);
  });

  test("hidden() cancels the timer; visible() fetches at once when stale, else waits the remainder", async () => {
    const h = harness(10_000);
    h.poller.start();
    await h.finish("ok");
    h.advance(4_000);
    h.setHidden(true);
    h.poller.hidden();
    expect(h.timers.size).toBe(0);
    h.setHidden(false);
    h.poller.visible();
    expect(h.inFlight()).toBe(0);
    expect(h.nextDelay()).toBe(6_000);

    h.setHidden(true);
    h.poller.hidden();
    h.advance(30_000);
    expect(h.runs).toHaveLength(1); // nothing while hidden
    h.setHidden(false);
    h.poller.visible();
    expect(h.inFlight()).toBe(1);
  });

  test("visible() after an error fetches at once; completion while hidden schedules nothing", async () => {
    const h = harness(10_000);
    h.poller.start();
    h.setHidden(true);
    await h.finish("error");
    expect(h.timers.size).toBe(0);
    h.setHidden(false);
    h.poller.visible();
    expect(h.inFlight()).toBe(1);
  });

  test("online() fetches at once and resets failures", async () => {
    const h = harness(10_000);
    h.poller.start();
    await h.finish("error");
    h.poller.online();
    expect(h.inFlight()).toBe(1);
    await h.finish("error");
    expect(h.nextDelay()).toBe(20_000); // failures restarted from 0 → first error = 20 s
  });

  test("stop() aborts the request in flight and nothing runs afterwards", async () => {
    const h = harness(10_000);
    h.poller.start();
    const signal = h.lastSignal();
    h.poller.stop();
    expect(signal?.aborted).toBe(true);
    await h.finish("ok");
    h.poller.reload();
    h.poller.visible();
    h.advance(120_000);
    expect(h.runs).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  test("base 120 s never waits less than 120 s", async () => {
    const h = harness(120_000);
    h.poller.start();
    await h.finish("ok");
    expect(h.nextDelay()).toBe(120_000);
    h.advance(120_000);
    await h.finish("error");
    expect(h.nextDelay()).toBe(120_000);
  });

  test("no base (enabled:false): start() runs once, never on a timer; not started = zero runs", async () => {
    const once = harness(undefined);
    once.poller.start();
    await once.finish("ok");
    once.poller.visible();
    once.poller.online();
    once.advance(600_000);
    expect(once.runs).toHaveLength(1);

    const never = harness(undefined);
    never.advance(600_000);
    expect(never.runs).toHaveLength(0);
    never.poller.reload(); // manual reload still works
    expect(never.runs).toHaveLength(1);
  });
});
