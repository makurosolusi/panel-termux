import { cn } from "cn";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { id } from "@/web/i18n/id";
import { NavBadge } from "@/web/panel/nav.badge.provider";
import type { Me } from "@/web/session/session.api";
import { MobileMore } from "./mobile.more";
import { activeInMore, type NavGroup, type NavItem } from "./nav.items";

const t = id.shell.mobileNav;
const SLOT = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-none";

/** Phone bottom bar (< md): four primary destinations + "Lainnya" (sheet with the rest and the account). */
export function MobileNav({ primary, more, me }: { primary: readonly NavItem[]; more: readonly NavGroup[]; me: Me }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inMore = activeInMore(pathname, more);
  return (
    <nav
      aria-label={t.label}
      data-bottom-nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex h-14 items-stretch">
        {primary.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex min-w-0 flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(SLOT, "text-muted-foreground", isActive && "font-medium text-foreground [&_svg]:text-brand-text")
              }
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                <NavBadge to={to} dot className="absolute -top-0.5 -right-1" />
              </span>
              <span className="max-w-full truncate px-0.5">{label}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn(
              SLOT,
              "text-muted-foreground",
              inMore && "font-medium text-foreground [&_svg]:text-brand-text",
            )}
          >
            <span className="relative">
              <EllipsisIcon className="size-5" aria-hidden />
              {inMore && <span aria-hidden className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-brand" />}
            </span>
            <span className="max-w-full truncate px-0.5">{t.more}</span>
            {inMore && <span className="sr-only">{t.moreActive}</span>}
          </button>
        </li>
      </ul>
      <MobileMore open={open} onOpenChange={setOpen} groups={more} me={me} />
    </nav>
  );
}
