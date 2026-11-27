import type { Messages } from "@/shared/i18n";
import type { tHistory } from "./en.history";
/** Indonesian strings of the monitor history: trends, heartbeat strip, problem history and the nav badge (PLAN/02 W4). */
export const idHistory: Messages<typeof tHistory> = {
  trends: {
    title: "Tren",
    description: "Rata-rata per interval dari sampel pemantauan.",
    rangeLabel: "Rentang waktu",
    range: { "24h": "24 jam", "7d": "7 hari" },
    battery: "Baterai",
    memory: "Memori tersedia",
    empty: "Grafik muncul setelah beberapa jam pemantauan.",
    noData: "Belum ada data",
    /** Screen-reader summary of one sparkline. */
    summary: (label: string, range: string, min: string, max: string, last: string) =>
      `${label} ${range} terakhir: terendah ${min}, tertinggi ${max}, terakhir ${last}.`,
    summaryEmpty: (label: string, range: string) => `${label} ${range} terakhir: belum ada data.`,
    minMax: (min: string, max: string) => `${min} – ${max}`,
  },
  heartbeat: {
    /** aria-label and phone text of the strip. */
    summary: (ok: number, total: number) => `${ok} dari ${total} cek terakhir sehat`,
    short: (ok: number, total: number) => `${ok}/${total} sehat`,
    none: "Belum dicek",
    column: "30 cek terakhir",
  },
  problems: {
    title: "Riwayat masalah",
    description: "Masalah 30 hari terakhir, terbaru di atas. Pemberitahuan dan info tidak dicatat.",
    label: "Riwayat masalah",
    empty: "Belum ada masalah dalam 30 hari terakhir.",
    emptyHint: "Masalah yang muncul dan pulih tercatat di sini.",
    cols: { problem: "Masalah", status: "Status", opened: "Mulai", duration: "Lama", notified: "Notifikasi" },
    open: "Masih terjadi",
    closed: "Pulih",
    notified: "Terkirim",
    notNotified: "–",
    ongoing: (d: string) => `${d}, masih berjalan`,
    dayLabel: (day: string, n: number) => `${day} · ${n} masalah`,
    recentTitle: "Riwayat masalah",
    recentEmpty: "Belum ada masalah dalam 30 hari terakhir.",
    viewAll: "Lihat riwayat",
    today: (clock: string) => `hari ini ${clock}`,
    yesterday: (clock: string) => `kemarin ${clock}`,
  },
  navBadge: (n: number) => `${n} masalah aktif`,
};
