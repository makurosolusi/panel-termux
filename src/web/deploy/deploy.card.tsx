import { AlertCircleIcon, FileUpIcon, PlayIcon, UploadIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import type { SiteDetail } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import { ConfirmAction } from "@/web/components/confirm-action";
import { CopyButton } from "@/web/components/copy-button";
import { Button } from "@/web/components/ui/button";
import { tDeploy } from "@/web/i18n/en.deploy";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { blockerText } from "./deploy.state";
import { missingChunks } from "./deploy.upload";
import type { Uploader } from "./deploy.uploader";
import { UploadProgress } from "./upload.progress";

const t = tDeploy.upload;

/** Copyable build commands for both supported targets. */
function BuildHelp() {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-muted-foreground">{t.help}</p>
      <ul className="flex flex-col gap-2">
        {t.targets.map((target) => (
          <li key={target.cmd} className="flex flex-col gap-1">
            <div className="flex items-start gap-1 rounded-md bg-muted px-2 py-1.5">
              <code className="min-w-0 flex-1 font-mono break-all">{target.cmd}</code>
              <CopyButton value={target.cmd} />
            </div>
            <span className="text-muted-foreground">{target.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Upload card of #deploy: pick binary → per-chunk sha → resumable chunked upload → job page. */
export function DeployCard({ site, up }: { site: SiteDetail; up: Uploader }) {
  const input = useRef<HTMLInputElement>(null);
  const { state, active } = up;
  const blocker = blockerText(site);
  const running = state.kind === "running";
  const pickButton = (label: string, variant: "default" | "outline" = "default") => (
    <Button variant={variant} disabled={Boolean(blocker)} onClick={() => input.current?.click()}>
      <FileUpIcon aria-hidden />
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t.title}</h3>
        <p className="text-muted-foreground">{t.restartNote}</p>
        {blocker && <p className="text-warning">{blocker}</p>}
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          up.pick(e.target.files?.[0]);
          e.target.value = ""; // allow picking the same file again
        }}
      />

      {state.kind === "idle" && active && (
        <div className="flex flex-col gap-2 rounded-md border border-info/25 bg-info-subtle p-3">
          <p className="font-medium break-words">
            {t.pending(
              active.fileName,
              formatBytes(active.sizeBytes),
              active.chunks - missingChunks(active).length,
              active.chunks,
            )}
            {" · "}
            {t.expiresAt(formatDateTime(active.expiresAt))}
          </p>
          <p className="text-xs text-muted-foreground">{t.pendingHelp}</p>
          <div className="flex flex-wrap gap-2">
            {pickButton(t.pickSame)}
            <Button variant="outline" onClick={() => void up.cancel()}>
              <XIcon aria-hidden />
              {t.cancel}
            </Button>
          </div>
        </div>
      )}

      {(state.kind === "running" || state.kind === "failed") && (
        <p className="font-medium break-all">
          {state.file.name} <span className="font-normal text-muted-foreground">· {formatBytes(state.file.size)}</span>
        </p>
      )}
      {state.kind === "running" && (
        <UploadProgress
          file={state.file}
          phase={state.phase}
          lastSending={state.lastSending}
          elapsedMs={state.now - state.startedAt}
        />
      )}
      {state.kind === "failed" && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle p-3">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p className="break-words">
            <CodeText>{state.failure.message}</CodeText>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {state.kind === "idle" && !active && pickButton(t.pick)}
        {state.kind === "failed" && state.failure.next !== "repick" && (
          <Button onClick={up.resume}>
            {state.failure.next === "resume" ? <PlayIcon aria-hidden /> : <UploadIcon aria-hidden />}
            {state.failure.next === "resume" ? t.resumeButton : t.retry}
          </Button>
        )}
        {state.kind === "failed" && pickButton(t.pick, state.failure.next === "repick" ? "default" : "outline")}
        {(running || (state.kind === "failed" && state.uploadId)) && (
          <Button variant="outline" onClick={() => void up.cancel()}>
            <XIcon aria-hidden />
            {t.cancel}
          </Button>
        )}
      </div>

      <ConfirmAction
        open={state.kind === "confirm_different"}
        onOpenChange={(open) => !open && up.dismiss()}
        title={t.differentTitle}
        description={state.kind === "confirm_different" ? t.differentBody(state.active.fileName) : ""}
        confirmLabel={t.differentConfirm}
        onConfirm={async () => up.confirmDifferent()}
      />
      <BuildHelp />
    </div>
  );
}
