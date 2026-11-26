import type { RouteObject } from "react-router";
import { idShell } from "@/web/i18n/id.shell";
import type { RouteHandle } from "@/web/layout/shell.page";

const n = idShell.nav;
const h = (title: string): RouteHandle => ({ title });

/** Administration routes (PLAN/05, super_admin): health, users, audit, panel log, settings. */
export const devRoutes: RouteObject[] = [
  { path: "/dev", handle: h(n.health), lazy: { Component: () => import("./health.page").then((m) => m.HealthPage) } },
  {
    path: "/dev/users",
    handle: h(n.users),
    lazy: { Component: () => import("./users.page").then((m) => m.UsersPage) },
  },
  {
    path: "/dev/audit",
    handle: h(n.audit),
    lazy: { Component: () => import("./audit.page").then((m) => m.AuditPage) },
  },
  { path: "/dev/logs", handle: h(n.logs), lazy: { Component: () => import("./logs.page").then((m) => m.LogsPage) } },
  {
    path: "/dev/settings",
    handle: h(n.settings),
    lazy: { Component: () => import("./settings.page").then((m) => m.SettingsPage) },
  },
];
