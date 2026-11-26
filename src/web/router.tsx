import { createBrowserRouter } from "react-router";
import { BackupsPage } from "@/web/backup/backups.page";
import { AuditPage } from "@/web/dev/audit.page";
import { DevLayout } from "@/web/dev/dev.layout";
import { HealthPage } from "@/web/dev/health.page";
import { LogsPage } from "@/web/dev/logs.page";
import { SettingsPage } from "@/web/dev/settings.page";
import { UsersPage } from "@/web/dev/users.page";
import { LandingPage } from "@/web/landing/landing.page";
import { AppLayout } from "@/web/layout/app.layout";
import { LoginPage } from "@/web/pages/login.page";
import { NotFoundPage } from "@/web/pages/not-found.page";
import { ProfilePage } from "@/web/pages/profile.page";
import { RouteErrorPage } from "@/web/pages/route-error.page";
import { AppsPage } from "@/web/panel/apps.page";
import { DatabasesPage } from "@/web/panel/databases.page";
import { DomainsPage } from "@/web/panel/domains.page";
import { LogPage } from "@/web/panel/log.page";
import { OverviewPage } from "@/web/panel/overview.page";
import { PanelLayout } from "@/web/panel/panel.layout";
import { ServicesPage } from "@/web/panel/services.page";
import { fetchMe } from "@/web/session/session.api";
import { SessionError } from "@/web/session/session.error";
import { SessionFallback } from "@/web/session/session.fallback";
import { SessionGate } from "@/web/session/session.gate";
import { ROOT_ROUTE_ID } from "@/web/session/use-me";
import { JobPage } from "@/web/site/job.page";
import { JobsPage } from "@/web/site/jobs.page";
import { SiteDetailPage } from "@/web/site/site-detail.page";
import { SiteNewPage } from "@/web/site/site-new.page";
import { SitesPage } from "@/web/site/sites.page";

/**
 * SPA route tree. The root loader fetches `/api/me` once per page load (it does not re-run on plain path
 * changes); SessionGate re-applies the redirect rules on every navigation.
 */
export const router = createBrowserRouter([
  {
    id: ROOT_ROUTE_ID,
    path: "/",
    loader: fetchMe,
    Component: SessionGate,
    HydrateFallback: SessionFallback,
    ErrorBoundary: SessionError,
    children: [
      { index: true, Component: LandingPage }, // public, never redirected by SessionGate
      { path: "login", Component: LoginPage },
      {
        Component: AppLayout,
        children: [
          {
            // pathless: route errors render inside the shell, so the sidebar stays usable
            ErrorBoundary: RouteErrorPage,
            children: [
              { path: "profile", Component: ProfilePage },
              {
                path: "panel",
                Component: PanelLayout,
                children: [
                  { index: true, Component: OverviewPage },
                  { path: "sites", Component: SitesPage },
                  { path: "sites/new", Component: SiteNewPage },
                  { path: "sites/:name", Component: SiteDetailPage },
                  { path: "jobs", Component: JobsPage },
                  { path: "jobs/:id", Component: JobPage },
                  { path: "services", Component: ServicesPage },
                  { path: "services/:name/log", element: <LogPage kind="services" /> },
                  { path: "apps", Component: AppsPage },
                  { path: "apps/:name/log", element: <LogPage kind="apps" /> },
                  { path: "domains", Component: DomainsPage },
                  { path: "databases", Component: DatabasesPage },
                  { path: "backups", Component: BackupsPage },
                ],
              },
              {
                path: "dev",
                Component: DevLayout,
                children: [
                  { index: true, Component: HealthPage },
                  { path: "users", Component: UsersPage },
                  { path: "audit", Component: AuditPage },
                  { path: "logs", Component: LogsPage },
                  { path: "settings", Component: SettingsPage },
                ],
              },
              { path: "*", Component: NotFoundPage },
            ],
          },
        ],
      },
    ],
  },
]);
