# PLAN 07 — CLI di binary: `-h`, `-v`, `doctor`, `docs`, `env`, `rollback` (0.5.0) dan `init` (0.5.1)

Ditulis `wkr-cli-plan-01`, 2026-11-27. Dasar riset: `R&D/08-cli-bootstrap.md` (inventaris 27 langkah, verifikasi Bun /
Termux / cloudflared, pembanding industri). Mengikuti `PLAN/DECISIONS.md` (terutama B14, B18, B23, C1, C3, C5, C6,
C12–C16) dan aturan global (`~/.claude/CLAUDE.md`). Ditambah `wkr-cli-plan-02`, 2026-11-27: perintah `panel env` /
`--env` (K17–K18, §6.2) atas permintaan pemilik.

**Revisi 3** (`wkr-cli-plan-03`, 2026-11-27): menerapkan debat `PLAN/debate/07-cli-bootstrap-debate.md` (5 BLOCKER, 10
MAJOR, 18 MINOR; rujukan "D1…D15" dan "m1…m18" di dokumen ini menunjuk temuan debat itu) dan keputusan pemilik
DECISIONS C12–C16. Status: **P0 (0.5.0) dibangun di `feature/cli-p0`** (2026-11-27, W0–W1 + G1a + W3; W2 belum), lihat
§11 dan §11.1. P1 (0.5.1) belum dibangun.

**Revisi 4** (`wkr-cli-plan-04`, 2026-11-27, branch `feature/cli-init`): arahan pemilik DECISIONS **C18**. `install.sh`
keluar dari jalur pasang: rilis memuat binary mentah `panel`, satu baris `curl` mengunduhnya lalu `panel init`
mengerjakan semua yang dulu dikerjakan `install.sh` + `install-phone.sh` (cek diri, pasang diri, upgrade). POCO = HP
eksperimen, jadi lab L1–L8 dan uji Termux bersih final dijalankan di POCO (§14). Yang berubah: §0, K14, K15, K19–K25
(§1), §2.1, §4 (alur ditulis ulang), §5.2, §8.2, §13, §14, §15, serta rencana kerja dan kriteria 0.5.1 baru (§16, §17).

**Revisi 5** (`wkr-cli-plan-05`, 2026-11-27, branch `feature/cli-init`): menerapkan debat
`PLAN/debate/07b-cli-init-debate.md` (2 BLOCKER, 6 MAJOR, 10 MINOR; rujukan "E1…E18" menunjuk temuan debat itu), hasil
lab fase A di POCO (`PLAN/debate/07-cli-lab-results.md`: L2, L4, L8) dan keputusan koordinator DECISIONS **C19–C28**.
Inti: tunnel = run script kita + hold (L2); hostname yang sudah milik tunnel lain dipindah hanya setelah ditanya di TTY
(E1/C19); "HP baru" dibaca dari data pengguna, bukan dari `~/panel` (E2/C20); `panel.prev` hanya dari binary yang
terbukti melayani (E3/C21); satu aturan restart (E4/C22); mode upgrade hanya menyentuh binary, run script panel usang,
dan symlink (E5/C23); cek diri atas salinan yang dipasang, tanpa `gh` (E6/C24); SSH diproses tepat setelah runit
(E8/C26); `--downgrade`, `--port`, `--tunnel` dihapus (E9/C27).

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

**0.5.1 = P1 (C13, C18):** `panel init` = satu-satunya jalur pasang, upgrade, dan perbaikan. Rilis memuat aset binary
mentah `panel` (android-arm64) di samping `SHA256SUMS`. Landing dan README hanya menampilkan **satu baris** (§8.2, nama
file lokal dibahas di Q14):

```text
cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init
```

`init` memeriksa salinan yang akan dipasang terhadap `SHA256SUMS` rilisnya, memasang diri ke `~/panel/panel`, lalu
membangun ekosistem dari Termux kosong (paket, runit, SSH bila diminta, PostgreSQL, `.env`, pm2, tunnel, Termux:Boot,
start + cek), aman di HP yang sudah jalan (§4). Binary yang lebih baru di instalasi yang ada = upgrade (hanya binary,
run script panel usang, symlink, restart panel); versi sama = cek dan perbaiki; versi lebih lama ditolak dengan saran
`panel rollback [--db]` (C27). `install.sh` hilang dari docs/landing; asetnya tinggal satu rilis sebagai shim yang
mengunduh binary lalu `exec init`, dan dihapus di 0.6.0 bersama tarball. `scripts/install-phone.sh` dihapus (K23).

**`panel upgrade` tetap ditunda (C14)** sampai rilis ditandatangani Ed25519. Upgrade = jalankan lagi baris satu
perintah (binary terbaru) atau `./panel-termux init` dengan binary versi tertentu dari
`releases/download/vX/panel`. Tidak ada Docker di strategi test mana pun, termasuk CI (C16); Termux nyata hanya di POCO.

## 1. Keputusan PLAN

| #    | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Alasan / bukti                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1   | Entry build baru `src/server/main.ts` (tipis, §7.1): rute serve → `(await import("./boot")).start()`; rute CLI → hapus kunci `ENV_VARS` (K11b) lalu `(await import("../cli/cli.main")).runCli(argv)`. Satu-satunya impor statis `main.ts` adalah `src/shared/env.schema.ts` (murni). `src/server/index.ts` tetap (dev + test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | R&D/08 temuan 4. Isolasi dengan konfigurasi build nyata (splitting, plugin tailwind, minify) wajib dibuktikan lab L5 sebelum P0 dibekukan (D13).                                                                                               |
| K2   | Serve **hanya** bila (argv kosong **dan** stdin bukan TTY) atau argv persis `["serve"]`. Argv kosong + TTY → bantuan singkat + `→ untuk menjalankan server: panel serve`, exit 2. Argumen tak dikenal → exit 2, **tidak pernah** serve. Plus **penjaga instance** di awal `bootPanel` (§2.4): panel yang sudah menjawab di PORT → exit 1 sebelum secret/DB disentuh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | D2: runit tidak punya TTY (`run` = `exec ./panel`), jadi produksi tidak berubah; `bun --hot src/server/index.ts` tidak tersentuh. Penjaga juga melindungi dari binary < 0.5.0 selama binary baru yang start kedua.                             |
| K3   | Parser: `node:util` `parseArgs` (`strict: true`, `allowPositionals: true`). `--v`/`--h`/`--env` dinormalisasi ke `--version`/`--help`/`env` sebelum parse. Tanpa dependency baru.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Terverifikasi di binary (R&D/08 §3.4); Bun tidak menelan flag (debat §1). Rule 10.                                                                                                                                                             |
| K4   | Nama perintah dan flag **Inggris** (konvensi CLI), semua output **Indonesia** polos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sama dengan `sv`, `pkg`, `cloudflared`; copy produk tetap Indonesia.                                                                                                                                                                           |
| K5   | Pemeriksaan integrasi (`sites_dir` … `cloudflare_token`) **dipanggil**, bukan disalin: `createIntegration(ctx).get()` + copy `idSiteSetup.checks` dari `src/web/i18n/id.site.setup.ts`. Pemeriksaan baru khusus bootstrap ada di `src/cli/doctor.checks.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Satu sumber kebenaran (permintaan pemilik).                                                                                                                                                                                                    |
| K6   | CLI **tidak menerapkan fix integrasi** (ecosystem, run script pm2, apps.json) pada file yang sudah ada. `init` (0.5.1) hanya membuat yang **belum ada**. File yang ada → rujuk ke **Situs → Persiapan** (lock, audit, backup, undo). `config.yml` hanya disunting CLI bila layanan `panel` **tidak** `run` (D10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | CLI tidak bisa ikut lock job panel (R&D/08 §5.2); C1/C3/C5/C6 sudah dijamin di UI.                                                                                                                                                             |
| K7   | (0.5.1) Paket: pasang **hanya yang belum ada**. Langkah paket diawali `dpkg --audit`. **HP baru** (C20) = tidak ada data pengguna: tidak ada `$PREFIX/var/lib/postgresql/PG_VERSION`, `~/.cloudflared`, `~/.pm2`, `~/sites`, dan `~/panel/data/panel.db`; `~/panel/panel`, layanan `panel`, dan lock **tidak** dihitung, jadi resume instalasi baru yang terputus tetap HP baru. HP baru: `pkg upgrade` dengan flag noninteractive/confold yang sama dengan install, lalu `apt-mark hold cloudflared postgresql` + satu baris alasan. `pkg upgrade` **tidak pernah** dijalankan bila `PG_VERSION` ada atau `postgresql` sudah terpasang, dicek ulang saat langkah 2 dimulai. Selain HP baru: `LC_ALL=C apt-get -s install <hilang>` dulu; bila ada paket **terpasang** yang akan diganti (baris `Inst` dengan `[...]`, L8) → daftar + konfirmasi TTY, dan **tolak** (exit 3 + perintah manual) bila daftar memuat `cloudflared`, `postgresql`, `nodejs*`. SIGINT pertama diabaikan selama pkg/npm jalan. Hold hanya menahan upgrade, **bukan** `--reinstall` (L8), jadi `init` tidak pernah memanggil `--reinstall`.                                                                                                                                                                                                                                                                                                                                                          | D5, D9, D11, E2; `pkg upgrade` = `apt full-upgrade` yang menghormati hold (POCO `$PREFIX/bin/pkg:423`); format `Inst` L8.                                                                                                                      |
| K8   | (0.5.1) Node: node apa pun yang sudah ada diterima; bila tidak ada → `nodejs-lts`. pm2 dipasang `npm install -g pm2@7.1.2` bila `$PREFIX/lib/node_modules/pm2/bin/pm2-runtime` tidak ada. CLI tidak memanggil CLI `pm2` (B14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Konflik `nodejs`/`nodejs-lts`; versi lab E1–E11.                                                                                                                                                                                               |
| K9   | **Satu aturan restart** (C22, dirujuk dari semua bagian lain). `rollback` (0.5.0): restart panel setelah konfirmasi TTY atau `--yes`. `init` (0.5.1): **panel** di-restart hanya di mode upgrade (binary berubah, atau inode proses runit ≠ inode `~/panel/panel`, K21), dengan konfirmasi TTY atau `--yes` (juga tanpa TTY). Mode cek/perbaiki tidak pernah me-restart panel yang `run` (`sv up` untuk panel yang mati bukan restart). **pm2 tidak pernah di-restart** oleh CLI (C3). **cloudflared** di-restart hanya dengan konfirmasi TTY yang menyebut "semua situs putus beberapa detik" (cloudflared yang belum `run` cukup `sv up`, bukan restart); `--yes` tanpa TTY → restart dilewati, exit 3 + perintahnya.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | C3, E4; makuro-solusi tidak boleh putus tanpa izin.                                                                                                                                                                                            |
| K10  | Rahasia: dibaca lewat prompt tanpa echo, langsung ditulis ke `~/panel/.env` (600) dengan `encodeEnvLine` (B23). Tidak lewat argv, tidak di file state, tidak di log, tidak dicetak ulang. stdout/stderr `cloudflared` tidak pernah dicetak atau dimasukkan ke pesan error; hanya kode keluar + baris yang lolos `redactLines` (D4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Rule 7, 12.                                                                                                                                                                                                                                    |
| K11a | CLI membaca `~/panel/.env` secara eksplisit (`src/cli/env.file.ts`: `findEnvLine` + `decodeEnvValue` per kunci `ENV_VARS`) dan tidak memakai `process.env` untuk variabel panel. Bun juga memuat `.env.local`, `.env.development`, `.env.production` dari cwd, dan ini tidak bisa dimatikan lewat build → doctor `env_extra_files` (D8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | R&D/08 temuan 3; debat D8 (eksperimen binary).                                                                                                                                                                                                 |
| K11b | Cabang CLI di `main.ts`, sebelum `import()` apa pun: `for (const v of ENV_VARS) delete process.env[v.name]`. Bukan allowlist: `am` (termux-open-url, termux-wake-lock) butuh `BOOTCLASSPATH`/`ANDROID_*`, termux-exec butuh `LD_PRELOAD`. Semua adapter (`runTermux` memakai `opts.env ?? process.env`) ikut aman dari satu tempat ini.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | D3: tanpa ini `GOOGLE_CLIENT_SECRET` dari `.env` cwd diwariskan ke `sv`, `npm` lifecycle script, dan (0.5.1) runsvdir → semua layanan → semua app pm2.                                                                                         |
| K12  | Doctor **read-only**: tidak membuat `panel.db`, tidak membaca `data/secret`, tidak memanggil `ensureAppsJson`/`verify`, tidak menulis file apa pun. `panel.db` dibuka `new Database(f, { readonly: true })`; bila gagal (mis. WAL tanpa `-shm` saat panel mati, lab L6) → DB `:memory:` termigrasi, tanpa membuat file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `openDb` membuat file; `verify()` membuat `apps.json`; m14.                                                                                                                                                                                    |
| K13  | Mode CLI ditentukan CLI sendiri, **bukan** `selectSystem`: `PANEL_CLI_FAKE=fresh\|ready\|poco\|nosv` → fake (host fake + `createFakeSystem`); selain itu termux bila `$PREFIX/bin/pkg` atau `$PREFIX/bin/apt` ada atau `TERMUX_VERSION` diset → `createTermuxSystem()` langsung; selain itu → `❌ Ini bukan Termux` + `→ untuk mencoba: PANEL_CLI_FAKE=ready panel doctor`, exit 1. Adapter dibuat ulang setelah langkah paket `init` (0.5.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | D1: `selectSystem` memilih fake bila `sv` tidak ada, padahal di Termux kosong `sv` memang belum ada. D15: `selectSystem` menulis `log.info` ke stdout dan merusak `--json`.                                                                    |
| K14  | (0.5.1, **diganti C18**) `install.sh` bukan lagi jalur pasang. Satu rilis (0.5.1) asetnya tetap ada sebagai shim kompatibel: unduh `panel` + `SHA256SUMS` rilis yang sama, `sha256sum -c`, lalu `exec` binary `init` dengan snippet `/dev/tty` D6 (§8.2). Dihapus di 0.6.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Arahan pemilik C18: lapisan shell kedua menambah kompleksitas dan rawan lalai; D6 tetap berlaku untuk shim.                                                                                                                                    |
| K15  | Tarball rilis tidak berubah di 0.5.0. Di 0.5.1 tarball hanya untuk kompatibilitas `install.sh` lama yang mem-pin versi (`PANEL_VERSION=v0.5.1`): isinya binary + `scripts/install-phone.sh` **hasil generate** `package-release.sh` (beberapa baris: `exec "$1" init` + snippet D6, karena `install.sh` lama memanggilnya dengan path binary). Tarball dan `install.sh` dihapus di 0.6.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pengguna yang mem-pin versi lama tidak rusak; satu langkah per rilis.                                                                                                                                                                          |
| K16  | Versi: **0.5.0** = P0 (C12). **0.5.1** = P1 (`init` = jalur pasang/upgrade tunggal, C18), digerbang lab L1–L8 di POCO (C13, C18). `upgrade` ditunda sampai rilis bertanda tangan Ed25519 (C14). Access lewat API, watchdog, UI "Perbarui" = backlog (§15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Debat §3: lingkup terlalu lebar untuk satu rilis.                                                                                                                                                                                              |
| K17  | Satu skema env: `src/shared/env.schema.ts` mengekspor `ENV_VARS` (urutan tetap; per variabel `name`, `required`, `default?`, `example?`, `placeholders?`, `description` Indonesia satu baris, `secret`) + `renderEnvTemplate({ full })`. `placeholders` = nilai contoh lama (`https://panel.example.com`, `you@example.com` dari `.env.example` ≤ 0.4.0) yang dihitung **kosong** oleh doctor `env_complete`, prompt `init`, dan `install-phone.sh`. Dipakai: `parseEnv`, doctor, `init`, `panel env`, `.env.example`. Modul murni.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Permintaan pemilik; D7 (HP yang berhenti di exit 3 punya `.env` berisi placeholder yang lolos sebagai "terisi").                                                                                                                               |
| K18  | `panel env` (alias `panel --env`, **tanpa** short flag `-e`): stdout = template saja, catatan ke stderr. Tidak pernah membaca isi `.env` maupun `process.env` (hanya `stat`/`fstat`). Nilai **dikosongkan**; contoh nilai di komentar. stdout yang ternyata `.env` berisi data (mode append) → tidak menulis apa pun, exit 1 (m10). Tidak memuat bundle server (K1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Nilai kosong → panel menolak start dan doctor menyebut namanya. `-e` tidak dipakai agar tidak mengunci huruf itu. m10: kunci kosong yang di-append menang atas nilai lama.                                                                     |
| K19  | (0.5.1) **Cek diri** (C24): binary rilis membawa tag rilisnya sebagai identifier build `__PANEL_RELEASE_TAG__` (`scripts/build.ts` `define` dari env `PANEL_RELEASE_TAG` **saat build**, + `declare const`; kode tidak pernah membaca `process.env.*` untuk tag, jadi `.env` cwd tidak bisa mengubahnya; build lokal dan jalan dev = kosong). Cek hanya dijalankan bila binary ini **akan dipasang** (SHA `~/panel/panel` ≠ diri); run perbaikan dari `~/panel/panel` tidak mengecek dan tidak butuh internet. Urutan: salin diri ke `~/panel/panel.new` → `fsync` → hash **`panel.new`** → unduh `releases/download/<tag>/SHA256SUMS` lewat HTTPS (`fetch`, timeout 30 dtk) → cocokkan baris `panel` → `rename`. Tidak cocok / baris tidak ada / 404 → hapus `panel.new`, exit 1. Gagal jaringan, timeout, 5xx → hapus `panel.new`, exit 1 "cek diri butuh internet; atau jalankan di terminal dengan `--skip-verify`". `--skip-verify` hanya berlaku di TTY (tanpa TTY → exit 2): peringatan keras `⚠️ CEK DIRI DILEWATI: binary ini tidak dicocokkan dengan rilis apa pun` + konfirmasi `[y/N]` (bawaan tidak; `--yes` tidak menjawabnya). Pesan sukses menyebut batasnya: "cocok dengan SHA256SUMS rilis <tag> (membuktikan unduhan utuh, bukan asal rilis); untuk membuktikan asal: `gh attestation verify panel --repo makurosolusi/panel-termux` di komputer". `init` tidak memanggil `gh`. Build lokal → `ℹ️ build lokal: tidak dicek terhadap rilis`, tanpa `fetch`. | Pemilik C18; D12 (integritas ≠ asal); E6: hash atas byte yang dipasang (tanpa TOCTOU), perbaikan offline tetap bisa, `gh` tidak ada di POCO dan butuh `gh auth`.                                                                               |
| K20  | (0.5.1) **Versi terpasang** dibaca tanpa mengeksekusi binary lama: `/api/health` (panel `run`) → `app_meta.panel_version` di `panel.db` read-only (K12) → tidak diketahui. Lebih baru → **upgrade**; sama + SHA sama → **cek/perbaiki**; sama + SHA beda (build dev) → ganti binary; lebih lama → exit 3 "versi lebih lama dari yang terpasang; untuk kembali ke versi sebelumnya: `panel rollback [--db]`" (tanpa `--downgrade`, C27); tidak diketahui → diperlakukan sebagai upgrade dengan baris rencana "versi terpasang tidak diketahui". Mode (HP baru / upgrade / cek) dipisah dari keputusan paket: HP baru = definisi data pengguna K7 (C20).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Binary < 0.5.0 mengabaikan argumen dan menyalakan panel kedua; `panel.prev` tidak pernah dieksekusi (§5.1). E9: downgrade di atas DB yang sudah dimigrasi maju tidak punya cerita DB; `rollback` sudah menutupnya.                             |
| K21  | (0.5.1) **Upgrade lewat `init`** (C23) hanya menyentuh: `~/panel/panel`, `~/panel/panel.prev`, `$SVDIR/panel/run` **bila** isinya sama dengan template versi lama yang dikenal (daftar hash ter-embed; lama disimpan `run.bak-<versi>`; run script kustom → peringatan saja, E18), symlink `$PREFIX/bin/panel` (dibuat bila belum ada), file unduhan (dihapus, K24), `~/panel-src/v[0-9]*` (dipangkas, E11), lalu `sv -w 130 restart panel` (K9). **Tidak** ada paket, PostgreSQL, skrip boot, `termux-wake-lock` (dialog baterai), tunnel, atau SSH di mode upgrade: yang kurang hanya dilaporkan sebagai baris doctor + "jalankan lagi `panel init` di terminal" (run kedua = mode cek, §4). Snapshot DB dibuat panel saat boot (B10). `panel.prev` ← `panel` lama hanya bila `panel.prev` belum ada, **atau** `/api/health` ok **dan** `stat(/proc/<$SVDIR/panel/supervise/pid>/exe)` (dev+ino) = `stat(~/panel/panel)` (C21), lewat `link(panel, panel.prev.new)` → `rename(panel.prev.new, panel.prev)` (atomik, tanpa salinan 118 MB). pm2 dan app-nya tidak pernah disentuh (C3); cloudflared tidak di-restart. `--yes` **boleh** me-restart panel tanpa TTY (C22, mengubah m9 untuk panel saja).                                                                                                                                                                                                                                                                      | C18, E3, E5, E16, E18; deploy dev lewat `ssh poco` tanpa TTY harus bisa upgrade; health hanya membuktikan proses yang jalan, inode membuktikan file itulah yang melayani (POCO: `/proc/<pid>/exe` = `~/panel/panel` dengan termux-exec 2.5.0). |
| K22  | (0.5.1) **SSH opsional** `--ssh-key <https-url\|file\|->` (tidak pernah bawaan, C26). `-` = baca **satu** baris kunci dari stdin (di TTY dengan prompt `Tempel satu baris kunci publik:`). Diproses **tepat setelah langkah 3 (runit)**, `openssh` ikut dipasang di langkah 2, supaya akses kembali sebelum langkah berisiko. Kunci divalidasi (`ssh-ed25519`/`ssh-rsa`/`ecdsa-sha2-*`/`sk-*` di awal baris; baris berawalan opsi seperti `command=` ditolak). Sidik jari setiap kunci dicetak; di TTY `Tambahkan N kunci ini? [Y/n]`. Ditambah ke `~/.ssh/authorized_keys` tanpa duplikat (700/600) lewat tmp + `rename`, baris lama dipertahankan, newline ditambahkan bila file tidak diakhiri `\n`. Drop-in `$PREFIX/etc/ssh/sshd_config.d/10-key-only.conf` (`PasswordAuthentication no`) hanya bila belum ada **dan** L3 membuktikan `sshd_config` Termux bersih memuat `Include …sshd_config.d`; bila tidak → fitur drop-in dihapus (E12), `sshd_config` tidak disunting. Hapus `$SVDIR/sshd/down`, `sv up sshd`. Yang dicetak: sidik jari kunci yang ditambah, sidik jari host (`ssh-keygen -lf $PREFIX/etc/ssh/ssh_host_ed25519_key.pub`), port 8022, `whoami`, dan "IP HP: lihat Tailscale/Wi-Fi" (IP tidak ditebak; `ip` tidak ada di POCO) — bukan isi kunci. URL `http://` ditolak. Asal kunci Mac (URL GitHub, file, atau tempel) menunggu pemilik (Q16).                                                                                                       | Alur nyata pemilik (POCO, uji wipe §14); opt-in karena membuka pintu masuk baru; E8, E12.                                                                                                                                                      |
| K23  | (0.5.1) `scripts/install-phone.sh` + `install-phone.test.sh` **dihapus**; isinya pindah ke `init`. Deploy dev (C28): `bun run build && rsync --partial dist/panel-android-arm64 poco: && ssh poco ./panel-android-arm64 init --yes` (build lokal, tanpa cek diri; `rsync --partial` bisa dilanjutkan bila VPN putus dan menulis ke file sementara lalu `rename`, jadi tidak `Text file busy` pada binary yang masih dieksekusi run sebelumnya, E17). `REQUIRED_VARS` di shell tidak ada lagi; `tests/env.schema.test.ts` berhenti membacanya.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Q8; satu jalur pasang, tidak ada dua salinan logika `.env`/runit.                                                                                                                                                                              |
| K24  | (0.5.1) Satu baris pasang = `cd && curl -fL --retry 3 -o panel-termux <releases/latest/download/panel> && chmod +x panel-termux && ./panel-termux init`. `cd` dulu karena `~/storage/shared` (FUSE, noexec) membuat `./panel-termux` → `Permission denied` sebelum `init` bisa menjelaskan apa pun (E13). Nama lokal **bukan** `panel` karena `~/panel` adalah folder instalasi (Q14); folder `~/panel-termux` hasil `git clone` repo ini membuat `curl -o` gagal "Is a directory" (dicatat di README). `init` menghapus file unduhan setelah berhasil memasang diri **hanya bila** `process.execPath` berada di luar `~/panel/` (E10; `panel.prev`/`panel.new` tidak pernah terhapus). Unduhan putus → ulangi **seluruh** baris, bukan hanya `./panel-termux init` (file terpotong; README).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | R&D/08 §8: `curl -o panel` di HOME gagal di HP terpasang dan menduduki path folder di HP baru; E10, E13.                                                                                                                                       |
| K25  | (0.5.1) Rilis prarilis `v0.5.1-rc.N` (GitHub prerelease, tidak dipilih `releases/latest`) untuk uji final Termux bersih sebelum tag `v0.5.1`. `release.yml` (C28): version gate menerima `v$VERSION` **atau** `v$VERSION-rc.[0-9]+`; tag rc → `gh release create … --prerelease`; langkah `bun run build` mendapat `env: PANEL_RELEASE_TAG: ${{ env.TAG }}` sehingga tag tertanam saat build (K19). Binary `workflow_dispatch` dry run menanam `v0.0.0-dryrun` dan **tidak boleh** dipakai untuk lab (cek dirinya pasti 404).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Uji final harus memakai binary + `SHA256SUMS` rilis sungguhan, bukan build dev; E15.                                                                                                                                                           |

## 2. Perintah, flag, exit code

### 2.1 Daftar

| Perintah                       | Flag                                                                                                                                                                                               | Mengubah HP?                                   | Rilis           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------- |
| `panel`                        | –                                                                                                                                                                                                  | tanpa TTY: serve; di TTY: bantuan, exit 2 (K2) | 0.5.0 (berubah) |
| `panel serve`                  | –                                                                                                                                                                                                  | serve                                          | 0.5.0           |
| `panel -h`, `--help`, `--h`    | juga `panel <perintah> --help`                                                                                                                                                                     | tidak                                          | 0.5.0           |
| `panel -v`, `--version`, `--v` | –                                                                                                                                                                                                  | tidak                                          | 0.5.0           |
| `panel doctor`                 | `--json`                                                                                                                                                                                           | tidak                                          | 0.5.0           |
| `panel docs [topik]`           | tanpa topik = daftar topik                                                                                                                                                                         | tidak                                          | 0.5.0           |
| `panel env`, `--env`           | `--full` (tambah variabel opsional, dikomentari dengan nilai bawaan)                                                                                                                               | tidak                                          | 0.5.0           |
| `panel rollback`               | `--db`, `-y/--yes`                                                                                                                                                                                 | ya                                             | 0.5.0           |
| `panel init`                   | `-y/--yes`, `--dry-run`, `--hostname <fqdn>`, `--admin-email <email>` (berulang), `--skip <postgres\|tunnel\|boot>` (berulang), `--ssh-key <https-url\|file\|->`, `--skip-verify` (hanya TTY, K19) | ya (`--dry-run`: tidak)                        | 0.5.1           |
| `panel upgrade`                | –                                                                                                                                                                                                  | –                                              | ditunda (C14)   |

`-v` mencetak satu baris `panel-termux 0.5.0 (android-arm64, bun 1.4.2)`: versi dari `package.json`, platform/arch
dari `process.platform`/`process.arch`, Bun dari `Bun.version`. `--json` untuk `-v` **tidak ada** (m16); `-v --json` →
exit 2.

`--env` dinormalisasi ke perintah `env` sebelum parse (K3), jadi `panel --env --full` = `panel env --full`. Short flag
yang dipakai hanya `-h`, `-v`, `-y`.

Di 0.5.0, `init` dan `upgrade` tidak ada di dispatcher. Pesan "perintah tidak dikenal" untuk kedua nama itu menambah
satu baris `→ untuk memasang atau memperbarui: jalankan lagi perintah install.sh (README)`, exit 2. Di 0.5.1 `init`
masuk dispatcher; `upgrade` tetap "tidak dikenal" dengan baris `→ untuk memperbarui: jalankan lagi baris pasang
(README), atau <binary baru> init`. Semua saran "jalankan lagi perintah install.sh" di CLI (`REINSTALL`,
`INSTALL_HINT`, `rollback`) berganti ke saran yang sama.

### 2.2 Exit code (sama untuk semua perintah)

| Kode | Arti                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Berhasil; `doctor`: tidak ada `error` (peringatan boleh)                                                                                                                                                                                                                                                                                                                                                                                       |
| 1    | Gagal (pesan menyebut operasi + penyebab); `doctor`: ≥ 1 `error`; serve: panel lain sudah menjawab di PORT (§2.4)                                                                                                                                                                                                                                                                                                                              |
| 2    | Salah pakai: perintah/flag tak dikenal, nilai flag tidak valid, `panel` tanpa argumen di terminal                                                                                                                                                                                                                                                                                                                                              |
| 3    | Butuh tindakan pengguna lalu jalankan lagi: `rollback` tanpa TTY dan tanpa `--yes`; (0.5.1) rahasia belum ada tanpa TTY, login Cloudflare belum selesai, pacman, paket penting akan ter-upgrade, Termux perlu dibuka ulang. (0.5.1) juga: binary lebih lama dari yang terpasang, hostname panel sudah diarahkan ke tunnel lain tanpa TTY (§4.4), restart cloudflared tanpa TTY (K9). Kompatibel dengan `install-phone.sh`/`install.sh` ≤ 0.5.0 |
| 4    | Dibatalkan pengguna (menjawab tidak pada konfirmasi)                                                                                                                                                                                                                                                                                                                                                                                           |
| 130  | Ctrl-C. File yang ditulis CLI selalu `tmp` + `rename`, jadi tidak pernah setengah jadi. Ini **tidak** berlaku untuk pkg/dpkg (0.5.1): CLI mengabaikan SIGINT pertama selama pkg/npm jalan, dan run berikutnya memulai dengan `dpkg --audit` (K7)                                                                                                                                                                                               |

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
  < 5 dtk; probe yang independen dijalankan paralel. L4 (POCO, 0.5.0): median 1,3–1,4 dtk (maks 2,0 dtk), start binary
  ±50 ms; dari `~` dan `$PREFIX/tmp` sama.
- Sesi `ssh poco '…'` non-login tidak punya `SVDIR`/`LOGDIR` (lab fase A; diset `$PREFIX/etc/profile.d/start-services.sh`).
  `CliHost.paths` sudah jatuh ke `$PREFIX/var/service` dan `$PREFIX/var/log` (`cli.host.ts`); setiap proses anak yang
  butuh keduanya (`sv`, `service-daemon`, `apt`/`dpkg` yang menjalankan `prerm` berisi `sv-disable`) menerima
  `SVDIR` + `LOGDIR` eksplisit dari `paths`, tidak pernah dari env pemanggil.
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

## 4. `init` (0.5.1)

`init` menggantikan `install.sh` + `install-phone.sh` sepenuhnya (C18). Spesifikasi di bawah memuat perbaikan debat dan
menjadi dasar worker 0.5.1 (§16). Opsi layanan cloudflared sudah diputuskan L2: **run script kita + hold** (§4.4 langkah
5, Q4); tidak ada konstanta A/B.

Tiga mode, dipilih dari keadaan HP (K7, K20), bukan dari flag:

| Mode         | Kapan                                                                                                                                                                          | Langkah yang boleh mengubah HP                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HP baru      | tidak ada data pengguna (K7, C20): `PG_VERSION`, `~/.cloudflared`, `~/.pm2`, `~/sites`, `~/panel/data/panel.db` semuanya tidak ada; binary/layanan `panel`/lock tidak dihitung | semua (0–11)                                                                                                                                                                                             |
| Upgrade      | ada data pengguna, `~/panel/panel` ada, dan binary ini lebih baru (atau build beda), atau inode proses panel ≠ `~/panel/panel` (upgrade terputus)                              | **hanya** K21: binary, `panel.prev`, run script panel usang, symlink, file unduhan, `~/panel-src/v*`, restart panel. Yang kurang dilaporkan saja                                                         |
| Cek/perbaiki | ada data pengguna, dan binary sama **atau** `~/panel/panel` belum ada (Termux berisi PostgreSQL/pm2/tunnel tanpa panel)                                                        | mengisi yang belum ada (termasuk binary). Langkah 2 (paket), 4 (PostgreSQL), 9 (boot, dialog baterai) hanya dengan konfirmasi **TTY**; tanpa TTY (juga `--yes`) dilaporkan saja. Tidak ada restart panel |

Binary lebih lama dari yang terpasang → exit 3 sebelum langkah 1 (K20). `--ssh-key` di mode upgrade → dilewati dengan baris
`⚠️ jalankan lagi panel init --ssh-key … setelah upgrade` (run kedua = mode cek).

### 4.1 Alur

`init` = **deteksi → rencana → konfirmasi → jalankan langkah → verifikasi → ringkasan**. Setiap langkah menghitung
ulang keadaannya dari sistem, jadi rerun melanjutkan dari mana pun, tanpa file state.

| #   | Langkah        | Deteksi (lewat)                                                              | Aksi bila kurang                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Di HP yang sudah jalan                                                                                                                                                                                                                                                                                                                  |
| --- | -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Prasyarat      | arch, prefix, ruang, lock, TTY, mode (K7, K20)                               | Gagal → exit 1. Lock `$PREFIX/tmp/panel-init.lock` (`O_EXCL`, berisi pid; di luar `$HOME`, C20); basi bila pid mati **atau** `/proc/<pid>/cmdline` tidak memuat `init` (m7). Tidak ada file di `$HOME` yang ditulis sebelum langkah 1 lolos cek diri                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | sama                                                                                                                                                                                                                                                                                                                                    |
| 1   | Binary         | versi terpasang (K20), SHA `~/panel/panel` vs diri, inode proses runit (K21) | SHA sama → tidak ada penulisan, tanpa cek diri. Selain itu: `detectRuntime(process.execPath)` (aarch64/bionic); ruang = 2 × `panel.db` + 256 MB + ukuran binary sekali (benar karena `panel.prev` lewat `link`, E16); salin diri ke `panel.new` (755) → `fsync` → cek diri atas `panel.new` (K19; gagal → hapus `panel.new`, exit 1) → `panel.prev` menurut K21 (`link` + `rename`) → `rename(panel.new, panel)`. `~/panel/data` 700. Symlink `$PREFIX/bin/panel` → `~/panel/panel` bila belum ada atau sudah milik kita. Hapus file unduhan hanya bila `process.execPath` di luar `~/panel/` (K24, E10). Pangkas hanya folder `~/panel-src/v[0-9]*` selain versi sekarang + sebelumnya (m12, E11); folder lain (POCO: `deploy dist scripts` dari deploy dev lama) hanya disebut di ringkasan ("tidak dipakai lagi; hapus bila tidak perlu") | Upgrade: sama, lalu langkah 10 me-restart panel (K9, K21). Versi lebih lama → exit 3 (K20)                                                                                                                                                                                                                                              |
| 2   | Paket          | `dpkg --audit`, `dpkg -s`, node, `pm2-runtime`, mode paket (K7)              | `dpkg --audit` tidak kosong (bersih = stdout kosong, rc 0; L8): HP baru → `dpkg --configure -a --force-confdef --force-confold`; selain HP baru → exit 3 + perintahnya. HP baru dan `postgresql`/`PG_VERSION` belum ada (dicek ulang di sini, K7): `DEBIAN_FRONTEND=noninteractive pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold` (dikonfirmasi), lalu `pkg install` dengan flag yang sama untuk yang hilang (+ `openssh` bila `--ssh-key`), `npm install -g pm2@7.1.2`, `apt-mark hold cloudflared postgresql`. Verifikasi ulang dengan `dpkg -s`. Semua `apt`/`dpkg`/`pkg` dengan `LC_ALL=C` + `SVDIR`/`LOGDIR` eksplisit (§3.1). Adapter dibuat ulang (K13)                                                                                                                                        | Mode cek: hanya yang hilang, lewat `LC_ALL=C apt-get -s install` dulu (K7, regex `Inst` L8); tanpa `pkg upgrade`; hold hanya dengan konfirmasi; seluruh langkah hanya dengan TTY (§4). Mode upgrade: hanya dilaporkan                                                                                                                   |
| 3   | runit          | runsvdir hidup (pidfile + `kill -0`)                                         | `CliHost.run("service-daemon", ["start"])` dengan stdio `ignore`, env bersih (K11b), `SVDIR` **dan** `LOGDIR` eksplisit (m4); exit 1 dengan runsvdir hidup = ok (m5); tunggu pidfile ≤ 15 dtk. Bila L1 gagal: exit 3 "tutup dan buka lagi Termux, lalu `<perintah>`"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tidak ada aksi bila hidup                                                                                                                                                                                                                                                                                                               |
| 3a  | SSH (opsional) | `--ssh-key` diberikan                                                        | K22, **sebelum** langkah berisiko (C26): `authorized_keys`, drop-in key-only (bila L3 mengizinkan), hapus `down`, `sv up sshd`, cetak sidik jari + `ssh -p 8022 <user>@<IP HP: lihat Tailscale/Wi-Fi>`. Gagal → exit 1 sebelum PostgreSQL/`.env`/tunnel disentuh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Mode cek: kunci yang sudah ada tidak diduplikasi; drop-in yang ada tidak ditimpa; sshd yang `run` tidak di-restart. Mode upgrade: dilewati (§4)                                                                                                                                                                                         |
| 4   | Postgres       | `PG_VERSION`, `svc_postgres`                                                 | `initdb -D $PREFIX/var/lib/postgresql -U postgres --auth-local=trust --auth-host=scram-sha-256`; hapus `down`, `sv up postgres`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Data ada → tidak disentuh; layanan mati → hanya disebut (doctor/UI punya tombol). `initdb` di mode cek hanya dengan TTY; mode upgrade: dilaporkan                                                                                                                                                                                       |
| 5   | `.env`         | `env_complete` (placeholder = kosong, D7), `env_valid`                       | Buat dari `renderEnvTemplate({ full: true })` (600; = `.env.example`, K17). Tanya **hanya** yang kosong/placeholder (§4.3). Validasi `parseEnv`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Nilai yang ada (bukan placeholder) tidak pernah ditanya ulang/ditimpa                                                                                                                                                                                                                                                                   |
| 6   | Layanan panel  | `$SVDIR/panel/run` sama dengan template                                      | Folder `.panel.new` → `run` (embed `deploy/sv/panel/run`, `with { type: "text" }`) + `log/run` → svlogger → rename; `down` selama `.env` belum lengkap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Run script = template versi lama yang dikenal (daftar hash ter-embed, mis. md5 `17778486…` = template 0.4.0/0.5.0 di POCO) → ditimpa, yang lama disimpan `run.bak-<versi>` (E18, C23, juga di mode upgrade). Run script lain (kustom) → peringatan saja, tidak ditimpa. Template baru = hash baru ditambah ke daftar di rilis yang sama |
| 7   | pm2            | `ecosystem.config.js`, `apps.json`, `$SVDIR/pm2`                             | **Hanya bila ketiganya tidak ada**: `ecosystemFromTemplate`, `apps.json` `[]`, run script pm2 ter-embed (folder `.pm2.new` → rename), `sv up pm2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tidak menulis apa pun; hasil integrasi dicetak + "buka Situs → Persiapan" (K6)                                                                                                                                                                                                                                                          |
| 8   | Tunnel         | `cf_cert`, `cf_config`, `cf_panel_ingress`, DNS                              | §4.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Rute panel ditambah ke `config.yml` hanya bila layanan `panel` **tidak** `run`; bila `run` → cetak baris ingress persis + "tambahkan lewat Situs → Domain" atau `sv down panel` lalu rerun (D10)                                                                                                                                        |
| 9   | Boot           | `termux_boot_script`                                                         | Tulis `~/.termux/boot/panel-termux` (755): `termux-wake-lock` + `service-daemon start` dengan `SVDIR` **dan** `LOGDIR` (m4); panggil `termux-wake-lock` sekarang, didahului baris "HP akan menanyakan izin baterai: pilih Izinkan" (m11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Ada skrip yang sudah menyalakan layanan (POCO: `start-services`) → tidak ditulis. Mode cek: menulis skrip + `termux-wake-lock` hanya dengan TTY (dialog baterai butuh orang di HP, m11). Mode upgrade: dilaporkan                                                                                                                       |
| 10  | Nyalakan & cek | `svc_panel`, `panel_health`, inode proses runit                              | Hapus `down`; belum jalan → `sv up panel`; mode upgrade & sedang jalan → `sv -w 130 restart panel` (K9: konfirmasi TTY atau `--yes`, juga tanpa TTY). Tunggu `/api/health` ≤ 30 dtk; cek versi = binary ini dan inode proses = `~/panel/panel`. Gagal → pesan + `panel rollback [--db]` bila `panel.prev` ada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Hanya layanan `panel`; pm2 tidak pernah, cloudflared hanya K9; mode cek tidak me-restart panel yang `run`                                                                                                                                                                                                                               |
| 11  | Ringkasan      | doctor                                                                       | Cetak hasil doctor singkat + langkah manual tersisa (Access, pengaturan Android, OAuth bila dilewati) + URL panel. Perintah yang dicetak adalah yang benar-benar bisa dipakai: `panel` bila `$PREFIX/bin/panel` → kita, selain itu `~/panel/panel` (m8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | sama                                                                                                                                                                                                                                                                                                                                    |

Mode upgrade: setiap langkah selain 0, 1, 6 (hanya run script panel usang), 10, dan 11 **hanya dilaporkan** (K21, C23).

Rencana dicetak sebelum langkah 1 dijalankan, dalam bahasa awam, satu baris per aksi, lalu satu pertanyaan
`Lanjutkan? [Y/n]`. Konfirmasi tambahan hanya untuk aksi berisiko (restart panel yang sedang jalan, restart
cloudflared, `pkg upgrade`, daftar upgrade dari simulasi, pemindahan DNS §4.4, `--skip-verify`). `--yes` menjawab ya
untuk rencana dan HP baru, dan untuk restart panel di mode upgrade (juga tanpa TTY). Aturan restart lengkap = K9:
restart cloudflared, pemindahan DNS, dan `--skip-verify` tetap butuh TTY; langkah 2/4/9 di mode cek butuh TTY (§4).

Contoh rencana (HP baru):

```text
Panel Termux 0.5.1 — penyiapan HP

✅ Binary cocok dengan SHA256SUMS rilis v0.5.1 (membuktikan unduhan utuh, bukan asal rilis)

HP ini belum punya instalasi panel. Yang akan dilakukan:
  1. Memasang panel ke ~/panel/panel (perintah: panel)
  2. Memperbarui paket Termux (pkg upgrade), lalu memasang: termux-services, nodejs-lts, postgresql, cloudflared, termux-api
  3. Menahan cloudflared dan postgresql dari upgrade otomatis (apt-mark hold; lihat panel docs paket)
  4. Memasang pm2 7.1.2 (npm)
  5. Menyalakan runit (dan ssh bila --ssh-key diberikan), menyiapkan PostgreSQL
  6. Menanyakan alamat panel, email admin, dan OAuth client Google (disimpan di ~/panel/.env)
  7. Login Cloudflare di browser, membuat tunnel, menghubungkan alamat panel
  8. Menyalakan semua otomatis setelah HP menyala (Termux:Boot); HP akan menanyakan izin baterai: pilih Izinkan
  9. Menyalakan panel dan memeriksanya
Butuh internet, ±10–20 menit. Lanjutkan? [Y/n]
```

Contoh rencana (upgrade POCO 0.5.0 → 0.5.1):

```text
Panel Termux 0.5.1 — penyiapan HP

✅ Binary cocok dengan SHA256SUMS rilis v0.5.1 (membuktikan unduhan utuh, bukan asal rilis)

Panel v0.5.0 sudah terpasang dan sehat. Yang akan dilakukan:
  1. Mengganti ~/panel/panel dengan v0.5.1 (v0.5.0 disimpan sebagai panel.prev)
  2. Memulai ulang layanan panel (situs dan pm2 tidak disentuh; snapshot database dibuat panel saat start)
Sudah lengkap: paket, runit, PostgreSQL, .env, pm2, tunnel, Termux:Boot.
Lanjutkan? [Y/n]
```

Bila ada yang kurang di mode upgrade, baris "Sudah lengkap" diganti `⚠️ <yang kurang> (tidak dipasang saat upgrade)` +
`→ jalankan lagi panel init di terminal`.

`--dry-run`: deteksi + rencana dicetak (cek diri hanya `fetch` `SHA256SUMS` dan hash `process.execPath`, karena
`panel.new` tidak dibuat), lalu exit 0 tanpa menulis apa pun (termasuk lock) dan tanpa
proses anak yang mengubah HP (hanya probe `CliHost.exec` read-only). Exit 3/1 yang akan terjadi saat dijalankan tetap
disebut sebagai baris `⚠️`/`❌` di rencana.

### 4.2 State dan resume

- **Tidak ada file state** (m6). Nama tunnel diturunkan dari host `APP_BASE_URL` (Q7) atau jawaban prompt; "menunggu
  login Cloudflare" = `cert.pem` belum ada; tunnel id ada di `config.yml`.
- Resume setelah exit 3: pesan exit 3 selalu menyebut perintah persisnya (m8): `panel init` bila langkah 1 sudah
  selesai (symlink ada), selain itu `~/panel/panel init`. File unduhan tidak dibutuhkan lagi setelah langkah 1.
- Resume instalasi baru yang terputus (binary dan layanan `panel` ada, belum ada data pengguna) tetap mode HP baru
  (K7): `dpkg --audit` tidak kosong → `dpkg --configure -a`, bukan exit 3 (E2).
- Upgrade yang terputus setelah langkah 1 = instalasi dengan binary baru yang belum di-restart; rerun mendeteksi
  inode `/proc/<pid runit>/exe` ≠ `~/panel/panel` (K21) dan hanya menjalankan langkah 10. `panel.prev` tidak berubah
  karena proses yang melayani bukan file terpasang.
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

TTY: baris pasang menjalankan binary langsung dari shell, jadi stdin = terminal. Snippet `/dev/tty` D6 hanya dipakai
shim `install.sh` (§8.2), karena di sana stdin = pipa `curl | sh` mungkin. `ssh poco ./panel init` tanpa `-t` = tanpa
TTY.

Tanpa TTY (pipe, `--yes` tanpa terminal, ssh tanpa `-t`): tidak bertanya; bila ada yang kosong → `down` tetap, exit 3 dengan nama
variabel, sama dengan `install-phone.sh` sekarang. `--hostname`/`--admin-email` boleh dipakai (bukan rahasia);
Client ID/secret **tidak** punya flag.

Prompt rahasia: `process.stdin.setRawMode(true)`, baca sampai Enter, Backspace didukung, Ctrl-C → exit 130,
`setRawMode(false)` di `finally`. Non-rahasia: `prompt()` global Bun.

### 4.4 Tunnel

1. `cert.pem` tidak ada → jelaskan ("Login Cloudflare di browser, pilih domain panel"), jalankan `cloudflared tunnel
   login` lewat `CliHost.run` dengan stdout di-pipe: setiap baris diteruskan ke terminal dan URL pertama diambil untuk
   `termux-open-url <url>` bila tersedia (D14; URL login sekali pakai, bukan rahasia). Selesai bila `cert.pem` muncul.
   Tanpa TTY → exit 3.
2. `config.yml` tidak ada → nama tunnel: jawaban prompt dengan default dari Q7 (`panel-contoh-com`); tanpa TTY = default
   (`--tunnel` dihapus, C27). `tunnel list -n <nama> -o json` (tanpa rahasia): belum ada → `tunnel create <nama>`
   **tanpa** `-o` (D4: `-o json` mencetak `TunnelWithToken.token`), lalu id diambil lagi dari `tunnel list -n <nama> -o
   json` dan `~/.cloudflared/<id>.json` harus ada. Sudah ada **dan** kredensialnya ada → **pakai ulang** tunnel itu
   (C19). Ada tanpa kredensial → TTY: minta nama lain; tanpa TTY: exit 3 dengan dua pilihan persis (`panel init` di
   terminal untuk nama lain, atau `cloudflared tunnel delete <nama>` bila tunnel itu tidak dipakai lagi). Opsi token
   (`cloudflared tunnel token`) tidak dipakai karena L2 memilih run script kita yang butuh kredensial JSON. Tulis
   `config.yml` (600): `tunnel`, `credentials-file`, ingress catch-all `http_status:404` (teks sama dengan server-termux).
3. Host panel belum di ingress (dan panel tidak `run`, K6) → `ingressStep(ctx, st, [host], false, t =>
   insertIngressRule(t, host, "http://localhost:<PORT>"))` (validasi `cloudflared … ingress validate`,
   `config.yml.bak`, rename atomik), fungsi yang sama dengan job situs.
4. DNS → `system.cloudflared.routeDns(tunnelId, host)` (bawaan tanpa `--overwrite-dns`; `DnsWrongZoneError` → pesan
   "cert.pem untuk zona lain: login ulang dengan domain yang benar"). Record sudah milik tunnel ini = sukses (`created:
   false`). Record sudah ada untuk tujuan lain → `DnsRecordExistsError` (baru, C19), lalu:
   - Cetak pemetaan lama → baru: `<host>: <tujuan lama> → tunnel <nama> (<8 karakter id>)`. Tujuan lama = nama/id
     tunnel bila diketahui dari `config.yml` lokal atau output cloudflared, selain itu `record DNS lain (tujuan tidak
     terbaca dengan cert.pem)`.
   - TTY: `Alamat <host> sudah diarahkan ke tunnel lain. Pindahkan ke tunnel ini? Yang dilayani alamat itu sekarang akan
     putus. [y/N]` → ya: `routeDns(id, host, { overwrite: true })` (parameter baru, bawaan `false`; job situs tetap tanpa
     overwrite); tidak → exit 4. `--yes` **tidak** menjawab pertanyaan ini.
   - Tanpa TTY: exit 3 dengan pemetaan di atas + perintah persis `cloudflared tunnel route dns --overwrite-dns <tunnel>
     <host>`; nol panggilan overwrite.
5. Layanan cloudflared = **run script kita + hold** (L2 opsi A, Q4): tulis `$SVDIR/cloudflared/run` pola server-termux
   (`#!…/sh`, `export HOME=<home>`, `exec cloudflared tunnel --no-autoupdate run <nama> 2>&1`) lewat folder bertitik →
   `rename`, `apt-mark hold cloudflared` (langkah 2), hapus `down`, `sv up cloudflared`. **Tidak** membuat
   `~/.cloudflared/token`: template paket (`--token-file`) menyalakan autoupdate (template tanpa `--no-autoupdate`) dan
   menambah rahasia kedua yang cukup untuk menjalankan tunnel dari mana pun. Run script yang ada dan bukan template
   paket tidak ditimpa (K6). Template paket (hasil reinstall/upgrade: `down` 0 byte + `run` `--token-file`, L2) diganti
   run script kita hanya di mode HP baru atau dengan konfirmasi TTY. Upgrade/reinstall paket tetap mematikan tunnel
   (`prerm` menghapus folder layanan; hold tidak menahan `--reinstall`, L8); resep pemulihan di `panel docs paket`.
   Ingress berubah dan cloudflared sudah jalan → restart sesuai K9.

`--skip tunnel`: langkah 8 dilewati; `APP_BASE_URL=http://localhost:<PORT>` tanpa prompt (m15); ringkasan menyebut
panel hanya bisa dibuka di alamat itu (Google menerima localhost).

### 4.5 Keamanan di instalasi yang sudah ada (ringkas)

| Aturan                                                                                                                                                                                                  | Dari                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| File yang ada tidak pernah ditimpa: ecosystem, `apps.json`, run script pm2/panel/cloudflared, `config.yml` (kecuali sisip rute panel), `.env` (kecuali mengisi variabel kosong/placeholder), skrip boot | K6, C1, D7                                 |
| `config.yml` hanya disunting bila layanan `panel` tidak `run`: kandidat → `ingress validate` → `.bak` → rename atomik → fsync (`ingressStep`)                                                           | PLAN/03 §4, D10                            |
| Tidak ada `pkg upgrade` bila ada data pengguna atau PostgreSQL; paket yang hilang lewat `LC_ALL=C apt-get -s` dulu; upgrade `cloudflared`/`postgresql`/`nodejs*` ditolak; tidak pernah `--reinstall`    | K7, D9, E2                                 |
| Tidak ada restart pm2; restart panel hanya di mode upgrade (TTY atau `--yes`); restart cloudflared hanya dengan TTY; mode cek tidak me-restart panel yang `run`                                         | K9, C3, C22                                |
| Mode upgrade hanya menyentuh daftar K21; mode cek menjalankan paket/PostgreSQL/boot hanya dengan TTY                                                                                                    | K21, C23                                   |
| Hostname yang sudah diarahkan ke tunnel lain dipindah hanya setelah `y` di TTY; tanpa TTY exit 3                                                                                                        | §4.4, C19                                  |
| Tidak ada fix integrasi dari CLI; rujuk UI                                                                                                                                                              | K6                                         |
| Tidak ada panggilan CLI `pm2`                                                                                                                                                                           | B14                                        |
| Rahasia tidak pernah dicetak/log/argv; kunci `ENV_VARS` tidak diwariskan ke proses anak                                                                                                                 | K10, K11b                                  |
| stdout/stderr `cloudflared` tidak pernah dicetak atau dimasukkan pesan error; hanya kode keluar + baris yang lolos `redactLines`                                                                        | K10, D4                                    |
| CLI tidak menulis audit ke `panel.db` (tidak ada aktor login); setiap file yang diubah dicetak dengan path-nya                                                                                          | C6 (tidak berlaku: bukan aksi admin panel) |
| Upgrade hanya mengubah daftar K21 dan me-restart layanan `panel`; binary lama tidak pernah dieksekusi; `panel.prev` hanya dari binary yang terbukti melayani (inode)                                    | K20, K21, D12, C21                         |
| Binary yang gagal cek diri hanya meninggalkan `panel.new` yang langsung dihapus; versi lebih lama ditolak (saran `panel rollback`)                                                                      | K19, K20, C24, C27                         |
| Folder/file yang ada tapi bukan buatan `init` (skrip boot lain, drop-in sshd lain, `authorized_keys`) tidak pernah ditimpa; `authorized_keys` hanya ditambah satu baris                                 | K6, K22                                    |

Uji penerimaan wajib 0.5.1: skenario `poco` (fixture meniru POCO: ecosystem tulisan tangan 0600 tanpa blok, run pm2
tanpa `--no-auto-exit`, `config.yml` + `cert.pem`, semua layanan `run`, cloudflared/postgresql di-hold, tanpa
`$PREFIX/bin/panel`) → `init --yes` tanpa TTY hanya mengubah daftar persis K21: `~/panel/panel`, `~/panel/panel.prev`,
`$PREFIX/bin/panel` (dibuat), `$SVDIR/panel/run` + `run.bak-<versi>` (hanya bila run = template lama yang dikenal), file
unduhan (dihapus), `~/panel-src/v[0-9]*` (dipangkas). Selain itu snapshot fs sebelum/sesudah identik (kecuali log). Nol
panggilan `pkg`/`apt`/`dpkg` yang mengubah, `initdb`, `termux-wake-lock`, `sv restart pm2`, `sv restart cloudflared`;
`config.yml` tidak disunting. Varian "instalasi 0.5.0 tanpa PostgreSQL/skrip boot": hasil sama, yang kurang hanya
dilaporkan (E5).

Test unit 0.5.1 lain yang wajib (selain test init lama: rencana `fresh`/`poco`/parsial, idempoten, lock, Ctrl-C):
perekam `exec` tanpa `-o` pada `tunnel create` dan tanpa token di string apa pun (D4); `.env` = `.env.example` 0.4.0 →
keempat variabel ditanya (D7); simulasi `apt-get -s` yang memuat `postgresql` → exit 3 tanpa `pkg install` (D9);
`dpkg --audit` tidak kosong di mode cek → exit 3 (D9); panel `run` → `config.yml` tidak berubah (D10); ingress berubah

- cloudflared `run` + `--yes` tanpa TTY → exit 3, nol `sv restart cloudflared` (K9, E4); mode cek dengan panel `run` →
  nol restart panel; `--skip tunnel` → tidak ada prompt alamat (m15); runsvdir dari perekam menerima env tanpa kunci
  `ENV_VARS` dan dengan `SVDIR` + `LOGDIR` meski env pemanggil tanpa keduanya (D3, m4, lab fase A); setiap `apt`/`dpkg`
  dari perekam membawa `LC_ALL=C`; parser `Inst` atas teks L8 (upgrade `runit [2.3.1]`, baru `jq`, reinstall
  `cloudflared [2026.11.2]`, "already the newest" → nol baris); snippet `install.sh` tanpa TTY (D6).
  Mode (E2): fixture `fresh` + `PG_VERSION` → rencana tanpa `pkg upgrade`, simulasi `apt-get -s`; fixture "fresh yang
  terputus" (binary + layanan `panel`, tanpa `panel.db`) + `dpkg --audit` tidak kosong → `dpkg --configure -a`, bukan exit
  3; Termux berisi PostgreSQL tanpa `~/panel` → mode cek; lock ada di `$PREFIX/tmp`, cek diri gagal → `$HOME` tidak
  berubah. Tunnel (E1): `routeDns` palsu melempar "already exists" → TTY: satu pertanyaan, pemetaan lama → baru dicetak,
  lalu satu panggilan `overwrite: true`; jawaban tidak → exit 4; tanpa TTY (juga `--yes`) → exit 3 dan nol panggilan
  overwrite; tunnel ada dengan kredensial → dipakai ulang tanpa `tunnel create`; run script cloudflared = pola
  server-termux dengan `--no-autoupdate`, tidak ada file `~/.cloudflared/token`.
  Tambahan C18: cek diri (cocok → lanjut; tidak cocok, baris `panel` tidak ada, 404, gagal jaringan → exit 1, `panel.new`
  dihapus, snapshot fs sebelum/sesudah identik; byte yang di-hash = byte `panel.new`; tag kosong → info tanpa `fetch`;
  SHA `~/panel/panel` = diri → tanpa `fetch`; `--skip-verify` di TTY → peringatan + `[y/N]`, tanpa TTY → exit 2; nol
  panggilan `gh`); tag tidak berubah oleh `PANEL_RELEASE_TAG` di env runtime; versi terpasang dari `/api/health` lalu
  `app_meta` (perekam: binary terpasang tidak pernah dieksekusi); lebih lama → exit 3 dengan saran `panel rollback`;
  upgrade `poco` → daftar K21 saja, satu `sv -w 130 restart panel`, nol perintah `pm2`/`sv … pm2`/`sv … cloudflared`;
  upgrade `--yes` tanpa TTY → restart panel (K9); `panel.prev` tidak berubah bila health ok tetapi inode proses ≠ inode
  file (E3), `panel.prev` = hard link (inode sama dengan `panel` lama); run script panel = template lama dikenal → ditimpa +
  `run.bak-<versi>`, kustom → tidak berubah; file unduhan di luar `~/panel/` dihapus setelah langkah 1, `~/panel/panel`
  dan `~/panel/panel.prev` tidak (E10); `~/panel-src/{dist,deploy,scripts}` tidak dipangkas (E11); `--dry-run` → nol file
  ditulis di skenario `fresh`, `poco`, `upgrade`; `--ssh-key` dengan `http://` → exit 2, kunci tidak valid atau berawalan
  opsi → exit 1, kunci sama dua kali → satu baris di `authorized_keys`, file tanpa `\n` akhir → baris lama utuh, `-` membaca
  satu baris dari stdin, drop-in yang ada tidak berubah; `--ssh-key` → `sv up sshd` terekam sebelum `initdb`/`.env`/tunnel.

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
   [--db]`. Di 0.5.1 penulisnya `init` dengan syarat yang lebih ketat: health ok **dan** inode proses runit = inode
   `~/panel/panel`, ditulis lewat `link` + `rename` (K21, C21; celah `install-phone.sh:108-112` dan `cp -p` non-atomik
   ikut hilang bersama skrip itu).

### 5.2 `panel upgrade` (ditunda, C14)

Upgrade di 0.5.0 = jalankan lagi perintah `install.sh` (`PANEL_VERSION=vX` untuk versi tertentu). Di 0.5.1 = jalankan
lagi baris pasang (binary terbaru) atau `<binary versi X> init` (K20, K21); README dan `--help` menyebutnya. `init`
sudah memuat cek diri SHA256SUMS (K19), jadi yang tersisa untuk `panel upgrade` hanyalah mengunduh binary dari dalam
binary dan tanda tangan Ed25519. Alasan menunda (D12): menduplikasi `install.sh` → `init`, `SHA256SUMS` dari asal yang sama dengan
tarball hanya membuktikan integritas (bukan asal), dan `gh attestation verify` tidak tersedia di HP. Syarat saat
dibangun nanti, dicatat di §15: tanda tangan Ed25519 atas `SHA256SUMS` dengan kunci publik ter-embed (`node:crypto`
`verify`, tanpa dependency), `detectRuntime` sebelum binary baru dieksekusi, aturan `panel.prev` D12, rumus ruang
`install-phone.sh` + ukuran ekstrak + `panel.new`, dan target < 0.5.0 ditolak.

## 6. `docs` dan `env`

### 6.1 `docs`

- `panel docs` = daftar topik; `panel docs <topik>` = cetak teks polos (≤ ±60 baris per topik, lebar ≤ 100 kolom).
- Topik (4, m16): `google` (OAuth client, redirect URI), `cloudflare` (login, tunnel, ingress, Access), `android`
  (Termux dari F-Droid/GitHub, Termux:Boot dibuka sekali, Termux:API, pembatas proses anak, baterai, izin wake-lock),
  `paket` (kenapa `cloudflared`/`postgresql` di-hold; hold hanya menahan `pkg upgrade`, **bukan** `pkg reinstall`/`pkg
  install --reinstall` (L8); resep upgrade aman cloudflared dari L2: simpan `run` → `sv down cloudflared` → `apt-mark
  unhold cloudflared` → `pkg install cloudflared` → pulihkan `run` + `chmod 700` → hapus `down` → `sv up cloudflared` →
  `apt-mark hold cloudflared` → `sv status` = `run:`; lewat ssh `export SVDIR` dulu; resep PostgreSQL mayor: `pg_dumpall` **sebelum** upgrade → `initdb` baru → restore, karena repo Termux
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

### 8.2 0.5.1: binary mentah sebagai aset, `install.sh` = shim satu rilis (C18)

**Aset rilis 0.5.1** (`scripts/package-release.sh`):

| Aset                                | Isi                                                                                                                                                               | Sampai |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `panel`                             | binary android-arm64 (755), tag tertanam saat build lewat `__PANEL_RELEASE_TAG__` (env `PANEL_RELEASE_TAG` di langkah build `release.yml`, K19, K25)              | tetap  |
| `SHA256SUMS`                        | baris untuk setiap aset di bawah; dipakai cek diri `init` dan `sha256sum -c`                                                                                      | tetap  |
| `install.sh`                        | shim kompatibel (di bawah), `PANEL_VERSION_DEFAULT` ditanam                                                                                                       | 0.5.x  |
| `panel-termux-android-arm64.tar.gz` | binary + `scripts/install-phone.sh` hasil generate (`install.sh` ≤ 0.5.0 memanggilnya dengan path binary sebagai `$1`: `exec "$1" init` + snippet D6) + `VERSION` | 0.5.x  |

Attestation `actions/attest` tetap memakai `subject-checksums: SHA256SUMS`, jadi aset `panel` ikut ter-attest dan
`gh attestation verify panel --repo makurosolusi/panel-termux` bekerja di komputer (opsional, disebut di pesan sukses
`init`; `init` sendiri tidak memanggil `gh`, K19). Tarball tetap satu rilis karena C18(a); debat E9 mengusulkan
mengeluarkannya dari 0.5.1 (nol pengguna: satu-satunya instalasi, POCO, di-wipe), menunggu pemilik (Q17).

**Shim `scripts/install-release.sh`** (≤ 30 baris): `set -eu`, cek `aarch64` + `$PREFIX` + `curl`/`sha256sum`, unduh
`panel` + `SHA256SUMS` dari `$RELEASES_URL/$VERSION/` ke `mktemp -d`, `sha256sum -c --ignore-missing`, `chmod 755`,
lalu `exec` dengan snippet D6:

```sh
BIN="$TMP/panel"
if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$BIN" init "$@" </dev/tty; else exec "$BIN" init "$@"; fi
```

Karena `exec`, trap pembersih `mktemp` tidak jalan; `init` menghapus file unduhannya sendiri (K24) dan folder kosong
di `$TMPDIR` dibiarkan (`ponytail:` satu folder kosong per run shim, hilang bersama shim di 0.6.0). Header: exit code =
exit code `panel init`. Shim tidak lagi memeriksa `termux-services`/`cloudflared`/ruang (tugas `init`).
`scripts/install-release.test.sh`: stub `curl` yang menyajikan stub binary pencatat `init "$@"`, cek checksum gagal →
exit 1 tanpa `exec`, propagasi exit 0/1/3, dijalankan **tanpa TTY**.

**Dihapus di 0.5.1:** `scripts/install-phone.sh`, `scripts/install-phone.test.sh` (K23), langkahnya di `ci.yml` /
`release.yml`, `cp` `install-phone.sh`/`deploy/*`/`.env.example` di `package-release.sh` (semuanya sudah di-embed di
binary). **Dihapus di 0.6.0:** aset `install.sh`, tarball, `scripts/install-release.sh` + test-nya, generate
`install-phone.sh`; CHANGELOG 0.5.1 **Changed** sudah mengumumkannya.

**Landing/README 0.5.1:** hanya baris K24; tidak ada `install.sh`, `pkg install termux-services`, atau "tutup dan buka
lagi Termux". Langkah tersisa yang disebut: pasang Termux + Termux:Boot + Termux:API dari F-Droid, satu baris, jawab
prompt (alamat, email, OAuth Google), klik login Cloudflare, pengaturan Android (`panel docs android`). README
menambah: "bila unduhan gagal, ulangi seluruh baris" dan catatan bentrok nama dengan folder clone `~/panel-termux`
(E13). README dengan baris baru di-merge ke `main` **bersama** tag `v0.5.1`, tidak lebih awal: sampai itu
`releases/latest` = v0.5.0 yang tidak punya aset `panel` (404, E14).

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
- L4 (POCO, 0.5.0, fase A): `-v` median 55–61 ms, `env` 55–59 ms, `docs` 55–59 ms, `doctor` 1,3–1,4 dtk, diukur dari `~`
  dan `$PREFIX/tmp`. Kriteria waktu < 0,5 dtk terpenuhi untuk folder itu; dari `~/panel` (dengan `.env` lengkap) belum
  diukur.

## 12. Risiko

| Risiko                                                                              | Mitigasi                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel kedua memigrasi `panel.db` yang sedang dipakai sebelum gagal bind (D2)        | Penjaga instance di awal `bootPanel` (§2.4) + `panel` di TTY = bantuan (K2). Race start bersamaan tetap terbuka (`ponytail:`, pidfile bila terjadi)          |
| Rahasia `.env` diwariskan ke proses anak (D3)                                       | K11b di satu tempat (`main.ts`); test perekam unit + shell; lab L7 di HP untuk runsvdir (0.5.1)                                                              |
| Doctor/init di HP baru berjalan dengan adapter fake (D1)                            | K13: deteksi dari `pkg`/`apt`/`TERMUX_VERSION`, fake hanya `PANEL_CLI_FAKE`; test skenario `nosv`                                                            |
| Token tunnel di stdout cloudflared (D4, 0.5.1)                                      | `tunnel create` tanpa `-o`; id dari `tunnel list`; tidak ada token file (run script kita, L2); output cloudflared tidak pernah dicetak (K10)                 |
| Pasang ulang gagal di `route dns` karena hostname milik tunnel lama (E1, 0.5.1)     | `DnsRecordExistsError` → pemetaan lama → baru + konfirmasi TTY → `--overwrite-dns`; tanpa TTY exit 3; tunnel lab dibersihkan sebelum uji final (C19)         |
| `pkg upgrade` menaikkan PostgreSQL mayor di Termux berisi data tanpa `~/panel` (E2) | "HP baru" dari data pengguna; `pkg upgrade` tidak pernah bila `PG_VERSION`/`postgresql` ada (C20)                                                            |
| Upgrade paket cloudflared mematikan tunnel (juga POCO) (D5)                         | `apt-mark hold cloudflared postgresql` (POCO sudah, C15; HP baru oleh `init` 0.5.1); doctor `pkg_held` + `cloudflared_down_file` error; resep `docs paket`   |
| Upgrade mayor PostgreSQL tanpa jalan `pg_upgrade` di Termux (D11)                   | Hold + doctor `postgres_major` + resep dump/restore di `docs paket`                                                                                          |
| Isolasi `import()` gagal dengan splitting build nyata (D13)                         | Lab L5 di G0; gagal → STOP dan putuskan ulang, bukan tambal                                                                                                  |
| Pengguna yang biasa menjalankan `./panel` manual di terminal kaget mendapat bantuan | CHANGELOG **Changed**, bantuan menyebut `panel serve`; runit tidak terdampak                                                                                 |
| Mirror Termux lambat/gagal, conffile prompt, dpkg terputus (0.5.1)                  | Flag noninteractive/confold, `dpkg --audit` di awal, SIGINT pertama diabaikan; lab L3                                                                        |
| runsvdir dari `init` mati saat sesi ditutup (0.5.1)                                 | Lab L1; fallback exit 3 "buka ulang Termux" (perilaku hari ini)                                                                                              |
| CLI dan panel menulis `config.yml` bersamaan (D10, 0.5.1)                           | CLI menyunting `config.yml` hanya bila panel tidak `run`                                                                                                     |
| `panel env > .env` menimpa `.env` yang sudah berisi rahasia                         | Tidak bisa dicegah (shell memotong dulu); peringatan stderr + saran `> .env.new`/`noclobber`; `>>` ditolak (m10)                                             |
| Doctor berbeda dengan UI                                                            | K5: fungsi + copy yang sama; test membandingkan label                                                                                                        |
| Binary unduhan palsu dari asal lain lolos cek diri (0.5.1)                          | Tidak tertutup: `SHA256SUMS` dari asal yang sama hanya membuktikan utuh (K19, pesan menyebutnya); `gh attestation verify` di komputer; Ed25519 = backlog C14 |
| Rilis/repo GitHub hilang → `init` yang memasang binary gagal (E6)                   | Run perbaikan dari `~/panel/panel` tidak mengecek (SHA sama); pemasangan offline hanya dengan `--skip-verify` di TTY + peringatan keras (C24)                |
| Wipe Termux di POCO memutus ssh dan menurunkan situs makuro-solusi (lab §14)        | Backup ke Mac dulu (fase 0), daftar aksi pemilik di HP, `--ssh-key` diproses tepat setelah runit (C26), jalur Batal → `RESTORE.md`, pemulihan fase E (Q15)   |
| Ingatan pengguna lama: `sh install.sh` masih dipakai                                | Shim satu rilis (§8.2) memanggil `init`; CHANGELOG 0.5.1 mengumumkan penghapusan di 0.6.0                                                                    |

## 13. Pertanyaan terbuka (dengan rekomendasi)

| #   | Pertanyaan                                                                               | Status / rekomendasi                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Lingkup 0.5.0?                                                                           | **Diputuskan (C12):** P0 saja. `init` + `install.sh` tipis → 0.5.1 (C13); `upgrade` ditunda (C14).                                                                                                                                                                                                                                                                                                                                                              |
| Q2  | (0.5.1) Pasang PostgreSQL secara bawaan?                                                 | Ya (situs dengan database fitur inti); `--skip postgres` untuk HP hemat RAM. Selalu diikuti hold.                                                                                                                                                                                                                                                                                                                                                               |
| Q3  | (0.5.1) Buat symlink `$PREFIX/bin/panel`?                                                | Ya, hanya bila belum ada atau sudah menunjuk ke `~/panel/panel`. Aman setelah K2 (tanpa argumen di TTY = bantuan) dan penjaga instance.                                                                                                                                                                                                                                                                                                                         |
| Q4  | (0.5.1) cloudflared: run script sendiri + hold (A) atau template paket + token file (B)? | **Diputuskan L2 (fase A, 2026-11-27): A.** Label disamakan dengan hasil lab (revisi 4 memakai label terbalik). B menyalakan autoupdate (template tanpa `--no-autoupdate`) dan menambah token kedua di disk; A teruji di POCO dan cocok dengan doctor. Keduanya tidak tahan upgrade/reinstall paket (`down` + template dipasang lagi); pencegahannya hold, pemulihannya resep `docs paket`. Opsi C (layanan milik panel di luar dpkg) = backlog.                 |
| Q5  | CLI boleh menerapkan fix ecosystem/run script pada file yang ada bila panel mati?        | Tidak. Panel dinyalakan, lalu UI Persiapan mengerjakannya dengan lock/audit/undo.                                                                                                                                                                                                                                                                                                                                                                               |
| Q6  | (0.5.1) `pkg upgrade` otomatis di HP baru?                                               | Ya, sebagai baris rencana yang dikonfirmasi (`--yes` = ya), dengan flag confold; tidak pernah di HP lama.                                                                                                                                                                                                                                                                                                                                                       |
| Q7  | (0.5.1) Nama tunnel bawaan?                                                              | `panel-` + domain tanpa label pertama, titik → strip (`panel.contoh.com` → `panel-contoh-com`). Bisa diganti di prompt (`--tunnel` dihapus, C27).                                                                                                                                                                                                                                                                                                               |
| Q8  | Kapan `install-phone.sh` dihapus?                                                        | **Diputuskan (C18):** di 0.5.1, bersama test-nya (K23). Tarball 0.5.1 memuat versi generate 1 rilis untuk `install.sh` lama yang mem-pin versi.                                                                                                                                                                                                                                                                                                                 |
| Q9  | POCO dan hold paket?                                                                     | **Selesai (C15):** `apt-mark hold cloudflared postgresql` dijalankan di POCO 2026-11-27 dengan izin pemilik. Upgrade paket itu hanya lewat resep `docs paket`. Catatan E7: lab L2 melepas hold cloudflared; hold **wajib dipulihkan** setelah setiap lab yang melepasnya. Fase A: sudah dipulihkan (`apt-mark showhold` = `cloudflared`, `postgresql`).                                                                                                         |
| Q10 | Doctor exit ≠ 0 untuk peringatan (seperti `brew doctor`)?                                | Tidak; 0 bila tanpa error. Peringatan tidak boleh membuat skrip otomatis gagal.                                                                                                                                                                                                                                                                                                                                                                                 |
| Q11 | (0.5.1) Pacman Termux?                                                                   | Tidak didukung: exit 3 dengan daftar paket untuk dipasang manual.                                                                                                                                                                                                                                                                                                                                                                                               |
| Q12 | (0.5.1) `init` memasang `glibc-runner`?                                                  | Tidak bawaan; doctor info "dibutuhkan hanya untuk situs binary glibc".                                                                                                                                                                                                                                                                                                                                                                                          |
| Q13 | HP kedua (Termux F-Droid bersih) untuk lab 0.5.1?                                        | **Diputuskan (C18):** tidak perlu. POCO = HP eksperimen; lab dan uji Termux bersih final di POCO setelah backup ke Mac, pemilik yang menghapus data Termux (§14).                                                                                                                                                                                                                                                                                               |
| Q14 | Nama file unduhan di baris pasang?                                                       | **Rekomendasi `panel-termux`** (K24), bukan `panel` seperti sketsa pemilik: `~/panel` = folder instalasi, jadi `curl -o panel` di HOME gagal di HP terpasang dan menduduki path itu di HP baru. Aset rilis tetap bernama `panel`. Pemilik boleh membalik ke `cd $TMPDIR && curl -fLo panel … && ./panel init` (`TMPDIR=$PREFIX/tmp` di POCO; Termux bersih di L3). Bila nama dipertahankan: README mencatat bentrok dengan folder clone `~/panel-termux` (E13). |
| Q15 | Situs makuro-solusi di POCO mati selama jendela wipe (fase B–E §14)?                     | **Menunggu pemilik; gerbang fase B (E8).** Rekomendasi: terima downtime sekali dan pulihkan hanya setelah wipe final (fase E), daripada memulihkan dua kali.                                                                                                                                                                                                                                                                                                    |
| Q16 | Dari mana kunci publik ssh Mac datang saat wipe?                                         | **Menunggu pemilik; gerbang fase B (E8).** Desain mendukung ketiganya (`--ssh-key <https-url\|file\|->`, K22): URL `https://github.com/<akun>.keys` (cek di Mac: bandingkan `~/.ssh/*.pub` dengan halaman itu; bila belum ada, tambahkan kunci publik ke GitHub), file, atau `-` (tempel satu baris di prompt). Rekomendasi: URL GitHub, karena pemilik cukup mengetik satu URL pendek di HP.                                                                   |
| Q17 | (0.5.1) Tarball rilis + `install-phone.sh` hasil generate tetap di 0.5.1?                | **Menunggu pemilik (E9).** C18(a) mengikatnya satu rilis, jadi PLAN tetap memuatnya. Usulan debat: hapus di 0.5.1 (hanya melayani `PANEL_VERSION=v0.5.1 sh install.sh` dari salinan ≤ 0.5.0; satu-satunya instalasi di-wipe), pertahankan shim `install.sh`.                                                                                                                                                                                                    |

## 14. Lab (di POCO, C18)

Tanpa Docker, juga di CI (C16). POCO = HP eksperimen (pemilik, 2026-11-27): boleh dipakai untuk alur destruktif
setelah backup, dan pemilik sendiri yang menghapus data Termux untuk uji final. L5/L6 sudah lulus di Mac
(`PLAN/debate/07-cli-lab-results.md`). Semua hasil ditulis ke file itu. Nilai rahasia tidak pernah dicetak: untuk
`.env`/environ hanya nama kunci atau jumlah (`grep -c`).

| #   | Pertanyaan                                                                                                                                                                                                                                                                                                                                                        | Fase | Gerbang |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| L1  | `service-daemon start` dari proses `init` (env bersih, stdio ignore): runsvdir hidup setelah sesi Termux ditutup/dibuka, setelah layar mati 30 menit dengan wake-lock, dan setelah reboot?                                                                                                                                                                        | C    | 0.5.1   |
| L2  | Template paket (`tunnel run --token-file`) + `config.yml` lokal: ingress lokal dipakai? `apt reinstall cloudflared` → yang tersisa persis `down` + template? Pilih run script kita (A) / template (B) (Q4). **Lulus 2026-11-27: A**                                                                                                                               | A    | lulus   |
| L3  | Termux baru: `curl`/`tar`/`sha256sum` ada sebelum `pkg` apa pun (POCO: `curl` = `Depends` `termux-tools`, `sha256sum`/`tar` dari bootstrap, `TMPDIR=$PREFIX/tmp`; Termux bersih belum)? `pkg upgrade -y` + confold tanpa TTY lulus tanpa prompt? SIGINT ke `dpkg` di tengah → `init` pulih? `sshd_config` bawaan memuat `Include …sshd_config.d` (K22)?           | B, C | 0.5.1   |
| L4  | Waktu `panel -v`/`doctor`/`env` di HP. **Lulus 2026-11-27** (§11.1)                                                                                                                                                                                                                                                                                               | A    | lulus   |
| L5  | Isolasi `import()` dengan build nyata (D13)                                                                                                                                                                                                                                                                                                                       | Mac  | lulus   |
| L6  | `panel.db` WAL read-only (m14)                                                                                                                                                                                                                                                                                                                                    | Mac  | lulus   |
| L7  | `/proc/<pid>/environ` runsvdir, runsv, dan pm2-runtime setelah `init` tidak memuat kunci `ENV_VARS` (D3; cek nama saja)                                                                                                                                                                                                                                           | C    | 0.5.1   |
| L8  | `apt-mark hold cloudflared postgresql`: `pkg upgrade` nyata mempertahankan keduanya; `apt-get -s install termux-api` mencetak daftar upgrade yang bisa di-parse (D5, D9). **Lulus sebagian 2026-11-27:** format `Inst` + `dpkg --audit` terbukti; hold vs versi baru belum (repo belum punya versi lebih baru, ulangi saat ada); hold tidak menahan `--reinstall` | A    | 0.5.1   |
| L9  | `init --dry-run` (build dev) di POCO yang sudah jalan: rencana = upgrade, `find ~ $PREFIX/var/service $PREFIX/etc -newer <penanda>` kosong selain log                                                                                                                                                                                                             | A    | 0.5.1   |
| L10 | `ssh poco ./panel-android-arm64 init --yes` (tanpa TTY, build dev, sesi non-login tanpa `SVDIR`): hanya daftar K21 berubah, panel di-restart dan sehat, pid pm2-runtime + makuro-solusi + cloudflared tidak berubah, file unduhan dihapus dan langkah setelahnya tetap jalan (E10)                                                                                | A    | 0.5.1   |
| L11 | Uji final: Termux bersih → satu baris (rc) → panel jalan; kriteria §17                                                                                                                                                                                                                                                                                            | D    | 0.5.1   |

**Fase 0 — backup ke Mac (koordinator, ssh; gerbang wipe).** Tujuan `/Users/bip/panel-termux-backups/<YYYYMMDD-HHMM>/`
(folder 700, file 600, di luar repo, tidak pernah di-`cat`):

1. `pg_dumpall -U postgres` → `pg_dumpall.sql` + versi PostgreSQL (`postgres --version`).
2. `sv down panel` → arsip `~/panel` (`data/` termasuk `secret` + snapshot, `.env`, `panel`, `panel.prev`) → `sv up
   panel` (hanya panel berhenti sebentar; situs tetap jalan).
3. Arsip `~/sites` (app, `.env`, `ecosystem.config.js`, `apps.json`), `~/.cloudflared`, `~/.termux`, `~/bin`, `~/.ssh`,
   `~/CLAUDE.md` `~/AGENTS.md` `~/README.md`, `$PREFIX/var/service` (tanpa `supervise/`), `$PREFIX/etc/ssh`.
4. Daftar: `dpkg --get-selections`, `apt-mark showhold`, `termux-job-scheduler --pending`.
5. Arsip dibuat di HP, dipindah dengan `rsync --partial` dalam loop ulang (VPN bisa putus), SHA-256 dibandingkan dua
   sisi, `tar -tzf` lulus, dump diakhiri baris "PostgreSQL database cluster dump complete"; baru lalu arsip di HP
   dihapus. Koordinator melapor path + checksum ke pemilik. **Tanpa laporan ini tidak ada wipe.**

**Fase A — POCO apa adanya (ssh, setelah fase 0).** Urutan yang mengikat (E7, C25): yang tidak merusak dulu, yang
merusak terakhir: L4 → L9 → L10 → L8 (`pkg upgrade` nyata) → L2. Status 2026-11-27 (`PLAN/debate/07-cli-lab-results.md`):
L4 lulus; L8 hanya simulasi (`apt-get -s`, tidak ada `pkg upgrade` nyata) sehingga tidak merusak; L2 lulus dengan
reinstall nyata (tunnel mati ±1–2 menit) lalu dipulihkan. L9/L10 menunggu build `init` dan dijalankan di atas keadaan
yang sudah pulih; pid pembanding L10 diambil saat L10 dimulai, jadi urutan yang terlanjur tidak memengaruhi hasilnya.
`pkg upgrade` nyata L8 tetap terakhir dan diulang saat repo punya versi cloudflared/postgresql lebih baru. Syarat keluar
fase A: `apt-mark showhold` memuat `cloudflared` dan `postgresql`, doctor `pkg_held` ok, `$PREFIX/var/service/cloudflared/run`
sama dengan backup `~/lab-l2/service-orig` (sha256 `af96b84c…`), tanpa file `down` (terpenuhi setelah L2). Setiap
perintah `sv`/`apt` lewat ssh memakai `export SVDIR=$PREFIX/var/service LOGDIR=$PREFIX/var/log`. Bug → worker
memperbaiki → ulang di POCO (init idempoten), tanpa wipe.

**Batal (fase B–E, E8).** Pemilik bilang berhenti, atau fase B/D tidak hijau dalam satu sesi kerja → pulihkan menurut
`RESTORE.md` backup fase 0 (`/Users/bip/panel-termux-backups/poco-20261127-1529/`), dengan DNS hostname panel dan
`solusi` dikembalikan ke tunnel `poco` lewat `cloudflared tunnel route dns --overwrite-dns poco <host>` (koordinator
memperbarui `RESTORE.md` §6 yang masih tanpa `--overwrite-dns`, E1). Downtime makuro-solusi dihitung dari langkah 2 fase
B. Gerbang fase B: Q15 dan Q16 dijawab pemilik.

**Fase B — wipe 1, gladi dengan build dev.** Koordinator menyajikan `dist/panel-android-arm64` dari Mac lewat VPN
(`python3 -m http.server 8765 --bind 100.64.0.1 -d dist`) dan mengirim baris persisnya ke pemilik. Aksi pemilik di HP,
berurutan:

1. Tunggu laporan fase 0 dari koordinator.
2. Android: Setelan → Aplikasi → Termux → Penyimpanan → **Hapus data**. Jangan uninstall Termux, Termux:Boot,
   Termux:API, atau Tailscale (VPN tetap hidup, IP HP tetap `100.64.0.23`).
3. Buka Termux, tunggu bootstrap selesai sampai prompt `$` muncul.
4. Ketik satu baris dari koordinator, bentuknya (sumber kunci = jawaban Q16):
   `cd && curl -fL --retry 3 -o panel-termux http://100.64.0.1:8765/panel-android-arm64 && chmod +x panel-termux && ./panel-termux init --ssh-key <https://github.com/<akun>.keys | ->`
5. Jawab prompt: `Lanjutkan` → Enter; alamat panel (hostname panel yang sama dengan sekarang, supaya OAuth client
   lama tetap cocok); email super admin; Client ID dan Client secret (dari Google Cloud Console → Credentials).
6. Browser terbuka untuk login Cloudflare: login, pilih domain, kembali ke Termux. Pertanyaan "Alamat … sudah diarahkan
   ke tunnel lain. Pindahkan?" (hostname panel masih milik tunnel `poco`, E1) → periksa pemetaan lama → baru yang
   dicetak, lalu `y`.
7. Dialog Android baterai → **Izinkan**.
8. Kirim ke koordinator: baris ringkasan terakhir dan sidik jari host ssh yang dicetak `init` (bukan rahasia).

Karena `--ssh-key` diproses tepat setelah runit (C26), ssh sudah bisa dipakai sejak sebelum PostgreSQL/`.env`/tunnel:
bila `init` berhenti di langkah sesudahnya, koordinator tetap bisa masuk. Koordinator lalu `ssh-keygen -R
'[100.64.0.23]:8022'` di Mac (host key HP baru), `ssh poco`, cocokkan sidik jari host dengan yang dikirim pemilik. Bila
ssh gagal: pemilik menjalankan `~/panel/panel init --ssh-key <sumber yang sama>` lagi (idempoten) dan mengirim
outputnya.

**Fase C — lab di Termux bersih (ssh):** L3 (catat yang terbukti di fase B; SIGINT ke `dpkg` saat `pkg install`
paket kecil, lalu `panel init` → `dpkg --audit` → pulih), L7, L1 (pemilik menutup sesi lewat notifikasi Termux → Exit,
membuka lagi; layar mati 30 menit; reboot: semua layanan hidup ≤ 1–2 menit setelah buka kunci, tanpa aksi). Bug di
alur HP baru → perbaiki → wipe lagi hanya bila bug itu tidak bisa diulang dengan rerun.

**Fase D — uji final L11 (rilis prarilis).** Koordinator menyiapkan `v0.5.1-rc.1` (tag dan push **atas perintah
pemilik**, K25; bukan binary dry run). Sebelum wipe kedua, koordinator menghapus tunnel lab fase B (`cloudflared tunnel
delete <nama>`, dengan izin pemilik, C19), supaya Termux bersih tidak bertemu tunnel tanpa kredensial. Hostname panel
masih diarahkan ke tunnel itu sampai dihapus, jadi pertanyaan pemindahan DNS boleh muncul sekali; satu `y` dihitung
ketukan (§17). Pemilik mengulang fase B langkah 1–8 dengan baris README persis, hanya URL-nya diganti ke prarilis:
`cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/download/v0.5.1-rc.1/panel && chmod +x panel-termux && ./panel-termux init --ssh-key <sumber Q16>`.
`--ssh-key` adalah alur pemilik; run tanpa flag itu sama sahnya untuk kriteria. Lulus §17 → tag `v0.5.1` (commit sama;
binary hanya beda string tag).

**Fase E — pulihkan makuro-solusi (koordinator, dengan izin pemilik per langkah yang menyentuh Cloudflare):**
`~/sites` dari backup; role/db lalu `psql -U postgres -f pg_dumpall.sql` (dump teks juga aman bila mayor PostgreSQL
baru lebih tinggi); `ecosystem.config.js` tulisan tangan dari backup, lalu Situs → Persiapan → Perbaiki di panel;
ingress `solusi` lewat Situs → Domain; `cloudflared tunnel route dns --overwrite-dns <tunnel baru> solusi.<domain>`
(hostname itu masih milik tunnel `poco`, E1);
tunnel lama `poco` dihapus hanya atas perintah pemilik. Cek publik 200. `~/bin/ensure-services` dan job scheduler
lama tidak dipulihkan (skrip boot `init` menggantikannya) kecuali pemilik meminta. `~/CLAUDE.md`/`README.md` HP
dipulihkan dan diperbarui.

## 15. Backlog

| Item                                      | Syarat / alasan                                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel upgrade`                           | C14: Ed25519 atas `SHA256SUMS` dengan kunci publik ter-embed (`node:crypto` `verify`), `detectRuntime` sebelum eksekusi, aturan `panel.prev` D12, rumus ruang                                                     |
| Opsi C: layanan tunnel milik panel        | Ganti nama `"cloudflared"` di `site.steps.ts`, `monitor.service.ts`, `panel.service.ts`, `job.runner.ts`, `overview.problems.ts` + migrasi POCO; hold cukup untuk sekarang                                        |
| `init.json`, `-v --json`, topik docs lain | Tidak ada konsumen (m6, m16)                                                                                                                                                                                      |
| Access lewat API, watchdog, UI "Perbarui" | Sama dengan Q1 lama; butuh PLAN sendiri                                                                                                                                                                           |
| Pidfile penjaga instance                  | Bila race dua start bersamaan pernah terjadi (§2.4)                                                                                                                                                               |
| `pkg install panel-termux`                | Usulan paket ke `termux/termux-packages` (build dari sumber di sana, bukan binary unduhan; perlu cek kebijakan dan apakah Bun bisa dibangun di toolchain mereka). Setelah 0.6.0 stabil; menggantikan baris `curl` |
| Hapus `install.sh` + tarball              | 0.6.0 (§8.2)                                                                                                                                                                                                      |

## 16. Rencana kerja 0.5.1 (worker, kepemilikan file eksklusif)

Aturan sama dengan §10: worker tidak commit/push/ganti branch, tidak menyentuh file worker lain, menjalankan test-nya
sendiri + `bun run typecheck` + `bun run lint` sebelum melapor, Docker dilarang, POCO tidak disentuh worker (lab §14
milik koordinator dan pemilik). Batas baris Rule 8 (service 300): langkah `init` dipecah satu file per langkah.

| Gel. | Worker                           | File (eksklusif)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Bergantung pada | Test yang wajib lulus sebelum lapor                                                                                           |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| W0   | `wkr-init-core-01`               | `src/cli/cli.host.ts`, `src/cli/cli.host.fake.ts` (skenario baru `upgrade`, `downgrade`, `fresh-pg` = fresh + `PG_VERSION`, `fresh-resume` = binary + layanan `panel` tanpa `panel.db`, `upgrade-partial` = upgrade + inode proses ≠ file; `fetch` fake; perekam dengan nama env `LC_ALL`/`SVDIR`/`LOGDIR`), `src/cli/init.types.ts`, `src/cli/init.mode.ts` (K7 data pengguna, K20, C20), `src/cli/init.command.ts` (lock `$PREFIX/tmp/panel-init.lock`, rencana, konfirmasi, `--yes`/`--dry-run`/`--skip-verify` di TTY, aturan TTY per mode §4, exit code, ringkasan), `src/cli/cli.main.ts`, `src/cli/cli.help.ts` (tanpa `--downgrade`/`--port`/`--tunnel`), `scripts/build.ts` (`define` `__PANEL_RELEASE_TAG__` dari env saat build), `src/build.d.ts` (`declare const __PANEL_RELEASE_TAG__: string`), `tests/cli.args.test.ts`, `tests/cli.host.test.ts`, `tests/cli.init.test.ts` | –               | `cli.args`, `cli.host`, `cli.init` (orkestrasi dengan langkah stub; mode E2; restart K9; daftar K21)                          |
| W1   | `wkr-init-binary-01`             | `src/cli/init.verify.ts` (K19: hash `panel.new`, tanpa `gh`, `--skip-verify`), `src/cli/init.binary.ts` (langkah 1, K21 inode + `link`/`rename`, `fsync`, K24 hapus unduhan hanya di luar `~/panel/`, pangkas `~/panel-src/v[0-9]*`), `tests/cli.init.verify.test.ts`, `tests/cli.init.binary.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | G0              | `cli.init.verify`, `cli.init.binary`                                                                                          |
| W1   | `wkr-init-pkg-01`                | `src/cli/init.packages.ts` (langkah 2, K7/K8, D9: `LC_ALL=C`, regex `Inst` L8, `pkg upgrade` hanya HP baru tanpa PostgreSQL, `openssh` bila `--ssh-key`, `SVDIR`/`LOGDIR` eksplisit, tanpa `--reinstall`), `tests/cli.init.packages.test.ts` (fixture teks L8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | G0              | `cli.init.packages`                                                                                                           |
| W1   | `wkr-init-svc-01`                | `src/cli/init.runit.ts`, `src/cli/init.postgres.ts`, `src/cli/init.panel-sv.ts` (E18: daftar hash template lama + `run.bak-<versi>`), `src/cli/init.pm2.ts`, `src/cli/init.boot.ts`, `src/cli/init.start.ts` (langkah 3, 4, 6, 7, 9, 10; K9, K21: restart hanya mode upgrade, cek inode setelah restart), `tests/cli.init.services.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | G0              | `cli.init.services`                                                                                                           |
| W1   | `wkr-init-env-01`                | `src/cli/cli.prompt.ts` (rahasia tanpa echo, `askYesNo` bawaan tidak, baca satu baris stdin untuk `--ssh-key -`), `src/cli/init.env.ts` (langkah 5, §4.3), `tests/cli.prompt.test.ts`, `tests/cli.init.env.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | G0              | `cli.prompt`, `cli.init.env`                                                                                                  |
| W1   | `wkr-init-tunnel-01`             | `src/cli/init.tunnel.ts` (langkah 8, §4.4, D4/D10, C19: pakai ulang tunnel berkredensial, pemetaan lama → baru, konfirmasi TTY, exit 3 tanpa TTY), `src/cli/init.tunnel.service.ts` (run script kita + hapus `down`, L2 opsi A saja), `src/server/system/system.types.ts` (hanya `routeDns(…, { overwrite })` + `DnsRecordExistsError`), `src/server/system/cloudflared.termux.ts` (hanya `routeDns`), `src/server/system/system.fake.ts` (hanya `routeDns`), `tests/cli.init.tunnel.test.ts`, `tests/dns.route.test.ts`, `tests/system.termux.test.ts` + `tests/system.fake.test.ts` (hanya kasus `routeDns`)                                                                                                                                                                                                                                                                              | G0              | `cli.init.tunnel`, `dns.route`, `system.termux`, `system.fake`, semua `tests/site*.test.ts` (job situs tetap tanpa overwrite) |
| W1   | `wkr-init-ssh-01`                | `src/cli/init.ssh.ts` (langkah 3a, K22: `https-url\|file\|-`, newline akhir, tmp + `rename`, tolak opsi, sidik jari + konfirmasi TTY, tanpa tebak IP), `tests/cli.init.ssh.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | G0              | `cli.init.ssh`                                                                                                                |
| W1   | `wkr-init-dist-01`               | `scripts/package-release.sh`, `scripts/package-release.test.sh`, `scripts/install-release.sh` (shim), `scripts/install-release.test.sh`, `.github/workflows/release.yml` (aset `panel`; gate `v$VERSION` atau `v$VERSION-rc.[0-9]+`; rc → `--prerelease`; `env: PANEL_RELEASE_TAG: ${{ env.TAG }}` di langkah build, K25), `.github/workflows/ci.yml`, hapus `scripts/install-phone.sh` + `scripts/install-phone.test.sh`, komentar `deploy/pm2/run` + `deploy/sv/panel/run`, `tests/env.schema.test.ts`                                                                                                                                                                                                                                                                                                                                                                                    | G0              | `sh scripts/package-release.test.sh`, `sh scripts/install-release.test.sh`, `env.schema`                                      |
| W1   | `wkr-init-copy-01`               | `src/cli/doctor.checks.base.ts` (`REINSTALL`), `src/cli/rollback.command.ts` (string saran saja), `src/cli/docs.command.ts`, `docs/cli/*.md` (resep `paket.md` sudah diperbarui `wkr-cli-plan-05` dari L2/L8; hanya teks `init`), `tests/cli.docs.test.ts`, `tests/cli.doctor.test.ts` + `tests/cli.rollback.test.ts` (hanya string saran), `src/web/i18n/id.landing.ts`, `src/web/landing/install.section.tsx`, `src/web/landing/steps.section.tsx`, `tests/web.landing.test.ts` (baris K24 dengan `cd && … --retry 3`)                                                                                                                                                                                                                                                                                                                                                                    | G0              | `cli.docs`, `cli.doctor`, `cli.rollback`, `web.landing`                                                                       |
| G1a  | `wkr-init-core-01` (dilanjutkan) | `src/cli/init.command.ts` saja: daftar langkah nyata menggantikan stub (urutan 0, 1, 2, 3, 3a, 4–11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W1 selesai      | semua `tests/cli.*`                                                                                                           |
| W2   | `wkr-init-shell-01`              | `scripts/cli.test.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | G1              | `bun run build:local && sh scripts/cli.test.sh dist/panel` di macOS                                                           |
| W3   | `wkr-docs-init-01`               | `README.md` (**semua** kemunculan `install.sh`/`install-phone.sh`, termasuk daftar test dan troubleshooting, bukan hanya bagian pasang/upgrade/rollback/rilis/deploy dev; deploy dev = `rsync --partial`; "ulangi seluruh baris"; bentrok folder clone; Rule 16 terbatas; di-merge bersama tag `v0.5.1`, E14), `CHANGELOG.md` `[0.5.1]` (Changed: `install.sh` diganti baris satu perintah + `panel init`; Removed: `install-phone.sh`; pengumuman penghapusan `install.sh`/tarball di 0.6.0), `package.json` (0.5.1)                                                                                                                                                                                                                                                                                                                                                                       | G2              | `bun test` penuh                                                                                                              |

Kontrak W0 (dibekukan sebelum W1): `InitStep = { id, detect(ctx): Promise<StepState>, plan(state): PlanLine[],
apply(ctx, state): Promise<void> }`; `InitContext = { host, args, mode: "fresh" | "upgrade" | "repair", out, tty }`
(`mode` dari `init.mode.ts`: data pengguna K7 + K20); `apply` melempar `CliExit` untuk exit 1/3/4. Aturan "langkah ini
boleh jalan di mode/TTY ini" (§4 tabel mode, K9, K21) ada di `init.command.ts`, bukan di tiap langkah: langkah yang
tidak boleh jalan hanya memanggil `plan` dan dicetak sebagai baris `⚠️` + perintah. `detect` dan `plan` tidak boleh menulis apa pun (`--dry-run` hanya
memanggil keduanya). Probe baru yang dibutuhkan worker W1 → lapor ke koordinator, `wkr-init-core-01` menambah jawaban
fake; worker W1 tidak menyunting `cli.host*.ts`.

Test shell W2 (binary hasil compile, mode fake, stdin `</dev/null`, HOME/PREFIX sementara): `init --help` memuat
`--ssh-key` dan `--skip-verify` dan **tidak** memuat `--downgrade`/`--port`/`--tunnel`; `init --downgrade` exit 2;
`PANEL_CLI_FAKE=fresh|fresh-pg|poco|upgrade init --dry-run` exit 0, rencana memuat baris yang diharapkan per skenario
(`fresh-pg` tanpa `pkg upgrade`), dan `find` HOME/PREFIX sesudah = sebelum; `PANEL_CLI_FAKE=downgrade init --dry-run`
exit 3 dengan saran `panel rollback`; build lokal → baris `build lokal: tidak dicek terhadap rilis`, tanpa permintaan
jaringan; `PANEL_RELEASE_TAG=v9.9.9` di env saat menjalankan binary lokal → tetap `build lokal` (tag hanya dari build);
`init --skip-verify` tanpa TTY exit 2; `init --ssh-key http://x` exit 2; `.env` dengan sentinel di cwd → sentinel tidak
muncul di stdout/stderr/perekam (D3).

Gerbang:

- **G0**: typecheck, lint, `bun test` lulus; kontrak di atas ada.
- **G1** (W1 + G1a): typecheck, lint, `bun test` penuh, test shell rilis lulus; review diff koordinator (empty catch,
  rahasia di log/pesan, batas baris Rule 8, tidak ada panggilan CLI `pm2`).
- **G2** (W2): `sh scripts/cli.test.sh dist/panel` lulus di macOS; `bun run build` (android) naik < 300 KB dari 0.5.0;
  `bun run bundle:check`; `workflow_dispatch dry_run` `release.yml` hijau (atas perintah pemilik untuk push).
- **G-lab**: fase 0 dan A–C §14 lulus (L1–L4, L7–L10; fase A dalam urutan C25, syarat keluar hold kembali), fase B
  hanya setelah Q15 dan Q16 dijawab pemilik, jalur Batal = `RESTORE.md` (§14); tunnel lab dibersihkan sebelum fase D;
  lalu fase D (L11) dengan `v0.5.1-rc.1`.
- **G3** (W3 + G-lab): checklist Rule 6 + laporan Rule 18; tag `v0.5.1` atas perintah pemilik; fase E.

## 17. Kriteria penerimaan 0.5.1

- [ ] **Termux bersih di POCO → satu baris (prarilis) → panel jalan**, tanpa perintah manual lain selain mengisi nilai
      OAuth Google (dan alamat/email saat ditanya) serta klik login Cloudflare di browser; dialog izin baterai Android
      dihitung ketukan, bukan perintah; satu `y` pada pertanyaan pemindahan DNS (hostname panel masih milik tunnel
      lama, §4.4) juga dihitung ketukan. Publik `https://<host panel>` menjawab, login Google berhasil, doctor 0 error.
- [ ] Setelah reboot HP: semua layanan (runit, panel, pm2, cloudflared, postgres) hidup tanpa aksi (L1).
- [ ] Cek diri: binary rilis yang diubah satu byte → exit 1, `panel.new` dihapus, tidak ada file lain yang ditulis;
      yang di-hash = salinan yang dipasang; pesan sukses menyebut "membuktikan unduhan utuh, bukan asal rilis"; build
      lokal ditandai info; tanpa jaringan → exit 1 kecuali `--skip-verify` di TTY; tidak ada panggilan `gh`.
- [ ] Upgrade POCO 0.5.0 → 0.5.1 lewat `init --yes` tanpa TTY: hanya daftar persis K21 berubah (`~/panel/panel`,
      `~/panel/panel.prev`, `$PREFIX/bin/panel` dibuat, run script panel hanya bila template lama dikenal + `.bak`, file
      unduhan dihapus, `~/panel-src/v[0-9]*` dipangkas); selain itu `find -newer` kosong kecuali log; tanpa paket,
      skrip boot, atau dialog baterai; panel di-restart dan sehat, pid pm2-runtime/makuro-solusi/cloudflared tidak
      berubah (L10); `panel.prev` = 0.5.0 (hard link, inode sama dengan `panel` lama).
- [ ] Pasang ulang di HP yang hostname panelnya masih milik tunnel lain: TTY → satu pertanyaan + pemetaan lama → baru,
      lalu `--overwrite-dns`; tanpa TTY → exit 3 dengan perintah persis, DNS tidak berubah.
- [ ] Termux berisi `PG_VERSION` tanpa `~/panel` → tidak ada `pkg upgrade` (test); resume instalasi baru yang terputus
      melanjutkan tanpa perintah manual (fase C).
- [ ] `init` kedua kali dengan binary sama: tidak ada file berubah, tidak ada restart, exit 0.
- [ ] Binary lebih lama → exit 3 dengan saran `panel rollback [--db]`; `--downgrade`, `--port`, `--tunnel` tidak ada
      (exit 2).
- [ ] `--dry-run` tidak menulis satu file pun (test unit + shell + L9).
- [ ] Rahasia tidak pernah muncul di stdout/stderr/log/argv/file state; token tunnel tidak lewat pipe (D4); environ
      runsvdir/runsv/pm2-runtime tanpa kunci `ENV_VARS` (L7).
- [ ] `--ssh-key` memulihkan `ssh poco` setelah wipe, sudah sebelum langkah PostgreSQL/`.env`/tunnel; tanpa flag itu
      sshd tidak dipasang/dinyalakan.
- [ ] `install.sh` 0.5.1 (shim) memanggil `init` dan meneruskan exit code; `install.sh` ≤ 0.5.0 dengan
      `PANEL_VERSION=v0.5.1` juga berakhir di `init`.
- [ ] Landing dan README hanya menampilkan baris K24; tidak ada `install.sh`/`install-phone.sh` di docs, CLI, atau
      landing (grep, mengecualikan `server-termux` di README yang merujuk proyek lain), kecuali catatan CHANGELOG.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, semua test shell, `bun run bundle:check` lulus di macOS dan CI
      ubuntu (tanpa Docker); ukuran binary naik < 300 KB.
- [ ] README, CHANGELOG `[0.5.1]`, `docs/cli/*` sinkron (Rule 16); makuro-solusi pulih publik 200 (fase E).
