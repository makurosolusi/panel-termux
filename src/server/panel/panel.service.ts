// Panel API service (PLAN/02 §3.7): reads come from the monitor snapshot; control actions follow the check order
// name/action → lockout → confirm → job lock → action lock → action → intentional restart → audit → patch.
import { splitLogTimestamp } from "../../shared/log.time";
import type { OverviewSection, PanelStatus } from "../../shared/monitor.types";
import type {
  App,
  ControlAction,
  ControlBody,
  DatabaseInfo,
  DeferredRestart,
  Domain,
  LogChunk,
  LogStream,
  PanelOverview,
  Service,
} from "../../shared/panel.types";
import { listAudit, recordAudit } from "../audit.service";
import type { BackupService } from "../backup/backup.service";
import type { Db } from "../db/client";
import { site } from "../db/schema";
import { log } from "../log.service";
import type { MonitorSnapshot, SnapshotSection } from "../monitor/monitor.contract";
import { lastChecksPerHost } from "../monitor/monitor.history";
import { LOCKOUT_SERVICES, type MonitorService } from "../monitor/monitor.service";
import { ApiError } from "../routes/http.error";
import { getSetting } from "../settings.service";
import type { JobRunner } from "../sites/job.runner";
import { siteSecretsFor } from "../sites/site.secrets";
import { redactLines } from "../system/log.redact";
import { toApp } from "../system/pm2.termux";
import { type Pm2Proc, type SystemAdapters, SystemError } from "../system/system.types";
import { createActionLocks } from "./action.lock";
import { buildDomains, RECENT_CHECKS } from "./domain.health";

/** Fallback boot id when boot does not pass one; boot should report the same value in GET /health. */
export const PROCESS_BOOT_ID = crypto.randomUUID();

/** What the panel service needs; `jobs`/`backup` gate control actions, `restartSelf` exits for runit to restart. */
export type PanelDeps = {
  db: Db;
  secret: string;
  system: SystemAdapters;
  monitor: MonitorService;
  jobs: Pick<JobRunner, "active" | "isLocked">;
  backup: Pick<BackupService, "busy">;
  /** Same id as GET /health `bootId`; the 202 of a panel restart carries it (default PROCESS_BOOT_ID). */
  bootId?: string;
  /** Panel PORT, to mark domains that point at the panel itself. */
  panelPort?: number;
  /** Graceful self-restart (default SIGTERM to this process: shutdown writes the marker, runit starts it again). */
  restartSelf?: () => void;
};

/** Delay before a deferred restart, so the 202 reaches the browser first (PLAN/02 §4.4). */
export const RESTART_DELAY_MS: Record<DeferredRestart["service"], number> = { panel: 300, cloudflared: 500 };
/** Lines per download (the adapters read at most the last 1 MiB of a file, below the 10 MiB cap). */
const DOWNLOAD_LINES = 20_000;
/** Lines hashed as the follow anchor. */
const ANCHOR_LINES = 3;
const RECENT_ACTIVITY = 5;

// ponytail: the cursor anchors on a hash of the last lines of the window the adapters return (no inode/offset
// reader exists yet); a burst larger than the window, or identical repeated lines, reads as `reset`. Upgrade: an
// adapter method returning the file path, then base64url("<ino>:<offset>").
const anchorAt = (lines: string[], end: number) =>
  Bun.hash(lines.slice(Math.max(0, end - ANCHOR_LINES), end).join("\n")).toString(36);
const encodeCursor = (window: number, lines: string[]) =>
  Buffer.from(`${window}:${lines.length ? anchorAt(lines, lines.length) : ""}`).toString("base64url");

/** Decodes a follow cursor (400 `invalid_cursor`): the window size it was read with and its anchor. */
export function decodeCursor(raw: string): { window: number; anchor: string } {
  const m = /^(\d{1,4}):([0-9a-z]*)$/.exec(Buffer.from(raw, "base64url").toString());
  const window = Number(m?.[1]);
  if (!m || window < 1 || window > 2000) throw new ApiError(400, "invalid_cursor", "cursor is not valid");
  return { window, anchor: m[2] as string };
}

/** LogChunk of a raw tail: everything (first read) or the lines after the cursor's anchor; values redacted. */
export function logChunk(
  raw: string[],
  window: number,
  after: { anchor: string } | null,
  secrets: string[],
  stream?: LogStream,
): LogChunk & { redacted: number } {
  let fresh = raw;
  let reset = false;
  if (after?.anchor) {
    let end = raw.length;
    while (end > 0 && anchorAt(raw, end) !== after.anchor) end--;
    if (end === 0) reset = true;
    else fresh = raw.slice(end);
  }
  const { lines, redacted } = redactLines(fresh, secrets);
  const view = lines.map((l) => ({ ...splitLogTimestamp(l), ...(stream ? { stream } : {}) }));
  return { lines: view, cursor: encodeCursor(window, raw), reset, truncated: false, redacted };
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/-/g, "").replace("T", "-").replace(":", "");
const SECTION_OF: Record<keyof MonitorSnapshot, OverviewSection> = {
  device: "device",
  services: "services",
  apps: "apps",
  ingress: "domains",
  backup: "backup",
  security: "security",
};

/** A section's value for a list endpoint: pm2 down → 503 `pm2_unavailable` (+reason), other failures → 502. */
function required<T>(s: SnapshotSection<T>, label: string): T {
  if (s.ok) return s.value;
  const pm2 = /^Pm2UnavailableError: (\w+)/.exec(s.error);
  if (pm2) throw new ApiError(503, "pm2_unavailable", "pm2 is not running", { reason: pm2[1] });
  throw new SystemError(`${label}: ${s.error}`);
}

/** Monitoring + control operations behind /api/panel. */
export function createPanelService(deps: PanelDeps) {
  const { db, system, monitor, jobs, backup } = deps;
  const bootId = deps.bootId ?? PROCESS_BOOT_ID;
  const restartSelf = deps.restartSelf ?? (() => process.kill(process.pid, "SIGTERM"));
  const withLock = createActionLocks();

  const protectedSet = () =>
    new Set((getSetting(deps, "panel.protected_services") ?? "").split(",").map((s) => s.trim()));
  const sites = () => db.select({ name: site.name, app: site.app, database: site.database }).from(site).all();
  const publicApps = (procs: Pm2Proc[], list = sites()): App[] =>
    procs.map((p) => ({ ...toApp(p), site: list.find((s) => (s.app ?? s.name) === p.name)?.name ?? null }));
  const domains = (snap: MonitorSnapshot, apps: App[]): Domain[] =>
    buildDomains(required(snap.ingress, "ingress"), apps, lastChecksPerHost(db, RECENT_CHECKS), deps.panelPort ?? null);

  function deferRestart(actorId: string, name: DeferredRestart["service"], oldPid: number | null): DeferredRestart {
    recordAudit(db, { actorId, action: "service.restart", target: name });
    monitor.noteIntentionalRestart({ kind: "service", name });
    log.info(`[panel] service ${name} restart by ${actorId} (deferred)`);
    setTimeout(() => {
      if (name === "panel") return restartSelf();
      system.runit
        .control(name, "restart")
        .then((s) => s && monitor.patch("services", { ...s, protected: protectedSet().has(name), lockout: true }))
        .catch((e: unknown) => log.error(`[panel] deferred restart of ${name} failed: ${(e as Error).message}`));
    }, RESTART_DELAY_MS[name]);
    return { deferred: true, service: name, bootId, oldPid };
  }

  return {
    services: async (): Promise<Service[]> => required((await monitor.snapshot()).services, "services"),
    apps: async (): Promise<App[]> => publicApps(required((await monitor.snapshot()).apps, "apps")),
    async domains(): Promise<Domain[]> {
      const snap = await monitor.snapshot();
      return domains(snap, snap.apps.ok ? publicApps(snap.apps.value) : []);
    },
    probeDomain: (hostname: string): Promise<Domain> => monitor.probeDomain(hostname),

    async databases(): Promise<DatabaseInfo[]> {
      const snap = await monitor.snapshot();
      const pg = snap.services.ok ? snap.services.value.find((s) => s.name === "postgres") : undefined;
      if (snap.services.ok && pg?.state !== "run") throw new ApiError(503, "postgres_down", "postgres is not running");
      const good = snap.backup.ok ? (snap.backup.value.lastGood ?? []) : [];
      const list = sites();
      return (await system.postgres.listDatabases()).map((d) => ({
        ...d,
        site: list.find((s) => s.database === d.name)?.name ?? null,
        lastBackupAt: good.find((g) => g.kind === "database" && g.name === d.name)?.at ?? null,
      }));
    },

    status(): PanelStatus {
      const shown = monitor.problems().problems.filter((p) => p.kind !== "host");
      const n = (sev: string) => shown.filter((p) => p.severity === sev).length;
      return { danger: n("danger"), warning: n("warning"), sampledAt: monitor.status().sampledAt };
    },

    async overview(): Promise<PanelOverview> {
      const snap = await monitor.snapshot();
      const unavailable = (Object.keys(SECTION_OF) as (keyof MonitorSnapshot)[])
        .filter((k) => !snap[k].ok)
        .map((k) => SECTION_OF[k]);
      const list = sites();
      const apps = snap.apps.ok ? publicApps(snap.apps.value, list) : [];
      let recentActivity: PanelOverview["recentActivity"] = [];
      try {
        const paging = { page: 1, pageSize: RECENT_ACTIVITY, offset: 0 };
        recentActivity = listAudit(db, paging, { excludePrefixes: ["auth.", "session."] }).items;
      } catch (e) {
        log.warn(`[panel] overview activity unavailable: ${(e as Error).message}`);
        unavailable.push("activity");
      }
      const b = snap.backup.ok ? snap.backup.value : null;
      const ats = Object.values(snap).flatMap((s) => (s.ok ? [s.at] : []));
      const now = new Date();
      const alerts = monitor.alertStatus();
      return {
        mode: system.mode,
        device: snap.device.ok ? snap.device.value : null,
        loadBaseline: monitor.loadBaseline(),
        services: snap.services.ok ? snap.services.value : [],
        apps,
        domains: snap.ingress.ok ? domains(snap, apps) : [],
        problems: monitor.problems().problems.filter((p) => p.kind !== "host"),
        unavailable,
        recentActivity,
        backup: b && {
          configured: b.configured,
          lastRunAt: b.lastRun?.startedAt ?? null,
          lastStatus: b.lastRun?.status ?? null,
          nextRunAt: b.nextRunAt,
        },
        sites: {
          total: list.length,
          deployed: list.filter((s) => apps.some((a) => a.name === (s.app ?? s.name))).length,
        },
        alerts: { state: alerts.state, lastError: alerts.lastError },
        sampledAt: monitor.status().sampledAt,
        dataAt: new Date(ats.length ? Math.min(...ats) : now.getTime()).toISOString(),
        generatedAt: now.toISOString(),
      };
    },

    async controlService(
      actorId: string,
      name: string,
      action: ControlAction,
      body?: ControlBody,
    ): Promise<Service | DeferredRestart> {
      const lockout = LOCKOUT_SERVICES.includes(name);
      if (action === "stop" && lockout)
        throw new ApiError(409, "lockout", `service ${name} cannot be stopped from the panel`);
      const prot = protectedSet().has(name);
      if (action === "stop" && prot && body?.confirm !== name)
        throw new ApiError(409, "confirm_required", `type the service name to stop ${name}`);
      if (jobs.isLocked({ kind: "service", name }))
        throw new ApiError(409, "job_running", `a site job is using ${name}; try again when it finished`);
      if (action === "restart" && (name === "panel" || name === "cloudflared")) {
        const sup = await system.runit.supervise(name);
        if (!sup) throw new ApiError(404, "not_found", `unknown service ${name}`);
        if (name === "panel" && sup.pid !== process.pid)
          throw new ApiError(409, "not_supervised", "this panel process is not the one runit supervises");
        if (name === "panel" && (jobs.active() || backup.busy()))
          throw new ApiError(409, "job_running", "a site job or backup is running; restart the panel afterwards");
        return deferRestart(actorId, name, sup.pid);
      }
      const s = await withLock(`service:${name}`, () => system.runit.control(name, action));
      if (!s) throw new ApiError(404, "not_found", `unknown service ${name}`);
      if (action !== "stop") monitor.noteIntentionalRestart({ kind: "service", name });
      const meta = action === "stop" && prot ? { confirmTyped: true } : null;
      recordAudit(db, { actorId, action: `service.${action}`, target: name, meta });
      log.info(`[panel] service ${name} ${action} by ${actorId} → ${s.state}`);
      const out: Service = { ...s, protected: prot, lockout };
      monitor.patch("services", out);
      return out;
    },

    async controlApp(actorId: string, name: string, action: ControlAction): Promise<App> {
      if (jobs.isLocked({ kind: "app", name }))
        throw new ApiError(409, "job_running", `a site job is using ${name}; try again when it finished`);
      const a = await withLock(`app:${name}`, () => system.pm2.control(name, action));
      if (!a) throw new ApiError(404, "not_found", `unknown app ${name}`);
      if (action !== "stop") monitor.noteIntentionalRestart({ kind: "app", name });
      recordAudit(db, { actorId, action: `app.${action}`, target: name });
      log.info(`[panel] app ${name} ${action} by ${actorId} → ${a.status}`);
      const out = { ...a, site: sites().find((s) => (s.app ?? s.name) === name)?.name ?? null };
      monitor.patch("apps", out);
      return out;
    },

    async serviceLog(name: string, lines: number, after?: string) {
      const cur = after === undefined ? null : decodeCursor(after);
      const raw = await system.runit.readLog(name, cur?.window ?? lines);
      if (!raw) throw new ApiError(404, "not_found", `unknown service ${name}`);
      return logChunk(raw, cur?.window ?? lines, cur, []);
    },

    async appLog(name: string, stream: LogStream, lines: number, after?: string) {
      const cur = after === undefined ? null : decodeCursor(after);
      const raw = await system.pm2.readLog(name, stream, cur?.window ?? lines);
      if (!raw) throw new ApiError(404, "not_found", `unknown app ${name}`);
      return logChunk(raw, cur?.window ?? lines, cur, siteSecretsFor(db, name), stream);
    },

    /** Redacted log file for download (audited `log.download`); `stream` set = pm2 app, else runit service. */
    async logFile(actorId: string, name: string, stream?: LogStream): Promise<{ filename: string; text: string }> {
      const raw = stream
        ? await system.pm2.readLog(name, stream, DOWNLOAD_LINES)
        : await system.runit.readLog(name, DOWNLOAD_LINES);
      if (!raw) throw new ApiError(404, "not_found", `unknown ${stream ? "app" : "service"} ${name}`);
      const { lines } = redactLines(raw, stream ? siteSecretsFor(db, name) : []);
      const target = stream ? `app:${name}:${stream}` : `service:${name}`;
      recordAudit(db, { actorId, action: "log.download", target });
      return { filename: `${name}-${stamp(new Date())}.log`, text: lines.length ? `${lines.join("\n")}\n` : "" };
    },
  };
}
