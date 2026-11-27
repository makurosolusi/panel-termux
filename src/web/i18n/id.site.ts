import type { Messages } from "@/shared/i18n";
import type {
  AdoptCandidateApp,
  JobKind,
  JobParams,
  JobStepKey,
  SiteIssueCode,
  SiteNoteCode,
} from "@/shared/site.types";
import type { tSite } from "./en.site";
import { idSiteSetup } from "./id.site.setup";

/** Copy that may interpolate server params (`{hostname}`, `{port}` …). */
type Copy = string | ((p: JobParams) => string);
const s = (v: JobParams[string] | undefined) => String(v ?? "");

/** Indonesian strings of the Situs pages: list, persiapan, adopsi, wizard and the running-job banner. */
export const idSite: Messages<typeof tSite> = {
  errorCodes: {
    busy: "Ada perubahan lain yang sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
    not_found: "Situs ini sudah tidak ada, mungkin baru dihapus. Buka daftar situs untuk melihat yang masih ada.",
    integration_required: "pm2 belum siap menjalankan situs buatan panel. Selesaikan persiapan di halaman Situs.",
    pm2_unavailable: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti. Jalankan pm2, lalu coba lagi.",
    pm2_not_running: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti. Jalankan pm2, lalu coba lagi.",
    no_free_port: "Semua port di rentang situs sudah dipakai. Isi port lain secara manual.",
    app_not_found: "Aplikasi pm2 ini sudah tidak ada. Muat ulang daftar, lalu pilih lagi.",
    app_in_use: "Aplikasi pm2 ini sudah dipakai situs lain. Pilih aplikasi lain.",
    self_hostname: "Domain ini alamat Panel Termux sendiri, jadi tidak bisa diadopsi.",
    adopt_blocked: "Aplikasi ini tidak bisa dikelola panel. Lihat alasannya di daftar aplikasi.",
    exists: "Nama, domain, atau port ini sudah dipakai situs lain. Ganti nama situs, lalu coba lagi.",
    invalid_name: "Nama situs tidak valid. Pakai huruf kecil, angka, dan tanda minus, diawali huruf.",
    name_reserved: "Nama ini dipakai panel. Pilih nama lain.",
    invalid_site: "Isian situs tidak valid. Periksa kolom yang ditandai, lalu coba lagi.",
    invalid_env: "Ada variabel lingkungan yang tidak valid. Periksa namanya, lalu coba lagi.",
  },
  list: {
    title: "Situs",
    missingFromPm2: "Tidak berjalan di pm2",
    description: "Domain yang diarahkan cloudflared ke aplikasi pm2 di HP ini.",
    label: "Daftar situs",
    create: "Buat situs",
    createBlocked: "Selesaikan persiapan pm2 dulu.",
    jobs: "Riwayat perubahan",
    empty: "Belum ada situs",
    emptyBody: "Buat situs pertama untuk menghubungkan domain ke aplikasi Bun di HP ini.",
    cols: { name: "Nama", status: "Status", domain: "Domain utama", deploy: "Deploy terakhir", port: "Port" },
    adopted: "Diadopsi",
    more: (n: number) => `+${n}`,
    neverDeployed: "Belum pernah",
    port: (p: number) => `port ${p}`,
    actions: (name: string) => `Aksi untuk ${name}`,
    open: "Buka",
    openHost: (host: string) => `Buka ${host} di tab baru`,
    deploy: "Deploy",
    restart: "Mulai ulang",
    restartTitle: (name: string) => `Mulai ulang aplikasi ${name}?`,
    restartBody:
      "Situs ini tidak bisa dibuka beberapa detik selama aplikasinya dimulai ulang. Situs lain tidak terganggu.",
    appLog: "Log aplikasi",
    running: (kind: string, target: string) => `Perubahan ${kind} · ${target} sedang berjalan.`,
    interrupted: (kind: string, target: string) =>
      `Perubahan ${kind} · ${target} terputus. Pulihkan agar tidak ada sisa setengah jadi.`,
    viewJob: "Lihat",
  },
  setup: idSiteSetup,
  discovered: {
    title: "Belum dikelola",
    description:
      "Domain di config cloudflared yang belum tercatat sebagai situs. Adopsi agar bisa dikelola dari panel.",
    label: "Domain yang belum dikelola",
    cols: { hostname: "Domain", target: "Mengarah ke" },
    self: "Panel Termux (domain ini)",
    noPort: "port tidak diketahui",
    noApp: "belum ada aplikasi pm2 yang cocok",
    wildcard: "Domain wildcard tidak bisa diadopsi.",
    adopt: "Adopsi",
    adoptLabel: (host: string) => `Adopsi ${host}`,
    unavailable: "Daftar aplikasi pm2 tidak bisa dibaca, jadi yang belum dikelola tidak ditampilkan.",
    noCandidates: "Tidak ada aplikasi pm2 yang cocok. Pastikan aplikasinya berjalan dari folder di ~/sites.",
  },
  adopt: {
    title: (host: string) => `Adopsi ${host}`,
    description: "Panel hanya mencatat situs ini. File, aplikasi pm2, dan domainnya tidak diubah sampai kamu deploy.",
    app: "Aplikasi pm2",
    appPlaceholder: "Pilih aplikasi",
    name: "Nama situs",
    nameHint: "Huruf kecil, angka, dan tanda minus. Biasanya sama dengan nama aplikasi.",
    folder: "Folder",
    runtime: "Runtime",
    port: "Port",
    runtimes: { native: "Android native", grun: "glibc" },
    scriptRuntimes: {
      native: "dijalankan langsung",
      grun: "dijalankan lewat grun",
      other: "cara jalan tidak dikenali",
    },
    portSources: { pm2_env: "dari env pm2", pm2_args: "dari argumen pm2", dotenv: "dari `.env`" },
    unknown: "tidak diketahui",
    submit: "Adopsi",
    cancel: "Batal",
    done: (name: string) => `Situs ${name} diadopsi.`,
    blockers: {
      outside_sites_dir: "Aplikasi ini berjalan dari folder di luar ~/sites, jadi tidak bisa dikelola panel.",
      no_binary: "Folder aplikasi ini tidak punya file `app`.",
      invalid_binary: "File `app` di folder ini bukan binary yang bisa dijalankan.",
      pm2_module: "Ini modul pm2, bukan aplikasi.",
      name_invalid: "Nama aplikasi ini tidak bisa dipakai sebagai nama situs.",
    } satisfies Record<AdoptCandidateApp["blockers"][number], string>,
    warnings: {
      runtime_script_mismatch:
        "Runtime binary tidak cocok dengan cara pm2 menjalankannya. Cek ecosystem.config.js sebelum deploy.",
      script_other:
        "Panel tidak tahu cara pm2 menjalankan binary ini. Cek kesehatan setelah deploy akan menunjukkan hasilnya.",
      port_unknown:
        "Port aplikasi tidak ditemukan di env pm2, argumen, atau `.env`. Panel memakai port dari config cloudflared.",
      port_mismatch: "Port aplikasi berbeda dengan port domain ini di config cloudflared.",
    } satisfies Record<AdoptCandidateApp["warnings"][number], string>,
  },
  wizard: {
    title: "Buat situs baru",
    description: "Situs baru mendapat folder, port, dan domain. Binary diunggah setelah situs dibuat.",
    back: "Kembali",
    next: "Lanjut",
    create: "Buat situs",
    cancel: "Batal",
    steps: ["Alamat", "Opsi", "Ringkasan"],
    stepsLabel: "Langkah wizard",
    stepOf: (n: number, total: number, label: string) => `Langkah ${n} dari ${total}: ${label}`,
    name: "Nama situs",
    nameHint: "Huruf kecil, angka, dan tanda minus. Dipakai sebagai nama folder dan nama aplikasi.",
    hostname: "Domain",
    hostnameExtra: (n: number) => `Domain tambahan ${n}`,
    hostnamePlaceholder: "mis. blog.contoh.com",
    addHostname: "Tambah domain lain",
    removeHostname: (host: string) => `Hapus ${host || "domain kosong"}`,
    port: "Port",
    portHint: "Terisi otomatis dengan port yang belum dipakai. Boleh diubah.",
    portInvalid: "Isi port dengan angka 1–65535.",
    checking: "Memeriksa…",
    available: "Nama, domain, dan port bisa dipakai.",
    recover: "Pulihkan",
    database: "Buat database PostgreSQL",
    databaseHint: "Membuat database dan role baru khusus situs ini. DATABASE_URL otomatis ditulis ke .env.",
    env: "Variabel lingkungan tambahan",
    envHint: "Disimpan di .env situs. PORT dan DATABASE_URL diisi otomatis oleh panel.",
    summary: "Yang akan dilakukan",
    blip: (hosts: string[]) =>
      `cloudflared dimulai ulang sekali. Semua domain di HP ini terputus 3–10 dtk${hosts.length ? `, termasuk ${hosts.join(", ")}` : ""}.`,
    after: "Setelah selesai, unggah binary pertama dari halaman situs untuk menjalankannya.",
    plan: {
      validate: "Memeriksa ulang nama, domain, dan port",
      folder: (p) => `Membuat folder ~/sites/${s(p.name)}`,
      database: (p) => (p.database ? `Membuat database ${s(p.name)} beserta role-nya` : "Tanpa database"),
      env_write: (p) =>
        `Menulis .env (PORT${p.database ? " dan DATABASE_URL" : ""}${Number(p.env) > 0 ? ` + ${s(p.env)} variabel` : ""})`,
      ingress: (p) => `Menambahkan rute ${s(p.hosts)}${p.port ? ` ke port ${s(p.port)}` : ""} di config cloudflared`,
      dns: (p) =>
        p.dns === "token"
          ? `Membuat record DNS ${s(p.hosts)} di Cloudflare`
          : p.dns === "cert"
            ? `Membuat record DNS ${s(p.hosts)} lewat login cloudflared di HP ini; domain di luar zona login itu mendapat record siap salin`
            : p.dns === "manual"
              ? `Record DNS ${s(p.hosts)} tidak dibuat otomatis: panel menampilkan record siap salin setelah situs dibuat`
              : `Membuat record DNS ${s(p.hosts)} lewat login cloudflared bila ada; bila tidak, panel menampilkan record siap salin`,
      tunnel_restart: "Memulai ulang cloudflared",
      domain_probe: "Mengecek domain bisa dijangkau",
    } satisfies Partial<Record<JobStepKey, Copy>>,
  },
  issues: {
    name_invalid: "Pakai 2–31 huruf kecil, angka, atau tanda minus, diawali huruf.",
    name_taken: "Nama ini sudah dipakai situs atau aplikasi pm2 lain.",
    name_reserved: "Nama ini dipakai panel. Pilih nama lain.",
    name_folder_exists: "Folder dengan nama ini sudah ada di ~/sites. Pilih nama lain, atau adopsi aplikasinya.",
    name_database_exists: (p) => `Database ${s(p.name)} sudah ada. Pilih nama lain, atau matikan opsi database.`,
    name_leftover: "Pembuatan situs dengan nama ini sebelumnya terputus. Pulihkan dulu, lalu coba lagi.",
    hostname_invalid: "Tulis domain lengkap dengan huruf kecil, mis. blog.contoh.com.",
    hostname_in_use: (p) => `${s(p.hostname)} sudah diarahkan ke aplikasi lain di config cloudflared.`,
    hostname_self: "Ini alamat Panel Termux sendiri.",
    hostname_duplicate: "Domain ini sudah ditulis di baris lain.",
    hostname_zone_missing: (p) =>
      `Tidak ada zona Cloudflare untuk ${s(p.hostname)} di akun token ini. Tambahkan domainnya ke Cloudflare dulu.`,
    hostname_dns_conflict: (p) =>
      `Sudah ada record DNS untuk ${s(p.hostname)} yang tidak dibuat panel. Hapus atau ubah di dasbor Cloudflare, lalu coba lagi.`,
    port_invalid: "Isi port dengan angka 1–65535.",
    port_out_of_range: (p) => `Pakai port di rentang situs ${s(p.from)}–${s(p.to)}.`,
    port_in_use: (p) => `Port ${s(p.port)} sudah dipakai aplikasi lain.`,
    port_panel: "Ini port Panel Termux sendiri.",
  } satisfies Record<SiteIssueCode, Copy>,
  notes: {
    dns_same_tunnel: "Record DNS sudah mengarah ke tunnel HP ini, jadi dipakai apa adanya.",
    dns_owned: "Record DNS dibuat panel sebelumnya dan akan dipakai ulang.",
    dns_token_missing:
      "Token Cloudflare belum diisi, jadi panel tidak membuat record DNS domain ini. Buat record-nya secara manual di dasbor Cloudflare.",
    dns_check_failed: "DNS tidak bisa dicek sekarang. Situs tetap bisa dibuat; panel mencoba lagi saat membuat record.",
  } satisfies Record<SiteNoteCode, Copy>,
  // Job kind names for the running-job banner on /panel/sites (the job pages read id.job).
  job: {
    kinds: {
      "site.create": "Buat situs",
      "site.delete": "Hapus situs",
      "hostname.add": "Tambah domain",
      "hostname.remove": "Hapus domain",
      "site.deploy": "Deploy",
      "site.rollback": "Rollback",
      "site.restart": "Mulai ulang situs",
      "site.env": "Ubah variabel lingkungan",
      "job.cleanup": "Pulihkan perubahan terputus",
    } satisfies Record<JobKind, string>,
  },
} as const;
