import type { DeployKind, DeployStatus } from "@/shared/deploy.types";

/** Indonesian strings of the site Deploy card, rollback and deploy history (merged into `id.deploy`). */
export const idDeploy = {
  title: "Deploy",
  help: "Upload binary Bun hasil compile. Disarankan `bun build --compile --target=bun-linux-arm64-android` (jalan langsung); target `bun-linux-arm64` juga bisa (dijalankan lewat grun).",
  adoptedNote:
    "Site adopsi: entry pm2-nya ditulis manual di ecosystem.config.js, jadi panel hanya mengganti binary dan me-restart app; runtime di sana (native/grun) tidak diubah.",
  pick: "Pilih file binary",
  change: "Ganti file",
  file: (name: string, size: string) => `${name} · ${size}`,
  tooLarge: (max: string) => `File terlalu besar (maks ${max}).`,
  empty: "File kosong.",
  hashing: "Menghitung checksum…",
  hashFailed: "Gagal menghitung checksum (butuh koneksi https).",
  checksum: "SHA-256",
  start: "Upload & deploy",
  uploading: "Mengupload…",
  completing: "Menyelesaikan upload…",
  progress: (pct: number, sent: string, total: string, speed: string) => `${pct}% · ${sent} / ${total} · ${speed}/s`,
  cancel: "Batalkan upload",
  cancelled: "Upload dibatalkan.",
  failed: "Upload gagal.",
  errorCodes: {
    too_large: "File terlalu besar untuk diupload.",
    incomplete: "Sebagian potongan file belum terkirim. Coba upload ulang.",
    no_previous: "Belum ada versi sebelumnya untuk dikembalikan.",
  },
  rollback: {
    button: "Kembalikan versi sebelumnya",
    title: "Kembalikan ke versi sebelumnya?",
    body: "Binary sebelumnya dipasang lagi dan aplikasi dimulai ulang.",
    confirm: "Kembalikan",
    none: "Belum ada versi sebelumnya.",
  },
  history: {
    title: "Riwayat deploy",
    job: "Lihat job",
    by: (name: string) => `oleh ${name}`,
    unknownActor: "pengguna terhapus",
    kinds: { deploy: "Deploy", rollback: "Rollback" } satisfies Record<DeployKind, string>,
    statuses: {
      running: "Berjalan",
      succeeded: "Berhasil",
      failed: "Gagal",
      rolled_back: "Dibatalkan",
    } satisfies Record<DeployStatus, string>,
  },
} as const;
