import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { ErrorState } from "@/web/components/error-state";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { NotFoundPage } from "./not-found.page";

const t = id.shell.routeError;

/**
 * Route ErrorBoundary inside the shell (sidebar stays usable): a thrown 404 response shows the 404 page, anything
 * else a retry (full reload, which also picks up a newer bundle after a deploy) and a "back" button.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : null;
  return (
    <ErrorState
      className="mt-10"
      title={t.title}
      description={
        <>
          {t.body}
          {detail && <span className="mt-2 block font-mono text-xs break-all text-muted-foreground">{detail}</span>}
        </>
      }
      action={
        <>
          <Button size="sm" variant="outline" onClick={() => navigate(-1)}>
            {t.back}
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            {t.retry}
          </Button>
        </>
      }
    />
  );
}
