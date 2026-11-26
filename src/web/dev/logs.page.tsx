import { useState } from "react";
import { type DevLogs, LOG_LEVELS, type LogLevel } from "@/shared/dev.types";
import { Label } from "@/web/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { id } from "@/web/i18n/id";
import { cn } from "@/web/lib/cn";
import { devUrl } from "./dev.api";
import { formatDateTime } from "./dev.format";
import { QueryView } from "./query.state";
import { SearchBox } from "./search.box";
import { useDevQuery } from "./use-dev-query";

const LOGS_REFRESH_MS = 5_000;
const t = id.dev.logs;

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

/** /dev/logs: in-memory server log, newest first, with level filter, text search and optional 5 s refresh. */
export function LogsPage() {
  const [level, setLevel] = useState<LogLevel>("info");
  const [q, setQ] = useState("");
  const [auto, setAuto] = useState(true);
  const query = useDevQuery<DevLogs>(devUrl("/logs", { level, q }), auto ? LOGS_REFRESH_MS : undefined);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t.level}>
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
        <SearchBox initial="" placeholder={t.searchPlaceholder} label={t.searchPlaceholder} onSearch={setQ} />
        <div className="flex items-center gap-2">
          <Switch id="logs-auto" checked={auto} onCheckedChange={setAuto} />
          <Label htmlFor="logs-auto" className="whitespace-nowrap">
            {t.autoRefresh}
          </Label>
        </div>
      </div>
      <QueryView query={query} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <ol className="max-h-[70svh] overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs">
            {d.items.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no id; the list is replaced wholesale
              <li key={i} className="flex gap-2 py-0.5 whitespace-pre-wrap break-all">
                <time className="shrink-0 text-muted-foreground" dateTime={e.at}>
                  {formatDateTime(e.at, true)}
                </time>
                <span className={cn("w-12 shrink-0 uppercase", LEVEL_CLASS[e.level])}>{e.level}</span>
                <span className="min-w-0">{e.msg}</span>
              </li>
            ))}
          </ol>
        )}
      </QueryView>
    </section>
  );
}
