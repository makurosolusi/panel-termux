// Indonesian problem copy (PLAN/08 §5): the overlay of `tProblem` for the web pack and the `id` copy of the server's
// `problemCopy`. Only `import type` from problem.copy.en.ts, so English never lands in the pack through this file.
import { formatBytes, formatDuration, formatNumber, formatTemperature } from "./format.number";
import type { AlertErrorCode, ProblemParams } from "./monitor.types";
import type { ProblemCopy } from "./problem.copy.en";
import { num, str } from "./problem.copy.params";

const BACKUP_ITEM: Partial<Record<string, string>> = {
  globals: "role Postgres",
  panel: "database panel",
  sites: "file situs",
  cloudflared: "konfigurasi tunnel",
  secrets: "kunci rahasia",
};

function domainReason(_target: string, params: ProblemParams): string {
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

const n0 = (v: unknown) => formatNumber(num(v) ?? 0, 0, "id");

/** Indonesian problem copy, same shape and arity as `tProblem`. */
export const idProblem: ProblemCopy = {
  codes: {
    service_down: {
      title: (target: string) => `Layanan ${target} mati`,
      detail: (_target: string, params: ProblemParams) => {
        const sec = num(params.downSec);
        return sec === null ? "Seharusnya berjalan." : `Seharusnya berjalan. Mati sejak ${formatDuration(sec, "id")}.`;
      },
    },
    service_crash_loop: {
      title: (target: string) => `Layanan ${target} terus dimulai ulang`,
      detail: (target: string) => `runit menyalakannya lagi tapi langsung berhenti. Lihat log ${target}.`,
    },
    pm2_unavailable: {
      title: () => "pm2 tidak berjalan",
      detail: () => "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti.",
    },
    app_errored: {
      title: (target: string) => `Aplikasi ${target} bermasalah`,
      detail: (_target: string, params: ProblemParams) =>
        `pm2 berhenti mencoba setelah ${n0(params.restarts)}× gagal. Lihat log stderr.`,
    },
    app_crash_loop: {
      title: (target: string) => `Aplikasi ${target} terus dimulai ulang`,
      detail: (_target: string, params: ProblemParams) =>
        `${n0(params.restarts10m)}× dalam 10 mnt terakhir. Lihat log stderr.`,
    },
    domain_unreachable: { title: (target: string) => `${target} tidak bisa dijangkau`, detail: domainReason },
    domain_http_error: {
      title: (target: string, params: ProblemParams) => `${target} menjawab HTTP ${str(params.status)}`,
      detail: domainReason,
    },
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
      title: (_target: string, params: ProblemParams) => `Tidak ada cadangan dalam ${n0(params.hours)} jam terakhir`,
      detail: () => "Cadangan harian mungkin tidak berjalan.",
    },
    backup_item_stale: {
      title: (_target: string, params: ProblemParams) => {
        const hours = num(params.hours);
        const name = BACKUP_ITEM[str(params.itemKind)] ?? str(params.name);
        return hours === null
          ? `Cadangan ${name} belum pernah berhasil`
          : `Cadangan ${name} sudah ${formatNumber(hours, 0, "id")} jam tidak berhasil`;
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
      detail: (_target: string, params: ProblemParams) =>
        `Tinggal ${formatNumber(num(params.freePct) ?? 0, 1, "id")}% (${formatBytes(num(params.freeBytes) ?? 0, "id")}) bebas.`,
    },
    battery_low: {
      title: (_target: string, params: ProblemParams) => `Baterai tinggal ${n0(params.percent)}% dan tidak mengisi`,
      detail: () => "Server ikut mati bila baterai habis. Colokkan charger.",
    },
    battery_hot: {
      title: (_target: string, params: ProblemParams) =>
        `Baterai panas (${formatTemperature(num(params.temperatureC), "id")})`,
      detail: () => "Pindahkan HP ke tempat sejuk atau lepas casingnya.",
    },
    alerts_failing: {
      title: () => "Notifikasi Telegram gagal terkirim",
      detail: (_target: string, params: ProblemParams) =>
        ALERT_REASON[str(params.reason) as AlertErrorCode] ?? ALERT_REASON_OTHER,
    },
    site_job_failed: {
      title: (target: string) => `Perubahan situs ${target} belum selesai`,
      detail: () => "Buka perubahan ini untuk membersihkan atau mengulang.",
    },
    host_rebooted: {
      title: () => "HP baru saja menyala ulang",
      detail: (_target: string, params: ProblemParams) =>
        `Aktif ${n0(params.uptimeMin)} mnt. Periksa apakah semua layanan sudah berjalan.`,
    },
    panel_restarted_unexpectedly: {
      title: () => "Panel sempat berhenti tak terduga",
      detail: () => "Panel tidak dimatikan dengan rapi (mungkin dihentikan Android).",
    },
  },
  recovered: (title: string, durationSec: number) => `${title} · berlangsung ${formatDuration(durationSec, "id")}`,
  internetRecovered: (durationSec: number) =>
    `HP sempat tidak terhubung internet selama ${formatDuration(durationSec, "id")}`,
  recoveredWhileOffline: (title: string, lastSeenAgoSec: number) =>
    `${title} · pulih saat panel tidak berjalan (terakhir terlihat ${formatDuration(lastSeenAgoSec, "id")} lalu)`,
};
