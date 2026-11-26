import { Skeleton } from "@/web/components/ui/skeleton";
import { id } from "@/web/i18n/id";

/** Shown while the first `/api/me` request is in flight. */
export function SessionFallback() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 p-4" aria-busy="true">
      <span className="sr-only">{id.session.loading}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-full" />
    </main>
  );
}
