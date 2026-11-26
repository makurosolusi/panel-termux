import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { type DevLogEntry, type DevLogs, LOG_LEVELS, type LogLevel } from "@/shared/dev.types";
import { ErrorState } from "@/web/components/error-state";
import { InlineCode } from "@/web/components/inline-code";
import type { BufferedLogLine } from "@/web/components/log.buffer";
import { LogViewer } from "@/web/components/log-viewer";
import { PageHeader } from "@/web/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { idCommon } from "@/web/i18n/id.common";
import { idDevLogs } from "@/web/i18n/id.dev.logs";
import { apiErrorMessage } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";

const t = idDevLogs;
const LOGS_REFRESH_MS = 5_000;
/** Server maximum per request; the ring holds 2.000, the viewer shows the newest 1.000. */
const LOGS_LIMIT = 1_000;
const DEFAULT_LEVEL: LogLevel = "info";

/** `?level=` as a known level (health page links `?level=error`), else the default. */
export const levelParam = (raw: string | null): LogLevel => LOG_LEVELS.find((l) => l === raw) ?? DEFAULT_LEVEL;

const sameEntry = (a: BufferedLogLine, b: DevLogEntry) => a.at === b.at && a.level === b.level && a.text === b.msg;

/**
 * API entries (newest first, the whole ring each poll) → viewer lines (oldest first) whose `seq` continues the
 * previous poll's numbering, so lines already shown keep their seq and "N baris baru" counts only new ones.
 */
export function toViewerLines(prev: readonly BufferedLogLine[], items: readonly DevLogEntry[]): BufferedLogLine[] {
  const oldestFirst = [...items].reverse();
  const last = prev.at(-1);
  let anchor = -1; // index in oldestFirst of prev's last line
  if (last)
    for (let i = oldestFirst.length - 1; i >= 0 && anchor < 0; i--)
      if (sameEntry(last, oldestFirst[i] as DevLogEntry)) anchor = i;
  const base = last && anchor >= 0 ? last.seq - anchor : (last?.seq ?? -1) + 1;
  return oldestFirst.map((e, i) => ({ at: e.at, text: e.msg, level: e.level, seq: base + i }));
}

/** /dev/logs?level=: the panel's own in-memory log, polled every 5 s while following. */
export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const level = levelParam(params.get("level"));
  const [live, setLive] = useState(true);
  const query = useApiQuery<DevLogs>(`/api/dev/logs?level=${level}&limit=${LOGS_LIMIT}`, LOGS_REFRESH_MS, {
    enabled: live,
  });
  const lines = useRef<{ data: DevLogs | undefined; lines: BufferedLogLine[] }>({ data: undefined, lines: [] });
  if (query.data !== lines.current.data)
    lines.current = { data: query.data, lines: toViewerLines(lines.current.lines, query.data?.items ?? []) };

  const setLevel = (next: string) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next === DEFAULT_LEVEL) out.delete("level");
      else out.set("level", next);
      return out;
    });

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading, live }}
        actions={
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger size="sm" className="w-40 pointer-coarse:h-11" aria-label={t.level}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {t.levels[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <LogViewer
        label={t.label}
        lines={lines.current.lines}
        loading={query.data === undefined && query.loading}
        error={
          query.error && (
            <ErrorState
              compact
              title={idCommon.errorTitles[query.error.kind]}
              description={apiErrorMessage(query.error, t.errorCodes)}
              onRetry={query.reload}
              retrying={query.loading}
            />
          )
        }
        empty={t.empty}
        live={{ on: live, onChange: setLive }}
        showLevel
        notice={
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {t.memoryNote} <InlineCode copy>{t.logPath}</InlineCode>
          </p>
        }
      />
    </div>
  );
}
