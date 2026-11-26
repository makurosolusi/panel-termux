// Monitoring contract (PLAN/02 §3.1): problems, alerts, metric history. Problem rules live in overview.problems.ts.

/** What a problem is about. */
export type ProblemKind =
  | "service"
  | "app"
  | "domain"
  | "network"
  | "backup"
  | "security"
  | "disk"
  | "battery"
  | "host"
  | "alerts"
  | "site";

/** `info` (B4) = shown with tone info; never counted in verdicts/counts, never opens an alert event. */
export type ProblemSeverity = "info" | "warning" | "danger";

/** Stable codes: i18n key, dedupe key part, test fixture. Never rename; only add. */
export type ProblemCode =
  | "service_down"
  | "service_crash_loop"
  | "pm2_unavailable"
  | "app_errored"
  | "app_crash_loop"
  | "domain_unreachable"
  | "domain_http_error"
  | "internet_down"
  | "backup_not_configured"
  | "backup_failed"
  | "backup_partial"
  | "backup_stale"
  | "backup_item_stale"
  | "backup_status_error"
  | "backup_secrets_included"
  | "key_mismatch"
  | "access_not_seen"
  | "disk_low"
  | "battery_low"
  | "battery_hot"
  | "alerts_failing"
  | "site_job_failed"
  // one-shot notices (kind "host"): stored closed, sent once, never shown in the Ringkasan list
  | "host_rebooted"
  | "panel_restarted_unexpectedly";

/** Interpolation values of a problem's copy. */
export type ProblemParams = Record<string, string | number | boolean | null>;

/** `id` = `${code}:${target}`; `since` = first seen (problem_event.opened_at), null before persisted; `href` = SPA path. */
export type Problem = {
  id: string;
  code: ProblemCode;
  kind: ProblemKind;
  target: string;
  severity: ProblemSeverity;
  params: ProblemParams;
  since: string | null;
  href: string;
};

/** Overview parts that can fail on their own. */
export type OverviewSection = "device" | "services" | "apps" | "domains" | "backup" | "security" | "activity";

/** State of the alert channel. */
export type AlertChannelState = "not_configured" | "disabled" | "ok" | "failing";

/** Why the last Telegram send failed. */
export type AlertErrorCode =
  | "telegram_token_invalid" // 401
  | "telegram_chat_not_found" // 400 "chat not found"
  | "telegram_chat_migrated" // 400 + parameters.migrate_to_chat_id (auto-saved)
  | "telegram_forbidden" // 403 (bot blocked / removed)
  | "telegram_conflict" // 409 (webhook set or another getUpdates poller)
  | "telegram_rate_limited" // 429 (+ retry_after)
  | "telegram_bad_request" // other 400
  | "telegram_unreachable"; // network, timeout, 5xx

/** GET /api/panel/alerts/status */
export type AlertStatus = {
  channel: "telegram";
  state: AlertChannelState;
  lastSentAt: string | null;
  lastError: AlertErrorCode | null;
  lastErrorAt: string | null;
  /** Due but undelivered (e.g. while offline). */
  pending: number;
};

/** POST /api/dev/alerts/test → 200 */
export type AlertTestResult = { ok: true; sentAt: string };

/** One chat the bot can see (POST /api/dev/alerts/telegram/chats). */
export type TelegramChat = { id: string; title: string; type: "private" | "group" | "supergroup" | "channel" };
/** POST /api/dev/alerts/telegram/chats → 200 */
export type TelegramChats = { chats: TelegramChat[] };

/** Thin status for the nav badge: GET /api/panel/status (no system calls; last sampler result; info excluded). */
export type PanelStatus = { danger: number; warning: number; sampledAt: string | null };

/** Typical load of this phone (load5, last 7 days); null until >= 24 h of samples. */
export type LoadBaseline = { p10: number; p50: number; p90: number; spanHours: number };

/** One domain check for the heartbeat strip; `status` null = no answer. */
export type DomainCheck = { at: string; status: number | null };

/** `range` of GET /api/panel/metrics. */
export type MetricRange = "24h" | "7d";
/** One bucket average of GET /api/panel/metrics. */
export type MetricPoint = {
  at: string;
  batteryPct: number | null;
  memAvailableMb: number | null;
  diskFreeMb: number | null;
  load5: number | null;
};
/** GET /api/panel/metrics?range= — bucket averages, oldest first, at most 100 points (bounded, no pagination). */
export type MetricSeries = { range: MetricRange; bucketSec: number; points: MetricPoint[] };

/** Item of GET /api/panel/problems/history (newest first, `Page<ProblemEvent>`). */
export type ProblemEvent = {
  id: number;
  code: ProblemCode;
  kind: ProblemKind;
  target: string;
  severity: ProblemSeverity;
  params: ProblemParams;
  openedAt: string;
  closedAt: string | null;
  notified: boolean;
};
