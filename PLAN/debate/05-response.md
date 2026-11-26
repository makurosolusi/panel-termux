# Respons penulis PLAN/05 atas kritik `05-critique.md`

> wkr-plan-admin-01 · 2026-11-26. Juga mempertimbangkan `00-integration-critique.md` (X1–X11, K16–K40) untuk butir yang
> menyentuh PLAN/05. Keputusan pemilik yang mengikat dipakai: `include_secrets` default off, LICENSE MIT (makurosolusi),
> rilis publik pertama v0.3.0, tamu di URL tak dikenal → 404 publik. Default sementara (masih terbuka untuk pemilik):
> (a) `/profile` dikeluarkan dari path Access; (b) "cadangan belum diatur" dan "Access tidak terdeteksi" hanya informasi
> dan tidak menurunkan vonis "Sehat".

Ringkas: **22 temuan → 19 TERIMA, 3 TERIMA SEBAGIAN, 0 TOLAK.** Semua perubahan sudah masuk ke
`PLAN/05-admin-onboarding-landing.md` (lihat "Riwayat revisi" di akhir file itu).

| #   | Verdict         | Inti perubahan                                                                                                                           |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | TERIMA          | `profile` keluar dari resep Access; README langkah 4 + CHANGELOG ikut; UI-QA akun non-pemilik di instance ber-Access                     |
| C2  | TERIMA SEBAGIAN | Satu endpoint uji S3, implementasi milik PLAN/04, menerima override draft, langkah termasuk `list`; nama & bentuk respons usulan PLAN/05 |
| C3  | TERIMA          | Matriks kepemilikan direvisi: W0 kontrak, `roles.ts`/router/404 publik ke PLAN/01, revoke ke PLAN/04, `describeSetting` tidak diubah     |
| C4  | TERIMA          | Kunci `alerts.*` + `monitor.sample_interval_sec`, endpoint PLAN/02 apa adanya, kontrol `choice`/`switch`, "Cari chat"                    |
| C5  | TERIMA          | Onboarding & Kesehatan membaca `SecurityStatus` PLAN/04; centang manual kunci data mengikat sidik `secret_check`                         |
| C6  | TERIMA          | Vonis dari `Problem[]` PLAN/02 + cek khusus panel; hanya 500 yang dihitung; cadangan/Access belum diatur = informasi                     |
| C7  | TERIMA          | `heartbeat.ts`, `Heartbeat`, cek `schema` dihapus; pakai `sampledAt` PLAN/02                                                             |
| C8  | TERIMA SEBAGIAN | Catatan Access di dialog promosi & item `admins`; revoke hanya 409 untuk diri sendiri; kalimat "bisa masuk lagi" dipertahankan           |
| C9  | TERIMA          | `setSetting` tetap (pembungkus), rahasia selalu "berubah", kunci tak dikenal 400, registri dipecah, test lama lulus tanpa diubah         |
| C10 | TERIMA          | Bentuk audit datar PLAN/04; `meta.targetEmail` ditulis `users.service.ts` (milik PLAN/05); filter satu awalan per opsi                   |
| C11 | TERIMA          | Uji otomatis hanya CF/S3 dan hanya bila kunci koneksi berubah; Telegram manual; uji S3 bisa sebelum simpan                               |
| C12 | TERIMA          | `install-phone.sh` exit 3 untuk "isi `.env`"; versi ditanam di `install.sh`; pesan checksum jujur; catatan buka ulang Termux             |
| C13 | TERIMA          | Prasyarat 5 langkah nyata, tanpa "1 perintah"; FAQ telemetri akurat; MIT & v0.3.0 bukan asumsi lagi                                      |
| C14 | TERIMA          | Istilah "mode fake"; fake + https = fail; env seed dan data dir di `$TMPDIR`                                                             |
| C15 | TERIMA          | 4 screenshot terang saja; `og.png` statis; `sitemap.xml` dihapus (path itu kini 404 sungguhan)                                           |
| C16 | TERIMA          | `robots.txt` hanya `Disallow: /api/`; privat cukup `X-Robots-Tag`; ETag dibuang di HTML yang ditulis ulang; 404 menang atas 304          |
| C17 | TERIMA          | `release.yml` satu pemilik (PLAN/05); naik versi 0.3.0 dimiliki worker dokumen; test shell di CI; `workflow_dispatch` dry-run            |
| C18 | TERIMA          | "Terakhir aktif" beresolusi hari; ketergantungan pada retensi audit dicatat                                                              |
| C19 | TERIMA          | Level item eksplisit; `apps_json` [DEP eksperimen pm2]; `partial` → `needsFirstRun`                                                      |
| C20 | TERIMA          | `error_description` tidak pernah dirender + test                                                                                         |
| C21 | TERIMA          | `LogViewer` milik PLAN/01; `/dev/logs` memakai `useApiQuery` biasa                                                                       |
| C22 | TERIMA SEBAGIAN | QA Access & instal bersih masuk §6.4; dijalankan setelah merge di HP uji, bukan prasyarat merge                                          |

---

## Rincian per temuan

### C1 — `/profile` di belakang Access · **TERIMA**

**Alasan.** Benar: README langkah 4 melindungi path `profile`, dan `homeFor("user") = "/profile"` dicapai lewat full load
(`needsFullLoad`), sehingga Access menolak akun non-pemilik sebelum SPA sempat menampilkan kartu K20. Data halaman itu
datang dari `/api/me*`, yang memang publik. Melindungi `/profile` tidak menambah keamanan. Ini juga default (a) dari koordinator.

**Perubahan.**

- §1.2: baris baru "README resep Access (path `profile` dihapus)".
- §2 K22 baru: daftar path Access menjadi `panel`, `dev`, `api/panel`, `api/dev`. Alasannya ditulis di sana.
- §3.8 baru: resep README yang direvisi (tabel path dan kalimat "yang sengaja tidak dilindungi" ditambah `/profile`).
- Item onboarding `access` dan teks `checks.access.*` merujuk resep baru.
- §6.4: QA "akun Google non-pemilik di instance ber-Access → login → melihat kartu belum punya akses".
- CHANGELOG (worker dokumen): "Resep Access tidak lagi melindungi `/profile`".
- Ditandai **[TERBUKA pemilik (a)]**.

### C2 — Uji S3 dobel, tanpa `list` · **TERIMA SEBAGIAN**

**Alasan.** Satu endpoint, implementasi di PLAN/04 (pemetaan error S3 dan `describe()` ada di mesin cadangan): diterima.
Override draft: diterima, karena C11-3 benar (kredensial salah yang sudah tersimpan menimpa yang bekerja). Langkah `list`:
diterima, karena `prune()` hari ini memanggil `client.list` (`backup.service.ts:38`). Kritik integrasi X4 mengatakan retensi
PLAN/04 K3 tidak pernah me-list. Bila itu final, langkah `list` dibuang dan kode `list_denied` ikut dihapus; kontraknya
tetap sama. Yang **tidak** saya ambil: bentuk respons `steps[]` saja tanpa `code` tunggal. UI butuh satu kalimat, jadi
saya mengusulkan `code` + `failedStep` + `steps[]`.

**Perubahan.** `backup.verify.ts` dan uji S3 dihapus dari kepemilikan PLAN/05. §3.1 hanya menyebut kontrak usulan
(lihat "Kontrak usulan" di bawah); §5.5 menambah `list_denied`; §6.1 test uji S3 pindah ke PLAN/04.

### C3 — Bentrok kepemilikan file · **TERIMA**

**Perubahan (§7 ditulis ulang).**

- **W0 (satu worker kontrak lintas PLAN, `wkr-contract-00` milik koordinator):** `src/shared/dev.types.ts`,
  `src/shared/security.types.ts`, union `AuditAction` di shared, dan `SETTING_KEYS`. PLAN/05 menyerahkan tipe §3.1-nya ke spec worker ini.
- **`settings.service.ts` + `settings.registry.ts` + rute settings di `dev.routes.ts`:** satu worker `wkr-settings-01` di W1
  (usulan X3), mengerjakan struktur PLAN/05 **dan** semua kunci PLAN/02/04 **dan** `KeyMismatchError`, plus mengganti
  `MUTATIONS` di `tests/csrf.origin.test.ts` ke `PATCH /api/dev/settings`.
- **`roles.ts` (`isKnownSpaPath` di samping `isProtectedPath`), `router.tsx`, `session.redirect.ts`, `public-not-found.page.tsx`:** PLAN/01 1c.
  PLAN/05 hanya memberi copy dan aturan K16. `wkr-adm-routing-01` dihapus.
- **Penyaji HTTP:** `seo.ts` (fungsi murni, PLAN/05) dirangkai di `src/server/http/spa.serve.ts` oleh `wkr-http-01` (X5/X6).
  PLAN/05 tidak menyentuh `index.ts`.
- **Revoke sesi pengguna lain:** `revokeUserSessions` di `sessions.service.ts` (PLAN/04); route dipasang `wkr-adm-server-01`.
- **`dev.routes.ts`:** hanya rute settings (`wkr-settings-01`). Rute health/setup/users/revoke PLAN/05 dipindah ke file baru
  `src/server/routes/dev.admin.routes.ts`, sehingga kedua worker W1 bisa paralel tanpa berbagi file.
- **`describeSetting(db, key)` tidak diubah.** `readable` dihitung di `listSettings(deps)` dari `dataKeyState()` PLAN/04, jadi `site.service.ts:270` tidak tersentuh.
- **`release.yml`, `install-phone.sh`, `package-release.sh`, `install-release.sh`, `LICENSE`:** PLAN/05 `wkr-adm-dist-01` (lihat C12/C17).

### C4 — Kontrak Telegram · **TERIMA**

**Perubahan.** §3.5: grup "Notifikasi & pemantauan" (`#notifikasi`) berisi `alerts.enabled`, `alerts.telegram_bot_token`,
`alerts.telegram_chat_id`, `alerts.min_severity`, `monitor.sample_interval_sec`. `SettingControl` ditambah
`{ kind: "choice"; options }` dan `{ kind: "switch"; on: string; off: string; confirmOn?: CopyKey }`. Grup Cadangan memakai
`switch` + `confirmOn` untuk `backup.include_secrets` (default off). Tombol "Cari chat" ditaruh di field chat id
(`POST /api/dev/alerts/telegram/chats` → pilih dari daftar mengisi draft). "Kirim pesan uji" = `POST /api/dev/alerts/test`;
web memetakan status HTTP + `error` (`409 alerts_not_configured`, `429 too_soon`, `502 <AlertErrorCode>`) ke teks. Format
`{ok,code,detail}` usulan lama dihapus. Flow PLAN/02 §4.7 langkah 1 harus memakai `PATCH`, bukan `PUT` (X3-3).

### C5 — Duplikasi `SecurityStatus` · **TERIMA**

**Perubahan.** K7 diganti: Access = `SecurityStatus.access.lastSeenAt !== null` (dicatat PLAN/04 untuk semua request
`/api/panel|dev`) **atau** centang manual. `secret_saved` = `dataKey.exportedAt !== null` **atau** centang manual yang
menyimpan `app_meta.onboarding.secret_saved.check = <secret_check saat dicentang>` dan dianggap selesai hanya bila masih sama
dengan `app_meta.secret_check` sekarang (jadi otomatis basi setelah reset kunci). `settings_readable` diambil dari
`dataKey.state`. Kontradiksi K26 integrasi selesai: unduh kit **otomatis** mencentang (via `exportedAt`).

### C6 — Alarm palsu · **TERIMA**

**Perubahan (§3.4 ditulis ulang).** Vonis = gabungan dua sumber:

1. `Problem[]` dari snapshot sampler PLAN/02 (sumber yang sama dengan Ringkasan, X10), dengan kode **informasi**
   `backup_not_configured` dan `access_not_seen` dikeluarkan dari perhitungan vonis (default (b)); keduanya tampil sebagai
   baris info dan item onboarding. `backup_stale` mengikuti aturan PLAN/02.
2. Cek khusus panel: `errors` = jumlah respons **500** (handler tak tertangani) dalam 5 mnt, warn ≥ 3, fail ≥ 10;
   `sampler` = `sampledAt` lebih tua dari `max(3 × monitor.sample_interval_sec, 10 mnt)` → warn (bukan fail; Doze bisa menunda timer);
   `fake_on_https` (C14) → fail.
   Butuh satu field baru `unhandled5m` di `requestStats()` (`request.log.ts`, pemilik PLAN/02 di gelombangnya).

### C7 — Heartbeat & cek skema tak berguna · **TERIMA**

**Alasan.** Benar: `setInterval` di event loop yang sama tidak bisa diam sementara handler HTTP menjawab, dan
`runMigrations` gagal = proses mati. Cek yang tidak bisa gagal adalah kode mati.
**Perubahan.** K21, `heartbeat.ts`, `Heartbeat`, `heartbeats`, `latestSchemaVersion`, dan cek `schema` dihapus. Versi
skema tetap tampil di Detail. Deteksi downgrade tidak diambil (YAGNI); dicatat di §8.

### C8 — Promosi butuh Access, aturan revoke · **TERIMA SEBAGIAN**

- (1) Diterima: dialog promosi dan item `admins` menambah "Bila panel memakai Cloudflare Access, tambahkan juga {email} ke policy Access" + tautan resep.
- (2) Diterima dengan dasar keamanan: revoke sesi hanya 409 untuk diri sendiri. Super admin harus bisa mengeluarkan sesi curian milik
  super admin env lain. Revoke tidak merusak (orangnya cukup login lagi), berbeda dengan ubah peran/hapus yang tetap
  memakai `assertMutable`. Ini **berbeda dengan usulan integrasi X11** (yang ikut aturan lama PLAN/05); saya sendiri yang menariknya kembali.
- (3) Sudah ada di PLAN (`deleteBody` tetap memuat "Bila login lagi, ia masuk sebagai Pengguna baru"), jadi hanya dipertegas. Karena itu verdictnya sebagian.

### C9 — Migrasi pemanggil API pengaturan · **TERIMA**

**Perubahan.** `setSetting(deps, key, value, actor)` dipertahankan sebagai pembungkus satu kunci atas `setSettings(deps, values, actor)`.
Kunci rahasia yang dikirim selalu dianggap berubah (didokumentasikan). Kunci tak dikenal dalam batch → 400 `invalid_body` +
`fields[key] = "unknown"`. Klaim K3 diperlunak: atomik per request, **bukan** penegakan kelengkapan grup. Registri dipindah ke
`src/server/settings.registry.ts`, sedangkan `settings.service.ts` hanya baca/tulis (Rule 8). §6.1: "semua test yang ada lulus tanpa
diubah, kecuali kasus PUT di `dev.api.test.ts` dan `MUTATIONS` di `csrf.origin.test.ts`". Tab lama yang masih memanggil `PUT`
mendapat 404 lalu pesan generik `not_found` ("muat ulang halaman"); muat ulang versi baru milik PLAN/01.

### C10 — Bentuk entri audit · **TERIMA**

**Perubahan.** §3.1 memakai bentuk datar PLAN/04 apa adanya (`actor`, `actorKind`, `actorLabel`, `actorEmail`, `actorDeleted`, `ipMasked`,
`userAgent`, `requestId`). `describeAudit`: `system` → "Sistem", `user && actorDeleted` → "{actorLabel} (terhapus)", `unknown` → "Tidak diketahui".
Label target tanpa bantuan PLAN/04: `users.service.ts` (milik PLAN/05) menambahkan `meta.targetEmail` saat `user.role_change` dan `user.delete`
dicatat, sehingga label tetap terbaca setelah pengguna dihapus. Baris lama tanpa `targetEmail` menampilkan "pengguna lain". Filter: satu awalan
per opsi ("Masuk" `auth.`, "Sesi" `session.`, …); `action` berulang tidak lagi dibutuhkan.

### C11 — Uji otomatis terlalu agresif · **TERIMA**

**Perubahan.** K4 ditulis ulang. Uji otomatis setelah simpan hanya untuk Cloudflare (bila `cloudflare.api_token`/`account_id` berubah) dan
S3 (bila endpoint/bucket/region/kunci/prefix berubah). Telegram selalu manual. Tombol "Uji koneksi" S3 bisa dipakai **sebelum** menyimpan:
draft dikirim sebagai override, dan rahasia yang tidak diubah tidak dikirim. Uji token Cloudflare tetap memakai nilai tersimpan: mengubah
`dns.provider.ts` untuk menerima token draft menyentuh file PLAN/03, sedangkan token yang salah tidak merusak apa pun di malam hari (DNS
dilewati dengan catatan). Keterbatasan ini dicatat di §8.

### C12 — Distribusi · **TERIMA**

**Perubahan.** (1) `install-phone.sh` keluar dengan **exit 3** saat `.env` belum lengkap (header skrip mendokumentasikan 0 = sehat,
1 = gagal, 3 = isi `.env`); `install.sh` memeriksa kode itu. Karena `install-phone.sh` tidak punya pemilik (K37 integrasi), PLAN/05
mengambilnya dalam satu worker (`wkr-adm-dist-01`), yang sekaligus memasukkan `sv -w 130 restart panel` PLAN/03 dan petunjuk rollback
PLAN/04. (2)+(3) `package-release.sh` menanam `PANEL_VERSION_DEFAULT=<tag>` ke salinan `install.sh`, sehingga skrip selalu mengunduh
`releases/download/<tag>/` dan skrip serta binary berasal dari rilis yang sama. URL landing tetap `releases/latest/download/install.sh`.
(4) Pesan: "Checksum tidak cocok: unduhan rusak. Ulangi; untuk memastikan asal rilis pakai `gh attestation verify`." (5) Prasyarat:
"setelah `pkg install termux-services`, tutup lalu buka lagi Termux". `install.sh` memberi peringatan (tidak berhenti) bila `cloudflared` tidak ada.
Snapshot sebelum upgrade terjadi di boot (PLAN/04 K9), jadi [DEP] snapshot di `install-phone.sh` dihapus (K36 integrasi).

### C13 — Klaim landing · **TERIMA**

**Perubahan.** Strip spesifikasi: "1 perintah pasang" diganti "±30 menit penyiapan". `#pasang` menjadi daftar bernomor 5 langkah: (1) jalankan
skrip instal, (2) buat OAuth client Google dan isi `~/panel/.env`, (3) hubungkan Cloudflare Tunnel (cloudflared + DNS + ingress), (4) pasang
Cloudflare Access, (5) jalankan ulang skrip. Perintah ada di langkah 1, sisanya menaut ke README. Prasyarat ditulis lengkap: HP Android arm64,
Termux dari F-Droid/GitHub + `termux-services` (buka ulang Termux), `cloudflared`, PostgreSQL & pm2 (bila ingin situs dengan database),
domain di Cloudflare, akun Google Cloud, sebuah komputer untuk build aplikasimu. FAQ telemetri: "Tidak ada telemetri. Panel hanya menghubungi
layanan yang kamu atur (Cloudflare, bucket cadangan, Telegram) dan satu alamat Google untuk mengecek koneksi internet HP." [ASUMSI] MIT dan Q1/Q3
dihapus: MIT makurosolusi dan v0.3.0 sudah diputuskan.

### C14 — "Build mode demo" · **TERIMA**

**Perubahan.** Istilah diganti "mode fake (otomatis di luar Termux)". Cek `fake_on_https`: `mode === "fake"` dan `APP_BASE_URL` https →
fail "Panel berjalan dengan data contoh, bukan data HP". Seed: env `APP_BASE_URL=http://localhost:3415`, `GOOGLE_CLIENT_ID=demo`,
`GOOGLE_CLIENT_SECRET=demo`, `SUPER_ADMIN_EMAILS=demo@contoh.test`, `PANEL_DATA_DIR=$TMPDIR/panel-demo-<rand>`; cookie ditulis di data dir itu, bukan di repo.

### C15 — Screenshot & sitemap berlebihan · **TERIMA**

**Perubahan.** Empat WebP terang saja (`overview-m`, `sites-d`, `health-d`, `services-m`), dibingkai bezel netral, dipakai di kedua tema.
`og.png` statis di-commit (dibuat sekali dari screenshot hero). `/sitemap.xml` dan baris `Sitemap:` dihapus; path itu kini 404 + noindex
sungguhan (masalah soft-404 tetap tertutup).

### C16 — SEO & 404 · **TERIMA**

**Perubahan.** `robots.txt` = `User-agent: *` + `Disallow: /api/`. Path privat cukup memakai `X-Robots-Tag: noindex, nofollow` + meta robots.
Di penyaji: respons HTML yang ditulis ulang tidak meneruskan `ETag`/`Last-Modified`, dan fetch internal tidak meneruskan `If-None-Match`, sehingga
tidak pernah 304; status dari `pageHead` (404 untuk path tak dikenal). Test `/xyz` dengan `If-None-Match` tetap 404. Q2 ditutup: canonical ke diri sendiri.

### C17 — Workflow rilis · **TERIMA**

**Perubahan.** `release.yml` dipegang PLAN/05 saja; PLAN/04 me-review tanpa mengedit dan memegang `ci.yml` + `dependabot.yml`. Kontrak aset
ditulis sekali di §3.7. `wkr-adm-docs-01` menaikkan `package.json` ke `0.3.0` bersama entri CHANGELOG `## [0.3.0]`. Langkah CI baru:
`sh scripts/install-phone.test.sh && sh scripts/install-release.test.sh && sh scripts/package-release.test.sh` (di `release.yml`, dan diminta
juga di `ci.yml` PLAN/04, supaya kegagalan Linux ketahuan sebelum tag). `workflow_dispatch` dengan input `dry_run` (default `true`) menjalankan
semua langkah kecuali attest + `gh release create`. Attestation: `actions/attest@v4` (penerus resmi `attest-build-provenance`, terverifikasi);
PLAN/04 diminta menyesuaikan.

### C18 — "Terakhir aktif" meleset · **TERIMA**

**Perubahan.** `lastSeenAt` dan sesi "Aktif" ditampilkan dengan resolusi hari: "Aktif hari ini" / "kemarin" / tanggal pendek. Tidak ada
kolom baru. §8 mencatat fallback `auth.sign_in` bergantung pada `audit.retention_days` PLAN/04 (minimal 90 hari: cukup).

### C19 — Level onboarding · **TERIMA**

**Perubahan.** Tabel level eksplisit di §3.1: `access`, `secret_saved`, `backup` = wajib; `cloudflare_token`, `apps_json`, `first_site` = disarankan;
`admins` = opsional. `apps_json` diberi [DEP hasil eksperimen pm2 POCO / PLAN/03]. Field `partial` diganti `needsFirstRun`.

### C20 — `error_description` · **TERIMA**

**Perubahan.** §5.7: `error_description` dan parameter `?error` mentah tidak pernah dirender; hanya teks dari kamus. Test:
`?error=access_denied&error_description=<teks>` tidak menampilkan `<teks>`.

### C21 — Pemilik `LogViewer` · **TERIMA**

**Perubahan.** Semua [DEP PLAN/02] untuk `LogViewer` diganti [DEP PLAN/01]. `/dev/logs` memakai `useApiQuery` biasa yang mengganti isi
(ring di memori, tanpa cursor), sesuai X9.

### C22 — QA Access & instal nyata · **TERIMA SEBAGIAN**

**Alasan.** Ditambahkan ke §6.4, tetapi sebagai QA **setelah merge** di HP uji (izin eksperimen POCO, dengan perintah pemilik). Saya tidak
menjadikannya prasyarat merge karena butuh Access dan domain sungguhan yang tidak tersedia di CI.
**Perubahan.** §6.4: instal bersih dari rilis sampai `panel healthy`; akun non-pemilik melihat kartu belum punya akses; promosi ke Admin +
tambah email di Access → `/panel` terbuka.

---

## Kontrak kanonik usulan PLAN/05 (untuk arbitrase koordinator)

1. **Uji koneksi S3** (implementasi PLAN/04, UI PLAN/05):

   ```ts
   // POST /api/dev/backup/verify (super_admin). Body opsional; field yang tidak dikirim memakai nilai tersimpan.
   export type BackupVerifyInput = Partial<{ endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string }>;
   export type BackupVerifyStep = "write" | "read" | "list" | "delete";
   export type BackupVerifyCode = "ok" | "not_configured" | "key_mismatch" | "unreachable" | "bucket_not_found"
     | "write_denied" | "read_failed" | "list_denied" | "delete_denied" | "timeout" | "s3_error";
   export type BackupVerify = {
     ok: boolean; code: BackupVerifyCode; failedStep: BackupVerifyStep | null;
     steps: { step: BackupVerifyStep; ok: boolean }[]; ms: number; detail: string | null; // detail tanpa kunci (describe())
   };
   ```

   200 selalu untuk hasil uji (termasuk gagal); 400 `invalid_value` + `fields` hanya untuk override yang tidak lolos validator. Objek
   `<prefix>.panel-termux-check-<rand>`, timeout 15 dtk, DELETE di `finally`. Audit `backup.verify {ok, code}`. File `src/server/backup/backup.verify.ts`
   (PLAN/04). Bila retensi final PLAN/04 tidak pernah me-list, hapus `list`/`list_denied`.
2. **Telegram:** kunci & endpoint PLAN/02 apa adanya (`alerts.*`, `monitor.sample_interval_sec`, `POST /api/dev/alerts/test`, `POST /api/dev/alerts/telegram/chats`).
   Label hanya di `src/web/i18n/id.settings.ts` (teks PLAN/02 §3.6 disalin). Simpan lewat `PATCH /api/dev/settings`.
3. **Pengaturan:** `GET /api/dev/settings` → `{items: DevSetting[]}` dengan `DevSetting = {key, secret, value, default, isSet, readable, updatedAt}`;
   `PATCH /api/dev/settings {values}` atomik; `PUT /:key` dihapus; `setSetting` tetap ada untuk pemanggil server/test.
4. **SecurityStatus:** dipakai apa adanya dari PLAN/04 (`dataKey.state/exportedAt/unreadableSettings`, `access.https/lastSeenAt`). PLAN/05 menambah
   satu kunci `app_meta`: `onboarding.secret_saved.check` (nilai `secret_check` saat dicentang manual).
5. **Audit:** bentuk datar PLAN/04. PLAN/05 menambah `meta.targetEmail` pada `user.role_change`/`user.delete` dan aksi `setup.update`. Filter `action` satu nilai (awalan bila diakhiri `.`).
6. **Revoke sesi pengguna lain:** `POST /api/dev/users/:id/sessions/revoke` → `RevokedSessions`; 404; **409 hanya bila id = pemanggil**. Implementasi
   `revokeUserSessions` PLAN/04, route PLAN/05. Audit `session.revoke {userId, revoked, scope: "user"}`.
7. **Rilis:** pemilik `release.yml` = PLAN/05. Aset tetap: `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`. Tag `v0.3.0` dibuat pemilik.
   Naik versi `package.json` + CHANGELOG oleh worker dokumen akhir. `actions/attest@v4`, `oven-sh/setup-bun@v2` (Bun 1.4.2), semua dipin SHA.
   `ci.yml` (PLAN/04) menjalankan ketiga test shell.
8. **Vonis kesehatan:** `Problem[]` PLAN/02 (kode info `backup_not_configured`, `access_not_seen` tidak menurunkan vonis) + cek panel `errors` (500 saja,
   `requestStats().unhandled5m` baru di `request.log.ts`), `sampler`, `fake_on_https`.
9. **Rute & 404:** `isKnownSpaPath` di `roles.ts` dan klien 404 publik milik PLAN/01 1c; `seo.ts` milik PLAN/05, dirangkai di `spa.serve.ts` oleh `wkr-http-01`.
10. **`install-phone.sh`:** pemilik PLAN/05 (`wkr-adm-dist-01`, W1): exit 3 untuk `.env`, plus `sv -w 130` (PLAN/03) dan petunjuk rollback (PLAN/04) dari spec mereka.
