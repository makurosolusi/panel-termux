// One shared clock for every RelativeTime (PLAN/01 §3.3): a single interval while anyone subscribes and the tab is
// visible. The only `setInterval` allowed in src/web (guard test W7).
import { useSyncExternalStore } from "react";

/** How often relative times ("3 mnt lalu") re-render. */
export const NOW_TICK_MS = 15_000;

let now = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  now = new Date();
  for (const l of listeners) l();
}

function sync() {
  const want = listeners.size > 0 && document.visibilityState !== "hidden";
  if (want && timer === null) {
    tick(); // coming back to the tab: catch up at once
    timer = setInterval(tick, NOW_TICK_MS);
  } else if (!want && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", sync);
    sync();
  };
}

const snapshot = () => now;

/** Current time, refreshed every NOW_TICK_MS for all subscribers at once (paused while the tab is hidden). */
export function useNow(): Date {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
