// Legacy 0.2.x tone helpers, kept only for files outside the panel pages (site.card, job/deploy/backup state) that still
// import them. Panel pages use panel.status-key.ts. Remove in W7 cleanup once those callers map to StatusKey (B12).
import type { App } from "@/shared/panel.types";

/** Badge color family for a state (legacy; see LEGACY_TONE in components/status.tone). */
export type Tone = "ok" | "warn" | "bad" | "muted";

const APP_TONE: Record<App["status"], Tone> = {
  online: "ok",
  launching: "warn",
  errored: "bad",
  stopped: "muted",
  unknown: "muted",
};

/** Badge tone of a pm2 status (legacy). */
export const appStatusTone = (status: App["status"]): Tone => APP_TONE[status];
