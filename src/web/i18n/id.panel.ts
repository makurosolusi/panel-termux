import type { AppStatus, ControlAction, ServiceState } from "@/shared/panel.types";
import type { BlockReason } from "@/web/panel/panel.status";

/** Indonesian strings of the /panel monitoring and control pages (merged into `id.panel`). */
export const idPanel = {
  title: "Panel",
  subtitle: "Pantau kondisi HP server, lalu kelola layanan, aplikasi, dan domain.",
  sections: {
    label: "Bagian panel",
    overview: "Ringkasan",
    services: "Layanan",
    apps: "Aplikasi",
    domains: "Domain",
    databases: "Database",
  },
  errorCodes: {
    protected: "Layanan inti ini tidak bisa dihentikan dari panel, supaya panel tetap bisa dibuka.",
    busy: "Masih ada aksi lain yang berjalan. Tunggu sampai selesai, lalu coba lagi.",
    not_found:
      "Item ini sudah tidak ada, mungkin dihapus atau berganti nama. Muat ulang halaman untuk melihat daftar terbaru.",
  },
  fakeMode: "Mode demo: data di halaman ini contoh, karena panel tidak berjalan di Termux.",
  // lama: dipakai halaman sebelum redesign
  refreshing: "Diperbarui otomatis tiap 10 detik",
  device: {
    battery: "Baterai",
    charging: "Sedang diisi",
    notCharging: "Tidak diisi",
    noBattery: "Info baterai tidak tersedia",
    temperature: (c: number) => `${c.toLocaleString("id-ID", { maximumFractionDigits: 1 })} °C`,
    memory: "Memori",
    memoryFree: (free: number, total: number) => `${free} MB bebas dari ${total} MB`,
    disk: "Penyimpanan",
    diskFree: (free: string, total: string) => `${free} bebas dari ${total}`,
    load: "Beban CPU (1/5/15 mnt)",
    uptime: "Waktu aktif HP",
  },
  counts: {
    services: "Layanan",
    apps: "Aplikasi",
    domains: "Domain",
    problems: (n: number) => (n === 0 ? "Semua normal" : `${n} perlu dicek`),
  },
  serviceStates: {
    run: "Berjalan",
    down: "Mati",
    finish: "Berhenti",
    unknown: "Tidak diketahui",
  } satisfies Record<ServiceState, string>,
  appStatuses: {
    online: "Berjalan",
    stopped: "Berhenti",
    errored: "Bermasalah",
    launching: "Sedang dimulai",
    unknown: "Tidak diketahui",
  } satisfies Record<AppStatus, string>,
  actions: { start: "Mulai", stop: "Hentikan", restart: "Mulai ulang" } satisfies Record<ControlAction, string>,
  blocked: {
    busy: "Tunggu aksi yang sedang berjalan selesai.",
    protected: "Layanan inti tidak bisa dihentikan dari panel, supaya panel tetap bisa dibuka.",
    running: "Sudah berjalan.",
    stopped: "Sudah berhenti.",
  } satisfies Record<Exclude<BlockReason, null>, string>,
  confirmTitle: (action: string, name: string) => `${action} ${name}?`,
  // lama: dipakai halaman sebelum redesign; pakai `confirmBodies`
  confirmBody: (action: string, name: string) => `Aksi "${action}" akan dijalankan pada ${name}.`,
  /** Consequence-first confirmation text per action. */
  confirmBodies: {
    start: (name: string) => `${name} akan dijalankan.`,
    stop: (name: string) => `${name} akan berhenti dan tidak bisa diakses sampai dimulai lagi.`,
    restart: (name: string) =>
      `${name} akan berhenti sebentar lalu berjalan lagi. Pengunjung bisa terputus beberapa detik.`,
  } satisfies Record<ControlAction, (name: string) => string>,
  tunnelWarning: "Semua domain terputus beberapa detik selama tunnel cloudflared dimulai ulang.",
  // lama: dipakai halaman sebelum redesign; pakai `doneBy`
  done: (action: string, name: string) => `${name}: ${action.toLowerCase()} berhasil.`,
  /** Past-tense success toast per action. */
  doneBy: {
    start: (name: string) => `${name} dijalankan.`,
    stop: (name: string) => `${name} dihentikan.`,
    restart: (name: string) => `${name} dimulai ulang.`,
  } satisfies Record<ControlAction, (name: string) => string>,
  pid: (pid: number) => `PID ${pid}`,
  uptime: (u: string) => `aktif ${u}`,
  restarts: (n: number) => `dimulai ulang ${n}×`,
  protectedBadge: "Inti",
  log: {
    open: "Log",
    title: (name: string) => `Log ${name}`,
    back: "Kembali",
    lines: "Jumlah baris",
    linesOption: (n: number) => `${n} baris`,
    stream: "Sumber",
    streams: { out: "stdout", err: "stderr" },
    refresh: "Muat ulang",
    empty: "Belum ada log. Log muncul setelah layanan atau aplikasi ini menulis sesuatu.",
  },
  domains: {
    open: (host: string) => `Buka ${host} di tab baru`,
    unchecked: "Belum dicek",
    unreachable: "Tidak bisa dijangkau",
    noApp: "tanpa aplikasi",
  },
  databases: { name: "Nama", owner: "Pemilik", size: "Ukuran" },
} as const;
