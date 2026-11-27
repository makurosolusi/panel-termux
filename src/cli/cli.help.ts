// Help text (PLAN/07 §2.1, K4): command and flag names in English, everything else plain Indonesian.

/** Commands known to the dispatcher, in help order. */
export const COMMAND_NAMES = ["serve", "init", "doctor", "docs", "env", "rollback"] as const;
/** One dispatcher command name. */
export type CommandName = (typeof COMMAND_NAMES)[number];

/** General help (`panel -h`, and bare `panel` on a terminal). */
export const GENERAL_HELP = `Panel Termux — panel admin untuk server di HP Android (Termux).

Pemakaian: panel <perintah> [opsi]

Perintah:
  panel serve             Jalankan server panel (runit menjalankan ./panel tanpa argumen).
  panel init [opsi]       Pasang, perbarui, atau perbaiki panel di HP ini. Coba dulu: panel init --dry-run
  panel doctor [--json]   Periksa HP: paket, layanan, .env, situs, tunnel. Tidak mengubah apa pun.
  panel docs [topik]      Panduan singkat: google, cloudflare, android, paket.
  panel env [--full]      Cetak template .env kosong. Contoh: panel env > .env.new
  panel rollback [--db]   Kembali ke binary sebelumnya (panel.prev).

Opsi:
  -h, --help              Bantuan ini, atau bantuan satu perintah: panel <perintah> --help
  -v, --version           Versi panel.
  --lang <en|id>          Bahasa keluaran (bawaan: PANEL_LANG, lalu LANG, lalu en).

Memasang atau memperbarui panel: jalankan lagi baris pasang (README), atau <binary baru> init.
Kode keluar: 0 berhasil, 1 gagal, 2 salah pakai, 3 butuh tindakan lalu ulangi, 4 dibatalkan.`;

/** Printed after the general help when bare `panel` runs on a terminal (K2). */
export const SERVE_HINT = "→ untuk menjalankan server: panel serve";

/** Extra line for `panel upgrade`, which waits for signed releases (C14). */
export const UPGRADE_HINT = "→ untuk memperbarui: jalankan lagi baris pasang (README), atau <binary baru> init";

/** Help of each command (`panel <perintah> --help`). */
export const COMMAND_HELP: Record<CommandName, string> = {
  serve: `Pemakaian: panel serve

Menjalankan server panel di 127.0.0.1:<PORT> dengan .env di folder kerja.
Bila panel lain sudah menjawab di PORT, keluar dengan kode 1 tanpa mengubah apa pun.`,
  init: `Pemakaian: panel init [opsi]

Menyiapkan HP ini: memasang panel ke ~/panel/panel, lalu paket, runit, PostgreSQL, .env, pm2, tunnel, Termux:Boot,
dan menyalakan panel. Aman dijalankan ulang: yang sudah ada tidak ditimpa. Mode dipilih dari keadaan HP:
  HP baru       belum ada data (PostgreSQL, ~/.cloudflared, ~/.pm2, ~/sites, panel.db): semua langkah.
  upgrade       binary ini lebih baru dari yang terpasang: hanya binary dan restart layanan panel.
  cek/perbaiki  versi sama: hanya melengkapi yang belum ada; paket, PostgreSQL, Termux:Boot butuh terminal.
Binary yang lebih lama dari yang terpasang ditolak; untuk kembali: panel rollback [--db].

Opsi:
  -y, --yes                Jawab ya untuk rencana (juga restart panel saat upgrade, tanpa terminal).
  --dry-run                Hanya cetak rencana; tidak ada yang diubah.
  --hostname <domain>      Domain panel, mis. panel.contoh.com (tidak ditanya lagi).
  --admin-email <email>    Email Google super admin; boleh diulang.
  --skip <bagian>          Lewati postgres, tunnel, atau boot; boleh diulang.
  --ssh-key <sumber>       Tambah kunci SSH dari URL https://, file, atau - (stdin), lalu nyalakan sshd.
  --skip-verify            Lewati cek binary terhadap SHA256SUMS rilis (hanya di terminal, dengan konfirmasi).

Kode keluar: 0 selesai, 1 gagal, 2 salah pakai, 3 butuh tindakan lalu ulangi, 4 dibatalkan, 130 Ctrl-C.`,
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
