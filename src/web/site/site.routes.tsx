import type { RouteObject } from "react-router";
import { idShell } from "@/web/i18n/id.shell";
import type { RouteHandle } from "@/web/layout/shell.page";

// Fallback titles while a page chunk loads (its PageHeader then registers the real one). Shell copy only, so the
// eager route table does not pull the site/job dictionaries into the initial bundle (B30).
const n = idShell.nav;

/** Site routes (PLAN/03): list, new-site wizard (task route), detail, change history and job progress. */
export const siteRoutes: RouteObject[] = [
  {
    path: "/panel/sites",
    handle: { title: n.sites } satisfies RouteHandle,
    lazy: { Component: () => import("./sites.page").then((m) => m.SitesPage) },
  },
  {
    path: "/panel/sites/new",
    handle: { title: n.sites, task: true } satisfies RouteHandle,
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
    handle: { title: n.jobs } satisfies RouteHandle,
    lazy: { Component: () => import("./job.page").then((m) => m.JobPage) },
  },
];
