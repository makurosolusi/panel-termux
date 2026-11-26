import { HistoryIcon } from "lucide-react";
import { Link } from "react-router";
import type { Page } from "@/shared/dev.types";
import type { ProblemEvent } from "@/shared/monitor.types";
import { title } from "@/shared/problem.copy";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { useNow } from "@/web/components/now.store";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { Section } from "@/web/components/section";
import { PROBLEM_TONE } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { usePageParam } from "@/web/components/use-page-param";
import { idHistory } from "@/web/i18n/id.history";
import { idPanel } from "@/web/i18n/id.panel";
import { formatClock, formatDateTime, formatDayLabel, formatDuration } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { panelUrl } from "./panel.api";
import { TOUCH_HIT } from "./panel.touch";

const t = idHistory.problems;
const PAGE_SIZE = 20;
/** Ringkasan shows the 5 newest closed events; 10 fetched so a few still-open ones do not leave it short. */
const RECENT_FETCH = 10;
const RECENT_SHOWN = 5;
const RECENT_REFRESH_MS = 60_000;
const LINK = `${TOUCH_HIT} text-sm font-medium underline-offset-4 hover:underline`;

/** One local calendar day of history, newest first like the page. */
export type DayGroup = { key: string; label: string; items: ProblemEvent[] };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const DAY_MS = 86_400_000;

/**
 * "hari ini 21.40" / "kemarin 21.40" by local calendar day (PLAN/02 §5.1 item 8), older → "25 Nov 2026, 23.52".
 * Not formatRelative: that counts 24 h spans, so 26 h ago across two midnights read "kemarin" (QA #13).
 */
export function closedText(iso: string, now: Date): string {
  const clock = formatClock(iso).slice(0, 5);
  const day = dayKey(iso);
  if (day === dayKey(now.toISOString())) return t.today(clock);
  if (day === dayKey(new Date(now.getTime() - DAY_MS).toISOString())) return t.yesterday(clock);
  return formatDateTime(iso);
}

/** Groups events by the local day they opened, keeping the server order (newest first). */
export function groupByDay(events: readonly ProblemEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const key = dayKey(e.openedAt);
    const current = groups.at(-1);
    if (current?.key === key) current.items.push(e);
    else groups.push({ key, label: formatDayLabel(e.openedAt), items: [e] });
  }
  return groups;
}

/** Seconds a problem lasted (until `now` while open); never negative. */
export const eventDurationSec = (e: ProblemEvent, now: number = Date.now()): number =>
  Math.max(0, Math.floor(((e.closedAt ? Date.parse(e.closedAt) : now) - Date.parse(e.openedAt)) / 1000));

const columns: DataColumn<ProblemEvent>[] = [
  {
    key: "problem",
    header: t.cols.problem,
    mobile: "title",
    className: "whitespace-normal",
    cell: (e) => <span className="font-medium">{title(e)}</span>,
  },
  {
    key: "status",
    header: t.cols.status,
    mobile: "badge",
    className: "w-36", // fixed widths keep the columns of every day table aligned (QA #15)
    cell: (e) =>
      e.closedAt ? (
        <StatusBadge tone="success" label={t.closed} />
      ) : (
        <StatusBadge tone={PROBLEM_TONE[e.severity]} label={t.open} pulse />
      ),
  },
  {
    key: "opened",
    header: t.cols.opened,
    className: "w-20",
    cell: (e) => <span className="tabular-nums">{formatClock(e.openedAt).slice(0, 5)}</span>,
  },
  {
    key: "duration",
    header: t.cols.duration,
    align: "right",
    className: "w-44",
    cell: (e) => {
      const d = formatDuration(eventDurationSec(e));
      return <span className="tabular-nums">{e.closedAt ? d : t.ongoing(d)}</span>;
    },
  },
  {
    key: "notified",
    header: t.cols.notified,
    mobile: "hidden",
    className: "w-28",
    cell: (e) => <span className="text-muted-foreground">{e.notified ? t.notified : t.notNotified}</span>,
  },
];

/** /panel/problems?page: problem history (30 days, no notices/info), paginated, grouped by day. */
export function ProblemsPage() {
  const [page, setPage] = usePageParam();
  const query = useApiQuery<Page<ProblemEvent>>(panelUrl("/problems/history", { page, pageSize: PAGE_SIZE }));
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading }}
      />
      <QueryView
        query={query}
        codes={idPanel.errorCodes}
        empty={<EmptyState icon={HistoryIcon} title={t.empty} description={t.emptyHint} />}
      >
        {(d) => {
          const groups = groupByDay(d.items);
          const pageCount = Math.max(1, Math.ceil(d.total / d.pageSize));
          return (
            <div className="flex flex-col gap-6">
              {groups.map((g, i) => (
                <Section key={g.key} title={t.dayLabel(g.label, g.items.length)}>
                  <DataTable
                    label={`${t.label} · ${g.label}`}
                    columns={columns}
                    rows={g.items}
                    rowKey={(e) => String(e.id)}
                    rowTone={(e) => (e.closedAt ? undefined : PROBLEM_TONE[e.severity])}
                    // one footer for the whole page, under the last day
                    pagination={
                      i === groups.length - 1
                        ? { page: d.page, pageCount, total: d.total, onPageChange: setPage }
                        : undefined
                    }
                  />
                </Section>
              ))}
            </div>
          );
        }}
      </QueryView>
    </>
  );
}

/** Ringkasan "Riwayat masalah": the 5 newest closed problems + "Lihat riwayat" (lazy chunk, 60 s poll). */
export function RecentProblems() {
  const now = useNow();
  const query = useApiQuery<Page<ProblemEvent>>(
    panelUrl("/problems/history", { page: 1, pageSize: RECENT_FETCH }),
    RECENT_REFRESH_MS,
  );
  const closed = (query.data?.items ?? []).filter((e) => e.closedAt !== null).slice(0, RECENT_SHOWN);
  return (
    <Section
      title={t.recentTitle}
      action={
        <Link to="/panel/problems" className={LINK}>
          {t.viewAll}
        </Link>
      }
    >
      <QueryView
        query={query}
        isEmpty={() => closed.length === 0}
        empty={<p className="text-sm text-muted-foreground">{t.recentEmpty}</p>}
      >
        {() => (
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {closed.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5">
                <span className="font-medium">{title(e)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  · {formatDuration(eventDurationSec(e))}
                </span>
                <time dateTime={e.closedAt ?? e.openedAt} className="ml-auto text-xs text-muted-foreground">
                  {closedText(e.closedAt ?? e.openedAt, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Section>
  );
}
