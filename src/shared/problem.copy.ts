// Indonesian text of every ProblemCode, shared by the Ringkasan (web) and Telegram (server) so both say the same
// thing (PLAN/02 K2 §5.7). A deliberate exception to "UI strings live in i18n": the server needs the same words.
import { formatBytes, formatDuration, formatNumber, formatTemperature } from "./format.id";
import type { AlertErrorCode, Problem, ProblemCode } from "./monitor.types";

/** The part of a Problem the copy reads. */
export type ProblemText = Pick<Problem, "code" | "target" | "params">;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** How a backup item reads mid-sentence; only databases have a meaningful own name (the others are fixed ids). */
const BACKUP_ITEM: Partial<Record<string, string>> = {
  globals: "role Postgres",
  panel: "database panel",
  sites: "file situs",
  cloudflared: "konfigurasi tunnel",
  secrets: "kunci rahasia",
};

type Copy = { title: (p: ProblemText) => string; detail: (p: ProblemText) => string };

function domainReason({ params }: ProblemText): string {
  const local = num(params.local);
  const port = num(params.port);
  if (num(params.status) === 530) return "Cloudflare tidak terhubung ke tunnel cloudflared di HP.";
  if (local !== null) return `Aplikasi di HP menjawab ${local}, jadi masalahnya di tunnel.`;
  return port !== null ? `Aplikasi di port ${port} tidak menjawab.` : "Domain tidak menjawab dari internet.";
}

const ALERT_REASON: Partial<Record<AlertErrorCode, string>> = {
  telegram_token_invalid: "Token bot ditolak Telegram. Periksa token di Pengaturan.",
  telegram_chat_not_found: "Chat tujuan tidak ditemukan. Kirim pesan ke bot, lalu pilih chat lagi.",
  telegram_forbidden: "Bot diblokir atau dikeluarkan dari grup.",
  telegram_conflict: "Bot sedang dipakai aplikasi lain (webhook).",
};
const ALERT_REASON_OTHER = "Telegram tidak bisa dijangkau dari HP.";

const COPY: Record<ProblemCode, Copy> = {
  service_down: {
    title: (p) => `Layanan ${p.target} mati`,
    detail: (p) => {
      const sec = num(p.params.downSec);
      return sec === null ? "Seharusnya berjalan." : `Seharusnya berjalan. Mati sejak ${formatDuration(sec)}.`;
    },
  },
  service_crash_loop: {
    title: (p) => `Layanan ${p.target} terus dimulai ulang`,
    detail: (p) => `runit menyalakannya lagi tapi langsung berhenti. Lihat log ${p.target}.`,
  },
  pm2_unavailable: {
    title: () => "pm2 tidak berjalan",
    detail: () => "Semua aplikasi ikut tidak berjalan. Mulai layanan pm2.",
  },
  app_errored: {
    title: (p) => `Aplikasi ${p.target} bermasalah`,
    detail: (p) =>
      `pm2 berhenti mencoba setelah ${formatNumber(num(p.params.restarts) ?? 0)}× gagal. Lihat log stderr.`,
  },
  app_crash_loop: {
    title: (p) => `Aplikasi ${p.target} terus dimulai ulang`,
    detail: (p) => `${formatNumber(num(p.params.restarts10m) ?? 0)}× dalam 10 mnt terakhir. Lihat log stderr.`,
  },
  domain_unreachable: { title: (p) => `${p.target} tidak bisa dijangkau`, detail: domainReason },
  domain_http_error: { title: (p) => `${p.target} menjawab HTTP ${str(p.params.status)}`, detail: domainReason },
  internet_down: {
    title: () => "HP tidak terhubung ke internet",
    detail: () => "Semua domain tidak bisa dijangkau dari HP. Notifikasi terkirim setelah koneksi pulih.",
  },
  backup_not_configured: {
    title: () => "Cadangan belum diatur",
    detail: () => "Tanpa cadangan, data situs hilang bila HP rusak. Atur penyimpanan R2/S3.",
  },
  backup_failed: {
    title: () => "Cadangan terakhir gagal",
    detail: () => "Lihat detailnya di halaman Cadangan.",
  },
  backup_partial: {
    title: () => "Cadangan terakhir hanya sebagian berhasil",
    detail: () => "Lihat item yang gagal di halaman Cadangan.",
  },
  backup_stale: {
    title: (p) => `Tidak ada cadangan dalam ${formatNumber(num(p.params.hours) ?? 0)} jam terakhir`,
    detail: () => "Cadangan harian mungkin tidak berjalan.",
  },
  backup_item_stale: {
    title: (p) => {
      const hours = num(p.params.hours);
      const name = BACKUP_ITEM[str(p.params.itemKind)] ?? str(p.params.name);
      return hours === null
        ? `Cadangan ${name} belum pernah berhasil`
        : `Cadangan ${name} sudah ${formatNumber(hours)} jam tidak berhasil`;
    },
    detail: () => "Item ini gagal di cadangan terakhir. Lihat halaman Cadangan.",
  },
  backup_status_error: {
    title: () => "Status cadangan tidak bisa dibaca",
    detail: () => "Buka Kesehatan sistem untuk melihat penyebabnya.",
  },
  backup_secrets_included: {
    title: () => "Cadangan menyertakan rahasia",
    detail: () => "Token dan kunci ikut tersimpan di bucket. Jaga akses ke bucket, atau matikan di Pengaturan.",
  },
  key_mismatch: {
    title: () => "Kunci data tidak cocok",
    detail: () => "Pengaturan rahasia tidak bisa dibuka. Buka Kesehatan sistem → Kunci data.",
  },
  access_not_seen: {
    title: () => "Cloudflare Access tidak terlihat",
    detail: () => "Panel dibuka tanpa melewati Cloudflare Access. Periksa aturan Access.",
  },
  disk_low: {
    title: () => "Penyimpanan hampir penuh",
    detail: (p) =>
      `Tinggal ${formatNumber(num(p.params.freePct) ?? 0, 1)}% (${formatBytes(num(p.params.freeBytes) ?? 0)}) bebas.`,
  },
  battery_low: {
    title: (p) => `Baterai tinggal ${formatNumber(num(p.params.percent) ?? 0)}% dan tidak mengisi`,
    detail: () => "Server ikut mati bila baterai habis. Colokkan charger.",
  },
  battery_hot: {
    title: (p) => `Baterai panas (${formatTemperature(num(p.params.temperatureC))})`,
    detail: () => "Pindahkan HP ke tempat sejuk atau lepas casingnya.",
  },
  alerts_failing: {
    title: () => "Notifikasi Telegram gagal terkirim",
    detail: (p) => ALERT_REASON[str(p.params.reason) as AlertErrorCode] ?? ALERT_REASON_OTHER,
  },
  site_job_failed: {
    title: (p) => `Perubahan situs ${p.target} belum selesai`,
    detail: () => "Buka perubahan ini untuk membersihkan atau mengulang.",
  },
  host_rebooted: {
    title: () => "HP baru saja menyala ulang",
    detail: (p) =>
      `Aktif ${formatNumber(num(p.params.uptimeMin) ?? 0)} mnt. Periksa apakah semua layanan sudah berjalan.`,
  },
  panel_restarted_unexpectedly: {
    title: () => "Panel sempat berhenti tak terduga",
    detail: () => "Panel tidak dimatikan dengan rapi (mungkin dihentikan Android).",
  },
};

/** One-line headline of a problem. */
export const title = (p: ProblemText): string => COPY[p.code].title(p);

/** What it means / what to do, one or two sentences. */
export const detail = (p: ProblemText): string => COPY[p.code].detail(p);

/** Recovery line without the "PULIH" label: "{title} · berlangsung {durasi}" (internet has its own sentence). */
export function recovered(p: ProblemText, durationSec: number): string {
  if (p.code === "internet_down") return `HP sempat tidak terhubung internet selama ${formatDuration(durationSec)}`;
  return `${title(p)} · berlangsung ${formatDuration(durationSec)}`;
}

/** Recovery line for a problem that ended while the panel was not running (PLAN/02 §4.6 step 3). */
export const recoveredWhileOffline = (p: ProblemText, lastSeenAgoSec: number): string =>
  `${title(p)} · pulih saat panel tidak berjalan (terakhir terlihat ${formatDuration(lastSeenAgoSec)} lalu)`;
