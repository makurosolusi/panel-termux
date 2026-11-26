import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { JobAccepted, SiteCheckRequest, SiteCheckResult } from "@/shared/site.types";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { runApiAction } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";

/** Panel error codes with the site overrides (409 `busy` = another change is running). */
export const SITE_ERROR_CODES: Readonly<Record<string, string>> = { ...id.panel.errorCodes, ...id.site.errorCodes };

/** `/api/panel/sites/<name>` (+ `rest`), name URL-encoded. */
export const siteUrl = (name: string, rest = ""): string => panelUrl(`/sites/${encodeURIComponent(name)}${rest}`);

/** SPA path of a job's progress view. */
export const jobPath = (jobId: string): string => `/panel/jobs/${encodeURIComponent(jobId)}`;

/** Runs a site mutation, toasting `success` or the site-mapped error; resolves to whether it succeeded. */
export const runSiteAction = (mutation: () => Promise<unknown>, success: string): Promise<boolean> =>
  runApiAction(mutation, success, SITE_ERROR_CODES);

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
    toast.error(apiErrorMessage(err, codes));
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
