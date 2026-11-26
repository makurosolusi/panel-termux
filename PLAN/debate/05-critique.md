# Kritik PLAN/05 — Administrasi, onboarding, profil, login, landing & distribusi

> wkr-critic-05 · 2026-11-26 · HEAD `feature/production-polish` (caa4308). Kode, PLAN/01–04, dan README diperiksa ulang di HEAD ini.
> Fakta eksternal dicek: Better Auth 1.7.28 di `node_modules`, `gh api repos/actions/attest` (v4.2.2), `npm view @oven/bun-linux-aarch64-android@1.4.2`.

## 1. Ringkasan penilaian

**Verdict: siap dengan revisi.** Bagian landing, login, profil, dan registri teks pengaturan sudah matang. Ada tiga bagian yang perlu ditulis ulang
sebelum implementasi: (a) pengalaman peran `user` bertabrakan dengan resep Access di README, sehingga tetap jalan buntu di produksi;
(b) kontrak lintas PLAN (uji S3, Telegram, Access/kunci data, audit, rilis) masih bertentangan dengan PLAN/02 dan PLAN/04; (c) tabel
kepemilikan file bentrok dengan gelombang PLAN/01, PLAN/02, dan PLAN/04, jadi tidak bisa dijalankan paralel seperti yang tertulis.
Aturan vonis kesehatan akan sering memberi alarm palsu dan sebagian ceknya tidak pernah bisa gagal. Distribusi realistis dan
cross-compile di runner Linux memang jalan, tapi klaim "1 perintah pasang" tidak jujur dan `install.sh` tidak bisa membaca hasil
`install-phone.sh`.

Jumlah: **3 BLOCKER, 10 MAJOR, 7 MINOR, 2 OVER.**

---

## 2. Temuan

### C1. `/profile` ada di belakang Access, jadi peran `user` tetap jalan buntu di produksi

- **Severity:** BLOCKER · **Area:** flow / kontrak
- **Klaim di PLAN:** K20, F8 ("Peran `user` di `/profile` melihat kartu 'Akun kamu belum punya akses…'"), §5.8 header "Akun saya" → `/profile`, F1 item `access` ("Lihat resep Access", README langkah 4).
- **Masalah:** README langkah 4 (`README.md:126-134`) meminta pemilik memasang Access di path `profile`, `panel`, `dev`, `api/panel`, `api/dev`,
  dengan policy Allow **hanya email pemilik**. Akun Google acak yang login (keputusan pemilik 4: login terbuka) diarahkan ke `/profile`
  (`roles.ts` `HOME.user = "/profile"`). Navigasi itu berupa _full load_ (`needsFullLoad`, `session.redirect.ts:26`), jadi Access
  mencegatnya dan menampilkan halaman "You don't have access". Kartu "belum punya akses" dan tautan "Akun saya" tidak pernah terlihat,
  padahal keduanya inti K20. Data `/profile` sendiri datang dari `/api/me` dan `/api/me/sessions`, yang memang **tidak** dilindungi Access
  (README:141). Jadi melindungi halaman `/profile` tidak menambah keamanan apa pun.
- **Usulan:** Keluarkan `profile` dari daftar path Access (README langkah 4, resep yang dirujuk item onboarding `access`, teks
  `checks.access.*`). Tambahkan ke §1.2 bahwa PLAN/05 mengubah README bagian ini, lalu catat di CHANGELOG sebagai perubahan resep.
  Tambahkan juga UI-QA: "akun Google yang bukan pemilik, di instance ber-Access, login lalu melihat kartu belum punya akses".

### C2. Uji koneksi S3: dua endpoint, dua semantik, dan PLAN/05 tidak menguji izin _list_ yang dipakai retensi

- **Severity:** BLOCKER · **Area:** kontrak / fitur
- **Klaim di PLAN:** K4, K5, §3.3 `POST /api/dev/backup/verify` (nilai tersimpan; PUT→HEAD→DELETE), `BackupVerify*`, §6.1 `tests/backup.verify.test.ts`, file `src/server/backup/backup.verify.ts`.
- **Masalah:** PLAN/04 (§3.1 baris 214-223 dan §3.3 baris 356) sudah mendefinisikan `POST /api/dev/backup/test` dengan `BackupTestInput`
  (nilai draft, field yang kosong memakai nilai tersimpan), langkah `write/read/list/delete`, dan file `backup.probe.ts`. PLAN/04
  §785 menyebut "Uji koneksi" memakai nilai form yang belum disimpan. Implementasi bersamaan menghasilkan dua endpoint dan dua tipe.
  Selain itu, K5 mengklaim "menguji persis izin yang dipakai cadangan + retensi", padahal retensi memanggil `client.list(...)`
  (`backup.service.ts:38`). Token R2 tanpa izin List akan lulus uji PLAN/05, lalu retensi gagal setiap malam.
- **Usulan:** Satu endpoint milik PLAN/04: `POST /api/dev/backup/test`, body opsional berisi override draft (yang tidak dikirim memakai
  nilai tersimpan, jadi rahasia tidak perlu dikirim ulang). Langkahnya `write → read(stat ukuran) → list(prefix) → delete`.
  PLAN/05 hanya memiliki UI dan pemetaan kode ke teks (§5.5, ditambah kode `list_denied`). Hapus `BackupVerify*` dan
  `backup.verify.ts` dari PLAN/05, lalu sesuaikan K4 (lihat C11).

### C3. Kepemilikan file bentrok lintas PLAN di gelombang yang sama

- **Severity:** BLOCKER · **Area:** rencana kerja
- **Klaim di PLAN:** §7 "Tidak ada dua worker di satu file dalam satu gelombang, termasuk lintas PLAN".
- **Masalah (bukti per file):**
  - `src/shared/dev.types.ts`: `wkr-adm-server-01` (G1) **dan** PLAN/04 `wkr-safety-audit` (G1, PLAN/04:841).
  - `src/shared/roles.ts` (`SPA_ROOTS`): `wkr-adm-seo-01` (G1) **dan** PLAN/01 gelombang 1a (PLAN/01:951).
  - `src/web/i18n/id.ts`: `wkr-adm-i18n-01` (G1) **dan** PLAN/01 1a.
  - `src/web/pages/public-not-found.page.tsx`: dibuat `wkr-adm-account-web-01` **dan** sudah ditandai ★ baru di PLAN/01 1c (PLAN/01:953).
  - `session.redirect.ts`, `router.tsx`: PLAN/01 1c. PLAN/05 sudah menaruhnya di G3, tapi K16 (`resolveRedirect` tamu) juga butuh PLAN/01 tidak menulis ulang logika itu.
  - `.github/workflows/release.yml`: `wkr-adm-dist-01` **dan** PLAN/04 `wkr-release-ci` (PLAN/04:844).
  - Revoke sesi pengguna lain (`revokeUserSessions`, `POST /api/dev/users/:id/sessions/revoke`): PLAN/04 memilikinya (PLAN/04:252, 362, 416), tapi PLAN/05 memasukkannya ke `users.service.ts`/`dev.routes.ts` `wkr-adm-server-01`.
  - `settings.service.ts`: PLAN/02 `wkr-mon-api-02` menambah 6 kunci (PLAN/02:972), dan menurut PLAN/02:976 gelombangnya belum diurutkan terhadap PLAN/05.
  - `describeSetting` akan butuh `secret` untuk menghitung `readable`, sehingga pemanggil `site.service.ts:270` (milik PLAN/03) ikut berubah. File itu tidak ada di daftar mana pun.
- **Usulan:** Sebelum implementasi, orkestrator membuat satu matriks kepemilikan lintas PLAN. Usulan konkret: (1) PLAN/05 G1 dipecah:
  `dev.types.ts` + `settings.service.ts` jadi gelombang 0 (satu worker, sebelum PLAN/02/04 menambah kunci/tipe). (2) `SPA_ROOTS`
  ditulis PLAN/01 1a dari spesifikasi PLAN/05. (3) `public-not-found.page.tsx` milik PLAN/01; PLAN/05 hanya memberi copy.
  (4) `release.yml` milik satu PLAN (usul PLAN/05, PLAN/04 hanya me-review, lihat C17). (5) Endpoint revoke milik PLAN/04;
  PLAN/05 hanya UI. (6) Pertahankan `describeSetting(db, key)` dan hitung `readable` di `listSettings(deps)`, sehingga `site.service.ts` tidak tersentuh.

### C4. Kontrak Telegram tidak cocok dengan PLAN/02

- **Severity:** MAJOR · **Area:** kontrak / UI
- **Klaim di PLAN:** §3.1 komentar "PLAN/02 menambah kunci `notify.*`", §3.3 `POST /api/dev/notify/telegram/test` → `{ ok, code, detail }`, §3.5 grup `notify` anchor `#notifikasi`.
- **Masalah:** PLAN/02 memakai kunci `alerts.telegram_bot_token`, `alerts.telegram_chat_id`, `alerts.enabled` (`on|off`),
  `alerts.min_severity` (`warning|danger`), dan `monitor.sample_interval_sec` (PLAN/02:452-457). Endpoint PLAN/02 adalah
  `POST /api/dev/alerts/test` dengan error 409/429/502, bukan 200 `{ok:false}` (PLAN/02:486). PLAN/02 juga punya
  `POST /api/dev/alerts/telegram/chats` ("Cari chat"), yang tidak ada di UI PLAN/05. `SettingControl` tidak punya kontrol untuk
  enum/toggle (`alerts.enabled`, `alerts.min_severity`) maupun `Switch` + dialog untuk `backup.include_secrets` dari PLAN/04 (PLAN/04:785),
  dan `monitor.sample_interval_sec` tidak punya grup.
- **Usulan:** Pakai nama dan endpoint PLAN/02 apa adanya. Web memetakan status HTTP + `error` ke teks, jadi tidak perlu format baru.
  Tambahkan `SettingControl` `{ kind: "choice"; options: readonly string[] }` (Select/radio, juga dipakai `on|off` sebagai Switch)
  dan `confirmOn?: string` untuk dialog `include_secrets`. Masukkan `monitor.sample_interval_sec` ke grup "Notifikasi & pemantauan".
  Tombol "Cari chat" ditaruh di field chat id.

### C5. Deteksi Access dan status kunci data menduplikasi `SecurityStatus` PLAN/04

- **Severity:** MAJOR · **Area:** kontrak / data
- **Klaim di PLAN:** K7 (header dibaca di request `/api/dev/setup` dan `/health`), K6/§3.2 `app_meta.onboarding.secret_saved.done_at` dan `onboarding.access.done_at`, cek `settings_readable`, `DevSetting.readable`.
- **Masalah:** PLAN/04 K18 dan `SecurityStatus` (PLAN/04:233-250) sudah menyediakan `access.lastSeenAt` (dicatat di `createApiHandler`
  untuk semua request `/api/panel|dev`), `dataKey.exportedAt` (`app_meta.secret_exported_at`), `dataKey.state`, dan `unreadableSettings`.
  PLAN/04:862 bahkan menulis bahwa onboarding PLAN/05 memakai `SecurityStatus`. Bila PLAN/05 membangun mekanismenya sendiri, akan ada
  dua jawaban untuk "Access aktif?" dan "kunci tersimpan?" yang bisa saling bertentangan. Centang manual `secret_saved` juga menjadi
  basi setelah reset kunci data (PLAN/04 `data-key/reset`): item tetap "Selesai" untuk kunci yang sudah tidak ada.
- **Usulan:** `setup.service` dan `health.service` membaca `getSecurityStatus()` milik PLAN/04. `access` selesai bila `lastSeenAt`
  terisi, atau bila centang manual masih ada. `secret_saved` selesai bila `exportedAt` terisi, atau bila centang manual menyimpan
  **sidik kunci** (`app_meta.secret_check` saat dicentang) yang masih sama dengan sidik sekarang. `settings_readable` diambil dari
  `dataKey.state`. `DevSetting.readable` tetap boleh, tapi dihitung dari fungsi PLAN/04, bukan dekripsi ulang terpisah.

### C6. Aturan vonis kesehatan akan sering memberi alarm palsu

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** §3.4 tabel cek; `errors` warn bila `1 ≤ n`; `backup` warn bila belum dikonfigurasi/tidak ada run 36 jam; `background` fail bila heartbeat > 3× interval; `access` warn.
- **Masalah (skenario konkret):**
  - `errors`: satu 5xx sudah cukup membuat "Perlu perhatian" selama 5 menit. Sebagian 5xx adalah hasil yang _diharapkan_: PLAN/02 menjawab
    **502** untuk uji Telegram yang gagal (PLAN/02:486), panel API menjawab 502 `system_error` bila runit tidak terbaca, dan `/api/ready`
    menjawab 503 saat boot. Contohnya, super admin menekan "Kirim pesan uji" dengan chat id salah, lalu `/dev` menjadi kuning.
  - `backup`: instance yang sengaja tidak memakai cadangan, atau `backup.hour=off`, akan "Perlu perhatian" **selamanya**
    (`not_configured`, lalu `stale`) tanpa cara mengakui keadaan itu. Vonis yang selalu kuning membuat orang berhenti membacanya.
  - `background`: `startScheduler` memakai `setInterval` 60 dtk (`backup.service.ts:210-225`). Bila Termux tanpa wakelock dan Android masuk
    Doze, timer tertunda beberapa menit. Batas 3 × 60 dtk berarti "Bermasalah: … Mulai ulang panel", padahal tidak ada yang rusak.
  - `access`: di produksi tanpa Access, vonisnya kuning permanen (Q4 sudah mengakui ini).
- **Usulan:** `errors` hanya menghitung **500** (handler tak tertangani, `api.handler`), bukan 502/503 yang dipetakan, dengan warn ≥ 3 dan fail ≥ 10.
  `backup` `not_configured` dan `hour=off` menjadi status informasi (`ok` + teks "Cadangan tidak diatur"), sedangkan ajakan mengatur cadangan
  sudah ada di onboarding. `stale` dihitung dari `nextRunAt` yang terlewat > 2 jam, bukan 36 jam tetap. `access` cukup sebagai baris
  informasi, tidak ikut menurunkan vonis (keamanannya sudah jadi masalah merah PLAN/04 `securityProblems`). Selaraskan juga dengan
  `computeProblems` PLAN/02 supaya Ringkasan dan Kesehatan tidak memberi dua vonis berbeda: paling sederhana, vonis Kesehatan memakai
  `Problem[]` yang sama dan ditambah cek khusus panel.

### C7. `heartbeat.ts` dan cek `schema` tidak bisa mendeteksi apa pun yang nyata

- **Severity:** OVER · **Area:** fitur
- **Klaim di PLAN:** K21, §3.4 `background`, `heartbeat.ts`, `Heartbeat` type, cek `schema`, `latestSchemaVersion` di `DevHealth`.
- **Masalah:** (1) `setInterval` di event loop yang sama dengan handler HTTP tidak bisa "berhenti diam-diam". Selama `/api/dev/health`
  bisa dijawab, interval juga jalan, dan error di tick sudah ditangkap (`backup.service.ts:216-223`). Heartbeat `backup_scheduler`
  karena itu tidak pernah bisa membuktikan apa-apa, dan hanya menyisakan risiko alarm palsu di C6. Untuk sampler, PLAN/02 sudah
  mengekspos `sampledAt` (PLAN/02:307) dan single-flight. (2) `schema`: `runMigrations` melempar error bila gagal, sehingga `start()`
  mati dan tidak ada halaman yang bisa menampilkan "fail" (`migrate.ts:38-52`, `index.ts:35`). Pada downgrade binary, `runMigrations`
  justru **menimpa** `schema_version` dengan tag yang lebih lama (`migrate.ts:44-46`), jadi cek tetap "ok". Ceknya tidak bisa gagal.
- **Usulan:** Hapus `heartbeat.ts`, `Heartbeat`, dan cek `schema`. Tampilkan `sampledAt` dari PLAN/02 (warn bila > 3 × interval _setting_,
  minimal 10 mnt) dan `backup.nextRunAt`. Bila ingin mendeteksi downgrade, pakai `app_meta.panel_version` PLAN/04 (prev > sekarang → warn).
  Ini juga mengurangi satu file, satu tipe, dan dua dependensi lintas PLAN.

### C8. Halaman Pengguna: promosi Admin juga butuh Access, dan aturan revoke bertentangan dengan PLAN/04

- **Severity:** MAJOR · **Area:** flow / keamanan
- **Klaim di PLAN:** F5, §5.3 dialog ubah peran, §3.3 revoke "409 `protected` untuk diri sendiri dan super admin env", item onboarding `admins`.
- **Masalah:** (1) Di instance ber-Access (yang dianggap praktis wajib oleh PLAN ini), menjadikan seseorang Admin **tidak cukup**: email
  orang itu harus ditambahkan ke policy Access. Bila tidak, `/panel` (full load) diblokir Access, atau API menjawab 401 lalu memicu loop
  muat ulang dan pesan "periksa kebijakan Access" (README:149). Dialog dan item onboarding `admins` tidak menyebut langkah ini.
  (2) PLAN/04 hanya menolak revoke untuk diri sendiri (PLAN/04:362, 812). PLAN/05 juga menolak super admin env, sehingga super admin
  tidak bisa mengeluarkan sesi curian milik super admin lain, padahal itu respons insiden paling penting (R&D-04 G13).
  (3) Dengan login terbuka, "Hapus pengguna" tidak memblokir apa pun: akun yang sama bisa login lagi sebagai `user` (`users.service.ts:100-104`).
  Dialog perlu jujur soal ini.
- **Usulan:** Dialog promosi berisi catatan "Bila panel memakai Cloudflare Access, tambahkan juga {email} ke policy Access", plus tautan
  resep. Hal yang sama ditulis di body item `admins`. Revoke hanya 409 untuk diri sendiri, sesuai PLAN/04. Body dialog hapus ditambah
  kalimat "Ia tetap bisa masuk lagi dengan Google sebagai Pengguna."

### C9. Redesain API pengaturan: migrasi pemanggil dan test belum direncanakan

- **Severity:** MAJOR · **Area:** kontrak / test / rencana kerja
- **Klaim di PLAN:** K1, K3, §3.3 PATCH, §6.1 `dev.settings.test.ts`, Risiko 2 ("Konsumen hanya web panel sendiri").
- **Masalah:**
  - `setSetting(...)` dipanggil langsung oleh `tests/backup.api.test.ts:69`, `cloudflare.dns.test.ts:140,147`, `me.sessions.test.ts:191,198`,
    `panel.api.test.ts:165,167`. `InvalidSettingError` dipakai `backup.config.test.ts:3`, dan `SETTINGS` dipakai `dev.api.test.ts:12`. Tidak satu pun
    file ini dimiliki `wkr-adm-server-01` ("tests §6.1 server" saja). Bila `setSetting` diganti `setSettings`, lima file test pecah.
  - Rate-limit dan kontrak "audit per kunci yang benar-benar berubah" tidak terdefinisi untuk rahasia: server tidak bisa tahu apakah
    rahasia yang dikirim ulang sama dengan yang lama tanpa mendekripsi.
  - Kunci tak dikenal di dalam batch menjawab 404. Untuk body batch, ini lebih tepat 400 `invalid_body` dengan `fields`.
  - Atomik per request tidak menegakkan kelengkapan grup S3 (G18): PATCH `backup.s3_endpoint` saja tetap diterima. Itu wajar, tapi
    klaim di K3 jangan berlebihan.
  - Tab lama setelah upgrade masih memanggil `PUT …/:key` dan mendapat 404. Penanganan muat ulang versi baru ada di PLAN/01 (R8), dan itu harus masuk lebih dulu.
  - `settings.service.ts` sekarang 236 baris. Ditambah ±10 kunci PLAN/02/04 dan batch, ukurannya akan melewati batas service 300 baris (Rule 8).
- **Usulan:** Pertahankan `setSetting(deps, key, value, actor)` sebagai pembungkus satu kunci atas `setSettings`, sehingga test dan
  pemanggil lain tidak berubah. Rahasia yang dikirim selalu dianggap "berubah", dan ini didokumentasikan. Kunci tak dikenal menjadi 400.
  Pecah registri ke `src/server/settings.registry.ts` (definisi + validator) dan sisakan `settings.service.ts` untuk baca/tulis.
  Tambahkan ke §6.1: "semua test yang ada lulus tanpa diubah, kecuali bagian PUT di `dev.api.test.ts`".

### C10. Audit UI vs skema PLAN/04: bentuk entri dan label target belum cocok

- **Severity:** MAJOR · **Area:** kontrak / UI
- **Klaim di PLAN:** §3.1 `DevAuditEntry` (union `actor.kind: user|deleted|system`, `targetLabel`), F6 `action` berulang (OR), §5.4 "`user.role_change` → '{aktor} mengubah peran {target}'".
- **Masalah:** PLAN/04 (§3.1 baris 263-280) memakai bentuk datar: `actor: UserRef|null`, `actorKind: "user"|"system"|"unknown"`,
  `actorLabel`, `actorEmail`, `actorDeleted`. Tidak ada `targetLabel`, dan `listAudit` hanya menerima satu `action` (awalan atau exact)
  ditambah `from/to` (PLAN/04:357). Tanpa `targetLabel`, kalimat `user.role_change` dan `user.delete` menampilkan **ID pengguna**
  (`users.service.ts:86-93` menyimpan `target: id`). Setelah pengguna dihapus, ID itu tidak bisa diterjemahkan lagi. `"unknown"` juga
  tidak punya teks di `describeAudit`.
- **Usulan:** Ikuti bentuk PLAN/04 (hapus union PLAN/05). Minta PLAN/04 menyimpan label target saat merekam event
  (`meta.targetLabel` = email pengguna; untuk `settings.update` cukup kunci, karena label datang dari `id.settings`). Tambahkan teks
  `unknown` → "Tidak diketahui". Grup filter cukup satu awalan per opsi: pisahkan "Masuk" (`auth.`) dan "Sesi" (`session.`), sehingga
  `action` berulang tidak diperlukan.

### C11. Semantik tombol uji: uji otomatis setelah simpan terlalu agresif

- **Severity:** MAJOR · **Area:** fitur / UI
- **Klaim di PLAN:** K4 ("Setelah grup Cloudflare/Cadangan/Telegram disimpan, UI otomatis menjalankan uji").
- **Masalah:** (1) Uji Telegram mengirim pesan sungguhan. Uji otomatis berarti setiap simpan grup (termasuk mengubah `min_severity`)
  mengirim pesan ke grup, dan PLAN/02 membatasinya 1 per 5 dtk dengan `429 too_soon`. (2) Mengubah `backup.hour` atau `retention_days`
  memicu PUT/DELETE ke bucket dan menunggu sampai 15 dtk tanpa alasan. (3) Pola simpan dulu lalu uji berarti kredensial baru yang
  salah sudah menimpa kredensial lama yang bekerja, sehingga cadangan malam itu gagal sampai diperbaiki.
- **Usulan:** Uji otomatis hanya untuk Cloudflare dan S3, dan hanya bila kunci **koneksi** di grup itu berubah (token, endpoint, bucket,
  kunci, region, prefix). Telegram tetap manual. Karena endpoint S3 menerima override draft (C2), tombol "Uji koneksi" bisa dipakai
  _sebelum_ simpan. Itu yang diharapkan operator Coolify/Railway, dan rahasia yang tidak diubah tetap tidak dikirim ulang.

### C12. Distribusi: `install.sh` tidak bisa membaca hasil `install-phone.sh`, dan versi "latest" tidak deterministik

- **Severity:** MAJOR · **Area:** flow / distribusi
- **Klaim di PLAN:** F9 langkah 3.5-3.6 dan 4; §3.7 `install-release.sh`.
- **Masalah:** (1) `install-phone.sh` keluar dengan **exit 0** baik saat `.env` belum lengkap (`install-phone.sh:69-73`) maupun saat
  sukses (akhir skrip). Satu-satunya cara bagi `install.sh` untuk membedakan keduanya adalah mem-parse teks Inggris. (2) "Skip bila
  `~/panel-src/<VERSION>` sudah ada" butuh VERSION _sebelum_ unduh, padahal default-nya `releases/latest/download/` tidak memberi nomor
  versi. (3) `install.sh` diunduh dari `latest`, lalu mengunduh tarball dari `latest` juga. Bila rilis baru terbit di antara dua unduhan
  itu, skrip dan binary berasal dari versi berbeda. (4) Pesan "unduhan rusak **atau diubah**" berlebihan: `SHA256SUMS` berasal dari
  tempat yang sama dengan tarball, jadi hanya melindungi dari kerusakan unduhan, bukan dari perubahan sengaja (itu tugas `gh attestation`).
  (5) Setelah `pkg install termux-services`, `service-daemon` baru jalan setelah Termux dibuka ulang. Tanpa itu, `install-phone.sh`
  berhenti dengan "sv restart panel failed".
- **Usulan:** `install-phone.sh` keluar dengan kode khusus (mis. `3`) untuk "isi `.env`", lalu `install.sh` memeriksanya. Pengubahan
  ini kecil dan didokumentasikan di header skrip. `package-release.sh` menulis versi ke salinan `install.sh` (`PANEL_VERSION_DEFAULT=v0.3.0`),
  sehingga `install.sh` selalu mengunduh `releases/download/<versinya>/` dan skip-logic jadi sederhana. Pesan checksum ditulis
  "unduhan rusak". Prasyarat instal menyebut "buka ulang Termux setelah `pkg install termux-services`". Tambahkan test: exit 3 → install.sh mencetak langkah `.env`.

### C13. Landing: beberapa klaim belum jujur

- **Severity:** MAJOR · **Area:** UI / konten
- **Klaim di PLAN:** §5.8 strip spesifikasi "1 perintah pasang", prasyarat "4 butir", FAQ "Panel tidak mengirim telemetri; semuanya di HP-mu dan bucket milikmu", K13/A1 "MIT [ASUMSI]".
- **Masalah:** Sampai panel bisa dipakai, pengguna masih harus: membuat OAuth client Google, mengedit `.env` (4 variabel), memasang
  `cloudflared` dan membuat tunnel + DNS + ingress (README langkah 3), memasang Access (README langkah 4), dan memasang
  `termux-services` lalu membuka ulang Termux. Prasyarat landing tidak menyebut tunnel/`cloudflared`, padahal tanpa itu panel tidak
  bisa diakses dari luar. "1 perintah" adalah klaim yang akan langsung dipatahkan oleh pengguna pertama. FAQ telemetri benar, tapi
  "semuanya di HP-mu" mengabaikan bahwa panel menghubungi Cloudflare API, Telegram, bucket, dan `gstatic.com/generate_204`
  (probe internet PLAN/02 K18). Lisensi MIT adalah keputusan pemilik yang mengikat, jadi tanda [ASUMSI] dan Q1 seharusnya dihapus.
- **Usulan:** Strip diganti "±30 menit penyiapan" atau "5 langkah". `#pasang` menampilkan daftar bernomor singkat: 1 skrip instal,
  2 isi `.env` (OAuth Google), 3 tunnel Cloudflare, 4 Access, 5 jalankan ulang. Perintah instal ada di langkah 1, dan langkah lain
  menaut ke README. FAQ ditulis "Tidak ada telemetri. Panel hanya menghubungi layanan yang kamu atur (Cloudflare, bucket, Telegram)
  dan satu alamat Google untuk mengecek koneksi internet." `install.sh` memberi peringatan (bukan berhenti) bila `cloudflared` tidak ada.
  Hapus Q1/Q3 dan [ASUMSI] di K13/A1, karena sudah diputuskan: MIT makurosolusi, v0.3.0.

### C14. "Build mode demo" tidak ada. Mode fake adalah perilaku runtime binary produksi

- **Severity:** MINOR · **Area:** fitur / keamanan
- **Klaim di PLAN:** K15, §6.3 "build mode demo", §7 G3 `scripts/demo-seed.ts` ("adapter fake otomatis karena tidak ada `$PREFIX/bin/sv`").
- **Masalah:** Mode fake dipilih saat runtime oleh `selectSystem()` bila `$PREFIX/bin/sv` tidak ada (`system.select.ts:28-30`), dan
  kodenya ikut di **setiap** binary produksi. Itu aman, karena `demo-seed.ts` tidak masuk binary dan seed hanya memakai `contoh.com`.
  Ada tiga celah kecil. (a) Bila di HP sungguhan `sv` hilang, panel produksi berjalan dengan data fiktif sementara vonis tetap "Sehat"
  (K8: fake bukan cek). (b) Seed harus menyetel env dummy (`GOOGLE_*`, `APP_BASE_URL`, `SUPER_ADMIN_EMAILS=demo@contoh.test`), karena
  `loadEnvOrExit` mewajibkannya dan `syncSuperAdminsOnBoot` (`access.service.ts:34-38`) akan menurunkan super admin demo bila email
  itu tidak ada di env. (c) File cookie demo sebaiknya di scratch dir, bukan di dalam repo.
- **Usulan:** Ganti istilahnya menjadi "mode fake (otomatis di luar Termux)". Bila `mode === "fake"` dan `APP_BASE_URL` https, cek
  menjadi **fail** ("Panel berjalan dengan data contoh"). Tuliskan env yang dipakai seed di §7, dan simpan data dir seed di `$TMPDIR`.

### C15. Screenshot terang/gelap, otomatisasi browser, dan sitemap: terlalu banyak untuk satu landing

- **Severity:** OVER · **Area:** rencana kerja / UI
- **Klaim di PLAN:** §5.8 gambar `{overview-m,sites-d,health-d,services-m}-{light,dark}.webp` (8 file), `og.png`, dibuat ulang setiap UI berubah; §3.3 `/sitemap.xml`.
- **Masalah:** Delapan screenshot dengan dua tema harus dibuat ulang setiap halaman yang difoto berubah, oleh worker yang butuh izin
  browser automation. Biaya perawatan ini akan membuat screenshot cepat basi (Risiko 7). Hero sudah memakai satu gambar untuk kedua
  tema, jadi logika "tema lain tidak diunduh" hanya menambah kerumitan. `sitemap.xml` berisi satu URL yang sudah bisa ditemukan
  crawler dari `/`.
- **Usulan:** Cukup 4 screenshot terang (hero + 3 galeri) yang dibingkai bezel, dipakai di kedua tema. `og.png` adalah gambar statis
  yang di-commit (bukan pipeline generator). Hapus `/sitemap.xml` dan baris `Sitemap:`. Tambahkan kembali bila suatu saat ada lebih dari satu halaman publik.

### C16. SEO dan 404: detail yang salah atau belum ditulis

- **Severity:** MINOR · **Area:** kontrak
- **Klaim di PLAN:** §3.6 `robots.txt` (Disallow `/login`, `/profile`, …) + `noindex` di path yang sama; K16 status 404; `pageCspCache` per varian; Q2.
- **Masalah:** (1) Disallow menghalangi crawler membaca `noindex`, sehingga URL yang ditaut dari luar tetap bisa muncul di indeks
  tanpa konten. Ini anti-pola yang didokumentasikan Google. (2) `index.ts:125-126` meneruskan `page.status` dari fetch internal, termasuk
  **304** bila browser mengirim `If-None-Match`. Varian HTML yang ditulis ulang memakai ETag yang sama dengan `/__spa`, sehingga revalidasi
  bisa menjawab 304 untuk isi yang berbeda, dan jalur 404 harus menang atas 304. (3) Canonical per instance itu sah. Q2 sebaiknya ditutup
  dengan default "canonical ke diri sendiri", tanpa konstanta `PRODUCT_HOME_URL` (YAGNI).
- **Usulan:** `robots.txt` cukup `Disallow: /api/`. Path privat cukup memakai `X-Robots-Tag: noindex`. Di `/*`: hapus `ETag` dan
  `Last-Modified` dari respons yang ditulis ulang (atau jangan teruskan `If-None-Match` ke fetch internal), lalu pakai status dari
  `pageHead`. Test: `/xyz` dengan `If-None-Match` tetap 404.

### C17. Workflow rilis: tidak ada yang menaikkan versi, aset bentrok dengan PLAN/04, dan test shell tidak jalan di CI

- **Severity:** MAJOR · **Area:** rencana kerja / distribusi
- **Klaim di PLAN:** §3.7 `release.yml` langkah 1-8; K12; §7 `wkr-adm-dist-01` (`package.json` "hanya `license`"); Q3.
- **Masalah:** (1) `package.json` masih `0.2.1`. Gerbang "tag = `v` + `package.json.version`" dan "CHANGELOG punya `## [0.3.0]`" akan
  gagal untuk `v0.3.0`, karena tidak ada worker yang memiliki kenaikan versi (`wkr-adm-docs-01` hanya menulis CHANGELOG). (2) PLAN/04
  K19 menulis workflow yang sama dengan `attest-build-provenance`, aset mentah `panel-android-arm64` + `SHA256SUMS` (PLAN/04:862), dan
  `ci.yml`. PLAN/05 memakai tarball `panel-termux-android-arm64.tar.gz` + `install.sh` + `actions/attest`. (3) `bun test` tidak
  menjalankan `scripts/*.test.sh` (install-phone, install-release, package-release). (4) Test baru pertama kali jalan di Linux saat tag
  dibuat, sehingga kegagalan khusus Linux baru ketahuan di momen rilis.
  Terverifikasi: cross-compile di `ubuntu-latest` bisa jalan. `@oven/bun-linux-aarch64-android@1.4.2` ada di npm (runtime target
  diunduh terlepas dari host; di Mac lokal sudah ada di cache `~/.bun/install/cache/bun-linux-aarch64-android-v1.4.2`), dan
  `bun-plugin-tailwind@0.1.2` membawa `tailwindcss-oxide.linux-x64-gnu.node`. `actions/attest` v4.2.2 memang memerlukan
  `artifact-metadata: write` (README actions/attest), dan repo `makurosolusi/panel-termux` PUBLIC, jadi attestation tersedia.
  `bun audit --audit-level=high` ada di Bun 1.4.2.
- **Usulan:** Pemilik `release.yml` cukup satu (PLAN/05, karena format aset mengikuti `install.sh`). PLAN/04 me-review dan memiliki
  `ci.yml`. Kontrak aset ditulis sekali di PLAN/05 §3.7, dan PLAN/04 §862 diperbarui ke tarball. `wkr-adm-docs-01` menaikkan
  `package.json` ke `0.3.0` bersama entri CHANGELOG. Tambahkan langkah `sh scripts/install-phone.test.sh && sh scripts/install-release.test.sh`
  dan `workflow_dispatch` dengan input `dry_run` (semua langkah kecuali `gh release create`) untuk uji coba sebelum tag pertama.

### C18. "Terakhir aktif" dan "Aktif 3 mnt lalu" bisa meleset sampai 24 jam

- **Severity:** MINOR · **Area:** data / UI
- **Klaim di PLAN:** K9 `max(session.updated_at)`, F8 sesi "Aktif 3 mnt lalu", F5 kolom Terakhir aktif.
- **Masalah:** Better Auth memperbarui `session.updated_at` paling sering sekali per `updateAge`, yang default-nya 86400 dtk
  (`better-auth/dist/context/create-context.mjs:147`), dan `auth.service.ts` tidak mengubahnya. Pengguna yang aktif sepanjang hari bisa
  tampil "Aktif 23 jam lalu". Fallback `auth.sign_in` juga bisa hilang bila PLAN/04 menerapkan retensi audit.
- **Usulan:** Teksnya ditulis jujur dengan resolusi hari ("Aktif hari ini" / "kemarin" / tanggal), atau beri label "Sesi diperbarui".
  Jangan tambah kolom baru (sesuai K9). Catat di §8 bahwa fallback bergantung pada retensi audit PLAN/04.

### C19. Onboarding: `app_meta` sudah tepat, tapi level item dan dependensi belum lengkap

- **Severity:** MINOR · **Area:** data / flow
- **Klaim di PLAN:** K6, §3.1 `SetupLevel`, F1 "2 dari 6 selesai", item `apps_json`.
- **Masalah:** Menyimpan status di `app_meta` **tanpa migrasi** memang sah: tabelnya key/value `text` dengan PK `key`
  (`app-meta.schema.ts:4-7`), upsert-nya idempoten seperti `migrate.ts:44-46`, dan ikut terbawa di cadangan `panel.db`. Yang kurang:
  (1) level per item tidak ditulis, sehingga "6" tidak bisa diturunkan dari spesifikasi. (2) Item `apps_json` bergantung pada integrasi
  pm2 yang hasil eksperimennya di POCO masih tertunda (keputusan pemilik), jadi bisa berubah bentuk. (3) Penamaan `partial` bentrok:
  di `SetupItem` artinya "tersimpan tanpa run sukses", di `checks.backup` artinya run terakhir `partial`.
- **Usulan:** Tulis level eksplisit: `access`, `secret_saved`, `backup` = wajib; `cloudflare_token`, `apps_json`, `first_site` = disarankan;
  `admins` = opsional. Beri tanda [DEP hasil eksperimen pm2] pada `apps_json`. Ganti nama field `SetupItem.partial` menjadi `needsFirstRun`.

### C20. Pemetaan error login: kode yang dipakai benar, tapi `error_description` perlu dijaga

- **Severity:** MINOR · **Area:** keamanan / UI
- **Klaim di PLAN:** F10 langkah 2, `loginErrorMessage` 3 kelompok.
- **Masalah:** Kode yang dirujuk memang ada di Better Auth 1.7.28. `state_not_found` dan `invalid_callback_request` ada di
  `api/routes/callback.mjs`, `state_mismatch` di `state.mjs:99-144` dan `oauth2/state.mjs:57`, dan `access_denied` diteruskan dari Google
  lewat `redirectOnError(error, error_description)` (`callback.mjs:87`). Kode lain yang mungkin muncul: `no_code`, `internal_server_error`,
  `unable_to_get_user_info`, `email_not_found`, `unable_to_link_account`, `oauth_provider_not_found`, `no_callback_url`. Callback juga
  menambahkan `error_description` dari provider ke URL (`callback.mjs:83`). Teks itu dikendalikan pihak luar, jadi bisa dipakai untuk
  phishing bila ditampilkan.
- **Usulan:** Kode lain dipetakan ke generic (sudah benar). Tambahkan aturan eksplisit di §5.7: `error_description` tidak pernah
  dirender. Test: `?error=access_denied&error_description=<teks>` tidak menampilkan `<teks>`.

### C21. Pemilik `LogViewer` salah disebut

- **Severity:** MINOR · **Area:** kontrak
- **Klaim di PLAN:** §1.3, F7, §5.4 "`LogViewer` dari PLAN/02 [DEP]".
- **Masalah:** PLAN/01 yang memiliki `LogViewer` (PLAN/01:34). PLAN/02 hanya mengonsumsinya (PLAN/02:39, 541).
- **Usulan:** Ganti semua [DEP PLAN/02] untuk `LogViewer` menjadi [DEP PLAN/01] dan pindahkan ke prasyarat gelombang 2.

### C22. Kriteria penerimaan UI belum menguji jalur Access yang sebenarnya

- **Severity:** MINOR · **Area:** test
- **Klaim di PLAN:** §6.3 dan §6.4.
- **Masalah:** Semua UI-QA dijalankan di build lokal tanpa Access, sehingga C1 dan C8 lolos QA lalu gagal di produksi. §6.4 berhenti
  di "isi `.env`", sehingga instalasi yang benar-benar sampai panel menyala tidak pernah diuji.
- **Usulan:** Tambahkan ke §6.4 (setelah merge, di HP uji, sesuai izin eksperimen POCO): instal bersih dari rilis sampai
  `panel healthy`, login dengan akun non-pemilik (melihat kartu "belum punya akses"), dan promosi ke Admin + menambah email di Access
  (bisa membuka `/panel`).

---

## 3. Hal yang sudah baik

- K1/K2: teks pengaturan pindah ke web dengan `satisfies Record<SettingKey,…>`. Kelengkapannya dijamin compiler dan hanya ada satu sumber copy.
- Status "Bawaan" hanya bila `default !== null` (G8), dan GET pengaturan tidak pernah 500 karena rahasia tak terbaca.
- Pemisahan tamu: path privat diarahkan ke `/login`, path tak dikenal mendapat 404 publik sungguhan, dan pengguna login tetap melihat 404 di dalam shell. README diperbarui, kode tidak dipaksa mengikuti README lama.
- Instal dua langkah (unduh, baca, jalankan) dengan `sha256sum -c`, `trap` pembersih, cek arsitektur sebelum unduh, dan test berbasis stub yang mengikuti `install-phone.test.sh`.
- `release.yml`: izin per job, pin SHA, tanpa cache, `persist-credentials: false`, gerbang CHANGELOG, dan `bun audit` high. Semuanya terverifikasi masuk akal.
- Kartu `user` yang konkret ("kirim email ke pemilik, lalu muat ulang"), serta tier konfirmasi yang proporsional (promosi `confirm`, hapus `typed`).
- Landing di chunk awal kecil dengan probe `splitting` yang benar-benar dijalankan, dan anggaran ukuran gambar dan JS yang terukur.
- Daftar Keterbatasan yang jujur di landing (CPU% per proses, putus domain beberapa detik, panel tidak bisa memberi tahu bila dirinya mati).

## 4. Pertanyaan yang hanya bisa dijawab pemilik

1. **C1:** Boleh `/profile` dikeluarkan dari daftar path Access? Usul: ya. Isinya hanya akun sendiri, dan API-nya sudah publik di balik login Google.
2. **C6:** Instance tanpa cadangan atau tanpa Access: cukup tampil sebagai informasi tanpa menurunkan vonis "Sehat"? Usul: ya. Peringatan keamanan tetap muncul sebagai masalah merah PLAN/04.
