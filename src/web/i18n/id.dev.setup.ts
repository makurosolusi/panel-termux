import type { SetupItemKey, SetupLevel } from "@/shared/dev.types";

type SetupItemCopy = { title: string; body: string; action: string };

/** Indonesian strings of the onboarding card and banner (`id.dev.setup`, PLAN/05 §5.1, F1). */
export const idDevSetup = {
  title: "Siapkan Panel Termux",
  description: "Langkah wajib dan disarankan agar panel aman dan datamu bisa dipulihkan.",
  progress: (n: number, total: number) => `${n} dari ${total} selesai`,
  hide: "Sembunyikan panduan",
  reopen: "Panduan penyiapan",
  hidden: "Panduan disembunyikan. Buka lagi lewat tombol Panduan penyiapan.",
  shown: "Panduan penyiapan ditampilkan.",
  levels: { required: "Wajib", recommended: "Disarankan", optional: "Opsional" } satisfies Record<SetupLevel, string>,
  done: "Selesai",
  markUndone: "Tandai belum",
  manual: "dicentang manual",
  markedDone: "Langkah ditandai selesai.",
  markedUndone: "Langkah ditandai belum selesai.",
  banner: {
    title: (n: number, total: number) => `Siapkan Panel Termux: ${n} dari ${total} selesai`,
    continue: "Lanjutkan",
  },
  items: {
    access: {
      title: "Lindungi panel dengan Cloudflare Access",
      body: "Login terbuka untuk semua akun Google. Access memastikan hanya email yang kamu izinkan yang sampai ke halaman dan API panel.",
      action: "Lihat resep Access",
    },
    secret_saved: {
      title: "Simpan salinan kunci data",
      body: "`data/secret` tidak ikut dicadangkan. Tanpa file ini, token dan kunci yang tersimpan di cadangan tidak bisa dibaca.",
      action: "Unduh kunci data",
    },
    backup: {
      title: "Atur cadangan ke R2 atau S3",
      body: "Cadangan harian dikirim ke luar HP. Selesai setelah cadangan pertama berhasil.",
      action: "Atur cadangan",
    },
    cloudflare_token: {
      title: "Isi token API Cloudflare",
      body: "Agar domain situs baru langsung mendapat record DNS.",
      action: "Isi token",
    },
    apps_json: {
      title: "Hubungkan `apps.json` ke pm2",
      body: "Agar situs buatan panel tetap jalan setelah HP dinyalakan ulang.",
      action: "Buka Situs",
    },
    first_site: {
      title: "Buat atau adopsi situs pertama",
      body: "Hubungkan domain ke aplikasimu.",
      action: "Buat situs",
    },
    admins: {
      title: "Tambah Admin kedua",
      body: "Opsional. Admin punya kendali penuh atas HP ini. Bila panel memakai Access, tambahkan juga emailnya ke policy Access.",
      action: "Buka Pengguna",
    },
  } satisfies Record<Exclude<SetupItemKey, "adopt_sites">, SetupItemCopy>,
  accessDone: "Sudah saya pasang",
  secretDone: "Sudah saya simpan",
  secretCopyHint: "Atau salin file lewat SSH dari laptop:",
  backupFirstRun: "Jalankan cadangan pertama",
} as const;
