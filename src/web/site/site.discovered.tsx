import { useState } from "react";
import { useNavigate } from "react-router";
import type { Discovered, DiscoveredIngress } from "@/shared/site.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { Section } from "@/web/components/section";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import type { ApiQuery } from "@/web/shared/use-api-query";
import { AdoptDialog } from "./adopt.dialog";
import { type DiscoveredRow, discoveredRows } from "./site.adopt";

const t = idSite.discovered;

const COLUMNS: readonly DataColumn<DiscoveredRow>[] = [
  { key: "hostname", header: t.cols.hostname, mobile: "title", cell: (r) => r.hostname },
  {
    key: "target",
    header: t.cols.target,
    cell: (r) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs">{r.target}</span>
        {r.reason && <span className="text-xs text-muted-foreground">{r.reason}</span>}
      </span>
    ),
  },
];

/**
 * "Belum dikelola" (PLAN/03 §5.1): cloudflared domains without a site; Adopsi opens the dialog driven by real pm2
 * apps. The panel's own host is listed without a button. Hidden when there is nothing (or pm2 cannot be read).
 */
export function SiteDiscovered({ query }: { query: ApiQuery<Discovered> }) {
  const navigate = useNavigate();
  const [adopting, setAdopting] = useState<DiscoveredIngress | null>(null);
  if (query.error && !query.data) {
    return query.error.code === "pm2_unavailable" ? (
      <p className="text-sm text-muted-foreground">{t.unavailable}</p>
    ) : null;
  }
  const data = query.data;
  if (!data || data.ingress.length === 0) return null;
  const byHost = new Map(data.ingress.map((i) => [i.hostname, i]));

  return (
    <div id="belum-dikelola" className="scroll-mt-20">
      <Section title={t.title} description={t.description}>
        <DataTable
          label={t.label}
          columns={COLUMNS}
          rows={discoveredRows(data)}
          rowKey={(r) => r.hostname}
          actions={(r) =>
            r.adoptable ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={t.adoptLabel(r.hostname)}
                className="ml-auto"
                onClick={() => setAdopting(byHost.get(r.hostname) ?? null)}
              >
                {t.adopt}
              </Button>
            ) : null
          }
        />
        <AdoptDialog
          entry={adopting}
          apps={data.apps}
          onClose={() => setAdopting(null)}
          onFailed={query.reload}
          onDone={(name) => navigate(`/panel/sites/${encodeURIComponent(name)}`)}
        />
      </Section>
    </div>
  );
}
