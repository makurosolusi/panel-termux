import { cn } from "cn";
import { CheckCircle2Icon, CircleIcon, LoaderIcon, MinusCircleIcon, Undo2Icon, XCircleIcon } from "lucide-react";
import type { JobStep, JobStepStatus } from "@/shared/site.types";
import { id } from "@/web/i18n/id";
import type { Tone } from "@/web/panel/panel.status";
import { stepTone } from "./job.state";

const ICON: Record<JobStepStatus, typeof CircleIcon> = {
  pending: CircleIcon,
  running: LoaderIcon,
  done: CheckCircle2Icon,
  failed: XCircleIcon,
  rolled_back: Undo2Icon,
  skipped: MinusCircleIcon,
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

/** Ordered job steps with a status icon each and the step message (e.g. why DNS was skipped). */
export function JobSteps({ steps }: { steps: JobStep[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s) => {
        const Icon = ICON[s.status];
        return (
          <li key={s.key} className="flex items-start gap-3">
            <Icon
              className={cn(
                "mt-0.5 size-5 shrink-0",
                TONE_TEXT[stepTone(s.status)],
                s.status === "running" && "animate-spin",
              )}
              aria-hidden
            />
            <div className="flex min-w-0 flex-col">
              <span className={cn("text-sm", s.status === "pending" && "text-muted-foreground")}>
                {s.label}
                <span className="sr-only"> — {id.site.job.stepStatuses[s.status]}</span>
              </span>
              {s.message && <span className="text-xs break-words text-muted-foreground">{s.message}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
