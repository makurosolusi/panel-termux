import type { LogLevel } from "@/shared/dev.types";
import type { Messages } from "@/shared/i18n";
import type { tDevLogs } from "./en.dev.logs";

/** Indonesian strings of /dev/logs (`id.dev.logs`, PLAN/05 §5.4, F7). */
export const idDevLogs: Messages<typeof tDevLogs> = {
  title: "Log panel",
  description: "Catatan kerja Panel Termux sendiri, terbaru di bawah.",
  label: "Log panel",
  level: "Level minimal",
  levels: { debug: "Debug", info: "Info", warn: "Peringatan", error: "Kesalahan" } satisfies Record<LogLevel, string>,
  memoryNote: "Log disimpan di memori, maks 2.000 baris, dan hilang saat panel dimulai ulang. Log lengkap ada di",
  logPath: "$PREFIX/var/log/sv/panel/current",
  empty: "Belum ada log di level ini. Pilih level yang lebih rendah untuk melihat lebih banyak.",
  errorCodes: {
    invalid_level: "Level log tidak dikenal. Pilih level dari daftar.",
  },
} as const;
