import { msg } from "@/shared/i18n";
import type { AppStatus, ControlAction } from "@/shared/panel.types";

const SSH_HINT = "If it really has to stop, do it from the phone's terminal.";

/** UI strings of the Services, Apps, Domains, Databases and log pages (Overview: en.overview.ts). */
export const tPanel = msg("panel", {
  errorCodes: {
    busy: "Another action is still running. Wait until it finishes, then try again.",
    not_found:
      "This item no longer exists; it may have been deleted or renamed. Reload the page to see the latest list.",
    lockout: `Stopping this service cuts off access to the panel, so the panel refuses. ${SSH_HINT}`,
    protected: "This core service can't be stopped from the panel, so the panel stays reachable.",
    confirm_required: "Type the service name to confirm, then try again.",
    job_running: "A site change, backup or restore is running. Wait until it finishes, then try again.",
    not_supervised: "The panel isn't running under runit, so it can't restart itself.",
    pm2_unavailable:
      "The pm2 service isn't running, so every site is down. Start pm2 from the Overview, then try again.",
    postgres_down: "The postgres service isn't running. Sites that use a database are down until postgres runs again.",
    too_soon: "Wait a moment before checking again.",
    invalid_cursor: "The log position is no longer valid. Reload the page to read from the end of the log.",
    system_error:
      "A system command on the phone failed. Try again; if it keeps failing, check the service's log on the Services page.",
  },
  fakeMode: "Demo mode",
  fakeModeHelp: "The data on this page is sample data, because the panel isn't running in Termux.",
  /** 0.2.x pm2 labels still read by the site list (site.card.tsx) until it maps to StatusKey (W7 cleanup). */
  appStatuses: {
    online: "Running",
    stopped: "Stopped",
    errored: "Errored",
    launching: "Starting",
    unknown: "Unknown",
  } satisfies Record<AppStatus, string>,
  actions: { start: "Start", stop: "Stop", restart: "Restart" } satisfies Record<ControlAction, string>,
  more: (name: string) => `More actions for ${name}`,
  /** Accessible name of a row's primary button, so five "Restart" buttons are told apart. */
  actionFor: (action: string, name: string) => `${action} ${name}`,
  viewLog: "View log",
  confirmTitle: { stop: (n: string) => `Stop ${n}?`, restart: (n: string) => `Restart ${n}?` },
  /** Consequence-first confirmation text per action. */
  confirmBodies: {
    stop: (name: string) => `${name} stops and stays unreachable until it's started again.`,
    restart: (name: string) =>
      `${name} stops briefly, then runs again. Visitors may be disconnected for a few seconds.`,
    siteStop: (site: string) => `The ${site} site is unreachable until its app is started again.`,
  },
  /** Extra consequence per service (PLAN/02 §5.2). */
  serviceImpact: {
    pm2: "Every app stops too; sites are unreachable until pm2 and its apps run again.",
    postgres: "Sites that use a database are unreachable until postgres runs again.",
    sshd: "SSH logins to this phone are refused until sshd runs again (open sessions usually stay connected).",
    cloudflared: "Every domain drops for a few seconds while the cloudflared tunnel restarts.",
    panel: "This page disconnects for about 10–30 s, then reconnects.",
  } as Readonly<Record<string, string>>,
  /** Services whose impact line replaces the generic restart sentence (it would contradict "a few seconds"). */
  restartImpactOnly: ["panel", "cloudflared"] as readonly string[],
  lockoutReason: (name: string) =>
    `Stopping ${name} cuts off access to this panel, and the panel can't start it again. ${SSH_HINT}`,
  /** Past-tense success toast per action. */
  doneBy: {
    start: (name: string) => `${name} started.`,
    stop: (name: string) => `${name} stopped.`,
    restart: (name: string) => `${name} restarted.`,
  } satisfies Record<ControlAction, (name: string) => string>,
  networkLost: "Couldn't confirm the result because the connection dropped. Reload to see the current state.",
  /** Reconnect overlay per deferred service (PLAN/02 §4.4). */
  restart: {
    panel: {
      title: "Restarting the panel…",
      body: "Reconnecting. This page comes back on its own as soon as the panel is ready.",
      failedTitle: "The panel hasn't reconnected yet",
      failed:
        "Wait a moment, then press Try again. If it still fails, make sure the phone is on, connected to the internet, and Termux is still open. If you use Cloudflare Access, reload the page to sign in again.",
      back: "Panel restarted.",
    },
    cloudflared: {
      title: "Restarting cloudflared…",
      body: "Every domain drops for a few seconds. Waiting for the tunnel to reconnect.",
      failedTitle: "cloudflared isn't running yet",
      failed:
        "Wait a moment, then press Try again. If it still fails, open the cloudflared log on the Services page to see why.",
      back: "cloudflared restarted.",
    },
    retry: "Try again",
    close: "Close",
  },
  coreBadge: "Core",
  pid: (pid: number) => `PID ${pid}`,
  services: {
    title: "Services",
    description: "runit services on the phone. Core services keep the panel, sites and SSH access running.",
    label: "Service list",
    cols: { name: "Name", status: "Status", since: "Since", pid: "PID" },
    upFor: (d: string) => `up ${d}`,
    downFor: (d: string) => `down ${d}`,
    upJustNow: "just started",
    downJustNow: "just stopped",
    crashLoop: "restarting repeatedly",
    emptyTitle: "No runit services yet",
    emptyBody: "The panel reads services from `$PREFIX/var/service`.",
    error: "Couldn't read the service list. Try again; if it keeps failing, wait a moment and reload the page.",
  },
  apps: {
    title: "Apps",
    description: "pm2 apps that run your sites.",
    label: "App list",
    cols: {
      name: "Name",
      status: "Status",
      site: "Site",
      memory: "Memory",
      uptime: "Uptime",
      restarts: "Restarts",
      port: "Port",
    },
    restarts: (n: string) => `${n}×`,
    modules: (n: number) => `pm2 modules (${n})`,
    emptyTitle: "No apps yet",
    emptyBody: "Apps appear once you create a site or add one to `ecosystem.config.js`.",
    pm2Down: "pm2 isn't running",
    pm2DownBody: "The pm2 service isn't running, so every site is down.",
  },
  domains: {
    title: "Domains",
    description:
      "Domains routed through the cloudflared tunnel, where they point on the phone, and checks from the internet.",
    label: "Domain list",
    cols: {
      domain: "Domain",
      target: "Target",
      status: "Status",
      reason: "Details",
      response: "Response",
      checked: "Checked",
    },
    open: (host: string) => `Open ${host} in a new tab`,
    target: {
      app: (site: string | null, app: string) => (site ? `Site ${site} · app ${app}` : `App ${app}`),
      panel: "Panel Termux",
      other: (service: string) => `Other service (${service})`,
      none: "No target",
    },
    ms: (ms: string) => `${ms} ms`,
    never: "Never",
    check: "Check again",
    checkLabel: (host: string) => `Check ${host} again`,
    checked: (host: string) => `${host} checked.`,
    reasons: {
      unchecked: "The first check runs within 1 min.",
      authRequired: "The domain answers but asks for a login (probably Cloudflare Access).",
      clientError: (status: number) => `The app is running, but the home page answers ${status}.`,
      unstable: (n: number) => `Failed ${n}× in a row. Marked as a problem after 3×.`,
      localAnswers: (local: number) => `The app on the phone answers ${local}, so the problem is in the tunnel.`,
      portSilent: (port: number) => `The app on port ${port} isn't answering.`,
      noAnswer: "The domain isn't answering from the internet.",
      tunnelDown: "Cloudflare can't reach the cloudflared tunnel on the phone.",
      heldBy: (title: string) => `Cause: ${title}.`,
      wildcard: "Wildcard domains aren't checked automatically.",
    },
    emptyTitle: "No domains yet",
    emptyBody: "Add a domain from a site's page, or write a rule in `~/.cloudflared/config.yml`.",
  },
  databases: {
    title: "Databases",
    description: "PostgreSQL databases on the phone and the sites that use them.",
    label: "Database list",
    cols: { name: "Name", site: "Site", owner: "Owner", size: "Size", backup: "Last backup" },
    noBackup: "Never",
    staleBackup: "More than 36 hours ago",
    emptyTitle: "No databases yet",
    emptyBody: "A database is created automatically when you create a site with PostgreSQL.",
    postgresDown: "The postgres service isn't running",
    postgresDownBody: "Sites that use a database are unreachable until postgres runs again.",
  },
  log: {
    title: (name: string) => `${name} log`,
    backServices: "Services",
    backApps: "Apps",
    stream: "Log stream",
    streams: { out: "stdout", err: "stderr" },
    note: "Logs are shown as written; common secret patterns are masked.",
    truncated: "Some lines were skipped because too many new lines arrived at once.",
    empty: "No log yet. It appears once this service or app writes something.",
    failed: "Couldn't read the log",
  },
  dash: "–",
} as const);
