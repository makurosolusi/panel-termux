import { createElement, useEffect, useState } from "react";
import { toast } from "sonner";
import type { FixKey, FixPreview, FixResult, Pm2RestartResult } from "@/shared/fix.types";
import type { Integration, JobAccepted, SiteCheckRequest, SiteCheckResult } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import { idServiceStart } from "@/web/i18n/id.service-start";
import { idSite } from "@/web/i18n/id.site";
import { panelUrl } from "@/web/panel/panel.api";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { ApiError, apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { startService } from "@/web/shared/service-start";

/** Error copy of the site API by code (409 `busy` = another change is running). */
export const SITE_ERROR_CODES: Readonly<Record<string, string>> = idSite.errorCodes;

/** `/api/panel/sites/<name>` (+ `rest`), name URL-encoded. */
export const siteUrl = (name: string, rest = ""): string => panelUrl(`/sites/${encodeURIComponent(name)}${rest}`);

/** SPA path of a job's progress view. */
export const jobPath = (jobId: string): string => `/panel/jobs/${encodeURIComponent(jobId)}`;

/** Error codes meaning "pm2 is down": their toast carries a "Jalankan pm2" action (PLAN/06 §6.1). */
const PM2_DOWN: ReadonlySet<string> = new Set(["pm2_not_running", "pm2_unavailable"]);

/** Error toast of a site action (code spans as <code>); pm2 down adds a "Jalankan pm2" button. */
export function toastSiteError(err: unknown, codes: Readonly<Record<string, string>> = SITE_ERROR_CODES): void {
  const pm2Down = err instanceof ApiError && err.code !== null && PM2_DOWN.has(err.code);
  toast.error(createElement(CodeText, null, apiErrorMessage(err, codes)), {
    duration: ERROR_TOAST_MS,
    action: pm2Down ? { label: idServiceStart.label("pm2"), onClick: () => void startService("pm2") } : undefined,
  });
}

/** Runs a site mutation, toasting `success` or the site-mapped error; resolves to whether it succeeded. */
export async function runSiteAction(mutation: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await mutation();
    toast.success(success);
    return true;
  } catch (err) {
    toastSiteError(err);
    return false;
  }
}

/** Starts a job (202 `{ jobId }`); toasts the error (mapped via `codes`) and resolves to null on failure. */
export async function startJob(
  method: "POST" | "DELETE",
  url: string,
  body?: unknown,
  codes: Readonly<Record<string, string>> = SITE_ERROR_CODES,
): Promise<string | null> {
  try {
    return (await apiFetch<JobAccepted>(method, url, body)).jobId;
  } catch (err) {
    toastSiteError(err, codes);
    return null;
  }
}

/** Delay before `/sites/check` runs after the last keystroke. */
const CHECK_DEBOUNCE_MS = 400;

/**
 * Debounced live `/sites/check` for `req` (null = nothing to check yet). `result` always belongs to the current
 * values: it is cleared while a newer check is pending. A failed request reports no result and the error.
 */
export function useSiteCheck(req: SiteCheckRequest | null) {
  const [result, setResult] = useState<SiteCheckResult>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const key = req ? JSON.stringify(req) : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the serialized `req`; depending on the object would re-run every render
  useEffect(() => {
    setResult(undefined);
    setError(undefined);
    if (!req) return setChecking(false);
    setChecking(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<SiteCheckResult>("POST", panelUrl("/sites/check"), req, ctrl.signal).then(
        (r) => {
          setResult(r);
          setChecking(false);
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return; // superseded by newer input
          setError(apiErrorMessage(err, SITE_ERROR_CODES));
          setChecking(false);
        },
      );
    }, CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);

  return { result, error, checking };
}

// ---- integration fixes (PLAN/06 §5.2) ----

/** Error copy of the fix endpoints: the fix-specific text wins over the site one (e.g. `busy`). */
export const FIX_ERROR_CODES: Readonly<Record<string, string>> = { ...SITE_ERROR_CODES, ...idSite.setup.errors };

const integrationUrl = (rest: string) => panelUrl(`/integration${rest}`);

/** POST /integration/fixes/:key/preview (writes nothing). */
export const previewFix = (key: FixKey): Promise<FixPreview> =>
  apiFetch<FixPreview>("POST", integrationUrl(`/fixes/${key}/preview`));

/** `expect` of the apply request: path → sha the preview was made from (409 `changed` when the file moved on). */
export const fixExpect = (p: FixPreview): Record<string, string> =>
  Object.fromEntries(p.files.map((f) => [f.path, f.sha]));

/** POST /integration/backups/:id/restore. */
export const restoreFix = (id: string, body: { force?: boolean; restart?: boolean }): Promise<FixResult> =>
  apiFetch<FixResult>("POST", integrationUrl(`/backups/${encodeURIComponent(id)}/restore`), body);

/** POST /integration/pm2/restart: restart pm2, then wait until every app that ran is back. */
export const restartPm2 = (): Promise<Pm2RestartResult> =>
  apiFetch<Pm2RestartResult>("POST", integrationUrl("/pm2/restart"));

/** Outcome of applying previews in order: how many went through, the newest integration, the first error. */
export type FixRun = { done: number; integration: Integration | null; error: unknown };

/** Applies the previews one by one (no batch endpoint), stopping at the first failure. */
export async function applyFixes(previews: readonly FixPreview[]): Promise<FixRun> {
  let integration: Integration | null = null;
  for (const [n, p] of previews.entries()) {
    try {
      const r = await apiFetch<FixResult>("POST", integrationUrl(`/fixes/${p.key}`), { expect: fixExpect(p) });
      integration = r.integration;
    } catch (error) {
      return { done: n, integration, error };
    }
  }
  return { done: previews.length, integration, error: null };
}

/** Toast of a fix run: done (past tense), "Tidak diterapkan" as a warning, other errors by code. */
export function toastFixRun(run: FixRun): void {
  const t = idSite.setup;
  if (run.error === null) {
    toast.success(run.done > 1 ? t.doneAll(run.done) : t.done);
    return;
  }
  if (run.error instanceof ApiError && run.error.code === "validation_failed") {
    toast.warning(t.notApplied, { duration: ERROR_TOAST_MS });
    return;
  }
  toastSiteError(run.error, FIX_ERROR_CODES);
}
