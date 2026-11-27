import type { DataKeyResetInput } from "@/shared/security.types";

/** Indonesian strings of the security cards on Administrasi → Kesehatan sistem (PLAN/04 §5.2–5.3). */
export const idSecurity = {
  errorCodes: {
    reauth_required: "Untuk aksi ini kamu perlu masuk ulang (sesi lebih dari 15 menit).",
    key_mismatch: "Kunci data tidak cocok, jadi kunci data tidak bisa diunduh. Perbaiki kuncinya dulu.",
    key_ok: "Semua pengaturan rahasia sudah terbaca, jadi tidak ada yang perlu dihapus. Muat ulang halaman.",
    confirm_mismatch: "Kata yang diketik tidak sama. Ketik hapus persis.",
  },
  dataKey: {
    title: "Kunci data",
    help: "Kunci data (data/secret) mengunci pengaturan rahasia dan sesi. Tanpa file ini, pengaturan rahasia di cadangan panel tidak bisa dibaca. Simpan salinannya di luar HP.",
    state: "Status",
    ok: "Cocok",
    mismatch: "Tidak cocok",
    mismatchBody:
      "Pengaturan di bawah disimpan dengan kunci data lain, biasanya karena file kunci hilang atau diganti. Pengaturan rahasia tidak bisa disimpan sampai ini diperbaiki.",
    noTelegram: "Notifikasi Telegram tidak terkirim sampai kunci diperbaiki, karena tokennya ikut terkunci.",
    createdThisBoot: "File kunci data dibuat baru saat panel terakhir dimulai.",
    restoreFile: "Cara terbaik: kembalikan file kunci data lama, lalu mulai ulang panel.",
    restoreSteps: [
      "SVDIR=$PREFIX/var/service sv down panel",
      "cp <file-lama> ~/panel/data/secret && chmod 600 ~/panel/data/secret",
      "SVDIR=$PREFIX/var/service sv up panel",
    ],
    restoreStepsLabel: "Cara manual (untuk pengguna teknis)",
    orReset: "Bila file lama tidak ada lagi, hapus pengaturan rahasia lama lalu isi ulang di Pengaturan.",
    exportButton: "Unduh kunci data",
    exportTitle: "Unduh kunci data?",
    exportBody:
      "File ini membuka semua pengaturan rahasia panel. Setelah terunduh, pindahkan dari folder Unduhan ke pengelola kata sandi, lalu hapus dari Unduhan. Jangan simpan di HP ini atau di bucket cadangan.",
    exported: "Kunci data diunduh.",
    exportedAt: "Terakhir diunduh",
    never: "Belum pernah",
    resetButton: "Hapus pengaturan rahasia lama",
    resetTitle: "Hapus pengaturan rahasia yang tidak terbaca?",
    resetBody: (labels: string[]) =>
      `${labels.join(", ")} dihapus dan harus kamu isi ulang di Pengaturan. Tidak bisa dibatalkan. Bila kamu masih punya file kunci data lama, kembalikan file itu saja.`,
    resetDone: "Pengaturan rahasia lama dihapus. Isi ulang di Pengaturan.",
    resetWord: "hapus" satisfies DataKeyResetInput["confirm"],
  },
  reauth: {
    body: "Untuk aksi ini kamu perlu masuk ulang (sesi lebih dari 15 menit).",
    button: "Masuk ulang",
    freshNote:
      "Masuk ulang mencegah pemakaian cookie curian di perangkat lain, bukan akun Google yang diambil alih. Aktifkan verifikasi 2 langkah di akun Google-mu.",
  },
  access: {
    title: "Cloudflare Access",
    notHttps: "Tidak berlaku (alamat panel bukan https)",
    seen: "Terdeteksi",
    notSeen: "Belum terdeteksi. Path privat mungkin terbuka tanpa Access. Ikuti langkah 4 di README.",
  },
  sessions: {
    revokeUser: "Keluarkan dari semua perangkat",
    revokeUserTitle: (name: string) => `Keluarkan ${name} dari semua perangkat?`,
    revokeUserBody: "Ia harus masuk lagi. Perannya tidak berubah.",
    title: "Sesi",
    summary: (s: number, u: number) =>
      `${s} sesi aktif dari ${u} pengguna. Sesi berakhir paling lama 30 hari setelah masuk.`,
    revokeAll: "Keluarkan semua pengguna",
    revokeAllTitle: "Keluarkan semua pengguna?",
    revokeAllBody: "Semua orang, termasuk kamu di perangkat lain, harus masuk lagi. Sesi di perangkat ini tetap.",
    revokedAll: (n: number) => `${n} sesi diakhiri.`,
  },
  adminTrust:
    "Admin punya kendali penuh atas HP ini. Admin bisa deploy program yang berjalan dengan akses yang sama seperti panel, sehingga bisa membaca semua file, database, dan kunci data, lalu menjadikan dirinya Super Admin. Program situs yang kamu deploy juga punya akses yang sama. Berikan peran Admin hanya ke orang yang kamu percayai seperti pemilik HP.",
} as const;
