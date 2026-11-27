import type { RouteObject } from "react-router";
import { tShell } from "@/web/i18n/en.shell";
import type { RouteHandle } from "@/web/layout/shell.page";

/** Backup routes (PLAN/04). */
export const backupRoutes: RouteObject[] = [
  {
    path: "/panel/backups",
    handle: { title: tShell.nav.backups } satisfies RouteHandle,
    lazy: { Component: () => import("./backups.page").then((m) => m.BackupsPage) },
  },
];
