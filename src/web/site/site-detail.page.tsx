import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Page } from "@/shared/dev.types";
import type { Job, SiteDetail } from "@/shared/site.types";
import { ErrorState } from "@/web/components/error-state";
import { KeyValue } from "@/web/components/key-value";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { DeploySection } from "@/web/deploy/deploy.section";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { panelUrl } from "@/web/panel/panel.api";
import type { ErrorCodes } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { AnchorSection, SiteAnchors } from "./site.anchors";
import { SITE_ERROR_CODES, siteUrl } from "./site.api";
import { SiteDelete } from "./site.delete";
import { SiteEnvEditor } from "./site.env-editor";
import { SiteBanners, SiteHeader } from "./site.header";
import { SiteHostnames } from "./site.hostnames";
import { SiteSettings } from "./site.settings";
import { siteBusy } from "./site-detail.state";

const t = idSiteDetail;
/** Detail refresh while nothing runs; status and the busy banner follow the active job. */
const DETAIL_REFRESH_MS = 30_000;
const CODES: ErrorCodes = { ...SITE_ERROR_CODES, ...t.errorCodes };

function Summary({ site }: { site: SiteDetail }) {
  return (
    <KeyValue
      items={[
        { label: t.info.app, value: site.app ?? site.name, mono: true },
        { label: t.info.port, value: site.port, mono: true },
        { label: t.info.runtime, value: t.info.runtimes[site.runtime] },
        { label: t.info.database, value: site.database ?? t.info.noDatabase, mono: site.database !== null },
        { label: t.info.dir, value: site.dir, mono: true },
        { label: t.info.managed, value: site.managed ? t.info.managedYes : t.info.managedNo },
        { label: t.info.createdAt, value: <RelativeTime at={site.createdAt} absolute /> },
      ]}
    />
  );
}

type SectionsProps = { site: SiteDetail; reload: () => void; deleting: boolean; setDeleting: (open: boolean) => void };

function SiteSections({ site, reload, deleting, setDeleting }: SectionsProps) {
  const busy = siteBusy(site);
  const jobs = useApiQuery<Page<Job>>(
    panelUrl("/jobs", { target: site.name, status: "interrupted", page: 1, pageSize: 1 }),
    undefined,
    { enabled: false },
  );
  const interrupted = jobs.data?.items[0] ?? null;
  return (
    <div className="flex flex-col gap-8">
      <SiteBanners site={site} interrupted={interrupted} codes={CODES} />
      <AnchorSection id="ringkasan" title={t.anchors.summary}>
        <Summary site={site} />
      </AnchorSection>
      <AnchorSection id="deploy" title={t.anchors.deploy}>
        <DeploySection site={site} />
      </AnchorSection>
      <AnchorSection id="domains" title={t.anchors.domains} description={t.domains.description}>
        <SiteHostnames site={site} busy={busy} codes={CODES} />
      </AnchorSection>
      <AnchorSection id="env" title={t.anchors.env}>
        <SiteEnvEditor site={site} busy={busy} codes={CODES} onSaved={reload} />
      </AnchorSection>
      <AnchorSection id="settings" title={t.anchors.settings}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-medium">{t.settings.title}</h3>
              <p className="text-sm text-muted-foreground">{t.settings.description}</p>
            </div>
            <SiteSettings site={site} busy={busy} codes={CODES} onSaved={reload} />
          </div>
          <SiteDelete site={site} busy={busy} codes={CODES} open={deleting} onOpenChange={setDeleting} />
        </div>
      </AnchorSection>
    </div>
  );
}

/** /panel/sites/:name: header with actions, section anchors, deploy, domains, env editor, settings and delete. */
export function SiteDetailPage() {
  const { name = "" } = useParams();
  const query = useApiQuery<SiteDetail>(siteUrl(name), DETAIL_REFRESH_MS);
  const [deleting, setDeleting] = useState(false); // header menu and danger zone open the same dialog
  const back = { to: "/panel/sites", label: t.back };
  const site = query.data;
  const meta = { updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading, live: true };

  if (query.error?.status === 404 && !site)
    return (
      <>
        <PageHeader title={name} back={back} />
        <ErrorState
          title={t.notFound}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/panel/sites">{t.toList}</Link>
            </Button>
          }
        />
      </>
    );

  return (
    <>
      {site ? (
        <SiteHeader site={site} meta={meta} codes={CODES} onDelete={() => setDeleting(true)} />
      ) : (
        <PageHeader title={name} back={back} />
      )}
      {site && <SiteAnchors />}
      <QueryView query={query} codes={CODES} empty={null} isEmpty={() => false}>
        {(s) => <SiteSections site={s} reload={query.reload} deleting={deleting} setDeleting={setDeleting} />}
      </QueryView>
    </>
  );
}
