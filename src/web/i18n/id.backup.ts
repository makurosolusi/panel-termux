import type { BackupItem, BackupRunStatus, BackupTrigger } from "@/shared/backup.types";
import type { BackupSummary } from "@/web/backup/backup.state";

/** Indonesian strings of the /panel/backups page (merged into `id.backup`). Term: "Cadangan" (backup). */
export const idBackup = {
  section: "Cadangan",
  title: "Cadangan",
  errorCodes: {
    busy: "Pencadangan lain sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
    not_configured: "Pencadangan belum diatur. Isi pengaturan penyimpanan R2/S3 di Administrasi → Pengaturan.",
  },
  status: {
    title: "Status",
    summaries: {
      not_configured: "Belum diatur",
      running: "Sedang mencadangkan",
      last_failed: "Pencadangan terakhir gagal",
      last_partial: "Pencadangan terakhir sebagian gagal",
      never: "Belum pernah dicadangkan",
      ok: "Normal",
    } satisfies Record<BackupSummary, string>,
    missing: "Pengaturan yang belum diisi:",
    settingsLink: "Buka Administrasi → Pengaturan",
    askSuperAdmin: "Minta Super Admin mengisi pengaturan ini.",
    schedule: "Jadwal",
    scheduleAt: (hour: number) => `Tiap hari pukul ${String(hour).padStart(2, "0")}.00`,
    scheduleOff: "Tidak terjadwal",
    nextRun: "Berikutnya",
    retention: "Disimpan selama",
    retentionDays: (n: number) => `${n} hari`,
    lastRun: "Terakhir",
    never: "Belum pernah",
    running: "Sedang mencadangkan…",
  },
  run: {
    button: "Cadangkan sekarang",
    started: "Pencadangan dimulai.",
  },
  runs: {
    title: "Riwayat cadangan",
    items: (n: number) => `${n} file`,
    expand: "Tampilkan file",
    collapse: "Sembunyikan file",
    download: "Unduh",
    restore: "Perintah pemulihan",
    copy: "Salin perintah pemulihan",
    copied: "Perintah disalin.",
    copyFailed: "Perintah tidak bisa disalin otomatis. Pilih teksnya lalu salin manual.",
    noSize: "–",
    empty: "Belum ada cadangan. Klik Cadangkan sekarang untuk membuat cadangan pertama.",
    triggers: { schedule: "Terjadwal", manual: "Manual" } satisfies Record<BackupTrigger, string>,
    kinds: {
      database: "Database",
      globals: "Role Postgres",
      panel: "Database panel",
      sites: "File situs",
      cloudflared: "Konfigurasi tunnel",
      secrets: "Kunci rahasia",
      checksums: "Daftar checksum",
      manifest: "Daftar isi",
    } satisfies Record<BackupItem["kind"], string>,
    statuses: {
      running: "Berjalan",
      succeeded: "Berhasil",
      failed: "Gagal",
      partial: "Sebagian gagal",
    } satisfies Record<BackupRunStatus, string>,
  },
} as const;
