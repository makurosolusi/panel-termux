import { useCallback, useEffect, useState } from "react";
import { DevApiError, devFetch } from "./dev.api";

/** State of a GET; `data` is kept while refreshing so auto-refresh does not flash skeletons. */
export type DevQuery<T> = { data: T | undefined; error: DevApiError | undefined; loading: boolean; reload: () => void };

/** GETs `url` (re-fetching when it changes, on `reload()`, and every `refreshMs` when given). */
export function useDevQuery<T>(url: string, refreshMs?: number): DevQuery<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<DevApiError>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the reload trigger, intentionally unused inside
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    devFetch<T>("GET", url, undefined, ctrl.signal).then(
      (next) => {
        setData(next);
        setError(undefined);
        setLoading(false);
      },
      (cause: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer request or unmount
        setError(cause instanceof DevApiError ? cause : new DevApiError("network", null, null, null, { cause }));
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
