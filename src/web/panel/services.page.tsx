import type { Service } from "@/shared/panel.types";
import { Badge } from "@/web/components/ui/badge";
import { id } from "@/web/i18n/id";
import { formatUptime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { ControlButtons } from "./control.buttons";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { actionBlocks, serviceTone } from "./panel.status";
import { StatusBadge } from "./status.badge";
import { UNIT_GRID, UnitCard } from "./unit.card";
import { usePanelControl } from "./use-panel-control";

const t = id.panel;

const meta = (s: Service): string[] => [
  ...(s.pid !== null ? [t.pid(s.pid)] : []),
  ...(s.uptimeSec !== null ? [t.uptime(formatUptime(s.uptimeSec))] : []),
];

/** /panel/services: runit services with state, start/stop/restart and log links. */
export function ServicesPage() {
  const query = useApiQuery<Service[]>(panelUrl("/services"), PANEL_REFRESH_MS);
  const { pending, run } = usePanelControl("services", query.reload);
  return (
    <QueryView query={query} codes={t.errorCodes} isEmpty={(d) => d.length === 0}>
      {(services) => (
        <div className={UNIT_GRID}>
          {services.map((s) => (
            <UnitCard
              key={s.name}
              name={s.name}
              meta={meta(s)}
              logTo={`/panel/services/${encodeURIComponent(s.name)}/log`}
              badges={
                <>
                  {s.protected && <Badge variant="secondary">{t.protectedBadge}</Badge>}
                  <StatusBadge tone={serviceTone(s)} label={t.serviceStates[s.state]} />
                </>
              }
            >
              <ControlButtons
                name={s.name}
                blocks={actionBlocks({ kind: "service", item: s }, pending !== null)}
                pending={pending?.name === s.name ? pending.action : null}
                onRun={(action) => void run(s.name, action)}
              />
            </UnitCard>
          ))}
        </div>
      )}
    </QueryView>
  );
}
