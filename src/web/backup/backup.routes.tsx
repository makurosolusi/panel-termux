import type { RouteObject } from "react-router";
import { id } from "@/web/i18n/id";
import type { RouteHandle } from "@/web/layout/shell.page";

/** Backup routes (PLAN/04). */
export const backupRoutes: RouteObject[] = [
  {
    path: "/panel/backups",
    handle: { title: id.shell.nav.backups } satisfies RouteHandle,
    lazy: { Component: () => import("./backups.page").then((m) => m.BackupsPage) },
  },
];
