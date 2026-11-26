import type { HealthStatus } from "@/shared/dev.types";

/** Indonesian strings of /dev Kesehatan sistem (`id.dev.health`, PLAN/05 §5.1). */
export const idDevHealth = {
  title: "Kesehatan sistem",
  verdict: { ok: "Sehat", warn: "Perlu perhatian", fail: "Bermasalah" } satisfies Record<HealthStatus, string>,
  checks: {
    errors: {
      ok: "Tidak ada kesalahan tak tertangani dalam 5 menit.",
      warn: (n: number) => `${n} kesalahan tak tertangani dalam 5 menit.`,
      fail: (n: number) => `${n} kesalahan tak tertangani dalam 5 menit. Lihat log kesalahan.`,
    },
    sampler: {
      ok: (ago: string) => `Pemantauan berjalan, sampel terakhir ${ago}.`,
      warn: (ago: string) =>
        `Pemantauan terlambat: sampel terakhir ${ago}. HP mungkin sedang menahan Termux (optimasi baterai).`,
      waiting: "Menunggu sampel pertama.",
    },
    fake_on_https: {
      fail: "Panel berjalan dengan data contoh, bukan data HP. Periksa apakah `sv` ada di Termux.",
    },
    backup_scheduler: {
      ok: (ago: string) => `Penjadwal cadangan berjalan, terakhir ${ago}.`,
      warn: (ago: string) => `Penjadwal cadangan terlambat: terakhir ${ago}. HP mungkin sedang menahan Termux.`,
    },
  },
  info: {
    title: "Informasi",
    backup_not_configured: "Cadangan belum diatur. Atur di panduan penyiapan.",
    access_not_seen: "Cloudflare Access belum terdeteksi. Siapa pun dengan akun Google bisa masuk sebagai Pengguna.",
  },
  fakeMode: "Mode demo",
  staleData: (ago: string) => `Gagal memperbarui. Data terakhir ${ago}.`,
  backupUnreadable: "Pengaturan cadangan tidak bisa dibaca. Kunci data mungkin berubah; periksa Pengaturan.",
  background: {
    title: "Proses latar",
    sampler: "Pemantauan",
    nextBackup: "Cadangan berikutnya",
    backupOff: "Jadwal cadangan mati",
    job: "Perubahan berjalan",
    noJob: "Tidak ada perubahan yang berjalan.",
  },
  lastErrors: {
    title: "Kesalahan terakhir",
    empty: "Tidak ada kesalahan sejak panel menyala.",
    all: "Lihat semua log kesalahan",
  },
  detail: "Detail",
  mode: "Mode",
  cpuCores: "Inti CPU",
  requests: "Request/menit",
  requests5xx: (n: number) => `5xx: ${n}`,
  // 0.2.x keys still read by health.page.tsx until the W5 redesign.
  refreshing: "Diperbarui otomatis tiap 15 detik",
  version: "Versi",
  schema: (v: string) => `Skema database ${v}`,
  uptime: "Waktu aktif",
  since: (at: string) => `Sejak ${at}`,
  memory: "Memori",
  heap: (mb: number) => `Memori JS (heap) ${mb} MB`,
  db: "Ukuran database panel",
  disk: "Penyimpanan data",
  diskFree: (free: string, total: string) => `${free} bebas dari ${total}`,
  counts: "Pengguna terdaftar",
  users: "pengguna",
  sessions: "sesi aktif",
  /** Subline of the users card: "3 pengguna · 5 sesi aktif". */
  countsDetail: (users: number, sessions: number) => `${users} pengguna · ${sessions} sesi aktif`,
  runtime: "Runtime",
} as const;
