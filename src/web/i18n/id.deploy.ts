import type { DeployKind } from "@/shared/deploy.types";
import type { SiteRuntime } from "@/shared/site.types";

/** Why chunk 0 is not a runnable binary (`invalid_binary.reason`). */
type InvalidReason = "not_elf" | "not_64le" | "not_aarch64" | "interp" | "truncated";

/** Indonesian strings of the site #deploy section: upload, resume, rollback and deploy history (PLAN/03 §5.8). */
export const idDeploy = {
  title: "Deploy",
  adoptedNote:
    "Situs ini diadopsi: entri pm2-nya ditulis manual di ecosystem.config.js. Panel hanya mengganti binary lalu memulai ulang aplikasi; runtime (native/grun) tidak diubah.",
  live: {
    title: "Versi berjalan",
    none: "Belum ada binary. Unggah binary pertama untuk menjalankan situs ini.",
    untracked: "Versi tanpa catatan",
    untrackedHelp: "Binary ini diganti di luar panel (mis. lewat ssh), jadi tidak ada catatan deploy-nya.",
    sha: "Versi",
    file: "Nama file",
    size: "Ukuran",
    runtime: "Runtime",
    modified: "Dipasang",
  },
  runtimes: { native: "Android native", grun: "glibc lewat grun" } satisfies Record<SiteRuntime, string>,
  upload: {
    title: "Unggah binary baru",
    restartNote: "Setelah unggahan selesai, aplikasi dimulai ulang dan situs terputus beberapa detik.",
    help: "Build dengan salah satu target ini:",
    targets: [
      {
        cmd: "bun build --compile --target=bun-linux-arm64-android ./index.ts --outfile app",
        note: "Disarankan. Jalan langsung di Termux (Android native).",
      },
      {
        cmd: "bun build --compile --target=bun-linux-arm64 ./index.ts --outfile app",
        note: "Binary glibc. Dijalankan lewat grun (glibc-runner harus terpasang).",
      },
    ],
    pick: "Pilih file binary",
    pickSame: "Pilih file yang sama",
    tooLarge: (max: string) => `File lebih besar dari batas ${max}. Pilih binary yang lebih kecil.`,
    empty: "File ini kosong (0 byte). Pilih ulang binary hasil compile.",
    hashFailed:
      "Checksum tidak bisa dihitung karena browser butuh koneksi HTTPS. Buka panel lewat alamat https, lalu coba lagi.",
    preparing: "Menyiapkan unggahan…",
    hashing: (n: number, total: number) => `Menghitung checksum potongan ${n} dari ${total}…`,
    progress: (pct: number, sent: string, total: string) => `${pct}% · ${sent} dari ${total}`,
    speed: (perSec: string) => `${perSec}/dtk`,
    progressLabel: "Progres unggahan",
    completing: "Menyelesaikan unggahan…",
    waitingBusy: "Menunggu perubahan lain selesai…",
    retrying: (sec: number, n: number, max: number) =>
      `Koneksi terputus. Mencoba lagi dalam ${sec} dtk (percobaan ${n} dari ${max})…`,
    paused: "Unggahan terhenti karena koneksi terputus. Potongan yang sudah terkirim aman.",
    resumeButton: "Lanjutkan unggahan",
    retry: "Coba lagi",
    cancel: "Batalkan unggahan",
    cancelled: "Unggahan dibatalkan.",
    pending: (file: string, size: string, done: number, total: number) =>
      `Unggahan belum selesai: ${file} · ${size} · ${done} dari ${total} potongan`,
    expiresAt: (at: string) => `kedaluwarsa ${at}`,
    pendingHelp: "Pilih file yang sama untuk melanjutkan; potongan yang sudah terkirim tidak diunggah ulang.",
    differentTitle: "File ini berbeda dari unggahan sebelumnya. Mulai unggahan baru?",
    differentBody: (oldFile: string) =>
      `Unggahan ${oldFile} yang belum selesai dibuang, lalu file ini diunggah dari awal.`,
    differentConfirm: "Mulai unggahan baru",
    expired:
      "Unggahan ini sudah tidak ada di server (lebih dari 1 jam tanpa potongan baru, atau admin lain memulai unggahan baru). Unggah ulang file-nya.",
    failed: "Unggahan tidak berhasil.",
  },
  invalidBinary: {
    not_elf: "File ini bukan binary Linux. Pilih file hasil `bun build --compile`, bukan arsip atau skrip.",
    not_64le: "Binary ini bukan 64-bit. Build ulang dengan target arm64 di bawah.",
    not_aarch64: "Binary ini untuk prosesor lain (bukan arm64). Build ulang dengan target arm64 di bawah.",
    interp: "Binary ini memakai loader yang tidak dikenali. Build ulang dengan salah satu target di bawah.",
    truncated: "Binary ini terpotong. Build ulang, lalu unggah lagi.",
  } satisfies Record<InvalidReason, string>,
  runtimeMismatch: (got: string, expected: string) =>
    `Binary ini untuk ${got}, tetapi pm2 menjalankan situs ini sebagai ${expected}. Build ulang dengan target yang sesuai, atau ubah entri pm2-nya lewat ssh.`,
  noSpace: (need: string, free: string) =>
    `Penyimpanan HP tidak cukup: butuh ${need}, tersisa ${free}. Kosongkan ruang, lalu coba lagi.`,
  errorCodes: {
    too_large: "File melebihi batas ukuran di server. Pilih binary yang lebih kecil.",
    invalid_size: "Ukuran file tidak valid. Pilih ulang file-nya.",
    invalid_file_name: "Nama file tidak valid. Ganti nama file (huruf, angka, titik, minus), lalu coba lagi.",
    incomplete: "Sebagian file tidak sampai ke server. Pilih file yang sama untuk melanjutkan.",
    upload_expired:
      "Unggahan ini sudah tidak ada di server (lebih dari 1 jam tanpa potongan baru, atau admin lain memulai unggahan baru). Unggah ulang file-nya.",
    chunk_sha_mismatch: "Potongan rusak di jalan. Lanjutkan unggahan untuk mengirim ulang.",
    no_folder: "Folder situs tidak ada. Buat ulang foldernya lewat ssh atau hapus situs ini.",
    integration_required: "pm2 belum siap menjalankan situs buatan panel. Selesaikan persiapan di halaman Situs.",
    pm2_not_running: "Layanan pm2 tidak berjalan. Jalankan sv up pm2 di HP, lalu coba lagi.",
    no_previous: "Belum ada versi sebelumnya. Rollback bisa dipakai setelah deploy kedua.",
    no_current: "Tidak ada binary yang berjalan, jadi tidak ada yang bisa dikembalikan.",
    invalid_binary: "Binary versi sebelumnya tidak bisa dijalankan di HP ini.",
    runtime_mismatch: "Runtime binary tidak cocok dengan cara pm2 menjalankan situs ini.",
    no_space: "Penyimpanan HP tidak cukup. Kosongkan ruang, lalu coba lagi.",
  },
  rollback: {
    button: "Kembalikan versi sebelumnya",
    title: (site: string) => `Kembalikan ${site} ke versi sebelumnya?`,
    from: "Dari",
    to: "Ke",
    untracked: (size: string, at: string) => `versi tanpa catatan · ${size} · diubah ${at}`,
    carries: "Ikut dikembalikan",
    carriesList: ["binary aplikasi", "cara menjalankannya (native/grun) untuk situs buatan panel"],
    notCarried: "Tidak ikut dikembalikan",
    notCarriedList: ["variabel lingkungan (.env)", "isi dan struktur database", "file di data/", "domain"],
    note: "Bila versi baru sudah mengubah struktur database, versi lama bisa gagal berjalan. Situs terputus beberapa detik.",
    none: "Belum ada versi sebelumnya.",
    started: "Rollback dimulai.",
  },
  history: {
    title: "Riwayat deploy",
    label: "Riwayat deploy situs",
    columns: {
      at: "Waktu",
      kind: "Jenis",
      version: "Versi",
      size: "Ukuran",
      runtime: "Runtime",
      actor: "Oleh",
      duration: "Durasi",
      status: "Status",
    },
    active: "Aktif",
    view: "Lihat perubahan",
    unknownActor: "pengguna terhapus",
    empty: "Belum ada deploy. Unggah binary pertama untuk menjalankan situs ini.",
    kinds: { deploy: "Deploy", rollback: "Rollback" } satisfies Record<DeployKind, string>,
  },
} as const;
