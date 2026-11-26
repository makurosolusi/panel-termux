// State of the deploy upload card: pick → (confirm other file) → upload with phases → job page, or a failure
// that can be resumed. The unfinished server upload (`GET /sites/:name/uploads/active`) survives reloads.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DEPLOY_MAX_BYTES, type UploadState } from "@/shared/deploy.types";
import { formatBytes } from "@/shared/format.id";
import { idDeploy } from "@/web/i18n/id.deploy";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobPath, siteUrl } from "@/web/site/site.api";
import { cancelUpload, DEPLOY_ERROR_CODES, runUpload, type UploadPhase } from "./deploy.api";
import { type UploadFailure, uploadFailure } from "./deploy.state";
import { resumeChoice } from "./deploy.upload";

const t = idDeploy.upload;

/** Card state; `startedAt`/`now` drive the speed figure. */
export type UploaderState =
  | { kind: "idle" }
  | { kind: "confirm_different"; file: File; active: UploadState }
  | {
      kind: "running";
      file: File;
      phase: UploadPhase;
      /** Last byte counts, kept while retrying/completing. */
      lastSending: Extract<UploadPhase, { kind: "sending" }> | null;
      startedAt: number;
      now: number;
    }
  | { kind: "failed"; file: File; failure: UploadFailure; uploadId: string | null };

/** Problem of a picked file before anything is sent, or null. */
export function fileProblem(file: { size: number }): string | null {
  if (file.size === 0) return t.empty;
  if (file.size > DEPLOY_MAX_BYTES) return t.tooLarge(formatBytes(DEPLOY_MAX_BYTES));
  return null;
}

/** Upload card controller of one site. */
export function useUploader(site: string) {
  const navigate = useNavigate();
  const active = useApiQuery<UploadState | null>(siteUrl(site, "/uploads/active"));
  const [state, setState] = useState<UploaderState>({ kind: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []); // leaving the page stops the transfer; the server keeps chunks

  const start = async (file: File, resumeId: string | null) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    lastId.current = resumeId;
    const startedAt = Date.now();
    let lastSending: Extract<UploadPhase, { kind: "sending" }> | null = null;
    const onPhase = (phase: UploadPhase) => {
      if (phase.kind === "sending") {
        lastId.current = phase.uploadId;
        lastSending = phase;
      }
      setState({ kind: "running", file, phase, lastSending, startedAt, now: Date.now() });
    };
    try {
      navigate(jobPath(await runUpload(site, file, resumeId, c.signal, onPhase)));
    } catch (err) {
      if (c.signal.aborted) return; // cancelled or left the page
      const failure = uploadFailure(err);
      setState({ kind: "failed", file, failure, uploadId: failure.next === "resume" ? lastId.current : null });
      active.reload();
    }
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return void toast.error(problem, { duration: ERROR_TOAST_MS });
    const current = active.data ?? null;
    const choice = resumeChoice(current, file);
    if (choice === "different" && current) return setState({ kind: "confirm_different", file, active: current });
    void start(file, choice === "resume" && current ? current.uploadId : null);
  };

  const cancel = async () => {
    ctrl.current?.abort();
    const id = lastId.current ?? active.data?.uploadId ?? null;
    lastId.current = null;
    setState({ kind: "idle" });
    if (!id) return;
    try {
      await cancelUpload(id);
      toast.success(t.cancelled);
    } catch (err) {
      // the server also expires unfinished uploads after 1 h, so a failed DELETE leaves nothing permanent
      toast.error(apiErrorMessage(err, DEPLOY_ERROR_CODES), { duration: ERROR_TOAST_MS });
    }
    active.reload();
  };

  return {
    state,
    active: active.data ?? null,
    pick,
    cancel,
    /** Continues a paused upload (uploadId kept) or starts the same file again. */
    resume: () => state.kind === "failed" && void start(state.file, state.uploadId),
    confirmDifferent: () => state.kind === "confirm_different" && void start(state.file, null),
    /** Closes the "other file" question; a no-op once the upload started from it. */
    dismiss: () => setState((s) => (s.kind === "confirm_different" ? { kind: "idle" } : s)),
  };
}
