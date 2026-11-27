import { ServerCrashIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { useRevalidator, useRouteError } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/web/components/ui/card";
import { tSession } from "@/web/i18n/en.session";
import { tShell } from "@/web/i18n/en.shell";
import { ApiError } from "@/web/shared/api.client";
import { isChunkLoadError } from "@/web/shared/chunk.error";
import { useChunkRecovery } from "@/web/shared/use-chunk-recovery";

/** Which root failure this is: a code chunk that did not load, `/api/me` unreachable, or the server failing. */
export function sessionErrorKind(err: unknown): "chunk" | "network" | "server" {
  if (isChunkLoadError(err)) return "chunk";
  return err instanceof ApiError && err.kind === "network" ? "network" : "server";
}

/**
 * Root error boundary (distinct from 401, which redirects to login). A failed chunk (panel updated while the tab
 * was open) reloads once when the server answers; if that already happened, the server is down, or for
 * network/server failures, it shows a card.
 */
export function SessionError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const kind = sessionErrorKind(error);
  const recovery = useChunkRecovery(kind === "chunk");
  const offline = kind === "chunk" && recovery.state === "offline";
  const chunk = kind === "chunk" && !offline;
  const c = tShell.chunkError;
  const Icon = chunk ? TriangleAlertIcon : kind === "network" || offline ? WifiOffIcon : ServerCrashIcon;
  const title = offline
    ? c.offlineTitle
    : chunk
      ? c.title
      : kind === "network"
        ? tSession.errorTitle
        : tSession.serverTitle;
  const body = offline ? c.offlineBody : chunk ? c.body : kind === "network" ? tSession.errorBody : tSession.serverBody;
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
          {kind === "chunk" ? (
            <Button className="w-full" disabled={recovery.state === "checking"} onClick={recovery.retry}>
              {offline ? c.retry : c.reload}
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={revalidator.state === "loading"}
              onClick={() => void revalidator.revalidate()}
            >
              {tSession.retry}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
