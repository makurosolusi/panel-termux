// Reconnect decisions after a deferred restart of panel/cloudflared (PLAN/02 §4.4), pure so they are unit-tested.
import type { DeferredRestart, Service } from "@/shared/panel.types";

/** Overlay polling interval. */
export const RESTART_POLL_MS = 2_000;

/** Give up after this long: panel ≥ its 120 s shutdown budget, cloudflared 90 s (PLAN/02 §4.4, §5.9). */
export const RESTART_LIMIT_MS: Record<DeferredRestart["service"], number> = { panel: 130_000, cloudflared: 90_000 };

/** Body of GET /api/health. */
export type HealthBody = { ok: boolean; version: string; bootId: string };

const isHealth = (v: unknown): v is HealthBody =>
  typeof v === "object" && v !== null && typeof (v as HealthBody).bootId === "string";

/**
 * Outcome of one /api/health answer: "back" when a JSON body carries a new bootId; anything else (old bootId, HTML
 * 502/530, an Access login page, no JSON) is "waiting".
 */
export function panelPoll(body: unknown, oldBootId: string): "back" | "waiting" {
  return isHealth(body) && body.bootId !== oldBootId ? "back" : "waiting";
}

/** cloudflared is back when the service list answers with it running under a new pid. */
export function cloudflaredPoll(body: unknown, oldPid: number | null): "back" | "waiting" {
  if (!Array.isArray(body)) return "waiting";
  const s = (body as Service[]).find((x) => x?.name === "cloudflared");
  return s && s.state === "run" && s.pid !== null && s.pid !== oldPid ? "back" : "waiting";
}

/** A new version came up with the restart: the loaded JS is stale, so reload the whole page. */
export const needsFullReload = (oldVersion: string | null, body: unknown): boolean =>
  oldVersion !== null && isHealth(body) && body.version !== oldVersion;
