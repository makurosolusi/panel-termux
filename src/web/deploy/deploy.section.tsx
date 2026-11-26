import type { BinaryInfo, SiteDetail } from "@/shared/site.types";
import { KeyValue } from "@/web/components/key-value";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { idDeploy } from "@/web/i18n/id.deploy";
import { formatBytes } from "@/web/shared/format";
import { DeployCard } from "./deploy.card";
import { DeployHistory } from "./deploy.history";
import { RollbackAction } from "./deploy.rollback";
import { shortSha } from "./deploy.state";
import type { Uploader } from "./deploy.uploader";

const t = idDeploy;

/** "Versi berjalan": the live binary, and a note when it has no deploy record. */
function LiveVersion({ live }: { live: BinaryInfo }) {
  return (
    <div className="flex flex-col gap-2">
      {!live.deployId && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge state="unknown" label={t.live.untracked} />
          <span className="text-muted-foreground">{t.live.untrackedHelp}</span>
        </p>
      )}
      <KeyValue
        items={[
          ...(live.sha256 ? [{ label: t.live.sha, value: shortSha(live.sha256), mono: true }] : []),
          ...(live.fileName ? [{ label: t.live.file, value: live.fileName, mono: true }] : []),
          { label: t.live.size, value: formatBytes(live.sizeBytes) },
          ...(live.runtime ? [{ label: t.live.runtime, value: t.runtimes[live.runtime] }] : []),
          { label: t.live.modified, value: <RelativeTime at={live.modifiedAt} /> },
        ]}
      />
    </div>
  );
}

/** Content of the site detail `#deploy` anchor: live version, upload card, rollback and deploy history. */
export function DeploySection({ site, uploader }: { site: SiteDetail; uploader: Uploader }) {
  const live = site.binary?.live;
  return (
    <div className="flex flex-col gap-6">
      {!site.managed && <p className="text-sm text-muted-foreground">{t.adoptedNote}</p>}
      {live ? (
        <Section title={t.live.title} action={<RollbackAction site={site} />}>
          <LiveVersion live={live} />
        </Section>
      ) : (
        // Nothing runs yet: no "Versi berjalan" heading and no rollback to offer, only the next step.
        <p className="text-sm text-muted-foreground">{t.live.none}</p>
      )}
      <DeployCard site={site} up={uploader} />
      <Section title={t.history.title}>
        <DeployHistory site={site.name} />
      </Section>
    </div>
  );
}
