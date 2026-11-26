import { useState } from "react";
import type { ControlAction } from "@/shared/panel.types";
import { type ControlKind, sendControl } from "./panel.api";

/** Action in flight: which unit and what. */
export type PendingControl = { name: string; action: ControlAction } | null;

/**
 * Runs one control action at a time for `kind` and calls `onDone` afterwards (success or not) so the list
 * reflects the real state.
 */
export function usePanelControl(kind: ControlKind, onDone: () => void) {
  const [pending, setPending] = useState<PendingControl>(null);
  const run = async (name: string, action: ControlAction) => {
    setPending({ name, action });
    await sendControl(kind, name, action); // outcome is toasted inside
    setPending(null);
    onDone();
  };
  return { pending, run };
}
