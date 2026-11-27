import type { FixBlockReason, FixErrorCode, FixFile } from "@/shared/fix.types";
import type { IntegrationCheckKey, JobParams } from "@/shared/site.types";

/** Copy that may interpolate server params (`{path}`, `{count}` …). */
type Copy = string | ((p: JobParams) => string);
type CheckCopy = { ok: Copy; warning?: Copy; error?: Copy };
const s = (v: JobParams[string] | undefined) => String(v ?? "");

/** "blog", "blog dan shop", "blog, shop, dan api". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, dan ${names.at(-1)}`;
}

/** Indonesian strings of the Persiapan card on /panel/sites (PLAN/03 §5.1, PLAN/06 §4.2); part of `idSite.setup`. */
export const idSiteSetup = {
  title: "Persiapan",
  description:
    "Sekali saja: panel menghubungkan situs buatannya ke pm2 agar tetap berjalan setelah HP dinyalakan ulang.",
  checklist: "Hasil pemeriksaan",
  recheck: "Periksa lagi",
  checking: "Memeriksa…",
  checkedAt: (ago: string) => `Diperiksa ${ago}`,
  readyLine: (n: number) => `pm2 siap: ${n} aplikasi terbaca, termasuk situs buatan panel.`,
  stillFailing: (n: number) => `Masih ada ${n} hal yang perlu diperbaiki.`,
  allOk: "Pemeriksaan wajib lolos. pm2 siap menjalankan situs buatan panel.",
  tokenLink: "Isi token di Pengaturan",
  adoptTitle: "Situs yang sudah berjalan",
  adoptBody: (n: number) =>
    `${n} domain sudah diarahkan ke aplikasi di HP ini tetapi belum tercatat. Adopsi agar bisa di-deploy dari panel.`,
  adoptLink: "Lihat yang belum dikelola",
  checks: {
    sites_dir: {
      ok: "Folder situs ada",
      error: (p) => `Folder ${s(p.path)} belum ada. Panel bisa membuatnya, atau ubah folder situs di Pengaturan.`,
    },
    apps_json: {
      ok: "apps.json terbaca",
      error: (p) =>
        p.reason === "invalid"
          ? "apps.json rusak (bukan daftar JSON). Tekan Periksa lagi setelah memperbaikinya, atau hapus file itu agar panel membuatnya ulang."
          : "apps.json belum ada. Tekan Periksa lagi, panel akan membuatnya.",
    },
    ecosystem_file: {
      ok: "ecosystem.config.js ada",
      error: (p) => `File ${s(p.path)} tidak ada. pm2 di HP ini belum memakai ecosystem.`,
    },
    ecosystem_loads: {
      ok: "pm2 bisa memuat ecosystem.config.js",
      error:
        "pm2 tidak bisa memuat ecosystem.config.js. Situs yang berjalan tidak terganggu sekarang, tetapi semua aplikasi tidak akan jalan setelah HP dinyalakan ulang. Perbaiki file, lalu periksa lagi.",
    },
    ecosystem_spreads_apps_json: {
      ok: "pm2 ikut menjalankan situs buatan panel",
      error: (p) =>
        p.noSites
          ? "Sebelum situs pertama dibuat, panel perlu menghubungkannya ke pm2."
          : "Situs buatan panel belum ikut dijalankan pm2, jadi tidak berjalan lagi setelah HP dinyalakan ulang.",
    },
    snippet_current: {
      ok: "Situs panel dimuat dengan cara terbaru",
      error: "pm2 memuat situs panel dengan cara lama: bila satu situs rusak, semua aplikasi bisa berhenti.",
    },
    apps_entries_runnable: {
      ok: "Semua situs di apps.json punya binary",
      warning: (p) => `${s(p.count)} situs di apps.json belum punya binary. pm2 melewatinya sampai di-deploy.`,
      error: (p) =>
        `${s(p.count)} situs di apps.json belum punya binary, dan pm2 memuatnya dengan cara lama yang tidak melewatinya.`,
    },
    pm2_runtime: {
      ok: "Layanan pm2 berjalan",
      error: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti.",
    },
    pm2_auto_exit: {
      ok: (p) =>
        p.pending
          ? "Pengaman pm2 sudah dipasang. Aktif setelah HP atau pm2 dimulai ulang."
          : "pm2 tetap hidup tanpa aplikasi",
      warning: "pm2 bisa berhenti sendiri saat semua aplikasi dihentikan.",
    },
    pm2_guard: {
      ok: "Ada aplikasi pm2 selain situs panel",
      warning: "pm2 bisa berhenti sendiri saat situs terakhir dihapus.",
    },
    tunnel: {
      ok: "Tunnel cloudflared terdeteksi",
      error: "Tunnel cloudflared belum terdeteksi. Periksa ~/.cloudflared/config.yml di HP, lalu periksa lagi.",
    },
    cloudflare_token: {
      ok: "Token API Cloudflare terisi",
      warning: "Token API Cloudflare belum diisi (opsional). Tanpa token, buat record DNS domain baru secara manual.",
    },
  } satisfies Record<IntegrationCheckKey, CheckCopy>,
  notReady: "pm2 belum siap menjalankan situs buatan panel.",
  notReadyLink: "Selesaikan persiapan di halaman Situs",
  fix: "Perbaiki",
  fixAll: (n: number) => `Perbaiki semua (${n})`,
  fixLabel: (what: string) => `Perbaiki: ${what}`,
  dialog: {
    ecosystem_block: {
      title: "Hubungkan situs panel ke pm2?",
      body: (keep: readonly string[]) =>
        keep.length
          ? `Panel menambahkan satu blok di akhir \`ecosystem.config.js\`. Aplikasi yang sudah ada tetap sama dan tidak dimulai ulang: ${joinNames(keep)}. Situs yang berjalan tidak terganggu.`
          : "Panel menambahkan satu blok di akhir `ecosystem.config.js`. Situs yang berjalan tidak terganggu.",
      addApps: (apps: readonly string[]) => `Saat pm2 dimulai berikutnya, ${joinNames(apps)} ikut dijalankan.`,
      oldSpread:
        "Baris lama `...require('./apps.json')` diganti, karena bisa menghentikan semua aplikasi bila `apps.json` rusak.",
      guard: "Karena belum ada aplikasi lain, panel juga menambahkan penjaga kecil (±6 MB) agar pm2 tetap hidup.",
    },
    pm2_auto_exit: {
      title: "Pasang pengaman pm2?",
      body: "Panel mengubah pengaturan layanan pm2 agar tidak berhenti sendiri saat semua aplikasi dihentikan. Berlaku saat pm2 dimulai ulang berikutnya; aplikasi tidak terganggu sekarang.",
    },
    sites_dir_create: {
      title: "Buat folder situs?",
      body: (dir: string) => `Panel membuat folder \`${dir}\` untuk situs-situsmu.`,
    },
    backupNote: "Salinan file lama disimpan, jadi perubahan ini bisa dibatalkan.",
    showDiff: "Lihat perubahan pada file",
    loading: "Menyiapkan pratinjau…",
    apply: "Terapkan",
    cancel: "Batal",
    applying: "Menerapkan…",
  },
  dialogAll: { title: (n: number) => `Perbaiki ${n} hal sekaligus?` },
  diff: {
    label: (path: string) => `Perubahan pada ${path}`,
    added: "ditambah",
    removed: "dihapus",
  },
  done: "Diperbaiki. Pemeriksaan sudah diulang.",
  doneAll: (n: number) => `${n} hal diperbaiki. Pemeriksaan sudah diulang.`,
  notApplied: "Tidak diterapkan: hasil perubahan tidak bisa dimuat pm2. File lama tetap dipakai.",
  more: "Perubahan oleh panel",
  lastFix: {
    ecosystem: (ago: string) => `File ecosystem diubah panel ${ago}.`,
    pm2_run: (ago: string) => `Run script pm2 diubah panel ${ago}.`,
  } satisfies Record<FixFile, (ago: string) => string>,
  lastFixSites: (sites: readonly string[]) => `Situs: ${joinNames(sites)}.`,
  undoAction: "Batalkan perubahan",
  undoLabel: {
    ecosystem: "Batalkan perubahan pada file ecosystem",
    pm2_run: "Batalkan perubahan pada run script pm2",
  } satisfies Record<FixFile, string>,
  undoTitle: (at: string) => `Kembalikan file ke versi ${at}?`,
  undoBody: {
    ecosystem: "Situs buatan panel tidak lagi ikut dijalankan pm2 setelah HP dinyalakan ulang.",
    ecosystemSites: (sites: readonly string[]) =>
      `${joinNames(sites)} tidak berjalan lagi setelah HP dinyalakan ulang. Sekarang tetap berjalan.`,
    pm2_run: "pm2 kembali bisa berhenti sendiri saat semua aplikasi dihentikan.",
  },
  undoChanged: "File sudah diubah lagi setelah perbaikan. Mengembalikan versi lama membuang perubahan itu.",
  undoForce: "Tetap kembalikan",
  undone: "Perubahan dibatalkan.",
  restartPm2: "Mulai ulang pm2 sekarang",
  restartPm2Title: "Mulai ulang pm2 sekarang?",
  restartPm2Body: (apps: readonly string[]) =>
    apps.length
      ? `Semua aplikasi berhenti beberapa detik lalu berjalan lagi: ${joinNames(apps)}. Pengunjung bisa terputus sebentar.`
      : "pm2 berhenti beberapa detik lalu berjalan lagi.",
  restartPm2FileNote: "Perubahan yang dibuat panel pada `ecosystem.config.js` ikut berlaku sekarang.",
  restartNotFound: "Layanan pm2 tidak terdaftar di runit HP ini, jadi pm2 tidak dimulai ulang.",
  restartOk: "pm2 dimulai ulang. Semua aplikasi berjalan lagi.",
  restartCheckFailed: (apps: readonly string[]) => `${joinNames(apps)} tidak berjalan lagi setelah pm2 dimulai ulang.`,
  restartFailedHint: "Mengembalikan file ecosystem ke versi sebelum perbaikan biasanya memulihkannya.",
  restoreAndRestart: "Kembalikan file ecosystem dan mulai ulang pm2",
  restoreAndRestartTitle: "Kembalikan file ecosystem lalu mulai ulang pm2?",
  manual: {
    title: "Cara manual (untuk pengguna teknis)",
    step1: "Buka file ecosystem di Termux:",
    step2: "Tempel blok ini di akhir file:",
    step3: "Simpan. pm2 tidak perlu dimulai ulang.",
    step4: "Tekan Periksa lagi.",
    copyBlock: "Salin blok",
    runScript: "Tambahkan `--no-auto-exit` setelah `pm2-runtime` di file ini, lalu mulai ulang layanan pm2 saat aman:",
    pm2Start: "Menyalakan layanan pm2 dari Termux:",
  },
  errors: {
    busy: "Ada perubahan situs atau cadangan yang sedang berjalan. Coba lagi setelah selesai.",
    changed: "File berubah sejak pratinjau dibuat. Lihat perubahannya lagi.",
    changed_during_fix: "File sedang diubah di HP. Tutup editornya, lalu coba lagi.",
    changed_since: "File sudah diubah lagi setelah perbaikan. Mengembalikan versi lama membuang perubahan itu.",
    validation_failed: "Tidak diterapkan: hasil perubahan tidak bisa dimuat pm2. File lama tetap dipakai.",
    not_fixable: "Panel tidak bisa memperbaiki ini otomatis. Ikuti Cara manual di kartu Persiapan.",
    disk_full: "Memori HP penuh, jadi file tidak diubah.",
    not_writable: "Panel tidak punya izin mengubah file ini, jadi file tidak diubah.",
    not_found: "Salinan file lama sudah tidak ada, jadi perubahan tidak bisa dibatalkan.",
  } satisfies Record<FixErrorCode, string>,
  unfixable: {
    ecosystem_missing: "File `ecosystem.config.js` tidak ada, jadi panel tidak tahu cara pm2 di HP ini dijalankan.",
    ecosystem_unloadable:
      "File `ecosystem.config.js` sekarang tidak bisa dimuat pm2, jadi panel tidak mengubahnya. Perbaiki dulu kesalahannya, lalu periksa lagi.",
    ecosystem_linked: "`ecosystem.config.js` adalah tautan ke file di folder lain, jadi panel tidak mengubahnya.",
    not_config_js: "Nama file ecosystem harus berakhiran `.config.js` agar pm2 membacanya sebagai daftar aplikasi.",
    too_large: "File ecosystem terlalu besar untuk diubah otomatis.",
    not_utf8:
      "File ecosystem memakai penyandian teks selain UTF-8, jadi panel tidak mengubahnya agar isinya tidak rusak.",
    markers_broken: "Penanda blok panel di `ecosystem.config.js` rusak atau dobel, jadi panel tidak mengubahnya.",
    unknown_apps_json_use:
      "`ecosystem.config.js` memuat `apps.json` dengan cara yang tidak dikenali panel, jadi panel tidak mengubahnya.",
    run_script_missing: "Run script layanan pm2 tidak ditemukan.",
    run_script_unknown: "Run script layanan pm2 ditulis dengan cara yang tidak dikenali panel.",
    sites_dir_outside_home: "Folder situs berada di luar folder home Termux, jadi panel tidak membuatnya.",
  } satisfies Record<FixBlockReason, string>,
  unfixableSuffix: "Ikuti Cara manual di bawah.",
  unfixableElsewhere: "Ikuti Cara manual di kartu Persiapan.",
} as const;
