import { cn } from "cn";
import { lazy, type ReactNode, type RefObject, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import { homeFor } from "@/shared/roles";
import { ShellPageContext } from "@/web/components/page-header";
import { TooltipProvider } from "@/web/components/ui/tooltip";
import { tLayout } from "@/web/i18n/en.layout";
import { NavBadgeProvider } from "@/web/panel/nav.badge.provider";
import { useMe } from "@/web/session/use-me";
import { AppSidebar } from "./app.sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { documentTitle } from "./document.title";
import { MobileNav } from "./mobile.nav";
import { MobileTopBar } from "./mobile.topbar";
import { breadcrumbsFor, mobileNavFor, navGroupsFor, navMatch } from "./nav.items";
import { useShellPage } from "./shell.page";
import { TaskModeContext } from "./task.mode";

/** sonner stays off the initial path; toasts fired before it loads wait for it (toast.lazy.ts). */
const Toaster = lazy(() => import("@/web/components/ui/sonner").then((m) => ({ default: m.Toaster })));

const COLLAPSED_KEY = "panel-termux:sidebar-collapsed";
const MAIN_ID = "main";
/** PageHeader's h1; route focus target (PLAN/01 D7). */
const PAGE_TITLE_ID = "page-title";

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
 * After a path change (not the first render, not search/hash only): focus the page h1, else `main`. Returns the
 * text for the polite live region, set only when there was no h1 to focus (focusing an h1 announces it already).
 */
function useRouteFocus(pathname: string, main: RefObject<HTMLElement | null>): string {
  const first = useRef(true);
  const [announcement, setAnnouncement] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger, not an input
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById(PAGE_TITLE_ID);
      (heading ?? main.current)?.focus({ preventScroll: true });
      setAnnouncement(heading ? "" : document.title);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, main]);
  return announcement;
}

/**
 * Shell for signed-in pages: skip link, desktop sidebar (collapsible) + breadcrumb header, phone top bar + bottom
 * bar ("More" sheet; hidden on task routes and for roles with one destination), route focus, the tab title, and
 * the app's single Toaster + TooltipProvider + NavBadgeProvider (PLAN/01 §3.6; here rather than SessionGate to keep
 * them off `/`). `children` replaces the route outlet (signed-in 404 under the root splat route).
 */
export function AppLayout({ children }: { children?: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const navigating = useNavigation().state === "loading";
  const shell = useShellPage();
  const [taskHolds, setTaskHolds] = useState(0);
  const changeTask = useCallback((delta: 1 | -1) => setTaskHolds((n) => n + delta), []);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const mainRef = useRef<HTMLElement>(null);
  const announcement = useRouteFocus(pathname, mainRef);
  const mobile = mobileNavFor(me.role);
  const bottomBar = mobile.primary.length > 0 && !shell.task && taskHolds === 0;
  const width = navMatch(pathname)?.item.width ?? "wide";
  const title = shell.title;

  useEffect(() => {
    document.title = documentTitle(title ?? tLayout.notFound.title);
  }, [title]);

  const toggle = () =>
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });

  return (
    <ShellPageContext.Provider value={shell.register}>
      <TaskModeContext.Provider value={changeTask}>
        <NavBadgeProvider>
          <TooltipProvider>
            <a
              href={`#${MAIN_ID}`}
              className="sr-only z-50 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
            >
              {tLayout.skipToContent}
            </a>
            <div className="flex min-h-svh">
              <AppSidebar
                me={me}
                groups={navGroupsFor(me.role)}
                home={homeFor(me.role)}
                collapsed={collapsed}
                onToggle={toggle}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <MobileTopBar title={title} back={shell.back} me={me} withMenu={mobile.primary.length === 0} />
                <div className="sticky top-0 z-30 hidden h-14 items-center border-b bg-background/90 px-8 backdrop-blur md:flex">
                  <Breadcrumbs crumbs={breadcrumbsFor(pathname, title)} />
                </div>
                <div className="relative h-0">
                  {navigating && (
                    <div
                      role="progressbar"
                      aria-label={tLayout.navigating}
                      className="absolute inset-x-0 top-0 h-0.5 animate-in bg-foreground/40 fade-in fill-mode-backwards delay-150 duration-0"
                    />
                  )}
                </div>
                <main
                  ref={mainRef}
                  id={MAIN_ID}
                  tabIndex={-1}
                  className={cn(
                    "flex-1 px-4 py-6 outline-none md:px-8 md:py-8",
                    bottomBar && "max-md:pb-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom)+1.5rem)]",
                  )}
                >
                  <div className={cn("mx-auto w-full", width === "narrow" ? "max-w-3xl" : "max-w-7xl")}>
                    {children ?? <Outlet />}
                  </div>
                </main>
                <p aria-live="polite" className="sr-only">
                  {announcement}
                </p>
              </div>
            </div>
            {bottomBar && <MobileNav primary={mobile.primary} more={mobile.more} me={me} />}
            <Suspense fallback={null}>
              <Toaster />
            </Suspense>
          </TooltipProvider>
        </NavBadgeProvider>
      </TaskModeContext.Provider>
    </ShellPageContext.Provider>
  );
}
