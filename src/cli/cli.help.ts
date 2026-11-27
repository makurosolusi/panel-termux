// Help text (PLAN/07 §2.1, K4; PLAN/08 §6): command and flag names in English; text in the active locale (default
// English).
import type { Locale } from "../shared/locale";

/** Commands known to the dispatcher, in help order. */
export const COMMAND_NAMES = ["serve", "init", "doctor", "docs", "env", "rollback"] as const;
/** One dispatcher command name. */
export type CommandName = (typeof COMMAND_NAMES)[number];

/** General help (`panel -h`, and bare `panel` on a terminal), per locale. */
export const GENERAL_HELP: Record<Locale, string> = {
  en: `Panel Termux — admin panel for a server on an Android phone (Termux).

Usage: panel <command> [options]

Commands:
  panel serve             Run the panel server (runit runs ./panel without arguments).
  panel init [options]    Install, update or repair the panel on this phone. Try first: panel init --dry-run
  panel doctor [--json]   Check the phone: packages, services, .env, sites, tunnel. Changes nothing.
  panel docs [topic]      Short guides: google, cloudflare, android, packages.
  panel env [--full]      Print an empty .env template. Example: panel env > .env.new
  panel rollback [--db]   Go back to the previous binary (panel.prev).

Options:
  -h, --help              This help, or the help of one command: panel <command> --help
  -v, --version           Panel version.
  --lang <en|id>          Output language (default: PANEL_LANG, then LANG, then en).

To install or update the panel: run the install line again (README), or <new binary> init.
Exit codes: 0 success, 1 failed, 2 wrong usage, 3 action needed then run again, 4 cancelled.`,
  id: `Panel Termux — panel admin untuk server di HP Android (Termux).

Pemakaian: panel <perintah> [opsi]

Perintah:
  panel serve             Jalankan server panel (runit menjalankan ./panel tanpa argumen).
  panel init [opsi]       Pasang, perbarui, atau perbaiki panel di HP ini. Coba dulu: panel init --dry-run
  panel doctor [--json]   Periksa HP: paket, layanan, .env, situs, tunnel. Tidak mengubah apa pun.
  panel docs [topik]      Panduan singkat: google, cloudflare, android, packages.
  panel env [--full]      Cetak template .env kosong. Contoh: panel env > .env.new
  panel rollback [--db]   Kembali ke binary sebelumnya (panel.prev).

Opsi:
  -h, --help              Bantuan ini, atau bantuan satu perintah: panel <perintah> --help
  -v, --version           Versi panel.
  --lang <en|id>          Bahasa keluaran (bawaan: PANEL_LANG, lalu LANG, lalu en).

Memasang atau memperbarui panel: jalankan lagi baris pasang (README), atau <binary baru> init.
Kode keluar: 0 berhasil, 1 gagal, 2 salah pakai, 3 butuh tindakan lalu ulangi, 4 dibatalkan.`,
};

/** Printed after the general help when bare `panel` runs on a terminal (K2). */
export const SERVE_HINT: Record<Locale, string> = {
  en: "→ to run the server: panel serve",
  id: "→ untuk menjalankan server: panel serve",
};

/** Extra line for `panel upgrade`, which waits for signed releases (C14). */
export const UPGRADE_HINT: Record<Locale, string> = {
  en: "→ to update: run the install line again (README), or <new binary> init",
  id: "→ untuk memperbarui: jalankan lagi baris pasang (README), atau <binary baru> init",
};

/** Help of each command (`panel <command> --help`), per locale. */
export const COMMAND_HELP: Record<Locale, Record<CommandName, string>> = {
  en: {
    serve: `Usage: panel serve

Runs the panel server on 127.0.0.1:<PORT> with the .env in the working directory.
If another panel already answers on PORT, exits with code 1 without changing anything.`,
    init: `Usage: panel init [options]

Sets up this phone: installs the panel to ~/panel/panel, then packages, runit, PostgreSQL, .env, pm2, tunnel,
Termux:Boot, and starts the panel. Safe to run again: nothing that exists is overwritten. The mode follows the phone:
  new phone     no data yet (PostgreSQL, ~/.cloudflared, ~/.pm2, ~/sites, panel.db): every step.
  upgrade       this binary is newer than the installed one: only the binary and a panel service restart.
  check/repair  same version: only completes what is missing; packages, PostgreSQL, Termux:Boot need a terminal.
A binary older than the installed one is refused; to go back: panel rollback [--db].

Options:
  -y, --yes                Answer yes to the plan (also restarts the panel on upgrade, without a terminal).
  --dry-run                Only print the plan; nothing is changed.
  --hostname <domain>      Panel domain, e.g. panel.example.com (not asked again).
  --admin-email <email>    Google email of a super admin; may be repeated.
  --skip <part>            Skip postgres, tunnel or boot; may be repeated.
  --ssh-key <source>       Add an SSH key from an https:// URL, a file or - (stdin), then start sshd.
  --skip-verify            Skip checking the binary against the release SHA256SUMS (terminal only, asks first).
  --lang <en|id>           Language of the output; on a terminal, init asks once and saves PANEL_LANG.

Exit codes: 0 done, 1 failed, 2 wrong usage, 3 action needed then run again, 4 cancelled, 130 Ctrl-C.`,
    doctor: `Usage: panel doctor [--json]

Checks the phone without changing anything: Termux, packages, runit services, ~/panel/.env, the sites Setup card,
tunnel. Every ❌/⚠️ is followed by the next step (→).

Options:
  --json   Full JSON report on stdout (schema 1).

Exit codes: 0 no errors (warnings allowed), 1 at least one error.`,
    docs: `Usage: panel docs [topic]

Without a topic: the list of topics. Topics: google, cloudflare, android, packages.`,
    env: `Usage: panel env [--full]   (same as: panel --env)

Prints a .env template with empty values to stdout; notes go to stderr. Your .env is never read.
Do not overwrite a .env that has values: write to a new file, then copy the values over.
  panel env > .env.new

Options:
  --full   Include the optional variables (commented out, with their defaults).`,
    rollback: `Usage: panel rollback [--db] [-y]

Swaps ~/panel/panel with ~/panel/panel.prev, then restarts the panel service. Rolling back twice = back again.

Options:
  --db        Also restore panel.db from the newest snapshot (data written after the snapshot is lost).
  -y, --yes   No confirmation (required without a terminal).`,
  },
  id: {
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
  --lang <en|id>           Bahasa keluaran; di terminal, init bertanya sekali lalu menyimpan PANEL_LANG.

Kode keluar: 0 selesai, 1 gagal, 2 salah pakai, 3 butuh tindakan lalu ulangi, 4 dibatalkan, 130 Ctrl-C.`,
    doctor: `Pemakaian: panel doctor [--json]

Memeriksa HP tanpa mengubah apa pun: Termux, paket, layanan runit, ~/panel/.env, kartu Persiapan situs, tunnel.
Setiap ❌/⚠️ diikuti langkah berikutnya (→).

Opsi:
  --json   Laporan JSON lengkap ke stdout (skema 1).

Kode keluar: 0 tidak ada error (peringatan boleh), 1 ada error.`,
    docs: `Pemakaian: panel docs [topik]

Tanpa topik: daftar topik. Topik: google, cloudflare, android, packages.`,
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
  },
};
