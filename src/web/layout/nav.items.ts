import {
  ActivityIcon,
  AppWindowIcon,
  ArchiveIcon,
  DatabaseIcon,
  GlobeIcon,
  HeartPulseIcon,
  HistoryIcon,
  LayersIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  ScrollTextIcon,
  ServerCogIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { canAccess, type Role } from "@/shared/roles";
import { tHistory } from "@/web/i18n/en.history";
import { tShell } from "@/web/i18n/en.shell";

const n = tShell.nav;

/** Content width class of a page: tables/dashboards wide, forms and profile narrow. */
export type PageWidth = "wide" | "narrow";

/**
 * One sidebar link. `end` = active only on the exact path (index routes); `parent` (hidden pages only) = the link
 * highlighted in the sidebar and bottom bar while this page is open.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  width?: PageWidth;
  parent?: string;
};

/** Titled group of sidebar links. */
export type NavGroup = { key: keyof typeof tShell.groups; label: string; items: readonly NavItem[] };

/** Full navigation; access per item comes from `canAccess` (shared with the server's area rules). */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "server",
    label: tShell.groups.server,
    items: [
      { to: "/panel", label: n.overview, icon: LayoutDashboardIcon, end: true },
      { to: "/panel/sites", label: n.sites, icon: LayersIcon },
      { to: "/panel/services", label: n.services, icon: ServerCogIcon },
      { to: "/panel/apps", label: n.apps, icon: AppWindowIcon },
      { to: "/panel/domains", label: n.domains, icon: GlobeIcon },
      { to: "/panel/databases", label: n.databases, icon: DatabaseIcon },
      { to: "/panel/backups", label: n.backups, icon: ArchiveIcon },
    ],
  },
  {
    key: "admin",
    label: tShell.groups.admin,
    items: [
      { to: "/dev", label: n.health, icon: HeartPulseIcon, end: true },
      { to: "/dev/users", label: n.users, icon: UsersIcon },
      { to: "/dev/audit", label: n.audit, icon: ShieldCheckIcon },
      { to: "/dev/logs", label: n.logs, icon: ScrollTextIcon },
      { to: "/dev/settings", label: n.settings, icon: SettingsIcon, width: "narrow" },
    ],
  },
  {
    key: "account",
    label: tShell.groups.account,
    items: [{ to: "/profile", label: n.profile, icon: UserIcon, width: "narrow" }],
  },
];

/** Routes without their own sidebar link, titled under the group of their path. */
const HIDDEN_PAGES: readonly NavItem[] = [
  { to: "/panel/jobs", label: n.jobs, icon: ActivityIcon, parent: "/panel/sites" },
  { to: "/panel/problems", label: tHistory.problems.title, icon: HistoryIcon, parent: "/panel" },
];

/** Phone bottom bar slots 1–4 (PLAN/01 §3.7); slot 5 is the "Lainnya" sheet with everything else. */
export const MOBILE_PRIMARY: readonly string[] = ["/panel", "/panel/sites", "/panel/services", "/panel/apps"];

/** Groups and links the role may open; empty groups are dropped. */
export const navGroupsFor = (role: Role): NavGroup[] =>
  NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => canAccess(role, item.to)) })).filter(
    (g) => g.items.length > 0,
  );

/** Phone navigation: bottom bar items (empty → no bar) and the "Lainnya" groups (Administrasi first, no Akun). */
export function mobileNavFor(role: Role): { primary: NavItem[]; more: NavGroup[] } {
  const groups = navGroupsFor(role);
  const primary = groups.flatMap((g) => g.items).filter((i) => MOBILE_PRIMARY.includes(i.to));
  if (primary.length === 0) return { primary, more: [] };
  const rest = groups
    .filter((g) => g.key !== "account")
    .map((g) => ({ ...g, items: g.items.filter((i) => !MOBILE_PRIMARY.includes(i.to)) }))
    .filter((g) => g.items.length > 0);
  return { primary, more: [...rest.filter((g) => g.key === "admin"), ...rest.filter((g) => g.key !== "admin")] };
}

const matches = (item: NavItem, path: string) => path === item.to || (!item.end && path.startsWith(`${item.to}/`));

/** Most specific nav entry (incl. hidden pages) for a path, with its group, or null (e.g. 404). */
export function navMatch(pathname: string): { group: NavGroup; item: NavItem } | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    const hidden = HIDDEN_PAGES.filter((h) => group.items.some((i) => h.to.startsWith(`${i.to}/`)));
    for (const item of [...group.items, ...hidden]) {
      if (matches(item, path) && (!best || item.to.length > best.item.to.length)) best = { group, item };
    }
  }
  return best;
}

/** The visible nav link to highlight for a path: its own item, or the `parent` of a hidden page; null if none. */
export function activeNavTo(pathname: string): string | null {
  const item = navMatch(pathname)?.item;
  return item ? (item.parent ?? item.to) : null;
}

/** Whether the current page lives in the "Lainnya" sheet (its nav item, or Profil in the account block). */
export function activeInMore(pathname: string, more: readonly NavGroup[]): boolean {
  const current = activeNavTo(pathname);
  if (current === "/profile") return true;
  return more.some((g) => g.items.some((i) => i.to === current));
}

/** One breadcrumb; `to` absent = current page. */
export type Crumb = { label: string; to?: string };

/**
 * At most 3 crumbs: group › nav item › page title (only when the path is deeper than the item). URL segments in
 * between never become crumbs, so no crumb links to a route that does not exist. Empty for unknown paths.
 */
export function breadcrumbsFor(pathname: string, pageTitle: string | null): Crumb[] {
  const match = navMatch(pathname);
  if (!match) return [];
  const path = pathname.replace(/\/+$/, "") || "/";
  const group = { label: match.group.label };
  if (path === match.item.to) return [group, { label: match.item.label }];
  const item = { label: match.item.label, to: match.item.to };
  return pageTitle ? [group, item, { label: pageTitle }] : [group, item];
}
