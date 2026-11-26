import type { DeployKind, DeployStatus } from "@/shared/deploy.types";

/** Indonesian strings of the site Deploy card, rollback and deploy history (merged into `id.deploy`). */
export const idDeploy = {
  title: "Deploy",
  help: "Unggah binary Bun hasil compile. Paling disarankan `bun build --compile --target=bun-linux-arm64-android` (jalan langsung di Termux); target `bun-linux-arm64` juga bisa dan dijalankan lewat grun.",
  adoptedNote:
    "Situs ini diadopsi: entri pm2-nya ditulis manual di ecosystem.config.js. Panel hanya mengganti binary lalu memulai ulang aplikasi; runtime (native/grun) tidak diubah.",
  pick: "Pilih file binary",
  change: "Ganti file",
  file: (name: string, size: string) => `${name} · ${size}`,
  tooLarge: (max: string) => `File lebih besar dari batas ${max}. Pilih binary yang lebih kecil.`,
  empty: "File ini kosong (0 byte). Pilih ulang binary hasil compile.",
  hashing: "Menghitung checksum…",
  hashFailed:
    "Checksum tidak bisa dihitung karena browser butuh koneksi HTTPS. Buka panel lewat alamat https, lalu coba lagi.",
  checksum: "SHA-256",
  start: "Unggah dan deploy",
  uploading: "Mengunggah…",
  completing: "Menyelesaikan unggahan…",
  progress: (pct: number, sent: string, total: string, speed: string) => `${pct}% · ${sent} / ${total} · ${speed}/dtk`,
  cancel: "Batalkan unggahan",
  cancelled: "Unggahan dibatalkan.",
  failed: "Unggahan tidak berhasil. Periksa koneksi internet, lalu coba lagi.",
  errorCodes: {
    too_large: "File melebihi batas ukuran di server. Pilih binary yang lebih kecil.",
    incomplete: "Sebagian file tidak sampai ke server. Unggah ulang file yang sama.",
    no_previous: "Belum ada versi sebelumnya. Rollback bisa dipakai setelah deploy kedua.",
  },
  rollback: {
    button: "Kembalikan versi sebelumnya",
    title: "Kembalikan ke versi sebelumnya?",
    body: "Binary versi sebelumnya dipasang lagi, lalu aplikasi dimulai ulang. Pengunjung bisa terputus beberapa detik.",
    confirm: "Kembalikan",
    none: "Belum ada versi sebelumnya.",
  },
  history: {
    title: "Riwayat deploy",
    job: "Lihat detail",
    by: (name: string) => `oleh ${name}`,
    unknownActor: "pengguna terhapus",
    empty: "Belum ada deploy. Unggah binary pertama di atas untuk menjalankan situs ini.",
    kinds: { deploy: "Deploy", rollback: "Rollback" } satisfies Record<DeployKind, string>,
    statuses: {
      running: "Berjalan",
      succeeded: "Berhasil",
      failed: "Gagal",
      rolled_back: "Dikembalikan",
      interrupted: "Terputus",
    } satisfies Record<DeployStatus, string>,
  },
} as const;
