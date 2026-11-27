// Telegram digest text (PLAN/02 §3.8): HTML, no emoji, ≤ 3,500 chars, ≤ 15 item lines, relative times only (the
// runit process TZ is not reliable). Problem wording comes from src/shared/problem.copy*.ts. Every text is in the
// panel's `alerts.language` (PLAN/08 §3.4, §5); the copy lives here because only the server sends it. No Intl.
import { formatDuration } from "../../shared/format.number";
import type { Locale } from "../../shared/locale";
import type { Problem } from "../../shared/monitor.types";
import { problemCopy } from "../../shared/problem.copy";

/** Longest digest; below Telegram's 4,096 so entities and the footer always fit. */
export const DIGEST_MAX_CHARS = 3_500;
/** Item lines shown before "… and N more". */
export const DIGEST_MAX_LINES = 15;

/** Fixed Telegram text per locale: labels, the hourly-cap message (`overflow`) and the test message (`test`). */
export const ALERT_COPY: Record<
  Locale,
  {
    severity: Record<Problem["severity"], string>;
    still: string;
    since: (duration: string) => string;
    recovered: string;
    more: (n: number) => string;
    openOverview: (url: string) => string;
    overflow: string;
    test: string;
  }
> = {
  en: {
    severity: { danger: "CRITICAL", warning: "WARNING", info: "INFO" },
    still: "STILL",
    since: (d) => `since ${d}`,
    recovered: "RECOVERED",
    more: (n) => `… and ${n} more`,
    openOverview: (url) => `Open Overview: ${url}`,
    overflow: "Too many alerts. Open Overview to see them all.",
    test: "Test message from Panel Termux. If you can read this, alerts are ready.",
  },
  id: {
    severity: { danger: "GAWAT", warning: "PERINGATAN", info: "INFO" },
    still: "MASIH",
    since: (d) => `sejak ${d}`,
    recovered: "PULIH",
    more: (n) => `… dan ${n} lainnya`,
    openOverview: (url) => `Buka Ringkasan: ${url}`,
    overflow: "Terlalu banyak notifikasi. Buka Ringkasan untuk melihat semuanya.",
    test: "Notifikasi uji dari Panel Termux. Kalau pesan ini sampai, notifikasi sudah siap.",
  },
};

/** Escapes the three characters Telegram HTML requires (plus quotes, harmless outside attributes). */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One line of a digest. Durations in seconds. */
export type DigestItem =
  | { type: "open" | "remind"; problem: Pick<Problem, "code" | "target" | "params" | "severity">; sinceSec: number }
  | { type: "recovered"; problem: Pick<Problem, "code" | "target" | "params">; durationSec: number }
  | { type: "recovered_offline"; problem: Pick<Problem, "code" | "target" | "params">; lastSeenAgoSec: number }
  | { type: "notice"; problem: Pick<Problem, "code" | "target" | "params"> };

function line(item: DigestItem, locale: Locale): string {
  const c = ALERT_COPY[locale];
  const problem = problemCopy(locale);
  switch (item.type) {
    case "open":
    case "remind": {
      const head = item.type === "remind" ? `${c.still} · ` : "";
      const since = item.sinceSec >= 60 ? ` · ${c.since(formatDuration(item.sinceSec, locale))}` : "";
      return `${head}${c.severity[item.problem.severity]} · ${problem.title(item.problem)}${since}`;
    }
    case "recovered":
      return `${c.recovered} · ${problem.recovered(item.problem, item.durationSec)}`;
    case "recovered_offline":
      return `${c.recovered} · ${problem.recoveredWhileOffline(item.problem, item.lastSeenAgoSec)}`;
    case "notice":
      return `${c.severity.info} · ${problem.title(item.problem)}`;
  }
}

/** Builds one digest in `locale`: header with the panel host, item lines, link to the Overview. */
export function buildDigest(items: DigestItem[], appBaseUrl: string, locale: Locale): string {
  const c = ALERT_COPY[locale];
  const base = appBaseUrl.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const header = `<b>Panel Termux</b> · ${escapeHtml(host)}`;
  const footer = c.openOverview(escapeHtml(`${base}/panel`));
  const lines: string[] = [];
  let size = header.length + footer.length + 4;
  for (const [i, item] of items.entries()) {
    const l = escapeHtml(line(item, locale));
    const restNote = c.more(items.length - i);
    if (i >= DIGEST_MAX_LINES || size + l.length + 1 + restNote.length + 1 > DIGEST_MAX_CHARS) {
      lines.push(restNote);
      break;
    }
    lines.push(l);
    size += l.length + 1;
  }
  return [header, ...lines, "", footer].join("\n");
}
