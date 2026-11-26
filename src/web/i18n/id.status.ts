import type { StatusKey } from "@/web/components/status.vocab";

/** Badge label of every canonical status (PLAN/01 §3.1; frozen after W3, DECISIONS B12). */
export const idStatus = {
  running: "Berjalan",
  healthy: "Sehat",
  succeeded: "Berhasil",
  done: "Selesai",
  stopped: "Dihentikan",
  pending: "Menunggu",
  skipped: "Dilewati",
  unchecked: "Belum dicek",
  not_deployed: "Belum di-deploy",
  unknown: "Tidak diketahui",
  auth_required: "Butuh login",
  starting: "Memulai…",
  restarting: "Memulai ulang…",
  attention: "Perlu dicek",
  partial: "Sebagian gagal",
  undone: "Dibatalkan",
  not_configured: "Belum diatur",
  unstable: "Tidak stabil",
  down: "Mati",
  errored: "Bermasalah",
  failed: "Gagal",
  unhealthy: "Tidak sehat",
  rolled_back: "Dikembalikan",
  crash_loop: "Mulai ulang berulang",
  interrupted: "Terputus",
  tunnel_down: "Tunnel terputus",
  key_mismatch: "Kunci tidak cocok",
  processing: "Diproses…",
} as const satisfies Record<StatusKey, string>;

/** Help text shown next to a badge (or via `aria-describedby`) for statuses whose label alone could mislead. */
export const idStatusHelp: Partial<Record<StatusKey, string>> = {
  rolled_back: "Perubahan gagal; versi lama dipulihkan.",
  interrupted: "Panel dimulai ulang saat perubahan berjalan. Periksa lalu bersihkan.",
  auth_required: "Domain menjawab, tetapi meminta login (mis. Cloudflare Access).",
};
