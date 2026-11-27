import type { Messages } from "@/shared/i18n";
import type { tSession } from "./en.session";
/** Indonesian strings of the session loader screens (entry chunk: shown before any page loads). */
export const idSession: Messages<typeof tSession> = {
  loading: "Memuat sesi…",
  errorTitle: "Tidak bisa terhubung ke Panel Termux",
  retry: "Coba lagi",
  errorBody: "Sesi kamu tidak bisa dimuat. Periksa koneksi internet dan pastikan HP server menyala, lalu coba lagi.",
  serverTitle: "Panel Termux sedang bermasalah",
  serverBody: "Server menjawab dengan galat. Coba lagi beberapa saat lagi; bila berulang, periksa log panel di HP.",
} as const;
