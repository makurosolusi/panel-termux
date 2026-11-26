import { Skeleton } from "@/web/components/ui/skeleton";
import { idSession } from "@/web/i18n/id.session";
import { LANDING_PATH, LOGIN_PATH } from "./session.redirect";

/**
 * Shown while the first `/api/me` request (and the app chunk) is in flight: on `/` and `/login` only the page
 * background (no shell flash on public pages), elsewhere a skeleton shaped like the shell.
 */
export function SessionFallback() {
  const path = window.location.pathname;
  if (path === LANDING_PATH || path === LOGIN_PATH) {
    return <div className="min-h-svh bg-background" aria-busy="true" />;
  }
  return (
    <div className="flex min-h-svh bg-background" aria-busy="true">
      <span className="sr-only">{idSession.loading}</span>
      <div className="hidden w-60 shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-4 h-4 w-20" />
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b px-4 md:h-14 md:px-8">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-col gap-3 px-4 py-6 md:px-8 md:py-8">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
