// Problem code → kind, link and Telegram delay (PLAN/02 §3.1 table), split out of overview.problems.ts (file health).
import type { Problem, ProblemCode, ProblemKind, ProblemParams, ProblemSeverity } from "../../shared/monitor.types";

const MIN = 60_000;

type Delay = number | "tick" | null; // null = never sent to Telegram
type Rule = { kind: ProblemKind; href: (target: string) => string; delay: Delay };
const rule = (kind: ProblemKind, href: string | ((t: string) => string), delay: Delay): Rule => ({
  kind,
  href: typeof href === "string" ? () => href : href,
  delay,
});
const enc = encodeURIComponent;

// Key order = display order within a severity (PLAN/02 §3.1 table).
const RULES: Record<ProblemCode, Rule> = {
  service_down: rule("service", "/panel/services", 2 * MIN),
  service_crash_loop: rule("service", (t) => `/panel/services/${enc(t)}/log`, 0),
  pm2_unavailable: rule("service", "/panel/services", 2 * MIN),
  app_errored: rule("app", (t) => `/panel/apps/${enc(t)}/log?stream=err`, MIN),
  app_crash_loop: rule("app", (t) => `/panel/apps/${enc(t)}/log?stream=err`, "tick"),
  domain_unreachable: rule("domain", "/panel/domains", 0),
  domain_http_error: rule("domain", "/panel/domains", 0),
  internet_down: rule("network", "/panel/domains", 0),
  backup_not_configured: rule("backup", "/panel/backups", null),
  backup_failed: rule("backup", "/panel/backups", 0),
  backup_partial: rule("backup", "/panel/backups", 0),
  backup_stale: rule("backup", "/panel/backups", 0),
  backup_item_stale: rule("backup", "/panel/backups", 0),
  backup_status_error: rule("backup", "/dev/health", 0),
  backup_secrets_included: rule("security", "/panel/backups", 0),
  key_mismatch: rule("security", "/dev/health#kunci-data", 0),
  access_not_seen: rule("security", "/dev/health#access", null),
  disk_low: rule("disk", "/panel", 0),
  battery_low: rule("battery", "/panel", 2 * MIN),
  battery_hot: rule("battery", "/panel", 2 * MIN),
  alerts_failing: rule("alerts", "/dev/settings", null),
  site_job_failed: rule("site", (t) => `/panel/jobs/${enc(t)}`, 0),
  host_rebooted: rule("host", "/panel", 0),
  panel_restarted_unexpectedly: rule("host", "/panel", 0),
};
/** Problem codes in display order within a severity. */
export const CODE_ORDER = Object.keys(RULES) as ProblemCode[];
const SEVERITY_RANK: Record<ProblemSeverity, number> = { info: 0, warning: 1, danger: 2 };

/** info < warning < danger, for comparisons by the alert engine. */
export const severityRank = (s: ProblemSeverity): number => SEVERITY_RANK[s];

/** How long a problem must stay open before it is sent; null = never sent (info, alerts_failing). */
export function alertDelayMs(code: ProblemCode, intervalSec: number): number | null {
  const d = RULES[code].delay;
  return d === "tick" ? intervalSec * 1000 : d;
}

/** Builds one Problem; `hrefTarget` (e.g. a job id) fills the link when it differs from `target`. */
export function problem(
  code: ProblemCode,
  target: string,
  severity: ProblemSeverity,
  params: ProblemParams = {},
  hrefTarget = target,
): Problem {
  const r = RULES[code];
  const id = `${code}:${target}`;
  return { id, code, kind: r.kind, target, severity, params, since: null, href: r.href(hrefTarget) };
}
