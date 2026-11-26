// Response types of the admin monitoring/control API under /api/panel (PLAN/02 §3.2). Errors are `{ error, message }`.
// Fields marked "0.3.0" are optional until their producers land; they become required in W7 (schedule §1.4).
import type { BackupRunStatus } from "./backup.types";
import type { DevAuditEntry } from "./dev.types";
import type {
  AlertStatus,
  DomainCheck,
  LoadBaseline,
  Problem as MonitorProblem,
  OverviewSection,
} from "./monitor.types";

export type { LogChunk, LogLine } from "./log.types";
export type { ProblemCode, ProblemKind, ProblemParams, ProblemSeverity } from "./monitor.types";

/** Which system adapter backs the panel: real Termux tools, or in-memory demo data (dev/tests). */
export type PanelMode = "termux" | "fake";

/** Control action accepted by POST /services/:name/:action and /apps/:name/:action. */
export type ControlAction = "start" | "stop" | "restart";

/** All control actions. */
export const CONTROL_ACTIONS: readonly ControlAction[] = ["start", "stop", "restart"];

/** runit service state as reported by `sv status`. */
export type ServiceState = "run" | "down" | "finish" | "unknown";

/** Item of GET /services. `wantUp` = the supervisor's target state; `protected` = stop needs typed confirmation. */
export type Service = {
  name: string;
  state: ServiceState;
  pid: number | null;
  /** "run" only. */
  uptimeSec: number | null;
  /** 0.3.0. "down" only, from `down: …: 120971s`. */
  downSec?: number | null;
  wantUp: boolean;
  protected: boolean;
  /** 0.3.0. panel, cloudflared — stop always refused. */
  lockout?: boolean;
};

/** pm2 process status. */
export type AppStatus = "online" | "stopped" | "errored" | "launching" | "unknown";

/** Item of GET /apps. `port` from the app's env PORT; `cpu` always null on Android. */
export type App = {
  name: string;
  status: AppStatus;
  pid: number | null;
  memoryMb: number | null;
  cpu: number | null;
  restarts: number;
  uptimeSec: number | null;
  port: number | null;
  /** 0.3.0. A pm2 module, not an app. */
  module?: boolean;
  /** 0.3.0. Site whose pm2 app this is (table site.app). */
  site?: string | null;
};

/**
 * Last HTTPS check of a hostname; all null until the first check finished. `failures` = consecutive failed probes;
 * `local` = HTTP status of 127.0.0.1:<port> when the public probe failed.
 */
export type DomainHealth = {
  status: number | null;
  ms: number | null;
  checkedAt: string | null;
  /** 0.3.0 */
  failures?: number;
  /** 0.3.0 */
  local?: number | null;
};

/** Item of GET /domains: one cloudflared ingress rule. `app` = pm2 app whose port matches. */
export type Domain = {
  hostname: string;
  service: string;
  port: number | null;
  app: string | null;
  /** 0.3.0 */
  site?: string | null;
  /** 0.3.0. What answers behind it (panel = port equals the panel PORT). */
  target?: "app" | "panel" | "other" | "none";
  health: DomainHealth;
  /** 0.3.0. Up to 30 newest checks, oldest first. */
  recent?: DomainCheck[];
};

/** Item of GET /databases (templates and the `postgres` DB excluded). */
export type DatabaseInfo = {
  name: string;
  owner: string;
  sizeBytes: number;
  /** 0.3.0 */
  site?: string | null;
  /** 0.3.0. From PLAN/04 `lastGoodItem(db, "database", name)`. */
  lastBackupAt?: string | null;
};

/** Power source reported by termux-battery-status. */
export type BatteryPlug = "ac" | "usb" | "wireless" | "unplugged" | "unknown";
/** Charging state reported by termux-battery-status. */
export type BatteryStatus = "charging" | "discharging" | "full" | "not_charging" | "unknown";

/**
 * Battery reading; null in DeviceInfo when termux-battery-status is unavailable or hangs. `charging` = status
 * charging|full. `temperatureC` becomes `number | null` (never a fake 0) in W7, when the web formats null.
 */
export type Battery = {
  percent: number;
  charging: boolean;
  /** 0.3.0 */
  status?: BatteryStatus;
  /** 0.3.0 */
  plugged?: BatteryPlug;
  temperatureC: number;
  /** 0.3.0 */
  health?: string | null;
};

/** Device metrics in GET /overview. `load` = 1/5/15-minute load average; `cpuCores` = logical CPUs. */
export type DeviceInfo = {
  battery: Battery | null;
  cpuCores: number;
  memory: { totalMb: number; availableMb: number };
  disk: { freeBytes: number; totalBytes: number };
  load: [number, number, number];
  uptimeSec: number;
};

/**
 * Something an admin should look at. Transitional (W0–W7): the 0.2.x shape (`message`) still compiles while the
 * monitor (`monitor.types.ts` Problem, all fields) replaces it; W7 makes this an alias of that type.
 */
export type Problem = Pick<MonitorProblem, "kind" | "target" | "severity"> &
  Partial<Omit<MonitorProblem, "kind" | "target" | "severity">> & { message?: string };

/** Backup summary in GET /overview. `lastRunAt` = start time of the newest run. */
export type OverviewBackup = {
  configured: boolean;
  lastRunAt: string | null;
  lastStatus: BackupRunStatus | null;
  nextRunAt: string | null;
};

/**
 * GET /overview. Failed sections are empty (null in W7) and listed in `unavailable`; `dataAt` = oldest section time
 * shown. `problems` excludes suppressed ones and notices, includes `info`. `recentActivity` = 5 newest without
 * `auth.`/`session.` actions.
 */
export type PanelOverview = {
  mode: PanelMode;
  device: DeviceInfo;
  /** 0.3.0 */
  loadBaseline?: LoadBaseline | null;
  services: Service[];
  apps: App[];
  domains: Domain[];
  problems: Problem[];
  /** 0.3.0 */
  unavailable?: OverviewSection[];
  recentActivity: DevAuditEntry[];
  backup: OverviewBackup;
  sites: { total: number; deployed: number };
  /** 0.3.0 */
  alerts?: Pick<AlertStatus, "state" | "lastError">;
  /** 0.3.0 */
  sampledAt?: string | null;
  /** 0.3.0 */
  dataAt?: string;
  generatedAt: string;
};

/** 202 body of POST /services/panel|cloudflared/restart (sent before the restart happens). */
export type DeferredRestart = {
  deferred: true;
  service: "panel" | "cloudflared";
  bootId: string;
  oldPid: number | null;
};

/** Body of POST /services/:name/stop for a protected service (typed name). */
export type ControlBody = { confirm?: string };

/** Log stream of a pm2 app. */
export type LogStream = "out" | "err";

/** 0.2.x body of GET /services/:name/log and /apps/:name/log, oldest line first; replaced by LogChunk in W7. */
export type LogLines = { lines: string[] };
