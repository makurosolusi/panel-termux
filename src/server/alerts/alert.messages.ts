// Telegram digest text (PLAN/02 §3.8): HTML, no emoji, ≤ 3,500 chars, ≤ 15 item lines, relative times only (the
// runit process TZ is not reliable). Problem wording comes from src/shared/problem.copy.ts.
import { formatDuration } from "../../shared/format.id";
import type { Problem } from "../../shared/monitor.types";
import { recovered, recoveredWhileOffline, title } from "../../shared/problem.copy";

/** Longest digest; below Telegram's 4,096 so entities and the footer always fit. */
export const DIGEST_MAX_CHARS = 3_500;
/** Item lines shown before "… dan N lainnya". */
export const DIGEST_MAX_LINES = 15;

/** Sent instead of the digest when the hourly cap is reached. */
export const OVERFLOW_TEXT = "Terlalu banyak notifikasi. Buka Ringkasan untuk melihat semuanya.";
/** Body of POST /api/dev/alerts/test. */
export const TEST_TEXT = "Notifikasi uji dari Panel Termux. Kalau pesan ini sampai, notifikasi sudah siap.";

/** Escapes the three characters Telegram HTML requires (plus quotes, harmless outside attributes). */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One line of a digest. Durations in seconds. */
export type DigestItem =
  | { type: "open" | "remind"; problem: Pick<Problem, "code" | "target" | "params" | "severity">; sinceSec: number }
  | { type: "recovered"; problem: Pick<Problem, "code" | "target" | "params">; durationSec: number }
  | { type: "recovered_offline"; problem: Pick<Problem, "code" | "target" | "params">; lastSeenAgoSec: number }
  | { type: "notice"; problem: Pick<Problem, "code" | "target" | "params"> };

const LABEL = { danger: "GAWAT", warning: "PERINGATAN", info: "INFO" } as const;

function line(item: DigestItem): string {
  switch (item.type) {
    case "open":
    case "remind": {
      const head = item.type === "remind" ? "MASIH · " : "";
      const since = item.sinceSec >= 60 ? ` · sejak ${formatDuration(item.sinceSec)}` : "";
      return `${head}${LABEL[item.problem.severity]} · ${title(item.problem)}${since}`;
    }
    case "recovered":
      return `PULIH · ${recovered(item.problem, item.durationSec)}`;
    case "recovered_offline":
      return `PULIH · ${recoveredWhileOffline(item.problem, item.lastSeenAgoSec)}`;
    case "notice":
      return `INFO · ${title(item.problem)}`;
  }
}

/** Builds one digest: header with the panel host, item lines, link to the Ringkasan. */
export function buildDigest(items: DigestItem[], appBaseUrl: string): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const header = `<b>Panel Termux</b> · ${escapeHtml(host)}`;
  const footer = `Buka Ringkasan: ${escapeHtml(`${base}/panel`)}`;
  const lines: string[] = [];
  let size = header.length + footer.length + 4;
  for (const [i, item] of items.entries()) {
    const l = escapeHtml(line(item));
    const restNote = `… dan ${items.length - i} lainnya`;
    if (i >= DIGEST_MAX_LINES || size + l.length + 1 + restNote.length + 1 > DIGEST_MAX_CHARS) {
      lines.push(restNote);
      break;
    }
    lines.push(l);
    size += l.length + 1;
  }
  return [header, ...lines, "", footer].join("\n");
}
