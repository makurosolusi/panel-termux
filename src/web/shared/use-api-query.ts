import { useState } from "react";
import { ApiError, apiFetch } from "./api.client";
import type { PollResult } from "./poller";
import { usePoller } from "./use-poller";

/** State of a GET; `data` is kept while refreshing (and across URL changes) so polling does not flash skeletons. */
export type ApiQuery<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  /** A request is in flight. */
  loading: boolean;
  /** Client time of the last successful response. */
  updatedAt: Date | null;
  reload: () => void;
};

/** `enabled:false` = no polling (the first fetch still runs unless `initial:false`). */
export type QueryOptions = { enabled?: boolean; initial?: boolean };

/** Any failure of an API call as an ApiError (network when it is not one already). */
export const toApiError = (cause: unknown): ApiError =>
  cause instanceof ApiError ? cause : new ApiError("network", null, null, null, { cause });

/** GETs `url` now, on `reload()`, and every `refreshMs` when given (paused in hidden tabs, backing off on errors). */
export function useApiQuery<T>(url: string, refreshMs?: number, opts: QueryOptions = {}): ApiQuery<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const { reload, running } = usePoller(
    async (signal): Promise<PollResult> => {
      try {
        const next = await apiFetch<T>("GET", url, undefined, signal);
        if (signal.aborted) return "ok"; // superseded: a newer URL/key owns the state (P8)
        setData(next);
        setError(undefined);
        setUpdatedAt(new Date());
        return "ok";
      } catch (cause) {
        if (!signal.aborted) setError(toApiError(cause));
        return "error";
      }
    },
    { baseMs: refreshMs, enabled: opts.enabled, initial: opts.initial, key: url },
  );

  return { data, error, loading: running, updatedAt, reload };
}
