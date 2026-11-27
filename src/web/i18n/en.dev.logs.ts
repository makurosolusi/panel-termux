import type { LogLevel } from "@/shared/dev.types";
import { msg } from "@/shared/i18n";

/** UI strings of /dev/logs (PLAN/05 §5.4, F7). */
export const tDevLogs = msg("dev.logs", {
  title: "Panel log",
  description: "What Panel Termux itself has been doing, newest at the bottom.",
  label: "Panel log",
  level: "Minimum level",
  levels: { debug: "Debug", info: "Info", warn: "Warning", error: "Error" } satisfies Record<LogLevel, string>,
  memoryNote:
    "The log is kept in memory, up to 2,000 lines, and is cleared when the panel restarts. The full log is at",
  logPath: "$PREFIX/var/log/sv/panel/current",
  empty: "No log lines at this level yet. Pick a lower level to see more.",
  errorCodes: {
    invalid_level: "Unknown log level. Pick a level from the list.",
  },
} as const);
