import { UploadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DEPLOY_MAX_BYTES } from "@/shared/deploy.types";
import { Button } from "@/web/components/ui/button";
import { Progress } from "@/web/components/ui/progress";
import { id } from "@/web/i18n/id";
import { apiErrorMessage } from "@/web/shared/api.client";
import { formatBytes } from "@/web/shared/format";
import { jobPath } from "@/web/site/site.api";
import { cancelUpload, DEPLOY_ERROR_CODES, uploadBinary } from "./deploy.api";
import { sha256Hex, uploadProgress } from "./deploy.upload";

const t = id.deploy;

/** Where the card is: no file, hashing, ready to send, sending chunks, or waiting for `complete`. */
type Phase =
  | { kind: "idle" }
  | { kind: "hashing"; file: File }
  | { kind: "ready"; file: File; sha256: string }
  | { kind: "uploading"; file: File; sha256: string; sent: number; startedAt: number; now: number }
  | { kind: "completing"; file: File; sha256: string };

/** Checks the picked file before hashing; returns an error message or null. */
function fileProblem(file: File): string | null {
  if (file.size === 0) return t.empty;
  if (file.size > DEPLOY_MAX_BYTES) return t.tooLarge(formatBytes(DEPLOY_MAX_BYTES));
  return null;
}

function UploadProgress({ phase }: { phase: Extract<Phase, { kind: "uploading" }> }) {
  const { pct, bytesPerSec } = uploadProgress(phase.sent, phase.file.size, phase.now - phase.startedAt);
  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      <Progress value={pct} aria-label={t.uploading} />
      <span className="text-xs tabular-nums text-muted-foreground">
        {t.progress(pct, formatBytes(phase.sent), formatBytes(phase.file.size), formatBytes(bytesPerSec))}
      </span>
    </div>
  );
}

/** File picker → SHA-256 → chunked upload with progress and cancel → job page of the deploy. */
export function DeployCard({ site }: { site: string }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const uploadId = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => ctrl.current?.abort(), []); // leaving the page stops hashing/upload

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return toast.error(problem);
    setPhase({ kind: "hashing", file });
    try {
      const sha256 = await sha256Hex(file);
      setPhase((p) => (p.kind === "hashing" && p.file === file ? { kind: "ready", file, sha256 } : p));
    } catch {
      toast.error(t.hashFailed); // only cause in practice: crypto.subtle missing outside https/localhost
      setPhase({ kind: "idle" });
    }
  };

  const start = async (file: File, sha256: string) => {
    const c = new AbortController();
    ctrl.current = c;
    uploadId.current = null;
    const startedAt = Date.now();
    setPhase({ kind: "uploading", file, sha256, sent: 0, startedAt, now: startedAt });
    try {
      const jobId = await uploadBinary(site, file, sha256, c.signal, {
        onStarted: (u) => {
          uploadId.current = u;
        },
        onProgress: (sent) => {
          if (sent < file.size) setPhase({ kind: "uploading", file, sha256, sent, startedAt, now: Date.now() });
          else setPhase({ kind: "completing", file, sha256 });
        },
      });
      navigate(jobPath(jobId));
    } catch (err) {
      if (c.signal.aborted) return; // cancel() already reset the card
      toast.error(`${t.failed} ${apiErrorMessage(err, DEPLOY_ERROR_CODES)}`);
      setPhase({ kind: "ready", file, sha256 });
    }
  };

  const cancel = async () => {
    ctrl.current?.abort();
    const u = uploadId.current;
    uploadId.current = null;
    if (phase.kind === "uploading") setPhase({ kind: "ready", file: phase.file, sha256: phase.sha256 });
    if (!u) return;
    try {
      await cancelUpload(u);
      toast.success(t.cancelled);
    } catch (err) {
      toast.error(apiErrorMessage(err, DEPLOY_ERROR_CODES)); // server also expires unfinished uploads after 1 h
    }
  };

  const busy = phase.kind === "uploading" || phase.kind === "completing";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{t.help}</p>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      {phase.kind !== "idle" && (
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <span className="break-all font-medium">{t.file(phase.file.name, formatBytes(phase.file.size))}</span>
          {phase.kind === "hashing" ? (
            <span className="text-muted-foreground" aria-live="polite">
              {t.hashing}
            </span>
          ) : (
            <span className="break-all font-mono text-xs text-muted-foreground">
              {t.checksum} {phase.sha256}
            </span>
          )}
        </div>
      )}
      {phase.kind === "uploading" && <UploadProgress phase={phase} />}
      {phase.kind === "completing" && (
        <span className="text-muted-foreground" aria-live="polite">
          {t.completing}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {!busy && (
          <Button variant="outline" disabled={phase.kind === "hashing"} onClick={() => inputRef.current?.click()}>
            {phase.kind === "idle" ? t.pick : t.change}
          </Button>
        )}
        {phase.kind === "ready" && (
          <Button onClick={() => void start(phase.file, phase.sha256)}>
            <UploadIcon aria-hidden />
            {t.start}
          </Button>
        )}
        {phase.kind === "uploading" && (
          <Button variant="outline" onClick={() => void cancel()}>
            <XIcon aria-hidden />
            {t.cancel}
          </Button>
        )}
      </div>
    </div>
  );
}
