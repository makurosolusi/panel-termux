import { Skeleton } from "@/web/components/ui/skeleton";
import { idShell } from "@/web/i18n/id.shell";

/** Loading placeholders shaped like the content they stand in for. */

/** Row of StatTile placeholders. */
export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
      <span className="sr-only">{idShell.table.loading}</span>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
        <Skeleton key={i} className="h-[4.75rem] rounded-lg" />
      ))}
    </div>
  );
}

/** Table/list rows placeholder. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">{idShell.table.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/** Page title + description placeholder. */
export function HeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}
