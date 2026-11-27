import { msg } from "@/shared/i18n";

/** UI strings of the shell that `/` also needs (nav titles, time, copy, chunk errors, public 404); the rest is `tLayout`. */
export const tShell = msg("shell", {
  nav: {
    overview: "Overview",
    sites: "Sites",
    jobs: "Change history",
    services: "Services",
    apps: "Apps",
    domains: "Domains",
    databases: "Databases",
    backups: "Backups",
    health: "System health",
    users: "Users",
    audit: "Audit",
    logs: "Logs",
    settings: "Settings",
    profile: "Profile",
  },
  account: "Account menu",
  time: {
    justNow: "just now",
    ago: (s: string) => `${s} ago`,
    in: (s: string) => `in ${s}`,
    yesterday: "yesterday",
    days: (n: number) => `${n} ${n === 1 ? "day" : "days"}`,
    refresh: "Refresh",
    live: "Auto-refresh on",
    stale: "Refresh failed",
  },
  load: { cores: (n: number) => `${n} ${n === 1 ? "core" : "cores"}` },
  copy: { copy: "Copy", copied: "Copied", failed: "Couldn't copy. Copy the text above by hand." },
  chunkError: {
    title: "This part of the panel didn't load",
    body: "The panel was probably just updated, or the connection dropped. Reload to get the latest version.",
    reload: "Reload page",
    offlineTitle: "Can't reach the panel server",
    offlineBody:
      "The panel server isn't responding. Check your internet connection and make sure the panel is still running on the phone, then try again.",
  },
  publicNotFound: {
    title: "Page not found",
    body: "This address doesn't exist on Panel Termux.",
    home: "Go home",
    signIn: "Sign in",
  },
} as const);
