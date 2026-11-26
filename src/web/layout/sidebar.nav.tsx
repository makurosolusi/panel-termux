import { cn } from "cn";
import { NavLink } from "react-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { NavBadge } from "@/web/panel/nav.badge.provider";
import type { NavGroup, NavItem } from "./nav.items";

/**
 * Grouped navigation links shared by the desktop sidebar and the mobile sheet. NavLink sets aria-current="page"
 * on the active link; `collapsed` = icons only with the label in a tooltip (and still in the accessible name).
 */
export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
  tall = false,
}: {
  groups: readonly NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
  /** 48 px rows (phone "Lainnya" sheet). */
  tall?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          <h2
            className={cn(
              "px-2.5 pb-1 font-mono text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase",
              collapsed && "sr-only",
            )}
          >
            {g.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} tall={tall} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SidebarLink({
  item,
  collapsed,
  onNavigate,
  tall,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  tall: boolean;
}) {
  const { icon: Icon } = item;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors",
          "hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0",
          tall ? "h-12 text-base" : "h-8",
          isActive && "bg-accent font-medium text-foreground",
          collapsed && "justify-center px-0",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
          <Icon className={cn("size-4 shrink-0", isActive && "text-brand-text")} aria-hidden />
          <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
          <NavBadge to={item.to} dot={collapsed} className={cn(collapsed && "absolute top-1 right-1")} />
        </>
      )}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
