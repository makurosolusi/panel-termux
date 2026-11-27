import { Loader2Icon, PlayIcon } from "lucide-react";
import { useState } from "react";
import type { Service } from "@/shared/panel.types";
import { Button } from "@/web/components/ui/button";
import { idPanel } from "@/web/i18n/id.panel";
import { idServiceStart as t } from "@/web/i18n/id.service-start";
import { postControl } from "@/web/panel/panel.api";
import { runApiAction } from "./api.action";
import { ApiError } from "./api.client";

/** Core services the panel offers to start wherever "… tidak berjalan" is shown. */
export type StartableService = "pm2" | "postgres";

/**
 * POST /api/panel/services/:name/start (the server also removes the runit `down` file); toasts the result, calls
 * `onStarted` when the service now runs, and resolves to that.
 */
export async function startService(service: StartableService, onStarted?: () => void): Promise<boolean> {
  const codes = { ...idPanel.errorCodes, not_running: t.notRunning(service) };
  const ok = await runApiAction(
    async () => {
      const s = (await postControl("services", service, "start")) as Service;
      if (s.state !== "run") throw new ApiError("client", null, "not_running", null);
    },
    t.started(service),
    codes,
  );
  if (ok) onStarted?.();
  return ok;
}

/** "Jalankan pm2" / "Jalankan postgres" button; `onStarted` runs after a successful start (e.g. re-check). */
export function ServiceStartButton({ service, onStarted }: { service: StartableService; onStarted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    await startService(service, onStarted);
    setBusy(false);
  };
  return (
    <Button size="sm" disabled={busy} onClick={() => void start()}>
      {busy ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <PlayIcon aria-hidden />}
      {busy ? t.starting : t.label(service)}
    </Button>
  );
}
