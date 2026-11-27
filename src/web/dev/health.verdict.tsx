import { cn } from "cn";
import { ArrowRightIcon, InfoIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { DevHealth, HealthStatus } from "@/shared/dev.types";
import { detail, title } from "@/shared/problem.copy.en";
import { CodeText } from "@/web/components/code-text";
import { useNow } from "@/web/components/now.store";
import { Section } from "@/web/components/section";
import { TONE_CLASS } from "@/web/components/status.tone";
import { StatusBadge } from "@/web/components/status-badge";
import { StatusIcon } from "@/web/components/status-icon";
import { tDevHealth } from "@/web/i18n/en.dev.health";
import {
  checkRow,
  HEALTH_STATUS_KEY,
  infoRows,
  infoText,
  PROBLEM_STATUS_KEY,
  sortedChecks,
  verdictOf,
  verdictProblems,
  verdictSentence,
} from "./health.state";

const t = tDevHealth;

const VERDICT_TONE: Record<HealthStatus, string> = {
  ok: TONE_CLASS.success,
  warn: TONE_CLASS.warning,
  fail: TONE_CLASS.danger,
};

/** Announces the verdict to screen readers only when it changes (not on first render, not on every poll). */
function useVerdictAnnouncement(verdict: HealthStatus): string {
  const prev = useRef(verdict);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (prev.current !== verdict) setSaid(t.verdict[verdict]);
    prev.current = verdict;
  }, [verdict]);
  return said;
}

function Row({ icon, text, sub, link }: { icon: ReactNode; text: string; sub?: string | null; link?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-pretty">
          <CodeText>{text}</CodeText>
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        {link}
      </div>
    </li>
  );
}

function RowLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mt-1 inline-flex min-h-6 items-center gap-1 text-xs font-medium text-brand-text underline-offset-4 hover:underline pointer-coarse:min-h-11"
    >
      {label}
      <ArrowRightIcon className="size-3" aria-hidden />
    </Link>
  );
}

/** Verdict card: badge + headline, then every counted problem and panel check (worst first). */
export function VerdictCard({ h }: { h: DevHealth }) {
  const now = useNow();
  const verdict = verdictOf(h);
  const announce = useVerdictAnnouncement(verdict);
  const problems = verdictProblems(h);
  return (
    <section aria-labelledby="verdict-title" className="rounded-lg border bg-card shadow-xs">
      <div className={cn("flex flex-wrap items-center gap-3 rounded-t-lg border-b px-4 py-3", VERDICT_TONE[verdict])}>
        <h2 id="verdict-title" className="text-lg font-semibold">
          {t.verdict[verdict]}
        </h2>
        <p className="min-w-0 flex-1 basis-60 text-sm text-foreground/85">{verdictSentence(h, now, title)}</p>
        <span className="sr-only" role="status">
          {announce}
        </span>
      </div>
      <ul className="divide-y px-4 py-3">
        {problems.map((p) => (
          <Row
            key={p.id ?? `${p.kind}:${p.target}`}
            icon={<StatusIcon state={PROBLEM_STATUS_KEY[p.severity === "danger" ? "danger" : "warning"]} />}
            text={title(p)}
            sub={detail(p)}
            link={p.href ? <RowLink to={p.href} label={t.problemLink} /> : null}
          />
        ))}
        {sortedChecks(h).map((c) => {
          const row = checkRow(c, h, now);
          return (
            <Row
              key={row.key}
              icon={<StatusIcon state={HEALTH_STATUS_KEY[row.status]} />}
              text={row.text}
              link={row.href ? <RowLink to={row.href} label={t.checks.errors.link} /> : null}
            />
          );
        })}
      </ul>
    </section>
  );
}

/** Verdict badge for the page header. */
export const VerdictBadge = ({ h }: { h: DevHealth }) => {
  const v = verdictOf(h);
  return <StatusBadge state={HEALTH_STATUS_KEY[v]} label={t.verdict[v]} />;
};

/** "Information": info-tone rows that never lower the verdict (B4), each linking to the setup guide. */
export function InfoSection({ h, guide }: { h: DevHealth; guide: ReactNode }) {
  const rows = infoRows(h)
    .map((code) => ({ code, text: infoText(code) }))
    .filter((r): r is { code: string; text: string } => r.text !== null);
  if (rows.length === 0) return null;
  return (
    <Section title={t.info.title} description={t.info.description}>
      <ul className={cn("flex flex-col gap-2 rounded-lg border px-4 py-3", TONE_CLASS.info)}>
        {rows.map((r) => (
          <Row key={r.code} icon={<InfoIcon className="size-4 text-info" aria-hidden />} text={r.text} link={guide} />
        ))}
      </ul>
    </Section>
  );
}
