// The monitor of one panel (PLAN/02 §3.5, §4.1): snapshot cache + sampler + rule state + alert engine + history.
import type { BackupStatus } from "../../shared/backup.types";
import type { LoadBaseline } from "../../shared/monitor.types";
import type { Domain, Service } from "../../shared/panel.types";
import type { SecurityStatus } from "../../shared/security.types";
import { type AlertSettings, createAlertEngine } from "../alerts/alert.engine";
import { createTelegramClient, TELEGRAM_API_URL, TelegramError } from "../alerts/telegram.client";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { setting } from "../db/schema";
import { log } from "../log.service";
import { INTENTIONAL_RESTART_GRACE_MS, type ProblemContext } from "../panel/overview.problems";
import { ApiError } from "../routes/http.error";
import { getSetting, KeyMismatchError, SETTINGS, type SettingsDeps } from "../settings.service";
import type { SystemAdapters } from "../system/system.types";
import type { Monitor, MonitorState, ProblemResult } from "./monitor.contract";
import * as history from "./monitor.history";
import { createSampler, httpReachable, type TickResult, type Timers } from "./monitor.sampler";
import { createSnapshotCache } from "./monitor.snapshot";
import { bootNotices, isProbeFailure, recordProbe } from "./monitor.state";

const HOUR = 3_600_000;
/** K18 default; boot passes `PANEL_CONNECTIVITY_URL` when set. */
export const CONNECTIVITY_PROBE_URL = "https://www.gstatic.com/generate_204";
/** Services whose stop is always refused (K13), whatever `panel.protected_services` says. */
export const LOCKOUT_SERVICES: readonly string[] = ["panel", "cloudflared"];
/** Manual domain checks per host: at most one per this gap (429 `too_soon`). */
export const MANUAL_CHECK_GAP_MS = 10_000;
/** Probes per host that seed the failure streak at boot, and checks shown per domain. */
const SEED_CHECKS = 3;
const RECENT_CHECKS = 30;

/** What the monitor needs; the status functions come from the services that own them (PLAN/03, PLAN/04). */
export type MonitorDeps = SettingsDeps & {
  system: SystemAdapters;
  backupStatus: () => BackupStatus | Promise<BackupStatus>;
  securityStatus: () => SecurityStatus | Promise<SecurityStatus>;
  /** Newest first. */
  jobs: () => ProblemContext["jobs"];
  adminSeenSinceBoot: () => boolean;
  appBaseUrl: string;
  panelPort: number;
  bootNotice: { cleanShutdown: boolean; uptimeSec: number };
  connectivityUrl?: string;
  /** Tests: Telegram mock server, fake clock/timers. */
  telegramBaseUrl?: string;
  now?: () => number;
  timers?: Timers;
};

/** Monitor plus what the alert routes need. */
export type MonitorService = Monitor & {
  /** Token/chat changed or a test send succeeded (PLAN/02 §3.6). */
  resetAlertFailures(): void;
  /** One sampler tick now (tests, and the first overview before the scheduled tick). */
  tick(): Promise<void>;
};

/** Telegram moved the chat to a supergroup: store the new id with a System audit row (PLAN/02 §3.8). */
export function onChatMigrated({ db }: Pick<SettingsDeps, "db">, newChatId: string): void {
  const key = "alerts.telegram_chat_id";
  const err = SETTINGS[key].validate(newChatId);
  if (err) throw new Error(`onChatMigrated: new chat id ${err}`);
  const now = new Date();
  // setSetting needs a user actor (FK on setting.updated_by / audit_log.actor_id); this change is the panel's own.
  db.transaction((tx) => {
    tx.insert(setting)
      .values({ key, value: newChatId, updatedAt: now, updatedBy: null })
      .onConflictDoUpdate({ target: setting.key, set: { value: newChatId, updatedAt: now, updatedBy: null } })
      .run();
    // Same bun:sqlite connection as `tx` (pattern setSettings), so the audit row commits with the setting.
    recordAudit(db, {
      actorId: null,
      actorKind: "system",
      action: "settings.update",
      target: key,
      meta: { reset: false, reason: "chat_migrated" },
    });
  });
  log.info(`[alerts] Telegram chat migrated, ${key} updated`);
}

const intSetting = (deps: SettingsDeps, key: "monitor.sample_interval_sec", fallback: number) => {
  const n = Number(getSetting(deps, key));
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Builds the monitor (use monitorFor for the shared instance). */
export function createMonitor(deps: MonitorDeps): MonitorService {
  const { db, system } = deps;
  const now = deps.now ?? Date.now;
  const state: MonitorState = {
    domains: new Map(),
    appRestarts: new Map(),
    serviceRuns: new Map(),
    intentional: new Map(),
    internetDown: false,
  };
  const protectedSet = () =>
    new Set((getSetting(deps, "panel.protected_services") ?? "").split(",").map((s) => s.trim()));

  const snapshot = createSnapshotCache(
    {
      device: () => system.device.read(),
      services: async (): Promise<Service[]> => {
        const prot = protectedSet();
        return (await system.runit.list()).map((s) => ({
          ...s,
          protected: prot.has(s.name),
          lockout: LOCKOUT_SERVICES.includes(s.name),
        }));
      },
      apps: () => system.pm2.procs(),
      ingress: () => system.cloudflared.listIngress(),
      backup: () => deps.backupStatus(),
      security: () => deps.securityStatus(),
    },
    now,
  );

  function alertSettings(intervalSec: number): AlertSettings {
    let configured = false;
    try {
      configured = Boolean(
        getSetting(deps, "alerts.telegram_bot_token") && getSetting(deps, "alerts.telegram_chat_id"),
      );
    } catch (e) {
      // An unreadable token is the key_mismatch problem already; alerts just count as not configured meanwhile.
      if (!(e instanceof KeyMismatchError)) throw e;
    }
    const minSeverity = getSetting(deps, "alerts.min_severity") === "danger" ? "danger" : "warning";
    return {
      configured,
      enabled: getSetting(deps, "alerts.enabled") !== "off",
      minSeverity,
      intervalSec,
      appBaseUrl: deps.appBaseUrl,
    };
  }

  const engine = createAlertEngine({
    store: history.createAlertStore(db),
    async send(text, { silent }) {
      const token = getSetting(deps, "alerts.telegram_bot_token");
      const chat = getSetting(deps, "alerts.telegram_chat_id");
      if (!token || !chat) throw new TelegramError("telegram_bad_request", "alerts are not configured");
      const client = createTelegramClient({
        token,
        baseUrl: deps.telegramBaseUrl ?? TELEGRAM_API_URL,
        fetch: deps.system.offline?.telegramFetch,
      });
      await client.sendMessage(chat, text, { silent, onChatMigrated: (id) => onChatMigrated(deps, id) });
    },
  });

  let latest: ProblemResult = { problems: [], suppressed: [], unknownKinds: new Set() };
  let baseline: { at: number; value: LoadBaseline | null } | null = null;
  let prunedAt = 0;
  const lastManual = new Map<string, number>();

  async function commit({ snap, result, checks, now: t }: TickResult): Promise<void> {
    const sample = history.tickSample(snap.device.ok ? snap.device.value : null, result.problems, t);
    let shown = result.problems;
    try {
      db.transaction(() => {
        history.insertTick(db, sample, checks);
        shown = engine.reconcile(result, t);
      });
    } catch (e) {
      log.error(`[monitor] tick ${t} not stored: ${(e as Error).message}`);
    }
    latest = { ...result, problems: shown };
    await engine.deliver(alertSettings(sampler.status().intervalSec), t);
    if (t - prunedAt >= HOUR) {
      prunedAt = t;
      try {
        history.pruneHistory(db, t);
        baseline = { at: t, value: history.loadBaseline(db, t) };
      } catch (e) {
        log.error(`[monitor] hourly prune/baseline failed: ${(e as Error).message}`);
      }
    }
  }

  const sampler = createSampler({
    snapshot,
    state,
    probe: (h) => system.cloudflared.probe(h),
    localStatus: (port) => system.net.httpStatus(port),
    connectivity: () => httpReachable(deps.connectivityUrl ?? CONNECTIVITY_PROBE_URL),
    intervalSec: () => intSetting(deps, "monitor.sample_interval_sec", 60),
    context: (intervalSec) => {
      const warn = getSetting(deps, "monitor.battery_warn_percent");
      return {
        intervalSec,
        batteryWarnPercent: warn === null || warn === "off" ? null : Number(warn),
        jobs: deps.jobs(),
        alertsFailing: engine.failing(),
        adminSeenSinceBoot: deps.adminSeenSinceBoot(),
      };
    },
    commit,
    now,
    timers: deps.timers,
  });

  /** Boot: one-shot notices, and failure streaks replayed from the last probes (restart rings start empty). */
  function seed(): void {
    try {
      engine.recordNotices(bootNotices(deps.bootNotice), now());
      for (const c of history.lastChecksPerHost(db, SEED_CHECKS))
        recordProbe(state, c.hostname, {
          status: c.status,
          ms: c.ms,
          checkedAt: new Date(c.at).toISOString(),
          local: c.localStatus,
        });
    } catch (e) {
      log.error(`[monitor] boot seed failed: ${(e as Error).message}`);
    }
  }

  return {
    snapshot: () => snapshot.get(),
    pm2Procs: () => snapshot.pm2Procs(),
    patch: (section, item) => snapshot.patch(section, item),
    problems: () => latest,
    noteIntentionalRestart({ kind, name }) {
      state.intentional.set(`${kind}:${name}`, now() + INTENTIONAL_RESTART_GRACE_MS);
    },

    async probeDomain(hostname: string): Promise<Domain> {
      const rule = (await system.cloudflared.listIngress()).find((r) => r.hostname === hostname);
      if (!rule || hostname.includes("*")) throw new ApiError(404, "not_found", `unknown hostname ${hostname}`);
      const wait = (lastManual.get(hostname) ?? -Infinity) + MANUAL_CHECK_GAP_MS - now();
      if (wait > 0)
        throw new ApiError(429, "too_soon", `check ${hostname} again later`, { retryAfterSec: Math.ceil(wait / 1000) });
      lastManual.set(hostname, now());
      const res = await system.cloudflared.probe(hostname);
      const local = isProbeFailure(res.status) && rule.port !== null ? await system.net.httpStatus(rule.port) : null;
      const t = now();
      const health = { ...res, checkedAt: new Date(t).toISOString(), local };
      recordProbe(state, hostname, health);
      history.insertCheck(db, { hostname, at: t, status: res.status, ms: res.ms, localStatus: local });
      const procs = await snapshot.pm2Procs().catch(() => []); // pm2 down: the domain still reports its own health
      const app = rule.port === null ? undefined : procs.find((a) => a.port === rule.port);
      const target = rule.port === null ? "none" : rule.port === deps.panelPort ? "panel" : app ? "app" : "other";
      const recent = history
        .hostChecks(db, hostname, RECENT_CHECKS)
        .map((c) => ({ at: new Date(c.at).toISOString(), status: c.status }));
      const failures = state.domains.get(hostname)?.failures ?? 0;
      return {
        ...rule,
        app: app?.name ?? null,
        site: app?.site ?? null,
        target,
        health: { ...health, failures },
        recent,
      };
    },

    status: () => sampler.status(),
    loadBaseline() {
      const t = now();
      if (!baseline || t - baseline.at >= HOUR) baseline = { at: t, value: history.loadBaseline(db, t) };
      return baseline.value;
    },
    alertStatus: () => engine.status(alertSettings(sampler.status().intervalSec)),
    resetAlertFailures: () => engine.resetFailures(),
    tick: () => sampler.tick(),
    start() {
      seed();
      return sampler.start();
    },
    idle: () => sampler.idle(),
  };
}

const instances = new WeakMap<Db, MonitorService>();

/** The monitor of `deps.db` (one per Db, like backupServiceFor). */
export function monitorFor(deps: MonitorDeps): MonitorService {
  let m = instances.get(deps.db);
  if (!m) {
    m = createMonitor(deps);
    instances.set(deps.db, m);
  }
  return m;
}
