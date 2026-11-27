// Rows of the shared LogViewer (PLAN/01 §3.4): memoized per `seq` so a poll that adds k lines renders only k rows.
import { cn } from "cn";
import { memo } from "react";
import { type BufferedLogLine, LOG_LINE_DISPLAY_MAX, stripAnsi } from "@/web/components/log.buffer";
import { tShell } from "@/web/i18n/en.shell";
import { formatClock, formatDayLabel, formatNumber } from "@/web/shared/format";

const t = tShell.log;

/** Display text of a line: ANSI stripped, cut at `max` characters; `cut` = how many characters were hidden. */
export function cutLogText(raw: string, max = LOG_LINE_DISPLAY_MAX): { shown: string; cut: number } {
  const text = stripAnsi(raw);
  return text.length > max ? { shown: text.slice(0, max), cut: text.length - max } : { shown: text, cut: 0 };
}

/** Splits `text` around case-insensitive occurrences of `query`, for `<mark>` highlighting; empty query = one part. */
export function splitHighlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

/** Local calendar day of an ISO time ("2026-11-26"), or null when absent/invalid. */
const localDay = (at: string | null): string | null => {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** `seq`s of lines that start a new local day compared with the previous dated line (undated lines are skipped). */
export function daySeparatorSeqs(lines: readonly BufferedLogLine[]): Set<number> {
  const seqs = new Set<number>();
  let prev: string | null = null;
  for (const line of lines) {
    const day = localDay(line.at);
    if (!day) continue;
    if (prev && day !== prev) seqs.add(line.seq);
    prev = day;
  }
  return seqs;
}

type RowProps = { line: BufferedLogLine; query: string; showLevel: boolean; separator: boolean };

const LogRow = memo(function LogRow({ line, query, showLevel, separator }: RowProps) {
  const { shown, cut } = cutLogText(line.text);
  const isErr = line.stream === "err" || line.level === "error";
  return (
    <>
      {separator && line.at && (
        // biome-ignore lint/a11y/useSemanticElements: <hr> cannot hold the day label text
        <div role="separator" className="px-3 pt-2 pb-1 font-sans font-medium text-muted-foreground">
          {formatDayLabel(line.at)}
        </div>
      )}
      <div
        className={cn(
          "flex gap-3 border-l-2 border-transparent px-3",
          isErr && "border-danger bg-danger-subtle",
          !isErr && line.level === "warn" && "border-warning",
        )}
      >
        {line.at && (
          <time dateTime={line.at} className="shrink-0 text-muted-foreground tabular-nums select-none">
            {formatClock(line.at)}
          </time>
        )}
        {showLevel && line.level && <span className="w-10 shrink-0 text-muted-foreground uppercase">{line.level}</span>}
        <span className="min-w-0 whitespace-pre group-data-[wrap=true]/log:[overflow-wrap:anywhere] group-data-[wrap=true]/log:whitespace-pre-wrap">
          {line.stream === "err" && <span className="sr-only">{t.streams.err}: </span>}
          {splitHighlight(shown, query).map((p, i) =>
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reordered
            p.hit ? <mark key={i}>{p.text}</mark> : p.text,
          )}
          {cut > 0 && <span className="text-muted-foreground"> {t.lineCut(formatNumber(cut))}</span>}
        </span>
      </div>
    </>
  );
});

/** The log rows; wrapping is a CSS toggle on the parent (`group/log` + `data-wrap`) so it never re-renders rows. */
export function LogLines({
  lines,
  query,
  showLevel = false,
}: {
  lines: readonly BufferedLogLine[];
  query: string;
  showLevel?: boolean;
}) {
  const separators = daySeparatorSeqs(lines);
  return lines.map((line) => (
    <LogRow key={line.seq} line={line} query={query} showLevel={showLevel} separator={separators.has(line.seq)} />
  ));
}
