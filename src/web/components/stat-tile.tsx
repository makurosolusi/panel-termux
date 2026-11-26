import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { type StatusTone, TONE_FILL, TONE_TEXT } from "./status.tone";

/** Percent at/above which a usage bar turns warning / danger. Override per tile (e.g. disk 85/95). */
export type Thresholds = { warn: number; danger: number };
export const DEFAULT_THRESHOLDS: Thresholds = { warn: 75, danger: 90 };

/** Tone of a usage percentage against thresholds. */
export const usageTone = (pct: number, th: Thresholds = DEFAULT_THRESHOLDS): StatusTone =>
  pct >= th.danger ? "danger" : pct >= th.warn ? "warning" : "success";

/**
 * Compact KPI: small label (+icon), tabular value, optional hint line and usage bar. `progress` (0–100) colours the
 * bar by `thresholds`; `tone` colours the value (e.g. load per core). Dense by design — several fit in one row.
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  tone,
  progress,
  thresholds,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
  tone?: StatusTone;
  progress?: number;
  thresholds?: Thresholds;
  className?: string;
}) {
  const pct = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  const barTone = pct === undefined ? undefined : usageTone(pct, thresholds);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-4 py-3 shadow-xs", className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {label}
      </span>
      <span className={cn("text-xl font-semibold break-words tabular-nums", tone && TONE_TEXT[tone])}>{value}</span>
      {pct !== undefined && barTone && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", TONE_FILL[barTone])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {hint && <span className="line-clamp-2 text-xs text-muted-foreground tabular-nums">{hint}</span>}
    </div>
  );
}
