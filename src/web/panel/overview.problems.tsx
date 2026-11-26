import { cn } from "cn";
import { InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { OverviewSection, Problem } from "@/shared/monitor.types";
import { detail, title } from "@/shared/problem.copy";
import { useNow } from "@/web/components/now.store";
import { RelativeTime } from "@/web/components/relative-time";
import { TONE_TEXT } from "@/web/components/status.tone";
import { PROBLEM_TONE } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { idOverview } from "@/web/i18n/id.overview";
import { formatRelative } from "@/web/shared/format";
import {
  DESKTOP_PROBLEM_ROWS,
  hiddenProblems,
  isFrozen,
  PHONE_PROBLEM_ROWS,
  problemLogHref,
  problemSetKey,
  sinceText,
  splitProblems,
} from "./overview.state";
import { TOUCH_HIT } from "./panel.touch";

const t = idOverview;
const ICON = { danger: OctagonXIcon, warning: TriangleAlertIcon, info: InfoIcon } as const;
const LINK = cn(TOUCH_HIT, "font-medium underline-offset-4 hover:underline");

function ProblemRow({ p, frozenAt, hidden }: { p: Problem; frozenAt: string | null; hidden: string | false }) {
  const now = useNow();
  const Icon = ICON[p.severity];
  const since = sinceText(p.since, now);
  const logHref = problemLogHref(p);
  return (
    <li className={cn("flex gap-3 px-4 py-3", hidden)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[PROBLEM_TONE[p.severity]])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <p className="font-medium">
          <span className="sr-only">{t.severity[p.severity]}: </span>
          {title(p)}
        </p>
        <p className="text-muted-foreground max-md:line-clamp-2">{detail(p)}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {since && <span>{since}</span>}
          {frozenAt && <span className="text-warning">{t.frozen(formatRelative(frozenAt, now))}</span>}
          <Link to={p.href} className={cn(LINK, "text-foreground")}>
            {t.view}
          </Link>
          {logHref && (
            <Link to={logHref} className={cn(LINK, "text-foreground")}>
              {t.viewLog}
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}

/** Announces the problem count, but only when the set of problem ids changes (not on every 10 s poll). */
function useAnnouncement(alerts: readonly Problem[]): string {
  const key = problemSetKey(alerts);
  const last = useRef<string | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (last.current !== null && last.current !== key) setText(t.problemsAnnounce(alerts.length));
    last.current = key;
  }, [key, alerts.length]);
  return text;
}

/** Problem-first strip of the Ringkasan: "Semua sehat" or the warning/danger list, then quiet info rows (B4). */
export function ProblemStrip({
  problems,
  sampledAt,
  unavailable,
  dataAt,
}: {
  problems: readonly Problem[];
  sampledAt: string | null;
  unavailable: readonly OverviewSection[];
  dataAt: string | null;
}) {
  const { alerts, info } = splitProblems(problems);
  const [expanded, setExpanded] = useState(false);
  const announcement = useAnnouncement(alerts);
  const phoneMore = hiddenProblems(alerts.length, PHONE_PROBLEM_ROWS, expanded);
  const desktopMore = hiddenProblems(alerts.length, DESKTOP_PROBLEM_ROWS, expanded);
  // Rows past a cap hide per viewport (CSS only, no resize listener): past 5 everywhere, past 3 on phones.
  const rowHidden = (i: number) =>
    !expanded && (i >= DESKTOP_PROBLEM_ROWS ? "hidden" : i >= PHONE_PROBLEM_ROWS && "max-md:hidden");
  const toggle = (more: number, className: string) => (
    <div className={cn("border-t px-2 py-1", className)}>
      <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {more > 0 ? t.showMore(more) : t.showLess}
      </Button>
    </div>
  );

  return (
    <section aria-label={t.problemsLabel} className="flex flex-col gap-2">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {alerts.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm">
          <StatusBadge tone="success" label={t.allHealthy} />
          <span className="text-muted-foreground">
            {sampledAt ? <RelativeTime at={sampledAt} format={t.checkedAgo} /> : t.startingMonitor}
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">
            {alerts.map((p, i) => (
              <ProblemRow key={p.id} p={p} frozenAt={isFrozen(p, unavailable) ? dataAt : null} hidden={rowHidden(i)} />
            ))}
          </ul>
          {alerts.length > PHONE_PROBLEM_ROWS && toggle(phoneMore, "md:hidden")}
          {alerts.length > DESKTOP_PROBLEM_ROWS && toggle(desktopMore, "max-md:hidden")}
        </div>
      )}
      {info.length > 0 && (
        <ul aria-label={t.infoLabel} className="flex flex-col gap-1">
          {info.map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-md bg-info-subtle px-3 py-2 text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">{title(p)}</span> <span className="text-foreground/80">{detail(p)}</span>{" "}
                <Link to={p.href} className={LINK}>
                  {t.view}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
