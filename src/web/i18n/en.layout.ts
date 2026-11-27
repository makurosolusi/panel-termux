import { msg } from "@/shared/i18n";

/**
 * UI strings of the signed-in chrome and shared components (sidebar, mobile nav, tables, logs, confirm dialogs,
 * in-shell 404/error pages). Split from `tShell` so the landing (`/`) does not carry them (PLAN/01 §3.11, B30).
 */
export const tLayout = msg("layout", {
  skipToContent: "Skip to content",
  groups: { server: "Server", admin: "Administration", account: "Account" },
  sidebar: {
    label: "Main navigation",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
  },
  breadcrumb: "Breadcrumb",
  navigating: "Loading page…",
  mobileNav: {
    label: "Main navigation",
    more: "More",
    moreTitle: "More pages",
    moreActive: "(the current page is in this menu)",
    back: (label: string) => `Back to ${label}`,
  },
  staleTitle: "Couldn't refresh the data.",
  staleSince: (rel: string) => `Last updated ${rel}.`,
  theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
  table: {
    loading: "Loading data…",
    page: (p: number, n: number) => `Page ${p} of ${n}`,
    prev: "Previous",
    next: "Next",
    actions: "Actions",
    more: "More actions",
    pagination: "Pagination",
    pageWithTotal: (p: number, n: number, total: string) => `Page ${p} of ${n} · ${total} entries`,
  },
  confirm: {
    typedLabel: (value: string) => `Type ${value} to confirm`,
    typedHint: "Case-sensitive.",
    irreversible: "This can't be undone.",
  },
  toaster: { region: "Notifications", close: "Close notification" },
  notFound: {
    title: "Page not found",
    body: "This address doesn't exist or has moved. Check the URL or go back home.",
    home: "Back to home",
  },
  routeError: {
    title: "This page didn't load",
    body: "Something went wrong while showing this page. Try reloading; if it keeps happening, tell an admin.",
    retry: "Reload",
    home: "Go home",
  },
  log: {
    toolbar: "Log tools",
    follow: "Follow",
    paused: "Paused",
    newLines: (n: number) => `New lines (${n})`,
    toBottom: "Jump to latest",
    search: "Search log",
    searchPlaceholder: "e.g. error",
    matches: (n: string, total: string) => `${n} of ${total} lines match`,
    noMatches: "No matching lines. Try a different search.",
    wrap: "Wrap lines",
    copy: "Copy log",
    copyFiltered: (n: string) => `Copy ${n} lines`,
    download: "Download .log",
    streams: { all: "All", out: "stdout", err: "stderr" },
    capped: (n: string) => `Showing the last ${n} lines.`,
    lineCut: (n: string) => `… (+${n} characters; copy or download for the full line)`,
  },
} as const);
