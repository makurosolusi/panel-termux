import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "./api.client";

/** State of a GET; `data` is kept while refreshing so auto-refresh does not flash skeletons. */
export type ApiQuery<T> = { data: T | undefined; error: ApiError | undefined; loading: boolean; reload: () => void };

/** GETs `url` (re-fetching when it changes, on `reload()`, and every `refreshMs` when given). */
export function useApiQuery<T>(url: string, refreshMs?: number): ApiQuery<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the reload trigger, intentionally unused inside
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    apiFetch<T>("GET", url, undefined, ctrl.signal).then(
      (next) => {
        setData(next);
        setError(undefined);
        setLoading(false);
      },
      (cause: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer request or unmount
        setError(cause instanceof ApiError ? cause : new ApiError("network", null, null, null, { cause }));
        setLoading(false);
      },
    );
    return () => ctrl.abort();
  }, [url, nonce]);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, reload]);

  return { data, error, loading, reload };
}
