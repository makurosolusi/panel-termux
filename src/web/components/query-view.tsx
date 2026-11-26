import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { idCommon } from "@/web/i18n/id.common";
import { idShell } from "@/web/i18n/id.shell";
import { apiErrorDetail, type ErrorCodes } from "@/web/shared/api.client";
import type { ApiQuery } from "@/web/shared/use-api-query";
import { ErrorState } from "./error-state";
import { RelativeTime } from "./relative-time";
import { RowsSkeleton } from "./skeletons";

/** Default emptiness: an empty array, or an object whose `items` is an empty array. */
export const isEmptyData = (data: unknown): boolean =>
  Array.isArray(data)
    ? data.length === 0
    : typeof data === "object" &&
      data !== null &&
      Array.isArray((data as { items?: unknown }).items) &&
      (data as { items: unknown[] }).items.length === 0;

/** Which of the five states a query is in (pure, so the table in PLAN/01 §3.3 is testable without a DOM). */
export type QueryViewState = "loading" | "failed" | "stale" | "empty" | "content";

/** Decides the QueryView state from the query's data/error and the emptiness check. */
export function queryViewState<T>(
  q: Pick<ApiQuery<T>, "data" | "error">,
  isEmpty: (data: T) => boolean = isEmptyData,
): QueryViewState {
  if (q.data === undefined) return q.error ? "failed" : "loading";
  if (q.error) return "stale";
  return isEmpty(q.data) ? "empty" : "content";
}

/**
 * The one way a page renders a `useApiQuery` result: skeleton on first load, ErrorState when the first load fails,
 * StaleNotice above the last good data when a refresh fails, `empty` when there is nothing (required: write the
 * specific empty copy; `null` only when the data can never be empty), otherwise `children(data)`.
 */
export function QueryView<T>({
  query,
  empty,
  isEmpty,
  codes,
  skeleton = <RowsSkeleton />,
  children,
}: {
  query: ApiQuery<T>;
  empty: ReactNode;
  isEmpty?: (data: T) => boolean;
  codes?: ErrorCodes;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, loading, reload } = query;
  switch (queryViewState(query, isEmpty)) {
    case "loading":
      return <div aria-busy="true">{skeleton}</div>;
    case "failed":
      return (
        <ErrorState
          title={idCommon.errorTitles[error?.kind ?? "network"]}
          description={apiErrorDetail(error, codes)}
          onRetry={reload}
          retrying={loading}
        />
      );
    case "empty":
      return <>{empty}</>;
    default:
      // One element for "content" and "stale": switching root type would remount every section of the page each time
      // a refresh fails or recovers. `contents` keeps the children in the parent's layout, like a fragment.
      return (
        <div className="contents">
          {error && <StaleNotice updatedAt={query.updatedAt} onRetry={reload} retrying={loading} />}
          {children(data as T)}
        </div>
      );
  }
}

/**
 * Refresh failed but older data is still shown. Only the title is a live region (announced once when the notice
 * appears); the ticking "last updated" line and the retry button stay outside it so they are not re-announced.
 */
export function StaleNotice({
  updatedAt,
  onRetry,
  retrying = false,
}: {
  updatedAt: Date | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/25 bg-warning-subtle px-3 py-2 text-sm">
      <TriangleAlertIcon className="size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p role="status" className="font-medium text-warning">
          {idShell.staleTitle}
        </p>
        {updatedAt && (
          <p className="text-xs text-foreground/80">
            <RelativeTime at={updatedAt} format={idShell.staleSince} />
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
        {idCommon.retry}
      </Button>
    </div>
  );
}
