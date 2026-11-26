import { Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { BackupStatus } from "@/shared/backup.types";
import type { JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Label } from "@/web/components/ui/label";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { panelUrl } from "@/web/panel/panel.api";
import { apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobPath, siteUrl } from "./site.api";
import { deleteDefaults, deleteQuery, siteDbBackup } from "./site-detail.state";

const t = idSiteDetail.remove;

type Keep = { data: boolean; database: boolean };

/** What deleting removes, the database's last good backup (loaded when the dialog opens) and the keep options. */
function DeleteDetails({ site, keep, onKeep }: { site: SiteDetail; keep: Keep; onKeep: (k: Keep) => void }) {
  const backup = useApiQuery<BackupStatus>(panelUrl("/backups/status"), undefined, { enabled: false });
  const touched = useRef(false);
  const lastGood = backup.data?.lastGood;
  // biome-ignore lint/correctness/useExhaustiveDependencies: defaults apply once, when the backup info first arrives
  useEffect(() => {
    if (!lastGood || touched.current) return;
    const d = deleteDefaults(site, lastGood, new Date());
    onKeep({ data: d.keepData, database: d.keepDatabase });
  }, [lastGood]);
  const set = (k: Keep) => {
    touched.current = true;
    onKeep(k);
  };
  const dbBackup = lastGood ? siteDbBackup(site, lastGood) : null;
  const auto = lastGood && !touched.current ? deleteDefaults(site, lastGood, new Date()) : null;

  return (
    <>
      <span>{t.stops(site.hostnames.join(", "))}</span>
      <span>{t.removes(site.dir, site.app ?? site.name)}</span>
      {site.database && <span>{t.removesDb(site.database)}</span>}
      {site.database && (
        <span className="rounded-md border px-3 py-2 text-foreground">
          {backup.error ? (
            t.backupUnknown
          ) : !lastGood ? (
            idSiteDetail.loading
          ) : dbBackup ? (
            <RelativeTime at={dbBackup.at} absolute format={(at) => t.backup(site.database ?? "", at)} />
          ) : (
            t.noBackup(site.database)
          )}{" "}
          <Link to="/panel/backups" className="underline underline-offset-4">
            {t.backupNow}
          </Link>
        </span>
      )}
      <span className="flex flex-col gap-3 pt-1 text-foreground">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={keep.data} onCheckedChange={(c) => set({ ...keep, data: c === true })} />
          {t.keepData}
        </Label>
        {auto?.keepData && <span className="text-xs text-muted-foreground">{t.keepDataReason}</span>}
        {site.database && (
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={keep.database} onCheckedChange={(c) => set({ ...keep, database: c === true })} />
            {t.keepDatabase}
          </Label>
        )}
        {auto?.keepDatabase && <span className="text-xs text-muted-foreground">{t.keepDbReason}</span>}
      </span>
    </>
  );
}

/**
 * Delete a site (PLAN/03 §4.14): managed = typed name (`?confirm=<name>` + keep options), adopted = plain confirm that
 * removes only the panel's records. Opened from the danger zone button or the header menu (`open`).
 */
export function SiteDelete(props: {
  site: SiteDetail;
  busy: boolean;
  codes: ErrorCodes;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { site } = props;
  const navigate = useNavigate();
  const [keep, setKeep] = useState<Keep>({ data: false, database: false });
  const onConfirm = async (typed?: string) => {
    const url = siteUrl(site.name, deleteQuery(site.managed, typed ?? "", keep));
    navigate(jobPath((await apiFetch<JobAccepted>("DELETE", url)).jobId));
  };
  const common = {
    title: t.title(site.name),
    destructive: true,
    codes: props.codes,
    onConfirm,
    open: props.open,
    onOpenChange: props.onOpenChange,
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/25 p-4">
      <div>
        <p className="text-sm font-medium">{t.zone}</p>
        <p className="text-sm text-muted-foreground">{site.managed ? t.zoneBody : t.zoneBodyAdopted}</p>
      </div>
      <Button
        variant="destructive"
        className="self-start"
        disabled={props.busy}
        onClick={() => props.onOpenChange(true)}
      >
        <Trash2Icon aria-hidden />
        {t.button}
      </Button>
      {site.managed ? (
        <ConfirmAction
          {...common}
          tier="typed"
          typedValue={site.name}
          confirmLabel={t.confirm(site.name)}
          description={<DeleteDetails site={site} keep={keep} onKeep={setKeep} />}
        />
      ) : (
        <ConfirmAction {...common} confirmLabel={t.confirmAdopted} description={<span>{t.adopted}</span>} />
      )}
    </div>
  );
}
