import type { ControlAction } from "@/shared/panel.types";
import { id } from "@/web/i18n/id";
import { runApiAction } from "@/web/shared/api.action";
import { apiFetch, apiUrl } from "@/web/shared/api.client";

/** Builds `/api/panel<path>?<query>`, skipping empty params. */
export const panelUrl = (path: string, query?: Parameters<typeof apiUrl>[2]): string =>
  apiUrl("/api/panel", path, query);

/** Kind of controllable unit; also the URL segment (`/services/:name`, `/apps/:name`). */
export type ControlKind = "services" | "apps";

/** POSTs a start/stop/restart, toasting the outcome with panel error codes; resolves to whether it succeeded. */
export function sendControl(kind: ControlKind, name: string, action: ControlAction): Promise<boolean> {
  const label = id.panel.actions[action];
  return runApiAction(
    () => apiFetch("POST", panelUrl(`/${kind}/${encodeURIComponent(name)}/${action}`)),
    id.panel.done(label, name),
    id.panel.errorCodes,
  );
}

/** Auto-refresh interval of the panel's live views (overview, services, apps, domains). */
export const PANEL_REFRESH_MS = 10_000;
