// Help text (PLAN/07 §2.1, K4): command and flag names in English, everything else plain Indonesian.

/** Commands known to the 0.5.0 dispatcher, in help order. */
export const COMMAND_NAMES = ["serve", "doctor", "docs", "env", "rollback"] as const;
/** One dispatcher command name. */
export type CommandName = (typeof COMMAND_NAMES)[number];

/** General help (`panel -h`, and bare `panel` on a terminal). */
export const GENERAL_HELP = `Panel Termux — panel admin untuk server di HP Android (Termux).

Pemakaian: panel <perintah> [opsi]

Perintah:
  panel serve             Jalankan server panel (runit menjalankan ./panel tanpa argumen).
  panel doctor [--json]   Periksa HP: paket, layanan, .env, situs, tunnel. Tidak mengubah apa pun.
  panel docs [topik]      Panduan singkat: google, cloudflare, android, paket.
  panel env [--full]      Cetak template .env kosong. Contoh: panel env > .env.new
  panel rollback [--db]   Kembali ke binary sebelumnya (panel.prev).

Opsi:
  -h, --help              Bantuan ini, atau bantuan satu perintah: panel <perintah> --help
  -v, --version           Versi panel.

Memasang atau memperbarui panel: jalankan lagi perintah install.sh (README).
Kode keluar: 0 berhasil, 1 gagal, 2 salah pakai, 3 butuh tindakan lalu ulangi, 4 dibatalkan.`;

/** Printed after the general help when bare `panel` runs on a terminal (K2). */
export const SERVE_HINT = "→ untuk menjalankan server: panel serve";

/** Extra line for names that exist only in later releases or never (`init` 0.5.1, `upgrade` C14). */
export const INSTALL_HINT = "→ untuk memasang atau memperbarui: jalankan lagi perintah install.sh (README)";

/** Help of each command (`panel <perintah> --help`). */
export const COMMAND_HELP: Record<CommandName, string> = {
  serve: `Pemakaian: panel serve

Menjalankan server panel di 127.0.0.1:<PORT> dengan .env di folder kerja.
Bila panel lain sudah menjawab di PORT, keluar dengan kode 1 tanpa mengubah apa pun.`,
  doctor: `Pemakaian: panel doctor [--json]

Memeriksa HP tanpa mengubah apa pun: Termux, paket, layanan runit, ~/panel/.env, kartu Persiapan situs, tunnel.
Setiap ❌/⚠️ diikuti langkah berikutnya (→).

Opsi:
  --json   Laporan JSON lengkap ke stdout (skema 1).

Kode keluar: 0 tidak ada error (peringatan boleh), 1 ada error.`,
  docs: `Pemakaian: panel docs [topik]

Tanpa topik: daftar topik. Topik: google, cloudflare, android, paket.`,
  env: `Pemakaian: panel env [--full]   (sama dengan: panel --env)

Mencetak template .env dengan nilai kosong ke stdout; catatan ke stderr. Isi .env Anda tidak pernah dibaca.
Jangan menimpa .env yang sudah berisi: tulis ke file baru, lalu salin nilainya.
  panel env > .env.new

Opsi:
  --full   Sertakan variabel opsional (dikomentari, dengan nilai bawaan).`,
  rollback: `Pemakaian: panel rollback [--db] [-y]

Menukar ~/panel/panel dengan ~/panel/panel.prev lalu me-restart layanan panel. Rollback dua kali = kembali lagi.

Opsi:
  --db        Juga pulihkan panel.db dari snapshot terbaru (data setelah waktu snapshot hilang).
  -y, --yes   Tanpa konfirmasi (wajib bila tidak di terminal).`,
};
