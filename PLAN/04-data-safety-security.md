# PLAN 04 — Keamanan data, keamanan akses & cadangan

Worker: `wkr-plan-safety-01` · Branch `feature/production-polish` @ `74fe380` · 2026-11-26
Status: rencana implementasi (belum ada kode diubah). Menutup gap `R&D/04-data-safety-security.md` (disingkat **R4-Gn**). Istilah UI mengikuti `docs/content-guide.md`: Cadangan, Pulihkan, Sesi, Peran, Administrasi, Kesehatan sistem, Variabel lingkungan.

Bukti baru yang dikumpulkan untuk PLAN ini (selain R&D):

- **Hotfix CSRF** di worktree `fix/csrf-origin` (`.claude/worktrees/agent-a88a…/src/server/routes/origin.guard.ts`): `rejectForeignOrigin(req, appBaseUrl)` dipasang sebagai `.onRequest` di `api.routes.ts`. Aturannya: metode `POST|PUT|PATCH|DELETE` di luar `/api/auth/` wajib `Sec-Fetch-Site` ∈ {absen, `same-origin`}, `Origin` ∈ {absen, origin `APP_BASE_URL`}, dan `X-Requested-With: XMLHttpRequest`. Bila gagal: 403 `forbidden_origin`.
- **Spike header aset** (produksi, `NODE_ENV=production bun src/server/index.ts`, port 3977, scratchpad `spike4/`): `/chunk-*.js|css` sudah dikirim Bun dengan `Cache-Control: public, max-age=31536000, immutable` dan `ETag`, sedangkan HTML `no-cache`. Yang belum ada di aset hanya `nosniff`. Lalu `/__spa` memberi 200 HTML tanpa CSP dan tanpa XFO (R4-G12 terkonfirmasi).
- `bun audit --help` (Bun 1.4.2): flag `--audit-level=<low|moderate|high|critical>` tersedia.
- Bun 1.4.2: `node:fs.statfsSync`, `AsyncLocalStorage` (konteks bertahan melewati `await`/`setTimeout`), `Bun.CryptoHasher("sha256")`, `S3Client.stat/size/exists` (`bun-types/s3.d.ts:1298-1401`) semuanya tersedia.
- Better Auth 1.7.28 (`@better-auth/core/dist/types/init-options.d.mts`): `databaseHooks.user.create.after`, `databaseHooks.session.delete.after`, `session.expiresIn/updateAge/freshAge` tersedia.
- **Koreksi R&D risiko 6**: HSTS `includeSubDomains` yang dikirim `panel.malikkurosaki.com` hanya berlaku untuk host itu dan **sub**-domainnya (`*.panel.malikkurosaki.com`), bukan untuk sibling seperti `solusi.malikkurosaki.com`. Header tidak perlu diubah.

---

## 1. Tujuan & ruang lingkup

**Tujuan**: (a) cadangan yang benar dan cukup untuk membangun ulang seluruh server di **HP baru**; (b) tidak ada jalur yang diam-diam menghapus cadangan valid terakhir atau mengganti kunci data; (c) mutasi tahan CSRF dari situs yang di-host; (d) audit yang bisa merekonstruksi insiden; (e) rilis binary yang bisa diverifikasi.

### In scope

| Area                 | Isi                                                                                                                                                                                                                                 | Menutup                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| CSRF                 | Integrasi hotfix ke `createApiHandler` (sebelum rate limit), host check `/api`                                                                                                                                                      | R4-G1, G21 (sebagian), G22           |
| Retensi              | Prune hanya setelah run `succeeded`, berbasis catatan `backup_run` (bukan listing bucket), simpan minimal N run sukses + item valid terakhir per (jenis, nama)                                                                      | R4-G2                                |
| Cakupan              | `globals` Postgres, arsip folder situs (tanpa binary), `config.yml` cloudflared, grup opsional **Kunci rahasia** (`data/secret`, `~/panel/.env`, kredensial tunnel `*.json`), `manifest.json` per run, batas ukuran, cek ruang disk | R4-G3                                |
| Kunci data           | Key-check di `app_meta`, mode "kunci tidak cocok" yang terlihat dan tidak merusak, reset terkontrol, unduh kunci data                                                                                                               | R4-G4, G16 (sebagian)                |
| Snapshot upgrade     | `VACUUM INTO data/snapshots/` sebelum migrasi tertunda, simpan 3                                                                                                                                                                    | R4-G5                                |
| Petunjuk pulih       | Perintah absolut, `SVDIR`, tidak destruktif secara default; runbook "Pulihkan ke HP baru" di README                                                                                                                                 | R4-G6                                |
| Verifikasi           | sha256 + ukuran + `pg_restore --list` / `PRAGMA quick_check` / `tar -tzf` sebelum unggah, `stat` setelah unggah                                                                                                                     | R4-G9                                |
| Pulihkan terpandu    | "Pulihkan ke database baru" untuk item database (non-destruktif, sekaligus uji pemulihan), hapus database uji                                                                                                                       | R4-G10                               |
| Uji koneksi S3       | `POST /api/dev/backup/test` (tulis → baca → list → hapus)                                                                                                                                                                           | R5-G9 (API)                          |
| Audit                | Kolom `actor_kind/actor_label/actor_email/ip_masked/user_agent/request_id`, aksi baru, filter, retensi                                                                                                                              | R4-G14, G19 (retensi), R5-G6 (skema) |
| Sesi                 | Umur absolut 30 hari, cabut sesi pengguna lain / semua pengguna, sesi "segar" untuk aksi kunci data                                                                                                                                 | R4-G13 (API), G18                    |
| Model kepercayaan    | Teks jujur "Admin = kendali penuh atas HP" (keputusan pemilik 1)                                                                                                                                                                    | R4-G11                               |
| HTTP wave A          | `/__spa` tidak bisa dijangkau dari luar                                                                                                                                                                                             | R4-G12                               |
| Ringkasan            | `recentActivity` untuk admin tanpa `auth.*`/`session.*`                                                                                                                                                                             | R4-G20                               |
| Access               | Deteksi header Access untuk onboarding/masalah; README tetap                                                                                                                                                                        | R4-G7 (deteksi), interplay           |
| Supply chain & rilis | CI (`bun audit --audit-level=high`, typecheck, lint, test, build), rilis tag → binary + `SHA256SUMS` + attestation                                                                                                                  | R4-G23, keputusan pemilik 2          |

### Out of scope (dengan alasan)

- **Enkripsi cadangan dengan kunci publik (`age`)** → P2. Tidak trivial: butuh `pkg install age` di HP, UX kunci privat, dekripsi di runbook, dan uji. Selama belum ada, grup **Kunci rahasia** default **mati** (§2 K4).
- Uji pemulihan **terjadwal** (mingguan, otomatis) → P2. Yang manual ("Pulihkan ke database baru") ada di P1.
- Pulihkan **menimpa** database yang ada dari UI → P2 (butuh stop aplikasi + cadangan sesaat sebelum). Pulihkan `panel.db` dari UI → tidak (proses yang sedang memakainya); tetap CLI dengan perintah yang benar.
- Cadangan lokal (ring N) saat S3 belum diatur → P2 (R4-G24). Snapshot pra-migrasi masuk P0.
- Rotasi `data/secret` dengan re-enkripsi → P2.
- Validasi JWT `Cf-Access-Jwt-Assertion` → P2 (R4-G21 sisa).
- Allowlist email / blokir akun → tidak (keputusan pemilik 4: login terbuka).
- Peran `operator` terbatas → tidak (keputusan pemilik 1).
- Hash chain / trigger append-only audit → P2 (R4-G19 bagian tamper). Siapa pun yang punya shell bisa menghapus trigger, jadi nilainya kecil.
- Tampilan halaman Audit, Pengaturan, Kesehatan, Profil, Pengguna → milik PLAN/05. PLAN ini menyediakan skema, API, komponen keamanan, dan copy.

### Prioritas

- **P0**: CSRF di handler, retensi aman, cakupan + manifest + batas ukuran, key-check + mode tidak cocok, snapshot pra-migrasi, petunjuk pulih benar, `/__spa`, teks model kepercayaan.
- **P1**: verifikasi per item, pulihkan ke database baru, uji koneksi S3, kolom & aksi audit + retensi, sesi absolut + cabut sesi pengguna lain/semua, unduh kunci data, deteksi Access, host check `/api`, CI + rilis.
- **P2**: lihat Out of scope.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternatif                                                                                                                                                                                  | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Guard CSRF dipanggil sekali, paling awal, di `createApiHandler`** (`src/server/http/api.handler.ts`), memakai `rejectForeignOrigin` dari hotfix tanpa mengubah aturannya. Saat main di-merge ke branch ini, `.onRequest(...)` di `api.routes.ts` **dihapus**. File `origin.guard.ts` tetap di `src/server/routes/` (lokasi dari main) agar merge bersih.                                                                                                                                                                                                | (a) Biarkan di `api.routes.ts` `.onRequest`; (b) pasang di dua tempat                                                                                                                       | Di hotfix, `createApiHandler` sudah mengambil kuota rate limit mutasi (`mutationLimit.take`, `api.handler.ts:100-103`) **sebelum** Elysia menjalankan `onRequest`. Akibatnya halaman situs yang di-host bisa mengirim 60 POST `no-cors` per menit dan menghabiskan kuota sesi admin (DoS mutasi), walaupun semuanya ditolak 403. Guard sebelum rate limit menutup itu. Dua tempat = dua log `[csrf]` per request. Test unit API yang memanggil `api.handle` langsung tidak lagi melewati guard. Cakupan pindah ke `tests/server.http.test.ts`; header tambahan di harness test dari hotfix tetap (tidak berbahaya).                                                                                                                                                                                                                                                             |
| K2  | **Host check `/api`**: bila `Host` bukan host `APP_BASE_URL` dan bukan `127.0.0.1`/`localhost`/`[::1]` (port apa pun) → 421 `wrong_host`.                                                                                                                                                                                                                                                                                                                                                                                                                 | Redirect 302 seperti halaman                                                                                                                                                                | Menutup bypass Access bila ingress kedua salah mengarah ke port panel (R4-G21). Installer dan probe memakai `127.0.0.1`, jadi tetap jalan. Redirect pada POST API tidak berguna.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| K3  | **Retensi berbasis catatan `backup_run`, bukan listing bucket.** Prune hanya setelah run `succeeded`. Yang dilindungi: `backup.keep_min_runs` (default 3) run `succeeded` terbaru, dan item `ok` terbaru per (`kind`,`name`) dari run berstatus apa pun. Objek yang tidak tercatat di `backup_run` tidak pernah dihapus.                                                                                                                                                                                                                                  | (a) Tetap listing prefix + `lastModified` (R4 6.5-A); (b) model Coolify penuh dengan batas GB (P2)                                                                                          | Listing menghapus objek manual di prefix yang sama dan tidak tahu item mana yang valid. Catatan DB tahu `ok`, `kind/name`, dan run status. Konsekuensi: objek dari `panel.db` lain (mis. setelah memulihkan `panel.db` lama) tidak pernah di-prune otomatis. Ini sisi aman dan didokumentasikan (lifecycle rule bucket opsional).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| K4  | **Cakupan cadangan dibagi dua.** _Selalu_: database, `globals` (`pg_dumpall --globals-only`, berisi hash SCRAM password role), `panel.db`, `sites` (arsip `sites.dir` tanpa `*/app`, `*/app.prev`, `*/node_modules`, file `.panel-tmp`), `cloudflared` (`config.yml` + `config.yml.bak*` saja). _Opsional_ `backup.include_secrets=on` (default `off`): item `secrets` berisi `data/secret`, `~/panel/.env`, `~/.cloudflared/*.json`. **`cert.pem` tidak pernah dicadangkan.**                                                                            | (a) Semua ikut (default brief); (b) tanpa secret sama sekali                                                                                                                                | Garisnya ada pada **kendali infrastruktur vs data aplikasi**. `.env` situs dan dump DB berisi data aplikasi yang tidak bisa didapat ulang (mis. `MAKURO_KEY`, data pengguna), jadi wajib ikut, dengan peringatan jujur bahwa isinya rahasia. Item `secrets` memberi kendali server: dengan `data/secret` + `panel.db` di bucket yang sama, siapa pun yang bisa membaca bucket bisa mendekripsi kunci S3 (lalu **menghapus semua cadangan**), token Cloudflare, dan memalsukan cookie super_admin. Kredensial tunnel bisa menjalankan konektor untuk hostname-mu. Semuanya bisa diterbitkan ulang dari penyedianya (Google Console, Cloudflare `tunnel login` + `tunnel token --cred-file`, R2 token baru). `cert.pem` = kendali akun Cloudflare, bisa didapat ulang dengan `cloudflared tunnel login`. Setelah enkripsi `age` (P2) ada, default `include_secrets` bisa dibalik. |
| K5  | **Manifest per run** `<stem>manifest.json` diunggah terakhir. Berisi format, versi panel, schema, daftar item (`kind,name,file,sizeBytes,sha256`), yang sengaja dikecualikan, dan urutan pemulihan. Tanpa secret.                                                                                                                                                                                                                                                                                                                                         | Hanya catatan di `panel.db`                                                                                                                                                                 | Saat HP hilang, `panel.db` ada di bucket yang sama dan belum tentu bisa dibaca. Manifest bisa dibaca manusia dan menjelaskan isi satu folder run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| K6  | **Verifikasi sebelum unggah, `stat` sesudah unggah**: `pg_restore --list` (dump), untuk `globals.sql` cukup cek ukuran > 0 dan baris pertama diawali `--`, `PRAGMA quick_check` (snapshot `panel.db`, dibuka read-only), `tar -tzf` (arsip). sha256 dihitung streaming. Setelah `client.write`, `client.stat(key).size` harus sama → bila tidak, objek dihapus dan item gagal `upload_mismatch`.                                                                                                                                                          | `integrity_check` penuh; HEAD dengan ETag MD5                                                                                                                                               | `quick_check` O(N) tanpa cek index, cukup murah di HP. ETag multipart bukan MD5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| K7  | **Batas ukuran**: `backup.max_item_mb` (default 2048, rentang 10–20480). Item yang hasilnya lebih besar tidak diunggah → `too_large`. Sebelum tiap item: `statfsSync(tmpDir)` bebas ≥ perkiraan + 256 MB cadangan ruang, bila tidak → `insufficient_space`. Perkiraan: `sizeBytes` dari `listDatabases` untuk DB, 0 untuk lainnya.                                                                                                                                                                                                                        | Tanpa batas                                                                                                                                                                                 | HP bisa penuh di tengah dump. Membiarkan prosesnya gagal tidak jelas sebabnya.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K8  | **Kunci data: deteksi, bukan auto-perbaikan.** `app_meta.secret_check` = 16 byte hex HKDF(secret, info `panel-termux/key-check/v1`). Bila file `secret` hilang, panel tetap membuat secret baru (Better Auth butuh secret untuk jalan), tetapi **tidak menyentuh** baris setting terenkripsi, menandai status `mismatch`, mencatat audit `secret.mismatch`, dan menampilkan masalah merah. Bila file lama dikembalikan, status otomatis `ok` lagi. Reset (hapus setting rahasia yang tidak terbaca) hanya lewat aksi super_admin dengan konfirmasi ketik. | (a) Tolak start (`exit 1`) sampai env `PANEL_RESET_SECRET=1`; (b) status quo (diam-diam)                                                                                                    | (a) membuat panel mati total, padahal monitoring dan kontrol layanan tetap berguna dan pemilik mungkin hanya punya browser. Mode `mismatch` tidak destruktif: tidak ada data yang dihapus sebelum pemilik memutuskan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| K9  | **Snapshot pra-migrasi** di boot: bila `__drizzle_migrations` ada dan jumlah barisnya < jumlah migrasi embedded → `VACUUM INTO <dataDir>/snapshots/panel.db.<versiLama>.<yyyymmddHHMMSS>` (mode 600), simpan 3 terbaru. Bila snapshot gagal → panel **tidak** menjalankan migrasi dan `exit(1)` dengan pesan yang menyebut env `PANEL_SKIP_SNAPSHOT=1`.                                                                                                                                                                                                   | Snapshot di `install-phone.sh`                                                                                                                                                              | Di boot, DB belum dipakai siapa pun, jadi snapshot konsisten. Menyalin file saat panel lama jalan (WAL) tidak aman. Pola Coolify: update diblokir bila backup gagal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| K10 | **Pulihkan terpandu = "Pulihkan ke database baru" saja** (`<nama>_r<yyyymmddHHMM>`), sekaligus berfungsi sebagai uji pemulihan. Konfirmasi tier **confirm** (bukan typed) karena non-destruktif. Menghapus database hasil pulih = tier **typed** (ketik nama DB).                                                                                                                                                                                                                                                                                         | Timpa langsung dengan typed + cadangan sebelum                                                                                                                                              | R&D-01 G8 memetakan "pulihkan" ke typed. PLAN ini sengaja menyimpang karena aksi ini tidak menimpa apa pun. Konfirmasi ketik untuk aksi yang tidak merusak melatih pengguna mengetik tanpa membaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| K11 | **Audit: konteks request lewat `AsyncLocalStorage`** (`src/server/http/request.context.ts`) yang diisi `createApiHandler`. `recordAudit` mengisi `ip_masked`, `user_agent` (ringkas), `request_id` otomatis, dan mengisi `actor_label/actor_email` dari tabel `user` saat kejadian. Tidak ada pemanggil yang perlu diubah.                                                                                                                                                                                                                                | Tiap pemanggil mengoper request                                                                                                                                                             | Diff terkecil. Job situs yang dimulai dari request mewarisi request id-nya, dan itu memang diinginkan. Scheduler berjalan tanpa konteks → null. IP disimpan **tersamar** (`maskIp`, pola sesi) sesuai Rule 12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K12 | **`actor_kind`** `user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | system                                                                                                                                                                                      | unknown`(default`unknown`untuk baris lama). Backfill:`actor_id`ada →`user`+ label/email;`backup.run`tanpa aktor →`system`; sisanya tetap `unknown`(UI: "Sistem atau pengguna terhapus"). Kolom`actor_label` milik PLAN ini; PLAN/05 hanya membaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Soft-delete pengguna (R5 A2)                    | Baris lama yang aktornya sudah terhapus memang tidak bisa direkonstruksi, jadi jujur ditandai `unknown`. |
| K13 | **Retensi audit** `audit.retention_days` (default 365, rentang 90–3650). Prune dijalankan saat boot dan saat tanggal lokal berganti, di dalam tick scheduler cadangan yang sudah ada (`backup.service.ts:210`), tanpa timer baru.                                                                                                                                                                                                                                                                                                                         | Timer sendiri; sampler PLAN/02                                                                                                                                                              | Tick per menit sudah ada dan tetap jalan walau cadangan belum diatur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| K14 | **Sesi**: tetap `expiresIn` 7 hari sliding (`updateAge` 1 hari, ditulis eksplisit). Ditambah **umur absolut 30 hari** (`SESSION_ABSOLUTE_MAX_DAYS`) yang diperiksa di satu helper `getSessionChecked`. Sesi yang lebih tua dihapus → 401. Aksi kunci data (unduh, reset) butuh **sesi segar ≤ 15 menit** sejak login (`session.createdAt`) → selain itu 403 `reauth_required`.                                                                                                                                                                            | `freshAge` Better Auth                                                                                                                                                                      | `freshAge` hanya berlaku untuk endpoint Better Auth sendiri. Cek `createdAt` cukup satu baris.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K15 | **Model kepercayaan admin (keputusan pemilik 1)**: tidak ada sandbox. Unduh cadangan tetap **admin**, kecuali item `secrets` = **super_admin** (bukan batas keamanan, hanya mengurangi paparan tidak sengaja; ditulis begitu di docs). Unduh kunci data dan reset = super_admin.                                                                                                                                                                                                                                                                          | Pindahkan semua unduh ke super_admin                                                                                                                                                        | Admin bisa deploy binary yang membaca semua file, jadi membatasi unduh `panel.db` hanya memberi rasa aman palsu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| K16 | **`/__spa` → path acak per proses** (`/__spa-<uuid>`). Path lama jatuh ke handler `/*` dan mendapat CSP/XFO seperti halaman lain.                                                                                                                                                                                                                                                                                                                                                                                                                         | Cek header rahasia (HTMLBundle tidak bisa diberi handler)                                                                                                                                   | Satu baris. Bun tidak mengizinkan handler untuk HTMLBundle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| K17 | **Header aset bundle**: tidak diubah. Cache sudah benar dari Bun (bukti spike). `nosniff` tidak ada di aset, tetapi `Content-Type` sudah benar (`text/javascript`, `text/css`), jadi risiko diterima dan dicatat.                                                                                                                                                                                                                                                                                                                                         | Menyajikan aset sendiri                                                                                                                                                                     | Rute aset eksak milik Bun menang atas wildcard, jadi menyajikannya sendiri butuh `server.reload` dengan daftar aset. Itu besar untuk manfaat yang kecil. **PLAN/01 tidak perlu mengerjakan R1-G14 opsi B** (sudah dipenuhi Bun).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| K18 | **Deteksi Cloudflare Access**: `createApiHandler` mencatat di memori `lastAccessSeenAt` setiap kali request `/api/panel                                                                                                                                                                                                                                                                                                                                                                                                                                   | dev`yang terautentikasi membawa header`cf-access-jwt-assertion`. Hanya untuk tampilan (onboarding/Kesehatan), **tidak pernah** untuk keputusan izin (header bisa dipalsukan dari loopback). | Validasi JWT (P2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Murah dan cukup untuk menjawab "Access aktif?". |
| K19 | **Rilis**: GitHub Actions `release.yml` pada tag `v*.*.*` → cek tag = `package.json` version → `bun install --frozen-lockfile` → `bun audit --audit-level=high` → typecheck → lint → test → build → `SHA256SUMS` → `actions/attest-build-provenance` → `gh release create`. `ci.yml` untuk push/PR menjalankan langkah yang sama tanpa rilis. Bun dipin `1.4.2`. Action dipin ke **commit SHA** (diverifikasi saat implementasi, Rule 20).                                                                                                                | GPG signing; tanpa CI                                                                                                                                                                       | Checksum menjaga dari korupsi unduhan. Attestation (`gh attestation verify`) membuktikan binary dibangun dari repo + workflow ini. GPG butuh pengelolaan kunci, jadi P2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K20 | **Notifikasi** (keputusan pemilik 3) dikirim oleh notifier PLAN/02. PLAN ini hanya memancarkan event (kontrak §3.7).                                                                                                                                                                                                                                                                                                                                                                                                                                      | Notifier sendiri                                                                                                                                                                            | Satu kanal, satu dedup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Default brief yang diikuti: enkripsi P2 ✔, cakupan P0 ✔ dengan peringatan jujur ✔ (tetapi secret opt-in, lihat K4, **menyimpang dari default "semua ikut"**: ditandai untuk debat), `apps.json`/`ecosystem.config.js` ikut lewat arsip `sites` ✔ (panel tidak mengeditnya), app.prev tidak dicadangkan (bisa di-deploy ulang).

---

## 3. Model data & kontrak API

### 3.1 Tipe bersama

**`src/shared/backup.types.ts`** (ganti seluruh isi; kompatibel dengan baris lama karena field baru nullable)

```ts
/** What started a run. */
export type BackupTrigger = "schedule" | "manual";
/** Run outcome; `partial` = at least one item failed and at least one succeeded. */
export type BackupRunStatus = "running" | "succeeded" | "failed" | "partial";
/** What one uploaded object holds. `manifest` is the run's index file (uploaded last). */
export type BackupItemKind = "database" | "globals" | "panel" | "sites" | "cloudflared" | "secrets" | "manifest";
/** Failure code of one item (UI maps to Indonesian); null when ok. */
export type BackupItemErrorCode =
  | "produce_failed" | "verify_failed" | "too_large" | "insufficient_space"
  | "upload_failed" | "upload_mismatch" | "key_mismatch";

/** One uploaded (or failed) object of a run. */
export type BackupItem = {
  kind: BackupItemKind;
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  /** Short technical detail (masked), shown under the Indonesian message. */
  error: string | null;
  errorCode: BackupItemErrorCode | null;
  /** Hex sha256 of the uploaded bytes; null for rows written before 0.3.0. */
  sha256: string | null;
  /** true = local check passed before upload; null = not checked (old rows). */
  verified: boolean | null;
  /** Object deleted by retention: no download, no restore. */
  pruned: boolean;
  /** Ready-to-copy, non-destructive command for a new phone (absolute paths). Empty for `manifest`. */
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
  /** Set when every item of the run has been pruned. */
  prunedAt: string | null;
};

/** Newest ok, non-pruned item per (kind, name): what a restore would use. */
export type BackupLastGood = {
  kind: Exclude<BackupItemKind, "manifest">;
  name: string;
  runId: string;
  itemIndex: number;
  at: string;
  sizeBytes: number | null;
  verified: boolean | null;
};

/** GET /api/panel/backups/status. */
export type BackupStatus = {
  configured: boolean;
  missing: string[];
  /** Encrypted backup settings cannot be read with the current data key (see SecurityStatus). */
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
  /** Newest succeeded "Pulihkan ke database baru", null if never. */
  lastRestoreTest: { at: string; sourceName: string } | null;
};

export type BackupRunStarted = { runId: string };

/** Written to `<stem>manifest.json`; never holds secret values. */
export type BackupManifest = {
  format: 1;
  runId: string;
  createdAt: string;
  panelVersion: string;
  schemaVersion: string;
  includesSecrets: boolean;
  items: { kind: BackupItemKind; name: string; file: string; sizeBytes: number; sha256: string }[];
  /** Deliberately not backed up, in plain words (e.g. "~/.cloudflared/cert.pem", "sites/*/app"). */
  excluded: string[];
  restoreOrder: Exclude<BackupItemKind, "manifest">[];
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
  actor: { id: string; name: string } | null;
};

/** 202 body of POST /api/panel/backups/:id/items/:index/restore. */
export type BackupRestoreStarted = { restoreId: string; targetDb: string };

/** Body of POST /api/dev/backup/test; omitted fields fall back to the stored settings. */
export type BackupTestInput = Partial<{
  endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string;
}>;
export type BackupTestStep = "write" | "read" | "list" | "delete";
export type BackupTestResult = {
  ok: boolean;
  steps: { step: BackupTestStep; ok: boolean; code: string | null }[];
  ms: number;
};
```

**`src/shared/security.types.ts`** (baru)

```ts
/** `ok` = key check matches; `mismatch` = encrypted settings exist that this key cannot read. */
export type DataKeyState = "ok" | "mismatch";

/** GET /api/dev/security. */
export type SecurityStatus = {
  dataKey: {
    state: DataKeyState;
    /** The secret file was created at this boot (fresh install or lost file). */
    createdThisBoot: boolean;
    exportedAt: string | null;
    /** Setting keys that cannot be decrypted (mismatch only). */
    unreadableSettings: string[];
  };
  access: {
    /** APP_BASE_URL is https (Access only applies then). */
    https: boolean;
    /** Last authenticated /api/panel|dev request carrying an Access JWT header; null = not seen since boot. */
    lastSeenAt: string | null;
  };
  sessions: { active: number; users: number; absoluteMaxDays: number };
  backupsIncludeSecrets: boolean;
};

/** POST /api/dev/sessions/revoke-all and POST /api/dev/users/:id/sessions/revoke. */
export type RevokedSessions = { revoked: number };

/** Body of POST /api/dev/security/data-key/reset. */
export type DataKeyResetInput = { confirm: "hapus" };
```

**`src/shared/dev.types.ts`** — `DevAuditEntry` diperluas (field lama tetap):

```ts
export type AuditActorKind = "user" | "system" | "unknown";
export type DevAuditEntry = {
  id: number;
  at: string;
  /** Live user (null when deleted or system). */
  actor: UserRef | null;
  actorKind: AuditActorKind;
  /** Name/email at the time of the event (survives user deletion). */
  actorLabel: string | null;
  actorEmail: string | null;
  /** actorKind "user" but the account no longer exists. */
  actorDeleted: boolean;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  ipMasked: string | null;
  userAgent: string | null;
  requestId: string | null;
};
```

`ProblemKind` (`src/shared/panel.types.ts`, milik PLAN/02) perlu nilai baru **`"security"`**, lihat §3.7.

### 3.2 Skema DB & migrasi

Satu migrasi `drizzle/00NN_data_safety.sql` (nomor = nomor bebas berikutnya saat digenerate; koordinasi §7). Dibuat dengan `bun run db:generate` dari perubahan skema Drizzle, lalu blok backfill ditambahkan manual di akhir file. Migrasi dijalankan lokal (`bun test tests/db.migrate.test.ts` + boot lokal) dan diverifikasi dengan `sqlite3 data/panel.db ".schema audit_log"`.

Idempotensi: SQLite tidak punya `ADD COLUMN IF NOT EXISTS`. Penjaganya adalah journal drizzle (`__drizzle_migrations`, hash per file), sehingga migrasi hanya jalan sekali. Tabel baru memakai `CREATE TABLE IF NOT EXISTS` dan index `IF NOT EXISTS` (diedit manual setelah generate). Kolom `NOT NULL` di tabel yang sudah berisi data selalu diberi `DEFAULT`.

```sql
-- audit_log: who did it must survive user deletion, and where it came from (R&D-04 G14, R&D-05 G6).
ALTER TABLE `audit_log` ADD `actor_kind` text DEFAULT 'unknown' NOT NULL;
ALTER TABLE `audit_log` ADD `actor_label` text;
ALTER TABLE `audit_log` ADD `actor_email` text;
ALTER TABLE `audit_log` ADD `ip_masked` text;
ALTER TABLE `audit_log` ADD `user_agent` text;
ALTER TABLE `audit_log` ADD `request_id` text;
-- backup_run: run-level facts for retention and restore (items stay JSON; new item fields are optional).
ALTER TABLE `backup_run` ADD `includes_secrets` integer DEFAULT 0 NOT NULL;
ALTER TABLE `backup_run` ADD `panel_version` text;
ALTER TABLE `backup_run` ADD `pruned_at` integer;
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
CREATE INDEX IF NOT EXISTS `backup_restore_started_at_idx` ON `backup_restore` (`started_at`);
-- Backfill (rows written before this migration). Deleted actors cannot be recovered: they stay 'unknown'.
UPDATE `audit_log` SET `actor_kind` = 'user',
  `actor_label` = (SELECT `name` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`),
  `actor_email` = (SELECT `email` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`)
  WHERE `actor_id` IS NOT NULL;
-- Scheduled runs were the only actor-less backup.run rows.
UPDATE `audit_log` SET `actor_kind` = 'system' WHERE `actor_id` IS NULL AND `action` = 'backup.run';
```

Drizzle schema yang berubah: `audit-log.schema.ts` (6 kolom), `backup.schema.ts` (3 kolom; `BackupItemRow` ditambah `errorCode?`, `sha256?`, `verified?`, `pruned?`, semuanya opsional di JSON), `backup-restore.schema.ts` (baru), `schema/index.ts` (re-export).

`app_meta` (key/value, tanpa migrasi): `secret_check`, `panel_version` (ditulis tiap boot setelah migrasi), `secret_exported_at` (ISO).

### 3.3 Setting baru (`settings.service.ts`, ditambahkan di **akhir** registri)

| Key                      | Default | Validasi       | Arti                                                      |
| ------------------------ | ------- | -------------- | --------------------------------------------------------- |
| `backup.keep_min_runs`   | `3`     | bulat 1–30     | Jumlah run `succeeded` terbaru yang tidak pernah di-prune |
| `backup.include_secrets` | `off`   | `on`/`off`     | Sertakan item `secrets`                                   |
| `backup.max_item_mb`     | `2048`  | bulat 10–20480 | Batas ukuran satu item                                    |
| `audit.retention_days`   | `365`   | bulat 90–3650  | Umur maksimal baris audit                                 |

Deskripsi `backup.retention_days` diubah menjadi "Cadangan lebih tua dari ini dihapus setelah run yang berhasil penuh; N cadangan berhasil terakhir dan cadangan valid terakhir tiap item selalu disimpan." Label dan deskripsi akan dipindah ke web oleh PLAN/05 (R5 L2); copy Indonesia ada di §5.4. `getSetting` untuk key rahasia yang gagal didekripsi melempar **`KeyMismatchError`** (subclass `Error`, nama key di pesan) sehingga pemanggil bisa memetakannya ke 409 `key_mismatch`.

### 3.4 Endpoint

Semua mutasi melewati guard K1 (wajib `X-Requested-With`, origin sama). Kode error berupa `{ error, message }` seragam (`api.handler.ts`).

| Metode & path                                             | Peran                               | Request                                                                                                    | Response                                                                                                                                           | Error                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/panel/backups/status`                           | admin                               | –                                                                                                          | `BackupStatus`                                                                                                                                     | – (tidak pernah 500 karena kunci; `keyMismatch: true`)                                                                      |
| GET `/api/panel/backups?page&pageSize`                    | admin                               | –                                                                                                          | `Page<BackupRun>`                                                                                                                                  | 400 `invalid_pagination`                                                                                                    |
| POST `/api/panel/backups/run`                             | admin                               | –                                                                                                          | 202 `BackupRunStarted`                                                                                                                             | 400 `not_configured` (+`missing`), 409 `busy` (run atau restore berjalan), 409 `key_mismatch`                               |
| GET `/api/panel/backups/:id/items/:index/download`        | admin; item `secrets` = super_admin | –                                                                                                          | 302 presigned GET 15 mnt                                                                                                                           | 403 `forbidden`, 404 `not_found`, 410 `pruned`, 400 `not_configured`, 409 `key_mismatch`                                    |
| POST `/api/panel/backups/:id/items/:index/restore`        | admin                               | `{}`                                                                                                       | 202 `BackupRestoreStarted`                                                                                                                         | 400 `not_database`, 404, 410 `pruned`, 409 `busy`, 409 `insufficient_space`, 409 `key_mismatch`                             |
| GET `/api/panel/backups/restores?page&pageSize`           | admin                               | –                                                                                                          | `Page<BackupRestore>`                                                                                                                              | –                                                                                                                           |
| DELETE `/api/panel/backups/restores/:id/database`         | admin                               | `{ confirm: string }` = `targetDb`                                                                         | 204                                                                                                                                                | 400 `confirm_mismatch`, 404, 409 `busy`, 409 `already_dropped`, 409 `restore_running`                                       |
| POST `/api/dev/backup/test`                               | super_admin                         | `BackupTestInput`                                                                                          | 200 `BackupTestResult`                                                                                                                             | 400 `invalid_value` (validator setting yang sama), 400 `not_configured` (setelah fallback masih kurang), 409 `key_mismatch` |
| GET `/api/dev/audit?action&actorId&from&to&page&pageSize` | super_admin                         | `action` diakhiri `.` = prefix (`user.` → `user.%`, `%`/`_` di-escape), selain itu exact. `from`/`to` ISO. | `Page<DevAuditEntry>`                                                                                                                              | 400 `invalid_date`                                                                                                          |
| GET `/api/dev/security`                                   | super_admin                         | –                                                                                                          | `SecurityStatus`                                                                                                                                   | –                                                                                                                           |
| POST `/api/dev/security/data-key/export`                  | super_admin, sesi segar             | –                                                                                                          | 200 `text/plain; charset=utf-8`, `content-disposition: attachment; filename="panel-termux-kunci-data-<yyyy-mm-dd>.txt"`, `cache-control: no-store` | 403 `reauth_required`, 409 `key_mismatch` (mengekspor kunci yang salah tidak berguna)                                       |
| POST `/api/dev/security/data-key/reset`                   | super_admin, sesi segar             | `DataKeyResetInput`                                                                                        | 200 `SecurityStatus`                                                                                                                               | 400 `confirm_mismatch`, 403 `reauth_required`, 409 `key_ok`                                                                 |
| POST `/api/dev/sessions/revoke-all`                       | super_admin                         | –                                                                                                          | `RevokedSessions` (semua sesi semua pengguna kecuali sesi pemanggil)                                                                               | –                                                                                                                           |
| POST `/api/dev/users/:id/sessions/revoke`                 | super_admin                         | –                                                                                                          | `RevokedSessions`                                                                                                                                  | 404 `not_found`, 409 `protected` (id = diri sendiri: pakai `/api/me/sessions`)                                              |
| `/api/me/sessions*`                                       | sesi apa pun                        | (tetap)                                                                                                    | (tetap)                                                                                                                                            | sekarang terkena rate limit mutasi                                                                                          |

Isi file unduhan kunci data (teks, tanpa nilai lain):

```
Panel Termux — kunci data (data/secret)
Panel: https://panel.example.com · dibuat 2026-11-26 21.30
Simpan file ini di tempat aman di luar HP (pengelola kata sandi). Siapa pun yang memegangnya
bersama panel.db bisa membaca pengaturan rahasia dan memalsukan sesi.
Cara memakai di HP baru: sv down panel, tulis baris di bawah ke ~/panel/data/secret
(chmod 600), lalu sv up panel.

<64 hex>
```

### 3.5 Modul server (nama file & tanda tangan, agar worker paralel tidak menebak)

```ts
// src/server/http/request.context.ts
export type RequestContext = { requestId: string; ipMasked: string | null; userAgent: string | null };
export function runWithRequest<T>(ctx: RequestContext, fn: () => T): T;
export function currentRequest(): RequestContext | null;

// src/server/http/api.handler.ts
export function createApiHandler(api: Handler, opts: { appBaseUrl: string }): (req, server?) => Promise<Response>;
/** Last time an authenticated /api/panel|dev request carried cf-access-jwt-assertion (K18). */
export const accessSeen: { at: Date | null };

// src/server/secret.ts
export function loadOrCreateSecret(dataDir: string): { secret: string; created: boolean };

// src/server/data-key.service.ts
export function keyCheckValue(secret: string): string;
/** Boot: decides ok/mismatch, writes app_meta.secret_check when safe, audits a mismatch. */
export function checkDataKeyOnBoot(db: Db, secret: string, created: boolean): DataKeyState;
export function dataKeyState(db: Db, secret: string): { state: DataKeyState; unreadable: SettingKey[] };
export function resetUnreadableSettings(db: Db, secret: string, actorId: string): SettingKey[];
export function exportDataKeyText(secret: string, appBaseUrl: string, now: Date): string;

// src/server/db/snapshot.ts
/** VACUUM INTO before pending migrations; returns the snapshot path or null (nothing pending / fresh DB). */
export function snapshotBeforeMigrations(db: Db, dataDir: string, prevVersion: string | null, now?: Date): string | null;
export const SNAPSHOT_KEEP = 3;

// src/server/auth/role.guard.ts
export const SESSION_ABSOLUTE_MAX_DAYS = 30;
export const FRESH_SESSION_MS = 15 * 60_000;
/** getSession + absolute-age check (deletes and returns null when too old). Used by roleGuard, /me, sessions. */
export async function getSessionChecked(auth: Auth, db: Db, headers: Headers): Promise<SessionWithUser | null>;
export function assertFresh(session: { createdAt: Date }, now?: Date): void; // ApiError 403 reauth_required

// src/server/auth/sessions.service.ts (tambahan)
export function revokeAllSessions(db: Db, exceptSessionId: string): number;
export function revokeUserSessions(db: Db, userId: string): number;

// src/server/auth/auth.audit.ts (baru): wraps Better Auth's handler for sign-out / failed callback audit.
export function handleAuthRequest(auth: Auth, db: Db, req: Request): Promise<Response>;

// src/server/audit.service.ts (tambahan)
export type AuditFilter = { action?: string; actorId?: string; from?: Date; to?: Date; excludePrefixes?: string[] };
export function pruneAudit(db: Db, retentionDays: number, now?: Date): number;

// src/server/system/system.types.ts (tambahan)
export interface PostgresAdapter { /* + */
  dumpGlobals(file: string): Promise<void>;          // pg_dumpall --globals-only -w -f file
  verifyDump(file: string): Promise<void>;           // pg_restore --list file (stdout dibuang)
  restoreInto(file: string, target: string, owner: string): Promise<{ tableCount: number }>;
  dropDatabase(name: string): Promise<void>;         // DROP DATABASE IF EXISTS … WITH (FORCE); role TIDAK disentuh
}
export interface ArchiveAdapter {
  /** tar -czf file -C dir <entries…> with --exclude patterns; exit 1 ("file changed") counts as ok with warning. */
  create(file: string, dir: string, entries: string[], exclude: string[]): Promise<{ warning: string | null }>;
  list(file: string): Promise<void>;                 // tar -tzf
}
// SystemAdapters + { archive: ArchiveAdapter }

// src/server/backup/*  (backup.service.ts dipecah agar < 300 baris per file)
// backup.items.ts     — produksi + verifikasi + unggah per kind
// backup.retention.ts — planPrune(rows, cfg, now) murni + applyPrune
// backup.restore.ts   — restore ke database baru, drop
// backup.test.ts      — uji koneksi S3   (nama file: backup.probe.ts, agar tidak dikira test)
// backup.problems.ts  — backupProblems(status, now): Problem[]
// backup.events.ts    — emit ke notifier PLAN/02
```

### 3.6 Aksi audit baru (`AuditAction` di `audit.service.ts`)

| Aksi                   | Aktor         | Target           | meta                                                    |
| ---------------------- | ------------- | ---------------- | ------------------------------------------------------- |
| `auth.sign_out`        | pengguna      | –                | –                                                       |
| `auth.sign_in_failed`  | sistem        | –                | `{ error: <kode Better Auth, [a-z_]{1,40}> }`           |
| `auth.account_created` | pengguna baru | user id          | –                                                       |
| `user.role_sync`       | sistem        | user id          | `{ from, to, reason: "super_admin_emails" }`            |
| `session.revoke_all`   | super_admin   | user id atau `*` | `{ count }`                                             |
| `secret.mismatch`      | sistem        | –                | `{ createdThisBoot, unreadable: n }`                    |
| `secret.export`        | super_admin   | –                | –                                                       |
| `secret.reset`         | super_admin   | –                | `{ keys: SettingKey[] }`                                |
| `panel.start`          | sistem        | versi            | `{ schema, migratedFrom?, snapshot? (nama file saja) }` |
| `backup.test`          | super_admin   | bucket           | `{ ok, failedStep? }`                                   |
| `backup.restore`       | admin         | target DB        | `{ runId, item: name, status }` (ditulis saat selesai)  |
| `backup.restore_drop`  | admin         | target DB        | –                                                       |
| `backup.prune`         | sistem        | run id           | `{ deleted: n, failed: n }` (hanya bila n > 0)          |
| `audit.prune`          | sistem        | –                | `{ deleted: n }` (hanya bila n > 0)                     |

Aksi yang diminta PLAN lain (deploy upload start/batal, `log.download`, dll.) ditambahkan oleh PLAN itu di gelombang berikutnya (< 10 baris).

### 3.7 Kontrak lintas PLAN

- **Problem** (PLAN/02 memiliki `computeProblems`): PLAN ini menyediakan `backupProblems(status: BackupStatus, now): Problem[]` dan `securityProblems(sec: SecurityStatus, now): Problem[]`, lalu PLAN/02 memanggil keduanya. Isi:
  - `backup` danger: run terakhir `failed`; `security` danger `key_mismatch`.
  - `backup` warning: belum diatur; run terakhir `partial`; tiap (kind,name) yang dicoba di run terakhir dengan `lastGood` lebih tua dari 36 jam atau tidak ada (target = `database:<nama>` dst.); tidak ada run selesai 36 jam.
  - `security` warning `access_not_seen`: `https` dan `lastSeenAt` null atau > 24 jam padahal sudah ada request admin terautentikasi sejak boot.
  - Bila PLAN/02 mengganti `message` menjadi kode, pakai kode: `backup_failed`, `backup_partial`, `backup_not_configured`, `backup_stale`, `backup_item_stale`, `key_mismatch`, `access_not_seen`.
- **Event notifikasi** (notifier PLAN/02): `notify({ type, target, at })` dengan `type` ∈ `backup.failed | backup.partial | backup.recovered | security.key_mismatch`. `backup.recovered` dikirim saat run `succeeded` setelah run gagal/partial. Isi pesan tanpa nama key S3, tanpa isi error mentah.
- **Ringkasan**: `listAudit(db, paging, { excludePrefixes: ["auth.", "session."] })` untuk `recentActivity` (menutup R4-G20).

---

## 4. Flow

### F1 — Mutasi dari SPA (CSRF, K1/K2)

1. `createApiHandler` menerima request dan membuat `requestId`.
2. Host check: `Host` bukan host APP_BASE_URL dan bukan loopback → 421 `wrong_host` (dicatat `logRequest`, tanpa body log).
3. `rejectForeignOrigin(req, appBaseUrl)`, metode non-safe di luar `/api/auth/` → 403 `forbidden_origin`. **Kuota rate limit tidak berkurang.**
4. Rate limit: `AUTH_LIMITED` per IP; mutasi `^/api/(panel|dev|me)/` per sesi.
5. Batas body, lalu `runWithRequest({requestId, ipMasked, userAgent}, () => api.handle(...))`.
6. Bila path `/api/panel|dev`, user terautentikasi, dan header `cf-access-jwt-assertion` ada → `accessSeen.at = now`.
7. Edge: curl tanpa header ke `POST /api/panel/...` → 403 (memang disengaja; tidak ada alat CLI resmi yang memutasi). `GET /api/health` dari installer → tetap 200.

### F2 — Run cadangan (terjadwal atau manual)

1. `start()`: baca config. `keyMismatch` → 409 `key_mismatch` (manual) atau skip dengan `log.warn` maksimal **sekali per hari lokal** (terjadwal). Belum diatur → 400. Run atau restore berjalan → 409 `busy`.
2. Insert `backup_run` (`running`, `includes_secrets`, `panel_version`).
3. Urutan item: `globals` → tiap DB (`listDatabases`, urut nama) → `panel` → `sites` → `cloudflared` → `secrets` (bila `on`) → `manifest`. Satu item = satu file temp di `<dataDir>/backup-tmp/`.
4. Tiap item: cek ruang (`insufficient_space`) → produksi → cek ukuran (`too_large`) → verifikasi lokal (`verify_failed`) → sha256 streaming → `client.write` (`upload_failed`) → `client.stat(key).size` (`upload_mismatch`: coba `delete`, item gagal) → push item, simpan JSON. File temp selalu dihapus di `finally`.
   - `sites`: `archive.create(file, sitesDir, ["."], ["./*/app", "./*/app.prev", "*/node_modules", "*.panel-tmp"])`. Bila `sitesDir` tidak ada → item dilewati (tidak dihitung), bukan gagal.
   - `cloudflared`: entri `config.yml` dan `config.yml.bak*` yang ada. File `cert.pem` tidak pernah disertakan. Bila folder tidak ada → dilewati.
   - `secrets`: `tar -czf f -C <dataDir> secret -C <cwd> .env -C ~/.cloudflared <*.json>`. Entri yang tidak ada dilewati. Bila tidak ada satu pun → item gagal `produce_failed`.
   - `panel`: `VACUUM INTO` → buka read-only → `PRAGMA quick_check` harus `ok`.
5. `manifest` dibuat dari item yang `ok`, lalu diunggah. Bila manifest gagal, run menjadi `partial`.
6. Status: semua item ok dan tidak ada error daftar DB → `succeeded`; 0 ok → `failed`; selain itu `partial`.
7. **Hanya bila `succeeded`** → `planPrune` (F3) → `applyPrune`.
8. Simpan status, audit `backup.run`, emit event (`failed`/`partial`/`recovered`).
9. Edge:
   - Jaringan putus di tengah: item berikutnya gagal `upload_failed`, run `partial`/`failed`, tidak ada prune.
   - Panel restart di tengah: boot menandai `failed: interrupted by panel restart` (sudah ada) dan menghapus `backup-tmp`. Objek yang sempat terunggah tercatat sebagai item `ok`, jadi nanti ikut kandidat prune.
   - Disk penuh: `insufficient_space` per item, item lain tetap dicoba.
   - `pg_dumpall` gagal (mis. role `postgres` tidak trust): item `globals` gagal, DB lain tetap jalan, run `partial`.

### F3 — Retensi (`planPrune`, fungsi murni)

Input: semua baris `backup_run` non-`running`, `retentionDays R`, `keepMinRuns K`, `now`.

1. `protectedRuns` = K run `succeeded` terbaru.
2. `protectedItems` = untuk tiap (kind,name) selain `manifest`, item `ok && !pruned` terbaru (dari run berstatus apa pun).
3. Kandidat = item `ok && !pruned`, `run.startedAt < now − R hari`, run ∉ `protectedRuns`, item ∉ `protectedItems`. `manifest` run X ikut menjadi kandidat hanya bila semua item non-manifest run X sudah pruned atau sedang jadi kandidat.
4. `applyPrune`: `client.delete(key)` per kandidat. Sukses → `pruned=true`. Gagal → tetap, dihitung `failed`, dan run sekarang diberi `error` "retensi: N objek gagal dihapus" (status tetap `succeeded`). Bila semua item run X pruned → `pruned_at`.
5. Tidak ada `list` bucket. Kunci di luar catatan tidak tersentuh.
6. Edge: DB yang sudah dihapus (situs dihapus) → item terakhirnya dilindungi selamanya. Ini disengaja, hapus manual di bucket, dan dicatat di README. DB yang selalu gagal → semua run `partial` → tidak pernah prune → penyimpanan tumbuh, dan masalah `backup_partial` + notifikasi muncul tiap kali.

### F4 — Unduh item

1. admin klik **Unduh** (anchor GET). Item `secrets` dan peran < super_admin → 403.
2. Item `pruned` → 410 `pruned`, lalu UI menampilkan "Sudah dihapus oleh retensi".
3. 302 ke presigned URL 15 mnt, audit `backup.download`.
4. Edge: kunci S3 tidak terbaca (mismatch) → 409 `key_mismatch`, halaman error JSON. UI menyembunyikan tombol Unduh saat `keyMismatch`.

### F5 — Pulihkan ke database baru (+ uji pemulihan)

1. admin klik **Pulihkan ke database baru** pada item `database` (di "Cadangan terakhir" atau riwayat). Dialog tier confirm (§5.2).
2. Server: item harus `kind=database`, `ok`, `!pruned`. Ambil lock bersama (`busy` bila run/restore berjalan). Target `<nama dipotong>_r<yyyymmddHHMM>` (≤ 63 karakter, `SQL_IDENT_RE`). Bila nama sudah ada, tambahkan `_2`, `_3`.
3. Cek ruang: bebas ≥ 3 × `sizeBytes` + 256 MB → selain itu 409 `insufficient_space` **sebelum** insert. Insert `backup_restore` `running` → 202.
4. Latar: unduh objek ke temp (`Bun.write(tmp, client.file(key))`) → sha256 harus sama dengan item (bila `sha256` null, cek ini dilewati dan dicatat di `error` sebagai catatan) → `restoreInto(tmp, target, owner)`. Owner = pemilik DB sumber dari `listDatabases()` bila role-nya ada, selain itu `postgres`. Perintahnya: `createdb -w -O <owner> <target>` lalu `pg_restore -w --no-owner --role=<owner> --exit-on-error -d <target>` lalu hitung tabel non-sistem.
5. Selesai: `succeeded` + `table_count`, atau `failed` + `error_code`. Audit `backup.restore`. File temp dihapus.
6. UI polling `restores` tiap 3 dtk selama ada yang `running`.
7. **Hapus database uji**: dialog typed (ketik `targetDb`) → `DELETE …/restores/:id/database` → `dropDatabase(target)`. Ini hanya untuk nama yang tercatat di `backup_restore`, jadi tidak pernah menyentuh DB situs. Audit `backup.restore_drop`.
8. Edge:
   - Panel restart di tengah: saat boot, restore `running` → `failed: interrupted by panel restart`. DB setengah jadi tetap tercatat sehingga bisa dihapus lewat tombol yang sama.
   - Restore gagal di tengah `pg_restore`: target tetap ada dan bisa dihapus.
   - Dua admin menekan bersamaan → yang kedua 409 `busy`.
   - Situs dihapus sambil restore jalan: tidak berpengaruh (sumbernya file cadangan).

### F6 — Uji koneksi S3 (super_admin, dipakai Pengaturan dan onboarding PLAN/05)

1. Body digabung dengan setting tersimpan. Field body divalidasi dengan validator registri yang sama → 400 `invalid_value`.
2. Langkah berurutan, berhenti pada gagal pertama (langkah berikutnya `ok:false, code:"skipped"`):
   `write` PUT `<prefix>.panel-termux-check-<uuid>` (16 byte) → `read` `stat` ukuran 16 → `list` `list({prefix, maxKeys:1})` → `delete`.
3. `code` = kode S3 dari Bun (`AccessDenied`, `NoSuchBucket`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `ENOTFOUND`, `ETIMEDOUT`) atau `unknown`. Timeout keseluruhan 15 dtk.
4. Audit `backup.test`. Nilai kredensial tidak pernah masuk log, audit, atau response.
5. Edge: `delete` gagal → hasil `ok:false` dengan pesan khusus "retensi tidak akan jalan". Objek uji tertinggal di bawah prefix (16 byte, tidak tercatat, tidak pernah di-prune), dan hal ini disebut di pesan.

### F7 — Boot (urutan baru di `index.ts start()`)

1. `loadEnvOrExit` → `dataDir = resolve(env.PANEL_DATA_DIR)` (absolut; memperbaiki petunjuk pulih R4-G6a).
2. `loadOrCreateSecret` → `{ secret, created }`.
3. `openDb`. Lalu `prevVersion = app_meta.panel_version`.
4. `snapshotBeforeMigrations(db, dataDir, prevVersion)`. Bila gagal dan `PANEL_SKIP_SNAPSHOT !== "1"` → `log.error("[panel] snapshot before migrations failed: … set PANEL_SKIP_SNAPSHOT=1 to migrate without it")` → `exit(1)`.
5. `runMigrations` → tulis `app_meta.panel_version = pkg.version`.
6. `checkDataKeyOnBoot(db, secret, created)`:
   - Ada `secret_check`: sama → `ok`, beda → `mismatch`.
   - Tidak ada: coba dekripsi semua baris setting rahasia. Semua bisa (atau tidak ada baris) → tulis check → `ok`. Ada yang gagal → `mismatch` tanpa menulis check.
   - `mismatch` → `log.error` + audit `secret.mismatch`.
7. `syncSuperAdminsOnBoot` (perubahan peran → audit `user.role_sync`).
8. `pruneAudit` + tandai restore `running` → `failed`.
9. Audit `panel.start`. Server jalan. Scheduler jalan.
10. Edge:
    - Install pertama: tidak ada `__drizzle_migrations` → tidak ada snapshot. `created=true`, tidak ada setting rahasia → `ok`.
    - Upgrade dari 0.2.x: snapshot `panel.db.0.2.1.<ts>` (bila `panel_version` belum ada, nama versi `unknown`). Check ditulis bila dekripsi berhasil.
    - `secret` hilang di HP lama: secret baru, `mismatch`, semua sesi otomatis tidak valid (HMAC beda). Pemilik login lagi, lalu melihat masalah merah "Kunci data tidak cocok".

### F8 — Kunci data tidak cocok → pulih

1. Ringkasan/Kesehatan menampilkan masalah `key_mismatch` dengan tautan ke **Administrasi → Kesehatan sistem → Kunci data**.
2. Kartu Kunci data menawarkan dua jalan:
   - **A (disarankan): kembalikan file lama.** Teks perintah: `SVDIR=$PREFIX/var/service sv down panel`, salin file ke `<dataDir>/secret` (chmod 600), lalu `sv up panel`. Setelah boot, status `ok` otomatis.
   - **B: Hapus pengaturan rahasia lama** (typed: ketik `hapus`, sesi segar). Server menghapus baris setting rahasia yang tidak terbaca, menulis `secret_check` baru, dan audit `secret.reset {keys}`. Pemilik lalu mengisi ulang token Cloudflare dan kunci S3.
3. Selama `mismatch`: cadangan menolak jalan (409 `key_mismatch`), job situs yang butuh token Cloudflare gagal dengan kode yang sama (PLAN/03 memetakan), Pengaturan menampilkan key rahasia sebagai "Tidak bisa dibaca" (PLAN/05), dan overview tidak pernah 500.
4. Edge: sesi tidak segar → 403 `reauth_required` → UI tombol "Masuk ulang" (`signIn.social` dengan `callbackURL` = halaman ini) → ulangi.

### F9 — Unduh kunci data

1. super_admin (sesi segar) klik **Unduh kunci data** → dialog confirm → POST → blob → simpan.
2. Server menulis `app_meta.secret_exported_at` dan audit `secret.export`.
3. Onboarding PLAN/05 item "Simpan kunci data" dianggap selesai bila `exportedAt !== null` (centang manual tetap boleh untuk yang menyalin lewat shell).

### F10 — Sesi

1. Tiap request terautentikasi: `getSessionChecked`. Sesi lebih tua dari 30 hari → `DELETE session` → 401 → UI ke `/login` (perilaku 401 yang sudah ada).
2. super_admin **Keluarkan dari semua perangkat** (halaman Pengguna, UI PLAN/05) → `POST /api/dev/users/:id/sessions/revoke` (tier confirm). Pengguna itu langsung 401 di request berikutnya karena guard membaca DB.
3. **Keluarkan semua pengguna** (kartu Sesi di Kesehatan, tier typed `keluarkan`) → semua sesi kecuali sesi pemanggil.
4. Sign-out → `handleAuthRequest`: baca user dari sesi sebelum diteruskan, lalu bila response 2xx → audit `auth.sign_out`.
5. Callback OAuth gagal (302 ke `/login?error=<kode>`) → audit `auth.sign_in_failed` dengan aktor sistem, IP tersamar dari konteks. Volumenya sudah dibatasi rate limit auth 10/mnt/IP.

### F11 — Pulihkan ke HP baru (runbook README, manual)

Urutan di manifest `restoreOrder`: `secrets` → `panel` → `globals` → `database` → `sites` → `cloudflared`.

1. Pasang Termux + paket (`postgresql`, `cloudflared`, `nodejs` + `pm2`, `termux-services`), lalu pasang panel (installer PLAN/05), tetapi **jangan isi `.env` dulu**.
2. Unduh folder run terbaru dari bucket (`rclone`/dashboard R2) ke `~/pulih/`. Cek `sha256sum` terhadap `manifest.json`.
3. Kunci: dari item `secrets` (bila ada) atau file kunci data unduhan → `~/panel/data/secret` (600). Item `secrets` juga berisi `~/panel/.env` lama dan kredensial tunnel. Tanpa itu, isi `.env` baru dan buat ulang kredensial.
4. `panel.db` → `~/panel/data/panel.db` (hapus `-wal`/`-shm`).
5. `psql -U postgres -d postgres -f globals.sql`. Error "role postgres already exists" memang wajar.
6. Tiap DB: `pg_restore -U postgres --create --exit-on-error -d postgres <db>.dump`.
7. `mkdir -p ~/sites && tar -xzkf sites.tar.gz -C ~/sites` (`-k` tidak menimpa). Lalu deploy ulang binary tiap situs dari panel (binary tidak dicadangkan).
8. `tar -xzkf cloudflared.tar.gz -C ~/.cloudflared`. Lalu kredensial tunnel: dari item `secrets`, atau `cloudflared tunnel login` + `cloudflared tunnel token --cred-file ~/.cloudflared/<uuid>.json <tunnel>`.
9. `sv up panel`, `pm2 start ~/sites/ecosystem.config.js && pm2 save`, `sv up cloudflared`.
10. Bila HP lama dicuri: jalankan juga runbook insiden (§8.3) **sebelum** langkah 3, dan pakai kunci data **baru** (lewati langkah 3, lalu reset F8-B).

---

## 5. Spesifikasi UI per halaman

Komponen dari `src/web/components`: `PageHeader`, `Section`, `StatusBadge`, `KeyValue`, `DataTable`, `EmptyState`, `ErrorState`, `RowsSkeleton`, `HeaderSkeleton`, `RelativeTime`, `CopyButton`, `InlineCode`; `ui/dialog`, `ui/alert-dialog`, `ui/input`, `ui/label`, `ui/button`, `ui/switch`. Konfirmasi memakai `ConfirmAction` tier `confirm|typed` dari PLAN/01 (R1-G8). Fallback bila belum ada: `AlertDialog` + `Input` dengan perilaku yang sama. Semua tombol aksi di < md tingginya ≥ 44 px. Waktu memakai `RelativeTime` + `title` absolut (`formatDateTime`).

### 5.1 `/panel/backups` — Cadangan (milik PLAN ini)

**Desktop (≥ md)**, satu kolom `max-w-4xl`:

1. `PageHeader` judul "Cadangan", deskripsi `t.subtitle`, aksi kanan: tombol **Cadangkan sekarang** (`disabled` bila `!configured || running || restoring || keyMismatch`; `aria-describedby` ke alasan).
2. Banner (salah satu, prioritas dari atas): `keyMismatch` (danger, tautan "Buka Kunci data" untuk super_admin, atau "Minta Super Admin memeriksa kunci data") · belum diatur (MissingSettings yang ada) · `includeSecrets` (warning permanen `t.secretsIncluded`).
3. `Section` "Status": `KeyValue` → Jadwal · Berikutnya · Retensi (`t.retentionValue(R, K)`) · Batas per file · Isi cadangan (daftar jenis) · Terakhir (waktu + `StatusBadge`) · Uji pemulihan terakhir (waktu + nama DB, atau "Belum pernah" + tautan ke bagian bawah).
4. `Section` "Cadangan terakhir per item" (`lastGood`): `DataTable` kolom Item (`t.kinds[kind]` + nama) · Waktu · Ukuran · Verifikasi (`StatusBadge` ok "Terverifikasi" / muted "Belum dicek") · Aksi (`Unduh`, `Pulihkan ke database baru` untuk database, ikon salin perintah pulih → popover berisi `InlineCode` + `CopyButton`). Baris dengan `at` > 36 jam diberi tone warning dan teks "Lebih dari 36 jam lalu". Item yang dicoba di run terakhir tetapi tidak punya `lastGood` muncul dengan badge bad "Belum pernah berhasil".
5. `Section` "Uji pemulihan": `DataTable` restores (Waktu · Sumber → Target `InlineCode` · Status · Tabel · Aksi "Hapus database uji" bila `droppedAt === null` dan status bukan running). Saat kosong: `EmptyState` `t.restores.empty`.
6. `Section` "Riwayat cadangan": baris `<details>` yang sudah ada diperluas dengan sha256 (12 karakter pertama + `CopyButton` penuh), badge Verifikasi, item pruned redup dengan label "Dihapus oleh retensi" tanpa tombol, dan `error` sebagai pesan Indonesia (`t.itemErrors[errorCode]`) dengan detail teknis kecil di bawahnya.

**Phone (< md)**: `DataTable` menjadi list kartu (pola PLAN/01). Tiap item memuat judul + badge di baris 1, waktu · ukuran di baris 2, dan aksi berupa tombol penuh lebar bertumpuk. Tombol header pindah ke bawah judul, penuh lebar. Popover perintah diganti `Sheet` bawah.

**States**: loading → `HeaderSkeleton` + `RowsSkeleton rows=4` per section · error → `ErrorState` + "Coba lagi" (pesan dari `BACKUP_ERROR_CODES`) · kosong (belum ada run) → `EmptyState` `t.runs.empty` dengan aksi Cadangkan sekarang · parsial (status ok, list gagal) → masing-masing section punya `ErrorState` sendiri · polling 3 dtk saat `running || restoring` (sudah ada pola `BACKUP_POLL_MS`) dengan `aria-live="polite"` pada teks status.

**Dialog**

- Pulihkan (confirm): judul `t.restore.title(name)`, isi `t.restore.body(target, at, size)`, tombol **Pulihkan ke database baru**.
- Hapus database uji (typed): judul `t.restores.dropTitle(target)`, isi `t.restores.dropBody`, label input `t.restores.dropLabel(target)`, tombol merah **Hapus database**. Tombol aktif bila input persis sama (trim). Error validasi diumumkan lewat `role="alert"`.

### 5.2 Komponen keamanan `src/web/security/*` (milik PLAN ini, ditanam PLAN/05 di Kesehatan sistem)

- `DataKeyCard`: status (`StatusBadge` ok "Cocok" / bad "Tidak cocok"), "Terakhir diunduh" (`RelativeTime`/"Belum pernah"), tombol **Unduh kunci data** (confirm), dan saat mismatch: daftar key tidak terbaca (`InlineCode`), langkah A dalam `InlineCode` + `CopyButton`, tombol merah **Hapus pengaturan rahasia lama** (typed `hapus`). Menangani `reauth_required` dengan tombol **Masuk ulang**.
- `SessionsAdminCard`: "N sesi aktif dari M pengguna · umur maksimal 30 hari", tombol **Keluarkan semua pengguna** (typed `keluarkan`).
- `AccessStatusRow`: `https=false` → muted "Tidak berlaku (bukan https)"; `lastSeenAt` baru → ok "Terdeteksi · 2 mnt lalu"; null → warning "Belum terdeteksi" + tautan README langkah 4.
- `AdminTrustNote`: teks `id.security.adminTrust` (dipakai PLAN/05 di dialog ubah peran dan halaman Pengguna).

### 5.3 Copy — `src/web/i18n/id.backup.ts` (tambahan) & `id.security.ts` (baru)

```ts
// id.backup (tambahan / ubahan)
subtitle: "Cadangan harian database, panel, dan file situs ke penyimpanan R2/S3.",
errorCodes: {
  busy: "Pencadangan atau pemulihan lain sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
  not_configured: "Pencadangan belum diatur. Isi pengaturan penyimpanan R2/S3 di Administrasi → Pengaturan.",
  key_mismatch: "Kunci data panel tidak cocok, jadi kunci penyimpanan tidak bisa dibaca. Periksa Kunci data di Administrasi → Kesehatan sistem.",
  pruned: "File ini sudah dihapus oleh retensi.",
  not_database: "Hanya cadangan database yang bisa dipulihkan dari panel.",
  insufficient_space: "Ruang penyimpanan HP tidak cukup. Kosongkan ruang, lalu coba lagi.",
  confirm_mismatch: "Nama yang diketik tidak sama. Ketik nama database persis seperti tertulis.",
  already_dropped: "Database ini sudah dihapus.",
  restore_running: "Pemulihan ini masih berjalan. Tunggu sampai selesai.",
},
status: { /* + */
  retentionValue: (days: number, keep: number) => `${days} hari, minimal ${keep} cadangan berhasil terakhir`,
  maxItem: "Batas per file",
  contents: "Isi cadangan",
  restoreTest: "Uji pemulihan terakhir",
  keyMismatch: "Kunci data tidak cocok. Cadangan berhenti sampai kunci diperbaiki.",
  secretsIncluded: "Cadangan ikut menyimpan kunci rahasia panel (kunci data, .env panel, kredensial tunnel). Siapa pun yang bisa membaca bucket bisa mengambil alih panel ini. Batasi akses bucket.",
},
kinds: { database: "Database", globals: "Role Postgres", panel: "Database panel", sites: "File situs", cloudflared: "Konfigurasi tunnel", secrets: "Kunci rahasia", manifest: "Daftar isi" },
lastGood: {
  title: "Cadangan terakhir per item",
  stale: "Lebih dari 36 jam lalu",
  never: "Belum pernah berhasil",
  verified: "Terverifikasi",
  unverified: "Belum dicek",
  restoreCommand: "Perintah pemulihan",
  restoreCommandHelp: "Jalankan di Termux di HP tujuan, di folder tempat file cadangan disimpan. Perintah ini tidak menimpa data yang sudah ada.",
},
itemErrors: {
  produce_failed: "File cadangan tidak bisa dibuat.",
  verify_failed: "File cadangan rusak saat diperiksa, jadi tidak diunggah.",
  too_large: "File lebih besar dari batas per file.",
  insufficient_space: "Ruang penyimpanan HP tidak cukup untuk membuat file ini.",
  upload_failed: "Gagal mengunggah ke penyimpanan.",
  upload_mismatch: "Ukuran file di penyimpanan tidak sama dengan aslinya.",
  key_mismatch: "Kunci data tidak cocok.",
},
restore: {
  button: "Pulihkan ke database baru",
  title: (name: string) => `Pulihkan ${name} ke database baru?`,
  body: (target: string, at: string, size: string) =>
    `Panel membuat database baru ${target} dari cadangan ${at}. Database aslinya dan situsnya tidak diubah. Proses ini memakai CPU dan sekitar ${size} ruang penyimpanan HP.`,
  started: "Pemulihan dimulai.",
},
restores: {
  title: "Uji pemulihan",
  empty: "Belum ada uji pemulihan. Pulihkan satu database ke database baru untuk memastikan cadangannya bisa dipakai.",
  done: (n: number) => `Siap: ${n} tabel`,
  useHint: "Untuk memakainya, ganti nama database di DATABASE_URL situs, lalu mulai ulang aplikasinya.",
  drop: "Hapus database uji",
  dropTitle: (db: string) => `Hapus database ${db}?`,
  dropBody: "Database hasil pemulihan ini dihapus permanen. Cadangan dan database aslinya tetap aman.",
  dropLabel: (db: string) => `Ketik ${db} untuk konfirmasi`,
  dropConfirm: "Hapus database",
  dropped: "Database uji dihapus.",
  statuses: { running: "Berjalan", succeeded: "Berhasil", failed: "Gagal" },
  errors: {
    checksum_mismatch: "Isi file cadangan berbeda dari saat dibuat. Jangan pakai cadangan ini.",
    insufficient_space: "Ruang penyimpanan HP tidak cukup.",
    download_failed: "File cadangan tidak bisa diunduh dari penyimpanan.",
    restore_failed: "pg_restore gagal. Lihat detail di bawah.",
  },
},
runs: { /* + */ pruned: "Dihapus oleh retensi", checksum: "sha256" },
test: { // dipakai PLAN/05 di Pengaturan
  button: "Uji koneksi",
  ok: "Koneksi berhasil: panel bisa menulis, membaca, melihat daftar, dan menghapus file di bucket.",
  steps: { write: "Menulis file", read: "Membaca file", list: "Melihat daftar file", delete: "Menghapus file" },
  failed: (step: string) => `Gagal di langkah: ${step}.`,
  deleteFailed: "Bisa menulis, tapi tidak bisa menghapus. Retensi tidak akan jalan, dan satu file uji kecil tertinggal di bucket.",
  codes: {
    AccessDenied: "Kunci tidak punya izin untuk langkah ini.",
    NoSuchBucket: "Bucket tidak ditemukan. Periksa nama bucket.",
    InvalidAccessKeyId: "Access key ID tidak dikenal.",
    SignatureDoesNotMatch: "Secret access key salah.",
    ENOTFOUND: "Endpoint tidak ditemukan. Periksa alamat endpoint.",
    ETIMEDOUT: "Penyimpanan tidak menjawab. Periksa koneksi internet HP.",
    unknown: "Penyimpanan menolak permintaan.",
  },
},
settings: { // label/deskripsi untuk registri web PLAN/05
  keepMinRuns: ["Simpan minimal", "Jumlah cadangan berhasil terakhir yang tidak pernah dihapus retensi."],
  includeSecrets: ["Ikutkan kunci rahasia", "Ikut menyimpan kunci data, .env panel, dan kredensial tunnel. Memudahkan pindah HP, tapi siapa pun yang bisa membaca bucket bisa mengambil alih panel. cert.pem tidak pernah ikut."],
  maxItemMb: ["Batas per file (MB)", "File cadangan yang lebih besar dari ini tidak diunggah."],
  auditRetention: ["Simpan audit (hari)", "Catatan audit yang lebih tua dari ini dihapus otomatis."],
},

// id.security
dataKey: {
  title: "Kunci data",
  help: "Kunci data (data/secret) mengunci pengaturan rahasia dan sesi. Tanpa file ini, pengaturan rahasia di cadangan panel tidak bisa dibaca. Simpan salinannya di luar HP.",
  ok: "Cocok", mismatch: "Tidak cocok",
  mismatchBody: "File kunci data berbeda dari kunci yang dipakai saat pengaturan rahasia disimpan, biasanya karena file itu hilang atau diganti. Pengaturan di bawah tidak bisa dibaca:",
  restoreFile: "Cara terbaik: kembalikan file kunci data lama, lalu mulai ulang panel.",
  exportButton: "Unduh kunci data",
  exportTitle: "Unduh kunci data?",
  exportBody: "File ini membuka semua pengaturan rahasia panel. Simpan di pengelola kata sandi, jangan di HP ini dan jangan di bucket cadangan.",
  exported: "Kunci data diunduh.",
  exportedAt: "Terakhir diunduh",
  never: "Belum pernah",
  resetButton: "Hapus pengaturan rahasia lama",
  resetTitle: "Hapus pengaturan rahasia yang tidak terbaca?",
  resetBody: "Token Cloudflare dan kunci penyimpanan cadangan yang lama dihapus dan harus kamu isi ulang di Pengaturan. Tidak bisa dibatalkan. Bila kamu masih punya file kunci data lama, kembalikan file itu saja.",
  resetLabel: "Ketik hapus untuk konfirmasi",
  resetDone: "Pengaturan rahasia lama dihapus. Isi ulang di Pengaturan.",
  reauth: "Untuk aksi ini kamu perlu masuk ulang (sesi lebih dari 15 menit).",
  reauthButton: "Masuk ulang",
},
sessions: {
  title: "Sesi",
  summary: (s: number, u: number) => `${s} sesi aktif dari ${u} pengguna. Sesi berakhir paling lama 30 hari setelah masuk.`,
  revokeAll: "Keluarkan semua pengguna",
  revokeAllTitle: "Keluarkan semua pengguna?",
  revokeAllBody: "Semua orang, termasuk kamu di perangkat lain, harus masuk lagi. Sesi di perangkat ini tetap.",
  revokeAllLabel: "Ketik keluarkan untuk konfirmasi",
  revokedAll: (n: number) => `${n} sesi diakhiri.`,
  revokeUser: "Keluarkan dari semua perangkat",
  revokeUserTitle: (name: string) => `Keluarkan ${name} dari semua perangkat?`,
  revokeUserBody: "Ia harus masuk lagi. Perannya tidak berubah.",
},
access: {
  title: "Cloudflare Access",
  notHttps: "Tidak berlaku (alamat panel bukan https)",
  seen: "Terdeteksi",
  notSeen: "Belum terdeteksi. Path privat mungkin terbuka tanpa Access. Ikuti langkah 4 di README.",
},
adminTrust:
  "Admin punya kendali penuh atas HP ini. Admin bisa deploy program yang berjalan dengan akses yang sama seperti panel, sehingga bisa membaca semua file, database, dan kunci data, lalu menjadikan dirinya Super Admin. Berikan peran Admin hanya ke orang yang kamu percayai seperti pemilik HP.",
```

### 5.4 Ringkasan kebutuhan UI di halaman milik PLAN/05 (kontrak, bukan implementasi di sini)

Hal-hal berikut dikerjakan PLAN/05:

- **Pengaturan**: grup Cadangan memuat 4 key baru (§3.3), tombol "Uji koneksi" (§F6) yang memakai nilai form yang belum disimpan, dan `Switch` untuk `include_secrets` dengan dialog confirm berisi `settings.includeSecrets[1]` saat dinyalakan.
- **Audit**: aktor = `actor?.name` → `actorLabel + " (terhapus)"` bila `actorDeleted` → "Sistem" bila `system` → "Sistem atau pengguna terhapus" bila `unknown`. Tampilkan pula `ipMasked`, `userAgent`, `requestId` (detail), filter prefix aksi, aktor, dan rentang tanggal.
- **Kesehatan sistem**: menanam `DataKeyCard`, `SessionsAdminCard`, dan `AccessStatusRow`.
- **Pengguna**: dialog ubah peran ke Admin memuat `AdminTrustNote` (tier confirm), plus aksi "Keluarkan dari semua perangkat".

---

## 6. Kriteria penerimaan

### Unit / integrasi (`bun test`, DB test sementara, adapter fake, `tests/backup.s3mock.ts`)

- [ ] `server.http`: POST dengan `Origin: https://evil.example` → 403 `forbidden_origin`; dengan `Sec-Fetch-Site: same-site` → 403; tanpa `X-Requested-With` → 403; GET tanpa header → lolos; `/api/auth/sign-out` tidak diperiksa guard. **61 POST asing lalu 1 POST sah dari sesi yang sama → 200** (kuota tidak terpakai).
- [ ] `server.http`: `Host: other.example.com` ke `/api/health` → 421 `wrong_host`; `127.0.0.1:<port>` → 200.
- [ ] `server.http`: `POST /api/me/sessions/revoke-others` ke-61 dalam 1 menit → 429.
- [ ] `server.origin`: `GET /__spa` → bukan bundle mentah; response punya `content-security-policy` dan `x-frame-options: DENY`.
- [ ] `backup.retention` (murni): run `partial` tidak pernah memicu prune; dengan R=14, K=3, data 30 hari (1 run/hari, DB `b` gagal sejak hari ke-20): item `b` hari ke-19 tidak dihapus, 3 run sukses terbaru utuh, manifest hanya dihapus bila semua itemnya terhapus; kunci yang tidak ada di `backup_run` tidak pernah masuk daftar.
- [ ] `backup.api`: run berisi item `globals`, tiap DB, `panel`, `sites`, `cloudflared`, `manifest`; `secrets` hanya bila setting `on`; manifest valid JSON dengan `sha256` sama dengan isi objek mock; arsip `sites` tidak memuat `*/app` dan `*/app.prev` (`tar -tzf`); arsip `cloudflared` tidak memuat `cert.pem`.
- [ ] `backup.api`: item > `max_item_mb` → `too_large`, tidak ada PUT ke mock; `statfs` palsu kecil → `insufficient_space`; mock mengembalikan ukuran beda di `stat` → `upload_mismatch` dan objek dihapus.
- [ ] `backup.api`: unduh item `secrets` sebagai admin → 403, sebagai super_admin → 302; item pruned → 410.
- [ ] `backup.restore`: restore jalan → `succeeded` + `tableCount`; sha256 berubah di mock → `checksum_mismatch`; restore saat run berjalan → 409 `busy`; `DELETE …/database` dengan confirm salah → 400, benar → `dropDatabase` dipanggil dengan nama target (bukan nama sumber); boot dengan restore `running` → `failed`.
- [ ] `backup.probe`: mock tolak DELETE → `steps[3].ok=false`, `ok=false`; kredensial tidak muncul di response, log, atau audit (scan string).
- [ ] `data-key`: secret dihapus + boot ulang → `mismatch`, setting rahasia **masih ada** di DB, `GET /api/panel/overview` 200 dengan problem `key_mismatch`, `POST /backups/run` 409 `key_mismatch`, scheduler menulis maksimal 1 warn per hari (clock palsu 3 hari → 3 baris). File lama dikembalikan + boot → `ok`. Reset tanpa sesi segar → 403 `reauth_required`; dengan confirm salah → 400; benar → baris rahasia terhapus, `secret_check` baru, audit `secret.reset`.
- [ ] `data-key` legacy: DB 0.2.x tanpa `secret_check` + secret benar → check ditulis; secret salah → `mismatch` tanpa check.
- [ ] `db.snapshot`: DB dengan migrasi tertunda → file `snapshots/panel.db.<ver>.<ts>` ada (mode 600) dan lulus `quick_check`; snapshot ke-4 menghapus yang tertua; DB baru → tidak ada snapshot; folder snapshot read-only → `start` exit 1 kecuali `PANEL_SKIP_SNAPSHOT=1`.
- [ ] `db.migrate`: migrasi baru jalan dari 0005 dengan data; baris audit lama ber-aktor ada → `actor_kind=user` + label; `backup.run` tanpa aktor → `system`; lainnya `unknown`.
- [ ] `auth`: hapus pengguna lalu `listAudit` → `actorKind=user`, `actorDeleted=true`, `actorLabel` = nama lama; sign-out → `auth.sign_out`; callback dengan `error` → `auth.sign_in_failed`; akun baru → `auth.account_created`; email dicabut dari `SUPER_ADMIN_EMAILS` + boot → `user.role_sync`.
- [ ] `audit`: baris dari request API punya `request_id` sama dengan header `x-request-id`, `ip_masked` berakhiran `.x`; baris scheduler → null. `action=user.` → hanya aksi berawalan `user.`; `action=user_` tidak cocok `user.` (escape). `pruneAudit` 400 hari → baris > 365 hari hilang, audit `audit.prune`.
- [ ] `me.sessions`: sesi dengan `createdAt` 31 hari lalu → 401 dan baris sesi terhapus; `revoke-all` menyisakan tepat sesi pemanggil; `users/:id/sessions/revoke` untuk diri sendiri → 409.
- [ ] `panel.api`: `recentActivity` tidak memuat `auth.*`/`session.*`.
- [ ] `restoreHint`: tidak memuat `--clean`, memakai path absolut `dataDir`, dan memuat `SVDIR=` untuk `sv`.

### UI-QA di browser (lebar 390 px dan 1280 px, tema terang dan gelap)

- [ ] `/panel/backups` state belum diatur, kosong, berjalan, sukses, partial (satu DB gagal), key mismatch, include_secrets on: banner, badge, dan teks sesuai §5.3; tidak ada scroll horizontal di 390 px; target sentuh ≥ 44 px.
- [ ] Dialog pulihkan → polling → baris "Siap: N tabel" → Hapus database uji: tombol nonaktif sampai nama persis diketik; pembaca layar mengumumkan error.
- [ ] Kartu kunci data (ditanam di Kesehatan): mismatch menampilkan daftar key, perintah bisa disalin, reset butuh ketik `hapus`, `reauth_required` memunculkan "Masuk ulang".
- [ ] Kontras badge warning/danger lolos AA di kedua tema (token dari PLAN/01).

### Operasional (setelah rilis, di HP)

- [ ] `curl -sI https://panel.<domain>/__spa` → ada CSP. `curl -s -X POST -H 'Origin: https://evil.example' https://panel.<domain>/api/panel/backups/run` → 403 (atau 302/401 dari Access).
- [ ] Satu run nyata ke R2: semua item `verified`; `stat` cocok; manifest bisa dibaca; satu "Pulihkan ke database baru" lulus lalu dihapus.
- [ ] Runbook F11 dicoba sekali ke HP/emulator kedua (atau minimal langkah 5–7 ke Postgres lokal kedua) dan hasilnya dicatat di CHANGELOG.

---

## 7. Rencana kerja

Prasyarat (orkestrator, gelombang 0): merge `fix/csrf-origin` → `main` (pemilik), lalu merge `main` → `feature/production-polish`. Konflik yang diharapkan hanya `api.routes.ts` dan harness test.

Aturan migrasi lintas PLAN: **satu worker per gelombang memegang `drizzle/` dan `src/server/db/schema/index.ts`**. Di gelombang 1, worker itu `wkr-safety-audit`. PLAN lain yang butuh tabel baru (mis. histori metrik PLAN/02) menunggu gelombang berikutnya atau menitipkan perubahan skemanya ke migrasi yang sama lewat orkestrator.

| Gelombang | Worker                                          | File (eksklusif)                                                                                                                                                                                                                                                                                                                                                                             | Ukuran                |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1         | `wkr-safety-http`                               | `src/server/http/api.handler.ts`, `src/server/http/request.context.ts` (baru), `src/server/routes/origin.guard.ts`, `src/server/index.ts`, `src/server/routes/api.routes.ts` (hapus `.onRequest`, pakai `handleAuthRequest`, mount `security.routes`), `tests/server.http.test.ts`, `tests/server.origin.test.ts`                                                                            | M (~200 baris + test) |
| 1         | `wkr-safety-keys`                               | `src/server/secret.ts`, `src/server/data-key.service.ts` (baru), `src/server/settings.service.ts` (4 key + `KeyMismatchError`), `src/server/db/snapshot.ts` (baru), `src/server/routes/security.routes.ts` (baru), `src/shared/security.types.ts` (baru), `tests/secret.test.ts`, `tests/data-key.test.ts` (baru), `tests/db.snapshot.test.ts` (baru)                                        | M (~300)              |
| 1         | `wkr-safety-audit`                              | `src/server/audit.service.ts`, `src/server/db/schema/{audit-log,backup,backup-restore,index}.schema.ts`, `drizzle/*` (migrasi + meta + `migrations.js`), `src/server/auth/{access.service,auth.service,auth.audit,role.guard,sessions.service}.ts`, `src/server/routes/me.routes.ts`, `src/shared/dev.types.ts`, `tests/{auth,me.sessions,db.migrate}.test.ts`, `tests/audit.test.ts` (baru) | L (~400)              |
| 2         | `wkr-backup-engine`                             | `src/server/backup/*` (pecah sesuai §3.5), `src/shared/backup.types.ts`, `src/server/system/{postgres.termux,archive.termux (baru),system.types,system.fake,system.select}.ts`, `tests/backup.*.test.ts`, `tests/backup.s3mock.ts` (stat/delete/fail injection)                                                                                                                              | L (~600)              |
| 2         | `wkr-backup-ui`                                 | `src/web/backup/*`, `src/web/security/*` (baru), `src/web/i18n/id.backup.ts`, `src/web/i18n/id.security.ts` (baru), `src/web/i18n/id.ts` (1 baris merge), `tests/web.backup.test.ts`, `tests/web.security.test.ts` (baru)                                                                                                                                                                    | M (~450)              |
| 3         | `wkr-release-ci`                                | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml` (ekosistem `github-actions` saja)                                                                                                                                                                                                                                                                      | S (~120)              |
| akhir     | `wkr-docs-final` (satu worker untuk semua PLAN) | `README.md` (bagian Backup dan restore → "Cadangan dan pemulihan" + runbook F11 + insiden §8.3; Keamanan: model kepercayaan, CSRF, umur sesi, Access; tabel pengaturan 4 key baru), `CHANGELOG.md`, `.env.example` (`PANEL_SKIP_SNAPSHOT`)                                                                                                                                                   | M                     |

Ketergantungan di dalam PLAN:

- Gelombang 1 paralel penuh, karena tanda tangan modul sudah dikunci di §3.5.
  - `wkr-safety-http` memanggil `checkDataKeyOnBoot`, `snapshotBeforeMigrations`, `pruneAudit`, dan `handleAuthRequest` sesuai tanda tangan itu.
  - `wkr-safety-keys` memanggil `revokeAllSessions`/`revokeUserSessions`/`assertFresh` milik `wkr-safety-audit`.
  - Typecheck gabungan dijalankan orkestrator setelah gelombang.
- Gelombang 2 butuh skema dan `KeyMismatchError` dari gelombang 1. `wkr-backup-ui` hanya memakai tipe dari §3.1 dan tidak mengedit `backup.types.ts`.

**Ketergantungan ke PLAN lain**

| PLAN             | Yang dibutuhkan dari mereka                                                                                                                                                                                                                                                                                                                                       | Yang mereka dapat dari sini                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 01 shell         | `ConfirmAction` tier `confirm/typed`; list-kartu `DataTable` di < md                                                                                                                                                                                                                                                                                              | Bukti: cache aset sudah dipenuhi Bun → R1-G14 opsi B tidak perlu       |
| 02 monitoring    | `computeProblems` memanggil `backupProblems`/`securityProblems`; `ProblemKind` + `"security"`; notifier menerima event §3.7; `recentActivity` memakai `excludePrefixes`; jangan menambah timer housekeeping untuk audit                                                                                                                                           | Fungsi problem + event                                                 |
| 03 situs         | Teruskan `actorId` ke audit `dns.*`; petakan `KeyMismatchError` → 409 `key_mismatch` di job; hapus situs ber-DB menampilkan `lastGood` DB itu (atau peringatan "belum pernah dicadangkan") sebelum konfirmasi typed; tambah aksi audit deploy di gelombang ≥ 2                                                                                                    | `BackupStatus.lastGood`, aksi audit                                    |
| 05 admin/landing | UI §5.4; installer memverifikasi `SHA256SUMS` sebelum `chmod +x` dan mencetak petunjuk rollback (`panel.prev` + snapshot terbaru); nama aset rilis `panel-android-arm64` + `SHA256SUMS`; LICENSE; onboarding memakai `SecurityStatus` (kunci diunduh, Access terdeteksi) dan `BackupStatus.lastRestoreTest`; refactor registri setting (L2) memasukkan 4 key baru | Skema audit (`actor_label` dkk.), API audit/sesi/keamanan/uji S3, copy |

---

## 8. Risiko, asumsi, pertanyaan terbuka

### 8.1 Risiko

1. **`include_secrets` default `off` menyimpang dari default brief.** Pemindahan ke HP baru menjadi butuh langkah tambahan (kunci data unduhan + isi ulang `.env` + kredensial tunnel). Mitigasi: unduh kunci data (F9), runbook F11, item onboarding. Ini perlu didebat.
2. **Multipart upload Bun untuk dump besar** belum pernah diuji terhadap R2 (README Keterbatasan). `s3mock` mungkin tidak mendukung multipart. Mitigasi: uji operasional dengan dump ≥ 100 MB sebelum rilis, dan `max_item_mb` membatasi kasus ekstrem.
3. **SQLite milik situs di `data/`** disalin `tar` apa adanya. Bila aplikasi sedang menulis, salinannya bisa tidak konsisten (`tar` exit 1 "file changed" → item ok dengan warning). Ini dicatat jujur di README. Untuk data penting, pakai Postgres.
4. **Mode `mismatch` membuat secret baru** (K8). Bila pemilik tidak sadar dan me-reset, setting rahasia lama hilang. Mitigasi: reset butuh typed + sesi segar, dan teks menyarankan mengembalikan file lebih dulu.
5. **Snapshot memblokir boot** saat disk penuh (K9). Panel mati sampai ada ruang atau env `PANEL_SKIP_SNAPSHOT=1`. Lebih baik daripada migrasi tanpa jalan balik. Pesan log menyebut env-nya.
6. **Retensi tidak menghapus objek yatim** (K3). Penyimpanan bisa tumbuh setelah `panel.db` dipulihkan dari cadangan lama. README menyarankan lifecycle rule bucket sebagai pengaman kedua.
7. **Guard CSRF memutus klien non-SPA yang memutasi.** Saat ini tidak ada (diverifikasi: installer hanya GET `/api/health`, dan semua `fetch` di `src/web` mengirim `AJAX_HEADERS`: `api.client.ts:131`, `deploy.api.ts:18`).
8. **Konteks `AsyncLocalStorage`** ikut ke job situs yang berjalan lama, sehingga entri audit job membawa request id pemicunya. Ini disengaja. Bila suatu saat ada antrean job lintas request, konteksnya harus diputus di runner.
9. Nomor migrasi bentrok antar PLAN. Mitigasinya aturan satu pemilik `drizzle/` per gelombang (§7).

### 8.2 Asumsi

- `tar` GNU tersedia di Termux (bagian bootstrap) dan `pg_dumpall` ikut paket `postgresql`. Diverifikasi di HP saat gelombang 2 dengan `command -v`. Bila tidak ada, item terkait gagal `produce_failed` dan item lain tetap jalan.
- Role `postgres` trust di unix socket (sudah diverifikasi R&D, `postgres.termux.ts:6-7`), jadi `pg_dumpall` dan `createdb` jalan tanpa password.
- `Bun.write(path, s3file)` melakukan streaming unduhan. Diverifikasi di gelombang 2 (Rule 20). Fallback: `for await` dari `s3file.stream()` ke `Bun.file(path).writer()`.
- `actions/attest-build-provenance` dan `oven-sh/setup-bun` masih versi mayor yang sama saat implementasi. SHA dipin setelah dicek di halaman rilisnya (Rule 20).
- LICENSE = MIT (asumsi brief, milik PLAN/05). Rilis publik menunggu ini.

### 8.3 Runbook insiden HP dicuri (README, ditulis `wkr-docs-final`)

1. Cloudflare Zero Trust → hapus tunnel/konektor HP lama, lalu cabut `cert.pem` (API tokens → Origin CA / hapus sertifikat akun).
2. Cloudflare → putar token API (`cloudflare.api_token`).
3. R2 → buat token baru, cabut token lama, lalu **cek objek cadangan masih ada** (token lama bisa menghapus).
4. Google Cloud → tambah client secret baru, hapus yang lama.
5. Pasang di HP baru dengan **kunci data baru** (jangan pakai item `secrets`/kunci lama). Reset F8-B, isi ulang token, lalu jalankan `revoke-all` (sesi lama sudah mati karena HMAC beda).
6. Putar `.env` situs yang berisi rahasia pihak ketiga.

### 8.4 Ringkasan threat model

| Aktor                                             | Bisa apa hari ini                                                                  | Mitigasi di PLAN ini                                                                                | Sisa risiko                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Internet anonim                                   | Landing, `/login`, `/api/health`, `/api/auth/*`                                    | Header wave A, `/__spa` ditutup (K16), host check (K2)                                              | Bug di Better Auth                                                                |
| Pemilik akun Google mana pun (`user`)             | `/profile`, `/api/me*`                                                             | Peran ditegakkan di server (sudah), rate limit `/api/me` (G22), audit akun baru/login gagal         | Spam akun (keputusan pemilik 4)                                                   |
| Situs yang di-host / XSS di situs itu (same-site) | POST tanpa body ke panel (R4-G1)                                                   | Guard CSRF sebelum rate limit (K1)                                                                  | Tidak ada untuk mutasi; GET tetap tidak memutasi                                  |
| Admin                                             | Setara pemilik HP (deploy binary)                                                  | Teks jujur (K15), audit lengkap dengan IP/UA                                                        | Disengaja (keputusan pemilik 1)                                                   |
| Cookie laptop dicuri                              | Sesi 7 hari sliding tanpa batas                                                    | Umur absolut 30 hari, cabut per pengguna/semua, sesi segar untuk kunci data (K14)                   | Jendela ≤ 30 hari bila tidak ada yang mencabut                                    |
| HP dicuri / hilang                                | Semua file: secret, `panel.db`, `.env`, `cert.pem`, kunci S3 (bisa hapus cadangan) | Runbook §8.3, cadangan off-device lengkap, kunci data baru di HP baru                               | Kunci S3 di HP tetap bisa menghapus. P2: token tanpa izin delete + lifecycle rule |
| Bucket bocor / kunci S3 bocor                     | Membaca PII, token sesi, dump; menghapus cadangan                                  | Secret tidak ikut secara default (K4), HMAC cookie butuh `secret`                                   | Data aplikasi terbaca sampai enkripsi `age` (P2)                                  |
| Dependency jahat / rilis disusupi                 | Kode di binary                                                                     | `bun audit --audit-level=high` di CI, lockfile beku, action dipin SHA, checksum + attestation (K19) | Akun GitHub pemilik disusupi                                                      |
| Proses lain di HP (loopback)                      | Memalsukan `cf-connecting-ip`, header Access                                       | Header itu hanya untuk IP sesi/rate limit/tampilan (K18)                                            | Tidak menyentuh izin                                                              |
| Cloudflare Access mati/salah konfigurasi          | Path privat sampai ke login panel                                                  | Peran tetap di server; deteksi + masalah `access_not_seen` (K18), host check (K2)                   | Access opsional (keputusan pemilik 5)                                             |

### 8.5 Pertanyaan terbuka (keputusan nyata untuk pemilik/debat)

1. **`backup.include_secrets` default `off`** (K4), atau ikuti default brief "semua ikut" dengan peringatan? Rekomendasi: `off` sampai enkripsi `age` (P2).
2. **Kredensial R2 tanpa izin delete** + retensi lewat lifecycle rule bucket (melindungi cadangan dari HP dicuri) sebagai mode opsional di P2? Butuh `backup.retention_mode = panel|bucket`.
3. **Snapshot gagal = boot diblokir** (K9). Setuju, atau migrasi tetap jalan dengan masalah merah?
4. Umur sesi absolut **30 hari** dan jendela sesi segar **15 menit**. Angka ini perlu dikonfirmasi.
