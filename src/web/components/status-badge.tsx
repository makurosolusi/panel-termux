import { cn } from "cn";
import { type StatusTone, TONE_CLASS, TONE_FILL, toneForStatus } from "./status.tone";
import { type StatusKey, statusView } from "./status.vocab";

/**
 * Status pill with a leading dot, e.g. "● Berjalan". Pass `state` (canonical key: label, tone and pulse from the
 * status vocabulary; `label` may override the text, e.g. "Gagal · 3×"). `status`/`tone` are the legacy inputs kept
 * until every caller maps to a `StatusKey`; `pulse` animates the dot (static under reduced motion).
 */
export function StatusBadge({
  state,
  label,
  status,
  tone,
  pulse,
  className,
}: {
  state?: StatusKey;
  label?: string;
  status?: string;
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  const view = state ? statusView(state) : undefined;
  const t = tone ?? view?.tone ?? (status ? toneForStatus(status) : "neutral");
  const animate = pulse ?? view?.pulse ?? false;
  return (
    <span
      title={view?.help ?? undefined}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[t],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", TONE_FILL[t], animate && "motion-safe:animate-pulse")} aria-hidden />
      {label ?? view?.label}
    </span>
  );
}
