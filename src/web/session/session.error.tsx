import { ServerCrashIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { useEffect } from "react";
import { useRevalidator, useRouteError } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { ApiError } from "@/web/shared/api.client";
import { CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnce } from "@/web/shared/chunk.error";

/** Which root failure this is: a code chunk that did not load, `/api/me` unreachable, or the server failing. */
export function sessionErrorKind(err: unknown): "chunk" | "network" | "server" {
  if (isChunkLoadError(err)) return "chunk";
  return err instanceof ApiError && err.kind === "network" ? "network" : "server";
}

/**
 * Root error boundary (distinct from 401, which redirects to login). A failed chunk (panel updated while the tab
 * was open) reloads once; if that already happened, or for network/server failures, it shows a card.
 */
export function SessionError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const kind = sessionErrorKind(error);
  useEffect(() => {
    if (kind === "chunk") reloadOnce(CHUNK_RELOAD_KEY);
  }, [kind]);

  const chunk = kind === "chunk";
  const Icon = chunk ? TriangleAlertIcon : kind === "network" ? WifiOffIcon : ServerCrashIcon;
  const title = chunk ? id.shell.chunkError.title : kind === "network" ? id.session.errorTitle : id.session.serverTitle;
  const body = chunk ? id.shell.chunkError.body : kind === "network" ? id.session.errorBody : id.session.serverBody;
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <Icon className="size-6 text-danger" aria-hidden />
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          {chunk ? (
            <Button className="w-full" onClick={() => window.location.reload()}>
              {id.shell.chunkError.reload}
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={revalidator.state === "loading"}
              onClick={() => void revalidator.revalidate()}
            >
              {id.session.retry}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
