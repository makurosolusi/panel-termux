import type { LucideIcon } from "lucide-react";
import { BellIcon, GlobeIcon, LayoutGridIcon, PackageIcon, ServerIcon } from "lucide-react";
import { Link } from "react-router";
import type { OverviewSection, Problem, ProblemKind } from "@/shared/monitor.types";
import type { PanelOverview } from "@/shared/panel.types";
import type { Role } from "@/shared/roles";
import { KeyValue } from "@/web/components/key-value";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { tOverview } from "@/web/i18n/en.overview";
import { formatDateTime, formatNumber } from "@/web/shared/format";
import { countBadge, heldDomains, quietDownServices } from "./overview.state";
import { TOUCH_HIT } from "./panel.touch";

const t = tOverview;
const CARD =
  "relative flex min-h-[5.5rem] flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-xs hover:bg-accent/40";
const LINK = `${TOUCH_HIT} font-medium underline-offset-4 hover:underline`;

type Count = {
  to: string;
  icon: LucideIcon;
  label: string;
  total: number;
  kinds: ProblemKind[];
  section?: OverviewSection;
};

/** Sites / Services / Apps / Domains cards; each links to its page and carries its problems badge. */
export function CountCards({ o, problems }: { o: PanelOverview; problems: readonly Problem[] }) {
  const unavailable = o.unavailable ?? [];
  const cards: Count[] = [
    { to: "/panel/sites", icon: LayoutGridIcon, label: t.counts.sites, total: o.sites.total, kinds: ["site"] },
    {
      to: "/panel/services",
      icon: ServerIcon,
      label: t.counts.services,
      total: o.services.length,
      kinds: ["service"],
      section: "services",
    },
    {
      to: "/panel/apps",
      icon: PackageIcon,
      label: t.counts.apps,
      total: o.apps.length,
      kinds: ["app"],
      section: "apps",
    },
    {
      to: "/panel/domains",
      icon: GlobeIcon,
      label: t.counts.domains,
      total: o.domains.length,
      kinds: ["domain", "network"],
      section: "domains",
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const down = c.section !== undefined && unavailable.includes(c.section);
        const badge = countBadge(
          c.kinds,
          problems,
          c.section === "domains" ? heldDomains(o.domains, problems, o.apps) : 0,
          c.section === "services" ? quietDownServices(o.services, problems) : 0,
        );
        return (
          <li key={c.to} className={CARD}>
            <Link
              to={c.to}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
            >
              <c.icon className="size-3.5" aria-hidden />
              {c.label}
            </Link>
            <span className="text-xl font-semibold tabular-nums">{down ? "–" : formatNumber(c.total)}</span>
            {down ? (
              <span className="text-xs text-muted-foreground">{t.unavailable}</span>
            ) : (
              <StatusBadge tone={badge.tone} label={badge.text} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One line on the backup schedule, with a link to Cadangan; `backup` null = unreadable (its problem says why). */
export function BackupSection({ backup }: { backup: PanelOverview["backup"] | null }) {
  const at = (iso: string | null, none: string) => (iso ? <RelativeTime at={iso} /> : none);
  // formatRelative only speaks of the past ("baru saja" for any future time, QA M6): a schedule shows its clock time.
  const next = (iso: string | null) =>
    iso ? <time dateTime={iso}>{formatDateTime(iso)}</time> : t.backup.notScheduled;
  return (
    <Section
      title={t.backup.title}
      action={
        <Link to="/panel/backups" className={`${LINK} text-sm`}>
          {t.backup.open}
        </Link>
      }
    >
      {backup === null ? (
        <p className="text-sm text-muted-foreground">{t.unavailable}</p>
      ) : (
        <KeyValue
          items={[
            { label: t.backup.lastRun, value: at(backup.lastRunAt, t.backup.never) },
            { label: t.backup.nextRun, value: next(backup.nextRunAt) },
          ]}
        />
      )}
    </Section>
  );
}

/** Telegram notification state; "failing" is shown by the alerts_failing problem instead. */
export function AlertsLine({ alerts, role }: { alerts: PanelOverview["alerts"]; role: Role }) {
  const state = alerts?.state;
  if (!state || state === "failing") return null;
  const text = state === "ok" ? t.alerts.ok : state === "disabled" ? t.alerts.disabled : t.alerts.notConfigured;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <BellIcon className="size-4" aria-hidden />
      <span>{text}</span>
      {state === "not_configured" &&
        (role === "super_admin" ? (
          <Link to="/dev/settings" className={`${LINK} text-foreground`}>
            {t.alerts.configure}
          </Link>
        ) : (
          <span>{t.alerts.askSuperAdmin}</span>
        ))}
    </p>
  );
}
