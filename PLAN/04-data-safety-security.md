# PLAN 04 — Keamanan data, keamanan akses & cadangan

Worker: `wkr-plan-safety-01` · Branch `feature/production-polish` · 2026-11-26 · **Revisi r2** (setelah debat: `PLAN/debate/04-critique.md`, `00-integration-critique.md`, tanggapan `PLAN/debate/04-response.md`)

Status: rencana implementasi. Kode belum diubah. Menutup gap `R&D/04-data-safety-security.md` (disingkat **R4-Gn**). Istilah UI mengikuti `docs/content-guide.md`: Cadangan, Pulihkan, Sesi, Peran, Administrasi, Kesehatan sistem, Variabel lingkungan.

Bukti yang dipakai PLAN ini:

- **Hotfix CSRF sudah di `main` `112de15` dan di produksi (v0.2.2)**. Isinya `rejectForeignOrigin(req, appBaseUrl)` di `src/server/routes/origin.guard.ts`, dipasang sebagai `.onRequest` di `api.routes.ts`.
  - Metode `POST|PUT|PATCH|DELETE` di luar `/api/auth/` wajib `Sec-Fetch-Site` absen atau `same-origin`, `Origin` absen atau sama dengan origin `APP_BASE_URL`, dan `X-Requested-With: XMLHttpRequest`.
  - Bila tidak memenuhi: 403 `forbidden_origin`.
  - `git merge-tree` main → branch: satu konflik, di `api.routes.ts` (kritik integrasi X15).
- **Header aset**: binary `--compile` (diukur kritikus integrasi X5) tidak mengirim `Cache-Control` maupun `nosniff` pada `/chunk-*`. Chunk yang tidak ada menjawab 200 HTML, dan `/__spa` menjawab 200 tanpa CSP. Pengukuran r1 saya (tanpa compile) salah untuk artefak rilis.
- **Installer server** `~/test/server-termux/install.sh` (`makurosolusi/server-termux` `3394c98`):
  - `initdb -U postgres --auth-local=trust`, jadi role `postgres` ada;
  - memasang `postgresql cloudflared nodejs-lts termux-services`;
  - `put_once ~/sites/ecosystem.config.js`;
  - membuat tunnel hanya bila `config.yml` belum ada dan `cert.pem` ada;
  - `sv_on cloudflared` + `sv -w 30 check` bila `config.yml` ada;
  - `sv/pm2/run` = `pm2-runtime --no-auto-exit ~/sites/ecosystem.config.js`.
- Bun 1.4.2 menyediakan `bun audit --audit-level=high`, `node:fs.statfsSync`, `AsyncLocalStorage` (konteks bertahan melewati `await`), `Bun.CryptoHasher`, dan `S3Client.stat/exists/delete`.
- Better Auth 1.7.28 menyediakan `databaseHooks.user.create.after` dan `session.expiresIn/updateAge`. `freshSessionMiddleware` memakai `session.createdAt`.
- `site.schema.ts:13` punya kolom `database`.
- HSTS `includeSubDomains` dari `panel.<domain>` tidak berlaku untuk situs sibling (koreksi R&D risiko 6).

---

## 1. Tujuan & ruang lingkup

**Tujuan**:

- (a) Cadangan yang benar dan cukup untuk membangun ulang seluruh server di **HP baru**, dengan runbook yang terbukti lewat latihan.
- (b) Tidak ada jalur yang diam-diam menghapus cadangan valid terakhir atau mengganti kunci data.
- (c) Mutasi tahan CSRF dari situs yang di-host.
- (d) Audit yang bisa merekonstruksi insiden.
- (e) Rilis binary yang bisa diverifikasi. Pemilik pipeline adalah PLAN/05; PLAN ini menetapkan gerbang keamanannya.

### Ruang lingkup v0.3.0 (semua masuk, DECISIONS A8)

| Area                             | v0.3.0                                                                                                                                                                             | Di luar v0.3.0               | Menutup                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------- |
| CSRF                             | Guard pindah ke awal `createApiHandler` (sebelum rate limit), host check `/api`, `/api/me` masuk rate limit, throttle log (B17)                                                    | –                            | R4-G1, G21 (sebagian), G22 |
| Header HTTP                      | HTML (termasuk 404) `no-cache`, aset ber-hash `immutable` + `nosniff`, chunk tidak ada 404, `/__spa` 404, `/api/*` `no-store` (B11)                                                | –                            | R4-G12, R1-G14             |
| Retensi                          | Prune setelah `succeeded` atau `partial`; berbasis catatan (tanpa listing bucket); lindungi 3 run sukses + item ok terbaru per (jenis, nama); `secrets` dibersihkan bila dimatikan | –                            | R4-G2                      |
| Cakupan                          | `globals`, `sites` (tanpa binary), `cloudflared` (`config.yml`), `secrets` opsional (default off, A5), `panel`, `SHA256SUMS`, `manifest.json`; batas ukuran + cek ruang            | –                            | R4-G3                      |
| Verifikasi                       | sha256, cek struktur lokal, `stat` ukuran setelah unggah                                                                                                                           | Uji pemulihan terjadwal (P2) | R4-G9                      |
| Kunci data                       | Coba-dekripsi per baris, mode tidak cocok yang tidak merusak, blokir simpan rahasia saat tidak cocok, reset, unduh kunci data                                                      | Rotasi (P2)                  | R4-G4, G16                 |
| Snapshot upgrade                 | `VACUUM INTO` saat boot sebelum migrasi tertunda (B10)                                                                                                                             | –                            | R4-G5                      |
| Petunjuk & runbook               | Perintah absolut tidak destruktif + runbook HP baru 14 langkah + latihan penuh sebagai gerbang rilis                                                                               | –                            | R4-G6                      |
| Pulihkan terpandu                | "Pulihkan ke database baru" + tabel `backup_restore` + hapus DB uji (A8)                                                                                                           | Timpa DB yang ada (tidak)    | R4-G10                     |
| Uji koneksi S3                   | `POST /api/dev/backup/verify` (B7, implementasi di sini, UI PLAN/05)                                                                                                               | –                            | R5-G9                      |
| Audit                            | Kolom aktor/IP/UA/request id + backfill, aksi baru, filter `action[]`, retensi 365 hari (A8)                                                                                       | Hash chain (P2)              | R4-G14, G19, R5-G6         |
| Sesi                             | Sesi segar untuk aksi kunci & cadangan sensitif; umur absolut 30 hari; cabut sesi pengguna lain (B6); "Keluarkan semua pengguna" (A8)                                              | –                            | R4-G13, G18                |
| Model kepercayaan & threat model | Teks jujur + threat model                                                                                                                                                          | –                            | R4-G11                     |
| Access                           | `accessSeen` (sumber tunggal) + masalah info `access_not_seen` (B4)                                                                                                                | Validasi JWT (P2)            | R4-G7                      |
| Supply chain                     | Gerbang keamanan rilis + review (pipeline milik PLAN/05, B9)                                                                                                                       | –                            | R4-G23                     |

### Out of scope

- Enkripsi cadangan `age` → P2. Selama belum ada, `include_secrets` default `off`.
- Pulihkan dengan menimpa DB yang ada, atau `panel.db` dari UI → tidak. Tetap lewat CLI/runbook.
- Cadangan lokal (ring) → P2.
- Rotasi secret → P2.
- Allowlist email → tidak (keputusan pemilik 4).
- Peran operator → tidak (keputusan pemilik 1).
- Hash chain audit → P2.
- **Binary situs tidak dicadangkan** (default dari koordinator, pertanyaan pemilik tetap terbuka). Pemilik membangun ulang dari kode sumber/CI. UI dan manifest menyatakannya terang-terangan.
- UI halaman Audit, Pengaturan, Kesehatan, Profil, dan Pengguna → PLAN/05. PLAN ini menyediakan skema, API, komponen keamanan, dan copy.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Alternatif                                          | Alasan                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Guard CSRF dipanggil sekali, paling awal, di `createApiHandler`**, memakai `rejectForeignOrigin` tanpa mengubah aturannya. Urutannya: W0 orkestrator merge `main` → branch dengan `.onRequest` tetap ada (sama dengan produksi), lalu W1 `wkr-http-01` memindahkan guard dan menghapus `.onRequest` dalam satu diff. `tests/csrf.origin.test.ts` dimigrasi ke `servePanel`/`createApiHandler` dengan ekspektasi 403 yang sama. Log `[csrf]` di-throttle: maksimal satu baris per host origin per menit, plus jumlah.                                                                                                                                                                                                                                                                                                                              | Biarkan di `.onRequest`; pasang dua kali            | Setelah merge, `respond()` di branch ini memanggil `mutationLimit.take` (`api.handler.ts:100-103`) **sebelum** Elysia menjalankan `onRequest`. Halaman situs yang di-host bisa mengirim 60 POST `no-cors`/menit, semuanya ditolak, tetapi kuota mutasi sesi admin habis (DoS). Guard sebelum rate limit menutup itu. Tanpa throttle, halaman yang sama bisa menulis ribuan baris log per menit ke flash.    |
| K2  | **Host check `/api`**: `Host` bukan host `APP_BASE_URL` dan bukan `127.0.0.1` / `localhost` / `[::1]` → 421 `wrong_host`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Redirect 302                                        | Menutup bypass Access bila ada ingress kedua yang salah mengarah ke port panel. Installer dan probe memakai loopback.                                                                                                                                                                                                                                                                                       |
| K3  | **Retensi berbasis catatan `backup_run`**. Prune dijalankan setelah run `succeeded` **atau** `partial` (tidak setelah `failed`). Yang dilindungi: `KEEP_MIN_RUNS = 3` run `succeeded` terbaru, dan item `ok` terbaru per (`kind`, `name`), **kecuali** item `secrets` saat `include_secrets=off`. Pada kondisi itu semua item `secrets` menjadi kandidat tanpa melihat umur. DB hasil uji pulih yang tidak dipakai situs tidak dicadangkan. Retensi **tidak pernah me-list bucket**, jadi uji koneksi S3 tidak punya langkah `list` (B7). "Terbaru" = urutan insert (`rowid`), bukan jam dinding. Objek yang tidak tercatat tidak pernah dihapus.                                                                                                                                                                                                   | Listing prefix + `lastModified`; model Coolify (GB) | Listing menghapus objek manual di prefix yang sama. Hanya-`succeeded` mematikan retensi selamanya bila satu item gagal permanen (`too_large`, `globals` tanpa trust). `protectedItems` sudah menjamin salinan terakhir. Item `secrets` yang dilindungi selamanya bertentangan dengan maksud switch off. Jam HP bisa salah.                                                                                  |
| K4  | **Cakupan**: _selalu_ `globals` (`pg_dumpall --globals-only`, berisi hash SCRAM role), setiap DB, `sites` (arsip `sitesDir` tanpa binary dan `node_modules` di level situs), `cloudflared` (`config.yml`, `config.yml.bak*`), `panel`. _Opsional_ `backup.include_secrets=on` (default `off`): `secrets` = `data/secret`, `<panelDir>/.env`, `~/.cloudflared/<kredensial>.json`. `cert.pem` tidak pernah ikut. Binary situs tidak pernah ikut.                                                                                                                                                                                                                                                                                                                                                                                                      | Semua ikut; tanpa secret sama sekali                | Garisnya: kendali infrastruktur vs data aplikasi. `.env` situs dan dump berisi data yang tidak bisa didapat ulang, jadi ikut dengan peringatan jujur. `secret` + `panel.db` di bucket yang sama membuka kunci S3 (lalu bisa menghapus semua cadangan), token Cloudflare, dan pemalsuan cookie. Kredensial tunnel bisa menjalankan konektor. Semuanya bisa diterbitkan ulang dari penyedianya (runbook F11). |
| K5  | **Per run diunggah `<stem>SHA256SUMS`** (format `sha256sum`, nama file tanpa path) lalu **`<stem>manifest.json`** (terakhir). Manifest memuat path tujuan, versi Postgres, `appBaseUrl`, referensi tunnel, daftar situs + DB + "perlu binary", yang dikecualikan, urutan pulih, dan teks langkah pulih. Tanpa secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Catatan di `panel.db` saja                          | Saat HP hilang, `panel.db` belum tentu terbaca. `sha256sum -c` tidak bisa membaca JSON.                                                                                                                                                                                                                                                                                                                     |
| K6  | **Cek sebelum unggah, ukuran sesudah unggah**: `pg_restore --list` (dump: hanya TOC), `globals.sql` ukuran > 0 dan baris pertama `--`, `PRAGMA quick_check` (snapshot panel, read-only), `tar -tzf` (arsip). Setelah `client.write`: `client.stat(key).size` harus sama, bila tidak → `delete` + `upload_mismatch`. Label UI **"Diperiksa"**, bukan "Terverifikasi".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `integrity_check`; ETag                             | `pg_restore --list` tidak membaca blok data, jadi klaim "terverifikasi" melebih-lebihkan. Bukti bisa dipulihkan = latihan atau uji pemulihan. `stat` adalah satu-satunya bukti ukuran di R2 (3 baris), jadi tetap di v0.3.0.                                                                                                                                                                                |
| K7  | **Batas**: `MAX_ITEM_MB = 2048` (konstanta). Ruang bebas ≥ perkiraan + 256 MB, dengan perkiraan = `sizeBytes` item yang sama di run terakhir, fallback `sizeBytes` DB, lainnya 0. Bila tidak cukup → `insufficient_space`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Setting                                             | Pemilik tunggal hampir tidak pernah mengubahnya (C24).                                                                                                                                                                                                                                                                                                                                                      |
| K8  | **Kunci data = coba-dekripsi**. `unreadableSecretSettings(deps)` mencoba `decryptSecret` pada setiap baris setting rahasia (≤ 6 baris). `state = unreadable.length ? "mismatch" : "ok"`. Selama mismatch, **`setSetting` untuk key rahasia apa pun → `KeyMismatchError` (409 `key_mismatch`)**. Jalan keluar hanya mengembalikan file lama (status otomatis `ok`) atau reset (hapus baris yang tidak terbaca, typed + sesi segar). Bila file `secret` hilang, panel membuat secret baru (Better Auth butuh secret), tidak menyentuh baris lama, dan mencatat `log.error` + audit `secret.mismatch`.                                                                                                                                                                                                                                                 | `secret_check` di `app_meta` (r1); `exit 1`         | `secret_check` bohong setelah pemilik mengisi ulang satu setting saat mismatch (C1). Memblokir simpan mencegah keadaan campuran dua kunci. `exit 1` mematikan monitoring, padahal pemilik mungkin hanya punya browser.                                                                                                                                                                                      |
| K9  | **Snapshot pra-migrasi saat boot**: bila `__drizzle_migrations` ada dan jumlah barisnya < jumlah migrasi embedded → `VACUUM INTO <dataDir>/snapshots/panel.db.<prevVersion>.<yyyymmddHHMMSS>` (600), simpan 3. Bila gagal: hapus file parsial, `log.error` menyebut `PANEL_SKIP_SNAPSHOT=1`, `await Bun.sleep(60_000)`, lalu `exit(1)`. Installer **tidak** membuat snapshot; ia hanya preflight ruang dan mencetak snapshot terbaru di petunjuk rollback (PLAN/05).                                                                                                                                                                                                                                                                                                                                                                                | Snapshot di installer                               | Di boot, DB belum dipakai siapa pun sehingga konsisten. Cara ini juga mencakup upgrade manual. `sleep` memperlambat crash-loop runit.                                                                                                                                                                                                                                                                       |
| K10 | **Pulihkan terpandu = "Pulihkan ke database baru" saja** (`<nama>_r<yyyymmddHHMM>`), tier confirm, sekaligus uji pemulihan. Hapus DB hasil pulih = typed, ditolak 409 `in_use` bila `site.database` memakainya.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Timpa langsung                                      | Non-destruktif. R&D-01 G8 memetakan pulihkan ke typed; menyimpang dengan sengaja karena tidak ada yang ditimpa.                                                                                                                                                                                                                                                                                             |
| K11 | **Konteks request lewat `AsyncLocalStorage`** (`http/request.context.ts`) diisi `createApiHandler`. `recordAudit` mengisi `ip_masked`, `user_agent` (ringkas), `request_id`, `actor_label`, `actor_email` (dari `user` saat kejadian).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pemanggil mengoper request                          | Diff terkecil. Scheduler tidak punya konteks → null. IP tersamar (Rule 12).                                                                                                                                                                                                                                                                                                                                 |
| K12 | **`actor_kind`**: `user` / `system` / `unknown` (default `unknown` untuk baris lama). Backfill: punya aktor → `user` + label; `backup.run` tanpa aktor → `system`. Kolom milik PLAN ini; bentuk `DevAuditEntry` datar (X2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Soft-delete pengguna                                | Baris lama yang aktornya terhapus memang tidak bisa direkonstruksi, jadi ditandai jujur.                                                                                                                                                                                                                                                                                                                    |
| K13 | **Retensi audit** `AUDIT_RETENTION_DAYS = 365`, dijalankan saat boot dan saat tanggal lokal berganti di tick scheduler cadangan yang sudah ada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Setting; timer baru                                 | Konstanta cukup (C24). Tick sudah ada. Prune audit hanya menghapus baris > 365 hari; `audit.prune` dicatat.                                                                                                                                                                                                                                                                                                 |
| K14 | **Sesi segar** (`session.createdAt` ≤ 15 menit, `FRESH_SESSION_MS`) wajib untuk: unduh dan reset kunci data, unduh item `secrets`, dan `PATCH` setting yang menyalakan `backup.include_secrets` atau mengubah `backup.s3_endpoint` / `s3_bucket` / `prefix`. Selain itu → 403 `reauth_required`. Batasnya ditulis jujur: melindungi dari cookie curian di perangkat lain, **bukan** dari akun Google yang diambil alih (Google sering melewati layar login). **Umur absolut 30 hari** (`SESSION_ABSOLUTE_MAX_DAYS`) diperiksa di satu helper `getSessionChecked` (role guard, `/api/me`, sessions); sesi lebih tua dihapus → 401. **Cabut sesi pengguna lain** diizinkan untuk semua target kecuali diri sendiri (409 `self`), termasuk super admin env (B6). **Keluarkan semua pengguna** = semua sesi kecuali sesi pemanggil, tier confirm (X18). | Hanya unduh/reset kunci (r1)                        | r1 bisa dilewati: nyalakan secrets → run → unduh, atau arahkan bucket ke milik penyerang (C6).                                                                                                                                                                                                                                                                                                              |
| K15 | **Model kepercayaan admin** (keputusan pemilik 1): tanpa sandbox. Unduh cadangan = admin, kecuali item `secrets` = super_admin (bukan batas keamanan; ditulis begitu).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Semua unduh super_admin                             | Admin bisa deploy binary yang membaca semua file. Program situs juga bisa.                                                                                                                                                                                                                                                                                                                                  |
| K16 | **Penyaji SPA lewat server bundle internal** (`Bun.serve` kedua di `127.0.0.1:0`, `routes: { "/": spa }`). Server utama memproksi semua request non-API dan menerapkan tabel PLAN/01 §3.12: aset ber-hash ada → `public, max-age=31536000, immutable` + `nosniff`; aset ber-hash tidak ada → 404 `no-store` text; HTML → `no-cache` + header keamanan; `/__spa` tidak ada di server utama → diperlakukan path SPA biasa (status 404 + `noindex` sesuai PLAN/05 K16). `/api/*` → `cache-control: no-store`. Test memakai binary `build:local`.                                                                                                                                                                                                                                                                                                       | Path acak (r1); biarkan (r1 K17)                    | Bun tidak memberi hook header untuk rute HTMLBundle. Proksi sudah dipakai untuk HTML hari ini. Satu mekanisme menutup R4-G12 dan R1-G14.                                                                                                                                                                                                                                                                    |
| K17 | **Deteksi Cloudflare Access**: `createApiHandler` mengisi `accessSeen.at` bila request `/api/panel` atau `/api/dev` yang terautentikasi membawa `cf-access-jwt-assertion`. Ini **satu-satunya sumber**: PLAN/05 onboarding dan Kesehatan membacanya. Dipakai hanya untuk tampilan, tidak pernah untuk izin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Header per request di `/dev/setup` (05)             | Membuka panel lewat loopback sekali tidak boleh mengubah status (X12).                                                                                                                                                                                                                                                                                                                                      |
| K18 | **Rilis**: pipeline (`release.yml`, `ci.yml`, `dependabot.yml`, `package-release.sh`, `install-release.sh`) dan nama aset (`panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`) milik PLAN/05. PLAN/04 menetapkan **gerbang keamanan wajib** (§3.8) dan me-review diff sebelum merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | PLAN/04 memegang `release.yml` (r1)                 | Satu pemilik (C8, X1).                                                                                                                                                                                                                                                                                                                                                                                      |
| K19 | **Masalah & notifikasi**: PLAN/04 tidak punya notifier dan tidak punya file aturan masalah. PLAN ini menetapkan kode, params, dan input (§3.7); aturannya di `overview.problems.ts` (PLAN/02). Status "Pulih" otomatis saat Problem tertutup. `key_mismatch` tidak bisa dikirim ke Telegram (tokennya ikut terkunci), dan itu ditulis jujur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `notify()` + `backup.events.ts` (r1)                | PLAN/02 K11 merekonsiliasi Problem dan menolak kanal per event (C7, X10).                                                                                                                                                                                                                                                                                                                                   |
| K20 | **Arsip situs tanpa pola glob**: entri dibangun di kode. Di level atas `sitesDir`, semua file (mis. `apps.json`, `ecosystem.config.js`) ikut, dan setiap folder situs di-`readdir` lalu nama di `SITE_BINARY_NAMES` (`app`, `app.prev`, `app.new`, `.app.prev.drop`, `.app.swap`, dari `src/shared/site.types.ts` PLAN/03) + `node_modules` **di level situs saja** dibuang. Hasilnya `tar -czf f -C sitesDir <entri…>`. Situs dengan `site.dir` di luar `sitesDir` → `warning: outside_sites_dir`.                                                                                                                                                                                                                                                                                                                                                 | `--exclude`                                         | Pola GNU tar default cocok di kedalaman mana pun, sehingga folder data bernama `app` ikut terbuang diam-diam (C9).                                                                                                                                                                                                                                                                                          |
| K21 | **Token R2 tanpa izin hapus** = opsi P1 yang didokumentasikan, tidak dipaksakan (pertanyaan pemilik terbuka). Bila `delete` di prune mendapat `AccessDenied`: berhenti mencoba di run itu, item diberi `warning: retention_denied`, status tetap, dan UI menjelaskan "Retensi diserahkan ke lifecycle rule bucket". README berisi resepnya, termasuk batasannya: lifecycle menghapus berdasarkan umur sehingga "item valid terakhir" tidak dijamin. Atur kedaluwarsa ≥ 30 hari dan perhatikan masalah stale.                                                                                                                                                                                                                                                                                                                                        | Mode setting `retention_mode`                       | Tanpa kode mode. Satu cabang di `applyPrune`. Satu-satunya pelindung cadangan dari pencuri HP.                                                                                                                                                                                                                                                                                                              |

Default brief yang diikuti: enkripsi P2 ✔; cakupan P0 dengan peringatan jujur ✔; secrets opt-in (**menyimpang** dari default "semua ikut", alasan K4, sudah diterima debat); `apps.json`/`ecosystem.config.js` lewat arsip `sites` ✔; `app.prev` tidak dicadangkan ✔.

---

## 3. Model data & kontrak API

Semua tipe shared di bawah ditulis oleh **`wkr-contracts-00` (W0)**. Worker PLAN/04 tidak mengedit file `src/shared/*`.

### 3.1 `src/shared/backup.types.ts`

```ts
export type BackupTrigger = "schedule" | "manual";
/** `partial` = at least one item failed and at least one succeeded. */
export type BackupRunStatus = "running" | "succeeded" | "failed" | "partial";
/** What one uploaded object holds. `checksums` = sha256sum file; `manifest` = run index (uploaded last). */
export type BackupItemKind =
  | "database"
  | "globals"
  | "panel"
  | "sites"
  | "cloudflared"
  | "secrets"
  | "checksums"
  | "manifest";
export type BackupItemErrorCode =
  | "produce_failed"
  | "check_failed"
  | "too_large"
  | "insufficient_space"
  | "upload_failed"
  | "upload_mismatch"
  | "key_mismatch";
/** Non-fatal note on an ok item. */
export type BackupItemWarning = "file_changed" | "outside_sites_dir" | "retention_denied";

export type BackupItem = {
  kind: BackupItemKind;
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  /** Short masked technical detail, shown under the Indonesian message. */
  error: string | null;
  errorCode: BackupItemErrorCode | null;
  warning: BackupItemWarning | null;
  /** Hex sha256 of the uploaded bytes; null for rows from before 0.3.0. */
  sha256: string | null;
  /** Local structure check passed before upload; null = not checked (old rows). */
  checked: boolean | null;
  /** Deleted by retention: no download. */
  pruned: boolean;
  /** Non-destructive command for a new phone (absolute paths); "" for checksums/manifest. */
  restoreHint: string;
};

export type BackupRun = {
  id: string;
  trigger: BackupTrigger;
  status: BackupRunStatus;
  startedAt: string;
  finishedAt: string | null;
  items: BackupItem[];
  error: string | null;
  includesSecrets: boolean;
  panelVersion: string | null;
  prunedAt: string | null;
};

/** Newest ok, non-pruned item per (kind, name), newest = insert order. Excludes checksums/manifest. */
export type BackupLastGood = {
  kind: Exclude<BackupItemKind, "checksums" | "manifest">;
  name: string;
  runId: string;
  itemIndex: number;
  at: string;
  sizeBytes: number | null;
  checked: boolean | null;
};

/** GET /api/panel/backups/status. Never throws because of the data key (keyMismatch instead). */
export type BackupStatus = {
  configured: boolean;
  missing: string[];
  keyMismatch: boolean;
  hourLocal: number | null;
  nextRunAt: string | null;
  retentionDays: number;
  keepMinRuns: number;
  maxItemMb: number;
  includeSecrets: boolean;
  running: boolean;
  /** A restore is in progress (shares the lock with runs). */
  restoring: boolean;
  lastRun: BackupRun | null;
  lastGood: BackupLastGood[];
  /** Plain words for what is never backed up (e.g. site binaries, cert.pem). */
  excluded: BackupExcluded[];
  /** Newest succeeded "Pulihkan ke database baru"; null if never. */
  lastRestoreTest: { at: string; sourceName: string } | null;
};
export type BackupExcluded = "site_binaries" | "cloudflared_cert" | "secrets_off";

export type BackupRunStarted = { runId: string };

/** `<stem>manifest.json`; never holds secret values. */
export type BackupManifest = {
  format: 1;
  runId: string;
  createdAt: string;
  panelVersion: string;
  schemaVersion: string;
  /** `psql -At -c 'show server_version'`; pg_restore must be >= this major. */
  postgresVersion: string | null;
  appBaseUrl: string;
  includesSecrets: boolean;
  paths: { panelDir: string; dataDir: string; sitesDir: string; cloudflaredDir: string };
  /** `tunnel:` value of config.yml and the basename of its credentials-file (no contents). */
  tunnel: { ref: string; credentialsFile: string } | null;
  sites: { name: string; database: string | null; needsBinary: boolean }[];
  items: { kind: BackupItemKind; name: string; file: string; sizeBytes: number; sha256: string }[];
  excluded: string[];
  restoreOrder: Exclude<BackupItemKind, "checksums" | "manifest">[];
  /** Same text as README "Pulihkan ke HP baru", filled with this run's names. */
  restoreSteps: string[];
};

/**
 * POST /api/dev/backup/verify (DECISIONS B7). Body optional: unsaved draft fields; missing fields fall back
 * to the stored settings. No `list` step: retention never lists the bucket (K3).
 */
export type BackupVerifyInput = Partial<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}>;
export type BackupVerifyStep = "write" | "read" | "delete";
export type BackupVerifyCode =
  | "ok"
  | "not_configured"
  | "unreadable"
  | "unreachable"
  | "bucket_not_found"
  | "write_denied"
  | "read_failed"
  | "delete_denied"
  | "timeout"
  | "s3_error";
export type BackupVerify = {
  ok: boolean;
  code: BackupVerifyCode;
  failedStep: BackupVerifyStep | null;
  /** Every step in order; steps after the failed one are `{ ok: false, code: "skipped" }`. */
  steps: { step: BackupVerifyStep; ok: boolean; code: BackupVerifyCode | "skipped" }[];
  ms: number;
  detail: string | null;
};

export type BackupRestoreStatus = "running" | "succeeded" | "failed";
/** Item of GET /api/panel/backups/restores (paged, newest first). */
export type BackupRestore = {
  id: string;
  runId: string;
  itemIndex: number;
  sourceName: string;
  targetDb: string;
  status: BackupRestoreStatus;
  error: string | null;
  errorCode: "checksum_mismatch" | "insufficient_space" | "download_failed" | "restore_failed" | null;
  tableCount: number | null;
  startedAt: string;
  finishedAt: string | null;
  droppedAt: string | null;
  /** A site uses targetDb (site.database): "Hapus database uji" is hidden and refused (409 in_use). */
  inUse: boolean;
  actor: { id: string; name: string } | null;
};
/** 202 body of POST /api/panel/backups/:id/items/:index/restore. */
export type BackupRestoreStarted = { restoreId: string; targetDb: string };
```

### 3.2 `src/shared/security.types.ts`

```ts
export type DataKeyState = "ok" | "mismatch";
/** GET /api/dev/security (super_admin). */
export type SecurityStatus = {
  dataKey: {
    state: DataKeyState;
    /** The secret file was created at this boot (fresh install or lost file). */
    createdThisBoot: boolean;
    exportedAt: string | null;
    /** Secret setting keys that cannot be decrypted with the current key. */
    unreadableSettings: string[];
  };
  access: { https: boolean; lastSeenAt: string | null };
  sessions: { active: number; users: number };
  backupsIncludeSecrets: boolean;
};
/** POST /api/dev/users/:id/sessions/revoke (route PLAN/05; implementation here). */
export type RevokedSessions = { revoked: number };
export type DataKeyResetInput = { confirm: "hapus" };
```

### 3.3 `src/shared/dev.types.ts` (`DevAuditEntry`, bentuk datar) dan `src/shared/audit.types.ts`

```ts
export type AuditActorKind = "user" | "system" | "unknown";
export type DevAuditEntry = {
  id: number;
  at: string;
  actor: UserRef | null; // live user; null when deleted or system
  actorKind: AuditActorKind;
  actorLabel: string | null; // name at event time (survives deletion)
  actorEmail: string | null;
  actorDeleted: boolean; // actorKind "user" but account gone
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  ipMasked: string | null;
  userAgent: string | null;
  requestId: string | null;
};
```

`src/shared/audit.types.ts` memuat union `AuditAction` lengkap dari semua PLAN, ditulis W0. Kontribusi PLAN/04 ada di §3.6. `audit.service.ts` meng-import union itu.

### 3.4 Skema DB & migrasi `drizzle/0006_data_safety.sql` (ditulis `wkr-db-01`, urutan global pertama)

Proses: generate dari perubahan schema Drizzle → backfill ditambahkan manual di akhir → **setiap pernyataan dipisah `--> statement-breakpoint`** (`migrate.ts:7,25`). Migrasi dijalankan lokal dan diverifikasi oleh `tests/db.migrate.test.ts` ("DB v0.2.2 berisi data → 0006 → 0008").

Idempotensi (B15): `CREATE TABLE/INDEX IF NOT EXISTS` di setiap pernyataan yang mendukungnya. Untuk `ALTER TABLE ADD`, SQLite tidak punya `IF NOT EXISTS`, jadi penjaganya journal drizzle (hash per file, migrasi hanya jalan sekali). `audit_log_at_idx` sudah ada sejak 0002, sehingga `IF NOT EXISTS` membuatnya no-op. Kolom `NOT NULL` di tabel berisi data selalu diberi `DEFAULT`.

```sql
-- audit_log: the actor must survive user deletion, and where it came from (R&D-04 G14, R&D-05 G6).
ALTER TABLE `audit_log` ADD `actor_kind` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `actor_label` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `actor_email` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `ip_masked` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `user_agent` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `request_id` text;
--> statement-breakpoint
-- backup_run: run-level facts for retention (items stay JSON; new item fields are optional in old rows).
ALTER TABLE `backup_run` ADD `includes_secrets` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `backup_run` ADD `panel_version` text;
--> statement-breakpoint
ALTER TABLE `backup_run` ADD `pruned_at` integer;
--> statement-breakpoint
-- Backfill: rows before this migration. Deleted actors cannot be recovered and stay 'unknown'.
UPDATE `audit_log` SET `actor_kind` = 'user',
  `actor_label` = (SELECT `name` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`),
  `actor_email` = (SELECT `email` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`)
  WHERE `actor_id` IS NOT NULL;
--> statement-breakpoint
-- Scheduled runs were the only actor-less backup.run rows.
UPDATE `audit_log` SET `actor_kind` = 'system' WHERE `actor_id` IS NULL AND `action` = 'backup.run';
--> statement-breakpoint
-- "Pulihkan ke database baru": one row per restore; target_db is what "Hapus database uji" may drop.
CREATE TABLE IF NOT EXISTS `backup_restore` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES `backup_run`(`id`) ON DELETE cascade,
  `item_index` integer NOT NULL,
  `source_name` text NOT NULL,
  `target_db` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `error_code` text,
  `table_count` integer,
  `actor_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `dropped_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `backup_restore_started_at_idx` ON `backup_restore` (`started_at`);
--> statement-breakpoint
-- Audit retention deletes by age.
CREATE INDEX IF NOT EXISTS `audit_log_at_idx` ON `audit_log` (`at`);
```

- `BackupItemRow` (JSON) ditambah field opsional `errorCode`, `warning`, `sha256`, `checked`, `pruned`. Baris lama tanpa field itu dibaca sebagai null/false.
- `app_meta` (tanpa migrasi): `panel_version` (ditulis tiap boot setelah migrasi) dan `secret_exported_at`.

### 3.5 Setting

Hanya satu key baru, ditulis `wkr-settings-01`: `backup.include_secrets` (`on`/`off`, default `off`).

Konstanta di modulnya:

- `KEEP_MIN_RUNS = 3`, `MAX_ITEM_MB = 2048` (`backup.retention.ts` / `backup.items.ts`);
- `AUDIT_RETENTION_DAYS = 365` (`audit.service.ts`), `SESSION_ABSOLUTE_MAX_DAYS = 30` (`role.guard.ts`);
- `FRESH_SESSION_MS = 15 * 60_000` (`role.guard.ts`).

Spec untuk `wkr-settings-01` (di `settings.service.ts` + rute settings):

1. Kelas `KeyMismatchError extends Error`.
2. `unreadableSecretSettings(deps: SettingsDeps): SettingKey[]` mencoba dekripsi setiap baris `secret: true`.
3. `setSetting` untuk key `secret: true` melempar `KeyMismatchError` bila (2) tidak kosong.
4. Rute `PATCH /api/dev/settings` memetakan `KeyMismatchError` → 409 `key_mismatch`.
5. Rute yang sama memanggil `assertFresh(session)` bila batch menyalakan `backup.include_secrets` atau mengubah `backup.s3_endpoint` / `backup.s3_bucket` / `backup.prefix` → 403 `reauth_required`.
6. Deskripsi `backup.retention_days` di `id.settings` (PLAN/05): "Cadangan lebih tua dari ini dihapus setelah pencadangan yang tidak gagal. Tiga cadangan berhasil terakhir dan cadangan valid terakhir tiap item selalu disimpan."

### 3.6 Endpoint

Semua mutasi melewati K1. Body error seragam `{ error, message }`. `ApiError.status` mencakup 410/421 (W0 X25).

| Metode & path                                                                                          | Peran                                       | Request → Response                                                                                        | Error                                                                                                                                                                                               | Versi |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| GET `/api/panel/backups/status`                                                                        | admin                                       | `BackupStatus`                                                                                            | –                                                                                                                                                                                                   | 0.3.0 |
| GET `/api/panel/backups?page&pageSize`                                                                 | admin                                       | `Page<BackupRun>`                                                                                         | 400 `invalid_pagination`                                                                                                                                                                            | 0.3.0 |
| POST `/api/panel/backups/run`                                                                          | admin                                       | 202 `BackupRunStarted`                                                                                    | 400 `not_configured` (+`missing`), 409 `busy`, 409 `key_mismatch`                                                                                                                                   | 0.3.0 |
| GET `/api/panel/backups/:id/items/:index/download`                                                     | admin; `secrets` = super_admin + sesi segar | 302 presigned GET 15 mnt                                                                                  | 403 `forbidden` / `reauth_required`, 404, 410 `pruned`, 409 `key_mismatch`                                                                                                                          | 0.3.0 |
| POST `/api/dev/backup/verify`                                                                          | super_admin                                 | `BackupVerifyInput` (opsional, draft) → `BackupVerify` (write → read → delete, tanpa list)                | – (hasil di body, `code` `unreadable` saat mismatch)                                                                                                                                                | 0.3.0 |
| GET `/api/dev/security`                                                                                | super_admin                                 | `SecurityStatus`                                                                                          | –                                                                                                                                                                                                   | 0.3.0 |
| POST `/api/dev/security/data-key/export`                                                               | super_admin, sesi segar                     | 200 `text/plain`, `attachment; filename="panel-termux-kunci-data-<yyyy-mm-dd>.txt"`, `no-store`           | 403 `reauth_required`, 409 `key_mismatch`                                                                                                                                                           | 0.3.0 |
| POST `/api/dev/security/data-key/reset`                                                                | super_admin, sesi segar                     | `DataKeyResetInput` → `SecurityStatus`                                                                    | 400 `confirm_mismatch`, 403 `reauth_required`, 409 `key_ok`                                                                                                                                         | 0.3.0 |
| POST `/api/dev/users/:id/sessions/revoke`                                                              | super_admin                                 | `RevokedSessions` (route PLAN/05, fungsi `revokeUserSessions` PLAN/04)                                    | 404, 409 `self` (hanya diri sendiri; super admin env boleh dicabut, B6)                                                                                                                             | 0.3.0 |
| GET `/api/dev/audit?action=a&action=b.&actorId&from&to&page`                                           | super_admin                                 | `Page<DevAuditEntry>` (`action` OR; diakhiri `.` = prefix dengan `%`/`_` di-escape)                       | 400 `invalid_date`                                                                                                                                                                                  | 0.3.0 |
| POST `/api/panel/backups/:id/items/:index/restore`, GET `…/restores`, DELETE `…/restores/:id/database` | admin                                       | POST `{}` → 202 `BackupRestoreStarted`; GET → `Page<BackupRestore>`; DELETE `{ confirm: targetDb }` → 204 | POST: 400 `not_database`, 404, 410 `pruned`, 409 `busy` / `insufficient_space` / `key_mismatch`. DELETE: 400 `confirm_mismatch`, 404, 409 `in_use` / `already_dropped` / `restore_running` / `busy` | 0.3.0 |
| POST `/api/dev/sessions/revoke-all`                                                                    | super_admin                                 | `RevokedSessions` (semua sesi semua pengguna kecuali sesi pemanggil; tier confirm)                        | –                                                                                                                                                                                                   | 0.3.0 |

Isi file kunci data:

```
Panel Termux — kunci data (data/secret)
Panel: https://panel.example.com · dibuat 2026-11-26 21.30
Simpan di pengelola kata sandi, di luar HP ini dan di luar bucket cadangan. Siapa pun yang memegang
file ini bersama panel.db bisa membaca pengaturan rahasia dan memalsukan sesi.
Pakai di HP baru (lihat README "Pulihkan ke HP baru" langkah 10):
  printf '%s' '<64 hex>' > ~/panel/data/secret && chmod 600 ~/panel/data/secret

<64 hex>
```

### 3.7 Modul & fungsi (tanda tangan dikunci)

```ts
// http/request.context.ts (wkr-http-01)
export type RequestContext = { requestId: string; ipMasked: string | null; userAgent: string | null };
export function runWithRequest<T>(ctx: RequestContext, fn: () => T): T;
export function currentRequest(): RequestContext | null;

// http/api.handler.ts (wkr-http-01) — caller: servePanel in http/spa.serve.ts
export function createApiHandler(api: Handler, opts: { appBaseUrl: string }): (req: Request, server?: Peer) => Promise<Response>;
export const accessSeen: { at: Date | null };

// secret.ts (wkr-keys-02)
export function loadOrCreateSecret(dataDir: string): { secret: string; created: boolean };

// data-key.service.ts (wkr-keys-02) — uses unreadableSecretSettings from settings.service
export function checkDataKeyOnBoot(deps: SettingsDeps, created: boolean): DataKeyState; // logs + audits mismatch
export function dataKeyState(deps: SettingsDeps): { state: DataKeyState; unreadable: SettingKey[] };
export function resetUnreadableSettings(deps: SettingsDeps, actorId: string): SettingKey[];
export function exportDataKeyText(secret: string, appBaseUrl: string, now: Date): string;

// db/snapshot.ts (wkr-keys-02)
export async function snapshotBeforeMigrations(db: Db, dataDir: string, prevVersion: string | null, now?: Date): Promise<string | null>;
export const SNAPSHOT_KEEP = 3;

// auth/role.guard.ts, sessions.service.ts, auth.audit.ts (wkr-audit-02)
export const FRESH_SESSION_MS = 15 * 60_000;
export const SESSION_ABSOLUTE_MAX_DAYS = 30;
/** getSession + absolute-age check (deletes the row, returns null when older). Used by roleGuard, /me, sessions. */
export async function getSessionChecked(auth: Auth, db: Db, headers: Headers): Promise<SessionWithUser | null>;
export function assertFresh(session: { createdAt: Date }, now?: Date): void; // ApiError 403 reauth_required
export function revokeUserSessions(db: Db, actorId: string, userId: string): number; // ApiError 409 `self` when equal
export function revokeAllSessions(db: Db, exceptSessionId: string): number;
export function handleAuthRequest(auth: Auth, db: Db, req: Request): Promise<Response>; // sign-out audit, failed-callback log

// audit.service.ts (wkr-audit-02)
export type AuditFilter = { action?: string[]; actorId?: string; from?: Date; to?: Date; excludePrefixes?: string[] };
export const AUDIT_RETENTION_DAYS = 365;
export function pruneAudit(db: Db, now?: Date): number; // records audit.prune when > 0

// backup/* (wkr-backup-engine-02); each file < 300 lines
// backup.items.ts     produce + check + hash + upload + stat per kind, sites entry list (K20)
// backup.retention.ts planPrune(runs, { retentionDays, keepMinRuns, includeSecrets }, now) — pure; applyPrune
// backup.verify.ts    POST /dev/backup/verify (draft ∪ stored; write → stat → delete, no list), maps S3 codes
// backup.restore.ts   restore into a new database (F10), drop test database
// backup.service.ts   start/status/list/download/scheduler; exports:
export function lastGoodItem(db: Db, kind: BackupLastGood["kind"], name: string): BackupLastGood | null;
//   backup.busy(): boolean   (run or restore running)
//   backupScheduler.lastTickAt(): Date | null

// system/* (wkr-adapters-01)
export interface PostgresAdapter { /* + */
  dumpGlobals(file: string): Promise<void>;      // pg_dumpall --globals-only -w -f file
  verifyDump(file: string): Promise<void>;       // pg_restore --list file > /dev/null
  serverVersion(): Promise<string>;              // psql -At -c 'show server_version'
  /** createdb -O owner target; pg_restore --no-owner --role=owner --exit-on-error -d target; count tables. */
  restoreInto(file: string, target: string, owner: string): Promise<{ tableCount: number }>;
  /** DROP DATABASE IF EXISTS … WITH (FORCE); the role is never touched. */
  dropDatabase(name: string): Promise<void>;
}
export interface ArchiveAdapter {
  /** tar -czf file -C dir <entries…> (no --exclude). tar exit 1 = warning "file_changed". */
  create(file: string, dir: string, entries: string[]): Promise<{ warning: "file_changed" | null }>;
  list(file: string): Promise<void>; // tar -tzf
}
// SystemAdapters + { archive: ArchiveAdapter }; fake: in-memory tar via real tar on temp dirs is acceptable
// in tests (tar exists on macOS/Linux CI).
```

### 3.8 Aksi audit (masuk `audit.types.ts`, W0)

| Aksi                   | Aktor                  | Target          | meta                                                        | Versi |
| ---------------------- | ---------------------- | --------------- | ----------------------------------------------------------- | ----- |
| `auth.sign_out`        | pengguna               | –               | –                                                           | 0.3.0 |
| `auth.account_created` | pengguna baru          | user id         | –                                                           | 0.3.0 |
| `user.role_sync`       | sistem                 | user id         | `{ from, to, reason: "super_admin_emails" }`                | 0.3.0 |
| `session.revoke`       | super_admin / pengguna | session/user id | `{ scope: "one" \| "others" \| "user", userId?, revoked? }` | 0.3.0 |
| `secret.mismatch`      | sistem                 | –               | `{ createdThisBoot, unreadable: n }`                        | 0.3.0 |
| `secret.export`        | super_admin            | –               | –                                                           | 0.3.0 |
| `secret.reset`         | super_admin            | –               | `{ keys }`                                                  | 0.3.0 |
| `panel.start`          | sistem                 | versi           | `{ schema, migratedFrom?, snapshot? }` (nama file saja)     | 0.3.0 |
| `backup.verify`        | super_admin            | bucket          | `{ ok, code }`                                              | 0.3.0 |
| `backup.prune`         | sistem                 | run id          | `{ deleted, failed, denied }` (bila > 0)                    | 0.3.0 |
| `session.revoke_all`   | super_admin            | `*`             | `{ count }`                                                 | 0.3.0 |
| `backup.restore`       | admin                  | target DB       | `{ runId, item: name, status }` (saat selesai)              | 0.3.0 |
| `backup.restore_drop`  | admin                  | target DB       | –                                                           | 0.3.0 |
| `audit.prune`          | sistem                 | –               | `{ deleted }` (bila > 0)                                    | 0.3.0 |

Login gagal **tidak** dicatat di audit (C17). Penggantinya `log.warn` agregat per menit: `[auth] N failed sign-in callbacks in the last minute: <kode>×n`.

### 3.9 Kontrak lintas PLAN (usulan kanonik)

1. **Masalah** (DECISIONS B2/B4; aturan di `overview.problems.ts` PLAN/02; union di `monitor.types.ts` W0). PLAN/04 hanya menyediakan input: `BackupStatus` (termasuk `lastGood`), `SecurityStatus`, `lastGoodItem`. `ProblemKind` + `"security"`. Severity `info` = tone info di Ringkasan + onboarding, tidak menurunkan vonis kesehatan, tidak dikirim ke Telegram. `backup_not_configured` (kode 02) juga **info** (B4); cadangan gagal/basi tetap warning/danger. Kode baru:

   | code                      | kind     | severity                                                 | params                                                    | target          | href                     | input                                                                                                                                     |
   | ------------------------- | -------- | -------------------------------------------------------- | --------------------------------------------------------- | --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | `key_mismatch`            | security | danger                                                   | `{ count }`                                               | `data_key`      | `/dev/health#kunci-data` | `dataKeyState(deps).unreadable`                                                                                                           |
   | `access_not_seen`         | security | **info** (B4: tidak menurunkan vonis, tidak ke Telegram) | –                                                         | `access`        | `/dev/health#access`     | `https` dan `accessSeen.at` null atau > 24 jam, padahal sudah ada request admin terautentikasi sejak boot                                 |
   | `backup_secrets_included` | security | warning                                                  | –                                                         | `backup`        | `/panel/backups`         | `includeSecrets`                                                                                                                          |
   | `backup_item_stale`       | backup   | warning                                                  | `{ itemKind, name, hours }` (`hours` null = belum pernah) | `<kind>:<name>` | `/panel/backups`         | item (bukan checksums/manifest) yang ada di run terakhir dan `lastGoodItem` lebih tua dari 36 jam, tidak ada, atau ber-`at` di masa depan |
   - `backup_status_error` (02) tetap ada untuk error selain kunci; `backup.status()` tidak melempar karena kunci.
   - Tidak ada `notify()`, `backup.events.ts`, atau `backup.problems.ts`.
   - Pemetaan state cadangan → kunci kamus status PLAN/01 ada di `src/web/backup/backup.status-key.ts` (milik PLAN/04, B12): `running`→`processing`, `succeeded`→`ok`, `partial`→`warning`, `failed`→`failed`, run terputus→`interrupted` ("Terputus", warning), `keyMismatch`→`key_mismatch` (danger), restore `running`→`processing`.
2. **Snapshot**: hanya saat boot (K9). Lokasi `<dataDir>/snapshots/panel.db.<prevVersion>.<yyyymmddHHMMSS>`. `install-phone.sh` (PLAN/05):
   - preflight ruang ≥ 2 × ukuran `panel.db` + 256 MB sebelum menukar binary;
   - saat cek kesehatan gagal, mencetak `panel.prev`, `ls -t ~/panel/data/snapshots | head -1`, dan `PANEL_SKIP_SNAPSHOT=1`;
   - teks PLAN/05 F9.4 diganti.
3. **Gerbang keamanan rilis** (diperiksa PLAN/04 sebelum merge pipeline PLAN/05):
   - `bun install --frozen-lockfile`, lalu `bun audit --audit-level=high` (non-zero = stop), typecheck, lint, test, build;
   - action dipin ke commit SHA (diverifikasi di halaman rilisnya saat implementasi, Rule 20), tanpa `actions/cache`;
   - `permissions: {}` di workflow, dan per job hanya yang perlu (`contents: write`, `id-token: write`, `attestations: write` di job rilis);
   - `actions/attest@v4` dipin ke SHA (bukan `attest-build-provenance`) dengan `subject-checksums: SHA256SUMS`; catat bahwa attestation butuh repo publik;
   - `workflow_dispatch` dengan input `dry_run` wajib dijalankan hijau sebelum pemilik membuat tag `v0.3.0` (B9);
   - installer `sha256sum -c` sebelum ekstrak; tag harus sama dengan `package.json` version;
   - `ci.yml` menjalankan gerbang yang sama untuk push/PR;
   - `dependabot.yml` hanya ekosistem `github-actions`.
4. **Kepemilikan file bersama**: lihat §7.
5. **Fungsi untuk PLAN lain**:
   - `lastGoodItem` → 02 `DatabaseInfo.lastBackupAt`, 03 dialog hapus situs;
   - `backup.busy()` → 02 menolak restart `panel`, 03 `database_drop` menolak `busy`;
   - `backupScheduler.lastTickAt()` → 05 Kesehatan;
   - `dataKeyState` → 05 `DevSetting.readable`, 02 aturan `key_mismatch`;
   - `accessSeen` → 05 onboarding/Kesehatan;
   - `revokeUserSessions` → 05 route;
   - `KeyMismatchError` → 03 job (409 `key_mismatch`).

---

## 4. Flow

### F1 — Mutasi dari SPA (K1/K2)

1. `createApiHandler` membuat `requestId`.
2. Host check → 421 `wrong_host`.
3. `rejectForeignOrigin` → 403 `forbidden_origin`. Kuota tidak berkurang. Log di-throttle per origin per menit.
4. Rate limit: auth per IP; mutasi `^/api/(panel|dev|me)/` per sesi.
5. Batas body, lalu `runWithRequest(ctx, () => api.handle(...))`. Header `cache-control: no-store`.
6. `/api/panel|dev` terautentikasi + header `cf-access-jwt-assertion` → `accessSeen.at = now`.
7. Edge: curl tanpa header → 403 (disengaja). `GET /api/health` dari installer → 200.

### F2 — Run cadangan

1. `start()`:
   - `keyMismatch` → 409 (manual) atau skip dengan `log.warn` maksimal sekali per hari lokal (terjadwal);
   - belum diatur → 400;
   - `busy` → 409.
2. Insert `backup_run` (`includes_secrets`, `panel_version`).
3. Urutan item: `globals` → setiap DB (urut nama; DB hasil uji pulih yang tidak dipakai situs dilewati, F10) → `sites` → `cloudflared` → `secrets` (bila on) → `panel` → `checksums` → `manifest`. `panel` diambil sesudah item lain agar `panel.db` hasil pulih mengenal hampir semua objek run-nya. Setelah DR, run itu tampil "Terputus", dan itu wajar.
4. Tiap item:
   1. cek ruang (`insufficient_space`);
   2. produksi;
   3. `> MAX_ITEM_MB` → `too_large`;
   4. cek struktur (`check_failed`);
   5. sha256 streaming;
   6. `client.write` (`upload_failed`);
   7. `client.stat` (`upload_mismatch` → `delete`);
   8. simpan JSON;
   9. hapus file temp di `finally`.

   Rincian per jenis:
   - `sites`: entri sesuai K20. `sitesDir` tidak ada → item dilewati.
   - `cloudflared`: `config.yml`, `config.yml.bak*`. Folder tidak ada → item dilewati.
   - `secrets`: `secret` dari `dataDir`, `.env` dari `panelDir = process.cwd()`, `<credentials-file>` dari `config.yml`. Entri yang tidak ada dilewati; kosong semua → `produce_failed`.
   - `panel`: `VACUUM INTO` → `quick_check`.
5. `checksums` (`<sha256>  <basename>` per item ok, termasuk panel) dan `manifest` dibuat dari item ok, lalu diunggah. Bila salah satunya gagal → `partial`.
6. Status: `succeeded` / `partial` / `failed`.
7. **Bila bukan `failed`**: `planPrune` → `applyPrune` (F3).
8. Simpan dan audit `backup.run`. Masalah dan notifikasi diturunkan PLAN/02 dari status ini.
9. Edge:
   - jaringan putus → item gagal, `partial`/`failed`;
   - restart di tengah → boot menandai `failed: interrupted by panel restart`, `backup-tmp` dibersihkan, objek yang sempat terunggah tercatat sebagai item ok sehingga nanti di-prune;
   - jam HP salah > 15 mnt → R2 menolak (`RequestTimeTooSkewed`) → `failed`, tidak ada prune.

### F3 — Retensi (`planPrune`, murni)

1. Run diurutkan menurut **rowid** (urutan insert). `protectedRuns` = 3 run `succeeded` terbaru.
2. `protectedItems` = item `ok && !pruned` terbaru per (kind, name) untuk kind ∉ {checksums, manifest}, **kecuali** `secrets` bila `includeSecrets=false`.
3. Kandidat:
   - item `ok && !pruned` dengan `run.startedAt < now − R hari`, run ∉ `protectedRuns`, dan item ∉ `protectedItems`;
   - ditambah, bila `includeSecrets=false`, semua item `secrets` yang belum pruned tanpa melihat umur.
   - `checksums`/`manifest` run X jadi kandidat hanya bila semua item lain run X sudah pruned atau sedang jadi kandidat.
4. `applyPrune`:
   - `delete` per kandidat. Sukses → `pruned=true`. Gagal → dihitung `failed`.
   - `AccessDenied` pertama → hentikan sisa delete di run ini, beri `warning: retention_denied` pada item `manifest` run sekarang, dan hitung `denied` (K21).
   - Semua item run pruned → `pruned_at`. Audit `backup.prune`.
5. Edge: DB situs yang sudah dihapus → item terakhirnya dilindungi selamanya (disengaja, ditulis di README; hapus manual di bucket). Tidak ada `list` bucket.

### F4 — Unduh item

1. Item `secrets` butuh super_admin + sesi segar. Pruned → 410. Selain itu 302 presigned 15 mnt + audit `backup.download`.
2. Saat `keyMismatch`, UI menyembunyikan tombol dan server menjawab 409.

### F5 — Uji koneksi S3 (`POST /api/dev/backup/verify`)

1. Konfigurasi tersimpan belum lengkap → `not_configured`. Tidak terbaca (`KeyMismatchError`) → `unreadable`.
2. Langkah `write` PUT `<prefix>.panel-termux-check-<uuid>` (16 byte) → `read` `stat` = 16 → `delete`. Batas waktu 15 dtk → `timeout`.
3. Pemetaan kode S3 Bun:
   - `AccessDenied` di write → `write_denied`, di delete → `delete_denied`;
   - `NoSuchBucket` → `bucket_not_found`;
   - `ENOTFOUND` / `ECONNREFUSED` → `unreachable`;
   - lainnya → `s3_error`.
   - `detail` = pesan tersamar (`describe`, `backup.service.ts:27-31`).
4. Audit `backup.verify`.
5. `delete_denied` ditampilkan PLAN/05 sebagai: "Bisa menulis, tapi tidak bisa menghapus. Bila sengaja (token tanpa izin hapus), atur lifecycle rule di bucket; satu file uji kecil tertinggal."

### F6 — Boot (`boot.ts`, dirangkai `wkr-boot-03`)

1. `loadEnvOrExit` → `dataDir = resolve(env.PANEL_DATA_DIR)`, `panelDir = process.cwd()`.
2. `loadOrCreateSecret` → `{ secret, created }`.
3. `openDb` → `prevVersion = app_meta.panel_version`.
4. `snapshotBeforeMigrations`. Bila gagal (kecuali `PANEL_SKIP_SNAPSHOT=1`) → hapus file parsial, log, `sleep 60 dtk`, `exit(1)`.
5. `runMigrations` → tulis `panel_version`.
6. `checkDataKeyOnBoot(deps, created)`: `mismatch` → `log.error` + audit `secret.mismatch`.
7. `syncSuperAdminsOnBoot`; perubahan peran → audit `user.role_sync`.
8. `pruneAudit(db)` dan tandai restore `running` → `failed: interrupted by panel restart`.
9. Audit `panel.start`, server jalan, scheduler jalan.
10. Edge:

- install pertama → tanpa snapshot, `ok`;
- upgrade dari 0.2.x → snapshot `panel.db.unknown.<ts>` (belum ada `panel_version`);
- `secret` hilang → secret baru, `mismatch`, semua sesi lama tidak valid (HMAC beda), pemilik login ulang dan melihat masalah merah.

### F7 — Kunci data tidak cocok → pulih

1. Masalah `key_mismatch` muncul di Ringkasan dan Kesehatan sistem.
2. Jalan **A (disarankan)**, mengembalikan file lama:

   ```sh
   SVDIR=$PREFIX/var/service sv down panel
   cp <file-lama> ~/panel/data/secret && chmod 600 ~/panel/data/secret
   SVDIR=$PREFIX/var/service sv up panel
   ```

   Status otomatis `ok` karena semua baris terbaca lagi.
3. Jalan **B**, reset:
   - "Hapus pengaturan rahasia lama" (typed `hapus`, sesi segar);
   - hapus baris tidak terbaca → audit `secret.reset {keys}`;
   - pemilik mengisi ulang key yang terdaftar di `unreadableSettings` (Cloudflare, S3, Telegram, …).
4. Selama mismatch:
   - simpan setting rahasia → 409 `key_mismatch`, dan Pengaturan (PLAN/05) menampilkan tautan ke Kunci data;
   - cadangan 409;
   - job situs yang butuh token → 409 `key_mismatch` (PLAN/03);
   - overview tidak pernah 500;
   - tidak ada notifikasi Telegram (token ikut terkunci; ditulis jujur di kartu).
5. Edge: sesi tidak segar → 403 `reauth_required` → "Masuk ulang" (`signIn.social` dengan `callbackURL` halaman ini). Sesi lama tetap ada di daftar Sesi (bisa dicabut).

### F8 — Unduh kunci data

1. Sesi segar → dialog confirm → POST → simpan blob.
2. Server menulis `secret_exported_at` dan audit `secret.export`.
3. Onboarding PLAN/05 item "Simpan kunci data" selesai otomatis bila `exportedAt !== null`. Centang manual tetap ada. Teksnya kondisional terhadap `includeSecrets` (X28).

### F9 — Sesi

1. Super_admin "Keluarkan dari semua perangkat" (PLAN/05) → `revokeUserSessions`. Boleh untuk semua target **kecuali diri sendiri** (409 `self`), termasuk super admin env (B6). Peran tidak berubah. Audit `session.revoke {scope:"user", userId, revoked}`.
2. **Keluarkan semua pengguna** (kartu Sesi di Kesehatan, tier confirm) → `revokeAllSessions(db, currentSessionId)` → audit `session.revoke_all {count}`.
3. **Umur absolut**: setiap request terautentikasi lewat `getSessionChecked`; sesi dengan `createdAt` > 30 hari dihapus → 401 → UI ke `/login`.
4. Sign-out → `handleAuthRequest` membaca user sebelum meneruskan, lalu bila 2xx → `auth.sign_out`.
5. Callback gagal → hanya log agregat (§3.8).
6. Akun baru → `auth.account_created` (hook `user.create.after`).

### F10 — Pulihkan ke database baru (+ uji pemulihan)

1. Admin klik **Pulihkan ke database baru** pada item `database` (di "Cadangan terakhir per item" atau riwayat) → dialog tier confirm (§5.1).
2. Server memeriksa:
   - item harus `kind=database`, `ok`, `!pruned` → selain itu 400 `not_database` / 410 `pruned`;
   - lock bersama dengan run (`busy` → 409);
   - `keyMismatch` → 409.
3. Nama target `<nama dipotong>_r<yyyymmddHHMM>` (≤ 63 karakter, `SQL_IDENT_RE`); bila sudah ada, ditambah `_2`, `_3`.
4. Cek ruang: bebas ≥ 3 × `sizeBytes` + 256 MB, kalau tidak 409 `insufficient_space` **sebelum** insert. Insert `backup_restore` `running` → 202 `BackupRestoreStarted`.
5. Latar:
   1. unduh objek ke temp (`Bun.write(tmp, client.file(key))`, fallback stream);
   2. sha256 harus sama dengan item → selain itu `checksum_mismatch`. Bila `sha256` null (baris lama), cek dilewati dan dicatat;
   3. `restoreInto(tmp, target, owner)`, dengan owner = pemilik DB sumber dari `listDatabases()` bila role-nya ada, selain itu `postgres`;
   4. hitung tabel → `succeeded` + `table_count`, atau `failed` + `error_code`;
   5. audit `backup.restore`, hapus temp.
6. UI polling restores tiap 3 dtk selama ada yang `running`. Selesai → "Siap: N tabel" + `useHint`: "Untuk dipakai situs, hubungkan lewat halaman situs. Database yang dipakai situs tidak bisa dihapus dari sini."
7. **Hapus database uji** (typed: ketik `targetDb`):
   - `DELETE …/restores/:id/database {confirm}`;
   - ditolak 409 `in_use` bila `site.database = targetDb`, `already_dropped`, atau `restore_running`;
   - selain itu `dropDatabase(target)` (role tidak disentuh, hanya nama yang tercatat di `backup_restore`) + `dropped_at` + audit `backup.restore_drop`.
8. Run cadangan (F2) melewati DB yang ada di `backup_restore` dengan `dropped_at IS NULL` **dan** tidak dipakai `site.database`. Setelah dipakai situs, DB itu dicadangkan seperti DB lain.
9. Edge:
   - restart di tengah → saat boot, restore `running` → `failed: interrupted` (tampil "Terputus"), dan DB setengah jadi tetap bisa dihapus;
   - dua admin bersamaan → yang kedua 409 `busy`;
   - restart `panel` ditolak selama `backup.busy()` (PLAN/02).

### F11 — Pulihkan ke HP baru (runbook README + `manifest.restoreSteps`)

Asumsi: HP baru bersih, pemilik punya akun Cloudflare (dashboard + R2), akun Google Cloud (OAuth client), satu laptop atau HP lain untuk login web, dan **tidak** punya file dari HP lama kecuali yang ada di bucket (`include_secrets=off`, tanpa file kunci data). Variabel contoh: bucket `BUCKET`, prefix `panel-termux/`, nama server `poco2`. Setiap blok dijalankan di Termux HP baru kecuali disebut lain.

0. **HP lama masih hidup** (pindah HP, bukan hilang). Matikan konektor tunnel di sana agar trafik tidak terbagi:

   ```sh
   export SVDIR=$PREFIX/var/service
   sv down cloudflared panel pm2
   touch $SVDIR/cloudflared/down $SVDIR/panel/down $SVDIR/pm2/down
   ```

   Bila HP lama hilang atau dicuri, jalankan runbook insiden §8.3 lebih dulu, lalu lanjut di sini dengan **kunci data baru** (langkah 10, jalan tanpa kunci).
1. **Aplikasi Android**: pasang Termux, Termux:Boot, dan Termux:API dari F-Droid/GitHub (README server-termux langkah 1). Buka Termux.
2. **Alat pulih**:

   ```sh
   pkg upgrade -y && pkg install -y git rclone cloudflared
   ```

3. **Token R2 baca-saja**: di dashboard Cloudflare → R2 → Manage API tokens → buat token **Object Read only** untuk bucket `BUCKET`. Catat Access Key ID, Secret Access Key, dan endpoint `https://<account>.r2.cloudflarestorage.com`. Di Termux, ketik nilainya sendiri; perintah ini tidak mencetak secret:

   ```sh
   export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
   export RCLONE_CONFIG_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   read -r RCLONE_CONFIG_R2_ACCESS_KEY_ID; read -rs RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
   export RCLONE_CONFIG_R2_ACCESS_KEY_ID RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
   ```

4. **Pilih run & unduh**. Folder = tanggal, dan satu run = satu awalan `HHMMSS-`. Pilih stem terbaru yang punya `manifest.json`:

   ```sh
   rclone lsf r2:BUCKET/panel-termux/ | tail -3              # mis. 2026-11-26/
   rclone lsf r2:BUCKET/panel-termux/2026-11-26/ | grep manifest   # mis. 030012-manifest.json
   mkdir -p ~/pulih && cd ~/pulih
   rclone copy r2:BUCKET/panel-termux/2026-11-26/ . --include '030012-*'
   sha256sum -c 030012-SHA256SUMS      # semua harus "OK"; bila tidak, pilih run lain
   cat 030012-manifest.json            # catat paths, appBaseUrl, tunnel, sites, postgresVersion
   ```

5. **File situs dan konfigurasi tunnel**. Ini harus dilakukan **sebelum** installer server, karena installer membuat `ecosystem.config.js` kosong bila belum ada dan memeriksa tunnel bila `config.yml` ada. Folder tujuan harus belum ada atau kosong:

   ```sh
   mkdir -p ~/sites && tar -xzf 030012-sites.tar.gz -C ~/sites          # paths.sitesDir dari manifest
   mkdir -p ~/.cloudflared && tar -xzf 030012-cloudflared.tar.gz -C ~/.cloudflared
   ```

6. **Kredensial tunnel**. Nama berkas diambil dari `tunnel.credentialsFile` di manifest. Bila run berisi item `secrets`, cukup `tar -xzf 030012-secrets.tar.gz -C ~/pulih/secrets` lalu salin `<credentialsFile>` ke `~/.cloudflared/`. Bila tidak:

   ```sh
   cloudflared tunnel login                                   # buka URL, pilih domain → ~/.cloudflared/cert.pem
   cloudflared tunnel token --cred-file ~/.cloudflared/<credentialsFile> <tunnel.ref>
   chmod 600 ~/.cloudflared/<credentialsFile>
   cloudflared tunnel cleanup <tunnel.ref>                    # buang koneksi lama HP sebelumnya
   ```

   `tunnel token --cred-file` hanya untuk tunnel yang dibuat dengan cloudflared ≥ 2022.3.0. Untuk tunnel yang lebih tua: buat tunnel baru dengan nama lain, arahkan ulang setiap hostname (`cloudflared tunnel route dns -f <tunnel> <host>`), lalu ganti `tunnel:` dan `credentials-file:` di `config.yml`. DNS CNAME di Cloudflare tidak perlu diubah bila tunnel yang sama dipakai.
7. **Installer server** (memasang sshd, postgres dengan role `postgres`, pm2, dan service cloudflared; membiarkan `ecosystem.config.js` yang sudah dipulihkan):

   ```sh
   git clone https://github.com/makurosolusi/server-termux ~/server-termux
   sh ~/server-termux/install.sh poco2
   ```

   Ikuti "Android settings" yang dicetak installer, lalu reboot dan buka kunci HP sekali. Cek dengan `SVDIR=$PREFIX/var/service sv status postgres cloudflared pm2`: semua harus `run:`. Aplikasi pm2 akan **errored** sampai langkah 13 karena binary situs tidak dicadangkan.
8. **Role dan database Postgres**. Cocokkan `postgresVersion` di manifest dengan `psql -V`: major HP baru harus ≥ major lama.

   ```sh
   cd ~/pulih
   psql -U postgres -d postgres -f 030012-globals.sql        # "role "postgres" already exists" wajar
   for f in 030012-*.dump; do pg_restore -U postgres --create --exit-on-error -d postgres "$f"; done
   ```

9. **Pasang panel**: jalankan perintah pasang dari landing (PLAN/05 F9, `install.sh` rilis yang memverifikasi checksum). Installer berhenti dengan service `down` karena `.env` belum lengkap. Jangan isi `.env` dulu.
10. **Data panel**:

    ```sh
    export SVDIR=$PREFIX/var/service
    sv down panel 2>/dev/null; touch $SVDIR/panel/down          # pastikan panel tidak sedang jalan
    cp ~/pulih/030012-panel.db ~/panel/data/panel.db && chmod 600 ~/panel/data/panel.db
    rm -f ~/panel/data/panel.db-wal ~/panel/data/panel.db-shm ~/panel/data/secret
    ```

    Kunci data, **salah satu** dari:
    - (a) item `secrets` → `cp ~/pulih/secrets/secret ~/panel/data/secret` dan `cp ~/pulih/secrets/.env ~/panel/.env`;
    - (b) file kunci data unduhan → perintah `printf` yang ada di file itu;
    - (c) tidak punya → biarkan `secret` tidak ada. Panel membuat kunci baru dan masuk mode tidak cocok (langkah 12).

    `chmod 600 ~/panel/data/secret ~/panel/.env`.
11. **`.env` panel** (bila bukan dari item `secrets`). Edit `~/panel/.env`:
    - `APP_BASE_URL` = `appBaseUrl` di manifest, persis sama (redirect OAuth);
    - `GOOGLE_CLIENT_ID` = client lama (Google Cloud → Credentials);
    - `GOOGLE_CLIENT_SECRET` = secret lama bila tersimpan, kalau tidak "Add secret" di client itu lalu hapus yang lama setelah selesai;
    - `SUPER_ADMIN_EMAILS` = email kamu.

    Lalu jalankan ulang `install.sh` panel. Ini menghapus file `down`, menyalakan panel, dan menunggu `/api/health`. Panel menyala lagi sendiri setelah reboot berikutnya.
12. **Login dan kunci**: buka `APP_BASE_URL`, login Google.
    - Bila langkah 10 (c): Administrasi → Kesehatan sistem → Kunci data → "Hapus pengaturan rahasia lama", lalu Pengaturan → isi ulang token API Cloudflare, kunci R2 baru dengan izin baca/tulis/hapus (bukan token baca-saja dari langkah 3), dan token bot Telegram. Lalu "Uji koneksi".
    - Hapus token baca-saja langkah 3 di dashboard R2.
13. **Binary situs**: untuk setiap `sites[].needsBinary` di manifest, buka situs di panel → Deploy → unggah binary dari build-mu (CI/laptop). Deploy me-restart aplikasinya, dan pm2-runtime membaca `~/sites/ecosystem.config.js` sehingga `pm2 save` tidak perlu.
14. **Cek akhir**:
    - setiap hostname situs menjawab;
    - Ringkasan tanpa masalah merah;
    - dashboard Zero Trust → tunnel menampilkan **satu** konektor;
    - `rm -rf ~/pulih`, cabut konfigurasi rclone (`unset RCLONE_CONFIG_R2_*`);
    - jalankan "Cadangkan sekarang".

---

## 5. Spesifikasi UI

Komponen yang dipakai:

- dari `src/web/components`: `PageHeader`, `Section`, `StatusBadge`, `KeyValue`, `DataTable` (list kartu di < md, PLAN/01), `EmptyState`, `ErrorState`, `RowsSkeleton`, `HeaderSkeleton`, `RelativeTime`, `CopyButton`, `InlineCode`, `ConfirmAction` (tier `confirm`/`typed`, PLAN/01);
- dari `ui/*`: `dialog`, `input`, `label`, `button`, `sheet`.

Target sentuh ≥ 44 px di < md. Status memakai kamus PLAN/01: `key_mismatch` ("Kunci tidak cocok", danger) dan `interrupted` ("Terputus") ditambahkan di W0 (X8). File i18n baru di-import langsung; tidak ada edit ke `id.ts` (X17).

### 5.1 `/panel/backups` — Cadangan

**Desktop** (`max-w-4xl`, satu kolom):

1. `PageHeader` "Cadangan" + `t.subtitle`. Aksi **Cadangkan sekarang** nonaktif saat `!configured || running || keyMismatch`, dengan alasan di `aria-describedby`.
2. Banner (prioritas dari atas):
   - `keyMismatch` (danger; super_admin → tautan Kunci data, admin → "Minta Super Admin…");
   - belum diatur;
   - `includeSecrets` (warning permanen);
   - `!includeSecrets && exportedAt=null` untuk super_admin (info `t.status.noKeyCopy`).
3. `Section` "Status" (`KeyValue`):
   - Jadwal · Berikutnya · Retensi (`retentionValue`) · Batas per file;
   - Isi cadangan (daftar jenis) · **Tidak dicadangkan** (dari `excluded`);
   - Terakhir (+ badge).
4. `Section` "Cadangan terakhir per item" (`lastGood`):
   - kolom Item · Waktu · Ukuran · Pemeriksaan (badge "Diperiksa" dengan `title` `t.lastGood.checkedTitle`, atau muted "Belum diperiksa") · Aksi (Unduh, **Pulihkan ke database baru** untuk item database, ikon "Perintah pemulihan" → popover/`Sheet` berisi `InlineCode` + `CopyButton` + `restoreCommandHelp`);
   - umur > 36 jam → tone warning "Lebih dari 36 jam lalu";
   - item yang dicoba tetapi belum pernah berhasil → badge bad "Belum pernah berhasil".
5. `Section` "Riwayat cadangan" (`<details>` yang ada):
   - sha256 (12 karakter + `CopyButton`), badge pemeriksaan;
   - badge warning `t.itemWarnings[warning]`;
   - item pruned redup dengan "Dihapus oleh retensi" tanpa tombol;
   - error = `t.itemErrors[errorCode]` + detail kecil;
   - run `failed: interrupted` → badge "Terputus".
6. `Section` "Uji pemulihan" (di antara 4 dan 5): `DataTable` restores dengan kolom Waktu · Sumber → Target (`InlineCode`) · Status · Tabel · Aksi "Hapus database uji" (disembunyikan bila `droppedAt` ada, `inUse`, atau status `running`; `inUse` menampilkan teks `t.restores.inUse`). Kosong → `EmptyState` `t.restores.empty`. Baris "Uji pemulihan terakhir" di Status memakai `lastRestoreTest`.

**Dialog**:

- Pulihkan (confirm): judul `t.restore.title(name)`, isi `t.restore.body(target, at, size)`, tombol **Pulihkan ke database baru**.
- Hapus database uji (typed, ketik `targetDb`): judul `t.restores.dropTitle`, isi `t.restores.dropBody`, label `t.restores.dropLabel`, tombol merah **Hapus database**. Error diumumkan lewat `role="alert"`.

**Phone**: kartu bertumpuk, tombol penuh lebar, tombol header di bawah judul, perintah pulih di `Sheet` bawah.

**States**:

- loading → `HeaderSkeleton` + `RowsSkeleton`;
- error per section → `ErrorState` + "Coba lagi";
- kosong → `EmptyState` `t.runs.empty`;
- polling 3 dtk saat `running || restoring`, `aria-live="polite"`.

Pemetaan status → kunci kamus PLAN/01 ada di `src/web/backup/backup.status-key.ts` (§3.9 butir 1, B12).

### 5.2 Komponen keamanan `src/web/security/*` (ditanam PLAN/05 di Kesehatan sistem)

- **`DataKeyCard`** (`id="kunci-data"`):
  - status "Cocok"/"Tidak cocok", "Terakhir diunduh";
  - **Unduh kunci data** (confirm);
  - saat mismatch: daftar `unreadableSettings` dengan label dari `id.settings` PLAN/05, langkah A (`InlineCode` + `CopyButton`), **Hapus pengaturan rahasia lama** (typed `hapus`), dan catatan "Notifikasi Telegram tidak terkirim sampai kunci diperbaiki";
  - menangani `reauth_required` dengan tombol **Masuk ulang**.
- **`AccessStatusRow`** (`id="access"`).
- **`AdminTrustNote`**: dipakai PLAN/05 di dialog ubah peran dan halaman Pengguna.
- **`SessionsAdminCard`**: "N sesi aktif dari M pengguna · sesi berakhir paling lama 30 hari setelah masuk", tombol **Keluarkan semua pengguna** (tier **confirm**, X18).

### 5.3 Copy (`src/web/i18n/id.backup.ts`, `id.security.ts`)

```ts
// id.backup (tambahan/ubahan)
subtitle: "Cadangan harian database, panel, dan file situs ke penyimpanan R2/S3.",
errorCodes: {
  busy: "Pencadangan lain sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
  not_configured: "Pencadangan belum diatur. Isi pengaturan penyimpanan R2/S3 di Administrasi → Pengaturan.",
  key_mismatch: "Kunci data panel tidak cocok, jadi kunci penyimpanan tidak bisa dibaca. Periksa Kunci data di Administrasi → Kesehatan sistem.",
  pruned: "File ini sudah dihapus oleh retensi.",
  reauth_required: "Untuk aksi ini kamu perlu masuk ulang (sesi lebih dari 15 menit).",
},
status: { /* + */
  retentionValue: (days: number, keep: number) => `${days} hari, minimal ${keep} cadangan berhasil terakhir`,
  maxItem: "Batas per file",
  contents: "Isi cadangan",
  notBackedUp: "Tidak dicadangkan",
  keyMismatch: "Kunci data tidak cocok. Cadangan berhenti sampai kunci diperbaiki.",
  secretsIncluded: "Cadangan ikut menyimpan kunci rahasia panel (kunci data, .env panel, kredensial tunnel). Siapa pun yang bisa membaca bucket bisa mengambil alih panel ini. Batasi akses bucket.",
  noKeyCopy: "Kunci rahasia tidak ikut dicadangkan dan kunci data belum pernah diunduh. Tanpa salinan, token Cloudflare, kunci penyimpanan, dan token Telegram harus diisi ulang setelah pindah HP.",
},
excluded: {
  site_binaries: "Binary situs. Simpan file build-nya sendiri (CI atau laptop); setelah pindah HP, deploy ulang.",
  cloudflared_cert: "cert.pem Cloudflare. Bisa didapat lagi dengan cloudflared tunnel login.",
  secrets_off: "Kunci rahasia panel (kunci data, .env panel, kredensial tunnel).",
},
kinds: { database: "Database", globals: "Role Postgres", panel: "Database panel", sites: "File situs", cloudflared: "Konfigurasi tunnel", secrets: "Kunci rahasia", checksums: "Daftar checksum", manifest: "Daftar isi" },
lastGood: {
  title: "Cadangan terakhir per item",
  stale: "Lebih dari 36 jam lalu",
  never: "Belum pernah berhasil",
  checked: "Diperiksa",
  checkedTitle: "Struktur file dicek sebelum diunggah. Bukti bahwa cadangan bisa dipulihkan hanya dari latihan pemulihan.",
  unchecked: "Belum diperiksa",
  restoreCommand: "Perintah pemulihan",
  restoreCommandHelp: "Jalankan di Termux di HP tujuan, di folder tempat file cadangan disimpan. Perintah ini tidak menimpa data yang sudah ada. Langkah lengkap ada di README, bagian Pulihkan ke HP baru.",
},
itemErrors: {
  produce_failed: "File cadangan tidak bisa dibuat.",
  check_failed: "File cadangan rusak saat diperiksa, jadi tidak diunggah.",
  too_large: "File lebih besar dari batas per file.",
  insufficient_space: "Ruang penyimpanan HP tidak cukup untuk membuat file ini.",
  upload_failed: "Gagal mengunggah ke penyimpanan.",
  upload_mismatch: "Ukuran file di penyimpanan tidak sama dengan aslinya.",
  key_mismatch: "Kunci data tidak cocok.",
},
itemWarnings: {
  file_changed: "Disalin saat berubah. Bila aplikasi sedang menulis ke database SQLite-nya, salinan ini bisa tidak utuh.",
  outside_sites_dir: "Ada situs di luar folder situs. Folder itu tidak ikut dicadangkan.",
  retention_denied: "Token penyimpanan tidak boleh menghapus, jadi retensi diserahkan ke lifecycle rule bucket.",
},
runs: { /* + */ pruned: "Dihapus oleh retensi", checksum: "sha256", interrupted: "Terputus" },
restore: {
  button: "Pulihkan ke database baru",
  title: (name: string) => `Pulihkan ${name} ke database baru?`,
  body: (target: string, at: string, size: string) =>
    `Panel membuat database baru ${target} dari cadangan ${at}. Database aslinya dan situsnya tidak diubah. Proses ini memakai CPU dan sekitar ${size} ruang penyimpanan HP.`,
  started: "Pemulihan dimulai.",
},
restores: {
  title: "Uji pemulihan",
  lastTest: "Uji pemulihan terakhir",
  empty: "Belum ada uji pemulihan. Pulihkan satu database ke database baru untuk memastikan cadangannya bisa dipakai.",
  done: (n: number) => `Siap: ${n} tabel`,
  useHint: "Untuk dipakai situs, hubungkan lewat halaman situs. Database yang dipakai situs tidak bisa dihapus dari sini.",
  inUse: "Dipakai situs",
  drop: "Hapus database uji",
  dropTitle: (db: string) => `Hapus database ${db}?`,
  dropBody: "Database hasil pemulihan ini dihapus permanen. Cadangan dan database aslinya tetap aman.",
  dropLabel: (db: string) => `Ketik ${db} untuk konfirmasi`,
  dropConfirm: "Hapus database",
  dropped: "Database uji dihapus.",
  errors: {
    checksum_mismatch: "Isi file cadangan berbeda dari saat dibuat. Jangan pakai cadangan ini.",
    insufficient_space: "Ruang penyimpanan HP tidak cukup.",
    download_failed: "File cadangan tidak bisa diunduh dari penyimpanan.",
    restore_failed: "pg_restore gagal. Lihat detail di bawah.",
    in_use: "Database ini sekarang dipakai situs, jadi tidak bisa dihapus dari sini.",
  },
},

// id.security
dataKey: {
  title: "Kunci data",
  help: "Kunci data (data/secret) mengunci pengaturan rahasia dan sesi. Tanpa file ini, pengaturan rahasia di cadangan panel tidak bisa dibaca. Simpan salinannya di luar HP.",
  ok: "Cocok", mismatch: "Tidak cocok",
  mismatchBody: "Pengaturan di bawah disimpan dengan kunci data lain, biasanya karena file kunci hilang atau diganti. Pengaturan rahasia tidak bisa disimpan sampai ini diperbaiki.",
  noTelegram: "Notifikasi Telegram tidak terkirim sampai kunci diperbaiki, karena tokennya ikut terkunci.",
  restoreFile: "Cara terbaik: kembalikan file kunci data lama, lalu mulai ulang panel.",
  exportButton: "Unduh kunci data",
  exportTitle: "Unduh kunci data?",
  exportBody: "File ini membuka semua pengaturan rahasia panel. Setelah terunduh, pindahkan dari folder Unduhan ke pengelola kata sandi, lalu hapus dari Unduhan. Jangan simpan di HP ini atau di bucket cadangan.",
  exported: "Kunci data diunduh.",
  exportedAt: "Terakhir diunduh",
  never: "Belum pernah",
  resetButton: "Hapus pengaturan rahasia lama",
  resetTitle: "Hapus pengaturan rahasia yang tidak terbaca?",
  resetBody: (labels: string[]) => `${labels.join(", ")} dihapus dan harus kamu isi ulang di Pengaturan. Tidak bisa dibatalkan. Bila kamu masih punya file kunci data lama, kembalikan file itu saja.`,
  resetLabel: "Ketik hapus untuk konfirmasi",
  resetDone: "Pengaturan rahasia lama dihapus. Isi ulang di Pengaturan.",
  reauth: "Untuk aksi ini kamu perlu masuk ulang (sesi lebih dari 15 menit).",
  reauthButton: "Masuk ulang",
  freshNote: "Masuk ulang mencegah pemakaian cookie curian di perangkat lain, bukan akun Google yang diambil alih. Aktifkan verifikasi 2 langkah di akun Google-mu.",
},
access: {
  title: "Cloudflare Access",
  notHttps: "Tidak berlaku (alamat panel bukan https)",
  seen: "Terdeteksi",
  notSeen: "Belum terdeteksi. Path privat mungkin terbuka tanpa Access. Ikuti langkah 4 di README.",
},
sessions: {
  revokeUser: "Keluarkan dari semua perangkat",
  revokeUserTitle: (name: string) => `Keluarkan ${name} dari semua perangkat?`,
  revokeUserBody: "Ia harus masuk lagi. Perannya tidak berubah.",
  title: "Sesi",
  summary: (s: number, u: number) => `${s} sesi aktif dari ${u} pengguna. Sesi berakhir paling lama 30 hari setelah masuk.`,
  revokeAll: "Keluarkan semua pengguna",
  revokeAllTitle: "Keluarkan semua pengguna?",
  revokeAllBody: "Semua orang, termasuk kamu di perangkat lain, harus masuk lagi. Sesi di perangkat ini tetap.",
  revokedAll: (n: number) => `${n} sesi diakhiri.`,
},
adminTrust:
  "Admin punya kendali penuh atas HP ini. Admin bisa deploy program yang berjalan dengan akses yang sama seperti panel, sehingga bisa membaca semua file, database, dan kunci data, lalu menjadikan dirinya Super Admin. Program situs yang kamu deploy juga punya akses yang sama. Berikan peran Admin hanya ke orang yang kamu percayai seperti pemilik HP.",
```

---

## 6. Kriteria penerimaan

### Unit / integrasi (`bun test`, DB sementara, adapter fake, `tests/backup.s3mock.ts`)

**HTTP & CSRF**

- [ ] `csrf.origin` (dimigrasi ke `servePanel`/`createApiHandler`): semua kasus BAD tetap **403** `forbidden_origin` (tidak boleh dilonggarkan menjadi 401). Kasus settings memakai `PATCH /api/dev/settings`.
- [ ] `server.http`:
  - 61 POST asing lalu 1 POST sah → 200;
  - `Host: other.example.com` → 421;
  - POST `/api/me/sessions/revoke-others` ke-61 dalam 1 mnt → 429;
  - 100 POST asing dari satu origin dalam 1 mnt → maksimal 2 baris log `[csrf]`;
  - `/api/*` punya `cache-control: no-store`.
- [ ] `server.serve` (binary `build:local`):
  - aset ber-hash → `immutable` + `nosniff`;
  - chunk tidak ada → 404 `no-store` text;
  - HTML → `no-cache` + CSP;
  - `/__spa` → bukan bundle mentah (404 + `noindex`).

**Retensi & isi run**

- [ ] `backup.retention` (murni):
  - run `partial` **memangkas** item lama, tetapi item `b` terakhir yang ok tetap ada;
  - 3 run sukses terbaru utuh;
  - `includeSecrets=false` → semua item `secrets` menjadi kandidat tanpa melihat umur;
  - `checksums`/`manifest` dihapus terakhir;
  - kunci di luar `backup_run` tidak pernah muncul;
  - urutan rowid: run dengan `startedAt` 2030 yang di-insert lebih dulu tidak dianggap terbaru.
- [ ] `backup.api`:
  - item `globals`, DB, `sites`, `cloudflared`, `panel`, `checksums`, `manifest` dalam urutan itu; `secrets` hanya bila on;
  - `SHA256SUMS` hasil mock lolos `sha256sum -c` di temp dir;
  - manifest memuat `paths`, `tunnel`, `sites[].needsBinary`, `restoreSteps`.
- [ ] `backup.items` (arsip):
  - `sites/a/data/app/x.txt` **ada**; `sites/a/app`, `app.prev`, `app.new`, `.app.swap`, `node_modules` (level situs) **tidak ada**;
  - `apps.json` dan `ecosystem.config.js` ada;
  - `cloudflared` tanpa `cert.pem`;
  - situs dengan `dir` di luar → `outside_sites_dir`.
- [ ] `backup.api`:
  - `> MAX_ITEM_MB` → `too_large` tanpa PUT;
  - `statfs` kecil → `insufficient_space`;
  - `stat` beda → `upload_mismatch` + DELETE;
  - mock menolak DELETE di prune → `retention_denied`, status tetap `succeeded`.
- [ ] `backup.api`:
  - unduh `secrets`: admin → 403; super_admin sesi lama → 403 `reauth_required`; super_admin sesi segar → 302;
  - item pruned → 410.
- [ ] `backup.verify`:
  - mock menolak DELETE → `code:"delete_denied", failedStep:"delete"`;
  - kredensial tidak ada di response, log, atau audit (scan string).

**Kunci data, snapshot & migrasi**

- [ ] `data-key`:
  - hapus `secret` + boot → `mismatch`, baris rahasia masih ada;
  - overview 200 dengan `key_mismatch`; run → 409;
  - **simpan S3 → 409 `key_mismatch`**; simpan Telegram (baris belum ada) → 409;
  - kembalikan file + boot → `ok`, semua terbaca;
  - reset: tanpa sesi segar → 403; confirm salah → 400; benar → baris terhapus, audit `secret.reset`;
  - scheduler maksimal 1 warn per hari (jam palsu 3 hari → 3 baris).
- [ ] `db.snapshot`:
  - migrasi tertunda → file 600 lolos `quick_check`;
  - yang ke-4 menghapus yang tertua;
  - DB baru → tidak ada snapshot;
  - folder read-only → file parsial dihapus dan `exit 1` setelah sleep (sleep di-stub), kecuali `PANEL_SKIP_SNAPSHOT=1`.
- [ ] `db.migrate`: DB 0.2.2 berisi data → `actor_kind` `user` (+label) / `system` / `unknown`, sesuai backfill.

**Audit & sesi**

- [ ] `auth` / `audit`:
  - user dihapus → `actorDeleted=true`, `actorLabel` = nama lama;
  - `auth.sign_out`, `auth.account_created`, `user.role_sync` tercatat;
  - callback error → **tidak** ada baris audit, ada log agregat;
  - `request_id` sama dengan header `x-request-id`; `ip_masked` berakhiran `.x`;
  - `action=user.&action=backup.run` → OR yang benar; `user_` tidak cocok `user.`.
- [ ] `sessions`: `revokeUserSessions` mencabut semua sesi user itu, termasuk super admin env; diri sendiri → 409 `self`. `revokeAllSessions` menyisakan tepat sesi pemanggil. Sesi dengan `createdAt` 31 hari lalu → 401 dan baris terhapus.
- [ ] `backup.restore`: restore → `succeeded` + `tableCount`; sha256 diubah di mock → `checksum_mismatch`; restore saat run → 409 `busy`; DELETE confirm salah → 400; target dipakai `site.database` → 409 `in_use`; benar → `dropDatabase(target)` (bukan nama sumber); boot dengan restore `running` → `failed`; run cadangan melewati DB uji yang tidak dipakai situs.
- [ ] `audit.prune`: baris 400 hari terhapus, baris 300 hari tetap, audit `audit.prune` tercatat.
- [ ] `backup.verify`: body draft (endpoint lain) dipakai tanpa disimpan; `steps` berisi tepat write/read/delete, dengan `skipped` setelah gagal.
- [ ] `settings` (spec untuk `wkr-settings-01`): `PATCH` menyalakan `include_secrets` / mengubah `s3_endpoint` dengan sesi lama → 403 `reauth_required`.
- [ ] `panel.api`: `recentActivity` tanpa `auth.*` / `session.*`.
- [ ] `restoreHint`: tanpa `--clean`, path absolut, `SVDIR=` untuk `sv`.

### UI-QA di browser (390 px dan 1280 px, terang dan gelap; izin pemilik, Rule 1)

- [ ] `/panel/backups` pada keadaan belum diatur / kosong / berjalan / sukses / partial / key mismatch / secrets on / tanpa salinan kunci: banner dan teks sesuai §5.3, baris "Tidak dicadangkan" terlihat, tanpa scroll horizontal di 390 px.
- [ ] Kartu kunci data: mismatch menampilkan label setting dan pesan Telegram; reset typed; "Masuk ulang" muncul untuk `reauth_required`.

### Gerbang rilis v0.3.0 (operasional)

- [ ] `curl -sI https://panel.<domain>/chunk-<hash>.js` → `immutable` + `nosniff`. POST dengan `Origin` asing → 403 (atau tantangan Access).
- [ ] Satu run nyata ke R2: semua item "Diperiksa", `stat` cocok, `sha256sum -c` lolos pada unduhan rclone.
- [ ] **Latihan penuh F11** dengan `include_secrets=off` di HP/emulator kedua, langkah 0–14 persis seperti tertulis. Checklist hasil di CHANGELOG:
  - situs X menjawab lewat hostname;
  - DB X berisi N baris (sama dengan HP lama);
  - super_admin aktif;
  - token Cloudflare/R2/Telegram diisi ulang;
  - panel dan pm2 menyala sendiri setelah reboot;
  - dashboard tunnel menampilkan satu konektor.

  Setiap langkah yang harus diubah saat latihan langsung diperbaiki di README dan `restoreSteps` sebelum rilis.

---

## 7. Rencana kerja

Mengikuti jadwal global kritik integrasi §5 (satu pemilik per file per gelombang). Worker PLAN/04 ditandai **(04)**. Worker lain mengerjakan bagian PLAN/04 berdasarkan spec di dokumen ini.

| Gelombang | Worker                          | Bagian PLAN/04 yang dikerjakan                                                                                                                                                                                                                  | File                                                                                                                                                                                       |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W0        | orkestrator                     | Merge `main` (`112de15`) → branch; `api.routes.ts` = versi branch + `.onRequest` dari main; `bun test` hijau                                                                                                                                    | `api.routes.ts`, test main                                                                                                                                                                 |
| W0        | orkestrator / worker refactor   | Pecah `index.ts` → `boot.ts` + `http/spa.serve.ts` (tanpa perilaku baru)                                                                                                                                                                        | –                                                                                                                                                                                          |
| W0        | `wkr-contracts-00`              | §3.1–3.3, §3.8, kode Problem §3.9, `SITE_BINARY_NAMES` (03), `ApiError` 410/421                                                                                                                                                                 | `src/shared/*`, `http.error.ts`                                                                                                                                                            |
| W1        | `wkr-db-01`                     | Migrasi `0006_data_safety` + schema (§3.4), lalu 0007 (03) dan 0008 (02)                                                                                                                                                                        | `db/schema/*`, `drizzle/*`, `tests/db.migrate.test.ts`                                                                                                                                     |
| W1        | `wkr-http-01`                   | K1, K2, K11 (`request.context`), K16, K17, `no-store`                                                                                                                                                                                           | `http/{api.handler,spa.serve,request.context,security.headers}.ts`, `routes/origin.guard.ts`, `routes/api.routes.ts`, `tests/{server.http,server.origin,csrf.origin,server.serve}.test.ts` |
| W1        | `wkr-settings-01`               | §3.5 (1 key, `KeyMismatchError`, `unreadableSecretSettings`, blokir simpan, `assertFresh` di `PATCH`; fungsi `assertFresh` di-stub sampai W2, signature dari §3.7)                                                                              | `settings.service.ts`, rute settings                                                                                                                                                       |
| W1        | `wkr-adapters-01`               | §3.7 adapter (`dumpGlobals`, `verifyDump`, `serverVersion`, `restoreInto`, `dropDatabase`, `ArchiveAdapter`) + fake                                                                                                                             | `src/server/system/*`                                                                                                                                                                      |
| W1        | `wkr-mon-rules-01`              | Aturan §3.9 butir 1                                                                                                                                                                                                                             | `overview.problems.ts`                                                                                                                                                                     |
| W1        | `wkr-dist-01`                   | Gerbang §3.9 butir 3; preflight + rollback hint di `install-phone.sh`; PLAN/04 me-review diff                                                                                                                                                   | `.github/*`, `scripts/*install*`                                                                                                                                                           |
| W2        | **`wkr-keys-02` (04)**          | K8, K9, F7, F8, route `POST /api/dev/sessions/revoke-all` di `security.routes.ts`                                                                                                                                                               | `secret.ts`, `data-key.service.ts`, `db/snapshot.ts`, `routes/security.routes.ts`, `tests/{secret,data-key,db.snapshot}.test.ts`                                                           |
| W2        | **`wkr-audit-02` (04)**         | K11 (isi kolom), K12, K13 (`pruneAudit`), K14 (`assertFresh`, `getSessionChecked` 30 hari, `revokeUserSessions` B6, `revokeAllSessions`), F9, §3.8                                                                                              | `audit.service.ts`, `auth/*`, `routes/me.routes.ts`, `tests/{auth,me.sessions,audit}.test.ts`                                                                                              |
| W2        | **`wkr-backup-engine-02` (04)** | K3–K7, K10, K20, K21, F2–F5, F10 (`backup.restore.ts` + route restores), `lastGoodItem`, `busy`, `lastTickAt`, panggil `pruneAudit` di tick harian                                                                                              | `backup/*`, `tests/backup.*.test.ts`, `tests/backup.s3mock.ts`                                                                                                                             |
| W3        | `wkr-boot-03`                   | F6 (urutan boot), mount `security.routes`, `handleAuthRequest` di `api.routes.ts`                                                                                                                                                               | `boot.ts`, `api.routes.ts`                                                                                                                                                                 |
| W3        | **`wkr-backup-web-03` (04)**    | §5.1–5.3 (termasuk Uji pemulihan, `SessionsAdminCard`, `backup.status-key.ts`)                                                                                                                                                                  | `src/web/backup/*`, `src/web/security/*`, `id.backup.ts`, `id.security.ts`, `tests/web.{backup,security}.test.ts`                                                                          |
| W4        | `wkr-docs-final-04`             | README "Cadangan dan pemulihan" + "Pulihkan ke HP baru" (F11 verbatim) + insiden §8.3 + Keamanan (model kepercayaan, CSRF, sesi segar, Access, 2-Step, opsi token tanpa hapus); CHANGELOG + hasil latihan; `.env.example` `PANEL_SKIP_SNAPSHOT` | docs                                                                                                                                                                                       |

Ukuran PLAN/04 di v0.3.0 (lingkup penuh A8): sekitar 2.300 baris termasuk test (4 worker 04 + spec titipan). Fitur yang sempat ditunda (pulihkan ke DB baru, sesi absolut + keluarkan semua, retensi audit) tetap di v0.3.0 di gelombang W2/W3.

**Tabel permintaan PLAN lain → jawaban**

| Dari | Permintaan                                                                    | Jawaban                                                       |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 01   | Implementasi §3.12                                                            | Diterima: K16 oleh `wkr-http-01`                              |
| 02   | Aturan `backup_*` di `overview.problems.ts`; tanpa kanal kedua                | Diterima: §3.9; `backup.events.ts` dihapus                    |
| 02   | `DatabaseInfo.lastBackupAt`                                                   | `lastGoodItem(db,"database",name)?.at`                        |
| 03   | `lastSuccessfulBackupOf(database)`                                            | Diganti `lastGoodItem` (bentuk berbeda, isi sama)             |
| 03   | Pengecualian `app.new`, `.app.prev.drop`, `.app.swap`                         | Diterima: `SITE_BINARY_NAMES` (K20)                           |
| 03   | `KeyMismatchError` → 409 di job; `database_drop` menolak saat `backup.busy()` | Diterima                                                      |
| 05   | `AuditAction` di `src/shared`, `setup.update`, `backup.verify`, `action[]`    | Diterima (W0 + §3.6)                                          |
| 05   | `beat()` di backup service                                                    | Ditolak (X30): `backupScheduler.lastTickAt()`                 |
| 05   | `describe()` diekspor                                                         | Tidak perlu: `backup.verify.ts` di backup engine              |
| 05   | Snapshot di installer                                                         | Ditolak: boot (K9); installer = preflight + petunjuk rollback |
| 05   | Uji S3 `POST /api/dev/backup/verify` bentuk 05                                | Diterima, implementasinya di sini                             |

---

## 8. Risiko, asumsi, pertanyaan terbuka

### 8.1 Risiko

1. **`include_secrets=off` menambah langkah DR** (token R2 baca-saja, `.env` baru, kredensial tunnel, reset kunci). Mitigasi: runbook F11 diuji penuh sebagai gerbang rilis, ditambah unduh kunci data, banner `noKeyCopy`, dan item onboarding.
2. **Multipart upload Bun untuk dump besar** belum terbukti terhadap R2. Mitigasi: uji run nyata ≥ 100 MB sebelum rilis, dan `MAX_ITEM_MB` membatasi.
3. **SQLite situs disalin `tar` apa adanya** → `warning: file_changed`. Jujur di UI dan README.
4. **Blokir simpan rahasia saat mismatch** bisa terasa mengunci. Pesan 409 menautkan ke Kunci data, dan dua jalan keluarnya jelas.
5. **Snapshot memblokir boot** saat disk penuh. `sleep 60` + preflight installer + env escape.
6. **Retensi tidak menghapus objek yatim**, dan lifecycle rule (opsi K21) tidak menjamin item valid terakhir. Keduanya ditulis jujur di README.
7. **Proksi bundle internal** menambah satu hop loopback per aset. Aset `immutable` hanya diambil sekali per versi.
8. **`tunnel token --cred-file`** hanya untuk tunnel ≥ cloudflared 2022.3.0. Untuk tunnel tua, runbook menyediakan jalan buat tunnel baru dengan `route dns -f`.

### 8.2 Asumsi

- HP baru disiapkan dengan `server-termux/install.sh` (role `postgres` trust di socket). Bila tidak, langkah 8 memakai superuser bootstrap (`psql -d postgres`), dan ini dicatat di README.
- `rclone` dan `cloudflared` tersedia di repo Termux (dicek saat latihan).
- `Bun.write`/`stat` S3 diverifikasi di W2 (Rule 20).
- `actions/attest` v4: SHA dipin saat implementasi.
- LICENSE MIT milik PLAN/05.

### 8.3 Runbook insiden HP dicuri (README)

1. Zero Trust → hapus konektor/tunnel HP lama dan cabut sertifikat akun (`cert.pem`).
2. Putar token API Cloudflare.
3. R2 → buat token baru, cabut yang lama, lalu cek objek cadangan masih ada.
4. Google Cloud → tambah client secret baru, hapus yang lama.
5. F11 dengan kunci data **baru** (langkah 10 c), lalu reset dan isi ulang token.
6. Putar `.env` situs yang berisi rahasia pihak ketiga.

### 8.4 Threat model

| Aktor                                        | Bisa apa                                                                               | Mitigasi                                                                                                                                                                        | Sisa risiko                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Internet anonim                              | Landing, `/login`, `/api/health`, `/api/auth/*`                                        | Header §3.12, `/__spa` 404, host check                                                                                                                                          | Bug Better Auth                                |
| Akun Google mana pun (`user`)                | `/profile`, `/api/me*`                                                                 | Peran di server, rate limit `/api/me`, audit akun baru                                                                                                                          | Spam akun (keputusan pemilik 4)                |
| Situs yang di-host / XSS di dalamnya         | POST tanpa body ke panel                                                               | K1 sebelum rate limit                                                                                                                                                           | –                                              |
| Admin                                        | Setara pemilik HP                                                                      | Teks jujur, audit IP/UA                                                                                                                                                         | Disengaja                                      |
| **Akun Google super_admin diambil alih**     | Login (login terbuka), sesi segar otomatis, unduh kunci, nyalakan secrets, ubah bucket | README: 2-Step/passkey wajib di akun super admin; kebijakan Access dengan faktor kedua (One-time PIN ke email lain / device posture); audit + masalah `backup_secrets_included` | Tanpa faktor kedua di Access: ambil alih total |
| **Binary situs disusupi** (dependency situs) | Baca `data/secret`, `panel.db`, kunci S3; hapus cadangan                               | Teks `adminTrust`; opsi token R2 tanpa hapus (K21)                                                                                                                              | Satu uid Termux, tanpa sandbox                 |
| Cookie laptop dicuri                         | Sesi 7 hari sliding                                                                    | Sesi segar untuk aksi kunci/cadangan, cabut sesi per pengguna/semua, umur absolut 30 hari                                                                                       | Aksi biasa admin tetap bisa                    |
| HP dicuri/hilang                             | Semua file, termasuk kunci S3 yang bisa menghapus cadangan                             | Runbook §8.3, cadangan off-device, opsi token tanpa hapus                                                                                                                       | Tanpa opsi K21: cadangan bisa dihapus          |
| Bucket/kunci S3 bocor                        | Baca PII, dump; hapus cadangan                                                         | Secret tidak ikut secara default                                                                                                                                                | Data aplikasi terbaca sampai `age` (P2)        |
| Dependency jahat / rilis disusupi            | Kode di binary                                                                         | Gerbang §3.9 butir 3                                                                                                                                                            | Akun GitHub pemilik disusupi                   |
| Proses lain di HP (loopback)                 | Palsukan `cf-connecting-ip` / header Access                                            | Header hanya untuk tampilan/IP sesi                                                                                                                                             | –                                              |
| Access mati/salah konfigurasi                | Path privat sampai login panel                                                         | Peran di server, `access_not_seen` (info), host check                                                                                                                           | Access opsional (keputusan pemilik 5)          |

### 8.5 Pertanyaan terbuka untuk pemilik

1. **Token R2 tanpa izin hapus + lifecycle rule**: default = opsi P1 yang didokumentasikan, tidak dipaksakan (K21). Mau dijadikan cara yang dianjurkan di onboarding?
2. **Binary situs**: default = tidak dicadangkan (UI menyatakannya). Apakah build situsmu selalu tersimpan di luar HP? Bila tidak, opsi "simpan binary terakhir" (~89 MB per situs per run) bisa ditambah.
3. Jendela sesi segar 15 menit sudah pas?

---

## Riwayat revisi

- **r1** (2026-11-26): rencana awal.
- **r2** (2026-11-26, setelah debat; rincian per temuan di `PLAN/debate/04-response.md`):
  - **Kunci data**: `secret_check` dihapus, diganti coba-dekripsi per baris, dan simpan setting rahasia diblokir saat mismatch (C1, C25).
  - **Runbook F11** ditulis ulang 14 langkah terhadap `server-termux/install.sh` + installer panel: rclone dengan token baca-saja, `SHA256SUMS`, pulihkan `sites`/`cloudflared` sebelum installer server, `tunnel token --cred-file` + `cleanup`, satu konektor, file `down`, isi `.env`, reset kunci. Latihan penuh menjadi gerbang rilis (C2, C12).
  - **Retensi**: prune setelah `partial` juga; `secrets` dibersihkan saat dimatikan; urutan rowid; opsi token tanpa hapus (`retention_denied`) (C3, C4, C16, K21).
  - **Arsip situs** tanpa `--exclude`: daftar entri level 1 + `SITE_BINARY_NAMES` (C9). Manifest ditambah path, versi Postgres, tunnel, situs, dan `restoreSteps`, plus `SHA256SUMS` (C13). Urutan item: `panel` dibuat sesudah item lain (C14). "Diperiksa" (C15). `warning` item dan perkiraan ruang (C21).
  - **Sesi segar** diperluas ke item `secrets`, switch secrets, dan bucket/endpoint/prefix (C6). `auth.sign_in_failed` diganti log agregat (C17). Throttle log CSRF dan migrasi `csrf.origin.test.ts` (C18).
  - **Kontrak**: `notify()` / `backup.events.ts` / `backup.problems.ts` dihapus; kode Problem + `ProblemKind "security"` diusulkan ke PLAN/02 (C7, X10). Pipeline rilis dan nama aset milik PLAN/05 dengan gerbang keamanan dari sini (C8, X1). Uji S3 = bentuk PLAN/05 di `/api/dev/backup/verify` (X4). Cabut sesi pengguna mengikuti aturan PLAN/05 (X11). `accessSeen` sumber tunggal (X12). `lastGoodItem` (X27).
  - **Header aset**: K17 r1 dibatalkan karena pengukurannya salah (tanpa `--compile`), diganti penyaji bundle internal + tabel PLAN/01 §3.12 (X5, K16).
  - **Rencana kerja**: mengikuti jadwal global (C11, X3, X6, X7, X21). Migrasi diberi breakpoint (X26). Gelombang 0 = merge main → branch, karena hotfix sudah di main/produksi (C18, X15).
  - **Penyederhanaan**: tiga setting dijadikan konstanta (C24). "Keluarkan semua pengguna" = confirm (X18). Fitur pulihkan ke DB baru, umur sesi absolut, dan retensi audit ditunda ke v0.3.1 (X29, menunggu pemilik). C5 dimasukkan ke spec v0.3.1.
  - **Threat model**: ditambah akun Google super_admin diambil alih dan binary situs disusupi (C19). Kejujuran UI: "Tidak dicadangkan", `noKeyCopy`, `resetBody` dinamis, `SVDIR`, peringatan folder Unduhan (C20). Snapshot: hapus file parsial + `sleep 60` (C23). Tabel keputusan tanpa `|` di backtick (C22).
- **r3** (2026-11-26, selaras `PLAN/DECISIONS.md`):
  - **A8 lingkup penuh**: "Pulihkan ke database baru" + tabel `backup_restore` (masuk migrasi `0006_data_safety`), umur sesi absolut 30 hari + "Keluarkan semua pengguna", dan retensi audit 365 hari kembali ke v0.3.0. Tipe, endpoint, F10, UI, copy, test, dan rencana kerja dilengkapi. Tidak ada lagi kolom v0.3.1.
  - **B2**: PLAN/04 hanya menyediakan input untuk `overview.problems.ts`; tanpa `notify()`, `backup.events.ts`, `backup.problems.ts`.
  - **B4**: `access_not_seen` dan `backup_not_configured` = severity **info**.
  - **B6**: cabut sesi pengguna lain diizinkan untuk semua target kecuali diri sendiri (409 `self`), termasuk super admin env.
  - **B7**: `BackupVerify` + `steps[]`, body draft opsional; tanpa langkah `list` karena retensi tidak pernah me-list bucket.
  - **B9**: `actions/attest@v4` dipin SHA dan uji `workflow_dispatch dry_run` sebelum tag. **B12**: `backup.status-key.ts`, `interrupted` = warning. **B15**: `IF NOT EXISTS` untuk tabel/index. **B10/B11/B17** sudah sesuai r2.
