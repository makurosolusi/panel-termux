// Rule state the sampler advances between ticks (PLAN/02 §3.1): probe streaks, restart rings, boot notices.
import type { Problem } from "../../shared/monitor.types";
import type { DomainHealth } from "../../shared/panel.types";
import { CRASH_LOOP_WINDOW_MS, REBOOT_UPTIME_MS, SERVICE_LOOP_TICKS } from "../panel/overview.problems";
import { problem } from "../panel/overview.rules";
import type { MonitorSnapshot, MonitorState } from "./monitor.contract";

const HTTP_SERVER_ERROR = 500;

/** A probe that counts towards a domain's failure streak: no answer or a 5xx. */
export const isProbeFailure = (status: number | null): boolean => status === null || status >= HTTP_SERVER_ERROR;

/** Sampler: stores one probe result and advances the domain's failure streak. */
export function recordProbe(state: MonitorState, hostname: string, last: DomainHealth): void {
  const prev = state.domains.get(hostname)?.failures ?? 0;
  state.domains.set(hostname, { failures: isProbeFailure(last.status) ? prev + 1 : 0, last });
}

const intentional = (state: MonitorState, key: string, now: number) => (state.intentional.get(key) ?? 0) > now;

/** Sampler, once per tick before computeProblems: advances the runit and pm2 restart rings. */
export function observe(state: MonitorState, snap: MonitorSnapshot, now: number, intervalSec: number): void {
  for (const [k, until] of state.intentional) if (until <= now) state.intentional.delete(k);
  if (snap.services.ok) {
    for (const s of snap.services.value) {
      const ring = state.serviceRuns.get(s.name) ?? [];
      const restarted = s.state === "run" && s.pid !== null && (s.uptimeSec ?? Infinity) < intervalSec;
      if (!s.wantUp || intentional(state, `service:${s.name}`, now) || (s.state === "run" && !restarted)) {
        state.serviceRuns.delete(s.name);
      } else if (restarted && s.pid !== null && ring.at(-1)?.pid !== s.pid) {
        state.serviceRuns.set(s.name, [...ring, { pid: s.pid, at: now }].slice(-SERVICE_LOOP_TICKS));
      }
    }
  }
  if (snap.apps.ok) {
    for (const a of snap.apps.value) {
      const ring = (state.appRestarts.get(a.name) ?? []).filter((e) => now - e.at <= CRASH_LOOP_WINDOW_MS);
      const last = ring.at(-1);
      const reset = intentional(state, `app:${a.name}`, now) || (last !== undefined && a.restarts < last.restarts);
      state.appRestarts.set(
        a.name,
        reset ? [{ at: now, restarts: a.restarts }] : [...ring, { at: now, restarts: a.restarts }],
      );
    }
  }
}

/** Boot notices (stored closed, sent once): host reboot by uptime, else a missing clean-shutdown marker. */
export function bootNotices({ cleanShutdown, uptimeSec }: { cleanShutdown: boolean; uptimeSec: number }): Problem[] {
  if (uptimeSec * 1000 < REBOOT_UPTIME_MS)
    return [problem("host_rebooted", "host", "warning", { uptimeMin: Math.floor(uptimeSec / 60) })];
  return cleanShutdown ? [] : [problem("panel_restarted_unexpectedly", "panel", "warning")];
}
