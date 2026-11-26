import {
  ActivityIcon,
  AppWindowIcon,
  ArchiveIcon,
  DatabaseIcon,
  GlobeIcon,
  HeartPulseIcon,
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
import { id } from "@/web/i18n/id";

const n = id.shell.nav;

/** Content width class of a page: tables/dashboards wide, forms and profile narrow. */
export type PageWidth = "wide" | "narrow";

/** One sidebar link. `end` = active only on the exact path (index routes). */
export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; width?: PageWidth };

/** Titled group of sidebar links. */
export type NavGroup = { key: keyof typeof id.shell.groups; label: string; items: readonly NavItem[] };

/** Full navigation; access per item comes from `canAccess` (shared with the server's area rules). */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "server",
    label: id.shell.groups.server,
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
    label: id.shell.groups.admin,
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
    label: id.shell.groups.account,
    items: [{ to: "/profile", label: n.profile, icon: UserIcon, width: "narrow" }],
  },
];

/** Routes without their own sidebar link, titled under the group of their path. */
const HIDDEN_PAGES: readonly NavItem[] = [{ to: "/panel/jobs", label: n.jobs, icon: ActivityIcon }];

/** Groups and links the role may open; empty groups are dropped. */
export const navGroupsFor = (role: Role): NavGroup[] =>
  NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => canAccess(role, item.to)) })).filter(
    (g) => g.items.length > 0,
  );

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

/** One breadcrumb; `to` absent = current page. */
export type Crumb = { label: string; to?: string };

/** Group › page › trailing segments ("Server › Situs › blog › Log"); empty for unknown paths. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const match = navMatch(pathname);
  if (!match) return [];
  const rest = pathname.slice(match.item.to.length).split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: match.group.label }, { label: match.item.label, to: match.item.to }];
  let to = match.item.to;
  for (const seg of rest) {
    to += `/${seg}`;
    crumbs.push({ label: id.shell.segments[seg] ?? safeDecode(seg), to });
  }
  const last = crumbs.at(-1);
  if (last) delete last.to;
  return crumbs;
}

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg; // malformed %-escape in the URL: show it raw rather than crash the shell
  }
}

/** `<title>` for a path: "Situs · Panel Termux", detail pages "blog · Situs · Panel Termux". */
export function documentTitleFor(pathname: string, fallback: string): string {
  const crumbs = breadcrumbsFor(pathname).slice(1); // the group name adds nothing to a tab title
  const parts = crumbs.length ? crumbs.map((c) => c.label).reverse() : [fallback];
  return [...parts, id.appName].join(" · ");
}
