import { cn } from "cn";
import { NavLink, Outlet } from "react-router";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";
import { navItemsFor } from "./nav.items";
import { UserMenu } from "./user.menu";

/** Shell for protected pages: top bar (brand, section links, avatar menu); links become a bottom tab bar on phones. */
export function AppLayout() {
  const me = useMe();
  const items = navItemsFor(me.role);
  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <span className="font-semibold">{id.appName}</span>
          <nav
            aria-label={id.nav.main}
            className="fixed inset-x-0 bottom-0 flex border-t bg-background pb-[env(safe-area-inset-bottom)] sm:static sm:ml-2 sm:gap-1 sm:border-0 sm:bg-transparent sm:pb-0"
          >
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground sm:flex-none sm:flex-row sm:gap-2 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm",
                    "hover:text-foreground sm:hover:bg-accent",
                    isActive && "text-foreground sm:bg-accent",
                  )
                }
              >
                <Icon className="size-5 sm:size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <UserMenu me={me} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 sm:pb-10">
        <Outlet />
      </main>
    </div>
  );
}
