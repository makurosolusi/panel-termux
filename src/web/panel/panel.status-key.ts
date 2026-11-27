// Raw monitor states → canonical StatusKey (DECISIONS B12): labels/tones live in status.vocab, reasons in id.panel.

import type { Problem } from "@/shared/monitor.types";
import type { App, AppStatus, Domain, DomainHealth, Service } from "@/shared/panel.types";
import { title as problemTitle } from "@/shared/problem.copy";
import type { StatusKey } from "@/web/components/status.vocab";
import { tPanel } from "@/web/i18n/en.panel";

const r = tPanel.domains.reasons;

/** Failed probes in a row before a domain counts as a problem (server DOMAIN_FAILS_TO_PROBLEM). */
export const DOMAIN_FAILS_TO_PROBLEM = 3;

/** runit service: running; down while wanted up = down; stopped on purpose = stopped; finish = restarting. */
export function serviceKey(s: Pick<Service, "state" | "wantUp">): StatusKey {
  if (s.state === "run") return "running";
  if (s.state === "finish") return "restarting";
  if (s.state === "down") return s.wantUp ? "down" : "stopped";
  return "unknown";
}

const APP_KEY: Record<AppStatus, StatusKey> = {
  online: "running",
  launching: "starting",
  errored: "errored",
  stopped: "stopped",
  unknown: "unknown",
};

/** pm2 app status; `crashLoop` (from the monitor's app_crash_loop) wins over "online". */
export const appKey = (a: Pick<App, "status">, crashLoop = false): StatusKey =>
  crashLoop && a.status !== "errored" ? "crash_loop" : APP_KEY[a.status];

/** Badge key + one-sentence reason (empty when nothing to explain). */
export type Verdict = { key: StatusKey; reason: string };

/** What else is known about a domain: its port, its app's pm2 status, a wildcard rule, the problem holding its own back. */
export type DomainContext = {
  port?: number | null;
  appStatus?: AppStatus | null;
  wildcard?: boolean;
  heldBy?: Problem | null;
};

const isFailure = (status: number | null) => status === null || status >= 500;

/** Domain verdict per PLAN/02 §5.4 (row order = precedence). */
export function domainVerdict(h: DomainHealth, ctx: DomainContext = {}): Verdict {
  if (ctx.wildcard) return { key: "unchecked", reason: r.wildcard };
  if (ctx.appStatus === "stopped") return { key: "stopped", reason: "" };
  if (h.checkedAt === null) return { key: "unchecked", reason: r.unchecked };
  const failures = h.failures ?? 0;
  const status = h.status;
  if (!isFailure(status)) {
    if (status === 401 || status === 403) return { key: "auth_required", reason: r.authRequired };
    if (status !== null && status >= 400) return { key: "healthy", reason: r.clientError(status) };
    return { key: "healthy", reason: "" };
  }
  if (failures < DOMAIN_FAILS_TO_PROBLEM) return { key: "unstable", reason: r.unstable(Math.max(failures, 1)) };
  const key: StatusKey = status === 530 ? "tunnel_down" : "unhealthy";
  if (ctx.heldBy) return { key, reason: r.heldBy(problemTitle(ctx.heldBy)) };
  if (status === 530) return { key, reason: r.tunnelDown };
  const local = h.local ?? null;
  if (local !== null) return { key, reason: r.localAnswers(local) };
  return { key, reason: ctx.port != null ? r.portSilent(ctx.port) : r.noAnswer };
}

/** The open problem that explains (and on the server suppresses) a failing domain, if any. */
export function domainHolder(d: Pick<Domain, "app" | "target">, problems: readonly Problem[]): Problem | null {
  const by = (fn: (p: Problem) => boolean) => problems.find(fn) ?? null;
  return (
    by((p) => p.code === "internet_down") ??
    by((p) => p.target === "cloudflared" && (p.code === "service_down" || p.code === "service_crash_loop")) ??
    (d.target === "app" ? by((p) => p.code === "pm2_unavailable") : null) ??
    (d.app ? by((p) => p.kind === "app" && p.target === d.app) : null)
  );
}

/** Wildcard ingress hostnames (`*.example.com`) are never probed. */
export const isWildcard = (hostname: string): boolean => hostname.startsWith("*.");
