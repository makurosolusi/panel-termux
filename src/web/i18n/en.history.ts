import { msg } from "@/shared/i18n";

/** UI strings of the monitor history: trends, heartbeat strip, problem history and the nav badge (PLAN/02 W4). */
export const tHistory = msg("history", {
  trends: {
    title: "Trends",
    description: "Average per interval from monitoring samples.",
    rangeLabel: "Time range",
    range: { "24h": "24 hours", "7d": "7 days" },
    battery: "Battery",
    memory: "Available memory",
    empty: "Charts appear after a few hours of monitoring.",
    noData: "No data yet",
    /** Screen-reader summary of one sparkline. */
    summary: (label: string, range: string, min: string, max: string, last: string) =>
      `${label}, last ${range}: low ${min}, high ${max}, latest ${last}.`,
    summaryEmpty: (label: string, range: string) => `${label}, last ${range}: no data yet.`,
    minMax: (min: string, max: string) => `${min} – ${max}`,
  },
  heartbeat: {
    /** aria-label and phone text of the strip. */
    summary: (ok: number, total: number) => `${ok} of the last ${total} checks healthy`,
    short: (ok: number, total: number) => `${ok}/${total} healthy`,
    none: "Not checked",
    column: "Last 30 checks",
  },
  problems: {
    title: "Problem history",
    description: "Problems from the last 30 days, newest first. Notices and info aren't recorded.",
    label: "Problem history",
    empty: "No problems in the last 30 days.",
    emptyHint: "Problems that appear and recover are recorded here.",
    cols: { problem: "Problem", status: "Status", opened: "Started", duration: "Duration", notified: "Notification" },
    open: "Ongoing",
    closed: "Recovered",
    notified: "Sent",
    notNotified: "–",
    ongoing: (d: string) => `${d}, still ongoing`,
    dayLabel: (day: string, n: number) => `${day} · ${n} ${n === 1 ? "problem" : "problems"}`,
    recentTitle: "Problem history",
    recentEmpty: "No problems in the last 30 days.",
    viewAll: "View history",
    today: (clock: string) => `today ${clock}`,
    yesterday: (clock: string) => `yesterday ${clock}`,
  },
  navBadge: (n: number) => `${n} active ${n === 1 ? "problem" : "problems"}`,
});
