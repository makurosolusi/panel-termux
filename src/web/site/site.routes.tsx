import type { RouteObject } from "react-router";
import { id } from "@/web/i18n/id";
import type { RouteHandle } from "@/web/layout/shell.page";

const n = id.shell.nav;

/** Site routes (PLAN/03): list, new-site wizard (task route), detail, change history and job progress. */
export const siteRoutes: RouteObject[] = [
  {
    path: "/panel/sites",
    handle: { title: n.sites } satisfies RouteHandle,
    lazy: { Component: () => import("./sites.page").then((m) => m.SitesPage) },
  },
  {
    path: "/panel/sites/new",
    handle: { title: id.site.wizard.title, task: true } satisfies RouteHandle,
    lazy: { Component: () => import("./site-new.page").then((m) => m.SiteNewPage) },
  },
  {
    path: "/panel/sites/:name",
    handle: { title: n.sites } satisfies RouteHandle,
    lazy: { Component: () => import("./site-detail.page").then((m) => m.SiteDetailPage) },
  },
  {
    path: "/panel/jobs",
    handle: { title: n.jobs } satisfies RouteHandle,
    lazy: { Component: () => import("./jobs.page").then((m) => m.JobsPage) },
  },
  {
    path: "/panel/jobs/:id",
    handle: { title: id.site.job.title } satisfies RouteHandle,
    lazy: { Component: () => import("./job.page").then((m) => m.JobPage) },
  },
];
