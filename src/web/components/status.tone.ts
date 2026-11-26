/** Semantic colour family of a badge, dot or tile. */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

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

/** Text colour class per tone for values and icons. */
export const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
  accent: "text-brand-text",
};
