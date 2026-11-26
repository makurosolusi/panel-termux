import { cn } from "cn";
import type { DomainCheck } from "@/shared/monitor.types";
import { idHistory } from "@/web/i18n/id.history";

const t = idHistory.heartbeat;

/** Slots in the strip (the server sends up to 30 newest checks, oldest first). */
export const HEARTBEAT_SLOTS = 30;

/** A check counts as healthy when the domain answered below 500 (same line as `domainVerdict`). */
export const checkHealthy = (c: DomainCheck): boolean => c.status !== null && c.status < 500;

/** Healthy count and total of the last checks. */
export function heartbeatSummary(checks: readonly DomainCheck[]): { ok: number; total: number } {
  const last = checks.slice(-HEARTBEAT_SLOTS);
  return { ok: last.filter(checkHealthy).length, total: last.length };
}

/** Bars for the strip, oldest first, left-padded with "none" so the newest check is always at the right. */
export function heartbeatBars(checks: readonly DomainCheck[]): ("ok" | "fail" | "none")[] {
  const last = checks.slice(-HEARTBEAT_SLOTS);
  const pad = Array.from({ length: HEARTBEAT_SLOTS - last.length }, () => "none" as const);
  return [...pad, ...last.map((c) => (checkHealthy(c) ? ("ok" as const) : ("fail" as const)))];
}

const BAR = { ok: "bg-success", fail: "bg-danger", none: "bg-muted" } as const;

/** 30-check heartbeat strip (2×12 px bars, `role="img"` + summary); on phones the summary text "28/30 sehat". */
export function HeartbeatStrip({ checks }: { checks: readonly DomainCheck[] | undefined }) {
  if (!checks || checks.length === 0) return <span className="text-xs text-muted-foreground">{t.none}</span>;
  const { ok, total } = heartbeatSummary(checks);
  return (
    <>
      <span role="img" aria-label={t.summary(ok, total)} className="flex items-center gap-px max-md:hidden">
        {heartbeatBars(checks).map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots, position is the identity
          <span key={i} className={cn("h-3 w-0.5 rounded-full", BAR[b])} />
        ))}
      </span>
      <span className={cn("text-xs tabular-nums md:hidden", ok < total && "text-warning")}>{t.short(ok, total)}</span>
    </>
  );
}
