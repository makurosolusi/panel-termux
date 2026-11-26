import { HistoryIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Deploy } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import { Button } from "@/web/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { DEV_PAGE_SIZE, parsePageParam } from "@/web/dev/dev.pagination";
import { Pager } from "@/web/dev/pager";
import { id } from "@/web/i18n/id";
import { StatusBadge } from "@/web/panel/status.badge";
import { ConfirmAction } from "@/web/shared/confirm.dialog";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobPath, siteUrl, startJob } from "@/web/site/site.api";
import { DEPLOY_ERROR_CODES } from "./deploy.api";
import { canRollback, deployTone, shortSha } from "./deploy.state";

const t = id.deploy;

function RollbackButton({ site, enabled }: { site: string; enabled: boolean }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const rollback = async () => {
    setPending(true);
    const jobId = await startJob("POST", siteUrl(site, "/rollback"), undefined, DEPLOY_ERROR_CODES);
    setPending(false);
    if (jobId) navigate(jobPath(jobId));
  };
  const button = (
    <Button variant="outline" size="sm" disabled={!enabled || pending}>
      <HistoryIcon aria-hidden />
      {t.rollback.button}
    </Button>
  );
  if (!enabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* disabled buttons swallow pointer events; the span keeps the tooltip reachable (also via Tab) */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target for the tooltip explaining the disabled button */}
          <span tabIndex={0} className="self-start">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t.rollback.none}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <ConfirmAction
      trigger={button}
      title={t.rollback.title}
      description={t.rollback.body}
      confirmLabel={t.rollback.confirm}
      onConfirm={() => void rollback()}
    />
  );
}

function DeployRow({ d }: { d: Deploy }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
      <span className="font-medium">{t.history.kinds[d.kind]}</span>
      <StatusBadge tone={deployTone(d.status)} label={t.history.statuses[d.status]} />
      <span className="text-muted-foreground">{d.runtime}</span>
      <span className="text-muted-foreground">{formatBytes(d.sizeBytes)}</span>
      <code className="text-xs text-muted-foreground" title={d.sha256}>
        {shortSha(d.sha256)}
      </code>
      <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
        {formatDateTime(d.at)} · {t.history.by(d.actor?.name ?? t.history.unknownActor)}
      </span>
      <Link to={jobPath(d.jobId)} className="ml-auto text-xs hover:underline">
        {t.history.job}
      </Link>
    </li>
  );
}

/** Rollback button + paged deploy history of a site (`?page=`). */
export function DeployHistory({ site }: { site: string }) {
  const [params] = useSearchParams();
  const page = parsePageParam(params.get("page"));
  const query = useApiQuery<Page<Deploy>>(siteUrl(site, `/deploys?page=${page}&pageSize=${DEV_PAGE_SIZE}`));
  return (
    <div className="flex flex-col gap-3">
      <RollbackButton site={site} enabled={query.data ? canRollback(query.data) : false} />
      <QueryView query={query} codes={DEPLOY_ERROR_CODES} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <ul className="divide-y">
              {d.items.map((item) => (
                <DeployRow key={item.id} d={item} />
              ))}
            </ul>
            <Pager page={d} />
          </>
        )}
      </QueryView>
    </div>
  );
}
