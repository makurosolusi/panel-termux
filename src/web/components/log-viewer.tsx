// Shared log viewer (PLAN/01 §3.4): follow/pin, search with highlight, wrap, copy, download, stream filter.
import { cn } from "cn";
import { ArrowDownIcon, DownloadIcon, PauseIcon, PlayIcon, WrapTextIcon } from "lucide-react";
import { type ReactNode, type UIEvent, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/web/components/copy-button";
import { type BufferedLogLine, filterLogLines, LOG_MAX_LINES, logToText } from "@/web/components/log.buffer";
import { LogLines } from "@/web/components/log-lines";
import { SearchField } from "@/web/components/search-field";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import { idShell } from "@/web/i18n/id.shell";
import { formatNumber } from "@/web/shared/format";

const t = idShell.log;
/** Scrolling further than this from the bottom unpins the view. */
const UNPIN_PX = 32;
const WRAP_KEY = "panel-termux:log-wrap";
const PHONE_QUERY = "(max-width: 767px)";

/** Which stream(s) a log view shows. */
export type LogStreamFilter = "all" | "out" | "err";

/** Stored wrap preference, else on below 768 px. Storage can be blocked (private mode): fall back to the default. */
function initialWrap(): boolean {
  try {
    const stored = localStorage.getItem(WRAP_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // storage unavailable: use the width default below
  }
  return globalThis.matchMedia?.(PHONE_QUERY).matches ?? false;
}

/** `<label-slug>-YYYYMMDD-HHmm.log` in local time. */
export function logFileName(label: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "log"}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.log`;
}

/** Server download when `href` is given (audited there), else a Blob of the client buffer. */
function download(href: string | undefined, lines: readonly BufferedLogLine[], label: string) {
  const url = href ?? URL.createObjectURL(new Blob([logToText(lines)], { type: "text/plain" }));
  Object.assign(document.createElement("a"), { href: url, download: href ? "" : logFileName(label) }).click();
  if (!href) URL.revokeObjectURL(url);
}

const lastSeq = (lines: readonly BufferedLogLine[]) => lines.at(-1)?.seq ?? 0;

/** Log area with toolbar; `live` absent = static log. Lines are oldest first. */
export function LogViewer(props: {
  label: string;
  lines: readonly BufferedLogLine[];
  loading?: boolean;
  error?: ReactNode;
  empty: ReactNode;
  live?: { on: boolean; onChange: (on: boolean) => void };
  streams?: { value: LogStreamFilter; onChange: (v: LogStreamFilter) => void };
  downloadHref?: string;
  capped?: boolean;
  showLevel?: boolean;
  notice?: ReactNode;
  size?: "page" | "inline";
}) {
  const { label, lines, live, streams } = props;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query).trim();
  const [wrap, setWrap] = useState(initialWrap);
  // null = pinned to the bottom; otherwise the snapshot frozen when the user scrolled up.
  const [frozen, setFrozen] = useState<readonly BufferedLogLine[] | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const shown = frozen ?? lines;
  const visible = useMemo(() => filterLogLines(shown, deferredQuery), [shown, deferredQuery]);
  const newCount = frozen ? Math.max(0, lastSeq(lines) - lastSeq(frozen)) : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `visible` changing (new lines) is what triggers the re-pin scroll
  useLayoutEffect(() => {
    if (frozen === null && area.current) area.current.scrollTop = area.current.scrollHeight;
  }, [frozen, visible]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > UNPIN_PX;
    if (away && frozen === null) setFrozen(lines);
    else if (!away && frozen !== null) setFrozen(null);
  };
  const toggleWrap = () => {
    setWrap(!wrap);
    try {
      localStorage.setItem(WRAP_KEY, wrap ? "0" : "1");
    } catch {
      // storage unavailable: the choice lasts for this view only
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label={t.toolbar} className="flex flex-wrap items-center gap-2">
        {live && (
          <Button variant="outline" size="sm" aria-pressed={live.on} onClick={() => live.onChange(!live.on)}>
            {live.on ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
            {t.follow}
            {!live.on && <span className="text-muted-foreground">· {t.paused}</span>}
          </Button>
        )}
        {streams && (
          <fieldset className="flex rounded-md border text-sm">
            <legend className="sr-only">{label}</legend>
            {(["all", "out", "err"] as const).map((v) => (
              <label
                key={v}
                className="cursor-pointer px-3 py-1 pointer-coarse:py-2.5 has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-2"
              >
                <input
                  type="radio"
                  name={`${label}-stream`}
                  className="sr-only"
                  checked={streams.value === v}
                  onChange={() => streams.onChange(v)}
                />
                {t.streams[v]}
              </label>
            ))}
          </fieldset>
        )}
        <div className="min-w-40 flex-1">
          <SearchField value={query} onChange={setQuery} label={t.search} placeholder={t.searchPlaceholder} />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.wrap}
          title={t.wrap}
          aria-pressed={wrap}
          onClick={toggleWrap}
        >
          <WrapTextIcon aria-hidden />
        </Button>
        <CopyButton
          value={() => logToText(visible)}
          label={deferredQuery ? t.copyFiltered(formatNumber(visible.length)) : t.copy}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.download}
          title={t.download}
          onClick={() => download(props.downloadHref, lines, label)}
        >
          <DownloadIcon aria-hidden />
        </Button>
      </div>
      {props.notice}
      {props.error}
      {props.capped && <p className="text-muted-foreground text-xs">{t.capped(formatNumber(LOG_MAX_LINES))}</p>}
      {deferredQuery && (
        <p className="text-muted-foreground text-xs">
          {visible.length > 0 ? t.matches(formatNumber(visible.length), formatNumber(shown.length)) : t.noMatches}
        </p>
      )}
      <div className="relative">
        <div
          ref={area}
          role="log"
          aria-live="off"
          aria-label={label}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable log must be reachable by keyboard
          tabIndex={0}
          data-wrap={wrap}
          onScroll={onScroll}
          onKeyDown={(e) => e.key === "End" && setFrozen(null)}
          className={cn(
            "group/log overflow-auto rounded-md bg-muted py-2 font-mono text-xs leading-5 focus-visible:ring-2",
            props.size === "inline" ? "max-h-80" : "h-[calc(100dvh-16rem)] min-h-64",
          )}
        >
          {lines.length === 0 ? (
            props.loading ? (
              <Skeleton className="mx-3 h-24" />
            ) : (
              <div className="px-3 font-sans text-sm">{props.empty}</div>
            )
          ) : (
            <LogLines lines={visible} query={deferredQuery} showLevel={props.showLevel} />
          )}
        </div>
        {frozen && (
          <Button size="sm" className="absolute right-3 bottom-3 shadow" onClick={() => setFrozen(null)}>
            <ArrowDownIcon aria-hidden />
            {newCount > 0 ? t.newLines(newCount) : t.toBottom}
          </Button>
        )}
      </div>
    </div>
  );
}
