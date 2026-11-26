import { cn } from "cn";
import { TONE_TEXT } from "./status.tone";
import { type StatusKey, statusView } from "./status.vocab";

/** Status as an icon (job steps, problem lists, audit rows): tone colour, spins when in flight, label for readers. */
export function StatusIcon({ state, className }: { state: StatusKey; className?: string }) {
  const view = statusView(state);
  const Icon = view.icon;
  return (
    <>
      <Icon
        className={cn("size-4 shrink-0", TONE_TEXT[view.tone], view.pulse && "motion-safe:animate-spin", className)}
        aria-hidden
      />
      <span className="sr-only">{view.label}</span>
    </>
  );
}
