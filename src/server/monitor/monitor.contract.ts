// Internal monitor contract (PLAN/02 §3.1, C15) shared by the rules, sampler/core and API workers.
import type { BackupStatus } from "../../shared/backup.types";
import type { AlertStatus, LoadBaseline, Problem, ProblemKind } from "../../shared/monitor.types";
import type { App, DeviceInfo, Domain, DomainHealth, Service } from "../../shared/panel.types";
import type { SecurityStatus } from "../../shared/security.types";
import type { Pm2Proc } from "../system/pm2.termux";
import type { IngressRule } from "../system/system.types";

/** Last result of one snapshot part; a failed refresh keeps the previous value as `stale`. `at` = epoch ms. */
export type SnapshotSection<T> =
  | { ok: true; value: T; at: number }
  | { ok: false; error: string; at: number | null; stale: T | null };

/** Everything the sampler read in its latest tick. */
export type MonitorSnapshot = {
  device: SnapshotSection<DeviceInfo>;
  services: SnapshotSection<Service[]>;
  apps: SnapshotSection<Pm2Proc[]>;
  ingress: SnapshotSection<IngressRule[]>;
  backup: SnapshotSection<BackupStatus>;
  security: SnapshotSection<SecurityStatus>;
};

/** Sampler memory (lost on restart, documented): domain fail/success streaks, restart rings, crash-loop streaks. */
export type MonitorState = {
  domains: Map<string, { failures: number; last: DomainHealth }>;
  /** Ring of pm2 restart counters, 10 min. */
  appRestarts: Map<string, { at: number; restarts: number }[]>;
  /** Last 3 ticks per runit service. */
  serviceRuns: Map<string, { pid: number; at: number }[]>;
  /** `${kind}:${name}` → until (epoch ms). */
  intentional: Map<string, number>;
  internetDown: boolean;
};

/** Output of the problem rules: shown problems, those hidden by a cause, and kinds whose input was unavailable. */
export type ProblemResult = { problems: Problem[]; suppressed: Problem[]; unknownKinds: Set<ProblemKind> };

/** Sampler state behind /dev/health (DECISIONS B5: no separate heartbeat). */
export type MonitorStatus = {
  sampledAt: string | null;
  intervalSec: number;
  lastTickMs: number | null;
  running: boolean;
};

/** The monitor service, one instance per Db (pattern backupServiceFor); built by `monitorFor` in monitor.service.ts. */
export interface Monitor {
  /** Stale-while-revalidate; never waits for probes. */
  snapshot(): Promise<MonitorSnapshot>;
  /** For PLAN/03 lists (≤ 15 s stale). */
  pm2Procs(): Promise<Pm2Proc[]>;
  patch<K extends "services" | "apps">(section: K, item: Service | App): void;
  /** From the latest snapshot + state. */
  problems(): ProblemResult;
  /** PLAN/03 job runner calls this too. */
  noteIntentionalRestart(r: { kind: "app" | "service"; name: string }): void;
  /** Manual check. */
  probeDomain(hostname: string): Promise<Domain>;
  status(): MonitorStatus;
  /** Cached, recomputed at most hourly. */
  loadBaseline(): LoadBaseline | null;
  alertStatus(): AlertStatus;
  /** Returns stop. */
  start(): () => void;
  idle(): Promise<void>;
}
