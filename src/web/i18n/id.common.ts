/** Indonesian strings shared by every section (merged into `id.common`). */
export const idCommon = {
  retry: "Coba lagi",
  cancel: "Batal",
  empty: "Belum ada data.",
  errors: {
    network: "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.",
    unauthorized: "Sesi berakhir. Mengalihkan ke halaman masuk…",
    access:
      "Sesi Cloudflare Access belum ada atau sudah habis. Buka alamat panel langsung di address bar lalu login Access, atau minta admin memastikan email kamu diizinkan di kebijakan Access.",
    forbidden: "Kamu tidak punya akses ke halaman ini.",
    server: "Server mengalami gangguan. Coba lagi nanti.",
    generic: "Permintaan gagal.",
  },
} as const;
