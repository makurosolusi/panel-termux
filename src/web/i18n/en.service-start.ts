import { msg } from "@/shared/i18n";

/** UI strings of the "Start pm2/postgres" button (PLAN/06 §6.1), imported directly (DECISIONS B30). */
export const tServiceStart = msg("service-start", {
  label: (service: string) => `Start ${service}`,
  starting: "Starting…",
  started: (service: string) => `${service} is running again and starts automatically when the phone restarts.`,
  /** The start went through but runit reports the service still down (e.g. it exits right away). */
  notRunning: (service: string) => `${service} won't stay running. Check its log on the Services page.`,
} as const);
