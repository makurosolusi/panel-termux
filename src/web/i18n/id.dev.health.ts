import type { HealthStatus } from "@/shared/dev.types";
import type { PanelMode } from "@/shared/panel.types";

/** Indonesian strings of /dev Kesehatan sistem (`id.dev.health`, PLAN/05 §5.1). */
export const idDevHealth = {
  title: "Kesehatan sistem",
  description: "Kondisi Panel Termux di HP ini: pemeriksaan, sumber daya, dan proses latar.",
  verdict: { ok: "Sehat", warn: "Perlu perhatian", fail: "Bermasalah" } satisfies Record<HealthStatus, string>,
  verdictOk: "Semua pemeriksaan lolos. Tidak ada yang perlu kamu lakukan.",
  problemLink: "Lihat detail",
  checks: {
    errors: {
      ok: "Tidak ada kesalahan tak tertangani dalam 5 menit.",
      warn: (n: number) => `${n} kesalahan tak tertangani dalam 5 menit.`,
      fail: (n: number) => `${n} kesalahan tak tertangani dalam 5 menit. Lihat log kesalahan.`,
      link: "Lihat log kesalahan",
    },
    sampler: {
      ok: (ago: string) => `Pemantauan berjalan, sampel terakhir ${ago}.`,
      warn: (ago: string) =>
        `Pemantauan terlambat: sampel terakhir ${ago}. HP mungkin sedang menahan Termux (optimasi baterai).`,
      waiting: "Menunggu sampel pertama.",
    },
    fake_on_https: {
      ok: "Panel membaca data dari HP.",
      fail: "Panel berjalan dengan data contoh, bukan data HP, karena runit (`sv`) tidak ditemukan.",
    },
    backup_scheduler: {
      ok: (ago: string) => `Penjadwal cadangan berjalan, terakhir ${ago}.`,
      warn: (ago: string) => `Penjadwal cadangan terlambat: terakhir ${ago}. HP mungkin sedang menahan Termux.`,
      waiting: "Penjadwal cadangan belum berjalan sejak panel menyala.",
    },
  },
  info: {
    title: "Informasi",
    description: "Tidak menurunkan status kesehatan, tapi sebaiknya diselesaikan.",
    backup_not_configured: "Cadangan belum diatur. Atur di panduan penyiapan.",
    access_not_seen: "Cloudflare Access belum terdeteksi. Siapa pun dengan akun Google bisa masuk sebagai Pengguna.",
    open: "Buka panduan penyiapan",
  },
  fakeMode: "Mode demo",
  backupUnreadable: "Pengaturan cadangan tidak bisa dibaca. Kunci data mungkin berubah; periksa bagian Keamanan.",
  tiles: {
    since: (at: string) => `Sejak ${at}`,
    memory: "Memori",
    heap: (mb: number) => `Memori JS (heap) ${mb} MB`,
    disk: "Penyimpanan",
    diskFree: (free: string, total: string) => `${free} bebas dari ${total}`,
    requests: "Request/menit",
    requests5xx: (n: number) => `5xx dalam 5 menit: ${n}`,
  },
  background: {
    title: "Proses latar",
    sampler: "Pemantauan",
    scheduler: "Penjadwal cadangan",
    nextBackup: "Cadangan berikutnya",
    backupOff: "Jadwal cadangan mati",
    job: "Perubahan berjalan",
    noJob: "Tidak ada perubahan yang berjalan.",
    never: "Belum pernah",
  },
  lastErrors: {
    title: "Kesalahan terakhir",
    empty: "Tidak ada kesalahan sejak panel menyala.",
    all: "Lihat semua log kesalahan",
  },
  security: { title: "Keamanan", description: "Kunci data dan sesi masuk semua pengguna." },
  detail: {
    title: "Detail",
    version: "Versi",
    schema: "Skema database",
    mode: "Mode",
    modes: { termux: "Termux", fake: "Mode demo" } satisfies Record<PanelMode, string>,
    runtime: "Runtime",
    cpuCores: "Inti CPU",
    db: "Ukuran database panel",
    counts: "Pengguna · sesi",
  },
  /** Uptime tile label (glossary: Waktu aktif). */
  uptime: "Waktu aktif",
  /** "3 pengguna · 5 sesi aktif". */
  countsDetail: (users: number, sessions: number) => `${users} pengguna · ${sessions} sesi aktif`,
} as const;
