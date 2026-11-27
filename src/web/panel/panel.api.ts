import type { App, ControlAction, ControlBody, DeferredRestart, Service } from "@/shared/panel.types";
import { apiFetch, apiUrl } from "@/web/shared/api.client";

/** Builds `/api/panel<path>?<query>`, skipping empty params. */
export const panelUrl = (path: string, query?: Parameters<typeof apiUrl>[2]): string =>
  apiUrl("/api/panel", path, query);

/** Kind of controllable unit; also the URL segment (`/services/:name`, `/apps/:name`). */
export type ControlKind = "services" | "apps";

/** Answer of a control POST: the unit's new state, or 202 for a deferred restart of panel/cloudflared. */
export type ControlResult = Service | App | DeferredRestart;

/** POSTs start/stop/restart; `confirm` = typed name for a protected stop. Throws ApiError on failure. */
export const postControl = (
  kind: ControlKind,
  name: string,
  action: ControlAction,
  confirm?: string,
): Promise<ControlResult> =>
  apiFetch<ControlResult>(
    "POST",
    panelUrl(`/${kind}/${encodeURIComponent(name)}/${action}`),
    confirm === undefined ? undefined : ({ confirm } satisfies ControlBody),
  );

/** Whether a control answer is the 202 of a deferred restart. */
export const isDeferred = (r: ControlResult): r is DeferredRestart => "deferred" in r && r.deferred === true;

/** Auto-refresh interval of the Overview, Services and Apps (PLAN/02 §5.9). */
export const PANEL_REFRESH_MS = 10_000;

/** Auto-refresh interval of Domain (the sampler probes every 60 s). */
export const DOMAINS_REFRESH_MS = 30_000;
