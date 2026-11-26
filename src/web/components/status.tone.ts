/** Semantic colour family of a badge, dot or tile. */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

/**
 * The one status → tone table for every state string the panel shows (runit services, pm2 apps, deploy jobs,
 * job steps, backups). Unknown strings are neutral. Context-dependent cases (a service "down" that should be up)
 * are decided by the caller, which passes `tone` directly.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // healthy / finished well
  run: "success",
  online: "success",
  succeeded: "success",
  done: "success",
  ok: "success",
  // in flight
  running: "info",
  launching: "warning",
  pending: "neutral",
  finish: "warning",
  partial: "warning",
  // failure
  errored: "danger",
  failed: "danger",
  rolled_back: "danger",
  // deliberately idle / unknown
  down: "neutral",
  stopped: "neutral",
  skipped: "neutral",
  not_deployed: "neutral",
  unknown: "neutral",
};

/** Tone of a status string. */
export const toneForStatus = (status: string): StatusTone => STATUS_TONE[status] ?? "neutral";

/** Legacy panel tones (panel.status.ts) → semantic tones, so old call sites render with the new palette. */
export const LEGACY_TONE = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  muted: "neutral",
} as const satisfies Record<string, StatusTone>;

/** Text + subtle background + border classes per tone (AA contrast pairs, see styles.css). */
export const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-success/25 bg-success-subtle text-success",
  warning: "border-warning/25 bg-warning-subtle text-warning",
  danger: "border-danger/25 bg-danger-subtle text-danger",
  info: "border-info/25 bg-info-subtle text-info",
  neutral: "border-border bg-muted text-muted-foreground",
  accent: "border-brand-text/25 bg-brand-subtle text-brand-text",
};

/** Solid colour class per tone for dots, progress fills and icons. */
export const TONE_FILL: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground",
  accent: "bg-brand",
};
