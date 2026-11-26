import { useCallback, useEffect, useRef, useState } from "react";
import { createPoller, type Poller, type PollResult } from "./poller";

/**
 * Runs `run` now and then every baseMs per rules P1–P8 (the only polling primitive of the SPA). `enabled:false`
 * stops the schedule (not the first run of a `key` unless initial:false); a new `key` starts a new cycle.
 */
export function usePoller(
  run: (signal: AbortSignal) => Promise<PollResult>,
  opts: { baseMs?: number; enabled?: boolean; initial?: boolean; key?: string },
): { reload: () => void; running: boolean } {
  const { baseMs, enabled = true, initial = true, key = "" } = opts;
  const runRef = useRef(run);
  runRef.current = run;
  const poller = useRef<Poller | null>(null);
  const ranFor = useRef<string | null>(null); // key whose first run completed
  const [running, setRunning] = useState(enabled || initial);

  useEffect(() => {
    const p = createPoller({
      run: async (signal) => {
        setRunning(true);
        try {
          return await runRef.current(signal);
        } finally {
          // An aborted run (StrictMode remount, key change) does not count as the key's first run.
          if (!signal.aborted) {
            ranFor.current = key;
            setRunning(false);
          }
        }
      },
      baseMs: enabled ? baseMs : undefined,
      isHidden: () => document.visibilityState === "hidden",
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    poller.current = p;
    const onVisibility = () => (document.visibilityState === "hidden" ? p.hidden() : p.visible());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", p.online);
    // New key: first run (unless disabled with initial:false). Same key: resuming a schedule fetches at once, while
    // stopping one (enabled:false or no baseMs) only drops the timer.
    const resumes = enabled && baseMs !== undefined;
    if (ranFor.current !== key ? enabled || initial : resumes) p.start();
    return () => {
      p.stop();
      setRunning(false);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", p.online);
      poller.current = null;
    };
  }, [baseMs, enabled, initial, key]);

  const reload = useCallback(() => poller.current?.reload(), []);
  return { reload, running };
}
