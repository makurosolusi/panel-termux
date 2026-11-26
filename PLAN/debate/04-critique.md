# Kritik PLAN/04 — Keamanan data, keamanan akses & cadangan

Kritikus: `wkr-critic-04` · Branch `feature/production-polish` · 2026-11-26
Bahan yang dibaca: `PLAN/04` (seluruhnya), `R&D/04`, bagian terkait `PLAN/02`, `PLAN/03`, `PLAN/05`, serta kode `src/server/{index,secret,crypto.service,settings.service,env}.ts`, `src/server/http/api.handler.ts`, `src/server/backup/*`, `src/server/auth/*`, `src/server/system/postgres.termux.ts`, `scripts/install-phone.sh`, `deploy/sv/panel/run`, `main:src/server/routes/{origin.guard,api.routes}.ts`, Better Auth 1.7.28 di `node_modules`, README GitHub `actions/attest-build-provenance` dan `actions/attest`, dan sumber `cloudflare/cloudflared` (lewat `gh api`).

## 1. Ringkasan penilaian

**Verdict: siap dengan revisi, kecuali §4 F11 (runbook HP baru) dan K8 (kunci data) yang perlu ditulis ulang.**
Arah PLAN ini benar: retensi berbasis catatan, cakupan cadangan yang jujur, verifikasi sebelum unggah, mode kunci tidak cocok yang tidak merusak, dan guard CSRF sebelum rate limit. Ada dua cacat yang bisa merugikan pemilik:
(1) model `secret_check` membuat status "Cocok" bohong setelah pemilik mengisi ulang satu setting rahasia saat mismatch;
(2) runbook pemulihan ke HP baru dengan `include_secrets=off` gagal di beberapa langkah bila dijalankan persis seperti tertulis.
Ada juga beberapa celah retensi (run `partial` tidak pernah di-prune, item `secrets` disimpan selamanya setelah dimatikan, DB uji ikut dicadangkan) dan kontrak yang tidak cocok dengan PLAN/02, 03, dan 05 (notifier, snapshot, nama aset rilis, pola exclude).
Jumlah: **2 BLOCKER, 11 MAJOR, 10 MINOR, 2 OVER.**

---

## 2. Temuan

### C1 — BLOCKER · data/flow · Status kunci data dari `secret_check` bisa bohong

- **Klaim di PLAN**: K8 dan F7.6: "Ada `secret_check`: sama → `ok`, beda → `mismatch`", lalu "Bila file lama dikembalikan, status otomatis `ok` lagi". F8.3 menyebut bahwa selama mismatch "Pengaturan menampilkan key rahasia sebagai 'Tidak bisa dibaca'" tetapi tidak melarang menyimpan nilai baru.
- **Masalah**: `setSetting` (`settings.service.ts:220-231`) selalu mengenkripsi dengan secret yang sedang dipakai. Skenarionya begini:
  1. `data/secret` hilang. Secret baru dibuat dan status menjadi `mismatch`.
  2. Pemilik mengisi ulang kunci S3 di Pengaturan agar cadangan jalan lagi. Baris S3 sekarang terenkripsi dengan **secret baru**, sedangkan `cloudflare.api_token` masih terenkripsi dengan secret lama.
  3. Pemilik menemukan file lama dan mengembalikannya (jalan A yang disarankan F8). Saat boot, `secret_check` cocok dengan secret lama, jadi status `ok`. Padahal baris S3 sekarang tidak bisa didekripsi, `getSetting` melempar (`settings.service.ts:192-196`), dan cadangan gagal dengan status "Cocok".
     Kebalikannya juga terjadi: bila pemilik memakai jalan B, `secret_check` ditulis ulang, tetapi baris yang diisi di langkah 2 tetap aman. Jadi satu nilai hash tidak bisa mewakili campuran baris yang dienkripsi dengan dua kunci berbeda.
- **Usulan**: Hapus `secret_check` dan HKDF info `key-check/v1`. `dataKeyState` cukup mencoba `decryptSecret` pada setiap baris setting rahasia. Jumlahnya ≤ 10 baris (S3 ×2, Cloudflare, Telegram PLAN/02), dan AES-GCM gagal secara deterministik bila kuncinya salah. Hasilnya `unreadable: SettingKey[]` yang tepat dan tidak bisa basi. Panggil saat boot dan di `GET /api/dev/security` / `backups/status`, atau cache sampai ada `setSetting`/reset. Selama `unreadable.length > 0`, `setSetting` untuk key rahasia yang **tidak terbaca** ditolak dengan 409 `key_mismatch`. Satu-satunya jalan adalah reset (B) atau mengembalikan file (A), sehingga keadaan campuran tidak pernah terjadi. Kasus "file secret diganti tetapi belum ada setting rahasia" tidak merusak apa pun (tidak ada yang hilang), jadi tidak perlu dideteksi. Test: mismatch → simpan S3 → 409; kembalikan file → `ok` dan semua key terbaca.

### C2 — BLOCKER · flow · Runbook F11 "Pulihkan ke HP baru" tidak bisa dijalankan seperti tertulis (`include_secrets=off`)

Saya menelusuri F11 langkah demi langkah di HP baru. Pemilik hanya punya bucket, akun Google, dan akun Cloudflare, tanpa file kunci data unduhan.

| Langkah F11                                            | Yang terjadi                                                                                                                                                                                                                                                                                                                                                          | Bukti                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1 Pasang paket + panel, `.env` dikosongkan             | Installer membuat `$SVDIR/panel/down` dan keluar (`install-phone.sh:63-70`). OK. Tetapi **Postgres belum diinisialisasi**: tidak ada `initdb`, service `postgres`, atau role `postgres`. README `:28` dan `postgres.termux.ts:6-9` berasumsi role `postgres` sudah ada. Di cluster Termux baru, superuser bootstrap adalah user Termux (`u0_aNNN`), bukan `postgres`. | installer tidak menyentuh Postgres |
| 2 Unduh folder run dari bucket (`rclone`/dashboard R2) | Butuh kredensial R2. Kredensial lama ada di `panel.db` dalam keadaan terenkripsi (tidak terbaca) atau di HP lama. Runbook tidak menyebut "buat token R2 baru (read)". "Folder run" sebenarnya folder **hari** (`runKeyStem` = `<prefix>yyyy-mm-dd/HHMMSS-`, `backup.config.ts:73-75`) dan bisa berisi beberapa run, jadi pemilik harus memilih stem.                  |                                    |
| 2 "Cek `sha256sum` terhadap `manifest.json`"           | `sha256sum -c` tidak bisa membaca JSON. Pemilik harus menulis sendiri perintah `jq`.                                                                                                                                                                                                                                                                                  | K5                                 |
| 3 Kunci                                                | Tanpa item `secrets` dan tanpa unduhan, secret baru dibuat saat boot → mismatch → **reset F8-B wajib**. F11 hanya menyebut F8-B di langkah 10 (kasus HP dicuri).                                                                                                                                                                                                      |                                    |
| 3 "isi `.env` baru"                                    | Tidak dijelaskan isinya: `APP_BASE_URL` harus sama persis (redirect URI Google), `SUPER_ADMIN_EMAILS`, dan `GOOGLE_CLIENT_SECRET` (bila secret lama tidak tersimpan, buat client secret baru di Google Console).                                                                                                                                                      | `env.ts`                           |
| 4 `panel.db`                                           | Aman hanya bila panel belum pernah start. Bila pemilik menjalankan ulang installer setelah mengisi `.env` (langkah yang diminta PLAN/05 §568), panel langsung start (`sv restart`) dan membuat `panel.db` + `secret` kosong **sebelum** langkah 4. Lalu `cp` menimpa DB yang sedang dibuka (WAL). Runbook tidak menyebut `sv down panel`.                             | `install-phone.sh:73-79`           |
| 5 `psql -U postgres -d postgres -f globals.sql`        | Gagal di cluster baru karena role `postgres` belum ada, dan error itu tidak "wajar". Harus dijalankan sebagai superuser bootstrap (`psql -d postgres -f globals.sql`).                                                                                                                                                                                                |                                    |
| 7 "deploy ulang binary tiap situs **dari panel**"      | Panel baru dinyalakan di langkah 9, jadi urutannya terbalik. Binary juga tidak dicadangkan. Bila pemilik tidak menyimpan artefak build, situs tidak bisa dipulihkan, dan hal ini tidak diperingatkan di UI (C20). `sites.dir` bisa berbeda dari `~/sites` (setting `sites.dir`).                                                                                      | `settings.service.ts:78-89`        |
| 8 cloudflared                                          | `cloudflared tunnel token --cred-file` memang ada. Saya memverifikasinya di `cmd/cloudflared/tunnel/subcommands.go` dengan catatan "only works for tunnels created since 2022.3.0". Tetapi bila **HP lama masih hidup** (pindah HP, bukan hilang), dua konektor melayani tunnel yang sama dan trafik terbagi. Langkah "matikan cloudflared di HP lama" tidak ada.     |                                    |
| 9 `sv up panel`                                        | File `down` dari langkah 1 tetap ada, jadi **panel tidak start setelah reboot berikutnya**. `pm2 start` dijalankan sebelum binary ada, sehingga semua app errored.                                                                                                                                                                                                    | `install-phone.sh:66-70`           |
| –                                                      | Token Telegram (PLAN/02 `alerts.telegram_bot_token`, rahasia) dan token Cloudflare juga harus diisi ulang setelah reset, tetapi tidak disebut.                                                                                                                                                                                                                        |                                    |

- **Masalah**: Tujuan (a) PLAN ini adalah "cadangan cukup untuk membangun ulang seluruh server di HP baru", dan kriteria operasional mengizinkan "minimal langkah 5–7". Akibatnya langkah yang paling rawan (Postgres bootstrap, urutan panel.db/.env/installer, `down` file, reset kunci) tidak pernah diuji.
- **Usulan**: Tulis ulang F11 sebagai urutan yang bisa disalin:
  0. Bila HP lama masih hidup: `sv down cloudflared` di sana.
  1. `pkg install …`, `initdb "$PREFIX/var/lib/postgresql"`, `sv-enable postgres`, `createuser -s postgres`.
  2. Buat token R2 read-only, unduh satu stem (semua file `HHMMSS-*`), lalu `sha256sum -c HHMMSS-SHA256SUMS` (lihat C13).
  3. Pasang panel dengan installer dan biarkan `.env` kosong (service `down`).
  4. Salin `panel.db` (+ `secret` bila ada) ke `~/panel/data/`.
  5. Isi `.env` (daftar variabel + catatan Google secret).
  6. `psql -d postgres -f globals.sql` sebagai superuser bootstrap, lalu `pg_restore --create` per DB.
  7. Ekstrak `sites` dan `cloudflared` ke path dari manifest (C13), lalu buat kredensial tunnel.
  8. Jalankan ulang **installer** (menghapus `down` + health check), bukan `sv up`.
  9. Login, lalu reset F8-B dan isi ulang token Cloudflare, S3, dan Telegram.
  10. Deploy binary tiap situs, lalu `pm2 save`.
      Simpan runbook ini juga di `manifest.restoreSteps` (teks) agar bisa dibaca dari bucket tanpa README. Kriteria operasional: C12.

### C3 — MAJOR · flow/data · Run `partial` tidak pernah memicu prune, jadi bucket tumbuh tanpa batas

- **Klaim**: K3 dan F2.7 "Hanya bila `succeeded` → planPrune". F3.6 mengakui bahwa "DB yang selalu gagal → … tidak pernah prune → penyimpanan tumbuh".
- **Masalah**: Kegagalan permanen adalah keadaan normal yang **direncanakan PLAN ini sendiri**: `too_large` (K7, DB > 2 GB), `insufficient_space`, atau `globals` gagal karena role tidak trust (F2.9). Satu item yang selalu gagal membuat retensi mati untuk **semua** item, sehingga biaya R2 naik setiap hari dan akhirnya kuota bucket penuh, lalu semua cadangan gagal. Padahal proteksi `protectedItems` (item ok terbaru per (kind,name)) sudah menjamin item yang gagal tetap punya salinan valid terakhir. Syarat "hanya succeeded" tidak menambah keamanan.
- **Usulan**: Prune setelah run `succeeded` **atau** `partial`, tetapi tidak setelah `failed`. `protectedItems` + `protectedRuns` tetap seperti sekarang. Ubah test acceptance "run partial tidak pernah memicu prune" menjadi "run partial memangkas item lama, tetapi item `b` terakhir yang ok tetap ada".

### C4 — MAJOR · security/data · Item `secrets` disimpan selamanya setelah `include_secrets` dimatikan

- **Klaim**: F3.2 "`protectedItems` = untuk tiap (kind,name) … item ok terbaru (dari run berstatus apa pun)".
- **Masalah**: Pemilik menyalakan `include_secrets` sekali (mis. saat pindah HP), lalu mematikannya. Item `secrets` terakhir menjadi "item ok terbaru untuk (secrets, secrets)" dan **dilindungi selamanya**. `data/secret` + `.env` + kredensial tunnel tetap ada di bucket, padahal pemilik mengira sudah dimatikan. Ini kebalikan dari maksud K4. Hal serupa terjadi pada dump DB situs yang sudah dihapus: PII tersimpan selamanya (F3.6), dan itu sudah dicatat.
- **Usulan**: Bila `include_secrets=off`, item `secrets` tidak termasuk `protectedItems`, sehingga terhapus oleh umur normal. Saat switch dimatikan, dialog PLAN/05 menawarkan "Hapus juga cadangan kunci rahasia yang sudah ada sekarang" (aksi `applyPrune` untuk semua item `secrets`). Test: on → run → off → run setelah R hari → objek `secrets` dihapus.

### C5 — MAJOR · flow/security · Database hasil "Pulihkan ke database baru" ikut dicadangkan dan bisa terhapus setelah dipakai

- **Klaim**: F5 dan copy `restores.useHint`: "Untuk memakainya, ganti nama database di DATABASE_URL situs". F5.7: "Hapus database uji … hanya untuk nama yang tercatat di `backup_restore`, jadi tidak pernah menyentuh DB situs".
- **Masalah**:
  1. `listDatabases` (`postgres.termux.ts:14-16`) hanya mengecualikan template dan `postgres`. `app_r202611261230` ikut di-dump setiap malam, muncul di `lastGood` dengan badge stale, dan setelah dihapus dilindungi retensi selamanya (F3.6).
  2. `useHint` sendiri mengajak pemilik **mempromosikan** DB uji menjadi DB produksi. Setelah itu tombol "Hapus database uji" masih ada di halaman Cadangan dan akan `DROP … WITH (FORCE)` database yang sedang dipakai situs. Klaim "tidak pernah menyentuh DB situs" tidak benar setelah promosi.
- **Usulan**: (a) Item `database` dilewati di run bila namanya ada di `backup_restore` dengan `dropped_at IS NULL` **dan** tidak dipakai situs mana pun. (b) Sebelum drop, cek apakah ada situs yang memakai DB itu (kolom database situs di `site.schema`, atau `DATABASE_URL` `.env` lewat PLAN/03). Bila dipakai → 409 `in_use` dengan copy "Database ini sekarang dipakai situs X". (c) Bila pemilik tetap ingin mendukung promosi, ubah `useHint` menjadi aksi eksplisit di P2. Untuk P1, cukup tulis "Untuk dipakai situs, hubungkan lewat halaman situs. Database yang dipakai situs tidak bisa dihapus dari sini."

### C6 — MAJOR · security · Syarat "sesi segar 15 menit" bisa dilewati, dan nilainya perlu ditulis jujur

- **Klaim**: K14 dan §3.4: hanya `data-key/export` dan `data-key/reset` yang butuh sesi segar.
- **Masalah**: Ada empat jalan lain dengan kekuatan yang sama dan tanpa syarat segar, sehingga syarat itu tidak melindungi apa pun terhadap cookie super_admin yang dicuri:
  - Menyalakan `backup.include_secrets` → `POST /backups/run` → unduh item `secrets` (super_admin, F4). Hasilnya `data/secret` didapat.
  - Mengganti `backup.s3_endpoint/bucket` ke bucket penyerang. Run berikutnya mengunggah `panel.db`, semua dump, dan `.env` situs.
  - Mengubah peran / `SUPER_ADMIN_EMAILS` (tidak bisa lewat UI). Bagian ini sudah aman.
    Secara teknis cek `createdAt` cocok dengan semantik `freshSessionMiddleware` Better Auth (`better-auth/dist/api/routes/session.mjs:334-345` memakai `session.createdAt`, default `freshAge` 86400). `signIn.social` membuat **sesi baru**, jadi re-auth memang mungkin. Tetapi Google sering melewati layar login bila browser masih login Google. Jadi "segar" berarti "pemegang cookie juga memegang sesi Google di browser itu". Itu berguna melawan cookie yang dicuri ke mesin lain, tetapi tidak melawan perangkat yang tertinggal tanpa kunci. Selain itu, setiap re-auth meninggalkan baris sesi lama sampai kedaluwarsa.
- **Usulan**: Terapkan `assertFresh` juga pada: unduh item `secrets`, `setSetting` untuk `backup.include_secrets` → on, `backup.s3_endpoint`, `backup.s3_bucket`, dan `backup.prefix`. Kontrak ke PLAN/05 harus memetakan 403 `reauth_required` di form Pengaturan. Saat re-auth berhasil, hapus sesi lama (`revokeSessionsExcept` milik user itu dibatasi ke sesi sebelum callback), atau biarkan dan catat. Di docs: "Sesi segar mencegah pemakaian cookie curian, bukan akun Google yang diambil alih" (lihat C19).

### C7 — MAJOR · kontrak · Event notifikasi dan `Problem` tidak cocok dengan PLAN/02

- **Klaim**: §3.7: `notify({ type, target, at })` dengan `type` ∈ `backup.failed | backup.partial | backup.recovered | security.key_mismatch`, file `backup.events.ts`, `ProblemKind` + `"security"`, dan "Bila PLAN/02 mengganti `message` menjadi kode…".
- **Masalah**: PLAN/02 K11 **menolak** "kirim per event". Mesinnya merekonsiliasi `Problem` per kunci `code:target` di `problem_event`, dan pesan Telegram berasal dari Problem yang buka/tutup. PLAN/02 tidak punya API `notify()` (PLAN/02:1042: "jangan buat kanal kedua"). PLAN/02 K2 juga sudah memutuskan bahwa `Problem = { id, code, kind, target, severity, params, since, href }` tanpa `message`, jadi frasa "bila" sudah basi. `ProblemKind` di PLAN/02:85 belum memuat `"security"`. Ada juga masalah tambahan: notifikasi `key_mismatch` lewat Telegram **tidak bisa dikirim** tepat saat dibutuhkan, karena `alerts.telegram_bot_token` adalah setting rahasia (PLAN/02 §3.6) yang juga tidak terbaca saat mismatch.
- **Usulan**: Hapus `backup.events.ts` dan tipe event. `backupProblems`/`securityProblems` mengembalikan `Problem` dengan `code` + `params` (format PLAN/02). "recovered" otomatis terjadi saat Problem tertutup. Minta PLAN/02 menambah `"security"` ke `ProblemKind` secara tertulis. Tulis jujur di copy/README bahwa kunci data tidak cocok hanya terlihat di panel, karena token Telegram ikut terkunci. Jangan memindahkan token Telegram keluar dari enkripsi hanya demi notifikasi ini.

### C8 — MAJOR · kontrak · Snapshot, aset rilis, dan action attestation bertentangan dengan PLAN/05

- **Klaim**: K9 (snapshot di boot, alternatif "di `install-phone.sh`" ditolak), K19 (`actions/attest-build-provenance`, worker `wkr-release-ci` memegang `release.yml`), §7 ("nama aset rilis `panel-android-arm64` + `SHA256SUMS`").
- **Masalah**:
  - PLAN/05:569 dan :868 menulis "[DEP PLAN/04] snapshot `panel.db` sebelum upgrade dijalankan di `install-phone.sh`". Akibatnya bisa terjadi dua snapshot atau tidak ada sama sekali.
  - PLAN/05 K12 dan :421 memakai aset `panel-termux-android-arm64.tar.gz`, `install.sh`, dan `SHA256SUMS` (berisi tarball, bukan binary). PLAN/04 menyebut binary mentah. Bila installer PLAN/05 mengecek checksum tarball sementara `release.yml` PLAN/04 membuat checksum binary, `sha256sum -c` gagal.
  - Attestation: README `actions/attest-build-provenance` (diverifikasi lewat `gh api`) menulis "As of version 4 … simply a wrapper on top of `actions/attest` … new implementations should use `actions/attest`". Versi terbaru keduanya v4.2.2 (Agustus 2026). PLAN/05 sudah memilih `actions/attest`. Attestation hanya tersedia untuk repo **publik** di plan Free/Pro/Team. Repo `makurosolusi/panel-termux` saat ini `PUBLIC` (dicek), jadi aman, tetapi syarat ini perlu dicatat. Izin yang wajib (`id-token: write`, `attestations: write`, `contents: write` untuk `gh release create`) tidak ditulis di K19. `subject-checksums: SHA256SUMS` bisa langsung mengatestasi semua aset.
  - Dua PLAN sama-sama merasa memiliki `release.yml`.
- **Usulan**: Satu pemilik `release.yml`/`package-release.sh` (PLAN/05). PLAN/04 cukup memberi review keamanan + daftar langkah gate (frozen lockfile, audit, typecheck, lint, test, build). Pakai `actions/attest@<sha>` dengan `subject-checksums`, tulis blok `permissions` minimal per job, dan nama aset mengikuti PLAN/05. Snapshot tetap di boot (alasan K9 benar: konsisten dan juga mencakup upgrade manual tanpa installer), lalu perbaiki teks PLAN/05 menjadi "installer tidak membuat snapshot; panel membuatnya saat boot; installer hanya mencetak lokasi snapshot terbaru untuk rollback".

### C9 — MAJOR · data · Pola `--exclude` tar bisa diam-diam membuang data situs, dan nama file PLAN/03 terlewat

- **Klaim**: F2.4 `archive.create(file, sitesDir, ["."], ["./*/app", "./*/app.prev", "*/node_modules", "*.panel-tmp"])`.
- **Masalah**:
  - Default GNU tar untuk `--exclude` adalah `--wildcards --no-anchored --wildcards-match-slash`, yaitu `*` ikut mencocokkan `/` dan pola bisa cocok di kedalaman mana pun. Akibatnya `./*/app` juga bisa cocok dengan `./toko/data/app` atau `./toko/data/uploads/app`, yaitu **data pengguna**, tanpa error. Item tetap `ok` + `verified` karena `tar -tzf` sukses.
  - PLAN/03:1278 meminta pengecualian juga untuk `app.new`, `.app.prev.drop`, dan `.app.swap` (binary 89 MB sementara saat deploy). Pola PLAN/04 tidak memuatnya, jadi cadangan yang berjalan saat deploy menyedot ratusan MB.
  - Test acceptance hanya memeriksa bahwa `*/app` **tidak ada**, bukan bahwa data bernama `app` **tetap ada**.
- **Usulan**: Bangun daftar entri di kode: `readdir(sitesDir)` → per situs `readdir` → buang nama di set `{app, app.prev, app.new, .app.prev.drop, .app.swap, node_modules}` **hanya di level 1**, lalu `tar -czf f -C sitesDir <entri…>` (ditambah `apps.json`, `ecosystem.config.js`). Tidak perlu pola glob. Ambil set nama dari konstanta yang diekspor PLAN/03. Test: `sites/a/data/app/x.txt` ada di arsip, `sites/a/app` tidak.

### C10 — MAJOR · kontrak · Audit dan situs: permintaan PLAN/03 dan PLAN/05 tidak dijawab

- **Masalah**:
  - PLAN/05:868 meminta `AuditAction` diekspor ke `src/shared`, aksi `setup.update` dan `backup.verify`, serta `listAudit` dengan `action` **berulang**. PLAN/04 §3.4 hanya menerima satu `action` (exact/prefix) dan menunda "aksi yang diminta PLAN lain" ke gelombang berikutnya.
  - PLAN/05:343 meminta `beat("backup_scheduler", …)` di `backup.service.ts`, sementara PLAN/04 gelombang 2 memecah file itu.
  - PLAN/05:721 meminta `describe()` diekspor.
  - PLAN/03 meminta `lastSuccessfulBackupOf(database)`, sedangkan PLAN/04 menawarkan `BackupStatus.lastGood` (bentuknya berbeda: PLAN/03 butuh per DB, sinkron, di server).
- **Usulan**: Tambahkan baris eksplisit di tabel ketergantungan PLAN/04 §7 yang menerima atau menolak tiap permintaan. Saran saya: terima semuanya karena kecil. `lastSuccessfulBackupOf` = filter dari fungsi yang sama dengan `lastGood`. `beat` dipasang di `backup.scheduler.ts` hasil pecahan. `AuditAction` dipindah ke `src/shared/audit.types.ts` oleh `wkr-safety-audit`.

### C11 — MAJOR · rencana kerja · Kepemilikan file lintas PLAN bentrok di gelombang 1

- **Klaim**: §7 "Gelombang 1 paralel penuh"; satu pemilik `drizzle/` per gelombang adalah `wkr-safety-audit`.
- **Masalah**: Dalam gelombang yang sama, file-file ini juga dipegang worker PLAN lain:
  - `src/server/index.ts`: `wkr-mon-sampler-02` (PLAN/02:972), `wkr-adm-seo-01` (bersyarat), PLAN/01:961.
  - `settings.service.ts`: PLAN/02 (6 key) dan refactor registri PLAN/05.
  - `api.routes.ts`: PLAN/02 dan PLAN/03.
  - `drizzle/`: `wkr-sites-contract-01` (PLAN/03:1232) dan tabel `problem_event` PLAN/02.
    Snapshot meta drizzle (`meta/_journal.json`, `NNNN_snapshot.json`) membentuk rantai, jadi dua `db:generate` paralel **tidak bisa** di-merge tanpa regenerasi. Aturan "satu pemilik per gelombang" hanya ditulis di PLAN/04 dan tidak disetujui PLAN/03.
- **Usulan**: Orkestrator menetapkan satu urutan migrasi global (mis. 0006 PLAN/04, 0007 PLAN/03, 0008 PLAN/02) dan mengerjakannya **berurutan** oleh satu worker "schema", atau tiap PLAN menyerahkan diff skema Drizzle ke worker itu. Untuk `index.ts`, `settings.service.ts`, dan `api.routes.ts`: tetapkan satu pemilik per gelombang. Worker lain menitipkan potongan < 10 baris lewat spec. Tulis tabel ini di PLAN/04 §7 agar worker tidak menebak.

### C12 — MAJOR · test · Kriteria DR terlalu lemah untuk tujuan (a)

- **Klaim**: §6 Operasional: "Runbook F11 dicoba sekali ke HP/emulator kedua (atau minimal langkah 5–7 ke Postgres lokal kedua)".
- **Masalah**: Langkah 5–7 adalah bagian yang paling tidak rawan. Kegagalan nyata ada di langkah 1, 3, 4, 8, dan 9 (C2). Tanpa latihan penuh, rilis v0.3.0 menjanjikan "pulih ke HP baru" yang belum pernah terbukti. Industri (Coolify/Railway) juga tidak menganggap backup valid tanpa restore drill.
- **Usulan**: Gate rilis v0.3.0: satu latihan penuh F11 dengan `include_secrets=off` di HP/emulator kedua. Hasilnya dicatat sebagai checklist di CHANGELOG: situs X merespons via hostname, DB X berisi N baris, peran super_admin aktif, token diisi ulang, panel start sendiri setelah reboot. Tambah test otomatis: manifest + `SHA256SUMS` hasil run mock lolos `sha256sum -c` di temp dir.

### C13 — MAJOR · data · Manifest kurang informasi yang dibutuhkan saat DR

- **Klaim**: K5 `BackupManifest` (format, versi panel, schema, item, excluded, restoreOrder).
- **Masalah**: Saat HP hilang, manifest adalah satu-satunya hal yang bisa dibaca. Yang belum ada:
  - path tujuan (`dataDir`, `sites.dir` yang bisa non-default, `~/.cloudflared`);
  - versi server Postgres (`pg_restore` lama menolak dump dari versi baru: "unsupported version in file header");
  - `APP_BASE_URL` host (harus sama untuk OAuth) dan UUID tunnel;
  - daftar situs → binary yang harus di-deploy ulang;
  - file checksum yang bisa dibaca `sha256sum -c` (lihat C2).
- **Usulan**: Tambah `paths: { dataDir, sitesDir, cloudflaredDir }`, `postgresVersion`, `appHost`, `tunnelId`, `sitesNeedingBinary: string[]`. Unggah juga `<stem>SHA256SUMS` (format `hash  nama`) sebelum manifest. Semua nilai ini bukan secret.

### C14 — MINOR · data · Urutan item membuat `panel.db` hasil pulih tidak mengenal sebagian objek run-nya sendiri

- **Masalah**: Urutannya `globals → DB → panel → sites → cloudflared → secrets → manifest`. Snapshot `panel.db` diambil di tengah run, saat baris run masih `running` dengan item sampai DB terakhir saja. Setelah DR, run itu ditandai `failed: interrupted` (`backup.service.ts:56-59`), dan objek `sites`/`cloudflared`/`manifest` run itu menjadi yatim yang tidak pernah di-prune (K3).
- **Usulan**: Letakkan `panel` tepat sebelum `manifest`. Sisa yatimnya hanya `panel.db` + manifest itu sendiri. Dokumentasikan bahwa run terakhir akan tampil "terputus" setelah DR, dan bahwa itu wajar.

### C15 — MINOR · UI · "Terverifikasi" melebih-lebihkan

- **Masalah**: `pg_restore --list` hanya membaca TOC dump, tidak membaca blok data. `tar -tzf` membaca seluruh isi, jadi itu valid. Badge "Terverifikasi" pada dump DB membuat pemilik merasa sudah aman tanpa uji pemulihan.
- **Usulan**: Ganti copy menjadi "Diperiksa" + `title` "Struktur file dicek sebelum diunggah. Bukti bisa dipulihkan: Uji pemulihan." Tampilkan "Uji pemulihan terakhir" di samping, seperti yang sudah direncanakan.

### C16 — MINOR · data · Urutan "terbaru" memakai jam dinding

- **Masalah**: `protectedRuns`, `lastGood`, dan stale 36 jam diurutkan berdasarkan `startedAt`. Bila jam HP sempat maju (mis. 2030) lalu dikoreksi, run berlabel 2030 dianggap "terbaru" selama bertahun-tahun. `lastGood` menunjuk cadangan lama dan peringatan stale tidak pernah muncul. Risikonya kecil karena SigV4 menolak selisih jam > 15 menit (`RequestTimeTooSkewed`), sehingga run dengan jam salah biasanya gagal total dan tidak ada yang di-prune. Itu bagus dan perlu ditulis.
- **Usulan**: Urutkan dengan `rowid`/urutan insert, bukan `startedAt`. Tolak `start()` dengan `log.warn` bila `now < startedAt` run terakhir. Satu test murni untuk `planPrune` dengan jam mundur.

### C17 — MINOR · security/flash · Audit `auth.sign_in_failed` dari endpoint publik

- **Masalah**: `/api/auth/callback/google?error=x` publik. Rate limit 10/menit itu **per IP**, sedangkan botnet atau Cloudflare memberi IP berbeda. Setiap hit menulis baris SQLite yang disimpan 365 hari di flash HP. Nilai forensiknya kecil karena aktornya selalu "sistem".
- **Usulan**: Cukup `log.warn` dengan penghitung per menit, tanpa baris audit. Atau agregasikan menjadi satu baris per jam `{ count }`.

### C18 — MINOR · fakta/flow · Detail guard CSRF

- **Masalah**:
  - Prasyarat gelombang 0 ("merge `fix/csrf-origin` → main") sudah selesai: `main` = `112de15` dan sudah di produksi.
  - Klaim "Di hotfix, `createApiHandler` sudah mengambil kuota…" kurang tepat: `main` tidak punya `src/server/http/api.handler.ts` (dicek dengan `git show`). DoS kuota baru muncul **setelah** main di-merge ke branch ini (`api.handler.ts:99-103` di branch ini). Kesimpulan K1 tetap benar.
  - `tests/csrf.origin.test.ts` dari main memanggil jalur Elysia `.onRequest` dan akan gagal setelah guard dipindah. Test ini harus dimigrasi secara eksplisit.
  - `log.warn('[csrf] …')` per request: halaman situs bisa memicu ribuan baris per menit (log ke flash).
  - Tanda tangan sekarang `createApiHandler(api, { https })` (`api.handler.ts:92`); PLAN mengubahnya menjadi `{ appBaseUrl }`. Itu OK, tetapi `servePanel` perlu disebut sebagai pemanggil.
- **Usulan**: Perbarui gelombang 0 menjadi "merge main → branch". Throttle log csrf (satu baris per origin per menit + jumlah). Masukkan `tests/csrf.origin.test.ts` ke file milik `wkr-safety-http`.

### C19 — MINOR · security · Threat model belum memuat aktor yang paling mungkin

- **Masalah**: §8.4 tidak punya baris untuk:
  - **Akun Google super_admin diambil alih**. Ini jalan ambil alih total yang paling murah: login terbuka, sesi segar didapat otomatis, unduh kunci data, nyalakan `include_secrets`. Access dengan IdP Google yang sama tidak menambah faktor.
  - **Binary situs yang disusupi** (dependency situs). Binary berjalan dengan uid Termux yang sama, sehingga bisa membaca `data/secret`, `panel.db`, dan kunci S3, lalu menghapus cadangan. Ini bukan "Admin".
  - **HP dicuri** sudah tercakup, tetapi mitigasi "token R2 tanpa delete" dibiarkan P2 padahal itu satu-satunya pelindung cadangan dari pencuri.
- **Usulan**: Tambah dua baris itu dengan sisa risiko yang jujur. Mitigasi murah untuk Google: README "aktifkan 2-Step/passkey di akun super admin" dan kebijakan Access dengan faktor kedua (One-time PIN ke email lain atau Device posture). Tambah Problem `info`/notifikasi PLAN/02 saat `secret.export`, `include_secrets` → on, atau `backup.s3_endpoint/bucket` berubah. Untuk binary situs: tulis jujur di `adminTrust` ("program situs juga bisa membaca kunci panel").

### C20 — MINOR · UI/copy · Kejujuran tentang apa yang tidak bisa dipulihkan

- **Masalah**:
  - §5.1 "Isi cadangan (daftar jenis)" tidak menampilkan `excluded` (binary situs, `cert.pem`, kunci rahasia bila off).
  - `resetBody` hardcode "Token Cloudflare dan kunci penyimpanan cadangan", padahal token Telegram juga ikut terhapus. Daftarnya seharusnya dari `unreadableSettings`.
  - Teks file kunci data memakai `sv down panel` tanpa `SVDIR=`, bertentangan dengan acceptance `restoreHint` sendiri.
  - Peringatan bahwa unduhan kunci data biasanya masuk ke folder Downloads yang sering tersinkron ke Google Drive belum ada.
- **Usulan**: Tambah baris "Tidak dicadangkan" (dari `excluded`). Saat `includeSecrets=off && exportedAt=null`, tampilkan warning "Tanpa kunci data, token Cloudflare, S3, dan Telegram harus diisi ulang setelah pindah HP." Sertakan baris "Binary situs tidak dicadangkan, simpan file build-nya". `resetBody` dibuat dari daftar key. Tambah `SVDIR=$PREFIX/var/service` di teks file kunci. `exportBody` + "Pindahkan dari folder Unduhan ke pengelola kata sandi, lalu hapus".

### C21 — MINOR · data · Perkiraan ruang dan peringatan item

- **Masalah**: K7 memperkirakan 0 byte untuk `sites`/`cloudflared`/`secrets`, sehingga arsip situs ber-`data/` besar bisa memenuhi disk dengan cadangan hanya 256 MB. `tar` exit 1 ("file changed", SQLite situs sedang ditulis) dicatat "ok dengan warning", tetapi `BackupItem` tidak punya field `warning`, jadi peringatan itu hilang dari UI.
- **Usulan**: Perkiraan = `sizeBytes` item yang sama di run sukses terakhir (0 bila belum ada). Tambah `warning: string | null` ke `BackupItem` dan tampilkan badge "Disalin saat berubah" di riwayat.

### C22 — MINOR · kejelasan · Tabel keputusan rusak

- **Masalah**: Baris K12 dan K18 di §2 terpotong karena karakter `|` di dalam backtick (`user|system|unknown`, `/api/panel|dev`) dibaca sebagai pemisah kolom. Kolom Alternatif dan Alasan bergeser, jadi worker bisa salah membaca.
- **Usulan**: Escape (`\|`) atau tulis "user / system / unknown".

### C23 — MINOR · flow · Snapshot pra-migrasi: ketersediaan vs keamanan

- **Klaim**: K9 / risiko 5: snapshot gagal → `exit(1)`.
- **Masalah**: Migrasi tertunda hanya terjadi tepat setelah binary diganti, jadi biasanya saat pemilik sedang menjalankan installer. Itu wajar diblokir. Pengecualiannya: installer `die` setelah `mv` binary (mis. `sv restart` gagal), lalu HP reboot tanpa diawasi. Panel kemudian masuk crash-loop runit sekitar 1×/detik. Setiap putaran mencoba `VACUUM INTO` lagi (file parsial bisa tertinggal dan memperparah disk penuh), menulis log ke flash, dan menguras baterai. Pemilik yang hanya punya browser tidak bisa memperbaikinya.
- **Usulan**: Pertahankan blokir. Tambahkan: hapus file snapshot parsial saat gagal, `sleep 60` sebelum `exit(1)` agar loop melambat, dan preflight di installer (ruang bebas ≥ 2 × ukuran `panel.db` + 256 MB sebelum `mv`). Pesan health-fail installer menyebut `panel.prev` + `PANEL_SKIP_SNAPSHOT=1`. Cukup itu, tidak perlu mode aman.

### C24 — OVER · data/UI · Tiga dari empat setting baru sebaiknya konstanta

- **Klaim**: §3.3 `backup.keep_min_runs` (1–30), `backup.max_item_mb` (10–20480), `audit.retention_days` (90–3650).
- **Masalah**: Pemilik tunggal hampir tidak akan mengubahnya. Setiap setting menambah validator, label PLAN/05, baris UI, dan test. Rule 15 cukup dipenuhi dengan konstanta bernama.
- **Usulan**: Jadikan `KEEP_MIN_RUNS = 3`, `MAX_ITEM_MB = 2048`, dan `AUDIT_RETENTION_DAYS = 365` sebagai konstanta di modulnya. Simpan hanya `backup.include_secrets` sebagai setting. Tambah setting nanti bila ada yang meminta.

### C25 — OVER · data · `secret_check` + HKDF info baru

- Sudah dibahas di C1. Mencoba dekripsi lebih sederhana, lebih akurat, dan tidak butuh baris `app_meta` maupun logika "tulis check bila aman". Hapus `keyCheckValue` dan `secret_check` dari §3.2/§3.5.

---

## 3. Hal yang sudah baik (pertahankan)

- Retensi berbasis catatan `backup_run` (K3), bukan listing prefix. Proteksi "item ok terbaru per (kind,name)" adalah inti yang benar. Objek di luar catatan tidak pernah dihapus.
- Guard CSRF dipindah ke depan rate limit (K1). Penalarannya tepat dan ada test "61 POST asing lalu 1 sah → 200".
- Mode `mismatch` yang tidak merusak (K8), tidak `exit(1)`, dengan reset typed. Login tetap bisa karena kredensial Google ada di `.env` (`env.ts`, `auth.service.ts:28`), jadi pemilik tidak terkunci. Pencabutan sesi langsung berlaku karena `cookieCache` tidak aktif (`auth.service.ts` tidak mengaturnya), jadi `getSession` selalu membaca DB.
- "Pulihkan ke database baru" yang non-destruktif sekaligus menjadi uji pemulihan (K10), dengan tier confirm. Itu argumen UX yang tepat.
- `globals`, arsip situs tanpa binary, `cert.pem` tidak pernah ikut, dan `include_secrets` default off dengan alasan yang jelas (sesuai keputusan pemilik).
- Verifikasi lokal + `stat` ukuran setelah unggah (K6). ETag multipart memang bukan MD5.
- `/__spa` ke path acak (K16): satu baris dan menutup clickjacking via iframe. K17 menolak menyajikan aset sendiri, dan itu tepat.
- `AsyncLocalStorage` untuk konteks audit (K11): diff kecil, dan risiko konteks bocor ke antrean job sudah dicatat.
- Kode error, copy Indonesia, dan state UI ditulis lengkap. Tanda tangan modul dikunci agar worker paralel tidak menebak.

## 4. Pertanyaan yang hanya bisa dijawab pemilik

1. Untuk HP dicuri: apakah kamu mau di P1 (bukan P2) memakai token R2 **tanpa izin delete** + lifecycle rule bucket untuk retensi? Ini satu-satunya cara agar pencuri HP tidak bisa menghapus cadangan. Biayanya: retensi panel (K3) tidak lagi menghapus apa pun, dan retensi diatur di dashboard R2.
2. Apakah artefak build binary situs selalu kamu simpan di luar HP (CI/laptop)? Bila tidak, PLAN harus menambah binary situs terbaru ke cadangan (sekitar 89 MB per situs per run, bisa dengan opsi "simpan binary terakhir saja").
