import type { Messages } from "@/shared/i18n";
import type { tShell } from "./en.shell";
/** Indonesian strings of the shell that `/` also needs (overlay of `tShell`); the rest is `idLayout`. */
export const idShell: Messages<typeof tShell> = {
  nav: {
    overview: "Ringkasan",
    sites: "Situs",
    jobs: "Riwayat perubahan",
    services: "Layanan",
    apps: "Aplikasi",
    domains: "Domain",
    databases: "Database",
    backups: "Cadangan",
    health: "Kesehatan sistem",
    users: "Pengguna",
    audit: "Audit",
    logs: "Log",
    settings: "Pengaturan",
    profile: "Profil",
  },
  account: "Menu akun",
  time: {
    justNow: "baru saja",
    ago: (s: string) => `${s} lalu`,
    in: (s: string) => `dalam ${s}`,
    yesterday: "kemarin",
    days: (n: number) => `${n} hari`,
    refresh: "Muat ulang",
    live: "Pembaruan otomatis aktif",
    stale: "Gagal memperbarui",
  },
  load: { cores: (n: number) => `${n} inti` },
  copy: { copy: "Salin", copied: "Tersalin", failed: "Tidak bisa menyalin. Salin manual dari teks di atas." },
  chunkError: {
    title: "Bagian panel ini gagal dimuat",
    body: "Biasanya karena panel baru diperbarui atau koneksi terputus. Muat ulang halaman untuk memakai versi terbaru.",
    reload: "Muat ulang halaman",
    offlineTitle: "Server panel tidak terjangkau",
    offlineBody:
      "Bagian panel ini belum bisa dimuat karena server panel tidak menjawab. Periksa koneksi internet dan pastikan panel di HP masih berjalan, lalu coba lagi.",
  },
  publicNotFound: {
    title: "Halaman tidak ditemukan",
    body: "Alamat ini tidak ada di Panel Termux.",
    home: "Ke beranda",
    signIn: "Masuk",
  },
} as const;
