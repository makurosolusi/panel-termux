import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { homeFor } from "@/shared/roles";
import { ErrorState } from "@/web/components/error-state";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";
import { CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnce } from "@/web/shared/chunk.error";
import { NotFoundPage } from "./not-found.page";

const t = id.shell.routeError;

/**
 * Route ErrorBoundary inside the shell (sidebar stays usable): a thrown 404 response shows the 404 page; a failed
 * chunk reloads once (newer bundle after a deploy); anything else offers "Ke beranda" and a full reload.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const me = useMe();
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    if (chunk) reloadOnce(CHUNK_RELOAD_KEY);
  }, [chunk]);
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : null;
  return (
    <ErrorState
      className="mt-10"
      title={chunk ? id.shell.chunkError.title : t.title}
      description={
        <>
          {chunk ? id.shell.chunkError.body : t.body}
          {detail && <span className="mt-2 block font-mono text-xs break-all text-muted-foreground">{detail}</span>}
        </>
      }
      action={
        <>
          <Button asChild size="sm" variant="outline">
            <Link to={homeFor(me.role)}>{t.home}</Link>
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            {chunk ? id.shell.chunkError.reload : t.retry}
          </Button>
        </>
      }
    />
  );
}
