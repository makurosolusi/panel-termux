import { cn } from "cn";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/web/components/ui/button";
import { idShell } from "@/web/i18n/id.shell";
import type { Me } from "@/web/session/session.api";
import { BrandLogo } from "./brand.logo";
import type { NavGroup } from "./nav.items";
import { SidebarNav } from "./sidebar.nav";
import { UserMenu } from "./user.menu";

const t = idShell.sidebar;

/** Desktop sidebar (≥ md): logo, grouped nav, collapse toggle and the account menu pinned to the bottom. */
export function AppSidebar({
  me,
  groups,
  home,
  collapsed,
  onToggle,
}: {
  me: Me;
  groups: readonly NavGroup[];
  home: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ToggleIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Link to={home} className="min-w-0 rounded-md">
          <BrandLogo compact={collapsed} />
        </Link>
      </div>
      <nav aria-label={t.label} className={cn("flex-1 overflow-y-auto px-3 py-2", collapsed && "px-2")}>
        <SidebarNav groups={groups} collapsed={collapsed} />
      </nav>
      <div className={cn("flex flex-col gap-1 border-t border-sidebar-border p-2", collapsed && "items-center")}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-label={collapsed ? t.expand : t.collapse}
          aria-expanded={!collapsed}
          title={collapsed ? t.expand : t.collapse}
          className={cn("justify-start text-muted-foreground", collapsed && "w-9 justify-center px-0")}
        >
          <ToggleIcon aria-hidden />
          {!collapsed && <span>{t.collapse}</span>}
        </Button>
        <UserMenu me={me} compact={collapsed} />
      </div>
    </aside>
  );
}
