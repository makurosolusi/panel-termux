import { CodeIcon, LayoutDashboardIcon, type LucideIcon, UserIcon } from "lucide-react";
import { canAccess, type Role } from "@/shared/roles";
import { id } from "@/web/i18n/id";

/** One top-level section link. */
export type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/dev", label: id.nav.dev, icon: CodeIcon },
  { to: "/panel", label: id.nav.panel, icon: LayoutDashboardIcon },
  { to: "/profile", label: id.nav.profile, icon: UserIcon },
];

/** Section links the role may open, most privileged first. */
export const navItemsFor = (role: Role): NavItem[] => NAV_ITEMS.filter((item) => canAccess(role, item.to));
