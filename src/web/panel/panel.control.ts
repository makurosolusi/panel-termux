// Which control actions a service/app offers and how each is confirmed (PLAN/02 §4.3, §5.2 tier table).
import type { App, ControlAction, Service } from "@/shared/panel.types";

/** Services whose stop cuts the way back into the panel (server `lockout`); also fallback when the field is absent. */
export const LOCKOUT_SERVICES: readonly string[] = ["panel", "cloudflared"];

/** Services whose restart answers 202 and hands over to the reconnect overlay. */
export const DEFERRED_SERVICES = ["panel", "cloudflared"] as const;
export type DeferredService = (typeof DEFERRED_SERVICES)[number];

/** none = run at once; confirm = AlertDialog; typed = type the name; locked = shown disabled with the lockout reason; hidden = not offered. */
export type ControlTier = "none" | "confirm" | "typed" | "locked" | "hidden";

/** The unit a control acts on. */
export type ControlTarget = { kind: "services"; item: Service } | { kind: "apps"; item: App };

/** Primary button (start when not running, else restart) and the tier of each action. */
export type ControlPlan = { primary: "start" | "restart"; tiers: Record<ControlAction, ControlTier> };

const isRunning = (t: ControlTarget): boolean =>
  t.kind === "services" ? t.item.state === "run" : t.item.status === "online" || t.item.status === "launching";

const isStopped = (t: ControlTarget): boolean =>
  t.kind === "services" ? t.item.state === "down" : t.item.status === "stopped";

/** Whether stopping this service is always refused (panel, cloudflared). */
export const isLockout = (s: Pick<Service, "name" | "lockout">): boolean =>
  s.lockout ?? LOCKOUT_SERVICES.includes(s.name);

/** Tier table: start never asks; restart confirms; stop confirms, typed for protected, locked for lockout. */
export function controlPlan(t: ControlTarget): ControlPlan {
  let stopTier: ControlTier = "confirm";
  if (t.kind === "services" && isLockout(t.item)) stopTier = "locked";
  else if (isStopped(t)) stopTier = "hidden";
  else if (t.kind === "services" && t.item.protected) stopTier = "typed";
  return {
    primary: isRunning(t) ? "restart" : "start",
    tiers: { start: "none", restart: "confirm", stop: stopTier },
  };
}

/** Restart of `name` answers 202 and needs the reconnect overlay. */
export const isDeferredRestart = (kind: ControlTarget["kind"], name: string, action: ControlAction): boolean =>
  kind === "services" && action === "restart" && (DEFERRED_SERVICES as readonly string[]).includes(name);
