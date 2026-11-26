import { useState } from "react";
import { toast } from "sonner";
import type { ControlAction, DeferredRestart } from "@/shared/panel.types";
import { idPanel } from "@/web/i18n/id.panel";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { ApiError, apiErrorMessage } from "@/web/shared/api.client";
import { type ControlKind, isDeferred, postControl } from "./panel.api";

const t = idPanel;

/** Control state of a list page: which unit is in flight, and a deferred restart waiting for the overlay. */
export type PanelControl = {
  pending: string | null;
  /** Inside a ConfirmAction: rejects with the ApiError so the dialog shows it inline. */
  run: (name: string, action: ControlAction, typed?: string) => Promise<void>;
  /** Without a dialog (Mulai): the error becomes a toast. */
  runNow: (name: string, action: ControlAction) => void;
  restart: DeferredRestart | null;
  endRestart: () => void;
};

/** One control action at a time for `kind`; `onDone` reloads the list afterwards (success or not). */
export function usePanelControl(kind: ControlKind, onDone: () => void): PanelControl {
  const [pending, setPending] = useState<string | null>(null);
  const [restart, setRestart] = useState<DeferredRestart | null>(null);

  const run = async (name: string, action: ControlAction, typed?: string) => {
    setPending(name);
    try {
      const r = await postControl(kind, name, action, typed);
      if (isDeferred(r)) setRestart(r);
      else toast.success(t.doneBy[action](name));
    } catch (err) {
      // No answer: the action may or may not have happened; close the dialog and say so instead of guessing.
      if (err instanceof ApiError && err.kind === "network") {
        toast.error(t.networkLost, { duration: ERROR_TOAST_MS });
        return;
      }
      throw err;
    } finally {
      setPending(null);
      onDone();
    }
  };

  const runNow = (name: string, action: ControlAction) => {
    run(name, action).catch((err: unknown) =>
      toast.error(apiErrorMessage(err, t.errorCodes), { duration: ERROR_TOAST_MS }),
    );
  };

  return { pending, run, runNow, restart, endRestart: () => setRestart(null) };
}
