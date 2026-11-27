import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { DeferredRestart } from "@/shared/panel.types";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/web/components/ui/alert-dialog";
import { Button } from "@/web/components/ui/button";
import { tPanel } from "@/web/i18n/en.panel";
import { AJAX_HEADERS } from "@/web/shared/api.client";
import { toast } from "@/web/shared/toast.lazy";
import { usePoller } from "@/web/shared/use-poller";
import { CodeText } from "./code.text";
import { panelUrl } from "./panel.api";
import { cloudflaredPoll, needsFullReload, panelPoll, RESTART_LIMIT_MS, RESTART_POLL_MS } from "./restart.state";

const r = tPanel.restart;

/**
 * Plain fetch (not apiFetch): while the panel is away, 401/HTML answers come from Access or the tunnel and must count
 * as "not back yet" instead of triggering apiFetch's login redirect / Access reload.
 */
async function probe(url: string, signal: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: AJAX_HEADERS, credentials: "same-origin", cache: "no-store", signal });
    return res.ok ? await res.json() : null;
  } catch (cause) {
    if (signal.aborted) throw cause;
    return null; // offline / tunnel down / not JSON: still waiting
  }
}

/** Blocking "reconnecting" dialog after a deferred restart of panel or cloudflared (PLAN/02 §4.4). */
export function RestartOverlay({ restart, onDone }: { restart: DeferredRestart; onDone: () => void }) {
  const isPanel = restart.service === "panel";
  const t = r[restart.service];
  const [failed, setFailed] = useState(false);
  const startedAt = useRef(Date.now());
  const oldVersion = useRef<string | null>(null);

  const { reload } = usePoller(
    async (signal) => {
      if (Date.now() - startedAt.current > RESTART_LIMIT_MS[restart.service]) {
        setFailed(true);
        return "ok";
      }
      const body = await probe(isPanel ? "/api/health" : panelUrl("/services"), signal);
      if (signal.aborted) return "ok";
      const back = isPanel ? panelPoll(body, restart.bootId) : cloudflaredPoll(body, restart.oldPid);
      if (isPanel && back === "waiting" && body && oldVersion.current === null) {
        oldVersion.current = (body as { version?: string }).version ?? null; // old process still answering
      }
      if (back === "back") {
        if (isPanel && needsFullReload(oldVersion.current, body)) window.location.reload();
        toast.success(t.back);
        onDone();
      }
      return "ok"; // never back off: a restart is expected to fail requests for a while
    },
    { baseMs: RESTART_POLL_MS, enabled: !failed },
  );

  const retry = () => {
    startedAt.current = Date.now();
    setFailed(false);
    reload();
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {failed ? (
              <TriangleAlertIcon className="size-5 text-danger" aria-hidden />
            ) : (
              <Loader2Icon className="size-5 motion-safe:animate-spin" aria-hidden />
            )}
            {failed ? t.failedTitle : t.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{failed ? <CodeText text={t.failed} /> : t.body}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed && (
          <AlertDialogFooter>
            <Button variant="outline" onClick={onDone}>
              {r.close}
            </Button>
            <Button onClick={retry}>{r.retry}</Button>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
