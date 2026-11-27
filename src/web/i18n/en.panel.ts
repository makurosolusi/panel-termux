import { msg } from "@/shared/i18n";
import type { AppStatus, ControlAction } from "@/shared/panel.types";

const SSH_HINT = "Bila memang perlu dihentikan, lakukan dari terminal HP.";

/** UI strings of the Layanan, Aplikasi, Domain, Database and log pages (Ringkasan: id.overview.ts). */
export const tPanel = msg("panel", {
  errorCodes: {
    busy: "Masih ada aksi lain yang berjalan. Tunggu sampai selesai, lalu coba lagi.",
    not_found:
      "Item ini sudah tidak ada, mungkin dihapus atau berganti nama. Muat ulang halaman untuk melihat daftar terbaru.",
    lockout: `Layanan ini memutus akses ke panel bila dihentikan, jadi panel menolaknya. ${SSH_HINT}`,
    protected: "Layanan inti ini tidak bisa dihentikan dari panel, supaya panel tetap bisa dibuka.",
    confirm_required: "Ketik nama layanan untuk mengonfirmasi, lalu coba lagi.",
    job_running: "Perubahan situs, cadangan, atau pemulihan sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
    not_supervised: "Panel tidak berjalan di bawah runit, jadi tidak bisa memulai ulang dirinya sendiri.",
    pm2_unavailable:
      "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti. Jalankan pm2 dari Ringkasan, lalu coba lagi.",
    postgres_down:
      "Layanan postgres tidak berjalan. Situs yang memakai database tidak bisa diakses sampai postgres berjalan lagi.",
    too_soon: "Tunggu sebentar sebelum mengecek lagi.",
    invalid_cursor: "Posisi log tidak dikenali lagi. Muat ulang halaman untuk membaca dari akhir log.",
    system_error: "Perintah sistem di HP gagal. Coba lagi; bila terus gagal, lihat log layanannya di halaman Layanan.",
  },
  fakeMode: "Mode demo",
  fakeModeHelp: "Data di halaman ini contoh, karena panel tidak berjalan di Termux.",
  /** 0.2.x pm2 labels still read by the site list (site.card.tsx) until it maps to StatusKey (W7 cleanup). */
  appStatuses: {
    online: "Berjalan",
    stopped: "Berhenti",
    errored: "Bermasalah",
    launching: "Sedang dimulai",
    unknown: "Tidak diketahui",
  } satisfies Record<AppStatus, string>,
  actions: { start: "Mulai", stop: "Hentikan", restart: "Mulai ulang" } satisfies Record<ControlAction, string>,
  more: (name: string) => `Aksi lain untuk ${name}`,
  /** Accessible name of a row's primary button, so five "Mulai ulang" buttons are told apart. */
  actionFor: (action: string, name: string) => `${action} ${name}`,
  viewLog: "Lihat log",
  confirmTitle: { stop: (n: string) => `Hentikan ${n}?`, restart: (n: string) => `Mulai ulang ${n}?` },
  /** Consequence-first confirmation text per action. */
  confirmBodies: {
    stop: (name: string) => `${name} berhenti dan tidak bisa diakses sampai dimulai lagi.`,
    restart: (name: string) => `${name} berhenti sebentar lalu berjalan lagi. Pengunjung bisa terputus beberapa detik.`,
    siteStop: (site: string) => `Situs ${site} tidak bisa diakses sampai aplikasinya dimulai lagi.`,
  },
  /** Extra consequence per service (PLAN/02 §5.2). */
  serviceImpact: {
    pm2: "Semua aplikasi ikut berhenti; situs tidak bisa diakses sampai pm2 dan aplikasinya berjalan lagi.",
    postgres: "Situs yang memakai database tidak bisa diakses sampai postgres berjalan lagi.",
    sshd: "Login SSH ke HP ini ditolak sampai sshd dijalankan lagi (sesi yang sudah terbuka biasanya tetap jalan).",
    cloudflared: "Semua domain terputus beberapa detik selama tunnel cloudflared dimulai ulang.",
    panel: "Halaman ini terputus ±10–30 dtk lalu tersambung lagi.",
  } as Readonly<Record<string, string>>,
  /** Services whose impact line replaces the generic restart sentence (it would contradict "beberapa detik"). */
  restartImpactOnly: ["panel", "cloudflared"] as readonly string[],
  lockoutReason: (name: string) =>
    `Menghentikan ${name} memutus akses ke panel ini, dan panel tidak bisa menyalakannya lagi. ${SSH_HINT}`,
  /** Past-tense success toast per action. */
  doneBy: {
    start: (name: string) => `${name} dijalankan.`,
    stop: (name: string) => `${name} dihentikan.`,
    restart: (name: string) => `${name} dimulai ulang.`,
  } satisfies Record<ControlAction, (name: string) => string>,
  networkLost: "Tidak bisa memastikan hasilnya karena koneksi terputus. Muat ulang untuk melihat kondisi terbaru.",
  /** Reconnect overlay per deferred service (PLAN/02 §4.4). */
  restart: {
    panel: {
      title: "Panel dimulai ulang…",
      body: "Menyambung ulang. Halaman ini kembali sendiri begitu panel siap.",
      failedTitle: "Panel belum tersambung lagi",
      failed:
        "Tunggu sebentar lalu tekan Coba lagi. Bila tetap gagal, pastikan HP menyala, terhubung ke internet, dan Termux masih terbuka. Bila kamu memakai Cloudflare Access, muat ulang halaman untuk login lagi.",
      back: "panel dimulai ulang.",
    },
    cloudflared: {
      title: "cloudflared dimulai ulang…",
      body: "Semua domain terputus beberapa detik. Menunggu tunnel tersambung lagi.",
      failedTitle: "cloudflared belum berjalan lagi",
      failed:
        "Tunggu sebentar lalu tekan Coba lagi. Bila tetap gagal, buka log cloudflared di halaman Layanan untuk melihat penyebabnya.",
      back: "cloudflared dimulai ulang.",
    },
    retry: "Coba lagi",
    close: "Tutup",
  },
  coreBadge: "Inti",
  pid: (pid: number) => `PID ${pid}`,
  services: {
    title: "Layanan",
    description: "Layanan runit di HP. Layanan inti menjaga panel, situs, dan akses SSH tetap berjalan.",
    label: "Daftar layanan",
    cols: { name: "Nama", status: "Status", since: "Sejak", pid: "PID" },
    upFor: (d: string) => `aktif ${d}`,
    downFor: (d: string) => `mati ${d}`,
    upJustNow: "baru mulai",
    downJustNow: "baru berhenti",
    crashLoop: "berulang kali dimulai ulang",
    emptyTitle: "Belum ada layanan runit",
    emptyBody: "Panel membaca layanan dari `$PREFIX/var/service`.",
    error:
      "Daftar layanan tidak bisa dibaca. Coba lagi; bila terus gagal, tunggu beberapa saat lalu muat ulang halaman.",
  },
  apps: {
    title: "Aplikasi",
    description: "Aplikasi pm2 yang menjalankan situs.",
    label: "Daftar aplikasi",
    cols: {
      name: "Nama",
      status: "Status",
      site: "Situs",
      memory: "Memori",
      uptime: "Waktu aktif",
      restarts: "Dimulai ulang",
      port: "Port",
    },
    restarts: (n: string) => `${n}×`,
    modules: (n: number) => `Modul pm2 (${n})`,
    emptyTitle: "Belum ada aplikasi",
    emptyBody: "Aplikasi muncul setelah kamu membuat situs atau menambahkannya ke `ecosystem.config.js`.",
    pm2Down: "pm2 tidak berjalan",
    pm2DownBody: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti.",
  },
  domains: {
    title: "Domain",
    description: "Hostname di tunnel cloudflared, tujuannya di HP, dan hasil cek dari internet.",
    label: "Daftar domain",
    cols: {
      domain: "Domain",
      target: "Tujuan",
      status: "Status",
      reason: "Keterangan",
      response: "Respons",
      checked: "Dicek",
    },
    open: (host: string) => `Buka ${host} di tab baru`,
    target: {
      app: (site: string | null, app: string) => (site ? `Situs ${site} · aplikasi ${app}` : `Aplikasi ${app}`),
      panel: "Panel Termux",
      other: (service: string) => `Layanan lain (${service})`,
      none: "Tanpa tujuan",
    },
    ms: (ms: string) => `${ms} ms`,
    never: "Belum pernah",
    check: "Cek ulang",
    checkLabel: (host: string) => `Cek ulang ${host}`,
    checked: (host: string) => `${host} dicek.`,
    reasons: {
      unchecked: "Cek pertama berjalan dalam 1 mnt.",
      authRequired: "Domain menjawab, tapi meminta login (mungkin Cloudflare Access).",
      clientError: (status: number) => `Aplikasi berjalan, tetapi halaman utama menjawab ${status}.`,
      unstable: (n: number) => `Gagal ${n}× berturut-turut. Ditandai bermasalah setelah 3×.`,
      localAnswers: (local: number) => `Aplikasi di HP menjawab ${local}, jadi masalahnya di tunnel.`,
      portSilent: (port: number) => `Aplikasi di port ${port} tidak menjawab.`,
      noAnswer: "Domain tidak menjawab dari internet.",
      tunnelDown: "Cloudflare tidak terhubung ke tunnel cloudflared di HP.",
      heldBy: (title: string) => `Penyebabnya: ${title}.`,
      wildcard: "Domain wildcard tidak dicek otomatis.",
    },
    emptyTitle: "Belum ada domain",
    emptyBody: "Tambahkan domain dari halaman situs, atau tulis aturan di `~/.cloudflared/config.yml`.",
  },
  databases: {
    title: "Database",
    description: "Database PostgreSQL di HP beserta situs pemakainya.",
    label: "Daftar database",
    cols: { name: "Nama", site: "Situs", owner: "Pemilik", size: "Ukuran", backup: "Cadangan terakhir" },
    noBackup: "Belum pernah",
    staleBackup: "Lebih dari 36 jam lalu",
    emptyTitle: "Belum ada database",
    emptyBody: "Database dibuat otomatis saat kamu membuat situs dengan PostgreSQL.",
    postgresDown: "Layanan postgres tidak berjalan",
    postgresDownBody: "Situs yang memakai database tidak bisa diakses sampai postgres berjalan lagi.",
  },
  log: {
    title: (name: string) => `Log ${name}`,
    backServices: "Layanan",
    backApps: "Aplikasi",
    stream: "Sumber log",
    streams: { out: "stdout", err: "stderr" },
    note: "Log ditampilkan apa adanya; pola rahasia umum disamarkan.",
    truncated: "Sebagian baris dilewati karena terlalu banyak baris baru sekaligus.",
    empty: "Belum ada log. Log muncul setelah layanan atau aplikasi ini menulis sesuatu.",
    failed: "Log tidak bisa dibaca",
  },
  dash: "–",
} as const);
