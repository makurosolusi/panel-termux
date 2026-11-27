import type { Messages } from "@/shared/i18n";
import type { tServiceStart } from "./en.service-start";
/** Indonesian strings of the "Jalankan pm2/postgres" button (PLAN/06 §6.1), imported directly (DECISIONS B30). */
export const idServiceStart: Messages<typeof tServiceStart> = {
  label: (service: string) => `Jalankan ${service}`,
  starting: "Menjalankan…",
  started: (service: string) => `${service} berjalan lagi dan menyala otomatis saat HP dinyalakan ulang.`,
  /** The start went through but runit reports the service still down (e.g. it exits right away). */
  notRunning: (service: string) => `${service} belum mau berjalan. Lihat log layanannya di halaman Layanan.`,
} as const;
