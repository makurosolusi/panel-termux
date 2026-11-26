import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { SiteDetail } from "@/shared/site.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { SITE_ERROR_CODES, siteUrl } from "./site.api";
import { SiteAppBadge } from "./site.card";
import { SiteDelete } from "./site.delete";
import { SiteEnvEditor } from "./site.env-editor";
import { SiteHostnames } from "./site.hostnames";

const t = id.site.detail;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

function SiteInfo({ site }: { site: SiteDetail }) {
  const rows: [string, ReactNode][] = [
    [t.app, <SiteAppBadge key="app" status={site.appStatus} />],
    [t.dir, <code key="dir">{site.dir}</code>],
    [t.port, site.port],
    [t.database, site.database ?? id.site.list.noDb],
    [t.runtime, site.runtime],
    [t.managed, site.managed ? t.managedYes : t.managedNo],
    [t.createdAt, formatDateTime(site.createdAt)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** /panel/sites/:name: info, hostnames, write-only env editor and delete. */
export function SiteDetailPage() {
  const { name = "" } = useParams();
  const query = useApiQuery<SiteDetail>(siteUrl(name));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link to="/panel/sites" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" aria-hidden />
        {t.back}
      </Link>
      <h1 className="text-lg font-semibold">{name}</h1>
      <QueryView query={query} codes={SITE_ERROR_CODES}>
        {(site) => (
          <>
            <Section title={t.info}>
              <SiteInfo site={site} />
            </Section>
            <Section title={t.hostnames}>
              <SiteHostnames site={site} />
            </Section>
            <Section title={id.site.envEditor.title}>
              <SiteEnvEditor site={site} onSaved={query.reload} />
            </Section>
            <SiteDelete site={site} />
          </>
        )}
      </QueryView>
    </div>
  );
}
