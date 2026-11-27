import type { HealthStatus } from "@/shared/dev.types";
import { msg } from "@/shared/i18n";
import type { PanelMode } from "@/shared/panel.types";

/** UI strings of /dev System health (PLAN/05 §5.1). */
export const tDevHealth = msg("dev.health", {
  title: "System health",
  description: "The state of Panel Termux on this phone: checks, resources, and background processes.",
  verdict: { ok: "Healthy", warn: "Needs attention", fail: "Failing" } satisfies Record<HealthStatus, string>,
  verdictOk: "All checks passed. There is nothing you need to do.",
  problemLink: "See details",
  checks: {
    errors: {
      ok: "No unhandled errors in the last 5 minutes.",
      warn: (n: number) => `${n} unhandled ${n === 1 ? "error" : "errors"} in the last 5 minutes.`,
      fail: (n: number) => `${n} unhandled ${n === 1 ? "error" : "errors"} in the last 5 minutes. See the error log.`,
      link: "See the error log",
    },
    sampler: {
      ok: (ago: string) => `Monitoring is running; last sample ${ago}.`,
      warn: (ago: string) =>
        `Monitoring is behind: last sample ${ago}. The phone may be holding Termux back (battery optimization).`,
      waiting: "Waiting for the first sample.",
    },
    fake_on_https: {
      ok: "The panel reads data from the phone.",
      fail: "The panel runs on sample data instead of the phone's data, because runit (`sv`) was not found.",
    },
    backup_scheduler: {
      ok: (ago: string) => `The backup scheduler is running; last run ${ago}.`,
      warn: (ago: string) => `The backup scheduler is behind: last run ${ago}. The phone may be holding Termux back.`,
      waiting: "The backup scheduler hasn't run since the panel started.",
    },
  },
  info: {
    title: "Information",
    description: "These don't lower the health status, but you should take care of them.",
    backup_not_configured: "Backups aren't set up yet. Set them up in the setup guide.",
    access_not_seen: "Cloudflare Access not detected yet. Anyone with a Google account can sign in as a User.",
    open: "Open the setup guide",
  },
  fakeMode: "Demo mode",
  backupUnreadable: "The backup settings can't be read. The data key may have changed; check the Security section.",
  tiles: {
    since: (at: string) => `Since ${at}`,
    memory: "Memory",
    heap: (mb: number) => `JS memory (heap) ${mb} MB`,
    disk: "Storage",
    diskFree: (free: string, total: string) => `${free} free of ${total}`,
    requests: "Requests/min",
    requests5xx: (n: number) => `5xx in 5 min: ${n}`,
  },
  background: {
    title: "Background processes",
    sampler: "Monitoring",
    scheduler: "Backup scheduler",
    nextBackup: "Next backup",
    backupOff: "Backup schedule is off",
    job: "Running change",
    noJob: "No change is running.",
    never: "Never",
  },
  lastErrors: {
    title: "Recent errors",
    empty: "No errors since the panel started.",
    all: "See the full error log",
  },
  security: { title: "Security", description: "The data key and every user's sign-in sessions." },
  detail: {
    title: "Details",
    version: "Version",
    schema: "Database schema",
    mode: "Mode",
    modes: { termux: "Termux", fake: "Demo mode" } satisfies Record<PanelMode, string>,
    runtime: "Runtime",
    cpuCores: "CPU cores",
    db: "Panel database size",
    counts: "Users · sessions",
  },
  /** Uptime tile label (glossary: Uptime). */
  uptime: "Uptime",
  /** "3 users · 5 active sessions". */
  countsDetail: (users: number, sessions: number) =>
    `${users} ${users === 1 ? "user" : "users"} · ${sessions} active ${sessions === 1 ? "session" : "sessions"}`,
} as const);
