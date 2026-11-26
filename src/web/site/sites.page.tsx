import { HistoryIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { DiscoveredIngress, Site } from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { PANEL_REFRESH_MS, panelUrl } from "@/web/panel/panel.api";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { AdoptDialog } from "./adopt.dialog";
import { IntegrationBanner } from "./integration.banner";
import { SITE_ERROR_CODES } from "./site.api";
import { SiteCard } from "./site.card";

const t = id.site;

/** "Belum dikelola": ingress entries without a site, each with an Adopt button. Hidden when there are none. */
function Discovered({ onAdopted }: { onAdopted: () => void }) {
  const query = useApiQuery<DiscoveredIngress[]>(panelUrl("/sites/discovered"));
  const [adopting, setAdopting] = useState<DiscoveredIngress | null>(null);
  if (!query.data || query.data.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{t.discovered.title}</h2>
      <p className="text-sm text-muted-foreground">{t.discovered.description}</p>
      <Card className="py-0">
        <CardContent className="divide-y px-4">
          {query.data.map((d) => (
            <div key={d.hostname} className="flex items-center gap-2 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{d.hostname}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {[d.port === null ? t.discovered.noPort : t.list.port(d.port), d.app && t.discovered.app(d.app)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAdopting(d)}>
                {t.discovered.adopt}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <AdoptDialog
        entry={adopting}
        onClose={() => setAdopting(null)}
        onAdopted={() => {
          setAdopting(null);
          query.reload();
          onAdopted();
        }}
      />
    </section>
  );
}

/** /panel/sites: integration banner, managed/adopted sites, and unmanaged ingress entries to adopt. */
export function SitesPage() {
  const query = useApiQuery<Site[]>(panelUrl("/sites"), PANEL_REFRESH_MS);
  return (
    <div className="flex flex-col gap-4">
      <IntegrationBanner />
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/panel/sites/new">
            <PlusIcon aria-hidden />
            {t.list.create}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/panel/jobs">
            <HistoryIcon aria-hidden />
            {t.list.jobs}
          </Link>
        </Button>
      </div>
      <QueryView query={query} codes={SITE_ERROR_CODES} isEmpty={(d) => d.length === 0}>
        {(sites) => (
          <div className="grid gap-3 md:grid-cols-2">
            {sites.map((s) => (
              <SiteCard key={s.name} site={s} />
            ))}
          </div>
        )}
      </QueryView>
      <Discovered onAdopted={query.reload} />
    </div>
  );
}
