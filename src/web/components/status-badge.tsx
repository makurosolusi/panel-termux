import { cn } from "cn";
import { type StatusTone, TONE_CLASS, TONE_FILL, toneForStatus } from "./status.tone";

/**
 * Status pill with a leading dot, e.g. "● Berjalan". Pass `status` to colour it from the shared status→tone table,
 * or `tone` to decide yourself; `pulse` animates the dot for in-flight states (static under reduced motion).
 */
export function StatusBadge({
  label,
  status,
  tone,
  pulse = false,
  className,
}: {
  label: string;
  status?: string;
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  const t = tone ?? (status ? toneForStatus(status) : "neutral");
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[t],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", TONE_FILL[t], pulse && "animate-pulse")} aria-hidden />
      {label}
    </span>
  );
}
