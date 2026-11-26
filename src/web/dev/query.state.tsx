import { AlertCircleIcon, InboxIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import { id } from "@/web/i18n/id";
import { devErrorMessage } from "./dev.api";
import type { DevQuery } from "./use-dev-query";

/** Placeholder rows while the first load is in flight. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Centered "nothing here" note. */
export function EmptyState({ text = id.dev.common.empty }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
      <InboxIcon className="size-6" aria-hidden />
      {text}
    </div>
  );
}

/** Error banner with retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center"
    >
      <AlertCircleIcon className="size-5 shrink-0" aria-hidden />
      <span className="flex-1">{devErrorMessage(error)}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {id.dev.common.retry}
      </Button>
    </div>
  );
}

/**
 * Renders skeleton (first load), error (with stale data kept below when present), empty, or `children(data)`.
 * `isEmpty` decides the empty state.
 */
export function QueryView<T>({
  query,
  isEmpty,
  skeleton = <ListSkeleton />,
  children,
}: {
  query: DevQuery<T>;
  isEmpty?: (data: T) => boolean;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, reload } = query;
  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState error={error} onRetry={reload} />}
      {data === undefined ? !error && skeleton : isEmpty?.(data) ? <EmptyState /> : children(data)}
    </div>
  );
}
