# R&D 04 — Keamanan data, keamanan akses & cadangan

Worker: `wkr-rnd-safety-01` · Branch `feature/production-polish` @ `2a55c8b` · Tanggal 2026-11-26
Status: dokumen riset. Tidak ada kode yang diubah. Istilah mengikuti `docs/content-guide.md` (Cadangan, Pulihkan, Sesi, Peran, Administrasi, Pengguna).

Metode: membaca kode (dikutip `file:baris`), dua probe sementara dengan `bun test` di temp dir (file probe dihapus lagi), `curl` read-only ke produksi `https://panel.malikkurosaki.com`, beberapa perintah read-only `ssh poco` (izin file dan daftar ingress saja, tanpa isi secret), `bun audit`, dan docs publik Coolify, Railway, Render dan Vercel (URL di §3).

---

## 1. Ruang lingkup

| Area                     | Fitur / API                                                                                             | Kode utama                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cadangan                 | Jadwal harian, run manual, retensi, riwayat run, unduh (presigned URL), petunjuk pemulihan              | `src/server/backup/*`, `src/web/backup/*`, `src/shared/backup.types.ts`                                   |
| Kunci data (data secret) | `data/secret`: secret Better Auth + kunci enkripsi pengaturan                                           | `src/server/secret.ts`, `src/server/crypto.service.ts`, `src/server/settings.service.ts`                  |
| Autentikasi & sesi       | Google via Better Auth, login terbuka, sinkron peran, daftar/cabut sesi, umur sesi, cookie, CSRF/origin | `src/server/auth/*`, `src/server/routes/me.routes.ts`                                                     |
| Otorisasi                | `roleGuard` per area, guard UI, batas hak antar peran                                                   | `src/server/auth/role.guard.ts`, `src/shared/roles.ts`, `src/server/routes/*`                             |
| Log audit                | Aksi yang dicatat, aktor, retensi, ketahanan terhadap manipulasi                                        | `src/server/audit.service.ts`, `src/web/dev/audit.page.tsx`                                               |
| Lapisan HTTP (wave A)    | Security headers, CSP, rate limit, batas body, log request                                              | `src/server/http/*`, `src/server/index.ts`                                                                |
| Penanganan secret        | Env situs write-only, token Cloudflare, kunci S3, scrubbing log                                         | `src/server/sites/env.file.ts`, `src/server/cloudflare/cloudflare.client.ts`, `src/server/log.service.ts` |
| Supply chain             | Audit dependency, lockfile, runtime Bun yang di-embed                                                   | `package.json`, `bun.lock`                                                                                |
| Threat model             | Panel terbuka di internet dengan login Google terbuka; HP dicuri/hilang                                 | —                                                                                                         |

Di luar lingkup: tampilan visual halaman Cadangan/Audit (domain UI worker lain). Dokumen ini hanya mencatat bagian yang menyentuh keamanan dan integritas data.

---

## 2. Kondisi sekarang — audit

### 2.1 Cadangan (backup)

**Data**

- Setting (`settings.service.ts:112-170`): `backup.s3_endpoint`, `s3_bucket`, `s3_region` (default `auto`), `s3_access_key_id` dan `s3_secret_access_key` (secret, terenkripsi), `prefix` (default `panel-termux/`), `hour` (default `3`, atau `off`), `retention_days` (default 14, maks 365).
- Tabel `backup_run` (`db/schema/backup.schema.ts:16-29`): `id, trigger, status, items(JSON), error, actorId, startedAt, finishedAt`. Item berisi `kind (database|panel), name, key, sizeBytes, ok, error`. Tidak ada checksum dan tidak ada ukuran yang diverifikasi dari sisi S3.
- `restoreHint` dihitung saat dibaca (`backup.service.ts:64-69`).

**Alur run** (`backup.service.ts:81-158`)

1. `start()` membaca config. Bila belum lengkap → 400 `not_configured`, bila sedang berjalan → 409 `busy`. Satu run per proses (`backupServiceFor`, `:240`).
2. `listDatabases()` (`postgres.termux.ts:14-16`, mengecualikan template dan `postgres`). Bila gagal, error dicatat dan run lanjut tanpa DB.
3. Tiap DB: `pg_dump -Fc -w` ke temp file (`postgres.termux.ts:79-86`, timeout 30 menit) → `client.write(key, Bun.file)` ke S3.
4. `panel.db`: `VACUUM INTO` ke temp (`:118`). Hasilnya snapshot konsisten.
5. Status `succeeded | partial | failed`. **Retensi jalan bila status ≠ failed, termasuk `partial`** (`:123-129`). Prune menghapus semua objek di bawah prefix dengan `lastModified < startedAt − retentionDays` (`:34-48`).
6. Audit `backup.run` dengan `actorId` null untuk run terjadwal (`:133`).
7. Saat boot, run yang masih `running` ditandai gagal dan `backup-tmp` dibersihkan (`:56-60`).

**Unduh**: `GET /panel/backups/:id/items/:index/download` → 302 ke presigned GET 15 menit, diaudit (`backup.routes.ts:26-28`, `backup.service.ts:196-207`). Peran minimum **admin** (`backup.routes.ts:12`). Artinya admin bisa mengunduh `panel.db` lengkap.

**Pemulihan**: manual. Petunjuk per item:

- DB: `pg_restore -U postgres -d <name> --clean <file>` (`backup.service.ts:66`). Tanpa `--if-exists`, jadi `--clean` memunculkan error untuk objek yang belum ada. Petunjuk ini juga menganggap DB dan role pemilik sudah ada. README `:199` hanya menyebut `createdb`.
- Panel: `sv down panel && cp <file> <dataDir>/panel.db && rm -f …-wal …-shm && sv up panel` (`:67-68`). Ada tiga masalah: (a) `dataDir` default `./data` membuat path **relatif** `data/panel.db`, sehingga salah bila dijalankan dari `~`; (b) `sv` lewat ssh gagal tanpa `SVDIR` (masalah yang sama sudah diperbaiki di `install-phone.sh:10-12`, CHANGELOG 0.2.0); (c) `<file>` diasumsikan sudah ada di HP, padahal tombol "Unduh" menyimpannya ke perangkat browser.
- UI hanya menampilkan perintah dan tombol salin (`web/backup/backup.runs.tsx:42-48`). Belum ada pemulihan terpandu, uji pemulihan, atau verifikasi.

**Cakupan yang TIDAK dicadangkan** (dicek dari kode dan layout di HP):

- Folder situs `~/sites/<nama>/`: `.env` (berisi `DATABASE_URL` dan password role), `data/` (situs SQLite), binary `app` dan `app.prev`, `apps.json`, `ecosystem.config.js`.
- `~/.cloudflared/` (`config.yml`, kredensial tunnel `*.json`, `cert.pem`). Di HP: `-r-------- a97b….json`, `cert.pem`, `config.yml`, `config.yml.bak-panel-…`.
- Global Postgres (role dan password): `pg_dumpall --globals-only` tidak dijalankan. Akibatnya pemulihan ke HP baru gagal di `OWNER` kecuali memakai `--no-owner`, dan password di `DATABASE_URL` ikut hilang bersama `.env`.
- `data/secret`. Ini disengaja (README `:212`), lihat §2.2.
- `~/panel/.env` (Google client secret, `SUPER_ADMIN_EMAILS`).

**Isi sensitif yang ikut ke bucket tanpa enkripsi sisi klien**: `panel.db` berisi email dan nama pengguna (PII), token sesi plaintext (`auth.schema.ts:33`), token OAuth Google (`account.access_token/refresh_token/id_token`, `:55-57`), audit log, dan setting terenkripsi. Dump Postgres berisi data aplikasi apa adanya. Satu pengaman: cookie sesi ditandatangani HMAC dengan `secret`, jadi token di DB saja belum cukup untuk membajak sesi selama `secret` tidak ikut bocor (lihat `tests/panel.api.test.ts:40-53` tentang format cookie).

**Kredensial S3**: README `:67` meminta "izin tulis". Kenyataannya kode butuh list, delete (prune) dan read (presign). Jadi kunci yang tersimpan di HP bisa **menghapus semua cadangan**. Tidak ada object lock, versioning, atau pemisahan kredensial.

**Mode gagal**

- Bila `secret` tidak cocok dengan setting terenkripsi, `getSetting` throw (`settings.service.ts:192-196`) → `readBackupConfig` throw → `backup.status()` throw → **`/api/panel/overview` 500**, karena `backup.status` tidak dibungkus `orEmpty` (`panel.service.ts:94`). Scheduler juga mencatat error **setiap menit**, karena `config()` dipanggil sebelum `isDue` (`backup.service.ts:216-218`).
- Run `partial` berulang (mis. satu DB selalu gagal di-dump) tetap memicu prune. Setelah `retention_days`, dump lama yang masih baik untuk DB itu terhapus padahal penggantinya belum pernah ada. **Cadangan terakhir yang valid bisa hilang tanpa peringatan.**
- Prune berbasis waktu saja: tidak ada "simpan minimal N run sukses" dan tidak ada batas ukuran. Objek lain di bawah prefix yang sama (mis. diunggah manual) ikut terhapus.
- Tidak ada notifikasi kegagalan di luar panel. Hanya ada strip masalah di Ringkasan (`overview.problems.ts:37-45`).
- Tidak ada cadangan lokal. Bila S3 belum diatur, tidak ada cadangan sama sekali. Upgrade panel (`install-phone.sh:31-39`) langsung menukar binary dan migrasi jalan otomatis saat boot (`index.ts:36`) **tanpa snapshot `panel.db` lebih dulu**. Kembali ke `panel.prev` setelah migrasi berarti binary lama berjalan di atas schema baru.
- Upload multipart dengan dump besar belum diuji (README Keterbatasan).

### 2.2 Kunci data (`data/secret`)

- Dibuat sekali, 32 byte hex, mode 600, flag `wx` (`secret.ts:19-35`). Folder data mode 700 (`:9-16`). Di HP terverifikasi `drwx------ data`, `-rw------- secret`, `-rw------- .env`.
- Dipakai untuk dua hal: (1) `secret` Better Auth untuk tanda tangan cookie (`auth.service.ts:24`), (2) kunci AES-256-GCM pengaturan yang diturunkan lewat HKDF dengan info `panel-termux/settings/v1` (`crypto.service.ts:8-10`). Pemisahan kunci lewat HKDF sudah benar.
- **Bila file hilang, panel diam-diam membuat secret baru** (`secret.ts:28-31`). Akibatnya semua sesi tidak valid (dapat diterima) dan semua setting rahasia tidak bisa didekripsi (token Cloudflare, kunci S3), lalu overview 500 seperti di §2.1. Tidak ada key-check (mis. HMAC dari konstanta yang disimpan di `app_meta`) untuk mendeteksi kunci yang salah, dan tidak ada pesan "kunci data tidak cocok".
- Ada masalah ayam-dan-telur: kunci S3 untuk mengambil cadangan disimpan terenkripsi **di dalam** `panel.db` yang dicadangkan. Di HP baru tanpa `secret` lama, pemilik harus punya kunci R2 dari tempat lain.
- Tidak ada rotasi secret. Tidak ada cara "keluarkan semua sesi semua pengguna" selain mengganti secret, dan mengganti secret saat ini ikut merusak setting.
- Panduan penyimpanan hanya satu paragraf di README `:212`. UI dan checklist setup (`dev/setup.service.ts:14-40`) tidak menyinggungnya.

### 2.3 Autentikasi & sesi

- Better Auth 1.7.28, hanya Google, login terbuka untuk semua akun (`auth.service.ts:19-55`). Field `role` dibuat `input:false` (`:33`). Peran disinkronkan sebelum setiap sesi dibuat (`:40-42`) dan saat boot (`access.service.ts:34-38`, dipanggil di `index.ts:37`). Super admin yang emailnya dihapus dari env turun ke `user`. Admin hanya bisa diberikan oleh super_admin.
- **Perubahan peran otomatis dari sinkron env hanya masuk log** (`access.service.ts:24`), tidak masuk audit.
- `roleGuard` membaca sesi dan peran langsung dari DB di setiap request (`role.guard.ts:12-31`; Better Auth tanpa `cookieCache`). Jadi demosi dan hapus pengguna langsung berlaku. Ini sudah benar.
- **Cookie** (diukur lewat probe `authCookies.sessionToken` dengan base https): `__Secure-better-auth.session_token`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `maxAge=604800` (7 hari, sliding karena default `updateAge` 1 hari). Tidak ada batas umur absolut dan tidak ada syarat "sesi baru" untuk aksi berisiko.
- **Sesi**: `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-others` (`me.routes.ts:31-36`, `sessions.service.ts`). IP disamarkan dan UA diringkas, keduanya bagus. **Belum ada UI yang memakainya**: `grep me/sessions src/web` kosong, dan `profile.page.tsx` tidak menampilkan sesi. Super_admin juga tidak bisa mencabut sesi pengguna lain selain dengan menghapus pengguna itu.
- **Pengguna yang dihapus bisa login lagi** sebagai `user` (`users.service.ts:99-107`). Belum ada mekanisme blokir.
- IP klien: `cf-connecting-ip` hanya dipercaya bila peer-nya loopback (`rate.limit.ts:17-21`). Better Auth memakai `cf-connecting-ip`, lalu `x-forwarded-for` (`auth.service.ts:52`). Proses lain di HP yang sama bisa memalsukan header ini lewat loopback, tetapi ini hanya berdampak pada IP sesi dan rate limit.
- **CSRF / origin**: Better Auth memeriksa origin untuk endpoint `/api/auth/*`. Probe membuktikan `sign-out` dengan `text/plain` ditolak 415. **Route panel sendiri tidak punya pemeriksaan Origin, `Sec-Fetch-Site`, atau token CSRF sama sekali** (`grep -i "origin|sec-fetch|csrf" src/server` hanya menemukan komentar). Hasil probe dengan cookie admin, `Origin: https://evil.example.com`, `Content-Type: text/plain`:
  - `POST /api/panel/services/cloudflared/restart` → **200, service di-restart** (cloudflared termasuk layanan terlindungi, tetapi perlindungan hanya berlaku untuk `stop`, lihat `panel.service.ts:116-118`)
  - `POST /api/me/sessions/revoke-others` → **200**
  - `POST /api/panel/backups/run` → diterima (400 hanya karena belum dikonfigurasi)
    Karena cookie `SameSite=Lax`, situs lintas-_site_ biasa tidak bisa memanfaatkan ini. Tetapi **semua situs yang di-host panel berada di registrable domain yang sama** (ingress di HP: `solusi.malikkurosaki.com` dan `panel.malikkurosaki.com`), sehingga dihitung _same-site_. Satu situs yang di-host (atau XSS di dalamnya) bisa menjalankan `fetch(..., {method:"POST", mode:"no-cors", credentials:"include"})` dan memicu POST tanpa body: restart/stop service atau app, `sites/:name/rollback`, `uploads/:id/complete`, `backups/run`, `revoke-others`. PUT/PATCH/DELETE dan body JSON butuh preflight, jadi tidak bisa.

### 2.4 Otorisasi

Matriks hak saat ini (semua dari `roleGuard`, peran dibaca dari DB):

| Route                                                                   | Min. peran   | Kode                                   |
| ----------------------------------------------------------------------- | ------------ | -------------------------------------- |
| `/api/auth/*`, `/api/health`, `/api/ready`                              | publik       | `api.routes.ts:50-63`, `index.ts:26`   |
| `/api/me`, `/api/me/sessions*`                                          | sesi apa pun | `me.routes.ts`                         |
| `/api/panel/{overview,services,apps,domains,databases}` + kontrol + log | admin        | `panel.routes.ts:41-63`                |
| `/api/panel/sites*`, `jobs`, `integration`, env situs                   | admin        | `sites.routes.ts`                      |
| `/api/panel/sites/:name/uploads`, `uploads/*`, `rollback`, `deploys`    | admin        | `deploy.routes.ts`                     |
| `/api/panel/backups/*` termasuk unduh `panel.db`                        | admin        | `backup.routes.ts:12`                  |
| `/api/dev/{health,users,audit,logs,settings,setup,cloudflare}`          | super_admin  | `dev.routes.ts:31`, `api.routes.ts:71` |

Guard UI (`shared/roles.ts:10,22-26`) mencerminkan server. Server tetap penjaga utama, ini sudah benar.

**Temuan batas hak**

- **Admin pada praktiknya setara pemilik HP.** Deploy mengunggah binary sembarang (`deploy.routes.ts:19-27`) yang dijalankan pm2 dengan UID Termux yang sama dengan panel. Binary itu bisa membaca `~/panel/data/secret` dan `panel.db`, lalu memalsukan cookie super_admin (token dari DB + HMAC dengan secret) atau langsung mengubah `user.role`. Admin juga bisa membaca log semua app (`panel.routes.ts:58-60`), mengunduh `panel.db` (§2.1), dan me-restart `sshd`, `cloudflared` atau `panel`. Pemisahan admin dan super_admin hanya berlaku di UI/API, bukan batas keamanan yang nyata. Hal ini tidak disebut di README `:5-13,155-159`.
- Admin melihat `recentActivity` di Ringkasan (`panel.service.ts:103`), yaitu 8 entri audit terakhir termasuk `auth.sign_in` dan nama aktor semua pengguna. Kebocoran PII ini kecil, tetapi admin tidak berhak membuka `/dev/audit`.
- Setting dan pengguna hanya bisa diubah super_admin. Super_admin env tidak bisa diubah atau dihapus, dan pengguna tidak bisa mengubah dirinya sendiri (`users.service.ts:76-82`). Ini sudah benar.

### 2.5 Log audit

- Tabel `audit_log` (`audit-log.schema.ts:6-18`): `id, at, actorId (FK set null), action, target, meta(JSON)`. Ada index `at` dan `action`. Tidak ada IP, UA, request id, atau nilai `before/after` yang konsisten.
- Aksi yang sudah dicatat (`grep recordAudit(`): `auth.sign_in`, `session.revoke`, `user.role_change`, `user.delete`, `settings.update` (key saja, `dev.routes.ts:81-82`), `service.*`, `app.*`, `site.create/adopt/env_update(keys)/delete`, `hostname.add/remove`, `site.deploy`, `site.rollback`, `dns.create/delete` (aktor null), `backup.run`, `backup.download`.
- **Belum dicatat**: sign-out, login gagal atau callback OAuth error, pengguna baru pertama kali masuk (dibedakan dari `sign_in`), perubahan peran otomatis dari env (`access.service.ts:22-25`), awal dan batal upload deploy, start/stop panel (boot, migrasi, versi), secret baru dibuat, unduh presign gagal.
- Aktor untuk aksi otomatis berupa `null`. UI menampilkannya sebagai "Sistem" (`audit.page.tsx:28`), sesuai benchmark. `dns.*` juga ber-aktor null padahal dipicu admin lewat job situs, jadi atribusinya hilang.
- **Retensi**: tak terbatas, tanpa prune. **Ketahanan terhadap manipulasi**: append-only hanya secara konvensi. Tidak ada trigger `BEFORE UPDATE/DELETE`, tidak ada hash chain, dan salinan off-device hanya ada lewat cadangan harian `panel.db`. Siapa pun yang punya shell, termasuk binary yang di-deploy admin, bisa mengedit tabel ini.
- UI: saran filter hanya 4 aksi (`audit.page.tsx:16`), target berupa id mentah, meta JSON mentah, tidak ada filter aktor dan rentang tanggal, dan tidak ada ekspor.

### 2.6 Lapisan HTTP (wave A) — verifikasi

- Header untuk API dan halaman HTML: CSP (API `default-src 'none'`, halaman dengan hash inline script), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `X-Frame-Options: DENY`, dan HSTS 180 hari bila base https (`security.headers.ts:44-53`). Probe `/login` → CSP ada, XFO `DENY`.
- **Celah 1: `/__spa` bisa diakses dari luar tanpa header apa pun** dan melewati `canonicalRedirect`. Route `[SPA_PATH]: spa` di `index.ts:112` dilayani langsung oleh Bun. Probe: `/__spa` → 200, `csp:false`, `xfo:null`. Di 127.0.0.1 juga 200 tanpa redirect. Akibatnya SPA bisa di-frame (clickjacking pada landing dan login) tanpa CSP.
- **Celah 2: aset bundle (`/chunk-*.js`, `*.css`) tanpa `nosniff` dan CSP.** Probe: `nosniff: null`. Risikonya rendah.
- **Celah 3: produksi masih 0.2.1.** `curl /api/health` → `{"version":"0.2.1"}`. `/` dan `/panel` di produksi **tidak mengirim CSP, XFO, HSTS, atau nosniff** sama sekali, karena wave A belum di-deploy. Ini perlu diverifikasi ulang setelah rilis.
- **Celah 4: Cloudflare Access tidak aktif di produksi.** `curl -I https://panel.malikkurosaki.com/panel` → 200 HTML langsung, tanpa redirect ke `*.cloudflareaccess.com`. `/api/panel/ping` → 401 dari panel, bukan dari Access. Langkah 4 README (`:128-153`) belum diterapkan, atau sudah terlepas.
- Interaksi dengan Access: `/api/*` tidak melewati `canonicalRedirect` (`index.ts:111`). Saat ini aman karena hanya satu hostname yang mengarah ke `localhost:3200` (dicek di `config.yml` HP). Tetapi kalau ada hostname kedua (adopsi atau ingress yang salah) yang mengarah ke port panel, API terbuka di hostname itu tanpa aturan path Access. Panel juga tidak memvalidasi JWT `Cf-Access-Jwt-Assertion`.
- Rate limit: in-memory, fixed window. Auth 10 per menit per IP, hanya untuk `sign-in|callback` (`api.handler.ts:17`, `rate.limit.ts:4`). Mutasi `/api/panel|dev` 60 per menit per sesi, chunk deploy dikecualikan. `/api/me/sessions*` **tidak** terkena batas mutasi (regex `MUTATION_AREA`, `api.handler.ts:18`). Rate limit internal Better Auth juga aktif secara default di produksi.
- Batas body JSON 1 MB, body global satu chunk + 1 MB (`index.ts:22`, `api.handler.ts:8`). Error 500 diganti dengan request id tanpa stack (`:47-51`). Log request hanya berisi path, status dan user id, tanpa query dan PII (`request.log.ts:20-22`).

### 2.7 Penanganan secret

- Env situs: write-only. API hanya mengembalikan `envKeys` (`site.types.ts:22-25`, `env.file.ts:1`). File mode 600 (`site.service.ts:32,208`, `site.jobs.ts:22,128`). Kunci yang dipakai panel sendiri ditolak (`site.service.ts:31,135`). Audit hanya mencatat nama key.
- Setting rahasia: AES-GCM, tidak pernah dikembalikan (`settings.service.ts:201-214`), dan audit hanya mencatat key (`dev.routes.ts:81`).
- Token Cloudflare: header Bearer, pesan error tanpa token (`cloudflare.client.ts:20,44,78`). Kunci S3 disamarkan dalam pesan error (`backup.service.ts:27-31`). Password Postgres dikirim lewat stdin dan disamarkan dari stderr (`postgres.termux.ts:40-60`).
- `log.service.ts:20` bergantung pada disiplin pemanggil. **Tidak ada scrubber terpusat.** Log app (pm2) bisa memuat secret milik app itu sendiri dan terbaca oleh admin. Ini wajar untuk sebuah panel, tetapi perlu disebut di docs.
- `~/panel/.env` (Google client secret) mode 600. Installer tidak pernah mencetak nilainya (`install-phone.sh:5`).
- Bahan paling berbahaya di HP justru tidak dikelola panel: `~/.cloudflared/cert.pem` (sertifikat akun Cloudflare yang bisa mengelola tunnel/DNS zona) dan kredensial tunnel.

### 2.8 Supply chain

- `bun audit`: 1 temuan moderate, yaitu `esbuild` (GHSA-67mh-4wv8-2f99) lewat `drizzle-kit`. Ini dev dependency saja dan tidak masuk binary. Tidak ada temuan high/critical. `bun outdated`: tidak ada yang tertinggal.
- `bun.lock` di-commit. Versi memakai `^`. Paket `cn` adalah milik shadcn (repo `shadcn-ui/cn`, MIT), wajar.
- Runtime Bun 1.4.2 di-embed di binary, jadi patch keamanan Bun hanya datang lewat rebuild dan rilis panel. Belum ada CI, SBOM, atau langkah `bun audit` di checklist rilis. Binary deploy situs diverifikasi dengan sha256 dari upload (`upload.store.ts:11`), tanpa tanda tangan. Itu cukup untuk satu pemilik.

---

## 3. Standar industri

| Topik                 | Produk & sumber                                                                        | Praktik                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retensi cadangan      | Coolify — https://coolify.io/docs/databases/backups                                    | Tiga batas independen: **jumlah cadangan disimpan**, **hari**, **ukuran maks (GB)**, per tujuan (lokal dan S3). Upload S3 gagal → status "S3 warning" dan **file lokal tetap disimpan**                                        |
| Verifikasi            | Coolify (sama)                                                                         | "A successful backup only proves that Coolify created a file." Sarankan memulihkan ke **database sekali pakai** lalu cek nama DB, ukuran > 0, status S3                                                                        |
| Notifikasi            | Coolify (sama)                                                                         | Notif pada kegagalan pertama, lalu maks 1 per hari selama masih gagal, plus notif "pulih". Jadwal tidak pernah dimatikan otomatis                                                                                              |
| Hak unduh cadangan    | Coolify (sama)                                                                         | Unduh hanya Admin/Owner                                                                                                                                                                                                        |
| Kunci instance        | Coolify — https://coolify.io/docs/knowledge-base/how-to/backup-restore-coolify         | `APP_KEY` **wajib disimpan terpisah**: "A database backup does not include this file… Without this key, restored secrets cannot be read". Pola ini sama persis dengan `data/secret`                                            |
| Backup sebelum update | Coolify (sama)                                                                         | Default aktif. **Bila backup gagal, update diblokir**                                                                                                                                                                          |
| Jadwal & pemulihan    | Railway — https://docs.railway.com/reference/backups                                   | Daily (6 hari), Weekly (27 hari), Monthly (89 hari) bisa sekaligus. Pemulihan lewat tombol **Restore**: perubahan di-stage, di-review, lalu Deploy. Data masuk **volume baru**, bukan menimpa                                  |
| Pemulihan DB          | Render — https://render.com/docs/postgresql-backups                                    | PITR **selalu membuat instance baru**, divalidasi, lalu service diarahkan ulang. Ekspor logis bisa diunduh (7 hari). Pemulihan logis memakai `pg_restore --clean --if-exists`, dengan peringatan jangan menimpa DB berisi data |
| Audit                 | Render — https://render.com/docs/audit-logs                                            | Mencatat login dan logout, perubahan peran, unduh backup Postgres, **melihat info koneksi**, create/update/delete/**view** env var. Retensi ≥ 90 hari, ekspor CSV                                                              |
| Audit                 | Vercel — https://vercel.com/docs/audit-log                                             | Kolom: timestamp, action, actor, email, **IP, user agent, request ID, previous, next**. Ekspor 90 hari, hanya owner dan security                                                                                               |
| Peran                 | Render — https://render.com/docs/team-members                                          | Admin (anggota, billing, audit), Developer (deploy, rollback, env non-protected), Contributor (deploy tanpa melihat env), Viewer (read-only, tanpa log)                                                                        |
| Peran                 | Vercel — https://vercel.com/docs/rbac/access-roles                                     | Developer bisa deploy tetapi **tidak bisa mengubah env production**. Owner disarankan ≥ 2 orang                                                                                                                                |
| Peran                 | Railway — https://docs.railway.com/reference/teams                                     | Admin, Member (tidak boleh menghapus resource atau mengelola anggota), Deployer (deploy saja, tanpa variabel dan log)                                                                                                          |
| Env secret            | Vercel — https://vercel.com/docs/environment-variables/sensitive-environment-variables | Secret **write-only setelah disimpan**, diganti dengan mengisi nilai baru, dan nilai ≥ 32 karakter diganti `[REDACTED]` di build log. Panel sudah write-only, tetapi belum melakukan redaksi log                               |
| Perlindungan akses    | Vercel — https://vercel.com/docs/security/deployment-protection                        | Lapisan autentikasi di depan deployment. Padanannya di sini adalah Cloudflare Access                                                                                                                                           |
| Benchmark internal    | `docs/research/ui-benchmark.md:34,280-298,316-319`                                     | Kolom audit baku, aktor "Sistem", onboarding "Atur backup → **Uji restore**", ketik nama untuk konfirmasi pemulihan                                                                                                            |

Kesimpulan: panel sudah selevel untuk pengaturan secret write-only dan aktor Sistem. Panel tertinggal di **retensi berbasis jumlah, cadangan lokal dan cadangan sebelum upgrade, verifikasi dan uji pemulihan, pemulihan non-destruktif ke DB baru, notifikasi, kolom audit (IP/UA/before-after), dan peran yang benar-benar memisahkan deploy dari pengelolaan secret**.

---

## 4. Kebutuhan produksi

**Keamanan**

- Mutasi state wajib tahan CSRF dari situs _same-site_ (situs yang di-host panel). Minimal tolak `Sec-Fetch-Site` yang bukan `same-origin` dan `Origin` yang bukan `APP_BASE_URL` untuk metode non-safe. SPA sudah mengirim `x-requested-with` (`web/shared/api.client.ts:32`), jadi itu bisa jadi lapis kedua.
- Semua respons HTML (termasuk `/__spa`) dan aset harus membawa header keamanan.
- Docs harus jujur: "admin = kendali penuh atas HP". Pilihan lainnya, hak deploy dan unduh `panel.db` dibatasi (lihat §6.3).
- Ada jalur insiden: cabut semua sesi (per pengguna dan global), rotasi secret dengan re-enkripsi setting, dan daftar kredensial yang harus dirotasi.

**Reliabilitas & integritas data**

- Cadangan yang valid terakhir tidak boleh terhapus oleh retensi.
- Cadangan harus cukup untuk membangun ulang seluruh server di HP baru: DB + globals, `panel.db`, folder situs (`.env`, `data/`), konfigurasi cloudflared, plus kunci data yang disimpan aman.
- Sebelum upgrade dan migrasi harus ada snapshot lokal.
- Kegagalan dekripsi harus terlihat sebagai _masalah_, bukan 500.

**Performa di HP**

- `pg_dump` dan uji pemulihan harus serial, ber-timeout, dan dijadwalkan jarang (uji pemulihan mingguan). `PRAGMA integrity_check` dan `pg_restore --list` murah. Pemulihan penuh ke DB sementara butuh biaya CPU dan disk, jadi cek ruang disk dulu.
- Enkripsi sisi klien harus streaming, jangan memuat dump ke memori. RAM panel sekitar 65 MB (content-guide `:139`).

**Aksesibilitas & mobile**

- Konfirmasi pemulihan dengan "ketik nama" (benchmark `:263,319`) harus bisa dipakai di layar HP: label jelas, target ≥ 44 px, dan pesan error yang bisa dibaca screen reader.

**Observabilitas**

- Audit dengan IP disamarkan, UA ringkas, dan request id.
- Notifikasi kegagalan cadangan di luar panel (minimal webhook/Telegram/email, dirancang di PLAN).
- Strip masalah untuk: kunci data tidak cocok, Access tidak aktif, cadangan terakhir terlalu tua per DB.

---

## 5. Kesenjangan (gap list)

| #   | Gap                                                                                                                                                | Sev                  | Kenapa                                                                                                                                                                      | Bukti                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| G1  | Route `/api/panel`, `/api/dev`, `/api/me` tidak memeriksa Origin/`Sec-Fetch-Site`. POST tanpa body bisa dipicu situs same-site                     | **P0**               | Situs yang di-host panel ada di domain yang sama, sehingga satu XSS atau situs pihak ketiga bisa me-restart cloudflared, rollback, menjalankan cadangan, atau mencabut sesi | Probe §2.3 (200 untuk restart cloudflared dengan Origin asing); `config.yml` HP; `grep` kosong       |
| G2  | Retensi tetap prune pada run `partial` dan hanya berbasis waktu                                                                                    | **P0**               | Cadangan valid terakhir sebuah DB bisa hilang diam-diam                                                                                                                     | `backup.service.ts:122-129,34-48`                                                                    |
| G3  | Cakupan cadangan tidak cukup untuk HP hilang: tanpa folder situs (`.env`, `data/`), globals Postgres, `~/.cloudflared`, `~/panel/.env`             | **P0**               | Disaster recovery mustahil dilakukan lengkap. `DATABASE_URL`, data situs SQLite, dan role hilang                                                                            | §2.1 "tidak dicadangkan"; `postgres.termux.ts:79-86`                                                 |
| G4  | Kunci data hilang atau salah → secret baru dibuat diam-diam → overview 500 dan scheduler error tiap menit                                          | **P0**               | Mode gagal yang membingungkan dan bisa menghapus akses ke kunci S3                                                                                                          | `secret.ts:28-31`, `settings.service.ts:192-196`, `panel.service.ts:94`, `backup.service.ts:216-218` |
| G5  | Tidak ada snapshot `panel.db` sebelum upgrade dan migrasi                                                                                          | **P0**               | Upgrade yang gagal tidak bisa di-rollback bersih (binary lama di atas schema baru)                                                                                          | `install-phone.sh:31-39`, `index.ts:36`; Coolify memblokir update tanpa backup                       |
| G6  | Petunjuk pemulihan salah atau tidak lengkap: path relatif, `sv` tanpa `SVDIR`, tanpa `--if-exists` dan `--no-owner`, file dianggap sudah ada di HP | **P0**               | Saat darurat, perintah yang disalin gagal                                                                                                                                   | `backup.service.ts:64-69`; CHANGELOG 0.2.0 (SVDIR)                                                   |
| G7  | Cloudflare Access tidak aktif di produksi, dan produksi masih tanpa header wave A                                                                  | **P0 (operasional)** | Login terbuka + panel tanpa lapisan depan, padahal README menjadikan Access sebagai pengaman utama                                                                          | `curl` §2.6                                                                                          |
| G8  | Cadangan tidak dienkripsi sisi klien. Berisi PII, token sesi, token OAuth, data app. Kunci S3 di HP bisa menghapus semua cadangan                  | P1                   | Bocornya bucket atau HP berarti data dan cadangan sama-sama hilang                                                                                                          | `backup.service.ts:98,118`, `auth.schema.ts:33,55-57`, README `:67`                                  |
| G9  | Tidak ada verifikasi cadangan (checksum, `integrity_check`, `pg_restore --list`) dan tidak ada uji pemulihan                                       | P1                   | "Sukses" hanya berarti file berhasil diunggah                                                                                                                               | `backup.schema.ts:6-13`; Coolify docs                                                                |
| G10 | Pemulihan sepenuhnya manual, tanpa opsi non-destruktif "pulihkan ke DB baru"                                                                       | P1                   | Pemulihan saat ini menimpa data (`--clean`) di HP lewat ssh                                                                                                                 | §2.1; Render/Railway selalu memulihkan ke instance/volume baru                                       |
| G11 | Admin setara pemilik HP (deploy binary dengan UID yang sama), tidak didokumentasikan. Admin bisa unduh `panel.db`                                  | P1                   | Pemilik mungkin memberi peran admin ke teman dengan anggapan hak mereka terbatas                                                                                            | §2.4; `deploy.routes.ts`, `backup.routes.ts:12`                                                      |
| G12 | `/__spa` dan aset tanpa header keamanan, `/__spa` melewati canonical redirect                                                                      | P1                   | Clickjacking dan inkonsistensi CSP                                                                                                                                          | Probe §2.6                                                                                           |
| G13 | UI sesi belum ada. Super_admin tidak bisa mencabut sesi orang lain. Tidak ada "keluarkan semua"                                                    | P1                   | Laptop dicuri: sesi 7 hari sliding tetap hidup                                                                                                                              | `grep me/sessions src/web` kosong; `sessions.service.ts`                                             |
| G14 | Audit tidak mencatat perubahan peran dari env, sign-out, login gagal, akun baru, boot/upgrade. Tanpa IP/UA/request id                              | P1                   | Insiden tidak bisa direkonstruksi                                                                                                                                           | §2.5; `access.service.ts:22-25`                                                                      |
| G15 | Tidak ada notifikasi kegagalan cadangan di luar panel                                                                                              | P1                   | Panel di HP jarang dibuka. Kegagalan bisa tak terlihat berminggu-minggu                                                                                                     | `overview.problems.ts:37-45`                                                                         |
| G16 | Kunci data: tidak ada panduan di UI/checklist, tidak ada ekspor "kunci pemulihan", tidak ada rotasi                                                | P1                   | Dengan pola Coolify `APP_KEY`, pengguna lupa menyimpan kunci                                                                                                                | `setup.service.ts:14-40`, README `:212`                                                              |
| G17 | Kebijakan login: login terbuka tanpa opsi allowlist atau blokir. Pengguna yang dihapus bisa masuk lagi                                             | P2                   | Akun asing menumpuk dan permukaan serangan melebar. Dampaknya kecil selama peran `user` hanya `/profile`                                                                    | `auth.service.ts:18`, `users.service.ts:99-107`                                                      |
| G18 | Tidak ada umur sesi absolut dan tidak ada re-auth untuk aksi berisiko (hapus situs, pemulihan, setting)                                            | P2                   | Cookie curian berlaku tanpa batas selama terus dipakai                                                                                                                      | Probe cookie `maxAge=604800`, sliding                                                                |
| G19 | Audit tanpa tamper-resistance (trigger, hash chain) dan tanpa retensi                                                                              | P2                   | Bisa dihapus lewat shell. Tumbuh tanpa batas (pelan)                                                                                                                        | `audit-log.schema.ts`                                                                                |
| G20 | `recentActivity` di Ringkasan memperlihatkan login semua pengguna ke admin                                                                         | P2                   | Kebocoran PII kecil dan tidak konsisten dengan `/dev/audit` yang khusus super_admin                                                                                         | `panel.service.ts:103`                                                                               |
| G21 | `/api/*` di hostname non-kanonik tidak dialihkan, dan JWT Access tidak divalidasi                                                                  | P2                   | Risiko bypass Access bila ingress salah konfigurasi                                                                                                                         | `index.ts:111`; `config.yml` saat ini aman                                                           |
| G22 | `/api/me/sessions*` di luar rate limit mutasi                                                                                                      | P2                   | Kecil, tetapi tidak konsisten                                                                                                                                               | `api.handler.ts:18`                                                                                  |
| G23 | Supply chain tanpa langkah `bun audit` di checklist rilis dan tanpa catatan versi Bun di CHANGELOG                                                 | P2                   | Patch runtime hanya datang lewat rilis                                                                                                                                      | §2.8                                                                                                 |
| G24 | Tidak ada cadangan lokal (ring N terakhir) saat S3 belum diatur atau sedang gagal                                                                  | P2                   | Coolify menyimpan salinan lokal saat S3 gagal                                                                                                                               | §2.1                                                                                                 |

---

## 6. Opsi & trade-off

### 6.1 CSRF (G1)

- **A. Cek `Sec-Fetch-Site` + `Origin` di `createApiHandler`** untuk metode non-safe pada `/api/panel|dev|me`. Tolak bila `Sec-Fetch-Site` ada dan bukan `same-origin`. Bila header itu tidak ada, wajibkan `Origin` sama dengan `APP_BASE_URL` (kecuali tanpa cookie, mis. curl di loopback). Sekitar 15 baris di satu tempat, dan semua route lewat situ.
- **B. Wajibkan header `x-requested-with`** (sudah dikirim SPA). Header kustom memicu preflight, dan preflight gagal karena tidak ada CORS. Murah, tetapi bergantung pada perilaku CORS browser.
- **C. Token CSRF double-submit.** Terlalu berat untuk satu SPA same-origin.
- **Rekomendasi: A + B** (B sebagai lapis kedua, hampir gratis). Opsi alternatif `SameSite=Strict` lewat `advanced.defaultCookieAttributes` memutus alur callback OAuth Google (redirect lintas-site), jadi jangan dipilih.

### 6.2 Kunci data & cakupan cadangan (G3, G4, G8, G16)

- **A. Status quo + "Kit pemulihan"**: super_admin mengunduh berkas berisi `secret` (dan opsional kunci R2) setelah konfirmasi, aksinya diaudit, dan ada item checklist "kunci pemulihan sudah disimpan". Cadangan tetap tidak terenkripsi.
- **B. Enkripsi cadangan dengan kunci publik** (pola `age`: panel hanya menyimpan _recipient_/public key, private key dipegang pemilik di luar HP). `secret`, folder situs, `.env` panel dan globals Postgres **boleh** ikut ke bucket karena sudah terenkripsi. Cadangan terjadwal tetap jalan tanpa passphrase. Kebocoran bucket atau kunci S3 tidak membuka data. Biaya: dekripsi butuh alat. `age` tersedia di Termux (`pkg install age`) dan di laptop. Alternatifnya implementasi sendiri dengan `node:crypto` (X25519 + HKDF + AES-GCM streaming) beserta subcommand dekripsi, tanpa dependency baru, tetapi formatnya buatan sendiri dan harus diuji ketat.
- **C. Enkripsi simetris dengan passphrase** yang disimpan di panel. Ini tidak menambah keamanan karena passphrase ada di HP yang sama.
- **Rekomendasi: B dengan format `age`** (verifikasi versi dan ketersediaan di Termux sebelum PLAN, Rule 20). Gabungkan dengan key-check di `app_meta` agar G4 terdeteksi: bila `secret` tidak cocok, panel menolak membuat secret baru saat `panel.db` sudah berisi setting terenkripsi dan memunculkan masalah yang jelas. Bila B ditolak, minimal A + key-check.

### 6.3 Batas peran admin (G11)

- **A. Dokumentasikan saja**: "admin = kendali penuh atas server". Pindahkan unduh item `panel` ke super_admin.
- **B. Peran baru `operator`/viewer**: monitoring + start/stop/restart + log, tanpa deploy, env, hapus situs, atau unduh cadangan. Admin tetap seperti sekarang.
- **C. Deploy hanya untuk super_admin.** Ini mematahkan alur tim kecil.
- **Rekomendasi: A sekarang (P1), B ditunda (P2)** sampai ada permintaan nyata dari pemilik. Mengikuti pola Railway Deployer dan Render Viewer.

### 6.4 Verifikasi & pemulihan (G9, G10)

- **A. Verifikasi murah per run**: sha256 dan ukuran dicatat per item, `PRAGMA integrity_check` pada hasil `VACUUM INTO`, `pg_restore --list` pada dump, dan HEAD objek setelah upload untuk membandingkan ukuran.
- **B. Uji pemulihan terjadwal** (mingguan, opsional): unduh dump terakhir → `createdb <name>_verify_<ts>` → `pg_restore --no-owner` → hitung tabel → drop. Hasilnya dicatat sebagai "uji pemulihan terakhir: lulus · 3 hari lalu".
- **C. Pemulihan terpandu non-destruktif di UI**: "Pulihkan ke database baru" (`<name>_restored_<tanggal>`), ditampilkan dengan langkah "arahkan situs ke DB ini" yang tetap manual atau diberi tombol terpisah. Penimpaan langsung hanya lewat ketik nama dan setelah cadangan otomatis sesaat sebelum pemulihan. Untuk `panel.db`: pemulihan tidak bisa dilakukan dari dalam panel yang sedang memakainya, jadi sediakan subcommand offline (`./panel restore <file>`) atau tetap CLI dengan petunjuk yang benar.
- **Rekomendasi: A (P1) + perbaikan petunjuk (P0, G6) + C untuk Postgres (P1); B sebagai P2** karena biaya CPU dan disk di HP.

### 6.5 Retensi (G2, G24)

- **A.** Prune hanya bila status `succeeded` dan pertahankan run sukses terakhir per DB.
- **B. Model Coolify**: `keep_count` + `retention_days` + `max_gb`, dengan jaminan "jangan hapus N run sukses terakhir".
- **Rekomendasi: A segera (P0), B sebagai P2.**

---

## 7. Risiko & pertanyaan terbuka

**Risiko yang harus diputuskan PLAN**

1. Mengubah format cadangan (enkripsi, cakupan folder situs) membuat cadangan lama dan baru berbeda format. Petunjuk pemulihan harus mendukung keduanya, dan README "Backup dan restore" ikut diperbarui.
2. Mencadangkan folder situs bisa besar: binary app 10–100 MB per situs ditambah `app.prev`. Opsinya mengecualikan binary (bisa di-deploy ulang) dan hanya mencadangkan `.env` + `data/`.
3. Pemeriksaan Origin (G1) jangan sampai memutus alat yang memanggil API lewat loopback tanpa cookie, mis. probe installer `/api/health`. Batasi hanya pada request yang membawa cookie sesi dan memakai metode non-safe.
4. Key-check `secret` yang menolak start bisa mengunci panel. Butuh jalan keluar yang terdokumentasi, misalnya flag env untuk "reset setting rahasia".
5. Uji pemulihan membuat DB sementara. Harus ada pembersihan saat crash, mirip penanganan `backup-tmp` saat boot.
6. Saat rilis wave A ke produksi, verifikasi ulang header dengan `curl` (G7), termasuk HSTS `includeSubDomains`. Ini memaksa https untuk **semua** subdomain `malikkurosaki.com`. Pastikan tidak ada subdomain http-only.

**Pertanyaan untuk pemilik (keputusan nyata saja)**

1. **Admin itu siapa?** Orang yang dipercaya penuh (cukup didokumentasikan), atau operator terbatas (butuh peran baru atau pembatasan deploy)?
2. **Enkripsi cadangan dengan kunci publik (`age`)**: setuju bila konsekuensinya pemulihan butuh private key yang kamu simpan sendiri di luar HP?
3. **Cloudflare Access di produksi** saat ini tidak aktif. Apakah itu disengaja? Bila tidak, aktifkan sesuai README langkah 4 sebelum rilis berikutnya. Bila disengaja, apakah login perlu dibatasi ke allowlist email (G17)?
4. **Kanal notifikasi kegagalan cadangan**: Telegram bot, email, atau webhook umum?

**Skenario ancaman (ringkas)**

_Panel di internet dengan login Google terbuka._ Siapa pun bisa membuat sesi `user`. Hak `user` hanya `/api/me*`, dan server menegakkan peran dengan benar (§2.4). Risiko nyata: (1) CSRF same-site dari situs yang di-host (G1); (2) bug otorisasi di masa depan langsung terbuka ke internet karena Access tidak aktif (G7); (3) spam akun (G17); (4) clickjacking lewat `/__spa` (G12). Mitigasi utamanya G1, G7 dan G12.

_HP dicuri/hilang._ Server HP biasanya tanpa kunci layar dan Termux selalu terbuka. Dengan asumsi itu, penyerang mendapat shell sebagai pemilik: `data/secret` + `panel.db` (bisa memalsukan sesi super_admin, mendekripsi token Cloudflare dan kunci S3), `~/panel/.env` (Google client secret), `~/.cloudflared/cert.pem` (kendali tunnel/DNS zona), semua `.env` situs dan DB, dan kunci S3 yang **bisa menghapus semua cadangan** (G8). Runbook yang perlu ada di docs: hapus tunnel dan cabut `cert.pem` di dashboard Cloudflare → rotasi token API Cloudflare → rotasi kunci R2 (dan cek objek masih ada) → rotasi Google client secret → pasang di HP baru dari cadangan + kit pemulihan dengan **secret baru**, sehingga semua cookie lama mati. Langkah terakhir ini butuh fitur "pulihkan dengan rotasi secret" (re-enkripsi setting), yang belum ada (G16). Pencegahan: kunci layar HP, ADB dimatikan, dan cadangan off-device yang tidak bisa dihapus dari HP (R2 bucket lock/object lock atau kredensial tanpa izin delete, dengan prune dipindah ke lifecycle rule bucket).
