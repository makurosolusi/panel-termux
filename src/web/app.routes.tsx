// The `app` chunk (PLAN/01 §3.11): the shell plus every signed-in page, loaded once on first entry.
import type { RouteObject } from "react-router";
import { backupRoutes } from "@/web/backup/backup.routes";
import { devRoutes } from "@/web/dev/dev.routes";
import { id } from "@/web/i18n/id";
import { AppLayout } from "@/web/layout/app.layout";
import type { RouteHandle } from "@/web/layout/shell.page";
import { NotFoundPage } from "@/web/pages/not-found.page";
import { ProfilePage } from "@/web/pages/profile.page";
import { RouteErrorPage } from "@/web/pages/route-error.page";
import { panelRoutes } from "@/web/panel/panel.routes";
import { siteRoutes } from "@/web/site/site.routes";

/** Signed-in routes, patched under the root route on first navigation into a signed-in area. */
export const appRoutes: RouteObject[] = [
  {
    Component: AppLayout,
    children: [
      {
        // pathless: route errors render inside the shell, so the navigation stays usable
        ErrorBoundary: RouteErrorPage,
        children: [
          { path: "/profile", Component: ProfilePage, handle: { title: id.profile.title } satisfies RouteHandle },
          ...panelRoutes,
          ...siteRoutes,
          ...backupRoutes,
          ...devRoutes,
        ],
      },
    ],
  },
];

/** Signed-in 404: the in-shell not-found page (rendered by the root splat route). */
export function ShellNotFound() {
  return (
    <AppLayout>
      <NotFoundPage />
    </AppLayout>
  );
}
