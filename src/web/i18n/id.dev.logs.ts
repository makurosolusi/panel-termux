import type { LogLevel } from "@/shared/dev.types";

/** Indonesian strings of /dev/logs (`id.dev.logs`, PLAN/05 §5.4, F7). */
export const idDevLogs = {
  title: "Log panel",
  level: "Level",
  levels: { debug: "Debug", info: "Info", warn: "Peringatan", error: "Kesalahan" } satisfies Record<LogLevel, string>,
  searchPlaceholder: "Cari teks di log…",
  autoRefresh: "Perbarui otomatis",
  memoryNote:
    "Log disimpan di memori, maks 2.000 baris, dan hilang saat panel dimulai ulang. Log lengkap ada di `$PREFIX/var/log/sv/panel/current`.",
  empty: "Belum ada log untuk filter ini. Ubah level atau kata kunci pencarian.",
} as const;
