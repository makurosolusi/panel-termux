import { Link } from "react-router";
import type { PanelOverview } from "@/shared/panel.types";
import type { Role } from "@/shared/roles";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { describeAudit } from "@/web/dev/audit.describe";
import { tOverview } from "@/web/i18n/en.overview";
import { TOUCH_HIT } from "./panel.touch";

const t = tOverview;

/**
 * Five newest audit entries as readable sentences (same wording as /dev/audit, QA M4); "Lihat semua" only for
 * super_admin (the audit page is theirs). Own lazy chunk: describeAudit carries the audit/settings dictionaries.
 */
export function ActivityList({ entries, role }: { entries: PanelOverview["recentActivity"]; role: Role }) {
  return (
    <Section
      title={t.activity.title}
      action={
        role === "super_admin" && (
          <Link to="/dev/audit" className={`${TOUCH_HIT} text-sm font-medium underline-offset-4 hover:underline`}>
            {t.activity.viewAll}
          </Link>
        )
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.activity.empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline gap-x-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">{describeAudit(e).text}</span>
              <RelativeTime at={e.at} className="shrink-0 text-xs text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
