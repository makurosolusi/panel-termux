import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import type { JobStep } from "@/shared/job.types";
import { CopyButton } from "@/web/components/copy-button";
import { StatusIcon } from "@/web/components/status-icon";
import { Button } from "@/web/components/ui/button";
import { idJob } from "@/web/i18n/id.job";
import { durationText, outcomeText, stepDurationMs, stepLabel } from "./job.state";
import { JOB_STEP_STATUS_KEY } from "./job.status-key";

const t = idJob;

/** Copy text of a step's technical detail and log lines. */
const detailText = (s: JobStep) => [s.detail, ...(s.log ?? [])].filter(Boolean).join("\n");

function Step({ step, last }: { step: JobStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ms = stepDurationMs(step, Date.now()); // running steps re-render with every 1 s poll
  const outcome = outcomeText(step.code, step.params);
  const details = detailText(step);
  const muted = step.status === "pending" || step.status === "skipped";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-6 bottom-0 left-[9px] w-px bg-border" />}
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
        <StatusIcon state={JOB_STEP_STATUS_KEY[step.status]} className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-col gap-x-3 sm:flex-row sm:items-baseline sm:justify-between">
          <span className={cn("text-sm font-medium", muted && "font-normal text-muted-foreground")}>
            {stepLabel(step)}
          </span>
          {ms !== null && <span className="text-xs text-muted-foreground tabular-nums">{durationText(ms)}</span>}
        </div>
        {outcome && (
          <p className={cn("text-xs break-words", step.status === "failed" ? "text-danger" : "text-muted-foreground")}>
            {outcome}
          </p>
        )}
        {details && (
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 self-start text-xs text-muted-foreground"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            >
              {t.details}
              <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
            {open && (
              <div id={panelId} className="flex items-start gap-1 rounded-md bg-muted p-2">
                <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap break-all">
                  {details}
                </pre>
                <CopyButton value={details} label={t.copy} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Vertical stepper of a job: icon (status for readers), coded label + outcome, duration, expandable detail/log. */
export function JobSteps({ steps }: { steps: JobStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a job's step list never reorders; keys may repeat in cleanup jobs
        <Step key={`${i}-${s.key}`} step={s} last={i === steps.length - 1} />
      ))}
    </ol>
  );
}
