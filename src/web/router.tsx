import { createBrowserRouter, Navigate } from "react-router";
import { AuditPage } from "@/web/dev/audit.page";
import { DevLayout } from "@/web/dev/dev.layout";
import { HealthPage } from "@/web/dev/health.page";
import { InvitesPage } from "@/web/dev/invites.page";
import { LogsPage } from "@/web/dev/logs.page";
import { SettingsPage } from "@/web/dev/settings.page";
import { UsersPage } from "@/web/dev/users.page";
import { id } from "@/web/i18n/id";
import { AppLayout } from "@/web/layout/app.layout";
import { EmptySectionPage } from "@/web/pages/empty-section.page";
import { LoginPage } from "@/web/pages/login.page";
import { ProfilePage } from "@/web/pages/profile.page";
import { fetchMe } from "@/web/session/session.api";
import { SessionError } from "@/web/session/session.error";
import { SessionFallback } from "@/web/session/session.fallback";
import { SessionGate } from "@/web/session/session.gate";
import { ROOT_ROUTE_ID } from "@/web/session/use-me";

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
      { index: true, element: null }, // SessionGate always redirects "/" to login or home
      { path: "login", Component: LoginPage },
      {
        Component: AppLayout,
        children: [
          { path: "profile", Component: ProfilePage },
          { path: "panel", element: <EmptySectionPage title={id.panel.title} subtitle={id.panel.subtitle} /> },
          {
            path: "dev",
            Component: DevLayout,
            children: [
              { index: true, Component: HealthPage },
              { path: "users", Component: UsersPage },
              { path: "invites", Component: InvitesPage },
              { path: "audit", Component: AuditPage },
              { path: "logs", Component: LogsPage },
              { path: "settings", Component: SettingsPage },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
