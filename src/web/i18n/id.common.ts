import type { Messages } from "@/shared/i18n";
import type { tCommon } from "./en.common";
/** Indonesian strings shared by every section (imported directly, DECISIONS B30). Wording follows docs/content-guide.md. */
export const idCommon: Messages<typeof tCommon> = {
  retry: "Coba lagi",
  cancel: "Batal",
  close: "Tutup",
  /** "Diperbarui 3 mnt lalu" — replaces the static "Diperbarui otomatis tiap N detik" lines; relative pieces live in `id.shell.time`. */
  updatedAgo: (rel: string) => `Diperbarui ${rel}`,
  /** Short heading per ApiErrorKind (ErrorState title); the sentence below it comes from `errors`. */
  errorTitles: {
    network: "Tidak bisa terhubung ke server",
    unauthorized: "Sesi kamu sudah berakhir",
    access: "Perlu masuk lewat Cloudflare Access",
    forbidden: "Kamu tidak punya akses",
    client: "Permintaan tidak berhasil",
    server: "Server sedang bermasalah",
  },
  /** Next step only, shown under `errorTitles` (the title already says what happened). */
  errorSteps: {
    network: "Periksa koneksi internet, lalu coba lagi.",
    unauthorized: "Mengalihkan ke halaman masuk…",
    access:
      "Buka alamat panel langsung di address bar untuk masuk lewat Access. Bila tetap ditolak, minta admin memastikan email kamu diizinkan di kebijakan Access.",
    forbidden: "Minta Super Admin mengubah peranmu bila perlu.",
    server: "Coba lagi beberapa saat lagi.",
  },
  genericError: "Permintaan tidak berhasil. Coba lagi; bila terus gagal, muat ulang halaman.",
} as const;
