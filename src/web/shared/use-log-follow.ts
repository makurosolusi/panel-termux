import { useRef, useState } from "react";
import type { LogChunk } from "@/shared/log.types";
import { appendLogLines, type BufferedLogLine, LOG_MAX_LINES } from "@/web/components/log.buffer";
import { type ApiError, apiFetch } from "./api.client";
import type { PollResult } from "./poller";
import { toApiError } from "./use-api-query";
import { usePoller } from "./use-poller";

/** Default follow interval for log pages. */
export const LOG_FOLLOW_MS = 3_000;

/** `${url}?after=<cursor>` (or `&after=` when `url` already has a query); no cursor = the initial tail. */
export const logFollowUrl = (url: string, cursor: string | null): string =>
  cursor === null ? url : `${url}${url.includes("?") ? "&" : "?"}after=${encodeURIComponent(cursor)}`;

/**
 * Follows a cursor log endpoint: GET `${url}?after=<cursor>` → LogChunk, appended into a capped buffer. The cursor
 * lives in a ref so the URL (and thus backoff/visibility state) stays fixed; a new `url` restarts from the tail.
 */
export function useLogFollow(
  url: string,
  opts: { enabled: boolean; baseMs?: number },
): {
  lines: BufferedLogLine[];
  error: ApiError | undefined;
  loading: boolean;
  capped: boolean;
  truncated: boolean;
  reload: () => void;
} {
  const cursor = useRef<{ url: string; value: string } | null>(null);
  const [lines, setLines] = useState<BufferedLogLine[]>([]);
  const [error, setError] = useState<ApiError>();
  const [truncated, setTruncated] = useState(false);

  const { reload, running } = usePoller(
    async (signal): Promise<PollResult> => {
      const after = cursor.current?.url === url ? cursor.current.value : null;
      try {
        const chunk = await apiFetch<LogChunk>("GET", logFollowUrl(url, after), undefined, signal);
        if (signal.aborted) return "ok";
        cursor.current = { url, value: chunk.cursor };
        // The first chunk of a URL replaces whatever another stream left in the buffer.
        setLines((prev) => appendLogLines(prev, { lines: chunk.lines, reset: chunk.reset || after === null }));
        setTruncated(chunk.truncated);
        setError(undefined);
        return "ok";
      } catch (cause) {
        if (!signal.aborted) setError(toApiError(cause));
        return "error";
      }
    },
    { baseMs: opts.baseMs ?? LOG_FOLLOW_MS, enabled: opts.enabled, key: url },
  );

  return { lines, error, loading: running, capped: lines.length >= LOG_MAX_LINES, truncated, reload };
}
