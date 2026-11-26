/** Indonesian strings shared by every section (merged into `id.common`). Wording follows docs/content-guide.md. */
export const idCommon = {
  retry: "Coba lagi",
  cancel: "Batal",
  save: "Simpan",
  close: "Tutup",
  delete: "Hapus",
  copy: "Salin",
  loading: "Memuat…",
  empty: "Belum ada yang bisa ditampilkan di sini.",
  /** "Diperbarui 3 mnt lalu" — replaces the static "Diperbarui otomatis tiap N detik" lines; relative pieces live in `id.shell.time`. */
  updatedAgo: (rel: string) => `Diperbarui ${rel}`,
  /** Duration unit labels: "7 mnt 17 dtk", "1 hari 9 jam". */
  units: { day: "hari", hour: "jam", minute: "mnt", second: "dtk" },
  /** Short heading per ApiErrorKind (ErrorState title); the sentence below it comes from `errors`. */
  errorTitles: {
    network: "Tidak bisa terhubung ke server",
    unauthorized: "Sesi kamu sudah berakhir",
    access: "Perlu masuk lewat Cloudflare Access",
    forbidden: "Kamu tidak punya akses",
    client: "Permintaan tidak berhasil",
    server: "Server sedang bermasalah",
  },
  errors: {
    network: "Tidak bisa terhubung ke server. Periksa koneksi internet, lalu coba lagi.",
    unauthorized: "Sesi kamu sudah berakhir. Mengalihkan ke halaman masuk…",
    access:
      "Sesi Cloudflare Access belum ada atau sudah berakhir. Buka alamat panel langsung di address bar untuk masuk lewat Access. Bila tetap ditolak, minta admin memastikan email kamu diizinkan di kebijakan Access.",
    forbidden: "Peran kamu tidak punya akses ke halaman ini. Minta Super Admin mengubah peranmu bila perlu.",
    server: "Server sedang mengalami gangguan. Coba lagi beberapa saat lagi.",
    generic: "Permintaan tidak berhasil. Coba lagi; bila terus gagal, muat ulang halaman.",
  },
} as const;
