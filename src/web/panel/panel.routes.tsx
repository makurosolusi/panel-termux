import type { RouteObject } from "react-router";
import { tHistory } from "@/web/i18n/en.history";
import { tShell } from "@/web/i18n/en.shell";
import type { RouteHandle } from "@/web/layout/shell.page";

const n = tShell.nav;
const h = (title: string): RouteHandle => ({ title });

// Pages load per route (own chunk) so the first /panel load stays within the 200 KB gzip budget (PLAN/01 §3.11).
/** Server monitoring routes (PLAN/02): Overview, problem history, Services, Apps, Domains, Databases and unit logs. */
export const panelRoutes: RouteObject[] = [
  {
    path: "/panel",
    handle: h(n.overview),
    lazy: { Component: () => import("./overview.page").then((m) => m.OverviewPage) },
  },
  {
    path: "/panel/problems",
    handle: h(tHistory.problems.title),
    lazy: { Component: () => import("./problems.page").then((m) => m.ProblemsPage) },
  },
  {
    path: "/panel/services",
    handle: h(n.services),
    lazy: { Component: () => import("./services.page").then((m) => m.ServicesPage) },
  },
  {
    path: "/panel/services/:name/log",
    handle: h(n.logs),
    lazy: { element: () => import("./log.page").then(({ LogPage }) => <LogPage kind="services" />) },
  },
  {
    path: "/panel/apps",
    handle: h(n.apps),
    lazy: { Component: () => import("./apps.page").then((m) => m.AppsPage) },
  },
  {
    path: "/panel/apps/:name/log",
    handle: h(n.logs),
    lazy: { element: () => import("./log.page").then(({ LogPage }) => <LogPage kind="apps" />) },
  },
  {
    path: "/panel/domains",
    handle: h(n.domains),
    lazy: { Component: () => import("./domains.page").then((m) => m.DomainsPage) },
  },
  {
    path: "/panel/databases",
    handle: h(n.databases),
    lazy: { Component: () => import("./databases.page").then((m) => m.DatabasesPage) },
  },
];
