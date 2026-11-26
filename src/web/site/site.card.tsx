import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";
import type { Site, SiteAppStatus } from "@/shared/site.types";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { appStatusTone } from "@/web/panel/panel.status";
import { StatusBadge } from "@/web/panel/status.badge";

const t = id.site.list;

/** pm2 status badge of a site's app ("not_deployed" = no pm2 process). */
export function SiteAppBadge({ status }: { status: SiteAppStatus }) {
  if (status === "not_deployed") return <StatusBadge tone="muted" label={t.noApp} />;
  return <StatusBadge tone={appStatusTone(status)} label={id.panel.appStatuses[status]} />;
}

/** Hostname as an external link. */
export function HostLink({ host }: { host: string }) {
  return (
    <a
      href={`https://${host}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.open(host)}
      className="inline-flex min-w-0 items-center gap-1 text-sm hover:underline"
    >
      <span className="truncate">{host}</span>
      <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/** One site: name (→ detail), status, hostnames, port/db/runtime facts. */
export function SiteCard({ site }: { site: Site }) {
  const facts = [t.port(site.port), site.database ? t.db(site.database) : t.noDb];
  if (site.runtime === "grun") facts.push(t.grun);
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/panel/sites/${encodeURIComponent(site.name)}`}
            aria-label={t.detail(site.name)}
            className="mr-auto inline-flex items-center gap-1 font-medium hover:underline"
          >
            {site.name}
            <ChevronRightIcon className="size-4" aria-hidden />
          </Link>
          {!site.managed && <Badge variant="secondary">{t.adopted}</Badge>}
          <SiteAppBadge status={site.appStatus} />
        </div>
        <div className="flex flex-col gap-0.5">
          {site.hostnames.map((h) => (
            <HostLink key={h} host={h} />
          ))}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{facts.join(" · ")}</p>
      </CardContent>
    </Card>
  );
}
