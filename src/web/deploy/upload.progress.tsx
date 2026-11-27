import { Progress } from "@/web/components/ui/progress";
import { tDeploy } from "@/web/i18n/en.deploy";
import { formatBytes } from "@/web/shared/format";
import type { UploadPhase } from "./deploy.api";
import { CHUNK_MAX_RETRIES, uploadProgress } from "./deploy.upload";

const t = tDeploy.upload;

/** Info-toned bar for long-running progress (tokens only). */
export const INFO_PROGRESS = "bg-info-subtle [&>[data-slot=progress-indicator]]:bg-info";

/** One line telling what the upload does right now (retrying, hashing, completing…). */
function phaseLine(phase: UploadPhase): string {
  switch (phase.kind) {
    case "preparing":
      return t.preparing;
    case "retrying":
      return t.retrying(phase.sec, phase.attempt, CHUNK_MAX_RETRIES);
    case "completing":
      return t.completing;
    case "waiting_busy":
      return t.waitingBusy;
    default:
      return phase.current === null ? "" : t.hashing(phase.current + 1, phase.chunks);
  }
}

/** Bar + "42% · 37.5 MB of 89.2 MB · 2.1 MB/s" + phase line; `lastSending` keeps the bar while retrying. */
export function UploadProgress({
  file,
  phase,
  lastSending,
  elapsedMs,
}: {
  file: File;
  phase: UploadPhase;
  lastSending: Extract<UploadPhase, { kind: "sending" }> | null;
  elapsedMs: number;
}) {
  const done = phase.kind === "completing" || phase.kind === "waiting_busy" ? file.size : (lastSending?.doneBytes ?? 0);
  const { pct, bytesPerSec } = uploadProgress(done, file.size, lastSending?.sessionBytes ?? 0, elapsedMs);
  const line = phaseLine(phase);
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={pct} aria-label={t.progressLabel} aria-valuetext={`${pct}%`} className={INFO_PROGRESS} />
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
        <span>{t.progress(pct, formatBytes(done), formatBytes(file.size))}</span>
        {bytesPerSec > 0 && <span>{t.speed(formatBytes(bytesPerSec))}</span>}
      </div>
      {line && (
        <p
          className={phase.kind === "retrying" ? "text-xs text-warning" : "text-xs text-muted-foreground"}
          aria-live="polite"
        >
          {line}
        </p>
      )}
    </div>
  );
}
