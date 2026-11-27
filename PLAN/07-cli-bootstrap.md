# PLAN 07 — CLI di binary: `-h`, `-v`, `doctor`, `docs`, `init`, `upgrade`, `rollback`

Ditulis `wkr-cli-plan-01`, 2026-11-27. Dasar riset: `R&D/08-cli-bootstrap.md` (inventaris 27 langkah, verifikasi Bun /
Termux / cloudflared, pembanding industri). Mengikuti `PLAN/DECISIONS.md` (terutama B14, B18, B23, C1, C3, C5, C6) dan
aturan global (`~/.claude/CLAUDE.md`). Status: **rencana, belum ada kode**.

## 0. Ringkasan

Binary `panel` mendapat CLI. Tanpa argumen tetap menjalankan server (runit tidak berubah). `doctor` memeriksa HP
tanpa mengubah apa pun dan memakai pemeriksaan yang sama dengan kartu Persiapan. `init` membangun ekosistem dari
Termux kosong (paket, runit, postgres, pm2, `.env` lewat prompt, tunnel Cloudflare, Termux:Boot), lalu menyalakan
panel. `init` idempoten dan aman di HP yang sudah jalan (POCO): ia hanya **mengisi yang belum ada**, tidak pernah
menimpa. `upgrade`/`rollback` mengganti binary dari rilis GitHub dengan verifikasi SHA-256 dan `panel.prev`.
`install.sh` menyusut menjadi: cek HP → unduh → verifikasi → `exec panel init`.

## 1. Keputusan PLAN

| #   | Keputusan                                                                                                                                                                                                                                                      | Alasan / bukti                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| K1  | Entry build baru `src/server/main.ts` (tipis): tanpa argumen → `(await import("./boot")).start()`; selain itu → `(await import("../cli/cli.main")).runCli(argv)`. `src/server/index.ts` tetap (diimpor test).                                                  | R&D/08 temuan 4: `import()` dinamis ter-bundle, server tidak dievaluasi untuk `-v`.                    |
| K2  | Jalur serve **byte-identik perilakunya**: argumen kosong saja yang serve; `panel serve` = alias eksplisit. Argumen tak dikenal → exit 2, **tidak pernah** jatuh ke serve.                                                                                         | Menutup bahaya `panel --version` menyalakan panel kedua (R&D/08 temuan 1).                             |
| K3  | Parser: `node:util` `parseArgs` (`strict: true`, `allowPositionals: true`). `--v`/`--h` dinormalisasi ke `--version`/`--help` sebelum parse. Tanpa dependency baru.                                                                                              | Terverifikasi di binary (R&D/08 §3.4). Rule 10.                                                        |
| K4  | Nama perintah dan flag **Inggris** (konvensi CLI), semua output **Indonesia** polos.                                                                                                                                                                             | Sama dengan `sv`, `pkg`, `cloudflared`; copy produk tetap Indonesia.                                   |
| K5  | Pemeriksaan integrasi (`sites_dir` … `cloudflare_token`) **dipanggil**, bukan disalin: `createIntegration(ctx).get()` + copy `idSiteSetup.checks` dari `src/web/i18n/id.site.setup.ts`. Pemeriksaan baru khusus bootstrap ada di `src/cli/doctor.checks.ts`. | Satu sumber kebenaran (permintaan pemilik).                                                            |
| K6  | CLI **tidak menerapkan fix integrasi** (ecosystem, run script pm2, apps.json) pada file yang sudah ada. Ia hanya membuat yang **belum ada** (pola `put_once` server-termux / fix `sites_dir_create`). File yang ada → rujuk ke **Situs → Persiapan** (lock, audit, backup, undo).                                          | CLI tidak bisa ikut lock job panel (R&D/08 §5.2); C1/C3/C5/C6 sudah dijamin di UI.                    |
| K7  | Paket: pasang **hanya yang belum ada**. `pkg upgrade` hanya di HP baru (tidak ada satu pun tanda instalasi, R&D/08 §5.2) dan hanya bila dikonfirmasi. Tidak pernah di HP yang sudah jalan.                                                                       | Upgrade mayor postgres + `prerm` cloudflared (R&D/08 temuan 6–7).                                      |
| K8  | Node: node apa pun yang sudah ada diterima; bila tidak ada → `nodejs-lts`. pm2 dipasang `npm install -g pm2@7.1.2` bila `$PREFIX/lib/node_modules/pm2/bin/pm2-runtime` tidak ada. CLI tidak memanggil CLI `pm2` (B14).                                          | Konflik `nodejs`/`nodejs-lts`; versi lab E1–E11.                                                       |
| K9  | Restart: `panel` boleh di-restart oleh `init`/`upgrade`/`rollback` setelah konfirmasi (aksi itu sendiri diminta pengguna). **pm2 tidak pernah di-restart** oleh CLI (C3); hanya `sv up` untuk layanan yang belum jalan. **cloudflared** di-restart hanya bila config baru dibuat CLI di run yang sama, atau dengan konfirmasi eksplisit yang menyebut "semua situs putus beberapa detik". | C3, makuro-solusi tidak boleh putus tanpa izin.                                                        |
| K10 | Rahasia: dibaca lewat prompt tanpa echo, langsung ditulis ke `~/panel/.env` (600) dengan `encodeEnvLine` (B23). Tidak lewat argv, tidak di state file, tidak di log, tidak dicetak ulang. Mode non-interaktif hanya menerima rahasia yang sudah ada di `.env`.     | Rule 7, 12.                                                                                            |
| K11 | CLI membaca `~/panel/.env` secara eksplisit dan mengabaikan `process.env` untuk variabel panel (binary memuat `.env` dari cwd).                                                                                                                                  | R&D/08 temuan 3.                                                                                       |
| K12 | Doctor **read-only**: tidak membuat `panel.db` (buka read-only bila ada, selain itu DB `:memory:` termigrasi), tidak membaca `data/secret`, tidak memanggil `ensureAppsJson`/`verify`, tidak menulis file apa pun.                                                 | `openDb` membuat file; `verify()` membuat `apps.json`.                                                 |
| K13 | Mode fake mengikuti aturan yang sudah ada: tanpa `$PREFIX/bin/sv` → `createFakeSystem` + host fake CLI. Skenario fake dipilih `PANEL_CLI_FAKE=fresh\|ready\|poco` (default `ready`).                                                                            | `selectSystem`; test shell di CI (ubuntu) dan Mac.                                                     |
| K14 | `install.sh` = bootstrap tipis yang `exec` binary hasil unduhan: `exec "$BIN" init "$@" </dev/tty` (bila `/dev/tty` ada). Kontrak exit 0/1/3 dipertahankan.                                                                                                       | Permintaan pemilik; landing/README tetap satu perintah.                                                |
| K15 | Tarball rilis **tidak berubah** di 0.5.0 (binary + `install-phone.sh` + `deploy/*` + `.env.example`); binary meng-embed semua template yang ia tulis. `install-phone.sh` dihapus di rilis sesudahnya.                                                             | Pengguna yang mem-pin versi lama tidak rusak; satu langkah per rilis.                                  |
| K16 | Versi rilis: **0.5.0** = P0 + P1 + `upgrade`/`rollback` (P2a). P2b (Access lewat API, dsb.) = backlog.                                                                                                                                                          | Fitur baru (semver minor), C7 pola rilis.                                                              |

## 2. Perintah, flag, exit code

### 2.1 Daftar

| Perintah                             | Flag                                                                                                       | Mengubah HP? | Fase |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------ | ---- |
| `panel`                              | –                                                                                                          | serve        | ada  |
| `panel serve`                        | –                                                                                                          | serve        | P0   |
| `panel -h`, `--help`, `--h`          | juga `panel <perintah> --help`                                                                             | tidak        | P0   |
| `panel -v`, `--version`, `--v`       | `--json`                                                                                                   | tidak        | P0   |
| `panel doctor`                       | `--json`                                                                                                   | tidak        | P0   |
| `panel docs [topik]`                 | tanpa topik = daftar topik                                                                                 | tidak        | P0   |
| `panel init`                         | `-y/--yes`, `--hostname <fqdn>`, `--admin-email <email>` (boleh berulang), `--tunnel <nama>`, `--port <n>`, `--skip <postgres\|tunnel\|boot>` (boleh berulang), `--dry-run` | ya           | P1   |
| `panel upgrade`                      | `--to <vX.Y.Z>`, `--check`, `-y/--yes`                                                                     | ya           | P2a  |
| `panel rollback`                     | `--db`, `-y/--yes`                                                                                         | ya           | P2a  |

`-v` mencetak satu baris `panel-termux 0.5.0 (android-arm64, bun 1.4.2)`; `--json` → `{"name":"panel-termux",
"version":"0.5.0","platform":"android","arch":"arm64","bun":"1.4.2"}`. Platform/arch dari `process.platform`/
`process.arch`, versi dari `package.json` (sudah diimpor `boot.ts`).

`init --dry-run` = cetak rencana lalu keluar 0 tanpa menulis (sama dengan menjawab "tidak", tetapi exit 0).

### 2.2 Exit code (sama untuk semua perintah)

| Kode | Arti                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 0    | Berhasil; `doctor`: tidak ada `error` (peringatan boleh)                                                 |
| 1    | Gagal (pesan menyebut operasi + penyebab); `doctor`: ≥ 1 `error`                                         |
| 2    | Salah pakai: perintah/flag tak dikenal, nilai flag tidak valid                                           |
| 3    | Butuh tindakan pengguna lalu jalankan lagi: rahasia belum ada tanpa TTY, login Cloudflare belum selesai, pacman, Termux perlu dibuka ulang (fallback L1). Kompatibel dengan `install-phone.sh`/`install.sh` sekarang |
| 4    | Dibatalkan pengguna (menjawab tidak pada konfirmasi)                                                    |
| 130  | Ctrl-C (SIGINT); langkah yang sedang berjalan dibiarkan dalam keadaan konsisten (tulis atomik)           |

### 2.3 Gaya output

- Polos, satu baris per hal, Indonesia, tanpa warna wajib. Simbol: `✅` ok, `⚠️` peringatan, `❌` error, `ℹ️` info,
  `→` langkah berikutnya. `NO_COLOR` dihormati bila nanti ada warna; stdout bukan TTY → tanpa spinner.
- Setiap `❌`/`⚠️` diikuti satu baris `→` berisi tindakan: `panel init`, "buka Situs → Persiapan", atau perintah manual.
- Pesan error memakai pola Rule 11: `❌ Gagal memasang nodejs-lts: pkg keluar dengan kode 100. → Periksa koneksi,
  lalu jalankan panel init lagi.` Nilai rahasia tidak pernah muncul; untuk `.env` hanya nama variabel.
- Contoh `doctor`:

```text
Panel Termux 0.5.0 — pemeriksaan HP (tidak ada yang diubah)

Termux
  ✅ HP 64-bit (arm64)
  ✅ Ruang kosong 3,1 GB
Paket
  ✅ termux-services
  ❌ cloudflared belum terpasang
     → jalankan: panel init
Layanan
  ✅ runit berjalan
  ✅ panel berjalan (v0.5.0, sehat)
  ⚠️ pm2 berjalan tanpa --no-auto-exit
     → buka Situs → Persiapan di panel
Situs (sama dengan kartu Persiapan)
  ❌ Blok apps.json belum ada di ecosystem.config.js
     → buka Situs → Persiapan, tekan Perbaiki
Tunnel
  ✅ Login Cloudflare (cert.pem)
  ✅ panel.contoh.com ada di ingress
Tidak bisa dicek dari Termux
  ℹ️ Pengaturan Android: pembatas proses anak, baterai tanpa batasan, autostart (panel docs android)

Hasil: 1 error, 1 peringatan.
```

## 3. `doctor`

### 3.1 Pemeriksaan

Kunci stabil (dipakai `--json` dan test). Kolom **Sumber**: fungsi yang dipakai; "baru" = `src/cli/doctor.checks.ts`
(fungsi murni dari `DoctorProbe`, lihat §3.3).

| Grup       | Kunci                                                     | Gagal = | Sumber                                                                      |
| ---------- | --------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| termux     | `arch_arm64`                                              | error   | baru (`process.arch`)                                                       |
| termux     | `termux_prefix`                                           | error   | baru (`termuxPrefix()` ada)                                                 |
| termux     | `disk_free` (< 400 MB error, < 1 GB warning)              | error   | baru (`statfsSync`, sama dengan `health.service.ts`)                        |
| termux     | `pkg_manager_apt`                                         | error   | baru (`TERMUX_APP_PACKAGE_MANAGER`)                                         |
| paket      | `pkg_termux_services`, `pkg_cloudflared`                  | error   | baru (`dpkg -s`)                                                            |
| paket      | `node`, `pm2`                                             | error   | baru (`$PREFIX/bin/node`, file `pm2-runtime`)                               |
| paket      | `pkg_postgresql`, `pkg_termux_api`                        | warning | baru                                                                        |
| layanan    | `service_daemon` (runsvdir hidup: pidfile + `kill -0`)    | error   | baru                                                                        |
| layanan    | `svc_panel`, `svc_pm2`, `svc_cloudflared`, `svc_postgres` | error / warning untuk postgres | `RunitAdapter.supervise()` (ada)                         |
| layanan    | `cloudflared_down_file`, `cloudflared_run_script` (template paket vs run kustom, R&D/08 §5.3) | warning | baru                                   |
| layanan    | `postgres_initdb` (`PG_VERSION`)                          | warning | baru                                                                        |
| panel      | `binary_installed` (+ versi terpasang vs binary ini → info) | error | baru (`~/panel/panel`; versi dari `/api/health` bila jalan)                 |
| panel      | `env_complete` (nama variabel kosong)                     | error   | baru; aturan sama dengan `REQUIRED_VARS` `install-phone.sh`                 |
| panel      | `env_valid`                                               | error   | `parseEnv(isi file)` (pesan `EnvError` tanpa nilai)                          |
| panel      | `data_dir_private` (mode 700)                             | warning | baru                                                                        |
| panel      | `panel_health`                                            | error   | `NetAdapter.httpStatus(PORT, "/api/health")` (ada)                          |
| situs      | 12 kunci `IntegrationCheckKey` (persis, termasuk aturan "moot") | sesuai UI | `createIntegration(ctx).get()` (ada)                                   |
| tunnel     | `cf_cert`, `cf_config` (tunnel id), `cf_panel_ingress` (host `APP_BASE_URL` di ingress) | error | `readTunnelId`, `ingressHostnames` (ada)             |
| tunnel     | `panel_public` (GET `https://<host>/api/health`)          | warning | `probeHttps` (ada); dilewati bila tidak ada internet                        |
| boot       | `termux_boot_script` (ada skrip di `~/.termux/boot/` yang memanggil `service-daemon`/`ensure-services`/`start-services`) | warning | baru |
| manual     | `android_settings`, `cloudflare_access`                   | info    | teks tetap (tidak bisa dicek); `access` juga di onboarding `/dev`          |

Catatan:

- Grup `situs` hanya dijalankan bila `termux_prefix` ok. Konteks: `FixCtx {db, secret: "", system}` dengan `db` dari
  K12. Label diambil dari `idSiteSetup.checks[key][state]` (fungsi copy dipanggil dengan `params`), jadi teks = UI.
- Item onboarding (`secret_saved`, `backup`, …) tidak dihitung ulang: doctor mencetak satu baris info "Checklist
  penyiapan ada di Administrasi → Penyiapan" bila panel sehat.
- Timeout per pemeriksaan jaringan: `panel_health` 3 dtk, `panel_public` 5 dtk. Total doctor di HP < 5 dtk (diukur L4).

### 3.2 `--json`

```json
{
  "schema": 1,
  "panelVersion": "0.5.0",
  "mode": "termux",
  "ok": false,
  "summary": { "ok": 21, "warning": 1, "error": 2, "info": 2 },
  "checks": [
    {
      "group": "paket",
      "key": "pkg_cloudflared",
      "state": "error",
      "label": "cloudflared belum terpasang",
      "action": "init",
      "hint": "jalankan: panel init",
      "params": {}
    }
  ]
}
```

`action`: `"init" | "ui" | "manual" | null`. `ok` = tidak ada `error`. `params` = `JobParams` (tanpa nilai rahasia,
sama dengan API integrasi). Skema dibekukan di `src/shared/doctor.types.ts`.

### 3.3 Struktur

```text
doctor.probe.ts   → kumpulkan fakta (fs, dpkg, runit, http) lewat CliHost + SystemAdapters → DoctorProbe
doctor.checks.ts  → fungsi murni DoctorProbe → DoctorCheck[] (bootstrap)
doctor.command.ts → probe + checks + integration.get() → cetak / JSON → exit code
```

`init` memakai `doctor.probe` + `doctor.checks` yang sama untuk menyusun rencananya (§4.1): satu deteksi untuk
doctor dan init.

## 4. `init`

### 4.1 Alur

`init` = **deteksi → rencana → konfirmasi → jalankan langkah → verifikasi → ringkasan**. Setiap langkah menghitung
ulang keadaannya dari sistem, jadi rerun melanjutkan dari mana pun (tanpa state wajib).

| #   | Langkah            | Deteksi (lewat)                                         | Aksi bila kurang                                                                                                                                                                                                                                    | Di HP yang sudah jalan                                                          |
| --- | ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 0   | Prasyarat          | arch, prefix, ruang, lock, TTY                          | Gagal → exit 1; ambil lock `~/panel/.init.lock` (`O_EXCL`, berisi pid; basi bila pid mati)                                                                                                                                                         | sama                                                                            |
| 1   | Binary             | `~/panel/panel` ada & SHA-256 sama dengan `process.execPath` | Salin diri ke `panel.new` (755) → `panel` lama ke `panel.prev` → `mv` (pola `install-phone.sh`); `~/panel/data` 700; symlink `$PREFIX/bin/panel` → `~/panel/panel` bila belum ada atau sudah milik kita              | Binary beda & panel `run` → ditandai "perlu restart" untuk langkah 10           |
| 2   | Paket              | `dpkg -s`, node, `pm2-runtime`                          | HP baru: tawarkan `pkg upgrade` dulu. Lalu `DEBIAN_FRONTEND=noninteractive pkg install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold <yang hilang>`; `npm install -g pm2@7.1.2`. Verifikasi ulang dengan `dpkg -s` | Hanya yang hilang; tanpa `pkg upgrade`                                          |
| 3   | runit              | runsvdir hidup                                          | `service-daemon start` dengan `SVDIR`/`LOGDIR` di-export; tunggu pidfile ≤ 15 dtk. Bila L1 gagal: exit 3 "tutup dan buka lagi Termux, lalu `panel init`" (binary sudah terpasang di langkah 1)                                                 | Tidak ada aksi bila hidup                                                       |
| 4   | Postgres           | `PG_VERSION`, `svc_postgres`                            | `initdb -D $PREFIX/var/lib/postgresql -U postgres --auth-local=trust --auth-host=scram-sha-256`; hapus `down`, `sv up postgres`                                                                                                                  | Data ada → tidak disentuh; layanan mati → hanya disebut (doctor/UI punya tombol) |
| 5   | `.env`             | `env_complete`, `env_valid`                             | Buat dari `.env.example` ter-embed (600). Tanya **hanya** yang kosong (§4.3). Validasi `parseEnv`                                                                                                                                                  | Nilai yang ada tidak pernah ditanya ulang/ditimpa                               |
| 6   | Layanan panel      | `$SVDIR/panel/run` sama dengan template                 | Folder `.panel.new` → `run` + `log/run` → rename; `down` selama `.env` belum lengkap                                                                                                                                                              | Run script beda → peringatan saja, tidak ditimpa                                |
| 7   | pm2                | `ecosystem.config.js`, `apps.json`, `$SVDIR/pm2`        | **Hanya bila ketiganya tidak ada**: `ecosystemFromTemplate`, `apps.json` `[]`, run script pm2 ter-embed (folder `.pm2.new` → rename), `sv up pm2`                                                                                                 | Tidak menulis apa pun; hasil integrasi dicetak + "buka Situs → Persiapan" (K6)  |
| 8   | Tunnel             | `cf_cert`, `cf_config`, `cf_panel_ingress`, DNS         | §4.4                                                                                                                                                                                                                                                | Hanya menambah rute panel bila belum ada (dengan konfirmasi)                    |
| 9   | Boot               | `termux_boot_script`                                    | Tulis `~/.termux/boot/panel-termux` (755): `termux-wake-lock` + `service-daemon start` dengan `SVDIR`; panggil `termux-wake-lock` sekarang                                                                                                         | Ada skrip yang sudah menyalakan layanan (POCO: `start-services`) → tidak ditulis |
| 10  | Nyalakan & cek     | `svc_panel`, `panel_health`                             | Hapus `down`; belum jalan → `sv up panel`; binary baru & sedang jalan → konfirmasi lalu `sv -w 130 restart panel`. Tunggu `/api/health` ≤ 30 dtk; cek versi = binary ini                                                                         | Restart hanya dengan konfirmasi                                                 |
| 11  | Ringkasan          | doctor                                                  | Cetak hasil doctor singkat + langkah manual tersisa (Access, pengaturan Android, OAuth bila dilewati) + URL panel                                                                                                                                  | sama                                                                            |

Rencana dicetak sebelum langkah 1 dijalankan, dalam bahasa awam, satu baris per aksi, lalu satu pertanyaan
`Lanjutkan? [Y/n]`. Konfirmasi tambahan hanya untuk aksi berisiko (restart panel yang sedang jalan, restart
cloudflared, `pkg upgrade`). `--yes` menjawab ya untuk rencana dan HP baru; **restart layanan yang sedang melayani
(panel/cloudflared) di HP lama tetap butuh TTY atau tidak dijalankan** (dicetak sebagai langkah berikutnya, exit 0).

Contoh rencana (HP baru):

```text
Panel Termux 0.5.0 — penyiapan HP

HP ini belum punya instalasi panel. Yang akan dilakukan:
  1. Memasang panel ke ~/panel/panel
  2. Memperbarui paket Termux (pkg upgrade), lalu memasang: termux-services, nodejs-lts, postgresql, cloudflared, termux-api
  3. Memasang pm2 7.1.2 (npm)
  4. Menyalakan runit, menyiapkan PostgreSQL
  5. Menanyakan alamat panel, email admin, dan OAuth client Google (disimpan di ~/panel/.env)
  6. Login Cloudflare di browser, membuat tunnel, menghubungkan alamat panel
  7. Menyalakan semua otomatis setelah HP menyala (Termux:Boot)
  8. Menyalakan panel dan memeriksanya
Butuh internet, ±10–20 menit. Lanjutkan? [Y/n]
```

### 4.2 State dan resume

- Tidak ada state yang wajib: semua langkah dideteksi ulang dari sistem.
- `~/panel/init.json` (600) hanya menyimpan jawaban non-rahasia yang belum tertulis di tempat lain:
  `{"schema":1,"tunnelName":"…","waitingFor":"cloudflared_login"|null,"updatedAt":"…"}`. Hostname dan email admin
  sudah ada di `.env`; tunnel id ada di `config.yml`.
- Resume setelah exit 3: pengguna menjalankan `panel init` lagi (symlink langkah 1) atau `~/panel/panel init`.
  Pesan exit 3 selalu menyebut perintah persisnya.
- Ctrl-C: tulis file selalu `tmp` + `rename`; folder layanan dibangun bernama titik. Lock dilepas di handler SIGINT.

### 4.3 Prompt `.env`

Urutan dan teks (hanya untuk variabel kosong):

1. `Alamat panel (mis. panel.contoh.com):` → validasi `HOSTNAME_RE` (ada di `site.checks.ts`) → `APP_BASE_URL=https://<host>`.
2. `Email Google pemilik panel (super admin):` → `EMAIL_RE`; boleh beberapa dipisah koma.
3. Cetak blok:
   ```text
   Buat OAuth client Google (tipe "Web application") di console.cloud.google.com → APIs & Services → Credentials.
   Tempel alamat ini di "Authorized redirect URIs":
     https://panel.contoh.com/api/auth/callback/google
   Panduan: panel docs google
   ```
4. `Client ID:` (terlihat) dan `Client secret:` (tanpa echo; cetak `(tersimpan, 35 karakter)` — panjang saja, Rule 7).
5. Setiap jawaban langsung ditulis ke `.env` (atomik, 600) lewat `findEnvLine`/`encodeEnvLine`; baris komentar dan
   variabel lain dipertahankan. Nilai yang ditolak `envValueProblem` ditanya ulang.

Tanpa TTY (pipe, `--yes` tanpa terminal): tidak bertanya; bila ada yang kosong → `down` tetap, exit 3 dengan nama
variabel, sama dengan `install-phone.sh` sekarang. `--hostname`/`--admin-email` boleh dipakai (bukan rahasia);
Client ID/secret **tidak** punya flag.

Prompt rahasia: `process.stdin.setRawMode(true)`, baca sampai Enter, Backspace didukung, Ctrl-C → exit 130,
`setRawMode(false)` di `finally`. Non-rahasia: `prompt()` global Bun.

### 4.4 Tunnel

1. `cert.pem` tidak ada → jelaskan ("Login Cloudflare di browser, pilih domain panel"), jalankan `cloudflared tunnel
   login` dengan stdio diwariskan (pengguna melihat URL), coba `termux-open-url <url>` bila tersedia. Selesai bila
   `cert.pem` muncul. Tanpa TTY → `waitingFor: "cloudflared_login"`, exit 3.
2. `config.yml` tidak ada → nama tunnel: `--tunnel`, atau jawaban prompt dengan default dari Q7 (`panel-contoh-com`).
   `tunnel list -n <nama> -o json`: belum ada → `tunnel create -o json <nama>`; sudah ada **dan** kredensialnya ada di
   `~/.cloudflared/<uuid>.json` → pakai; ada tanpa kredensial → minta nama lain. Tulis `config.yml` (600):
   `tunnel`, `credentials-file`, ingress catch-all `http_status:404` (teks sama dengan server-termux).
3. Host panel belum di ingress → `ingressStep(ctx, st, [host], false, t => insertIngressRule(t, host,
   "http://localhost:<PORT>"))` (validasi `cloudflared … ingress validate`, `config.yml.bak`, rename atomik) — fungsi
   yang sama dengan job situs.
4. DNS → `system.cloudflared.routeDns(tunnelId, host)` (tanpa `--overwrite-dns`; `DnsWrongZoneError` → pesan "cert.pem
   untuk zona lain: login ulang dengan domain yang benar").
5. Layanan cloudflared: pilihan A/B sesuai hasil lab L2 (R&D/08 §5.3). A: `cloudflared tunnel token <nama>` diarahkan
   langsung ke `~/.cloudflared/token` (600), run script paket tidak disentuh. B: tulis run script `exec cloudflared
   tunnel --no-autoupdate run <nama>` (pola server-termux). Lalu hapus `down`, `sv up cloudflared`. Ingress berubah
   dan cloudflared sudah jalan → restart sesuai K9.

`--skip tunnel`: langkah 8 dilewati; ringkasan menyebut panel hanya bisa dibuka di `http://localhost:<PORT>` dan
`APP_BASE_URL` harus `http://localhost:<PORT>` (Google menerima localhost).

### 4.5 Keamanan di instalasi yang sudah ada (ringkas)

| Aturan                                                                                                                               | Dari                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| File yang ada tidak pernah ditimpa: ecosystem, `apps.json`, run script pm2/panel/cloudflared, `config.yml` (kecuali sisip rute panel), `.env` (kecuali mengisi variabel kosong), skrip boot | K6, C1                 |
| Edit `config.yml`: kandidat → `ingress validate` → `.bak` → rename atomik → fsync (fungsi `ingressStep`)                              | PLAN/03 §4             |
| Tidak ada `pkg upgrade`, tidak ada restart pm2, restart panel/cloudflared hanya dengan konfirmasi TTY                                | K7, K9, C3             |
| Tidak ada fix integrasi dari CLI; rujuk UI                                                                                           | K6                     |
| Tidak ada panggilan CLI `pm2`                                                                                                        | B14                    |
| Rahasia tidak pernah dicetak/log/argv                                                                                                | K10                    |
| CLI tidak menulis audit ke `panel.db` (tidak ada aktor login); setiap file yang diubah dicetak dengan path-nya                         | C6 (tidak berlaku: bukan aksi admin panel) |

Uji penerimaan wajib: skenario `poco` (fixture meniru POCO: ecosystem tulisan tangan 0600 tanpa blok, run pm2 tanpa
`--no-auto-exit`, `config.yml` + `cert.pem`, semua layanan `run`) → `init --yes` tidak mengubah satu byte pun di luar
`~/panel/panel*` dan `~/panel/init.json`, tidak memanggil `pkg upgrade`/`sv restart pm2`/`sv restart cloudflared`.

## 5. `upgrade` dan `rollback` (P2a)

### 5.1 `panel upgrade`

1. Target: `--to`, atau tag terbaru dari header `Location` `https://github.com/makurosolusi/panel-termux/releases/latest`
   (tanpa API GitHub, tanpa rate limit; diverifikasi: menunjuk `…/releases/tag/v0.3.0`). Basis URL dari
   `PANEL_RELEASES_URL` (sama dengan `install.sh`) untuk test.
2. Sama dengan versi ini → "sudah versi terbaru", exit 0. Lebih rendah → hanya dengan `--to` + peringatan migrasi
   database tidak mundur. **Target sebelum versi CLI pertama (< 0.5.0) ditolak** (binary lama mengabaikan argumen dan
   akan menyalakan server saat diuji) → arahkan ke `PANEL_VERSION=vX sh install.sh`.
3. `--check` berhenti di sini (exit 0, cetak "tersedia vX").
4. Unduh `SHA256SUMS` + tarball ke `~/panel-src/<tag>/` (pakai ulang bila sudah ada dan cocok, pola `install.sh`),
   cek ruang (3 × ukuran tarball, min 400 MB), verifikasi SHA-256 (`Bun.CryptoHasher`), ekstrak hanya
   `panel-android-arm64` (`tar -xzf … panel-android-arm64`).
5. Uji binary baru: `<baru> --version --json` harus mencetak versi target (membuktikan bisa dieksekusi di HP ini).
6. Rencana + konfirmasi: "0.5.0 → 0.5.1. Panel dimulai ulang (tidak terjangkau beberapa detik; perubahan situs yang
   sedang berjalan ditunggu sampai 2 menit). Database disalin otomatis saat boot." 
7. `panel.new` → `panel.prev` → rename → `sv -w 130 restart panel` → tunggu `/api/health` versi target ≤ 30 dtk.
8. Gagal sehat → tanya "Kembalikan versi lama sekarang? [Y/n]" (`--yes` = ya) → `rollback` tanpa `--db` + petunjuk
   snapshot. Sukses → ringkasan doctor singkat.

### 5.2 `panel rollback`

- Butuh `~/panel/panel.prev`. **Tukar** `panel` ↔ `panel.prev` (rollback dua kali = kembali ke versi baru).
- `--db`: pilih snapshot terbaru di `<PANEL_DATA_DIR>/snapshots/` (nama `panel.db.<versi>.<waktu>`), tampilkan
  versi + waktu + "perubahan data setelah waktu itu hilang", konfirmasi; `sv down panel`; salin `panel.db` sekarang ke
  `snapshots/panel.db.before-rollback.<waktu>` (600); salin snapshot → `panel.db`; hapus `-wal`/`-shm`.
- `sv -w 130 restart panel` (atau `sv up`), tunggu health.
- Menggantikan `rollback_hint` di `install-phone.sh` (petunjuknya menjadi `panel rollback [--db]`).

## 6. `docs`

- `panel docs` = daftar topik; `panel docs <topik>` = cetak teks polos (≤ ±60 baris per topik, lebar ≤ 100 kolom).
- Topik: `instal`, `google`, `cloudflare`, `access`, `android`, `upgrade`, `rollback`, `masalah` (gejala umum →
  perintah doctor/UI).
- Sumber: `docs/cli/<topik>.md` di-embed (`with { type: "text" }`, pola `ecosystem.template.ts`); README menautkan
  folder ini, bukan menyalin. Topik tak dikenal → exit 2 + daftar.

## 7. Arsitektur kode

### 7.1 File baru

| File                              | Isi                                                                                                   | Batas (Rule 8) |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| `src/server/main.ts`              | Entry build (K1), ±15 baris                                                                           | –              |
| `src/cli/cli.main.ts`             | `runCli(argv): Promise<number>`: normalisasi alias, `parseArgs`, dispatch, peta error → exit code      | 150            |
| `src/cli/cli.output.ts`           | `CliOut` (`line`, `check`, `json`), simbol, tulis ke stdout/stderr yang bisa diganti test              | 200            |
| `src/cli/cli.help.ts`             | Teks bantuan umum + per perintah (Indonesia)                                                          | 200            |
| `src/cli/cli.host.ts`             | `CliHost`: `exec` (`runTermux`), `tty` (`isTty`, `ask`, `askSecret`, `confirm`), `paths` (HOME, PREFIX, SVDIR), `pkgInstalled` | 200 |
| `src/cli/cli.host.fake.ts`        | Host fake (skenario `fresh`/`ready`/`poco`, perekam panggilan `exec`)                                 | 250            |
| `src/cli/cli.prompt.ts`           | `askSecret` raw mode, `ask`, `confirm`                                                                 | 150            |
| `src/cli/doctor.probe.ts`         | Kumpulkan `DoctorProbe`                                                                                | 250            |
| `src/cli/doctor.checks.ts`        | Fungsi murni → `DoctorCheck[]`                                                                         | 250            |
| `src/cli/doctor.command.ts`       | Perintah `doctor` (+ integrasi, DB read-only/`:memory:`)                                               | 150            |
| `src/cli/docs.command.ts`         | Perintah `docs` + import topik                                                                         | 100            |
| `src/cli/init.plan.ts`            | Fungsi murni `DoctorProbe` + flag → `InitStep[]` (rencana)                                             | 250            |
| `src/cli/init.run.ts`             | Eksekusi langkah, lock, konfirmasi, ringkasan                                                         | 300            |
| `src/cli/init.packages.ts`        | Langkah 2–4 (pkg, npm, runit, postgres)                                                               | 250            |
| `src/cli/init.files.ts`           | Langkah 1, 6, 7, 9 (binary, layanan, template, boot) — tulis atomik                                   | 250            |
| `src/cli/init.env.ts`             | Langkah 5                                                                                             | 200            |
| `src/cli/init.tunnel.ts`          | Langkah 8                                                                                             | 250            |
| `src/cli/release.fetch.ts`        | Tag terbaru, unduh, SHA-256, ekstrak                                                                  | 200            |
| `src/cli/upgrade.command.ts`      | `upgrade`                                                                                              | 200            |
| `src/cli/rollback.command.ts`     | `rollback`                                                                                             | 150            |
| `src/shared/doctor.types.ts`      | `DoctorCheck`, `DoctorReport` (skema `--json`)                                                         | 100            |
| `src/cli/templates.ts`            | Re-export teks ter-embed: `.env.example`, `deploy/sv/panel/run`, `deploy/pm2/run` (yang terakhir sudah di-embed `fake.integration.ts`) | 50 |
| `docs/cli/*.md`                   | Topik `docs`                                                                                          | –              |
| `scripts/cli.test.sh`             | Test shell binary hasil compile                                                                        | –              |

Tidak ada interface dengan satu implementasi selain `CliHost` (dua: termux + fake, dibutuhkan test dan mode fake).

### 7.2 Peta pemakaian ulang

| Kebutuhan                              | Dipakai dari                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Pemeriksaan integrasi + copy           | `sites/integration.service.ts` `createIntegration`; `web/i18n/id.site.setup.ts` |
| Mode termux/fake, adapter              | `system/system.select.ts` `selectSystem`, `createFakeSystem`                  |
| Status layanan runit                   | `RunitAdapter.supervise`/`control`                                            |
| Health panel                           | `NetAdapter.httpStatus`                                                       |
| Probe https publik                     | `system/cloudflared.termux.ts` `probeHttps`                                   |
| Ingress + validasi + backup            | `sites/site.steps.ts` `ingressStep`, `sites/ingress.editor.ts`                |
| DNS                                    | `CloudflaredAdapter.routeDns`, `DnsWrongZoneError`                            |
| Template ecosystem                     | `sites/ecosystem.template.ts` `ecosystemFromTemplate`                         |
| `apps.json` awal                       | `sites/apps.file.ts` `ensureAppsJson`                                         |
| Tulis `.env`                           | `shared/env.codec.ts` `findEnvLine`, `encodeEnvLine`, `envValueProblem`       |
| Validasi `.env`                        | `server/env.ts` `parseEnv`, `EnvError`                                        |
| Validasi hostname/email                | `sites/site.checks.ts` `HOSTNAME_RE`; `env.ts` `EMAIL_RE` (diekspor)           |
| Exec Termux tanpa shell                | `exec/termux.exec.ts` `runTermux`, `termuxPrefix`                             |
| DB read-only / `:memory:`              | `bun:sqlite` + `drizzle` + `db/migrate.ts` `runMigrations` (bukan `openDb`)    |
| Ruang kosong                           | `statfsSync` (pola `health.service.ts`)                                       |

Perubahan kecil pada file yang ada (pemilik ditetapkan §10): `scripts/build.ts` (entrypoint → `main.ts`),
`src/server/env.ts` (ekspor `EMAIL_RE`), `package.json` (`scripts.dev` tetap `index.ts`; tidak ada dependency baru).

### 7.3 CLI dan ukuran/bundle server

- Arah impor satu jalur: `src/cli/**` boleh mengimpor `src/server/**` dan `src/shared/**`; **`src/server/**` tidak
  pernah mengimpor `src/cli/**`** kecuali `main.ts` lewat `import()` dinamis. Ditegakkan test (`tests/cli.imports.test.ts`
  memindai teks import).
- Bundle web (`bun run bundle:check`, B30/C10) tidak tersentuh: CLI tidak diimpor oleh `src/web/**` (`id.site.setup.ts`
  diimpor CLI, bukan sebaliknya).
- Ukuran binary: tambahan CLI diharapkan < 300 KB (minified, termasuk `docs/cli/*.md`); diukur di kriteria
  penerimaan (`ls -l dist/panel-android-arm64` sebelum/sesudah). Jalur serve mengevaluasi modul yang sama dengan
  sekarang (plus `main.ts`).
- Waktu `panel -v` di HP < 0,5 dtk (L4), karena `boot.ts` tidak dievaluasi.

## 8. Rilis dan `install.sh`

### 8.1 `scripts/install-release.sh` (menjadi bootstrap tipis)

Tetap: `set -eu`, `PANEL_VERSION_DEFAULT` ditanam, cek `aarch64`, `$PREFIX`, `curl`/`tar`/`sha256sum`, ruang 400 MB,
unduh `SHA256SUMS` + tarball, `sha256sum -c`, cache `~/panel-src/<versi>`. Berubah:

- Hapus syarat `termux-services` dan peringatan `cloudflared` (sekarang tugas `init`).
- Ekstrak hanya `panel-android-arm64` dan `VERSION`, lalu:
  ```sh
  BIN="$SRC_DIR/panel-android-arm64"
  if [ -t 0 ] || [ ! -r /dev/tty ]; then exec "$BIN" init "$@"; else exec "$BIN" init "$@" </dev/tty; fi
  ```
  (`curl … | sh` tetap bisa bertanya lewat `/dev/tty`.)
- Header mendokumentasikan exit code = exit code `panel init` (0/1/3/4).
- Pesan sukses/exit 3 dipindah ke `init` (satu tempat).

### 8.2 Lain-lain

- `scripts/package-release.sh`: tidak berubah (K15). `install-phone.sh` tetap ada di tarball 0.5.0 sebagai jalur
  manual "Instal dari source"; README menggantinya dengan `./panel-android-arm64 init`.
- `.github/workflows/ci.yml` dan `release.yml`: tambah langkah `bun run build:local && sh scripts/cli.test.sh
  dist/panel` setelah test shell yang ada.
- `scripts/install-release.test.sh`: sesuaikan (stub binary yang mencatat `init "$@"`, cek `exec` dan propagasi exit).

## 9. Test

### 9.1 Unit (`bun test`, `tests/cli.*.test.ts`, semua dengan `CliHost` fake + HOME/PREFIX sementara)

| File                          | Yang diuji (assertion nyata)                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.args.test.ts`            | `-h`/`--help`/`--h`/`help` sama; `-v`/`--version`/`--v` = versi `package.json`; `--json` valid; flag tak dikenal → 2 tanpa memanggil `boot`; `[]` → serve dipanggil (spy), `serve` sama                   |
| `cli.doctor.test.ts`          | Skenario `fresh` → error `pkg_*`/`binary_installed`, exit 1; `ready` → exit 0; `poco` → `ecosystem_spreads_apps_json` error dengan label persis dari `idSiteSetup`; doctor tidak membuat `panel.db`/`apps.json` (cek fs sebelum/sesudah); JSON cocok `DoctorReport` |
| `cli.init.plan.test.ts`       | `fresh` → 11 langkah termasuk `pkg upgrade`; `poco` → tanpa `pkg upgrade`, tanpa tulis ecosystem/run script, tanpa restart pm2; parsial (cloudflared hilang saja) → hanya langkah paket + tunnel         |
| `cli.init.run.test.ts`        | Perekam `exec`: urutan perintah `fresh`; idempoten (run kedua = 0 aksi tulis); lock kedua → exit 1; Ctrl-C di tengah tidak meninggalkan file `.new`/folder titik; skenario `poco` = 0 byte berubah di luar `~/panel` |
| `cli.init.env.test.ts`        | Hanya variabel kosong ditanya; nilai lama tetap; komentar tetap; mode 600; secret yang diketik **tidak** muncul di output yang ditangkap; tanpa TTY → exit 3 menyebut nama variabel                          |
| `cli.init.tunnel.test.ts`     | Tanpa `cert.pem` + tanpa TTY → exit 3 + `init.json.waitingFor`; `tunnel create` dipanggil dengan nama; tunnel ada tanpa kredensial → minta nama lain; `routeDns` tanpa `--overwrite-dns`; ingress gagal validasi → `config.yml` tidak berubah |
| `cli.upgrade.test.ts`         | SHA salah → tidak ada swap; versi sama → 0 tanpa unduh tarball; target < 0.5.0 ditolak; health gagal → tawaran rollback; sukses → `panel.prev` = binary lama                                              |
| `cli.rollback.test.ts`        | Swap dua arah; `--db` membuat salinan `before-rollback` dulu; tanpa `panel.prev` → exit 1                                                                                                               |
| `cli.docs.test.ts`            | Setiap topik ada dan tidak kosong; topik tak dikenal → 2; setiap `panel <perintah>` yang disebut di docs ada di dispatcher                                                                              |
| `cli.imports.test.ts`         | Tidak ada file `src/server/**` (selain `main.ts`) atau `src/web/**` yang mengimpor `src/cli/**`                                                                                                        |

### 9.2 Shell (`scripts/cli.test.sh <binary>`, pola `install-phone.test.sh`)

Menjalankan binary hasil `bun run build:local` dengan HOME/PREFIX sementara (tanpa `$PREFIX/bin/sv` → fake):

- `--help`, `-h`, `--h` exit 0 dan memuat "Pemakaian"; `-v`, `--v` = versi `package.json`; `--version --json`
  di-parse `bun -e`.
- `--bogus` exit 2, selesai < 2 dtk, **tidak** membuat `data/panel.db` dan tidak listen (cek port).
- Di folder berisi `.env` dengan `APP_BASE_URL` palsu: `--version` tetap hanya mencetak versi (bahaya R&D/08 temuan 1
  tertutup).
- `PANEL_CLI_FAKE=ready doctor` exit 0; `PANEL_CLI_FAKE=fresh doctor` exit 1; `doctor --json` valid JSON, `schema` = 1.
- `docs` exit 0 dan mendaftar topik; `docs instal` tidak kosong.
- `PANEL_CLI_FAKE=fresh init --yes </dev/null` → exit 3, output menyebut `GOOGLE_CLIENT_ID`; sebuah nilai rahasia
  yang ditanam di `.env` fake tidak muncul di output.

### 9.3 Manual (QA di HP)

HP/Termux baru (bukan POCO) dari F-Droid: `curl … install.sh && sh install.sh` → selesai sampai panel bisa login
lewat `https://<host>`. Lalu `panel doctor` di POCO (read-only) dan bandingkan dengan kartu Persiapan. Lab L1–L4
(R&D/08 §6) sebelum P1 dinyatakan selesai.

## 10. Rencana kerja (worker, kepemilikan file eksklusif)

Worker tidak commit/push/ganti branch. Kontrak bersama ditulis lebih dulu oleh `wkr-cli-core-01`
(`src/shared/doctor.types.ts`, tanda tangan `CliHost`, `CliOut`, `Command = (args: ParsedArgs, io: CliIo) =>
Promise<number>`), lalu worker lain paralel.

| Fase | Worker               | File (eksklusif)                                                                                                                                         | Bergantung pada              |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P0   | `wkr-cli-core-01`    | `src/server/main.ts`, `scripts/build.ts`, `src/cli/cli.main.ts`, `cli.output.ts`, `cli.help.ts`, `cli.host.ts`, `cli.host.fake.ts`, `src/shared/doctor.types.ts`, `tests/cli.args.test.ts`, `tests/cli.imports.test.ts` | –                            |
| P0   | `wkr-cli-doctor-01`  | `src/cli/doctor.probe.ts`, `doctor.checks.ts`, `doctor.command.ts`, `src/server/env.ts` (ekspor `EMAIL_RE` saja), `tests/cli.doctor.test.ts`               | kontrak core                 |
| P0   | `wkr-cli-docs-01`    | `src/cli/docs.command.ts`, `docs/cli/*.md`, `tests/cli.docs.test.ts`                                                                                     | kontrak core                 |
| P0   | `wkr-cli-shell-01`   | `scripts/cli.test.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` (satu langkah)                                                         | gelombang P0 lain selesai    |
| P1   | `wkr-lab-cli-01`     | `PLAN/debate/07-cli-lab-results.md` (L1–L4; HP terisolasi, POCO hanya read-only)                                                                         | –                            |
| P1   | `wkr-cli-init-01`    | `src/cli/init.plan.ts`, `init.run.ts`, `init.packages.ts`, `init.files.ts`, `src/cli/templates.ts`, `tests/cli.init.plan.test.ts`, `tests/cli.init.run.test.ts` | P0                           |
| P1   | `wkr-cli-env-01`     | `src/cli/init.env.ts`, `src/cli/cli.prompt.ts`, `tests/cli.init.env.test.ts`                                                                             | P0                           |
| P1   | `wkr-cli-tunnel-01`  | `src/cli/init.tunnel.ts`, `tests/cli.init.tunnel.test.ts`                                                                                                | P0, hasil L2                 |
| P1   | `wkr-dist-02`        | `scripts/install-release.sh`, `scripts/install-release.test.sh`                                                                                          | `init` exit code final       |
| P2a  | `wkr-cli-upgrade-01` | `src/cli/release.fetch.ts`, `upgrade.command.ts`, `rollback.command.ts`, `tests/cli.upgrade.test.ts`, `tests/cli.rollback.test.ts`                       | P0                           |
| akhir | `wkr-docs-cli-01`   | `README.md` (bagian Instal di HP, Rollback, Build), `CHANGELOG.md` `[0.5.0]`, `package.json` (versi), `src/web/i18n/id.landing.ts` (`install`, `how`), `scripts/install-phone.sh` (petunjuk rollback → `panel rollback`), `PLAN/DECISIONS.md` (bagian D baru) | semua                        |

`init.run.ts` adalah satu-satunya file yang mengimpor langkah dari `init.packages/files/env/tunnel`; ketiga worker P1
mengekspor fungsi langkah dengan tanda tangan `InitStepRun` dari kontrak core, jadi tidak ada file bersama.

## 11. Kriteria penerimaan

- [ ] `panel` tanpa argumen: perilaku serve tidak berubah (test boot yang ada lulus; runit POCO tidak perlu diubah).
- [ ] `panel --version` di `~/panel` (ada `.env` lengkap) mencetak versi dan keluar < 0,5 dtk di HP, tanpa snapshot,
      migrasi, atau bind port.
- [ ] `-h -v --h --v --help --version` bekerja; flag tak dikenal exit 2.
- [ ] `panel doctor` di POCO (read-only, dijalankan koordinator setelah izin) menampilkan masalah yang sama dengan kartu
      Persiapan, tidak mengubah file apa pun (`find ~ $PREFIX/var/service -newer <penanda>` kosong selain log).
- [ ] `panel doctor --json` cocok dengan `DoctorReport` skema 1.
- [ ] HP Termux baru: satu perintah `install.sh` + jawaban prompt → panel sehat di `https://<host>/api/health`, tanpa
      membuka/menutup Termux (bila L1 lulus), tanpa `nano`.
- [ ] Rerun `panel init` di HP yang sudah lengkap: 0 aksi tulis, exit 0.
- [ ] Skenario `poco`: 0 byte berubah di luar `~/panel`; tidak ada `pkg upgrade`, restart pm2, atau restart cloudflared.
- [ ] Rahasia tidak pernah muncul di stdout/stderr/log/`init.json`/argv (test env + shell).
- [ ] `panel upgrade` menolak tarball dengan SHA salah; `panel rollback` menukar binary dua arah.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, semua test shell, `bun run bundle:check` lulus; ukuran binary naik
      < 300 KB.
- [ ] README, CHANGELOG `[0.5.0]`, landing langkah instal, dan `docs/cli/*` sinkron (Rule 16).

## 12. Risiko

| Risiko                                                                                     | Mitigasi                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Mirror Termux lambat/gagal di tengah `pkg install`                                         | Pesan dengan `pkg --check-mirror`/`termux-change-repo`; rerun melanjutkan (hanya paket yang hilang)    |
| `pkg upgrade` di HP baru menanyakan conffile                                               | `DEBIAN_FRONTEND=noninteractive` + `--force-confdef/--force-confold`; lab L3                           |
| runsvdir dari `init` mati saat sesi ditutup                                                | Lab L1; fallback exit 3 "buka ulang Termux" (perilaku hari ini)                                       |
| Upgrade paket cloudflared menghapus layanan (juga POCO)                                    | Opsi A (lab L2) atau B + doctor `cloudflared_run_script`/`cloudflared_down_file`; lapor ke pemilik     |
| CLI dan panel menulis file yang sama bersamaan                                             | K6: CLI hanya membuat yang belum ada; edit `config.yml` hanya sisip rute panel lewat `ingressStep`     |
| Rahasia bocor lewat argv/riwayat shell                                                     | K10: tidak ada flag rahasia                                                                           |
| Binary lama (< 0.5.0) dijalankan dengan argumen saat upgrade/rollback                      | Uji `--version` hanya untuk binary ≥ 0.5.0; rollback tidak mengeksekusi `panel.prev` kecuali lewat runit |
| Doctor berbeda dengan UI                                                                    | K5: fungsi + copy yang sama; test membandingkan label                                                 |

## 13. Pertanyaan terbuka (dengan rekomendasi)

| #   | Pertanyaan                                                                                         | Rekomendasi                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Q1  | Lingkup 0.5.0?                                                                                     | P0 + P1 + P2a (`upgrade`/`rollback`). Access lewat API, watchdog, UI "Perbarui" → backlog.                         |
| Q2  | Pasang PostgreSQL secara bawaan?                                                                   | Ya (situs dengan database fitur inti); `--skip postgres` untuk HP hemat RAM.                                       |
| Q3  | Buat symlink `$PREFIX/bin/panel`?                                                                  | Ya, hanya bila belum ada atau sudah menunjuk ke `~/panel/panel`. Membuat `panel doctor` bisa diketik dari mana pun. |
| Q4  | cloudflared: template token paket (A) atau run script sendiri (B)?                                 | A bila lab L2 lulus (tahan upgrade paket); B bila tidak. Keputusan setelah L2, oleh koordinator.                   |
| Q5  | CLI boleh menerapkan fix ecosystem/run script pada file yang ada bila panel mati?                  | Tidak di 0.5.0. Panel dinyalakan di akhir `init`, lalu UI Persiapan mengerjakannya dengan lock/audit/undo.         |
| Q6  | `pkg upgrade` otomatis di HP baru?                                                                  | Ya, sebagai baris rencana yang dikonfirmasi (`--yes` = ya); tidak pernah di HP lama.                                |
| Q7  | Nama tunnel bawaan?                                                                                 | `panel-` + domain tanpa label pertama, titik → strip (`panel.contoh.com` → `panel-contoh-com`). Bisa diganti di prompt/`--tunnel`. |
| Q8  | Kapan `install-phone.sh` dihapus?                                                                  | Rilis setelah 0.5.0, setelah `init` terbukti di HP baru dan POCO.                                                   |
| Q9  | POCO ikut opsi A cloudflared?                                                                       | Hanya dengan izin pemilik dan setelah L2; sampai itu, **jangan `pkg upgrade cloudflared` di POCO**.                 |
| Q10 | Doctor exit ≠ 0 untuk peringatan (seperti `brew doctor`)?                                          | Tidak; 0 bila tanpa error. Peringatan tidak boleh membuat skrip otomatis gagal.                                     |
| Q11 | Pacman Termux?                                                                                      | Tidak didukung 0.5.0: exit 3 dengan daftar paket untuk dipasang manual.                                             |
| Q12 | `init` memasang `glibc-runner` (untuk situs glibc/`grun`)?                                          | Tidak bawaan; doctor info "dibutuhkan hanya untuk situs binary glibc". Binary Android tidak butuh.                  |
