// The one set of problem rules (PLAN/02 §3.1, B2–B4) behind Ringkasan, nav badge, /dev/health and Telegram.
import type { BackupStatus } from "../../shared/backup.types";
import type { Job } from "../../shared/job.types";
import type {
  AlertErrorCode,
  Problem,
  ProblemCode,
  ProblemKind,
  ProblemParams,
  ProblemSeverity,
} from "../../shared/monitor.types";
import type { App, DeviceInfo, Domain, DomainHealth, Service } from "../../shared/panel.types";
import type { SecurityStatus } from "../../shared/security.types";
import type { MonitorSnapshot, MonitorState, ProblemResult, SnapshotSection } from "../monitor/monitor.contract";

const MIN = 60_000;
const HOUR = 60 * MIN;
const HTTP_SERVER_ERROR = 500;

/** No backup run (or good copy of an item) for this long → warning. */
export const BACKUP_STALE_MS = 36 * HOUR;
/** Free disk share below these → warning / danger. */
export const DISK_WARN_RATIO = 0.1;
export const DISK_DANGER_RATIO = 0.05;
/** Not charging and below this % → danger (warning: `monitor.battery_warn_percent`). */
export const BATTERY_DANGER_PERCENT = 15;
/** Battery temperature at or above these → warning / danger. */
export const BATTERY_HOT_C = 45;
export const BATTERY_DANGER_C = 50;
/** Consecutive failed probes before a domain becomes a problem. */
export const DOMAIN_FAILS_TO_PROBLEM = 3;
/** pm2 restarts within the window = crash loop; increases within the grace after an intentional restart don't count. */
export const CRASH_LOOP_RESTARTS = 3;
export const CRASH_LOOP_WINDOW_MS = 10 * MIN;
export const INTENTIONAL_RESTART_GRACE_MS = 2 * MIN;
/** Ticks in a row with a new pid and short uptime = runit crash loop. */
export const SERVICE_LOOP_TICKS = 3;
/** Boot with host uptime below this → `host_rebooted` notice. */
export const REBOOT_UPTIME_MS = 15 * MIN;
/** No Cloudflare Access header for this long → `access_not_seen`. */
export const ACCESS_UNSEEN_MS = 24 * HOUR;

/** Per-tick inputs besides the snapshot: settings and facts owned by other services. */
export type ProblemContext = {
  intervalSec: number;
  /** `monitor.battery_warn_percent`; null = "off". */
  batteryWarnPercent: number | null;
  /** Newest first (PLAN/03). */
  jobs: Pick<Job, "id" | "kind" | "target" | "status" | "resolvedBy">[];
  /** Alert engine: reason of ≥ 3 failed sends in a row, else null. */
  alertsFailing: AlertErrorCode | null;
  /** An authenticated admin request was seen since boot (PLAN/04). */
  adminSeenSinceBoot: boolean;
};

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
const CODE_ORDER = Object.keys(RULES) as ProblemCode[];
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

/** A probe that counts towards a domain's failure streak: no answer or a 5xx. */
export const isProbeFailure = (status: number | null): boolean => status === null || status >= HTTP_SERVER_ERROR;

/** Sampler: stores one probe result and advances the domain's failure streak. */
export function recordProbe(state: MonitorState, hostname: string, last: DomainHealth): void {
  const prev = state.domains.get(hostname)?.failures ?? 0;
  state.domains.set(hostname, { failures: isProbeFailure(last.status) ? prev + 1 : 0, last });
}

const sectionValue = <T>(s: SnapshotSection<T>): T | null => (s.ok ? s.value : s.stale);
const intentional = (state: MonitorState, key: string, now: number) => (state.intentional.get(key) ?? 0) > now;

/** Sampler, once per tick before computeProblems: advances the runit and pm2 restart rings. */
export function observe(state: MonitorState, snap: MonitorSnapshot, now: number, intervalSec: number): void {
  for (const [k, until] of state.intentional) if (until <= now) state.intentional.delete(k);
  if (snap.services.ok) {
    for (const s of snap.services.value) {
      const ring = state.serviceRuns.get(s.name) ?? [];
      const restarted = s.state === "run" && s.pid !== null && (s.uptimeSec ?? Infinity) < intervalSec;
      if (!s.wantUp || intentional(state, `service:${s.name}`, now) || (s.state === "run" && !restarted)) {
        state.serviceRuns.delete(s.name);
      } else if (restarted && s.pid !== null && ring.at(-1)?.pid !== s.pid) {
        state.serviceRuns.set(s.name, [...ring, { pid: s.pid, at: now }].slice(-SERVICE_LOOP_TICKS));
      }
    }
  }
  if (snap.apps.ok) {
    for (const a of snap.apps.value) {
      const ring = (state.appRestarts.get(a.name) ?? []).filter((e) => now - e.at <= CRASH_LOOP_WINDOW_MS);
      const last = ring.at(-1);
      const reset = intentional(state, `app:${a.name}`, now) || (last !== undefined && a.restarts < last.restarts);
      state.appRestarts.set(
        a.name,
        reset ? [{ at: now, restarts: a.restarts }] : [...ring, { at: now, restarts: a.restarts }],
      );
    }
  }
}

/** Boot notices (stored closed, sent once): host reboot by uptime, else a missing clean-shutdown marker. */
export function bootNotices({ cleanShutdown, uptimeSec }: { cleanShutdown: boolean; uptimeSec: number }): Problem[] {
  if (uptimeSec * 1000 < REBOOT_UPTIME_MS)
    return [problem("host_rebooted", "host", "warning", { uptimeMin: Math.floor(uptimeSec / 60) })];
  return cleanShutdown ? [] : [problem("panel_restarted_unexpectedly", "panel", "warning")];
}

function deviceProblems(d: DeviceInfo, ctx: ProblemContext, out: Problem[]): void {
  const { freeBytes, totalBytes } = d.disk;
  const free = totalBytes > 0 ? freeBytes / totalBytes : 1;
  if (free < DISK_WARN_RATIO) {
    const freePct = Math.round(free * 1000) / 10;
    out.push(problem("disk_low", "disk", free < DISK_DANGER_RATIO ? "danger" : "warning", { freePct, freeBytes }));
  }
  const b = d.battery;
  if (!b) return;
  // A9: unplugging is deliberate; only a low battery that is not charging is a problem.
  const charging = b.status ? b.status === "charging" || b.status === "full" : b.charging;
  const warn = ctx.batteryWarnPercent;
  const low = b.percent < BATTERY_DANGER_PERCENT ? "danger" : warn !== null && b.percent < warn ? "warning" : null;
  if (!charging && low)
    out.push(problem("battery_low", "battery", low, { percent: b.percent, plugged: b.plugged ?? "unknown" }));
  const t = b.temperatureC as number | null;
  if (t !== null && Number.isFinite(t) && t >= BATTERY_HOT_C)
    out.push(problem("battery_hot", "battery", t >= BATTERY_DANGER_C ? "danger" : "warning", { temperatureC: t }));
}

function backupProblems(b: BackupStatus, now: number, out: Problem[]): void {
  if (b.keyMismatch) out.push(problem("key_mismatch", "data_key", "danger", { count: null }));
  if (b.includeSecrets) out.push(problem("backup_secrets_included", "backup", "warning"));
  if (!b.configured) {
    out.push(problem("backup_not_configured", "backup", "info"));
    return;
  }
  if (b.running || b.restoring) return;
  const run = b.lastRun;
  if (run?.status === "failed") out.push(problem("backup_failed", "backup", "danger"));
  if (run?.status === "partial") out.push(problem("backup_partial", "backup", "warning"));
  const age = run ? now - Date.parse(run.startedAt) : null;
  if (age === null || age > BACKUP_STALE_MS)
    out.push(problem("backup_stale", "backup", "warning", { hours: Math.floor((age ?? BACKUP_STALE_MS) / HOUR) }));
  if (!run || !b.lastGood) return; // lastGood: PLAN/04 0.3.0 input; absent from older producers
  for (const item of run.items) {
    if (item.kind === "checksums" || item.kind === "manifest") continue;
    const good = b.lastGood.find((g) => g.kind === item.kind && g.name === item.name);
    const goodAge = good ? now - Date.parse(good.at) : null;
    if (goodAge !== null && goodAge >= 0 && goodAge <= BACKUP_STALE_MS) continue;
    const hours = goodAge !== null && goodAge >= 0 ? Math.floor(goodAge / HOUR) : null;
    out.push(
      problem("backup_item_stale", `${item.kind}:${item.name}`, "warning", {
        itemKind: item.kind,
        name: item.name,
        hours,
      }),
    );
  }
}

function securityProblems(s: SecurityStatus, ctx: ProblemContext, now: number, out: Problem[]): void {
  if (s.dataKey.state === "mismatch")
    out.push(problem("key_mismatch", "data_key", "danger", { count: s.dataKey.unreadableSettings.length }));
  if (s.backupsIncludeSecrets) out.push(problem("backup_secrets_included", "backup", "warning"));
  const seen = s.access.lastSeenAt === null ? null : Date.parse(s.access.lastSeenAt);
  if (s.access.https && ctx.adminSeenSinceBoot && (seen === null || now - seen > ACCESS_UNSEEN_MS))
    out.push(problem("access_not_seen", "access", "info"));
}

const PM2_REASON = /service_down|no_daemon/;
const KEY_MISMATCH_ERROR = /KeyMismatch|key_mismatch/;

/**
 * All problems of one tick, most severe first, plus the ones hidden behind a root cause and the kinds whose input
 * could not be read. Failed sections yield no problems of their kind (C1): the engine keeps those events frozen.
 */
export function computeProblems(
  snap: MonitorSnapshot,
  state: MonitorState,
  ctx: ProblemContext,
  now: number,
): ProblemResult;
/** @deprecated 0.2.x overview call, see legacyProblems. */
export function computeProblems(input: LegacyProblemInput): LegacyProblem[];
export function computeProblems(
  ...args: [MonitorSnapshot, MonitorState, ProblemContext, number] | [LegacyProblemInput]
): ProblemResult | LegacyProblem[] {
  if (args.length === 1) return legacyProblems(args[0]);
  const [snap, state, ctx, now] = args;
  const out: Problem[] = [];
  const unknownKinds = new Set<ProblemKind>();
  const unknown = (...kinds: ProblemKind[]) => {
    for (const k of kinds) unknownKinds.add(k);
  };
  const intervalMs = ctx.intervalSec * 1000;

  if (snap.device.ok) {
    deviceProblems(snap.device.value, ctx, out);
    if (!snap.device.value.battery) unknown("battery");
  } else unknown("disk", "battery");

  if (snap.services.ok) {
    for (const s of snap.services.value) {
      if (s.wantUp && s.state !== "run")
        out.push(problem("service_down", s.name, "danger", { state: s.state, downSec: s.downSec ?? null }));
      const ring = state.serviceRuns.get(s.name) ?? [];
      if (s.state === "run" && ring.length >= SERVICE_LOOP_TICKS)
        out.push(problem("service_crash_loop", s.name, "danger", { ticks: ring.length }));
    }
  } else unknown("service");

  const apps = sectionValue(snap.apps) ?? [];
  const siteOf = (name: string) => apps.find((a) => a.name === name)?.site ?? null;
  if (snap.apps.ok) {
    for (const a of apps) {
      if (a.status === "errored") {
        out.push(problem("app_errored", a.name, "danger", { restarts: a.restarts, site: siteOf(a.name) }));
        continue;
      }
      const ring = state.appRestarts.get(a.name) ?? [];
      const rose = (ring.at(-1)?.restarts ?? 0) - (ring[0]?.restarts ?? 0);
      if (a.status !== "stopped" && rose >= CRASH_LOOP_RESTARTS)
        out.push(problem("app_crash_loop", a.name, "danger", { restarts10m: rose, site: siteOf(a.name) }));
    }
  } else {
    unknown("app");
    const reason = PM2_REASON.exec(snap.apps.error)?.[0];
    const failedLong = snap.apps.at === null || now - snap.apps.at >= 2 * intervalMs; // jlist failed 2 ticks
    if (reason || failedLong)
      out.push(problem("pm2_unavailable", "pm2", "danger", { reason: reason ?? "jlist_failed" }));
  }

  const rules = sectionValue(snap.ingress) ?? [];
  const appOfDomain = new Map<string, string | null>();
  if (snap.ingress.ok) {
    if (state.internetDown) out.push(problem("internet_down", "internet", "danger", { domains: rules.length }));
    for (const r of rules) {
      const app = r.port === null ? null : (apps.find((a) => a.port === r.port) ?? null);
      appOfDomain.set(r.hostname, app?.name ?? null);
      const d = state.domains.get(r.hostname);
      if (r.hostname.startsWith("*") || !d || d.failures < DOMAIN_FAILS_TO_PROBLEM || app?.status === "stopped")
        continue;
      const params = { failures: d.failures, local: d.last.local ?? null, port: r.port, status: d.last.status };
      if (d.last.status === null) out.push(problem("domain_unreachable", r.hostname, "danger", params));
      else if (d.last.status >= HTTP_SERVER_ERROR) out.push(problem("domain_http_error", r.hostname, "danger", params));
    }
  } else unknown("domain", "network");

  if (snap.backup.ok) backupProblems(snap.backup.value, now, out);
  else if (KEY_MISMATCH_ERROR.test(snap.backup.error))
    out.push(problem("key_mismatch", "data_key", "danger", { count: null }));
  else {
    unknown("backup");
    out.push(problem("backup_status_error", "backup", "danger"));
  }

  if (snap.security.ok) securityProblems(snap.security.value, ctx, now, out);
  else unknown("security");

  if (ctx.alertsFailing) out.push(problem("alerts_failing", "telegram", "warning", { reason: ctx.alertsFailing }));

  const seenTargets = new Set<string>();
  for (const j of ctx.jobs) {
    if (seenTargets.has(j.target)) continue; // newest per target only
    seenTargets.add(j.target);
    if ((j.status === "failed" || j.status === "interrupted") && !j.resolvedBy)
      out.push(problem("site_job_failed", j.target, "danger", { jobId: j.id, kind: j.kind, status: j.status }, j.id));
  }

  return { ...suppress(dedupe(out), appOfDomain), unknownKinds };
}

function dedupe(list: Problem[]): Problem[] {
  const byId = new Map<string, Problem>();
  for (const p of list) {
    const prev = byId.get(p.id);
    // key_mismatch comes from backup and security; keep the one with a count.
    if (!prev || (prev.params.count === null && p.params.count !== null)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Root-cause containment (K3, §3.1 "Menahan"): one row per cause, the rest go to `suppressed`. */
function suppress(list: Problem[], appOfDomain: Map<string, string | null>): Omit<ProblemResult, "unknownKinds"> {
  const has = (code: ProblemCode, target?: string) =>
    list.some((p) => p.code === code && (target === undefined || p.target === target));
  const brokenApps = new Set(
    list.filter((p) => p.code === "app_errored" || p.code === "app_crash_loop").map((p) => p.target),
  );
  const pm2Down = has("pm2_unavailable");
  const allDomains =
    has("internet_down") || has("service_down", "cloudflared") || has("service_crash_loop", "cloudflared");
  const keyBad = has("key_mismatch");
  const backupStale = has("backup_stale");
  const hidden = (p: Problem): boolean => {
    if (p.kind === "domain") {
      const app = appOfDomain.get(p.target) ?? null;
      return allDomains || (app !== null && (pm2Down || brokenApps.has(app)));
    }
    if (pm2Down && (p.kind === "app" || p.id === "service_down:pm2" || p.id === "service_crash_loop:pm2")) return true;
    if (keyBad && p.code.startsWith("backup_")) return true;
    return backupStale && p.code === "backup_item_stale";
  };
  const problems: Problem[] = [];
  const suppressed: Problem[] = [];
  for (const p of list) (hidden(p) ? suppressed : problems).push(p);
  problems.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) ||
      a.target.localeCompare(b.target),
  );
  return { problems, suppressed };
}

// TRANSITIONAL(wkr-mon-api-03, W3): the 0.2.x panel.service still calls computeProblems(input) and
// tests/panel.api.test.ts asserts its 0.2.x results. Delete this block when panel.service reads monitor.problems().
/** 0.2.x input of computeProblems. */
export type LegacyProblemInput = {
  services: Service[];
  apps: App[];
  domains: Domain[];
  device: DeviceInfo;
  backup: Pick<BackupStatus, "configured" | "running" | "lastRun">;
  now: Date;
};
/** 0.2.x problem shape (panel.types Problem without the optional fields). */
export type LegacyProblem = Pick<Problem, "kind" | "target" | "severity">;

function legacyProblems({ services, apps, domains, device, backup, now }: LegacyProblemInput): LegacyProblem[] {
  const out: LegacyProblem[] = [];
  const add = (kind: ProblemKind, target: string, bad: boolean) =>
    out.push({ kind, target, severity: bad ? "danger" : "warning" });
  for (const s of services) if (s.wantUp && s.state !== "run") add("service", s.name, true);
  for (const a of apps) if (a.status !== "online") add("app", a.name, a.status === "errored");
  for (const { hostname, health: h } of domains)
    if (h.checkedAt !== null && (h.status === null || h.status >= 400))
      add("domain", hostname, isProbeFailure(h.status));
  const run = backup.running ? undefined : backup.lastRun;
  if (!backup.configured || run?.status === "partial") add("backup", "backup", false);
  else if (run?.status === "failed") add("backup", "backup", true);
  else if (run === null || (run && now.getTime() - Date.parse(run.startedAt) > BACKUP_STALE_MS))
    add("backup", "backup", false);
  const r = device.disk.totalBytes > 0 ? device.disk.freeBytes / device.disk.totalBytes : 1;
  if (r < DISK_WARN_RATIO) add("disk", "disk", r < DISK_DANGER_RATIO);
  const b = device.battery;
  if (b && b.percent < 20 && !b.charging) add("battery", "battery", false);
  if (b && b.temperatureC >= BATTERY_HOT_C) add("battery", "battery", false);
  return out.sort((x, y) => severityRank(y.severity) - severityRank(x.severity));
}
