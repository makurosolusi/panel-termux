# PLAN 07 — CLI di binary: `-h`, `-v`, `doctor`, `docs`, `env`, `rollback` (0.5.0) dan `init` (0.5.1)

Ditulis `wkr-cli-plan-01`, 2026-11-27. Dasar riset: `R&D/08-cli-bootstrap.md` (inventaris 27 langkah, verifikasi Bun /
Termux / cloudflared, pembanding industri). Mengikuti `PLAN/DECISIONS.md` (terutama B14, B18, B23, C1, C3, C5, C6,
C12–C16) dan aturan global (`~/.claude/CLAUDE.md`). Ditambah `wkr-cli-plan-02`, 2026-11-27: perintah `panel env` /
`--env` (K17–K18, §6.2) atas permintaan pemilik.

**Revisi 3** (`wkr-cli-plan-03`, 2026-11-27): menerapkan debat `PLAN/debate/07-cli-bootstrap-debate.md` (5 BLOCKER, 10
MAJOR, 18 MINOR; rujukan "D1…D15" dan "m1…m18" di dokumen ini menunjuk temuan debat itu) dan keputusan pemilik
DECISIONS C12–C16. Status: **P0 (0.5.0) dibangun di `feature/cli-p0`** (2026-11-27, W0–W1 + G1a + W3; W2 belum), lihat
§11 dan §11.1. P1 (0.5.1) belum dibangun.

## 0. Ringkasan

**0.5.0 = P0 saja (C12), tanpa mengubah cara HP dipasang.** Binary `panel` mendapat entry tipis dengan CLI:

- `panel` tanpa argumen: tanpa TTY (runit) tetap menjalankan server, jadi run script tidak berubah. Di terminal (TTY)
  mencetak bantuan singkat + "untuk menjalankan server: `panel serve`", exit 2 (D2).
- **Penjaga instance** di awal `bootPanel`: bila `/api/health` di `127.0.0.1:<PORT>` sudah menjawab, panel kedua keluar
  1 **sebelum** menyentuh `data/secret` atau `panel.db` (D2).
- Cabang CLI menghapus semua kunci `ENV_VARS` dari `process.env` sebelum memuat modul apa pun, sehingga rahasia `.env`
  tidak diwariskan ke proses anak (D3).
- Deteksi mode sendiri: termux bila `$PREFIX/bin/pkg`/`apt` ada atau `TERMUX_VERSION` diset; fake **hanya** dengan
  `PANEL_CLI_FAKE` (D1).
- Perintah: `-h/--help`, `-v/--version` (tanpa `--json`), `doctor` (+ `--json`, pemeriksaan baru dari debat), `env`
  (+ `--full`, satu skema env, `.env.example` digenerate), `docs` (4 topik), `rollback` (tukar `panel` ↔ `panel.prev`,
  `--db`).

**0.5.1 = P1 (C13):** `panel init` (membangun ekosistem dari Termux kosong, aman di HP yang sudah jalan) dan
`install.sh` tipis. Desainnya ada di §4 dan §8.2, sudah memuat perbaikan debat, tetapi baru dibangun setelah lab L1–L8
lulus di Termux bersih (§14). HP kedua belum tersedia, jadi 0.5.1 menunggu.

**`panel upgrade` ditunda (C14)** sampai rilis ditandatangani Ed25519. Upgrade tetap = jalankan lagi perintah
`install.sh` (`PANEL_VERSION=vX` untuk versi tertentu). Tidak ada Docker di strategi test mana pun (C16).

## 1. Keputusan PLAN

| #    | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Alasan / bukti                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K1   | Entry build baru `src/server/main.ts` (tipis, §7.1): rute serve → `(await import("./boot")).start()`; rute CLI → hapus kunci `ENV_VARS` (K11b) lalu `(await import("../cli/cli.main")).runCli(argv)`. Satu-satunya impor statis `main.ts` adalah `src/shared/env.schema.ts` (murni). `src/server/index.ts` tetap (dev + test).                                                                                                                                                                                                      | R&D/08 temuan 4. Isolasi dengan konfigurasi build nyata (splitting, plugin tailwind, minify) wajib dibuktikan lab L5 sebelum P0 dibekukan (D13).                                                                   |
| K2   | Serve **hanya** bila (argv kosong **dan** stdin bukan TTY) atau argv persis `["serve"]`. Argv kosong + TTY → bantuan singkat + `→ untuk menjalankan server: panel serve`, exit 2. Argumen tak dikenal → exit 2, **tidak pernah** serve. Plus **penjaga instance** di awal `bootPanel` (§2.4): panel yang sudah menjawab di PORT → exit 1 sebelum secret/DB disentuh.                                                                                                                                                                | D2: runit tidak punya TTY (`run` = `exec ./panel`), jadi produksi tidak berubah; `bun --hot src/server/index.ts` tidak tersentuh. Penjaga juga melindungi dari binary < 0.5.0 selama binary baru yang start kedua. |
| K3   | Parser: `node:util` `parseArgs` (`strict: true`, `allowPositionals: true`). `--v`/`--h`/`--env` dinormalisasi ke `--version`/`--help`/`env` sebelum parse. Tanpa dependency baru.                                                                                                                                                                                                                                                                                                                                                   | Terverifikasi di binary (R&D/08 §3.4); Bun tidak menelan flag (debat §1). Rule 10.                                                                                                                                 |
| K4   | Nama perintah dan flag **Inggris** (konvensi CLI), semua output **Indonesia** polos.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Sama dengan `sv`, `pkg`, `cloudflared`; copy produk tetap Indonesia.                                                                                                                                               |
| K5   | Pemeriksaan integrasi (`sites_dir` … `cloudflare_token`) **dipanggil**, bukan disalin: `createIntegration(ctx).get()` + copy `idSiteSetup.checks` dari `src/web/i18n/id.site.setup.ts`. Pemeriksaan baru khusus bootstrap ada di `src/cli/doctor.checks.ts`.                                                                                                                                                                                                                                                                        | Satu sumber kebenaran (permintaan pemilik).                                                                                                                                                                        |
| K6   | CLI **tidak menerapkan fix integrasi** (ecosystem, run script pm2, apps.json) pada file yang sudah ada. `init` (0.5.1) hanya membuat yang **belum ada**. File yang ada → rujuk ke **Situs → Persiapan** (lock, audit, backup, undo). `config.yml` hanya disunting CLI bila layanan `panel` **tidak** `run` (D10).                                                                                                                                                                                                                   | CLI tidak bisa ikut lock job panel (R&D/08 §5.2); C1/C3/C5/C6 sudah dijamin di UI.                                                                                                                                 |
| K7   | (0.5.1) Paket: pasang **hanya yang belum ada**. Langkah paket diawali `dpkg --audit`. HP yang sudah jalan: `apt-get -s install <hilang>` dulu; bila ada paket **terpasang** yang akan di-upgrade → daftar + konfirmasi TTY, dan **tolak** (exit 3 + perintah manual) bila daftar memuat `cloudflared`, `postgresql`, `nodejs*`. HP baru: `pkg upgrade` dengan flag noninteractive/confold yang sama dengan install, lalu `apt-mark hold cloudflared postgresql` + satu baris alasan. SIGINT pertama diabaikan selama pkg/npm jalan. | D5, D9, D11; `pkg upgrade` = `apt full-upgrade` yang menghormati hold (POCO `$PREFIX/bin/pkg:423`).                                                                                                                |
| K8   | (0.5.1) Node: node apa pun yang sudah ada diterima; bila tidak ada → `nodejs-lts`. pm2 dipasang `npm install -g pm2@7.1.2` bila `$PREFIX/lib/node_modules/pm2/bin/pm2-runtime` tidak ada. CLI tidak memanggil CLI `pm2` (B14).                                                                                                                                                                                                                                                                                                      | Konflik `nodejs`/`nodejs-lts`; versi lab E1–E11.                                                                                                                                                                   |
| K9   | Restart: `panel` boleh di-restart oleh `rollback` (0.5.0) dan `init` (0.5.1) setelah konfirmasi. **pm2 tidak pernah di-restart** oleh CLI (C3). **cloudflared** di-restart hanya bila config baru dibuat CLI di run yang sama, atau dengan konfirmasi eksplisit yang menyebut "semua situs putus beberapa detik".                                                                                                                                                                                                                   | C3, makuro-solusi tidak boleh putus tanpa izin.                                                                                                                                                                    |
| K10  | Rahasia: dibaca lewat prompt tanpa echo, langsung ditulis ke `~/panel/.env` (600) dengan `encodeEnvLine` (B23). Tidak lewat argv, tidak di file state, tidak di log, tidak dicetak ulang. stdout/stderr `cloudflared` tidak pernah dicetak atau dimasukkan ke pesan error; hanya kode keluar + baris yang lolos `redactLines` (D4).                                                                                                                                                                                                 | Rule 7, 12.                                                                                                                                                                                                        |
| K11a | CLI membaca `~/panel/.env` secara eksplisit (`src/cli/env.file.ts`: `findEnvLine` + `decodeEnvValue` per kunci `ENV_VARS`) dan tidak memakai `process.env` untuk variabel panel. Bun juga memuat `.env.local`, `.env.development`, `.env.production` dari cwd, dan ini tidak bisa dimatikan lewat build → doctor `env_extra_files` (D8).                                                                                                                                                                                            | R&D/08 temuan 3; debat D8 (eksperimen binary).                                                                                                                                                                     |
| K11b | Cabang CLI di `main.ts`, sebelum `import()` apa pun: `for (const v of ENV_VARS) delete process.env[v.name]`. Bukan allowlist: `am` (termux-open-url, termux-wake-lock) butuh `BOOTCLASSPATH`/`ANDROID_*`, termux-exec butuh `LD_PRELOAD`. Semua adapter (`runTermux` memakai `opts.env ?? process.env`) ikut aman dari satu tempat ini.                                                                                                                                                                                             | D3: tanpa ini `GOOGLE_CLIENT_SECRET` dari `.env` cwd diwariskan ke `sv`, `npm` lifecycle script, dan (0.5.1) runsvdir → semua layanan → semua app pm2.                                                             |
| K12  | Doctor **read-only**: tidak membuat `panel.db`, tidak membaca `data/secret`, tidak memanggil `ensureAppsJson`/`verify`, tidak menulis file apa pun. `panel.db` dibuka `new Database(f, { readonly: true })`; bila gagal (mis. WAL tanpa `-shm` saat panel mati, lab L6) → DB `:memory:` termigrasi, tanpa membuat file.                                                                                                                                                                                                             | `openDb` membuat file; `verify()` membuat `apps.json`; m14.                                                                                                                                                        |
| K13  | Mode CLI ditentukan CLI sendiri, **bukan** `selectSystem`: `PANEL_CLI_FAKE=fresh\|ready\|poco\|nosv` → fake (host fake + `createFakeSystem`); selain itu termux bila `$PREFIX/bin/pkg` atau `$PREFIX/bin/apt` ada atau `TERMUX_VERSION` diset → `createTermuxSystem()` langsung; selain itu → `❌ Ini bukan Termux` + `→ untuk mencoba: PANEL_CLI_FAKE=ready panel doctor`, exit 1. Adapter dibuat ulang setelah langkah paket `init` (0.5.1).                                                                                      | D1: `selectSystem` memilih fake bila `sv` tidak ada, padahal di Termux kosong `sv` memang belum ada. D15: `selectSystem` menulis `log.info` ke stdout dan merusak `--json`.                                        |
| K14  | (0.5.1) `install.sh` = bootstrap tipis yang `exec` binary hasil unduhan dengan snippet `/dev/tty` yang benar (§8.2). Kontrak exit 0/1/3 dipertahankan.                                                                                                                                                                                                                                                                                                                                                                              | Permintaan pemilik; D6 (`[ -r /dev/tty ]` hanya cek izin).                                                                                                                                                         |
| K15  | Tarball rilis **tidak berubah** di 0.5.0 (binary + `install-phone.sh` + `deploy/*` + `.env.example`); `install-release.sh` juga tidak berubah. `install-phone.sh` dihapus setelah `init` terbukti (Q8).                                                                                                                                                                                                                                                                                                                             | Pengguna yang mem-pin versi lama tidak rusak; satu langkah per rilis.                                                                                                                                              |
| K16  | Versi: **0.5.0** = P0 (C12). **0.5.1** = P1 (`init`, `install.sh` tipis), digerbang lab L1–L8 (C13). `upgrade` ditunda sampai rilis bertanda tangan Ed25519 (C14). Access lewat API, watchdog, UI "Perbarui" = backlog (§15).                                                                                                                                                                                                                                                                                                       | Debat §3: lingkup terlalu lebar untuk satu rilis.                                                                                                                                                                  |
| K17  | Satu skema env: `src/shared/env.schema.ts` mengekspor `ENV_VARS` (urutan tetap; per variabel `name`, `required`, `default?`, `example?`, `placeholders?`, `description` Indonesia satu baris, `secret`) + `renderEnvTemplate({ full })`. `placeholders` = nilai contoh lama (`https://panel.example.com`, `you@example.com` dari `.env.example` ≤ 0.4.0) yang dihitung **kosong** oleh doctor `env_complete`, prompt `init`, dan `install-phone.sh`. Dipakai: `parseEnv`, doctor, `init`, `panel env`, `.env.example`. Modul murni. | Permintaan pemilik; D7 (HP yang berhenti di exit 3 punya `.env` berisi placeholder yang lolos sebagai "terisi").                                                                                                   |
| K18  | `panel env` (alias `panel --env`, **tanpa** short flag `-e`): stdout = template saja, catatan ke stderr. Tidak pernah membaca isi `.env` maupun `process.env` (hanya `stat`/`fstat`). Nilai **dikosongkan**; contoh nilai di komentar. stdout yang ternyata `.env` berisi data (mode append) → tidak menulis apa pun, exit 1 (m10). Tidak memuat bundle server (K1).                                                                                                                                                                | Nilai kosong → panel menolak start dan doctor menyebut namanya. `-e` tidak dipakai agar tidak mengunci huruf itu. m10: kunci kosong yang di-append menang atas nilai lama.                                         |

## 2. Perintah, flag, exit code

### 2.1 Daftar

| Perintah                       | Flag                                                                                                                                                            | Mengubah HP?                                   | Rilis           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------- |
| `panel`                        | –                                                                                                                                                               | tanpa TTY: serve; di TTY: bantuan, exit 2 (K2) | 0.5.0 (berubah) |
| `panel serve`                  | –                                                                                                                                                               | serve                                          | 0.5.0           |
| `panel -h`, `--help`, `--h`    | juga `panel <perintah> --help`                                                                                                                                  | tidak                                          | 0.5.0           |
| `panel -v`, `--version`, `--v` | –                                                                                                                                                               | tidak                                          | 0.5.0           |
| `panel doctor`                 | `--json`                                                                                                                                                        | tidak                                          | 0.5.0           |
| `panel docs [topik]`           | tanpa topik = daftar topik                                                                                                                                      | tidak                                          | 0.5.0           |
| `panel env`, `--env`           | `--full` (tambah variabel opsional, dikomentari dengan nilai bawaan)                                                                                            | tidak                                          | 0.5.0           |
| `panel rollback`               | `--db`, `-y/--yes`                                                                                                                                              | ya                                             | 0.5.0           |
| `panel init`                   | `-y/--yes`, `--hostname <fqdn>`, `--admin-email <email>` (berulang), `--tunnel <nama>`, `--port <n>`, `--skip <postgres\|tunnel\|boot>` (berulang), `--dry-run` | ya                                             | 0.5.1           |
| `panel upgrade`                | –                                                                                                                                                               | –                                              | ditunda (C14)   |

`-v` mencetak satu baris `panel-termux 0.5.0 (android-arm64, bun 1.4.2)`: versi dari `package.json`, platform/arch
dari `process.platform`/`process.arch`, Bun dari `Bun.version`. `--json` untuk `-v` **tidak ada** (m16); `-v --json` →
exit 2.

`--env` dinormalisasi ke perintah `env` sebelum parse (K3), jadi `panel --env --full` = `panel env --full`. Short flag
yang dipakai hanya `-h`, `-v`, `-y`.

Di 0.5.0, `init` dan `upgrade` tidak ada di dispatcher. Pesan "perintah tidak dikenal" untuk kedua nama itu menambah
satu baris `→ untuk memasang atau memperbarui: jalankan lagi perintah install.sh (README)`, exit 2.

### 2.2 Exit code (sama untuk semua perintah)

| Kode | Arti                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Berhasil; `doctor`: tidak ada `error` (peringatan boleh)                                                                                                                                                                                                                               |
| 1    | Gagal (pesan menyebut operasi + penyebab); `doctor`: ≥ 1 `error`; serve: panel lain sudah menjawab di PORT (§2.4)                                                                                                                                                                      |
| 2    | Salah pakai: perintah/flag tak dikenal, nilai flag tidak valid, `panel` tanpa argumen di terminal                                                                                                                                                                                      |
| 3    | Butuh tindakan pengguna lalu jalankan lagi: `rollback` tanpa TTY dan tanpa `--yes`; (0.5.1) rahasia belum ada tanpa TTY, login Cloudflare belum selesai, pacman, paket penting akan ter-upgrade, Termux perlu dibuka ulang. Kompatibel dengan `install-phone.sh`/`install.sh` sekarang |
| 4    | Dibatalkan pengguna (menjawab tidak pada konfirmasi)                                                                                                                                                                                                                                   |
| 130  | Ctrl-C. File yang ditulis CLI selalu `tmp` + `rename`, jadi tidak pernah setengah jadi. Ini **tidak** berlaku untuk pkg/dpkg (0.5.1): CLI mengabaikan SIGINT pertama selama pkg/npm jalan, dan run berikutnya memulai dengan `dpkg --audit` (K7)                                       |

### 2.3 Gaya output

- Polos, satu baris per hal, Indonesia, tanpa warna wajib. Simbol: `✅` ok, `⚠️` peringatan, `❌` error, `ℹ️` info,
  `→` langkah berikutnya. `NO_COLOR` dihormati bila nanti ada warna; stdout bukan TTY → tanpa spinner.
- Setiap `❌`/`⚠️` diikuti satu baris `→` berisi tindakan: perintah manual, `panel docs <topik>`, atau "buka Situs →
  Persiapan". Di 0.5.0 tidak ada saran `panel init`; sampai 0.5.1 sarannya "jalankan lagi perintah install.sh" atau
  perintah `pkg install …` persis.
- Pesan error memakai pola Rule 11: `❌ Gagal menukar binary: rename ~/panel/panel.new keluar dengan EACCES. → Periksa
  izin folder ~/panel, lalu jalankan panel rollback lagi.` Nilai rahasia tidak pernah muncul; untuk `.env` hanya nama
  variabel.
- Perintah yang outputnya untuk di-redirect (`env`, `doctor --json`): stdout hanya data; peringatan/catatan ke stderr.
  CLI tidak memanggil fungsi yang menulis `log.info` ke stdout (K13, D15).
- Contoh `doctor`:

```text
Panel Termux 0.5.0 — pemeriksaan HP (tidak ada yang diubah)

Termux
  ✅ HP 64-bit (arm64)
  ✅ Termux dari F-Droid/GitHub
  ✅ Ruang kosong 3,1 GB
  ✅ Termux:Boot terpasang
  ⚠️ Termux:API belum terpasang
     → pasang Termux:API dari F-Droid (panel docs android)
Paket
  ✅ termux-services
  ❌ cloudflared belum terpasang
     → jalankan: pkg install cloudflared
  ⚠️ postgresql tidak ditahan (apt-mark hold)
     → pkg upgrade bisa menaikkan versi mayor dan mematikan database (panel docs paket)
Layanan
  ✅ runit berjalan
  ✅ panel berjalan (v0.5.0, sehat, satu instance)
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

Hasil: 2 error, 3 peringatan.
```

### 2.4 Penjaga instance (D2)

- Tempat: baris pertama `bootPanel`, **sebelum** `loadOrCreateSecret`/`openDb`. Dilewati bila `env.PORT === 0` (test
  boot memakai port acak).
- `GET http://127.0.0.1:<PORT>/api/health`, timeout 1 dtk. Hanya "koneksi ditolak" yang berarti port bebas → boot
  lanjut. Ada respons HTTP apa pun, **atau** koneksi diterima tetapi tidak menjawab dalam 1 dtk → lempar
  `PanelAlreadyRunningError`. `start()` menangkapnya → `log.error("[panel] port <PORT> sudah dipakai (panel v<versi>
  bila /api/health menjawab); tidak ada yang diubah")`, exit 1.
- `ponytail:` race dua start yang bersamaan masih terbuka. Upgrade ke pidfile + cek `/proc/<pid>/exe` bila terjadi.
- `sv restart panel` aman: runsv menunggu proses lama keluar sebelum menjalankan yang baru, jadi port sudah bebas.

## 3. `doctor`

### 3.1 Pemeriksaan

Kunci stabil (dipakai `--json` dan test). Kolom **Sumber**: fungsi yang dipakai; "baru" = `src/cli/doctor.checks.ts`
(fungsi murni dari `DoctorProbe`, lihat §3.3). Semua probe read-only. Daftar ini dibekukan di gerbang G0 (§10), karena
host fake (`wkr-cli-core-01`) harus menjawab setiap probe.

| Grup    | Kunci                                                                                                                    | Gagal =                                                                   | Sumber / probe                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| termux  | `arch_arm64`                                                                                                             | error                                                                     | baru (`process.arch`)                                                                                                                                                                                                          |
| termux  | `termux_prefix`                                                                                                          | error                                                                     | baru (mode termux K13)                                                                                                                                                                                                         |
| termux  | `termux_source`                                                                                                          | error bila `TERMUX_APK_RELEASE=GOOGLE_PLAY_STORE`; info bila tidak diset  | baru (m3)                                                                                                                                                                                                                      |
| termux  | `disk_free` (< 400 MB error, < 1 GB warning)                                                                             | error                                                                     | baru (`statfsSync`, sama dengan `health.service.ts`)                                                                                                                                                                           |
| termux  | `pkg_manager_apt`                                                                                                        | error                                                                     | baru: `$PREFIX/bin/apt` ada = ok; pacman hanya bila `TERMUX_APP_PACKAGE_MANAGER=pacman` **dan** `$PREFIX/bin/pacman` ada (m1)                                                                                                  |
| termux  | `app_termux_boot`, `app_termux_api`                                                                                      | warning; info bila `cmd` gagal/timeout                                    | baru: `cmd package list packages com.termux.boot` / `com.termux.api`, timeout 5 dtk (m2)                                                                                                                                       |
| paket   | `pkg_termux_services`, `pkg_cloudflared`                                                                                 | error                                                                     | baru (`dpkg -s`)                                                                                                                                                                                                               |
| paket   | `node`, `pm2`                                                                                                            | error                                                                     | baru (`$PREFIX/bin/node`, file `pm2-runtime`)                                                                                                                                                                                  |
| paket   | `pkg_postgresql`, `pkg_termux_api`                                                                                       | warning                                                                   | baru (`dpkg -s`)                                                                                                                                                                                                               |
| paket   | `pkg_held` (per paket terpasang: `cloudflared`, `postgresql`)                                                            | warning                                                                   | baru: `apt-mark showhold`; saran `panel docs paket` (D5, C15)                                                                                                                                                                  |
| paket   | `postgres_major`                                                                                                         | error                                                                     | baru: mayor `$PREFIX/var/lib/postgresql/PG_VERSION` ≠ mayor `postgres --version` (D11)                                                                                                                                         |
| layanan | `service_daemon` (runsvdir hidup: pidfile + `kill -0`)                                                                   | error                                                                     | baru                                                                                                                                                                                                                           |
| layanan | `svc_panel`, `svc_pm2`, `svc_cloudflared`, `svc_postgres`                                                                | error / warning untuk postgres                                            | `RunitAdapter.supervise()` (ada)                                                                                                                                                                                               |
| layanan | `cloudflared_down_file`                                                                                                  | **error** bila `~/.cloudflared/config.yml` ada, selain itu warning        | baru (D5)                                                                                                                                                                                                                      |
| layanan | `cloudflared_run_script` (template paket vs run kustom, R&D/08 §5.3)                                                     | warning                                                                   | baru                                                                                                                                                                                                                           |
| layanan | `postgres_initdb` (`PG_VERSION`)                                                                                         | warning                                                                   | baru                                                                                                                                                                                                                           |
| panel   | `binary_installed` (+ versi terpasang vs binary ini → info)                                                              | error                                                                     | baru (`~/panel/panel`; versi dari `/api/health` bila jalan)                                                                                                                                                                    |
| panel   | `panel_instances`                                                                                                        | error bila > 1 proses serve; warning bila 1 proses tetapi bukan pid runit | baru: `/proc/[0-9]*/exe` (uid sama) dengan basename `panel`/`panel.prev`/`panel.new`/`panel-android-arm64` dan cmdline tanpa perintah CLI (atau `serve`), selain pid sendiri; dibandingkan dengan `$SVDIR/panel/supervise/pid` |
| panel   | `env_complete` (nama variabel kosong **atau** bernilai `placeholders`)                                                   | error                                                                     | baru; daftar wajib + placeholder dari `ENV_VARS` (K17, D7)                                                                                                                                                                     |
| panel   | `env_valid`                                                                                                              | error                                                                     | `parseEnv(isi file)` (pesan `EnvError` tanpa nilai)                                                                                                                                                                            |
| panel   | `env_extra_files` (`~/panel/.env.{local,development,production,test}`, `.env.*.local`)                                   | warning; saran "gabungkan ke .env"                                        | baru (`existsSync`, isi tidak dibaca; D8)                                                                                                                                                                                      |
| panel   | `data_dir_private` (mode 700)                                                                                            | warning                                                                   | baru                                                                                                                                                                                                                           |
| panel   | `panel_health`                                                                                                           | error                                                                     | `NetAdapter.httpStatus(PORT, "/api/health")` (ada)                                                                                                                                                                             |
| situs   | 12 kunci `IntegrationCheckKey` (persis, termasuk aturan "moot")                                                          | sesuai UI                                                                 | `createIntegration(ctx).get()` (ada)                                                                                                                                                                                           |
| tunnel  | `cf_cert`, `cf_config` (tunnel id), `cf_panel_ingress` (host `APP_BASE_URL` di ingress)                                  | error                                                                     | `readTunnelId`, `ingressHostnames` (ada)                                                                                                                                                                                       |
| tunnel  | `panel_public` (GET `https://<host>/api/health`)                                                                         | warning                                                                   | `probeHttps` (ada); dilewati bila tidak ada internet                                                                                                                                                                           |
| boot    | `termux_boot_script` (ada skrip di `~/.termux/boot/` yang memanggil `service-daemon`/`ensure-services`/`start-services`) | warning                                                                   | baru                                                                                                                                                                                                                           |
| manual  | `android_settings`, `cloudflare_access`                                                                                  | info                                                                      | teks tetap (tidak bisa dicek); `access` juga di onboarding `/dev`                                                                                                                                                              |

Catatan:

- Grup `situs` hanya dijalankan bila `termux_prefix` ok. Konteks: `FixCtx {db, secret: "", system}` dengan `db` dari
  K12 dan `system` dari K13. Label diambil dari `idSiteSetup.checks[key][state]` (fungsi copy dipanggil dengan
  `params`), jadi teks = UI.
- Item onboarding (`secret_saved`, `backup`, …) tidak dihitung ulang: doctor mencetak satu baris info "Checklist
  penyiapan ada di Administrasi → Penyiapan" bila panel sehat.
- Timeout per pemeriksaan jaringan: `panel_health` 3 dtk, `panel_public` 5 dtk, `cmd package` 5 dtk. Total doctor di HP
  < 5 dtk (diukur L4); probe yang independen dijalankan paralel.
- `postgres --version` dan `apt-mark showhold` dipanggil lewat `CliHost.exec` dengan env yang sudah dibersihkan (K11b).

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
      "action": "manual",
      "hint": "jalankan: pkg install cloudflared",
      "params": {}
    }
  ]
}
```

`action`: `"init" | "ui" | "manual" | "docs" | null` (`"init"` baru dipakai mulai 0.5.1). `ok` = tidak ada `error`.
`params` = `JobParams` (tanpa nilai rahasia, sama dengan API integrasi). Skema dibekukan di
`src/shared/doctor.types.ts`. Seluruh stdout `doctor --json` harus bisa di-parse tanpa pemangkasan (D15).

### 3.3 Struktur

```text
doctor.probe.ts   → kumpulkan fakta (fs, dpkg, apt-mark, cmd package, /proc, runit, http) lewat CliHost + SystemAdapters → DoctorProbe
doctor.checks.ts  → fungsi murni DoctorProbe → DoctorCheck[] (bootstrap)
doctor.command.ts → probe + checks + integration.get() → cetak / JSON → exit code
```

`SystemAdapters` dibuat oleh `CliHost` (K13), tidak pernah lewat `selectSystem`. `init` (0.5.1) memakai
`doctor.probe` + `doctor.checks` yang sama untuk menyusun rencananya (§4.1): satu deteksi untuk doctor dan init.

## 4. `init` (0.5.1, desain; tidak dibangun di 0.5.0)

Dibangun setelah lab L1–L3, L7, L8 lulus di Termux bersih (C13, §14). Rincian di bawah sudah memuat semua perbaikan
debat dan menjadi spesifikasi worker 0.5.1. Tabel worker 0.5.1 ditulis ulang setelah lab, karena hasil L2 menentukan
opsi cloudflared.

### 4.1 Alur

`init` = **deteksi → rencana → konfirmasi → jalankan langkah → verifikasi → ringkasan**. Setiap langkah menghitung
ulang keadaannya dari sistem, jadi rerun melanjutkan dari mana pun, tanpa file state.

| #   | Langkah        | Deteksi (lewat)                                              | Aksi bila kurang                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Di HP yang sudah jalan                                                                                                                                                                           |
| --- | -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Prasyarat      | arch, prefix, ruang, lock, TTY                               | Gagal → exit 1. Lock `~/panel/.init.lock` (`O_EXCL`, berisi pid); basi bila pid mati **atau** `/proc/<pid>/cmdline` tidak memuat `init` (m7)                                                                                                                                                                                                                                                                                                                                                     | sama                                                                                                                                                                                             |
| 1   | Binary         | `~/panel/panel` ada & SHA-256 sama dengan `process.execPath` | `detectRuntime(process.execPath)` (aarch64/bionic). Ruang = rumus `install-phone.sh` (2 × `panel.db` + 256 MB) + ukuran binary. Salin diri ke `panel.new` (755) → `panel` lama ke `panel.prev` **hanya** bila panel sekarang sehat (`/api/health` versi = binary terpasang) atau `panel.prev` belum ada (D12) → `rename`. `~/panel/data` 700. Symlink `$PREFIX/bin/panel` → `~/panel/panel` bila belum ada atau sudah milik kita. Pangkas `~/panel-src` selain versi sekarang + sebelumnya (m12) | Binary beda & panel `run` → ditandai "perlu restart" untuk langkah 10                                                                                                                            |
| 2   | Paket          | `dpkg --audit`, `dpkg -s`, node, `pm2-runtime`               | `dpkg --audit` tidak kosong: HP baru → `dpkg --configure -a --force-confdef --force-confold`; HP lama → exit 3 + perintahnya. HP baru: `DEBIAN_FRONTEND=noninteractive pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold` (dikonfirmasi), lalu `pkg install` dengan flag yang sama untuk yang hilang, `npm install -g pm2@7.1.2`, `apt-mark hold cloudflared postgresql`. Verifikasi ulang dengan `dpkg -s`. Adapter dibuat ulang (K13)                       | Hanya yang hilang, lewat simulasi `apt-get -s install` dulu (K7); tanpa `pkg upgrade`; hold hanya dengan konfirmasi                                                                              |
| 3   | runit          | runsvdir hidup (pidfile + `kill -0`)                         | `CliHost.run("service-daemon", ["start"])` dengan stdio `ignore`, env bersih (K11b), `SVDIR` **dan** `LOGDIR` eksplisit (m4); exit 1 dengan runsvdir hidup = ok (m5); tunggu pidfile ≤ 15 dtk. Bila L1 gagal: exit 3 "tutup dan buka lagi Termux, lalu `<perintah>`"                                                                                                                                                                                                                             | Tidak ada aksi bila hidup                                                                                                                                                                        |
| 4   | Postgres       | `PG_VERSION`, `svc_postgres`                                 | `initdb -D $PREFIX/var/lib/postgresql -U postgres --auth-local=trust --auth-host=scram-sha-256`; hapus `down`, `sv up postgres`                                                                                                                                                                                                                                                                                                                                                                  | Data ada → tidak disentuh; layanan mati → hanya disebut (doctor/UI punya tombol)                                                                                                                 |
| 5   | `.env`         | `env_complete` (placeholder = kosong, D7), `env_valid`       | Buat dari `renderEnvTemplate({ full: true })` (600; = `.env.example`, K17). Tanya **hanya** yang kosong/placeholder (§4.3). Validasi `parseEnv`                                                                                                                                                                                                                                                                                                                                                  | Nilai yang ada (bukan placeholder) tidak pernah ditanya ulang/ditimpa                                                                                                                            |
| 6   | Layanan panel  | `$SVDIR/panel/run` sama dengan template                      | Folder `.panel.new` → `run` + `log/run` → rename; `down` selama `.env` belum lengkap                                                                                                                                                                                                                                                                                                                                                                                                             | Run script beda → peringatan saja, tidak ditimpa                                                                                                                                                 |
| 7   | pm2            | `ecosystem.config.js`, `apps.json`, `$SVDIR/pm2`             | **Hanya bila ketiganya tidak ada**: `ecosystemFromTemplate`, `apps.json` `[]`, run script pm2 ter-embed (folder `.pm2.new` → rename), `sv up pm2`                                                                                                                                                                                                                                                                                                                                                | Tidak menulis apa pun; hasil integrasi dicetak + "buka Situs → Persiapan" (K6)                                                                                                                   |
| 8   | Tunnel         | `cf_cert`, `cf_config`, `cf_panel_ingress`, DNS              | §4.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rute panel ditambah ke `config.yml` hanya bila layanan `panel` **tidak** `run`; bila `run` → cetak baris ingress persis + "tambahkan lewat Situs → Domain" atau `sv down panel` lalu rerun (D10) |
| 9   | Boot           | `termux_boot_script`                                         | Tulis `~/.termux/boot/panel-termux` (755): `termux-wake-lock` + `service-daemon start` dengan `SVDIR` **dan** `LOGDIR` (m4); panggil `termux-wake-lock` sekarang, didahului baris "HP akan menanyakan izin baterai: pilih Izinkan" (m11)                                                                                                                                                                                                                                                         | Ada skrip yang sudah menyalakan layanan (POCO: `start-services`) → tidak ditulis                                                                                                                 |
| 10  | Nyalakan & cek | `svc_panel`, `panel_health`                                  | Hapus `down`; belum jalan → `sv up panel`; binary baru & sedang jalan → konfirmasi lalu `sv -w 130 restart panel`. Tunggu `/api/health` ≤ 30 dtk; cek versi = binary ini                                                                                                                                                                                                                                                                                                                         | Restart hanya dengan konfirmasi TTY. `--yes` tanpa TTY → tidak restart, exit 3 "panel masih versi lama; jalankan `sv restart panel`" (m9)                                                        |
| 11  | Ringkasan      | doctor                                                       | Cetak hasil doctor singkat + langkah manual tersisa (Access, pengaturan Android, OAuth bila dilewati) + URL panel. Perintah yang dicetak adalah yang benar-benar bisa dipakai: `panel` bila `$PREFIX/bin/panel` → kita, selain itu `~/panel/panel` (m8)                                                                                                                                                                                                                                          | sama                                                                                                                                                                                             |

Rencana dicetak sebelum langkah 1 dijalankan, dalam bahasa awam, satu baris per aksi, lalu satu pertanyaan
`Lanjutkan? [Y/n]`. Konfirmasi tambahan hanya untuk aksi berisiko (restart panel yang sedang jalan, restart
cloudflared, `pkg upgrade`, daftar upgrade dari simulasi). `--yes` menjawab ya untuk rencana dan HP baru; restart
layanan yang sedang melayani (panel/cloudflared) di HP lama tetap butuh TTY (m9).

Contoh rencana (HP baru):

```text
Panel Termux 0.5.1 — penyiapan HP

HP ini belum punya instalasi panel. Yang akan dilakukan:
  1. Memasang panel ke ~/panel/panel
  2. Memperbarui paket Termux (pkg upgrade), lalu memasang: termux-services, nodejs-lts, postgresql, cloudflared, termux-api
  3. Menahan cloudflared dan postgresql dari upgrade otomatis (apt-mark hold; lihat panel docs paket)
  4. Memasang pm2 7.1.2 (npm)
  5. Menyalakan runit, menyiapkan PostgreSQL
  6. Menanyakan alamat panel, email admin, dan OAuth client Google (disimpan di ~/panel/.env)
  7. Login Cloudflare di browser, membuat tunnel, menghubungkan alamat panel
  8. Menyalakan semua otomatis setelah HP menyala (Termux:Boot); HP akan menanyakan izin baterai: pilih Izinkan
  9. Menyalakan panel dan memeriksanya
Butuh internet, ±10–20 menit. Lanjutkan? [Y/n]
```

### 4.2 State dan resume

- **Tidak ada file state** (m6). Nama tunnel diturunkan dari host `APP_BASE_URL` (Q7) atau `--tunnel`; "menunggu login
  Cloudflare" = `cert.pem` belum ada; tunnel id ada di `config.yml`.
- Resume setelah exit 3: pesan exit 3 selalu menyebut perintah persisnya (m8).
- Ctrl-C: tulis file selalu `tmp` + `rename`; folder layanan dibangun bernama titik. Lock dilepas di handler SIGINT.
  Selama pkg/npm jalan, SIGINT pertama dijawab "menunggu pkg selesai; Ctrl-C lagi untuk memaksa" dan anak tidak
  di-`kill` (K7).

### 4.3 Prompt `.env`

Urutan = urutan variabel wajib di `ENV_VARS` (K17); teks prompt (hanya untuk variabel kosong atau placeholder):

1. `Alamat panel (mis. panel.contoh.com):` → validasi `HOSTNAME_RE` (ada di `site.checks.ts`) → `APP_BASE_URL=https://<host>`.
   Dengan `--skip tunnel`: tidak ditanya, `APP_BASE_URL=http://localhost:<PORT>` (m15).
2. `Email Google pemilik panel (super admin):` → `EMAIL_RE`; boleh beberapa dipisah koma.
3. Cetak blok:

   ```text
   Buat OAuth client Google (tipe "Web application") di console.cloud.google.com → APIs & Services → Credentials.
   Tempel alamat ini di "Authorized redirect URIs":
     https://panel.contoh.com/api/auth/callback/google
   Panduan: panel docs google
   ```

4. `Client ID:` (terlihat) dan `Client secret:` (tanpa echo; cetak `(tersimpan, 35 karakter)`, panjang saja, Rule 7).
5. Setiap jawaban langsung ditulis ke `.env` (atomik, 600) lewat `findEnvLine`/`encodeEnvLine`; baris komentar dan
   variabel lain dipertahankan. Nilai yang ditolak `envValueProblem` ditanya ulang.

Tanpa TTY (pipe, `--yes` tanpa terminal): tidak bertanya; bila ada yang kosong → `down` tetap, exit 3 dengan nama
variabel, sama dengan `install-phone.sh` sekarang. `--hostname`/`--admin-email` boleh dipakai (bukan rahasia);
Client ID/secret **tidak** punya flag.

Prompt rahasia: `process.stdin.setRawMode(true)`, baca sampai Enter, Backspace didukung, Ctrl-C → exit 130,
`setRawMode(false)` di `finally`. Non-rahasia: `prompt()` global Bun.

### 4.4 Tunnel

1. `cert.pem` tidak ada → jelaskan ("Login Cloudflare di browser, pilih domain panel"), jalankan `cloudflared tunnel
   login` lewat `CliHost.run` dengan stdout di-pipe: setiap baris diteruskan ke terminal dan URL pertama diambil untuk
   `termux-open-url <url>` bila tersedia (D14; URL login sekali pakai, bukan rahasia). Selesai bila `cert.pem` muncul.
   Tanpa TTY → exit 3.
2. `config.yml` tidak ada → nama tunnel: `--tunnel`, atau jawaban prompt dengan default dari Q7 (`panel-contoh-com`).
   `tunnel list -n <nama> -o json` (tanpa rahasia): belum ada → `tunnel create <nama>` **tanpa** `-o` (D4: `-o json`
   mencetak `TunnelWithToken.token`), lalu id diambil lagi dari `tunnel list -n <nama> -o json` dan
   `~/.cloudflared/<id>.json` harus ada. Sudah ada **dan** kredensialnya ada → pakai; ada tanpa kredensial → minta nama
   lain. Tulis `config.yml` (600): `tunnel`, `credentials-file`, ingress catch-all `http_status:404` (teks sama dengan
   server-termux).
3. Host panel belum di ingress (dan panel tidak `run`, K6) → `ingressStep(ctx, st, [host], false, t =>
   insertIngressRule(t, host, "http://localhost:<PORT>"))` (validasi `cloudflared … ingress validate`,
   `config.yml.bak`, rename atomik), fungsi yang sama dengan job situs.
4. DNS → `system.cloudflared.routeDns(tunnelId, host)` (tanpa `--overwrite-dns`; `DnsWrongZoneError` → pesan "cert.pem
   untuk zona lain: login ulang dengan domain yang benar").
5. Layanan cloudflared: opsi A/B sesuai hasil lab L2 (Q4). A: `cloudflared tunnel token <nama>` di-spawn dengan stdout =
   fd file `~/.cloudflared/token` yang dibuka `O_CREAT|O_EXCL` mode 600; token tidak pernah lewat pipe atau string
   (`--cred-file` tidak cocok karena menulis JSON). B: tulis run script `exec cloudflared tunnel --no-autoupdate run
   <nama>` (pola server-termux). **Kedua opsi butuh pemulihan setelah upgrade paket** (`prerm` menghapus folder
   layanan, paket memasang lagi `down` + template; D5). Pencegahannya adalah hold (langkah 2); resep pemulihan ada di
   `panel docs paket`. Lalu hapus `down`, `sv up cloudflared`. Ingress berubah dan cloudflared sudah jalan → restart
   sesuai K9.

`--skip tunnel`: langkah 8 dilewati; `APP_BASE_URL=http://localhost:<PORT>` tanpa prompt (m15); ringkasan menyebut
panel hanya bisa dibuka di alamat itu (Google menerima localhost).

### 4.5 Keamanan di instalasi yang sudah ada (ringkas)

| Aturan                                                                                                                                                                                                  | Dari                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| File yang ada tidak pernah ditimpa: ecosystem, `apps.json`, run script pm2/panel/cloudflared, `config.yml` (kecuali sisip rute panel), `.env` (kecuali mengisi variabel kosong/placeholder), skrip boot | K6, C1, D7                                 |
| `config.yml` hanya disunting bila layanan `panel` tidak `run`: kandidat → `ingress validate` → `.bak` → rename atomik → fsync (`ingressStep`)                                                           | PLAN/03 §4, D10                            |
| Tidak ada `pkg upgrade`; paket yang hilang lewat simulasi `apt-get -s` dulu; upgrade `cloudflared`/`postgresql`/`nodejs*` ditolak                                                                       | K7, D9                                     |
| Tidak ada restart pm2; restart panel/cloudflared hanya dengan konfirmasi TTY                                                                                                                            | K9, C3                                     |
| Tidak ada fix integrasi dari CLI; rujuk UI                                                                                                                                                              | K6                                         |
| Tidak ada panggilan CLI `pm2`                                                                                                                                                                           | B14                                        |
| Rahasia tidak pernah dicetak/log/argv; kunci `ENV_VARS` tidak diwariskan ke proses anak                                                                                                                 | K10, K11b                                  |
| stdout/stderr `cloudflared` tidak pernah dicetak atau dimasukkan pesan error; hanya kode keluar + baris yang lolos `redactLines`                                                                        | K10, D4                                    |
| CLI tidak menulis audit ke `panel.db` (tidak ada aktor login); setiap file yang diubah dicetak dengan path-nya                                                                                          | C6 (tidak berlaku: bukan aksi admin panel) |

Uji penerimaan wajib 0.5.1: skenario `poco` (fixture meniru POCO: ecosystem tulisan tangan 0600 tanpa blok, run pm2
tanpa `--no-auto-exit`, `config.yml` + `cert.pem`, semua layanan `run`, cloudflared/postgresql di-hold) → `init --yes`
tidak mengubah satu byte pun di luar `~/panel/panel*`, tidak memanggil `pkg upgrade`/`sv restart pm2`/`sv restart
cloudflared`, dan tidak menyunting `config.yml`.

Test unit 0.5.1 lain yang wajib (selain test init lama: rencana `fresh`/`poco`/parsial, idempoten, lock, Ctrl-C):
perekam `exec` tanpa `-o` pada `tunnel create` dan tanpa token di string apa pun (D4); `.env` = `.env.example` 0.4.0 →
keempat variabel ditanya (D7); simulasi `apt-get -s` yang memuat `postgresql` → exit 3 tanpa `pkg install` (D9);
`dpkg --audit` tidak kosong di HP lama → exit 3 (D9); panel `run` → `config.yml` tidak berubah (D10); `--yes` tanpa
TTY di HP lama → exit 3 tanpa restart (m9); `--skip tunnel` → tidak ada prompt alamat (m15); runsvdir dari perekam
menerima env tanpa kunci `ENV_VARS` dan dengan `SVDIR` + `LOGDIR` (D3, m4); snippet `install.sh` tanpa TTY (D6).

## 5. `rollback` (0.5.0) dan `upgrade` (ditunda)

### 5.1 `panel rollback`

1. Butuh `~/panel/panel.prev`; tidak ada → exit 1 "tidak ada versi sebelumnya".
2. `detectRuntime(panel.prev)` (`deploy/elf.runtime.ts`) harus aarch64/bionic (di mode fake: aturan sama terhadap
   fixture); gagal → exit 1, tidak ada yang diubah (m17). **`panel.prev` tidak pernah dieksekusi** oleh CLI, karena binary
   < 0.5.0 mengabaikan argumen dan akan menyalakan server.
3. Peringatan skema (m13): buka `panel.db` read-only (K12). Bila `app_meta.panel_version` ≠ versi di nama snapshot
   terbaru (`snapshots/panel.db.<versi>.<waktu>`) → cetak "Database sudah dimigrasi oleh v<panel_version>. Bila panel
   lama error saat start: `panel rollback --db`".
4. Rencana + konfirmasi TTY (`--yes` melewati). Tanpa TTY dan tanpa `--yes` → exit 3.
5. **Tukar tanpa celah**: `cp panel.prev panel.new` (755) → `link(panel, panel.old)` → `rename(panel.new, panel)` →
   `rename(panel.old, panel.prev)`. `~/panel/panel` tidak pernah hilang, sehingga runsv yang restart di tengah tetap
   menemukan binary. Rollback dua kali = kembali ke versi baru.
6. `--db`: pilih snapshot terbaru, tampilkan versi + waktu + "perubahan data setelah waktu itu hilang", konfirmasi; cek
   ruang (ukuran `panel.db` + snapshot); `sv down panel`; salin `panel.db` sekarang ke
   `snapshots/panel.db.before-rollback.<waktu>` (600); salin snapshot → `panel.db`; hapus `-wal`/`-shm`.
7. `sv -w 130 restart panel` (atau `sv up` bila mati) lewat `CliHost.exec` dengan `SVDIR` eksplisit, tunggu
   `/api/health` ≤ 30 dtk, cetak versi yang menjawab.
8. Aturan `panel.prev` dari D12 berlaku untuk **penulis** `panel.prev` (installer), bukan rollback: rollback tidak pernah
   kehilangan binary baik, karena binary baik justru menjadi `panel`. Di 0.5.0, `install-phone.sh` langkah 1 menyalin
   `panel` → `panel.prev` hanya bila `/api/health` menjawab ok (panel terpasang sehat) atau `panel.prev` belum ada;
   selain itu `panel.prev` dibiarkan dan satu baris dicetak. `rollback_hint` di `install-phone.sh` menjadi `panel rollback
   [--db]`.

### 5.2 `panel upgrade` (ditunda, C14)

Upgrade di 0.5.0 dan 0.5.1 = jalankan lagi perintah `install.sh` (`PANEL_VERSION=vX` untuk versi tertentu); README dan
`--help` menyebutnya. Alasan menunda (D12): menduplikasi `install.sh` → `init`, `SHA256SUMS` dari asal yang sama dengan
tarball hanya membuktikan integritas (bukan asal), dan `gh attestation verify` tidak tersedia di HP. Syarat saat
dibangun nanti, dicatat di §15: tanda tangan Ed25519 atas `SHA256SUMS` dengan kunci publik ter-embed (`node:crypto`
`verify`, tanpa dependency), `detectRuntime` sebelum binary baru dieksekusi, aturan `panel.prev` D12, rumus ruang
`install-phone.sh` + ukuran ekstrak + `panel.new`, dan target < 0.5.0 ditolak.

## 6. `docs` dan `env`

### 6.1 `docs`

- `panel docs` = daftar topik; `panel docs <topik>` = cetak teks polos (≤ ±60 baris per topik, lebar ≤ 100 kolom).
- Topik (4, m16): `google` (OAuth client, redirect URI), `cloudflare` (login, tunnel, ingress, Access), `android`
  (Termux dari F-Droid/GitHub, Termux:Boot dibuka sekali, Termux:API, pembatas proses anak, baterai, izin wake-lock),
  `paket` (kenapa `cloudflared`/`postgresql` di-hold; resep upgrade aman cloudflared: `sv down cloudflared` → `apt-mark
  unhold cloudflared` → `pkg install cloudflared` → pulihkan `run` → hapus `down` → `sv up cloudflared` → `apt-mark hold
  cloudflared`; resep PostgreSQL mayor: `pg_dumpall` **sebelum** upgrade → `initdb` baru → restore, karena repo Termux
  tidak membawa binary lama untuk `pg_upgrade`; file `.env.*` tambahan yang ikut dimuat Bun; `BUN_OPTIONS` dan
  `BUN_BE_BUN=1` mengubah perilaku binary, m18).
- Sumber: `docs/cli/<topik>.md` di-embed (`with { type: "text" }`, pola `ecosystem.template.ts`); README menautkan
  folder ini, bukan menyalin. Topik tak dikenal → exit 2 + daftar.
- Docs 0.5.0 tidak menyebut `panel init`/`panel upgrade` (belum ada); ditegakkan `cli.docs.test.ts`.

### 6.2 `env` (K17, K18)

Variabel yang benar-benar diwajibkan `parseEnv` (`src/server/env.ts`, diperiksa 2026-11-27): `APP_BASE_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPER_ADMIN_EMAILS`. `PORT` (bawaan 3200) dan `PANEL_DATA_DIR`
(bawaan `./data`) opsional, jadi **tidak** masuk template minimal. Opsional lain: `PANEL_CONNECTIVITY_URL`,
`PANEL_SKIP_SNAPSHOT`. `PGUSER`, `PM2_HOME`, `NODE_ENV`, `HOME`, `PREFIX` adalah env alat/OS, bukan konfigurasi panel,
dan tidak masuk skema (jadi juga tidak dihapus K11b). `placeholders`: `APP_BASE_URL` = `https://panel.example.com`,
`SUPER_ADMIN_EMAILS` = `you@example.com`.

`panel env` (stdout persis, nilai kosong):

```text
# Panel Termux — .env minimal. Isi nilai yang kosong, simpan sebagai ~/panel/.env (chmod 600).
# Pengaturan lain (Cloudflare, backup, Telegram, situs, monitor) ada di /dev → Pengaturan. Panduan: panel docs google

# Alamat publik panel (https://domain, atau http://localhost:<port> saat lokal). Contoh: https://panel.contoh.com
APP_BASE_URL=
# Client ID OAuth Google (tipe Web application). Contoh: 1234-abcd.apps.googleusercontent.com
GOOGLE_CLIENT_ID=
# Client secret OAuth Google. Rahasia: jangan dibagikan atau di-commit.
GOOGLE_CLIENT_SECRET=
# Email Google yang menjadi super admin, pisahkan dengan koma. Contoh: kamu@contoh.com
SUPER_ADMIN_EMAILS=
```

`panel env --full` menambahkan (bawaan diambil dari `default` di skema):

```text

# --- Opsional: hapus tanda # untuk mengubah nilai bawaan ---
# Port panel (selalu listen di 127.0.0.1 saja).
# PORT=3200
# Folder panel.db dan secret (cadangkan!). Relatif ke working directory.
# PANEL_DATA_DIR=./data
# URL yang dicek monitor untuk membedakan "tidak ada internet" dari "situs mati".
# PANEL_CONNECTIVITY_URL=https://www.gstatic.com/generate_204
# 1 = migrasi tetap jalan walau snapshot panel.db gagal (mis. disk penuh). Hanya untuk satu kali start, lalu hapus.
# PANEL_SKIP_SNAPSHOT=0
```

Aturan:

- Header tanpa nomor versi, supaya `.env.example` tidak berubah tiap rilis.
- Variabel `secret: true` tidak pernah diberi contoh nilai; komentarnya menyebut "Rahasia". `placeholders` tidak pernah
  dicetak sebagai nilai.
- Satu baris komentar per variabel (deskripsi + `Contoh:` bila ada `example`). Teks deskripsi hanya di skema.
- Format baris lewat `encodeEnvLine` (B23) agar `.env.example` dan file buatan `init` sama persis.
- Pemeriksaan stdout dan `.env` memakai `statSync`/`fstatSync(1)` saja; isi file tidak pernah dibaca:
  - stdout adalah file yang sama (dev + inode) dengan `./.env` atau `~/panel/.env` dan **ukurannya 0** (shell sudah
    memotongnya, `>`) → template tetap ditulis, stderr `⚠️ .env ini sudah dikosongkan oleh shell sebelum panel berjalan;
    isi lamanya hilang.` + `→ pulihkan dari cadangan (secrets.tar.gz), lain kali pakai: panel env > .env.new`, exit 0.
  - stdout file yang sama dan **ukurannya > 0** (`>>` atau `1<>`) → **tidak menulis apa pun**, stderr `❌ panel env
    tidak menambah ke .env yang berisi: kunci kosong di akhir akan menimpa nilai lama.` + `→ pakai: panel env >
    .env.new`, exit 1 (m10).
  - Selain itu, `./.env` atau `~/panel/.env` ada → `ℹ️ <path> sudah ada. "panel env > .env" akan menimpanya.` +
    `→ pakai: panel env > .env.new, atau aktifkan set -o noclobber (shell menolak menimpa; >| memaksa).`
  - Panel tidak bisa mencegah penimpaan: shell memotong file target **sebelum** proses dijalankan. Hal ini ditulis di
    `panel env --help` dan README bagian `.env`.
- `.env.example` di repo = output `panel env --full` byte demi byte. Diperbarui dengan
  `bun src/server/main.ts env --full > .env.example`; test gagal bila berbeda (K15: tarball tetap memuat file ini).
  Konsekuensi: `PORT` dan `PANEL_DATA_DIR` di `.env.example` menjadi baris komentar, dan `APP_BASE_URL`/
  `SUPER_ADMIN_EMAILS` kosong (bukan placeholder lagi). Nilai efektifnya sama (bawaan), dan `install-phone.test.sh`
  (`cmp .env .env.example`) tetap lulus.

## 7. Arsitektur kode

### 7.1 File baru (0.5.0)

| File                          | Isi                                                                                                                                                                                                                                    | Batas (Rule 8) |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `src/server/main.ts`          | Entry build (K1, K2, K11b): `entryRoute(argv, isTty): "serve" \| "cli"` (diekspor untuk test) + eksekusi hanya bila `import.meta.main`; ±25 baris                                                                                      | –              |
| `src/cli/cli.main.ts`         | `runCli(argv, io): Promise<number>`: normalisasi alias, `parseArgs`, bantuan untuk argv kosong (K2), dispatch, peta error → exit code                                                                                                  | 150            |
| `src/cli/cli.output.ts`       | `CliOut` (`line`, `check`, `json`), simbol, tulis ke stdout/stderr yang bisa diganti test                                                                                                                                              | 200            |
| `src/cli/cli.help.ts`         | Teks bantuan umum + per perintah (Indonesia), termasuk `panel serve`, upgrade = install.sh, aturan `panel env > .env.new`                                                                                                              | 200            |
| `src/cli/cli.host.ts`         | `CliHost` termux: deteksi mode (K13), `system` (`createTermuxSystem`), `exec` (`runTermux`, probe pendek, env sudah bersih), `paths` (HOME, PREFIX, SVDIR, LOGDIR), `tty` (`isTty`, `confirm` lewat `prompt()`), `proc` (baca `/proc`) | 200            |
| `src/cli/cli.host.fake.ts`    | Host fake: skenario `fresh`/`ready`/`poco`/`nosv` (Termux tanpa `sv`, D1), jawaban setiap probe §3.1, perekam `exec` (argv + **nama** kunci env); `PANEL_CLI_FAKE_RECORD=<file>` menulis rekaman itu untuk test shell (tanpa nilai)    | 250            |
| `src/cli/env.file.ts`         | Baca `~/panel/.env` eksplisit per kunci `ENV_VARS` (K11a), tanpa log nilai                                                                                                                                                             | 100            |
| `src/cli/doctor.probe.ts`     | Kumpulkan `DoctorProbe`                                                                                                                                                                                                                | 250            |
| `src/cli/doctor.checks.ts`    | Fungsi murni → `DoctorCheck[]`                                                                                                                                                                                                         | 250            |
| `src/cli/doctor.command.ts`   | Perintah `doctor` (+ integrasi, DB read-only/`:memory:`)                                                                                                                                                                               | 150            |
| `src/cli/docs.command.ts`     | Perintah `docs` + import 4 topik                                                                                                                                                                                                       | 100            |
| `src/cli/env.command.ts`      | Perintah `env`: `renderEnvTemplate` → stdout, cek `.env`/`fstat(1)` → stderr/exit (§6.2)                                                                                                                                               | 100            |
| `src/cli/rollback.command.ts` | `rollback` (§5.1)                                                                                                                                                                                                                      | 150            |
| `src/shared/env.schema.ts`    | `ENV_VARS` + `renderEnvTemplate({ full })` (K17), murni                                                                                                                                                                                | 200            |
| `src/shared/doctor.types.ts`  | `DoctorCheck`, `DoctorReport` (skema `--json`)                                                                                                                                                                                         | 100            |
| `docs/cli/*.md`               | 4 topik `docs`                                                                                                                                                                                                                         | –              |
| `scripts/cli.test.sh`         | Test shell binary hasil compile (§9.2)                                                                                                                                                                                                 | –              |

File 0.5.1 (bukan bagian 0.5.0): `src/cli/init.plan.ts`, `init.run.ts`, `init.packages.ts`, `init.files.ts`,
`init.env.ts`, `init.tunnel.ts`, `cli.prompt.ts` (`askSecret` raw mode), `templates.ts`, dan bentuk kedua
`CliHost.run` (stdio `inherit` atau pipe yang diteruskan, tanpa timeout, kode keluar saja; D14). `runTermux` (timeout
10 dtk, `stdin: "ignore"`, output ditampung) tetap hanya untuk probe pendek. Tidak ada `release.fetch.ts`/
`upgrade.command.ts` (C14).

Tidak ada interface dengan satu implementasi selain `CliHost` (dua: termux + fake, dibutuhkan test dan mode fake).

### 7.2 Peta pemakaian ulang

| Kebutuhan                         | Dipakai dari                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pemeriksaan integrasi + copy      | `sites/integration.service.ts` `createIntegration`; `web/i18n/id.site.setup.ts`                                                                                                                   |
| Adapter sistem                    | `system/system.select.ts` `createTermuxSystem`, `system/system.fake.ts` `createFakeSystem` (**bukan** `selectSystem`: memilih fake bila `sv` tidak ada dan menulis `log.info` ke stdout; D1, D15) |
| Status layanan runit              | `RunitAdapter.supervise`/`control`                                                                                                                                                                |
| Health panel                      | `NetAdapter.httpStatus`                                                                                                                                                                           |
| Probe https publik                | `system/cloudflared.termux.ts` `probeHttps`                                                                                                                                                       |
| Arsitektur binary `panel.prev`    | `deploy/elf.runtime.ts` `detectRuntime` (rollback; 0.5.1 init langkah 1; nanti upgrade) (m17)                                                                                                     |
| Nama snapshot                     | `db/snapshot.ts` (`panel.db.<versi>.<waktu>`, `SNAPSHOT_KEEP`)                                                                                                                                    |
| Tulis/baca `.env`                 | `shared/env.codec.ts` `findEnvLine`, `decodeEnvValue`, `encodeEnvLine`, `envValueProblem`                                                                                                         |
| Validasi `.env`                   | `server/env.ts` `parseEnv`, `EnvError`                                                                                                                                                            |
| Daftar variabel, bawaan, template | `shared/env.schema.ts` `ENV_VARS`, `renderEnvTemplate` (baru, K17)                                                                                                                                |
| Bawaan `PANEL_CONNECTIVITY_URL`   | `monitor/monitor.service.ts` `CONNECTIVITY_PROBE_URL` (test menyamakan dengan skema)                                                                                                              |
| Exec Termux tanpa shell           | `exec/termux.exec.ts` `runTermux`, `termuxPrefix`                                                                                                                                                 |
| DB read-only / `:memory:`         | `bun:sqlite` + `drizzle` + `db/migrate.ts` `runMigrations` (bukan `openDb`)                                                                                                                       |
| Ruang kosong                      | `statfsSync` (pola `health.service.ts`)                                                                                                                                                           |
| 0.5.1: ingress, DNS, template     | `sites/site.steps.ts` `ingressStep`, `sites/ingress.editor.ts`, `CloudflaredAdapter.routeDns`, `ecosystemFromTemplate`, `ensureAppsJson`, `HOSTNAME_RE`, `EMAIL_RE`, `log/redact` `redactLines`   |

Perubahan kecil pada file yang ada (pemilik ditetapkan §10): `scripts/build.ts` (entrypoint → `main.ts`),
`src/server/boot.ts` (penjaga instance §2.4), `src/server/env.ts` (daftar wajib dan bawaan dari `ENV_VARS`; validasi
per variabel tetap di sini), `.env.example` (digenerate), `scripts/install-phone.sh` (+ test: aturan `panel.prev`,
placeholder = kosong, `rollback_hint`), `.github/workflows/{ci,release}.yml` (satu langkah). `package.json`:
`scripts.dev` tetap `index.ts`; tidak ada dependency baru.

### 7.3 CLI dan ukuran/bundle server

- Arah impor satu jalur: `src/cli/**` boleh mengimpor `src/server/**` dan `src/shared/**`; **`src/server/**` tidak
  pernah mengimpor `src/cli/**`** kecuali `main.ts` lewat `import()` dinamis. Ditegakkan `tests/cli.imports.test.ts`
  (memindai teks import), termasuk: `main.ts` hanya mengimpor statis `src/shared/env.schema.ts`; tidak ada file
  `src/cli/**` yang mengimpor `system/system.select`.
- Bundle web (`bun run bundle:check`, B30/C10) tidak tersentuh: CLI tidak diimpor oleh `src/web/**`.
- Ukuran binary: tambahan CLI diharapkan < 300 KB (minified, termasuk `docs/cli/*.md`); diukur di gerbang G2
  (`ls -l dist/panel-android-arm64` sebelum/sesudah). Jalur serve mengevaluasi modul yang sama dengan sekarang (plus
  `main.ts` dan `env.schema.ts`).
- Lab L5 (D13) di gerbang G0: build nyata `bun scripts/build.ts local` (splitting, tailwind, minify, loader `.sql`) dari
  **salinan** working tree di scratchpad dengan modul penanda (efek samping menulis `BOOT_EVAL` ke stderr) di awal
  `boot.ts`. `-v`, `--help`, `env`, `docs` tidak boleh mencetak penanda; `serve` harus. Penanda tidak pernah masuk repo.
  Gagal → STOP, lapor ke koordinator (pilihan: entry CLI tanpa splitting, atau build terpisah); jangan ditambal.
- Waktu `panel -v`/`env` di HP < 0,5 dtk (L4). `env.command.ts` hanya mengimpor `src/shared/env.schema.ts`,
  `src/shared/env.codec.ts`, dan `node:fs`/`node:os` (ditegakkan `cli.imports.test.ts`).

## 8. Rilis dan `install.sh`

### 8.1 0.5.0

- Tarball dan `scripts/install-release.sh` **tidak berubah** (K15). `scripts/package-release.sh` tidak berubah.
- `scripts/install-phone.sh`: aturan `panel.prev` (§5.1 langkah 8), placeholder `ENV_VARS` dihitung kosong pada
  pemeriksaan `REQUIRED_VARS` (D7), `rollback_hint` → `panel rollback [--db]`.
- Upgrade POCO 0.4.0 → 0.5.0 = perintah `install.sh` seperti biasa (atas perintah pemilik). `install-phone.sh` tidak
  mengeksekusi binary; runit menjalankannya tanpa TTY → serve. Setelahnya `sv status panel` harus `run` (kriteria §11).
- **Sebelum 0.5.0 terpasang, binary panel tidak dijalankan dengan argumen apa pun di POCO** (0.4.0 mengabaikan
  argumen dan menyalakan panel kedua).
- `.github/workflows/ci.yml` dan `release.yml`: tambah `bun run build:local && sh scripts/cli.test.sh dist/panel`
  setelah test shell yang ada.

### 8.2 0.5.1: `scripts/install-release.sh` menjadi bootstrap tipis

Tetap: `set -eu`, `PANEL_VERSION_DEFAULT` ditanam, cek `aarch64`, `$PREFIX`, `curl`/`tar`/`sha256sum`, ruang 400 MB,
unduh `SHA256SUMS` + tarball, `sha256sum -c`, cache `~/panel-src/<versi>`. Berubah:

- Hapus syarat `termux-services` dan peringatan `cloudflared` (sekarang tugas `init`).
- Ekstrak hanya `panel-android-arm64` dan `VERSION`; pangkas `~/panel-src` selain versi sekarang + sebelumnya (m12);
  lalu (D6: `[ -r /dev/tty ]` hanya memeriksa izin, sedangkan redirect di ssh tanpa terminal gagal dengan "No such
  device or address" sebelum `exec`):

  ```sh
  BIN="$SRC_DIR/panel-android-arm64"
  if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$BIN" init "$@" </dev/tty; else exec "$BIN" init "$@"; fi
  ```

- Header mendokumentasikan exit code = exit code `panel init` (0/1/3/4). Pesan sukses/exit 3 dipindah ke `init`.
- `scripts/install-release.test.sh`: stub binary yang mencatat `init "$@"`, cek `exec` dan propagasi exit, dijalankan
  **tanpa TTY**.

## 9. Test (0.5.0)

Tanpa Docker (C16). Unit test memakai adapter fake lewat `PANEL_CLI_FAKE`/host fake; test shell menjalankan binary
hasil compile dalam mode fake di **macOS** (lokal, sebelum worker melapor selesai) dan **CI ubuntu**. Langkah yang
benar-benar menyentuh Termux tidak bisa dibuktikan di CI; itu bagian lab §14 dan QA §9.3.

### 9.1 Unit (`bun test`, semua dengan `CliHost` fake + HOME/PREFIX sementara)

| File                                  | Yang diuji (assertion nyata)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/cli.args.test.ts`              | `entryRoute`: `[]` + bukan TTY → `serve`; `[]` + TTY → `cli`, dan `runCli([])` di TTY mencetak bantuan berisi `panel serve`, exit 2, tanpa memanggil boot (spy); `["serve"]` → `serve`; `["serve","--x"]` → exit 2. `-h`/`--help`/`--h`/`help` sama; `-v`/`--version`/`--v` = versi `package.json`; `-v --json` → 2; flag tak dikenal → 2 tanpa boot; `init`/`upgrade` → 2 + baris install.sh                                                                                                                                                                                                                                                                                                                                                                |
| `tests/cli.host.test.ts`              | Deteksi mode K13: PREFIX sementara dengan `bin/pkg` tanpa `bin/sv` → termux (D1); `TERMUX_VERSION` saja → termux; tanpa keduanya dan tanpa `PANEL_CLI_FAKE` → error "bukan Termux"; `PANEL_CLI_FAKE=ready` → fake. Pembersihan env: setelah fungsi pembersih K11b, `process.env` tanpa satu pun kunci `ENV_VARS`, `PATH`/`LD_PRELOAD`/`ANDROID_*` tetap                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/server.instance-guard.test.ts` | Server `Bun.serve` palsu menjawab `/api/health` di port P → `bootPanel(env PORT=P, dataDir sementara)` melempar `PanelAlreadyRunningError`; `dataDir` tanpa `panel.db` dan `secret`. Listener TCP yang menerima tetapi tidak menjawab → ditolak setelah ±1 dtk. Port bebas → boot normal. `PORT=0` → penjaga dilewati (test boot yang ada tetap lulus)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/cli.doctor.test.ts`            | `fresh` → error `pkg_*`/`binary_installed`, exit 1; `ready` → exit 0; `nosv` → `pkg_termux_services` error, **bukan** layanan ok (D1); `poco` → `ecosystem_spreads_apps_json` error dengan label persis dari `idSiteSetup`, `pkg_held` ok; `.env` = `.env.example` 0.4.0 → `env_complete` menyebut keempat variabel (D7); `pkg_held`, `postgres_major`, `cloudflared_down_file` (error bila `config.yml` ada), `env_extra_files`, `app_termux_boot/api` (+ timeout → info), `termux_source`, `pkg_manager_apt` dari file, `panel_instances` (2 proses serve → error); doctor tidak membuat `panel.db`/`apps.json`/file apa pun (snapshot fs sebelum/sesudah); seluruh stdout `--json` di-parse `JSON.parse` tanpa pemangkasan dan cocok `DoctorReport` (D15) |
| `tests/cli.env.test.ts`               | `panel env` = tepat 4 kunci wajib (urutan `ENV_VARS`), semua nilai kosong; `--full` = semua kunci skema, opsional dikomentari dengan bawaan; tidak ada `example` untuk `secret: true`; placeholder tidak tercetak; output di-parse dotenv sama dengan skema; `.env.example` === `renderEnvTemplate({ full: true })`; `--env` = `env`; `.env` ber-nilai rahasia di cwd → nilainya tidak muncul di stdout/stderr dan isi file tidak berubah; stdout = `./.env` kosong → peringatan "dikosongkan", exit 0; stdout = `./.env` berisi (append) → 0 byte ditulis, exit 1 (m10)                                                                                                                                                                                     |
| `tests/env.schema.test.ts`            | Kunci skema = kunci tipe `Env`; daftar wajib `ENV_VARS` = variabel yang membuat `parseEnv` melempar `EnvError` bila kosong; bawaan `PORT`/`PANEL_DATA_DIR` = hasil `parseEnv` tanpa nilai; bawaan `PANEL_CONNECTIVITY_URL` = `CONNECTIVITY_PROBE_URL`; `placeholders` = nilai `.env.example` 0.4.0; `REQUIRED_VARS` di `scripts/install-phone.sh` (teks) = daftar wajib                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/cli.docs.test.ts`              | Tepat 4 topik dan tidak kosong; topik tak dikenal (mis. `instal`) → 2; setiap `panel <perintah>` yang disebut di docs ada di dispatcher (jadi tidak ada `init`/`upgrade`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/cli.rollback.test.ts`          | Tukar dua arah; `panel` ada di setiap langkah tukar (hook fs fake); tanpa `panel.prev` → 1; `panel.prev` bukan aarch64/bionic (fixture ELF x86-64) → 1, tidak ada yang berubah; tanpa TTY dan tanpa `--yes` → 3; `--db` membuat salinan `before-rollback` dulu, menghapus `-wal`/`-shm`; peringatan skema bila `app_meta.panel_version` ≠ versi snapshot terbaru (m13); perekam: `panel.prev` tidak pernah dieksekusi, `sv -w 130 restart panel` dengan `SVDIR`                                                                                                                                                                                                                                                                                              |
| `tests/cli.imports.test.ts`           | Tidak ada file `src/server/**` (selain `main.ts`) atau `src/web/**` yang mengimpor `src/cli/**`; `main.ts` hanya mengimpor statis `env.schema.ts`; `env.command.ts` dan `env.schema.ts` tidak mengimpor `src/server/**`; tidak ada `src/cli/**` yang mengimpor `system.select`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `scripts/install-phone.test.sh`       | Panel sehat (stub health) → `panel.prev` diperbarui; tidak sehat dan `panel.prev` ada → `panel.prev` tetap; placeholder 0.4.0 di `.env` → exit 3 menyebut `APP_BASE_URL SUPER_ADMIN_EMAILS`; petunjuk rollback = `panel rollback`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 9.2 Shell (`scripts/cli.test.sh <binary>`, pola `install-phone.test.sh`)

Menjalankan binary hasil `bun run build:local` dengan HOME/PREFIX sementara dan stdin `</dev/null` (bukan TTY):

- `--help`, `-h`, `--h` exit 0 dan memuat "Pemakaian" serta `panel serve`; `-v`, `--v` = versi `package.json`;
  `-v --json` exit 2.
- `--bogus` exit 2, selesai < 2 dtk, **tidak** membuat `data/panel.db` dan tidak listen (cek port).
- D2: folder berisi `.env` lengkap (nilai palsu) dengan `PORT` = port server kecil `bun -e` yang menjawab
  `/api/health` → `serve` dan tanpa argumen sama-sama exit 1 dalam < 3 dtk, `data/panel.db` dan `data/secret` tidak
  dibuat.
- Di folder berisi `.env` dengan `APP_BASE_URL` palsu: `--version` hanya mencetak versi; tidak ada file baru di HOME
  (`find -newer` penanda kosong).
- `PANEL_CLI_FAKE=ready doctor` exit 0; `PANEL_CLI_FAKE=fresh doctor` exit 1; seluruh stdout `doctor --json`
  di-parse `bun -e`, `schema` = 1; tanpa `PANEL_CLI_FAKE` di macOS/ubuntu → exit 1 dan stderr memuat "bukan Termux".
- D3: cwd berisi `.env` dengan `GOOGLE_CLIENT_SECRET=<sentinel>` + `PANEL_CLI_FAKE=ready PANEL_CLI_FAKE_RECORD=f doctor`
  → `f` tidak memuat satu pun nama kunci `ENV_VARS` dan tidak memuat sentinel; sentinel juga tidak ada di stdout/stderr.
- `docs` exit 0 dan mendaftar 4 topik; `docs paket` tidak kosong; `docs instal` exit 2.
- `env` exit 0; stdout di-parse sebagai dotenv dan kuncinya tepat `APP_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  SUPER_ADMIN_EMAILS`; stderr kosong di folder tanpa `.env`. `env > f` identik dengan stdout `env`; `env --full > f`
  identik dengan `.env.example` repo; `--env` = `env`.
- Di folder berisi `.env` (nilai palsu): `env > out` → stderr memuat `sudah ada`, stdout bebas nilai palsu, `.env` tidak
  berubah. `env > .env` → peringatan "dikosongkan", exit 0. `env >> .env` (file berisi) → exit 1, isi `.env` tidak
  berubah (m10).
- `PANEL_CLI_FAKE=ready rollback --yes` tanpa `panel.prev` → exit 1.

### 9.3 Manual (QA 0.5.0, oleh koordinator setelah izin pemilik)

Setelah 0.5.0 terpasang di POCO lewat `install.sh`: `sv status panel` = `run` (runit tanpa TTY tetap serve); `panel -v`
dan `panel env > /dev/null` dari folder selain `~/panel` < 0,5 dtk (L4); `panel doctor` di POCO dibandingkan dengan
kartu Persiapan, `find ~ $PREFIX/var/service -newer <penanda>` kosong selain log; `pkg_held` ok (C15);
`panel_instances` ok; `cd ~/panel && ./panel </dev/tty` di terminal → bantuan, exit 2, panel yang jalan tidak
terganggu.

## 10. Rencana kerja 0.5.0 (worker, kepemilikan file eksklusif)

Worker tidak commit/push/ganti branch dan tidak menyentuh file worker lain. Setiap worker menjalankan test yang ia
tulis (Rule 3) plus `bun run typecheck` dan `bun run lint` sebelum melapor. Docker dilarang. POCO tidak disentuh worker
mana pun.

| Gel. | Worker                          | File (eksklusif)                                                                                                                                                                                                                                                                                                                                       | Bergantung pada         | Test yang wajib lulus sebelum lapor                                 |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------- |
| W0   | `wkr-cli-core-01`               | `src/server/main.ts`, `scripts/build.ts`, `src/cli/cli.main.ts`, `src/cli/cli.output.ts`, `src/cli/cli.help.ts`, `src/cli/cli.host.ts`, `src/cli/cli.host.fake.ts`, `src/cli/env.file.ts`, `src/shared/doctor.types.ts`, `tests/cli.args.test.ts`, `tests/cli.host.test.ts`, `tests/cli.imports.test.ts`, `PLAN/debate/07-cli-lab-results.md` (L5, L6) | bentuk `ENV_VARS` (K17) | `cli.args`, `cli.host`, `cli.imports`; L5 + L6 dicatat              |
| W0   | `wkr-cli-env-01` (a)            | `src/shared/env.schema.ts`, `tests/env.schema.test.ts`                                                                                                                                                                                                                                                                                                 | –                       | `env.schema` (bagian yang tidak butuh `env.ts` baru)                |
| W0   | `wkr-cli-guard-01`              | `src/server/boot.ts` (penjaga §2.4 + `PanelAlreadyRunningError` + exit 1 di `start()`), `tests/server.instance-guard.test.ts`                                                                                                                                                                                                                          | –                       | `server.instance-guard` + semua `tests/server.*.test.ts` yang ada   |
| W1   | `wkr-cli-doctor-01`             | `src/cli/doctor.probe.ts`, `src/cli/doctor.checks.ts`, `src/cli/doctor.command.ts`, `tests/cli.doctor.test.ts`                                                                                                                                                                                                                                         | G0                      | `cli.doctor`                                                        |
| W1   | `wkr-cli-env-01` (b)            | `src/cli/env.command.ts`, `src/server/env.ts`, `.env.example` (digenerate), `tests/cli.env.test.ts`, `tests/env.test.ts` (bila terdampak)                                                                                                                                                                                                              | G0                      | `cli.env`, `env.schema`, `env`                                      |
| W1   | `wkr-cli-docs-01`               | `src/cli/docs.command.ts`, `docs/cli/google.md`, `docs/cli/cloudflare.md`, `docs/cli/android.md`, `docs/cli/paket.md`, `tests/cli.docs.test.ts`                                                                                                                                                                                                        | G0                      | `cli.docs`                                                          |
| W1   | `wkr-cli-rollback-01`           | `src/cli/rollback.command.ts`, `tests/cli.rollback.test.ts`, `scripts/install-phone.sh`, `scripts/install-phone.test.sh`                                                                                                                                                                                                                               | G0                      | `cli.rollback`, `sh scripts/install-phone.test.sh`                  |
| G1a  | `wkr-cli-core-01` (dilanjutkan) | `src/cli/cli.main.ts` saja: entri dispatch `doctor`, `docs`, `env`, `rollback`                                                                                                                                                                                                                                                                         | W1 selesai              | semua `tests/cli.*`                                                 |
| W2   | `wkr-cli-shell-01`              | `scripts/cli.test.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` (satu langkah masing-masing)                                                                                                                                                                                                                                        | G1                      | `bun run build:local && sh scripts/cli.test.sh dist/panel` di macOS |
| W3   | `wkr-docs-cli-01`               | `README.md` (bagian CLI, `panel serve`, Rollback → `panel rollback`, Upgrade = jalankan lagi `install.sh`, `.env` → `panel env > .env.new`; Rule 16 terbatas), `CHANGELOG.md` `[0.5.0]`, `package.json` (versi 0.5.0)                                                                                                                                  | G2                      | `bun test` penuh (versi di test mengikuti `package.json`)           |

Kontrak yang dibekukan di W0 (ditulis `wkr-cli-core-01`, dibaca semua worker W1): `Command = (args: ParsedArgs, io:
CliIo) => Promise<number>`, `CliHost` (§7.1), `CliOut`, `DoctorCheck`/`DoctorReport`, daftar probe §3.1 yang dijawab
host fake. Bentuk `ENV_VARS` dibekukan di K17, sehingga `wkr-cli-env-01` (a) dan `wkr-cli-core-01` paralel; `main.ts`
hanya butuh `ENV_VARS[*].name`. Probe baru yang ditemukan worker W1 → lapor ke koordinator, yang meminta
`wkr-cli-core-01` menambah jawaban fake; worker W1 tidak menyunting `cli.host.fake.ts`.

Gerbang:

- **G0** (setelah W0): `bun run typecheck`, `bun run lint`, `bun test` lulus; kontrak di atas ada; L5 lulus (bila gagal:
  STOP, koordinator memutuskan, §7.3); L6 dicatat (doctor memakai fallback `:memory:` apa pun hasilnya).
- **G1** (setelah W1 + G1a): typecheck, lint, `bun test` penuh, `sh scripts/install-phone.test.sh` lulus; review diff
  koordinator (tidak ada empty catch, tidak ada nilai rahasia di log/pesan, batas baris Rule 8).
- **G2** (setelah W2): `bun run build:local && sh scripts/cli.test.sh dist/panel` lulus di macOS; `bun run build`
  (android) naik < 300 KB; `bun run bundle:check` lulus. CI ubuntu dibuktikan saat koordinator push (atas perintah
  pemilik).
- **G3** (setelah W3): checklist pre-deploy Rule 6 + laporan Rule 18; rilis atas perintah pemilik; QA §9.3.

## 11. Kriteria penerimaan 0.5.0

- [x] `panel` tanpa argumen dan tanpa TTY: perilaku serve tidak berubah (test boot yang ada lulus; runit POCO tetap `run`
      tanpa mengubah run script).
- [x] `panel` tanpa argumen di terminal: bantuan + `panel serve`, exit 2, tanpa snapshot/migrasi/bind.
- [ ] Panel kedua (`serve`, atau tanpa argumen tanpa TTY) saat panel lain menjawab di PORT: exit 1, `data/secret` dan
      `panel.db` tidak disentuh (test shell D2).
- [ ] `panel --version` di `~/panel` (ada `.env` lengkap) mencetak versi dan keluar < 0,5 dtk di HP, tanpa snapshot,
      migrasi, atau bind port.
- [x] `-h -v --h --v --help --version` bekerja; flag tak dikenal dan `-v --json` exit 2.
- [x] Proses anak CLI tidak menerima satu pun kunci `ENV_VARS` (test perekam unit + shell).
- [ ] `panel doctor` di HP tanpa `PANEL_CLI_FAKE` selalu mode termux (termasuk Termux tanpa `sv`); di luar Termux tanpa
      `PANEL_CLI_FAKE` exit 1 "bukan Termux".
- [ ] `panel doctor` di POCO (read-only, dijalankan koordinator setelah izin) menampilkan masalah yang sama dengan kartu
      Persiapan, `pkg_held` ok, tidak mengubah file apa pun (`find ~ $PREFIX/var/service -newer <penanda>` kosong
      selain log).
- [x] `panel doctor --json`: seluruh stdout di-parse dan cocok dengan `DoctorReport` skema 1.
- [ ] `panel env > .env.new` di HP menghasilkan file berisi tepat 4 variabel wajib bernilai kosong; stdout tanpa
      catatan; peringatan hanya di stderr; `panel env >> .env` tidak menulis apa pun; < 0,5 dtk.
- [x] `.env.example` = `panel env --full`; daftar wajib `parseEnv`, doctor `env_complete`, dan `REQUIRED_VARS`
      `install-phone.sh` semuanya sama dengan `ENV_VARS`; placeholder 0.4.0 dihitung kosong (test).
- [x] `panel docs` = 4 topik; `docs paket` memuat resep hold/upgrade aman dan PostgreSQL mayor.
- [x] `panel rollback` menukar binary dua arah tanpa celah, tidak pernah mengeksekusi `panel.prev`, menolak
      `panel.prev` non-aarch64/bionic; `--db` menyimpan `before-rollback` dulu.
- [x] `install-phone.sh` tidak menimpa `panel.prev` dengan binary yang tidak sehat.
- [ ] Rahasia tidak pernah muncul di stdout/stderr/log/argv (test env, doctor, shell).
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, semua test shell, `bun run bundle:check` lulus di macOS dan CI
      ubuntu; ukuran binary naik < 300 KB.
- [x] README, CHANGELOG `[0.5.0]` (termasuk **Changed**: `panel` di terminal kini mencetak bantuan; pakai `panel serve`),
      dan `docs/cli/*` sinkron (Rule 16).

### 11.1 Status dan penyimpangan (W3, 2026-11-27)

- `[x]` di atas = dibuktikan unit test (`tests/cli.*`, `tests/server.instance-guard.test.ts`,
  `tests/env.schema.test.ts`, `scripts/install-phone.test.sh`) dan `bun test` penuh di macOS. Yang masih `[ ]` butuh
  binary + `scripts/cli.test.sh` (W2 belum ada, begitu pula langkahnya di `ci.yml`/`release.yml`), HP nyata (waktu
  < 0,5 dtk, POCO read-only, Termux tanpa `sv`), atau CI ubuntu.
- Penjaga instance kedua sudah dibuktikan unit test; bukti test shell D2 menunggu W2.
- `doctor.checks.ts` dipecah menjadi `doctor.checks.base.ts` dan `doctor.checks.panel.ts` per area, demi batas baris
  Rule 8.
- Rotasi snapshot (`src/server/db/snapshot.ts`) tidak menghapus `panel.db.before-rollback.*` (tidak ada di §5.1);
  pemilik menghapusnya manual.
- Host fake ikut menyediakan `apps.json`; deklarasi modul `*.md` ada di `src/assets.d.ts` untuk `docs/cli/*.md`.

## 12. Risiko

| Risiko                                                                              | Mitigasi                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel kedua memigrasi `panel.db` yang sedang dipakai sebelum gagal bind (D2)        | Penjaga instance di awal `bootPanel` (§2.4) + `panel` di TTY = bantuan (K2). Race start bersamaan tetap terbuka (`ponytail:`, pidfile bila terjadi)        |
| Rahasia `.env` diwariskan ke proses anak (D3)                                       | K11b di satu tempat (`main.ts`); test perekam unit + shell; lab L7 di HP untuk runsvdir (0.5.1)                                                            |
| Doctor/init di HP baru berjalan dengan adapter fake (D1)                            | K13: deteksi dari `pkg`/`apt`/`TERMUX_VERSION`, fake hanya `PANEL_CLI_FAKE`; test skenario `nosv`                                                          |
| Token tunnel di stdout cloudflared (D4, 0.5.1)                                      | `tunnel create` tanpa `-o`; id dari `tunnel list`; token opsi A lewat fd file 600; output cloudflared tidak pernah dicetak (K10)                           |
| Upgrade paket cloudflared mematikan tunnel (juga POCO) (D5)                         | `apt-mark hold cloudflared postgresql` (POCO sudah, C15; HP baru oleh `init` 0.5.1); doctor `pkg_held` + `cloudflared_down_file` error; resep `docs paket` |
| Upgrade mayor PostgreSQL tanpa jalan `pg_upgrade` di Termux (D11)                   | Hold + doctor `postgres_major` + resep dump/restore di `docs paket`                                                                                        |
| Isolasi `import()` gagal dengan splitting build nyata (D13)                         | Lab L5 di G0; gagal → STOP dan putuskan ulang, bukan tambal                                                                                                |
| Pengguna yang biasa menjalankan `./panel` manual di terminal kaget mendapat bantuan | CHANGELOG **Changed**, bantuan menyebut `panel serve`; runit tidak terdampak                                                                               |
| Mirror Termux lambat/gagal, conffile prompt, dpkg terputus (0.5.1)                  | Flag noninteractive/confold, `dpkg --audit` di awal, SIGINT pertama diabaikan; lab L3                                                                      |
| runsvdir dari `init` mati saat sesi ditutup (0.5.1)                                 | Lab L1; fallback exit 3 "buka ulang Termux" (perilaku hari ini)                                                                                            |
| CLI dan panel menulis `config.yml` bersamaan (D10, 0.5.1)                           | CLI menyunting `config.yml` hanya bila panel tidak `run`                                                                                                   |
| `panel env > .env` menimpa `.env` yang sudah berisi rahasia                         | Tidak bisa dicegah (shell memotong dulu); peringatan stderr + saran `> .env.new`/`noclobber`; `>>` ditolak (m10)                                           |
| Doctor berbeda dengan UI                                                            | K5: fungsi + copy yang sama; test membandingkan label                                                                                                      |

## 13. Pertanyaan terbuka (dengan rekomendasi)

| #   | Pertanyaan                                                                        | Status / rekomendasi                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Lingkup 0.5.0?                                                                    | **Diputuskan (C12):** P0 saja. `init` + `install.sh` tipis → 0.5.1 (C13); `upgrade` ditunda (C14).                                                                                                       |
| Q2  | (0.5.1) Pasang PostgreSQL secara bawaan?                                          | Ya (situs dengan database fitur inti); `--skip postgres` untuk HP hemat RAM. Selalu diikuti hold.                                                                                                        |
| Q3  | (0.5.1) Buat symlink `$PREFIX/bin/panel`?                                         | Ya, hanya bila belum ada atau sudah menunjuk ke `~/panel/panel`. Aman setelah K2 (tanpa argumen di TTY = bantuan) dan penjaga instance.                                                                  |
| Q4  | (0.5.1) cloudflared: template token paket (A) atau run script sendiri (B)?        | Ditentukan hasil L2. **Keduanya** tidak tahan upgrade paket (`down` + template dipasang lagi); pencegahannya hold, pemulihannya resep `docs paket`. Opsi C (layanan milik panel di luar dpkg) = backlog. |
| Q5  | CLI boleh menerapkan fix ecosystem/run script pada file yang ada bila panel mati? | Tidak. Panel dinyalakan, lalu UI Persiapan mengerjakannya dengan lock/audit/undo.                                                                                                                        |
| Q6  | (0.5.1) `pkg upgrade` otomatis di HP baru?                                        | Ya, sebagai baris rencana yang dikonfirmasi (`--yes` = ya), dengan flag confold; tidak pernah di HP lama.                                                                                                |
| Q7  | (0.5.1) Nama tunnel bawaan?                                                       | `panel-` + domain tanpa label pertama, titik → strip (`panel.contoh.com` → `panel-contoh-com`). Bisa diganti di prompt/`--tunnel`.                                                                       |
| Q8  | Kapan `install-phone.sh` dihapus?                                                 | Rilis setelah 0.5.1, setelah `init` terbukti di HP baru dan POCO.                                                                                                                                        |
| Q9  | POCO dan hold paket?                                                              | **Selesai (C15):** `apt-mark hold cloudflared postgresql` dijalankan di POCO 2026-11-27 dengan izin pemilik. Upgrade paket itu hanya lewat resep `docs paket`.                                           |
| Q10 | Doctor exit ≠ 0 untuk peringatan (seperti `brew doctor`)?                         | Tidak; 0 bila tanpa error. Peringatan tidak boleh membuat skrip otomatis gagal.                                                                                                                          |
| Q11 | (0.5.1) Pacman Termux?                                                            | Tidak didukung: exit 3 dengan daftar paket untuk dipasang manual.                                                                                                                                        |
| Q12 | (0.5.1) `init` memasang `glibc-runner`?                                           | Tidak bawaan; doctor info "dibutuhkan hanya untuk situs binary glibc".                                                                                                                                   |
| Q13 | HP kedua (Termux F-Droid bersih) untuk lab 0.5.1?                                 | **Terbuka, menunggu pemilik.** Tanpa HP kedua, 0.5.1 tidak dirilis (C13).                                                                                                                                |

## 14. Lab

Tanpa Docker (C16). "Termux bersih" = HP atau emulator Android arm64 milik pemilik dengan Termux F-Droid yang baru
dipasang; **belum tersedia**. POCO hanya read-only, dan binary panel tidak dijalankan dengan argumen di sana sebelum
0.5.0 terpasang. Hasil ditulis ke `PLAN/debate/07-cli-lab-results.md`.

| #   | Pertanyaan                                                                                                                                                                | Di mana                                                                           | Gerbang  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| L1  | `service-daemon start` dari proses `init` (env bersih, stdio ignore): runsvdir hidup setelah sesi Termux ditutup/dibuka dan setelah layar mati 30 menit dengan wake-lock? | Termux bersih                                                                     | 0.5.1    |
| L2  | `tunnel run --token-file` (template paket) + `config.yml` lokal: ingress lokal dipakai? `apt reinstall cloudflared` → yang tersisa persis `down` + template?              | Termux bersih (tunnel uji milik pemilik)                                          | 0.5.1    |
| L3  | Termux baru: `curl`/`tar`/`sha256sum` ada? `pkg upgrade -y` + confold tanpa TTY lulus tanpa prompt? Ctrl-C di tengah → `dpkg --audit` → `--configure -a` pulih?           | Termux bersih                                                                     | 0.5.1    |
| L4  | Waktu `panel -v`/`doctor`/`env` di HP                                                                                                                                     | POCO setelah 0.5.0 terpasang (dari folder lain, dengan izin); Termux bersih nanti | 0.5.0 QA |
| L5  | Build nyata (`scripts/build.ts`, splitting + tailwind) dengan `main.ts`: modul penanda di `boot.ts` tidak dievaluasi untuk `-v`/`--help`/`env`/`docs` (D13)               | Mac lokal (salinan working tree)                                                  | 0.5.0 G0 |
| L6  | `new Database(f, { readonly: true })` pada `panel.db` WAL: (a) panel hidup, (b) panel mati tanpa `-shm`. Tidak ada file baru yang dibuat? (m14)                           | Mac lokal                                                                         | 0.5.0 G0 |
| L7  | `/proc/<pid>/environ` runsvdir dan pm2-runtime setelah `init` dari `~/panel` tidak memuat kunci `ENV_VARS` (D3)                                                           | Termux bersih                                                                     | 0.5.1    |
| L8  | `apt-mark hold cloudflared postgresql`: `pkg upgrade` mempertahankan keduanya; `apt-get -s install termux-api` mencetak daftar upgrade yang bisa di-parse (D5, D9)        | Termux bersih (simulasi `-s` boleh di POCO, read-only)                            | 0.5.1    |

## 15. Backlog

| Item                                      | Syarat / alasan                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel upgrade`                           | C14: Ed25519 atas `SHA256SUMS` dengan kunci publik ter-embed (`node:crypto` `verify`), `detectRuntime` sebelum eksekusi, aturan `panel.prev` D12, rumus ruang              |
| Opsi C: layanan tunnel milik panel        | Ganti nama `"cloudflared"` di `site.steps.ts`, `monitor.service.ts`, `panel.service.ts`, `job.runner.ts`, `overview.problems.ts` + migrasi POCO; hold cukup untuk sekarang |
| `init.json`, `-v --json`, topik docs lain | Tidak ada konsumen (m6, m16)                                                                                                                                               |
| Access lewat API, watchdog, UI "Perbarui" | Sama dengan Q1 lama; butuh PLAN sendiri                                                                                                                                    |
| Pidfile penjaga instance                  | Bila race dua start bersamaan pernah terjadi (§2.4)                                                                                                                        |
