import { HistoryIcon } from "lucide-react";
import { useNavigate } from "react-router";
import type { JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Button } from "@/web/components/ui/button";
import { tDeploy } from "@/web/i18n/en.deploy";
import { apiFetch } from "@/web/shared/api.client";
import { formatDateTime } from "@/web/shared/format";
import { jobPath, siteUrl } from "@/web/site/site.api";
import { DEPLOY_ERROR_CODES } from "./deploy.api";
import { binaryLine, canRollback } from "./deploy.state";

const t = tDeploy.rollback;

function Side({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md border px-3 py-2 text-left">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-[0.8125rem] wrap-anywhere text-foreground">{value}</span>
    </p>
  );
}

function Carry({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="text-left">
      <p className="font-medium text-foreground">{title}</p>
      <ul className="list-disc pl-5">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Restore previous version" with the From → To dialog and what does not roll back; opens the job page. */
export function RollbackAction({ site, variant = "outline" }: { site: SiteDetail; variant?: "outline" | "default" }) {
  const navigate = useNavigate();
  const live = site.binary?.live;
  const previous = site.binary?.previous;
  const enabled = canRollback(site) && !site.activeJob;
  const button = (
    <Button variant={variant} disabled={!enabled}>
      <HistoryIcon aria-hidden />
      {t.button}
    </Button>
  );
  if (!enabled || !live || !previous) {
    return (
      <div className="flex flex-col gap-1">
        {button}
        {!canRollback(site) && <span className="text-xs text-muted-foreground">{t.none}</span>}
      </div>
    );
  }
  return (
    <ConfirmAction
      trigger={button}
      title={t.title(site.name)}
      codes={DEPLOY_ERROR_CODES}
      confirmLabel={t.button}
      description={
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Side label={t.from} value={binaryLine(live, formatDateTime)} />
            <span aria-hidden className="self-center text-muted-foreground max-sm:rotate-90">
              →
            </span>
            <Side label={t.to} value={binaryLine(previous, formatDateTime)} />
          </div>
          <Carry title={t.carries} items={t.carriesList} />
          <Carry title={t.notCarried} items={t.notCarriedList} />
          <p className="text-left">{t.note}</p>
        </>
      }
      onConfirm={async () => {
        const res = await apiFetch<JobAccepted>("POST", siteUrl(site.name, "/rollback"));
        navigate(jobPath(res.jobId));
      }}
    />
  );
}
