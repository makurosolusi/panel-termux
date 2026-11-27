import { msg } from "@/shared/i18n";
import type { StatusKey } from "@/web/components/status.vocab";

/** Badge label of every canonical status (PLAN/01 §3.1; frozen after W3, DECISIONS B12). */
export const tStatus = msg("status", {
  running: "Running",
  healthy: "Healthy",
  succeeded: "Succeeded",
  done: "Done",
  stopped: "Stopped",
  pending: "Pending",
  skipped: "Skipped",
  unchecked: "Not checked",
  not_deployed: "Not deployed",
  unknown: "Unknown",
  auth_required: "Sign-in required",
  starting: "Starting…",
  restarting: "Restarting…",
  attention: "Needs attention",
  partial: "Partly failed",
  undone: "Undone",
  not_configured: "Not set up",
  unstable: "Unstable",
  down: "Down",
  errored: "Errored",
  failed: "Failed",
  unhealthy: "Unhealthy",
  rolled_back: "Rolled back",
  crash_loop: "Keeps restarting",
  interrupted: "Interrupted",
  tunnel_down: "Tunnel down",
  key_mismatch: "Key mismatch",
  processing: "Processing…",
} as const satisfies Record<StatusKey, string>);

/** Help text shown next to a badge (or via `aria-describedby`) for statuses whose label alone could mislead. */
export const tStatusHelp: Partial<Record<StatusKey, string>> = msg("status.help", {
  rolled_back: "The change failed; the previous version was restored.",
  interrupted: "The panel restarted while the change was running. Review it, then clear it.",
  auth_required: "The domain responds but asks for a sign-in (e.g. Cloudflare Access).",
});
