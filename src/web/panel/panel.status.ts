import type { App, ControlAction, Domain, DomainHealth, Service } from "@/shared/panel.types";

/** Badge color family for a state. */
export type Tone = "ok" | "warn" | "bad" | "muted";

/** cloudflared carries every public hostname; restarting it drops all domains for a moment. */
export const TUNNEL_SERVICE = "cloudflared";

/** Service badge tone: running ok; down is bad only if the supervisor wants it up (else stopped on purpose). */
export function serviceTone(s: Service): Tone {
  if (s.state === "run") return "ok";
  if (s.state === "finish") return "warn";
  if (s.state === "down") return s.wantUp ? "bad" : "muted";
  return "muted";
}

const APP_TONE: Record<App["status"], Tone> = {
  online: "ok",
  launching: "warn",
  errored: "bad",
  stopped: "muted",
  unknown: "muted",
};

/** pm2 app badge tone. */
export const appTone = (a: App): Tone => APP_TONE[a.status];

/** Domain health verdict: not checked yet, reachable with a 2xx/3xx answer, or failing (other status or no answer). */
export function healthTone(h: DomainHealth): Tone {
  if (h.checkedAt === null) return "muted";
  if (h.status === null) return "bad";
  return h.status >= 200 && h.status < 400 ? "ok" : "bad";
}

/** Health badge text: "200 · 85 ms", or why there is no status yet / at all. */
export function healthLabel(h: DomainHealth, text: { unchecked: string; unreachable: string }): string {
  if (h.checkedAt === null) return text.unchecked;
  if (h.status === null) return text.unreachable;
  return h.ms === null ? String(h.status) : `${h.status} · ${h.ms} ms`;
}

/** Problem counts shown on the overview: services not running, apps not online, failing domains. */
export function countProblems(data: { services: Service[]; apps: App[]; domains: Domain[] }) {
  return {
    services: data.services.filter((s) => s.state !== "run").length,
    apps: data.apps.filter((a) => a.status !== "online").length,
    domains: data.domains.filter((d) => healthTone(d.health) === "bad").length,
  };
}

/** Why a control button is disabled, or null when it may be pressed. */
export type BlockReason = "busy" | "protected" | "running" | "stopped" | null;

/** Per-action block reason for a service or app; `busy` = another control action is still in flight. */
export function actionBlocks(
  target: { kind: "service"; item: Service } | { kind: "app"; item: App },
  busy: boolean,
): Record<ControlAction, BlockReason> {
  if (busy) return { start: "busy", stop: "busy", restart: "busy" };
  const running = target.kind === "service" ? target.item.state === "run" : target.item.status === "online";
  const stopped = target.kind === "service" ? target.item.state === "down" : target.item.status === "stopped";
  const isProtected = target.kind === "service" && target.item.protected;
  return {
    start: running ? "running" : null,
    stop: isProtected ? "protected" : stopped ? "stopped" : null,
    restart: null,
  };
}

/** Whether confirming `action` on `name` must warn that every domain drops briefly. */
export const dropsAllDomains = (name: string, action: ControlAction): boolean =>
  name === TUNNEL_SERVICE && action !== "start";
