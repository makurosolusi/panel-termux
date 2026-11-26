import type { BackupItem, BackupRunStatus, BackupTrigger } from "@/shared/backup.types";
import type { BackupSummary } from "@/web/backup/backup.state";

/** Indonesian strings of the /panel/backups page (merged into `id.backup`). */
export const idBackup = {
  section: "Backup",
  title: "Backup",
  errorCodes: {
    busy: "Backup sedang berjalan. Tunggu sampai selesai.",
    not_configured: "Backup belum dikonfigurasi.",
  },
  status: {
    title: "Status",
    summaries: {
      not_configured: "Belum dikonfigurasi",
      running: "Sedang berjalan",
      last_failed: "Backup terakhir gagal",
      last_partial: "Backup terakhir sebagian gagal",
      never: "Belum pernah backup",
      ok: "Normal",
    } satisfies Record<BackupSummary, string>,
    missing: "Pengaturan yang belum diisi:",
    settingsLink: "Buka Dev → Pengaturan",
    askSuperAdmin: "Minta super admin mengisi pengaturan ini.",
    schedule: "Jadwal",
    scheduleAt: (hour: number) => `Tiap hari pukul ${String(hour).padStart(2, "0")}.00`,
    scheduleOff: "Tidak terjadwal",
    nextRun: "Berikutnya",
    retention: "Disimpan",
    retentionDays: (n: number) => `${n} hari`,
    lastRun: "Terakhir",
    never: "Belum pernah",
    running: "Backup sedang berjalan…",
  },
  run: {
    button: "Backup sekarang",
    started: "Backup dimulai.",
  },
  runs: {
    title: "Riwayat backup",
    items: (n: number) => `${n} item`,
    expand: "Tampilkan item",
    collapse: "Sembunyikan item",
    download: "Unduh",
    restore: "Perintah restore",
    copy: "Salin perintah restore",
    copied: "Perintah disalin.",
    copyFailed: "Gagal menyalin.",
    noSize: "–",
    triggers: { schedule: "Terjadwal", manual: "Manual" } satisfies Record<BackupTrigger, string>,
    kinds: { database: "Database", panel: "Panel" } satisfies Record<BackupItem["kind"], string>,
    statuses: {
      running: "Berjalan",
      succeeded: "Berhasil",
      failed: "Gagal",
      partial: "Sebagian gagal",
    } satisfies Record<BackupRunStatus, string>,
  },
} as const;
