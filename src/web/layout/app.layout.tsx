import { cn } from "cn";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { homeFor } from "@/shared/roles";
import { TooltipProvider } from "@/web/components/ui/tooltip";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";
import { AppSidebar } from "./app.sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileBar } from "./mobile.bar";
import { breadcrumbsFor, documentTitleFor, navGroupsFor, navMatch } from "./nav.items";

const COLLAPSED_KEY = "panel-termux:sidebar-collapsed";
const MAIN_ID = "main";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false; // storage blocked: start expanded
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts until reload, which is acceptable for a layout preference
  }
}

/**
 * Shell for signed-in pages: skip link, desktop sidebar (collapsible) or phone top bar + sheet, breadcrumbs, and
 * a full-width content area (max width per page type). Sets the document title per route.
 */
export function AppLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  const groups = navGroupsFor(me.role);
  const home = homeFor(me.role);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const width = navMatch(pathname)?.item.width ?? "wide";

  useEffect(() => {
    document.title = documentTitleFor(pathname, id.shell.notFound.title);
  }, [pathname]);

  const toggle = () =>
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });

  return (
    <TooltipProvider>
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-50 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {id.shell.skipToContent}
      </a>
      <div className="flex min-h-svh">
        <AppSidebar me={me} groups={groups} home={home} collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar me={me} groups={groups} home={home} />
          <div className="sticky top-0 z-30 hidden h-14 items-center border-b bg-background/90 px-8 backdrop-blur md:flex">
            <Breadcrumbs crumbs={breadcrumbsFor(pathname)} />
          </div>
          <main id={MAIN_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
            <div className={cn("mx-auto w-full", width === "narrow" ? "max-w-3xl" : "max-w-7xl")}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
