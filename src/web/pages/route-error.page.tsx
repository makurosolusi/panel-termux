import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { homeFor } from "@/shared/roles";
import { ErrorState } from "@/web/components/error-state";
import { Button } from "@/web/components/ui/button";
import { idShell } from "@/web/i18n/id.shell";
import { useMe } from "@/web/session/use-me";
import { isChunkLoadError } from "@/web/shared/chunk.error";
import { useChunkRecovery } from "@/web/shared/use-chunk-recovery";
import { NotFoundPage } from "./not-found.page";

const t = idShell.routeError;
const c = idShell.chunkError;

/**
 * Route ErrorBoundary inside the shell (sidebar stays usable): a thrown 404 response shows the 404 page; a failed
 * chunk reloads once when the server answers (newer bundle after a deploy) and otherwise shows the offline message
 * with a retry; anything else offers "Ke beranda" and a full reload.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const me = useMe();
  const chunk = isChunkLoadError(error);
  const recovery = useChunkRecovery(chunk);
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const offline = chunk && recovery.state === "offline";
  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : null;
  return (
    <ErrorState
      className="mt-10"
      title={offline ? c.offlineTitle : chunk ? c.title : t.title}
      description={
        <>
          {offline ? c.offlineBody : chunk ? c.body : t.body}
          {detail && !chunk && (
            <span className="mt-2 block font-mono text-xs break-all text-muted-foreground">{detail}</span>
          )}
        </>
      }
      action={
        <>
          <Button asChild size="sm" variant="outline">
            <Link to={homeFor(me.role)}>{t.home}</Link>
          </Button>
          {chunk ? (
            <Button size="sm" disabled={recovery.state === "checking"} onClick={recovery.retry}>
              {offline ? c.retry : c.reload}
            </Button>
          ) : (
            <Button size="sm" onClick={() => window.location.reload()}>
              {t.retry}
            </Button>
          )}
        </>
      }
    />
  );
}
