import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { LogStream } from "@/shared/panel.types";
import { ErrorState } from "@/web/components/error-state";
import { LogViewer } from "@/web/components/log-viewer";
import { PageHeader } from "@/web/components/page-header";
import { tPanel } from "@/web/i18n/en.panel";
import { apiErrorMessage } from "@/web/shared/api.client";
import { useLogFollow } from "@/web/shared/use-log-follow";
import { type ControlKind, panelUrl } from "./panel.api";

const t = tPanel.log;
const STREAMS: readonly LogStream[] = ["out", "err"];

/** `?stream=err` selects stderr; anything else is stdout. */
export const parseStream = (params: URLSearchParams): LogStream => (params.get("stream") === "err" ? "err" : "out");

/** Follow + download URLs of a unit's log (the stream only applies to pm2 apps). */
export function logUrls(kind: ControlKind, name: string, stream: LogStream): { follow: string; download: string } {
  const base = `/${kind}/${encodeURIComponent(name)}/log`;
  const q = { stream: kind === "apps" ? stream : undefined };
  return { follow: panelUrl(base, q), download: panelUrl(`${base}/download`, q) };
}

function StreamSwitch({ value, onChange }: { value: LogStream; onChange: (s: LogStream) => void }) {
  return (
    <fieldset className="flex rounded-md border text-sm">
      <legend className="sr-only">{t.stream}</legend>
      {STREAMS.map((s) => (
        <label
          key={s}
          className="cursor-pointer px-3 py-1.5 font-mono pointer-coarse:py-2.5 has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-2"
        >
          <input
            type="radio"
            name="log-stream"
            className="sr-only"
            checked={value === s}
            onChange={() => onChange(s)}
          />
          {t.streams[s]}
        </label>
      ))}
    </fieldset>
  );
}

/** /panel/services/:name/log and /panel/apps/:name/log?stream=: followed tail of a unit's log (redacted server-side). */
export function LogPage({ kind }: { kind: ControlKind }) {
  const name = useParams().name ?? "";
  const [params, setParams] = useSearchParams();
  const stream = parseStream(params);
  const [live, setLive] = useState(true);
  const urls = logUrls(kind, name, stream);
  const log = useLogFollow(urls.follow, { enabled: live });
  const title = t.title(name);

  return (
    <>
      <PageHeader
        title={title}
        back={{ to: `/panel/${kind}`, label: kind === "apps" ? t.backApps : t.backServices }}
        actions={
          kind === "apps" && (
            <StreamSwitch
              value={stream}
              onChange={(s) =>
                setParams(
                  (p) => {
                    p.set("stream", s);
                    return p;
                  },
                  { replace: true },
                )
              }
            />
          )
        }
      />
      <LogViewer
        label={title}
        lines={log.lines}
        loading={log.loading}
        empty={t.empty}
        live={{ on: live, onChange: setLive }}
        downloadHref={urls.download}
        capped={log.capped}
        notice={
          <p className="text-xs text-muted-foreground">
            {t.note}
            {log.truncated && <span className="text-warning"> {t.truncated}</span>}
          </p>
        }
        error={
          log.error && (
            <ErrorState
              compact
              title={t.failed}
              description={apiErrorMessage(log.error, tPanel.errorCodes)}
              onRetry={log.reload}
              retrying={log.loading}
            />
          )
        }
      />
    </>
  );
}
