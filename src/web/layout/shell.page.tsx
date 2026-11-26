import { useCallback, useState } from "react";
import { useMatches } from "react-router";
import type { PageBack, ShellPage } from "@/web/components/page-header";

/** `handle` of a route entry: static page title, and `task` = hide the phone bottom bar (wizard, editor). */
export type RouteHandle = { title: string; task?: boolean };

const isHandle = (h: unknown): h is RouteHandle =>
  typeof h === "object" && h !== null && typeof (h as RouteHandle).title === "string";

/** Static title of the deepest matched route that has one, and whether any matched route is a task route. */
export function routeMeta(matches: readonly { handle?: unknown }[]): { title: string | null; task: boolean } {
  const handles = matches.map((m) => m.handle).filter(isHandle);
  return { title: handles.at(-1)?.title ?? null, task: handles.some((h) => h.task === true) };
}

/**
 * Shell side of the PageHeader → shell channel: `register` goes into `ShellPageContext.Provider`; the title is the
 * page's registered (dynamic) title, else the route's `handle.title`.
 */
export function useShellPage(): {
  title: string | null;
  back: PageBack | undefined;
  task: boolean;
  register: (page: ShellPage | null) => void;
} {
  const [page, setPage] = useState<ShellPage | null>(null);
  const meta = routeMeta(useMatches());
  const register = useCallback((p: ShellPage | null) => setPage(p), []);
  return { title: page?.title ?? meta.title, back: page?.back, task: meta.task, register };
}
