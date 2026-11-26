import { cn } from "cn";
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useSignOut } from "@/web/auth/use-sign-out";
import { RoleBadge } from "@/web/components/role-badge";
import { Sheet, SheetContent, SheetTitle } from "@/web/components/ui/sheet";
import { UserAvatar } from "@/web/components/user-avatar";
import { idApp } from "@/web/i18n/id.app";
import { idShell } from "@/web/i18n/id.shell";
import type { Me } from "@/web/session/session.api";
import type { ThemePreference } from "@/web/theme/theme.preference";
import { setThemePreference, useTheme } from "@/web/theme/theme.store";
import type { NavGroup } from "./nav.items";
import { SidebarNav } from "./sidebar.nav";

const t = idShell;
const THEMES: readonly { value: ThemePreference; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: t.theme.system, icon: MonitorIcon },
  { value: "light", label: t.theme.light, icon: SunIcon },
  { value: "dark", label: t.theme.dark, icon: MoonIcon },
];
const ROW = "flex h-12 items-center gap-2.5 rounded-md px-2.5 text-base hover:bg-accent";

/**
 * "Lainnya" bottom sheet (phones): remaining nav groups in 48 px rows, then the account block (avatar, name, role),
 * theme switch, Profil and Keluar. Closes on navigation and on any link tap (also the page already open).
 */
export function MobileMore({
  open,
  onOpenChange,
  groups,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly NavGroup[];
  me: Me;
}) {
  const { pathname } = useLocation();
  const { preference } = useTheme();
  const { signOut, pending, error } = useSignOut();
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger (close after navigating)
  useEffect(() => close.current(false), [pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">{t.mobileNav.moreTitle}</SheetTitle>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated close for link taps; links handle their own keys */}
        <nav
          aria-label={t.mobileNav.moreTitle}
          className="flex flex-col gap-4 px-3 pt-4"
          onClick={(e) => {
            if ((e.target as Element).closest("a")) onOpenChange(false);
          }}
        >
          <SidebarNav groups={groups} tall />
          <div className="flex flex-col gap-1 border-t pt-4">
            <div className="flex items-center gap-3 px-2.5 pb-2">
              <UserAvatar me={me} className="size-10" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{me.name}</span>
                <RoleBadge role={me.role} />
              </div>
            </div>
            <fieldset className="mx-2.5 mb-2 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              <legend className="sr-only">{t.theme.label}</legend>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={preference === value}
                  onClick={() => setThemePreference(value)}
                  className={cn(
                    "flex h-11 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground",
                    preference === value && "bg-background font-medium text-foreground shadow-xs",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </fieldset>
            <Link to="/profile" className={ROW}>
              <UserIcon className="size-4 text-muted-foreground" aria-hidden />
              {t.nav.profile}
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={() => void signOut()}
              className={cn(ROW, "text-left text-danger disabled:opacity-60")}
            >
              <LogOutIcon className="size-4" aria-hidden />
              {idApp.menu.signOut}
            </button>
            {error && (
              <p role="alert" className="px-2.5 pb-2 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
