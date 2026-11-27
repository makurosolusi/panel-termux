// Alert engine (PLAN/02 §4.6, K11): reconciles each tick's problems with the problem_event rows (the durable alert
// state, so a restart never re-sends) and delivers at most one Telegram digest per tick.
import type { Locale } from "../../shared/locale";
import type { AlertErrorCode, AlertStatus, Problem, ProblemSeverity } from "../../shared/monitor.types";
import type { problemEvent } from "../db/schema/monitor.schema";
import { log } from "../log.service";
import type { ProblemResult } from "../monitor/monitor.contract";
import { alertDelayMs, severityRank } from "../panel/overview.rules";
import { ALERT_COPY, buildDigest, type DigestItem } from "./alert.messages";
import { TelegramError } from "./telegram.client";

const MIN = 60_000;
/** Absent this many ticks in a row before an event closes (and before a reopened one counts as back). */
export const CLOSE_AFTER_ABSENT_TICKS = 2;
/** A key that closed less than this ago reopens its row instead of inserting one. */
export const REOPEN_WINDOW_MS = 15 * MIN;
/** No second "open" message for a key within this, unless it escalates to danger. */
export const COOLDOWN_MS = 15 * MIN;
/** "STILL" reminder for a problem that stays open. */
export const REMIND_MS = 24 * 60 * MIN;
/** last_seen_at is rewritten at most this often while nothing changes (bounds flash writes). */
export const LAST_SEEN_STEP_MS = 10 * MIN;
/** Telegram messages per rolling hour; the last slot carries the overflow text. */
export const ALERT_MAX_PER_HOUR = 20;
/** internet_down shorter than this is not worth a "RECOVERED" line when it was never announced. */
export const INTERNET_RECOVERY_MIN_MS = 5 * MIN;
/** Failed sends in a row that raise `alerts_failing`. */
export const FAILING_AFTER = 3;
const BACKOFF_MIN = [1, 2, 4, 8, 16, 30];
const HARD_ERRORS: AlertErrorCode[] = ["telegram_token_invalid", "telegram_forbidden", "telegram_chat_not_found"];
const HARD_RETRY_MS = 60 * MIN;

/** One problem_event row. */
export type EventRow = typeof problemEvent.$inferSelect;
/** problem_event row before insert. */
export type NewEventRow = Omit<EventRow, "id">;

/** problem_event access the engine needs (implemented over Drizzle by monitor.history.ts). */
export interface AlertStore {
  openEvents(): EventRow[];
  /** Rows with closed_at >= sinceMs. */
  closedSince(sinceMs: number): EventRow[];
  insert(row: NewEventRow): number;
  update(id: number, patch: Partial<NewEventRow>): void;
}

/** Channel settings, re-read each tick. `configured` = token and chat id set. */
export type AlertSettings = {
  configured: boolean;
  enabled: boolean;
  minSeverity: "warning" | "danger";
  intervalSec: number;
  appBaseUrl: string;
  /** `alerts.language`: language of every message. */
  language: Locale;
};

/** Sends one digest; throws TelegramError on failure. */
export type AlertSend = (text: string, opts: { silent: boolean }) => Promise<void>;

type Due = { row: EventRow; item: DigestItem; mark: Partial<NewEventRow> };

const sec = (ms: number) => Math.max(0, Math.round(ms / 1000));
const newRow = (p: Problem, now: number, closedAt: number | null): NewEventRow => ({
  ...{ key: p.id, code: p.code, kind: p.kind, target: p.target, severity: p.severity, params: p.params },
  ...{ openedAt: now, lastSeenAt: now, closedAt, notifiedState: null, notifiedSeverity: null, lastSentAt: null },
});
const ORDER: Record<DigestItem["type"], number> = { open: 0, remind: 0, recovered: 3, recovered_offline: 3, notice: 4 };
const maxSeverity = (a: ProblemSeverity, b: ProblemSeverity) => (severityRank(a) >= severityRank(b) ? a : b);

/** Builds the engine for one panel; in-memory counters reset on restart (the DB rows do not). */
export function createAlertEngine({ store, send }: { store: AlertStore; send: AlertSend }) {
  const absent = new Map<string, number>();
  const backSince = new Map<string, number>(); // reopened key → consecutive present ticks (flap guard)
  const sentTimes: number[] = [];
  let failStreak = 0;
  let retryAt = 0;
  let lastError: AlertErrorCode | null = null;
  let lastErrorAt: number | null = null;
  let lastSentAt: number | null = null;
  let pending = 0;
  let channelActive = false;

  /** §4.6 steps 1–2: open/refresh/reopen present problems, close absent ones; returns problems with `since`. */
  function reconcile(result: ProblemResult, now: number): Problem[] {
    const open = new Map(store.openEvents().map((e) => [e.key, e]));
    const recentlyClosed = store.closedSince(now - REOPEN_WINDOW_MS);
    const since = new Map<string, number>();
    const present = new Set<string>();
    for (const p of result.problems) {
      if (p.severity === "info" || p.kind === "host") continue;
      present.add(p.id);
      absent.delete(p.id);
      const e = open.get(p.id);
      if (e) {
        if (backSince.has(p.id)) backSince.set(p.id, (backSince.get(p.id) ?? 0) + 1);
        const severity = maxSeverity(e.severity, p.severity);
        const changed = severity !== e.severity || JSON.stringify(e.params) !== JSON.stringify(p.params);
        if (changed || now - e.lastSeenAt >= LAST_SEEN_STEP_MS)
          store.update(e.id, { severity, params: p.params, lastSeenAt: now });
        since.set(p.id, e.openedAt);
        continue;
      }
      const old = recentlyClosed.filter((r) => r.key === p.id).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
      if (old) {
        store.update(old.id, { closedAt: null, severity: p.severity, params: p.params, lastSeenAt: now });
        if (old.notifiedState === "closed") backSince.set(p.id, 1);
        since.set(p.id, old.openedAt);
        continue;
      }
      store.insert(newRow(p, now, null));
      since.set(p.id, now);
    }
    const hidden = new Map(result.suppressed.map((p) => [p.id, p]));
    for (const e of open.values()) {
      if (present.has(e.key)) continue;
      const s = hidden.get(e.key);
      if (s || result.unknownKinds.has(e.kind)) {
        // C1/K3: frozen, never closed by missing data or a root cause; a hidden problem is still seen.
        absent.delete(e.key);
        if (s && now - e.lastSeenAt >= LAST_SEEN_STEP_MS) store.update(e.id, { lastSeenAt: now });
        continue;
      }
      const n = (absent.get(e.key) ?? 0) + 1;
      if (n < CLOSE_AFTER_ABSENT_TICKS) {
        absent.set(e.key, n);
        continue;
      }
      absent.delete(e.key);
      backSince.delete(e.key);
      store.update(e.id, { closedAt: now });
    }
    return result.problems.map((p) => {
      const t = since.get(p.id);
      return t === undefined ? p : { ...p, since: new Date(t).toISOString() };
    });
  }

  /** §4.6 step 3: what the next digest should say. */
  function dueItems(s: AlertSettings, now: number): Due[] {
    const out: Due[] = [];
    for (const row of store.openEvents()) {
      const delay = alertDelayMs(row.code, s.intervalSec);
      if (delay === null || row.kind === "host" || now - row.openedAt < delay) continue;
      if (severityRank(row.severity) < severityRank(s.minSeverity)) continue;
      if ((backSince.get(row.key) ?? CLOSE_AFTER_ABSENT_TICKS) < CLOSE_AFTER_ABSENT_TICKS) continue;
      const notified = row.notifiedState === "open";
      const up = !notified || severityRank(row.severity) > severityRank(row.notifiedSeverity ?? "info");
      const remind = notified && !up && row.lastSentAt !== null && now - row.lastSentAt >= REMIND_MS;
      if (!up && !remind) continue;
      const toDanger = row.severity === "danger" && row.notifiedSeverity !== "danger";
      if (row.lastSentAt !== null && now - row.lastSentAt < COOLDOWN_MS && !toDanger) continue;
      const item: DigestItem = { type: remind ? "remind" : "open", problem: row, sinceSec: sec(now - row.openedAt) };
      out.push({ row, item, mark: { notifiedState: "open", notifiedSeverity: row.severity, lastSentAt: now } });
    }
    for (const row of store.closedSince(now - REMIND_MS)) {
      const closedAt = row.closedAt ?? now;
      const mark = { notifiedState: "closed" as const, lastSentAt: now };
      if (row.notifiedState === "open") {
        const gap = closedAt - row.lastSeenAt > REOPEN_WINDOW_MS;
        const item: DigestItem = gap
          ? { type: "recovered_offline", problem: row, lastSeenAgoSec: sec(now - row.lastSeenAt) }
          : { type: "recovered", problem: row, durationSec: sec(closedAt - row.openedAt) };
        out.push({ row, item, mark });
      } else if (row.notifiedState === null && row.kind === "host") {
        out.push({ row, item: { type: "notice", problem: row }, mark });
      } else if (row.notifiedState === null && row.code === "internet_down") {
        if (closedAt - row.openedAt >= INTERNET_RECOVERY_MIN_MS)
          out.push({ row, item: { type: "recovered", problem: row, durationSec: sec(closedAt - row.openedAt) }, mark });
      }
    }
    const order = (d: Due) => ORDER[d.item.type] + (ORDER[d.item.type] ? 0 : 2 - severityRank(d.row.severity));
    return out.sort((a, b) => order(a) - order(b));
  }

  function fail(e: unknown, now: number): void {
    const code = e instanceof TelegramError ? e.code : "telegram_unreachable";
    failStreak++;
    lastError = code;
    lastErrorAt = now;
    const wait =
      code === "telegram_rate_limited" && e instanceof TelegramError
        ? (e.retryAfterSec ?? 60) * 1000
        : HARD_ERRORS.includes(code)
          ? HARD_RETRY_MS
          : (BACKOFF_MIN[Math.min(failStreak, BACKOFF_MIN.length) - 1] ?? 30) * MIN;
    retryAt = now + wait;
  }

  /** §4.6 steps 3–7: sends one digest (outside the DB transaction); marks rows only after a successful send. */
  async function deliver(s: AlertSettings, now: number): Promise<void> {
    channelActive = s.configured && s.enabled;
    const due = dueItems(s, now);
    pending = due.length;
    if (!due.length || !channelActive || now < retryAt) return;
    while (sentTimes.length && now - (sentTimes[0] ?? 0) >= 60 * MIN) sentTimes.shift();
    if (sentTimes.length >= ALERT_MAX_PER_HOUR) return;
    const overflow = sentTimes.length === ALERT_MAX_PER_HOUR - 1;
    const silent = !due.some(
      (d) => (d.item.type === "open" || d.item.type === "remind") && d.row.severity === "danger",
    );
    try {
      await send(
        overflow
          ? ALERT_COPY[s.language].overflow
          : buildDigest(
              due.map((d) => d.item),
              s.appBaseUrl,
              s.language,
            ),
        { silent: overflow ? false : silent },
      );
    } catch (e) {
      fail(e, now);
      log.warn(
        `[alerts] digest of ${due.length} item(s) not sent (${lastError}), retry in ${sec(retryAt - now)}s: ${(e as Error).message}`,
      );
      return;
    }
    sentTimes.push(now);
    failStreak = 0;
    retryAt = 0;
    lastSentAt = now;
    if (overflow) return; // rows stay due; the next hour sends what is still true
    for (const d of due) store.update(d.row.id, d.mark);
    pending = 0;
  }

  return {
    reconcile,
    deliver,

    /** Stores one-shot boot notices as closed rows; deliver() sends each once (PLAN/02 §4.6 step 6). */
    recordNotices(notices: Problem[], now: number): void {
      for (const p of notices) store.insert(newRow(p, now, now));
    },

    /** Reason for `alerts_failing` (enabled channel, ≥ 3 failed sends in a row), else null. */
    failing(): AlertErrorCode | null {
      return channelActive && failStreak >= FAILING_AFTER ? lastError : null;
    },

    /** Token/chat changed or a test send succeeded: retry now, clear the failing state. */
    resetFailures(): void {
      failStreak = 0;
      retryAt = 0;
      lastError = null;
      lastErrorAt = null;
    },

    /** GET /api/panel/alerts/status. */
    status(s: Pick<AlertSettings, "configured" | "enabled">): AlertStatus {
      const state = !s.configured
        ? "not_configured"
        : !s.enabled
          ? "disabled"
          : failStreak >= FAILING_AFTER
            ? "failing"
            : "ok";
      const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
      return {
        channel: "telegram",
        state,
        lastSentAt: iso(lastSentAt),
        lastError,
        lastErrorAt: iso(lastErrorAt),
        pending,
      };
    },
  };
}

/** The alert engine of one panel. */
export type AlertEngine = ReturnType<typeof createAlertEngine>;
