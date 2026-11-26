import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { LogLines, LogStream } from "@/shared/panel.types";
import { Button } from "@/web/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { id } from "@/web/i18n/id";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { type ControlKind, panelUrl } from "./panel.api";

const t = id.panel.log;
/** Selectable tail sizes; the server caps at 2000. */
export const LOG_LINE_OPTIONS = [100, 200, 500, 1000, 2000] as const;
const DEFAULT_LINES = 200;
const STREAMS: readonly LogStream[] = ["out", "err"];

/** Reads `?lines=` (only an offered option) and, for apps, `?stream=` (default stdout). */
export function parseLogParams(params: URLSearchParams): { lines: number; stream: LogStream } {
  const n = Number(params.get("lines"));
  return {
    lines: (LOG_LINE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_LINES,
    stream: params.get("stream") === "err" ? "err" : "out",
  };
}

function LogText({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on new lines to keep the newest (last) line in view
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <pre
      ref={ref}
      className="max-h-[70svh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all"
    >
      {lines.join("\n")}
    </pre>
  );
}

/** /panel/services/:name/log and /panel/apps/:name/log?stream=: tail of a unit's log, oldest line first. */
export function LogPage({ kind }: { kind: ControlKind }) {
  const name = useParams().name ?? "";
  const [params, setParams] = useSearchParams();
  const { lines, stream } = parseLogParams(params);
  const set = (key: string, value: string) =>
    setParams((p) => {
      p.set(key, value);
      return p;
    });
  const query = useApiQuery<LogLines>(
    panelUrl(`/${kind}/${encodeURIComponent(name)}/log`, { lines, stream: kind === "apps" ? stream : undefined }),
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/panel/${kind}`}>
            <ArrowLeftIcon aria-hidden />
            {t.back}
          </Link>
        </Button>
        <h2 className="mr-auto truncate font-mono font-medium">{t.title(name)}</h2>
        {kind === "apps" && (
          <Select value={stream} onValueChange={(v) => set("stream", v)}>
            <SelectTrigger size="sm" className="w-28" aria-label={t.stream}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STREAMS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t.streams[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={String(lines)} onValueChange={(v) => set("lines", v)}>
          <SelectTrigger size="sm" className="w-32" aria-label={t.lines}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LINE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t.linesOption(n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={query.reload} disabled={query.loading}>
          <RefreshCwIcon className={query.loading ? "animate-spin" : undefined} aria-hidden />
          {t.refresh}
        </Button>
      </div>
      <QueryView query={query} codes={id.panel.errorCodes}>
        {(d) =>
          d.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <LogText lines={d.lines} />
          )
        }
      </QueryView>
    </section>
  );
}
