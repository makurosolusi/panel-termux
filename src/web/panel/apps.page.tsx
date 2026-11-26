import type { App } from "@/shared/panel.types";
import { id } from "@/web/i18n/id";
import { formatUptime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { ControlButtons } from "./control.buttons";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { actionBlocks, appTone } from "./panel.status";
import { StatusBadge } from "./status.badge";
import { UNIT_GRID, UnitCard } from "./unit.card";
import { usePanelControl } from "./use-panel-control";

const t = id.panel;

const meta = (a: App): string[] => [
  ...(a.port !== null ? [`:${a.port}`] : []),
  ...(a.pid !== null ? [t.pid(a.pid)] : []),
  ...(a.uptimeSec !== null ? [t.uptime(formatUptime(a.uptimeSec))] : []),
  ...(a.memoryMb !== null ? [`${a.memoryMb} MB`] : []),
  ...(a.cpu !== null ? [`CPU ${a.cpu}%`] : []),
  t.restarts(a.restarts),
];

/** /panel/apps: pm2 apps with status, resource use, start/stop/restart and log links. */
export function AppsPage() {
  const query = useApiQuery<App[]>(panelUrl("/apps"), PANEL_REFRESH_MS);
  const { pending, run } = usePanelControl("apps", query.reload);
  return (
    <QueryView query={query} codes={t.errorCodes} isEmpty={(d) => d.length === 0}>
      {(apps) => (
        <div className={UNIT_GRID}>
          {apps.map((a) => (
            <UnitCard
              key={a.name}
              name={a.name}
              meta={meta(a)}
              logTo={`/panel/apps/${encodeURIComponent(a.name)}/log`}
              badges={<StatusBadge tone={appTone(a)} label={t.appStatuses[a.status]} />}
            >
              <ControlButtons
                name={a.name}
                blocks={actionBlocks({ kind: "app", item: a }, pending !== null)}
                pending={pending?.name === a.name ? pending.action : null}
                onRun={(action) => void run(a.name, action)}
              />
            </UnitCard>
          ))}
        </div>
      )}
    </QueryView>
  );
}
