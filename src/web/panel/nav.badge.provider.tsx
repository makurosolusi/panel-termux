import { cn } from "cn";
import { createContext, type ReactNode, useContext } from "react";
import type { PanelStatus } from "@/shared/monitor.types";
import { canAccess } from "@/shared/roles";
import { idHistory } from "@/web/i18n/id.history";
import { useMe } from "@/web/session/use-me";
import { useApiQuery } from "@/web/shared/use-api-query";
import { panelUrl } from "./panel.api";

/** `/panel/status` is cheap (last sampler result), polled once a minute for the nav badge (PLAN/02 §4). */
export const NAV_BADGE_REFRESH_MS = 60_000;
/** The nav item that carries the active-problem count. */
export const NAV_BADGE_ROUTE = "/panel";

/** Active problems on a nav item: count (> 0) and tone, or null for no badge. */
export type NavBadgeView = { count: number; tone: "danger" | "warning" };

/** Badge of the Ringkasan item from the thin status: danger + warning (info is never counted); null when 0/unknown. */
export function navBadgeView(status: PanelStatus | undefined): NavBadgeView | null {
  if (!status) return null;
  const count = status.danger + status.warning;
  return count > 0 ? { count, tone: status.danger > 0 ? "danger" : "warning" } : null;
}

const NavBadgeContext = createContext<NavBadgeView | null>(null);

/** Polls `/api/panel/status` every 60 s (only for roles that can open /panel) and shares the badge with the nav. */
export function NavBadgeProvider({ children }: { children: ReactNode }) {
  const allowed = canAccess(useMe().role, NAV_BADGE_ROUTE);
  const query = useApiQuery<PanelStatus>(panelUrl("/status"), NAV_BADGE_REFRESH_MS, {
    enabled: allowed,
    initial: allowed,
  });
  return (
    <NavBadgeContext.Provider value={allowed ? navBadgeView(query.data) : null}>{children}</NavBadgeContext.Provider>
  );
}

/** Badge for a nav link `to`; null for every item but Ringkasan, or when nothing is active. */
export function useNavBadge(to: string): NavBadgeView | null {
  const view = useContext(NavBadgeContext);
  return to === NAV_BADGE_ROUTE ? view : null;
}

const PILL = { danger: "bg-danger-subtle text-danger", warning: "bg-warning-subtle text-warning" } as const;
const DOT = { danger: "bg-danger", warning: "bg-warning" } as const;

/** Count pill for a nav link (renders nothing without active problems); `dot` = collapsed sidebar / tight slot. */
export function NavBadge({ to, dot = false, className }: { to: string; dot?: boolean; className?: string }) {
  const view = useNavBadge(to);
  if (!view) return null;
  const label = idHistory.navBadge(view.count);
  if (dot)
    return <span role="img" aria-label={label} className={cn("size-2 rounded-full", DOT[view.tone], className)} />;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        PILL[view.tone],
        className,
      )}
    >
      <span aria-hidden>{view.count > 99 ? "99+" : view.count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
