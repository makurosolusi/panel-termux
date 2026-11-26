import { Link, useSearchParams } from "react-router";
import type { Page } from "@/shared/dev.types";
import type { Job } from "@/shared/site.types";
import { Card, CardContent } from "@/web/components/ui/card";
import { DEV_PAGE_SIZE, parsePageParam } from "@/web/dev/dev.pagination";
import { Pager } from "@/web/dev/pager";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { StatusBadge } from "@/web/panel/status.badge";
import { formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobTone } from "./job.state";
import { jobPath, SITE_ERROR_CODES } from "./site.api";

const t = id.site;

/** /panel/jobs: recent site changes, newest first, paged via `?page=`. */
export function JobsPage() {
  const [params] = useSearchParams();
  const page = parsePageParam(params.get("page"));
  const query = useApiQuery<Page<Job>>(panelUrl("/jobs", { page, pageSize: DEV_PAGE_SIZE }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t.jobs.title}</h1>
      <QueryView query={query} codes={SITE_ERROR_CODES} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <Card className="py-0">
              <CardContent className="divide-y px-4">
                {d.items.map((j) => (
                  <Link
                    key={j.id}
                    to={jobPath(j.id)}
                    className="flex flex-wrap items-center gap-2 py-3 hover:underline"
                  >
                    <span className="mr-auto flex min-w-0 flex-col">
                      <span className="truncate font-mono text-sm">
                        {t.job.kinds[j.kind] ?? j.kind} · {j.target}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(j.startedAt)}</span>
                    </span>
                    <StatusBadge tone={jobTone(j)} label={t.job.statuses[j.status]} />
                  </Link>
                ))}
              </CardContent>
            </Card>
            <Pager page={d} />
          </>
        )}
      </QueryView>
    </div>
  );
}
