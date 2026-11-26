import { ExternalLinkIcon } from "lucide-react";
import type { Domain } from "@/shared/panel.types";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { healthLabel, healthTone } from "./panel.status";
import { StatusBadge } from "./status.badge";

const t = id.panel.domains;

function DomainCard({ d }: { d: Domain }) {
  const target = [d.service, d.app ?? t.noApp].join(" · ");
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://${d.hostname}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.open(d.hostname)}
            className="mr-auto inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"
          >
            <span className="truncate">{d.hostname}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          </a>
          <span title={formatDateTime(d.health.checkedAt, true)}>
            <StatusBadge tone={healthTone(d.health)} label={healthLabel(d.health, t)} />
          </span>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">→ {target}</p>
      </CardContent>
    </Card>
  );
}

/** /panel/domains: cloudflared hostnames → local service/app, with the last HTTPS health check. */
export function DomainsPage() {
  const query = useApiQuery<Domain[]>(panelUrl("/domains"), PANEL_REFRESH_MS);
  return (
    <QueryView query={query} codes={id.panel.errorCodes} isEmpty={(d) => d.length === 0}>
      {(domains) => (
        <div className="grid gap-3 md:grid-cols-2">
          {domains.map((d) => (
            <DomainCard key={d.hostname} d={d} />
          ))}
        </div>
      )}
    </QueryView>
  );
}
