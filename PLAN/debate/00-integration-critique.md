# Kritik integrasi lintas PLAN (01–05)

> wkr-critic-x · 2026-11-26 · branch `feature/production-polish` @ caa4308. Kritikus integrasi: bukan menilai mutu per
> domain, tetapi apakah lima PLAN bisa dirakit menjadi **satu urutan build** tanpa bentrok kontrak, file, dan migrasi.
> Semua PLAN dibaca penuh. Klaim kode dicek ke HEAD. Satu pengukuran baru: binary `--compile` lokal dibangun di
> scratchpad lalu di-probe dengan `curl` (lihat X5). Merge `main` → branch diuji kering dengan `git merge-tree` (X15).

---

## 1. Ringkasan penilaian

**Verdict: perlu ditulis ulang di bagian "Rencana kerja" kelima PLAN (§7), dan ada revisi kontrak di §3 masing-masing.**
Per domain, isi PLAN umumnya kuat. Gabungannya belum bisa dijalankan. Enam file atau kontrak dimiliki dua sampai lima
worker pada gelombang yang sama (`settings.service.ts`, `src/server/index.ts`, `dev.types.ts`, `drizzle/`,
`release.yml`, `log.types.ts`). Dua endpoint dibangun dua kali dengan bentuk berbeda (uji S3, cabut sesi pengguna). Satu
kontrak tidak punya pelaksana karena PLAN-04 bersandar pada pengukuran yang salah (header cache aset). Total ruang
lingkupnya sekitar 20.000 baris diff dan sekitar 43 worker. Untuk rilis publik pertama v0.3.0 itu terlalu besar.

Jumlah temuan: **BLOCKER 6 · MAJOR 12 · MINOR 10 · OVER 2**. §5 berisi jadwal global yang bisa langsung dipakai
koordinator. Isinya satu pemilik per file per gelombang, migrasi bernomor 0006–0008, dan pemangkasan ke inti v0.3.0
(sekitar 11–12 ribu baris, sekitar 24 worker).

---

## 2. Tabel kontrak lintas PLAN

Kolom "Cocok?": ✅ sama persis · ⚠️ beda nama/bentuk kecil · ❌ bertentangan atau tak ada pemilik.

| #   | Kontrak                                          | Produsen (PLAN §)                                                                                                                                                                                             | Konsumen                                                                                                                                                                                               | Cocok? | Masalah                                                                                                                                                        |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K01 | `LogLine` (`src/shared/log.types.ts`)            | 01 §3.4 **dan** 02 §3.3 (dua-duanya "baru")                                                                                                                                                                   | 01 LogViewer, 02 log API, 03 app-log, 05 /dev/logs                                                                                                                                                     | ❌     | 01 punya `stream?`, 02 tidak. File dibuat oleh `wkr-shell-foundation-01` (01 §7 1a) **dan** `wkr-mon-types-00` (02 §7 G0)                                      |
| K02 | Respons endpoint log                             | 02 §3.3 `LogChunk {lines,cursor,reset,truncated}`                                                                                                                                                             | 01 §7 dep 2 "mengembalikan `LogLine[]`"                                                                                                                                                                | ❌     | 01 mengira array polos. 03 `AppLogTail.lines: string[]` (03 §3.1:332), padahal 01 dep 3 minta `LogLine[]`                                                      |
| K03 | Parser timestamp svlogd                          | 01 §3.4 `src/shared/log.time.ts splitLogTimestamp`                                                                                                                                                            | 02 §5.8 `log.parse.ts` (parser sendiri)                                                                                                                                                                | ❌     | Dua parser. Versi 02 menempel pecahan mentah (`.23463Z`, 5 digit) ke ISO. 01 memotong ke milidetik (lebih aman untuk `Date.parse`)                             |
| K04 | Props `LogViewer`                                | 01 §3.4 (`live{on,onChange}`, `streams`, `empty`, `size`)                                                                                                                                                     | 02 §3.9 (`following`, `onFollowChange`, `newCount`, `toolbarStart`, `maxLines`, `emptyText`); 05 §F7 menyebut "LogViewer dari PLAN/02"                                                                 | ❌     | Dua daftar props. Pemilik tercatat beda (05 mengira 02). Perilaku gulir-ke-atas juga beda: 01 = unpin, polling jalan terus; 02 §4.5.3 = "follow mati otomatis" |
| K05 | Hook follow log                                  | 02 §3.9 `src/web/panel/use-log-follow.ts`                                                                                                                                                                     | 05 /dev/logs                                                                                                                                                                                           | ⚠️     | Ada di folder domain 02, padahal 05 juga butuh. `/dev/logs` tidak punya cursor (`DevLogs` tetap, 05 §3.3)                                                      |
| K06 | `useApiQuery` signature                          | 01 §3.5 `(url, refreshMs?, {enabled})`                                                                                                                                                                        | 02 §3.9 `(url, {refreshMs, pauseHidden})`                                                                                                                                                              | ⚠️     | Pakai versi 01 (kompatibel 20 pemanggil). `pauseHidden` sudah jadi perilaku bawaan                                                                             |
| K07 | `DataTable` aksi baris                           | 01 §3.3 `actions`                                                                                                                                                                                             | 02 §3.9, 03 §5 `rowActions`; 02 `columns[].hidden`, `error`                                                                                                                                            | ⚠️     | Nama beda. `error` sudah dihapus 01. `hidden` cukup dengan memfilter array kolom (YAGNI)                                                                       |
| K08 | `ConfirmAction` tier                             | 01 §3.2 `tier?: "confirm" \| "typed"`                                                                                                                                                                         | 02/03/05 menulis `none\|confirm\|typed`                                                                                                                                                                | ⚠️     | "none" bukan tier komponen. Tidak masalah, tetapi spec worker harus pakai nama 01                                                                              |
| K09 | `StatusKey` untuk job/deploy                     | 01 §3.1 (23 kunci; `rolled_back` danger "Gagal, dibatalkan"; `running`→"Diproses…")                                                                                                                           | 03 §3.1 `JobStatus/DeployStatus` + `interrupted`; 03 §5.5/§7 minta `rolled_back` **warning "Dikembalikan"**, `interrupted` "Terputus"                                                                  | ❌     | `interrupted` tak ada di kamus. Nada & label `rolled_back` berlawanan dengan 01 D3                                                                             |
| K10 | Label status layanan/app                         | 01 §3.1 (`down`→"Mati", `finish`→"Memulai ulang…" warning, `launching` warning)                                                                                                                               | 02 §5.6 ("Mati tak terduga", "Sedang berhenti", `launching` **info**)                                                                                                                                  | ❌     | 02 menulis tabel kosakata sendiri di `id.panel`, padahal itu yang dilarang D1                                                                                  |
| K11 | Verdict domain                                   | 01 §3.1 `domainHealthKey` (4xx→`attention` warning)                                                                                                                                                           | 02 §5.4 `domainVerdict` di `panel.status.ts` (401/403 "Butuh login" **info**, "Tidak stabil", "Tunnel terputus", "Aplikasi dihentikan", wildcard)                                                      | ❌     | Tabel kedua dengan kunci yang tidak ada di `StatusKey`                                                                                                         |
| K12 | `BackupSummary` → kunci                          | 01 §3.1 (6 nilai)                                                                                                                                                                                             | 04 §3.1 `BackupStatus.keyMismatch`, `restoring`, `BackupRestoreStatus`                                                                                                                                 | ⚠️     | Tidak ada kunci untuk "kunci data tidak cocok" atau status pemulihan                                                                                           |
| K13 | `ProblemCode`/`ProblemKind`                      | 02 §3.1 (19 kode, kind tanpa `security`)                                                                                                                                                                      | 04 §3.7 `backup_item_stale`, `key_mismatch`, `access_not_seen`, kind `security`; 03 §7 `site_job_failed {jobId,kind,status}`, hapus `site_crash_loop`                                                  | ❌     | Union 02 tidak memuat kode 04. Params `site_job_failed` hanya ditulis di 03                                                                                    |
| K14 | Aturan masalah cadangan                          | 02 §3.1 (`backup_*` di `overview.problems.ts`)                                                                                                                                                                | 04 §3.5/§3.7 `backup.problems.ts backupProblems()` + `securityProblems()`                                                                                                                              | ❌     | Aturan yang sama ditulis di dua file milik dua worker                                                                                                          |
| K15 | Notifikasi cadangan                              | 02 K11 (rekonsiliasi `problem_event`, "jangan buat kanal kedua")                                                                                                                                              | 04 §3.7 `notify({type: backup.failed\|partial\|recovered\|security.key_mismatch})` + `backup.events.ts`                                                                                                | ❌     | 02 tidak punya API `notify`. `recovered` sudah otomatis jadi "PULIH" saat `backup_failed` tertutup                                                             |
| K16 | Kunci setting Telegram                           | 02 §3.6 `alerts.*`, `monitor.sample_interval_sec`                                                                                                                                                             | 05 §3.1/§3.5 `notify.*`                                                                                                                                                                                | ❌     | Namespace beda                                                                                                                                                 |
| K17 | Uji kirim Telegram                               | 02 §3.7 `POST /api/dev/alerts/test` → `{ok:true,sentAt}`, error 502 `<code>`                                                                                                                                  | 05 §3.3 `POST /api/dev/notify/telegram/test` → `{ok,code,detail}` 200                                                                                                                                  | ❌     | Path & bentuk beda. 05 K4 menguji nilai tersimpan, 02 §4.7 juga (cocok)                                                                                        |
| K18 | Menyimpan setting                                | 05 K3 `PATCH /api/dev/settings` batch; `PUT /:key` dihapus                                                                                                                                                    | 02 §4.7 langkah 1 memakai `PUT /api/dev/settings/alerts.telegram_bot_token`; `tests/csrf.origin.test.ts` (main) memakai `PUT /api/dev/settings/sites.dir`                                              | ❌     | Flow 02 dan test hotfix di main bergantung pada endpoint yang dihapus 05                                                                                       |
| K19 | Label setting                                    | 05 K1 (label pindah ke `src/web/i18n/id.settings.ts`)                                                                                                                                                         | 02 §3.6 & 04 §5.3 `settings:` menulis label untuk registri server                                                                                                                                      | ⚠️     | 02 sudah mengantisipasi ("bila PLAN/05 memindah label…"). Spec worker harus tegas: tidak ada label di server                                                   |
| K20 | Uji koneksi S3                                   | 04 §3.4/F6 `POST /api/dev/backup/test`, body `BackupTestInput` (nilai **belum** disimpan), langkah write/read/**list**/delete, `BackupTestResult{ok,steps[],ms}`, audit `backup.test`, file `backup.probe.ts` | 05 §3.3/K4/K5 `POST /api/dev/backup/verify`, tanpa body (nilai **tersimpan**), write/read/delete, `BackupVerify{ok,code,failedStep,ms,detail}`, audit `backup.verify`, file `backup.verify.ts`         | ❌     | Endpoint, tipe, file, semantik, dan aksi audit dobel. Dua worker (04 `wkr-backup-engine`, 05 `wkr-adm-server-01`) akan membangun dua-duanya                    |
| K21 | Cabut sesi satu pengguna                         | 04 §3.4 `POST /api/dev/users/:id/sessions/revoke` → `RevokedSessions`, 409 hanya untuk diri sendiri, audit `session.revoke_all`                                                                               | 05 §3.3 path sama → `DevUserRevokeSessions`, 409 juga untuk super admin env, audit `session.revoke {scope:"all"}`                                                                                      | ❌     | Satu route ditulis dua worker dengan aturan & audit berbeda                                                                                                    |
| K22 | `DevAuditEntry`                                  | 04 §3.1 (datar: `actor: UserRef\|null`, `actorKind`, `actorLabel`, `actorEmail`, `actorDeleted`, `requestId`)                                                                                                 | 05 §3.1 (union `actor.kind: user\|deleted\|system`, `targetLabel`)                                                                                                                                     | ❌     | 05 bersedia ikut 04 (A3). `targetLabel` tidak dihasilkan siapa pun                                                                                             |
| K23 | `AuditAction` + filter                           | 04 §3.6 (milik `audit.service.ts`)                                                                                                                                                                            | 05 §5.4 butuh union diekspor ke `src/shared` + `setup.update`, `backup.verify`, `session.revoke`; 05 F6 `?action=` berulang (OR); 02 `log.download`, `meta.confirmTyped`; 03 `site.adopt`, aksi upload | ⚠️     | 04 hanya menerima satu `action` (+`from/to`). Aksi PLAN lain "ditambah di gelombang berikutnya", jadi `audit.service.ts` disentuh berulang                     |
| K24 | Deteksi Cloudflare Access                        | 04 K18 `accessSeen.at` di `api.handler.ts` + `SecurityStatus.access` + masalah `access_not_seen`                                                                                                              | 05 K7 membaca header pada request `/api/dev/setup` itu sendiri + cek `access` di `/dev/health`                                                                                                         | ❌     | Dua sumber kebenaran dengan semantik beda (05: "request ini" vs 04: "kapan pun sejak boot")                                                                    |
| K25 | Status kunci data / setting tak terbaca          | 04 K8 `data-key.service dataKeyState().unreadable`, `KeyMismatchError`                                                                                                                                        | 05 §3.1 `DevSetting.readable`, cek `settings_readable`                                                                                                                                                 | ⚠️     | Fakta yang sama, perlu satu fungsi (04) yang dibaca 05                                                                                                         |
| K26 | Item onboarding "kunci data disimpan"            | 04 F9.3 "selesai bila `exportedAt !== null`"                                                                                                                                                                  | 05 F1.4 "klik unduh **tidak** otomatis mencentang"                                                                                                                                                     | ❌     | Bertentangan                                                                                                                                                   |
| K27 | Cadangan terakhir per DB                         | 04 `BackupStatus.lastGood`                                                                                                                                                                                    | 02 `DatabaseInfo.lastBackupAt` (dari `backup_run.items`); 03 §7 `lastSuccessfulBackupOf(database)`                                                                                                     | ⚠️     | Tiga nama untuk satu kueri. Cukup satu fungsi repo milik 04                                                                                                    |
| K28 | Kunci job untuk kontrol                          | 03 D26 `jobs.isLocked({kind,name})`, `jobs.active()`                                                                                                                                                          | 02 §3.7 (nama "final dari PLAN/03")                                                                                                                                                                    | ✅     | Cocok. Tambahkan `restoring` 04 ke daftar yang menolak restart `panel` (lihat X23)                                                                             |
| K29 | Adapter sistem (`Pm2Proc`, `httpStatus`, pg/tar) | 02 §3.5 (adapter G1)                                                                                                                                                                                          | 03 §3.7 (`cwd`,`execPath`,`args`,`startedAtMs`,`httpStatus(port,path,timeout)`); 04 §3.5 (`dumpGlobals`, `verifyDump`, `restoreInto`, `dropDatabase`, `ArchiveAdapter`)                                | ❌     | `system.types.ts`/`system.fake.ts` dipegang 02 G1 **dan** 04 G2 (`wkr-backup-engine`)                                                                          |
| K30 | Header cache aset                                | 01 §3.12 (kontrak, "diimplementasikan PLAN-04")                                                                                                                                                               | 04 K17 "tidak diubah, Bun sudah benar"                                                                                                                                                                 | ❌     | Tak ada pelaksana. Pengukuran 04 salah untuk binary (X5)                                                                                                       |
| K31 | `/__spa`                                         | 01 §3.12 → 404                                                                                                                                                                                                | 04 K16 → path acak, path lama jatuh ke `/*` (200 HTML + CSP); 05 §3.6 `isKnownSpaPath` → 404                                                                                                           | ⚠️     | Jadi konsisten kalau 05 masuk: `/__spa` bukan root yang dikenal → 404                                                                                          |
| K32 | Tamu di URL tak dikenal                          | 01 §3.13 (router `*` di root, `PublicNotFound`, `resolveRedirect`)                                                                                                                                            | 05 K16/F11 (sama + status HTTP 404 server) + `wkr-adm-routing-01` & `public-not-found.page.tsx`                                                                                                        | ❌     | Pekerjaan klien dikerjakan dua kali (01 1c dan 05 G2/G3). File `router.tsx`, `session.redirect.ts`, `public-not-found.page.tsx` punya dua pemilik              |
| K33 | `roles.ts`                                       | 01 §3.13 `isProtectedPath`                                                                                                                                                                                    | 05 §3.6 `SPA_ROOTS`, `isKnownSpaPath`                                                                                                                                                                  | ⚠️     | Dua worker di satu file kecil. Gabungkan di satu tempat                                                                                                        |
| K34 | Formatter murni ke shared                        | 02 §3.9 minta `src/shared/format.id.ts`                                                                                                                                                                       | 01 §3.10 (pemilik `format.ts`, tidak menyebutnya)                                                                                                                                                      | ⚠️     | Belum masuk spec 01                                                                                                                                            |
| K35 | Aset rilis & attestation                         | 04 K19 (`panel-android-arm64` + `SHA256SUMS`, `actions/attest-build-provenance`, `ci.yml`, `dependabot.yml`)                                                                                                  | 05 K12 (`panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`, `actions/attest@v4`)                                                                                                          | ❌     | Nama aset menentukan URL `releases/latest/download/<nama>` di landing & README. `release.yml` dipegang 04 G3 **dan** 05 G1                                     |
| K36 | Snapshot sebelum upgrade                         | 04 K9 (di **boot**, alternatif "di `install-phone.sh`" ditolak)                                                                                                                                               | 05 F9.4 "[DEP PLAN/04] snapshot dijalankan di `install-phone.sh`"                                                                                                                                      | ❌     | Bertentangan. 05 tidak boleh mengandalkan skrip                                                                                                                |
| K37 | `install-phone.sh`                               | – (tidak ada di tabel kerja PLAN mana pun)                                                                                                                                                                    | 03 §4.12 `sv -w 130 restart panel` + template ecosystem; 04 §7 rollback hint; 05 F9 dipanggil `install-release.sh`                                                                                     | ❌     | Tak ada pemilik (X13)                                                                                                                                          |
| K38 | Heartbeat proses latar                           | 05 K21 `heartbeat.ts beat()`                                                                                                                                                                                  | 02 sampler (sudah punya `sampledAt`), 04 `backup.service.ts`                                                                                                                                           | ⚠️     | 05 menyisipkan baris di file dua PLAN lain                                                                                                                     |
| K39 | `ApiError` status/extra                          | 03 §3.4 (tambah 507 + `extra`)                                                                                                                                                                                | 04 butuh 410 `pruned`, 421 `wrong_host`; 02 butuh 503/429 + `retryAfterSec`                                                                                                                            | ⚠️     | `http.error.ts` hanya dipegang 03 G1. Union statusnya harus mencakup kebutuhan semua PLAN                                                                      |
| K40 | Request log                                      | 02 K16 (GET < 400 → `debug`)                                                                                                                                                                                  | 05 §7 minta `QUIET_PATHS` untuk `/api/me`, `/api/dev/logs`, `/api/dev/health`                                                                                                                          | ✅     | Aturan 02 sudah mencakup kebutuhan 05. Hapus permintaan `QUIET_PATHS` dari 05                                                                                  |
| K41 | Interval polling                                 | 01 §3.5 (acuan)                                                                                                                                                                                               | 02 §5.9, 03 §4.5 (1 dtk + backoff khusus), 04 §5.1 (3 dtk), 05 F2 (15 dtk)                                                                                                                             | ⚠️     | Angka cocok. Hanya backoff khusus 03 yang bentrok dengan P4 (X19)                                                                                              |
| K42 | Default `panel.protected_services`               | 02 K13 (`sshd,cloudflared,panel,pm2,postgres`, `lockout` panel/cloudflared)                                                                                                                                   | 01 §3.2, 05 §F3.6                                                                                                                                                                                      | ✅     | Cocok. Catatan: nilai yang sudah tersimpan di POCO tidak ikut berubah (02 K13). Perlu dicek di POCO                                                            |

---

## 3. Temuan

### X1 — `release.yml` dimiliki dua PLAN, dan nama asetnya berbeda

- **Severity**: BLOCKER · **Area**: kontrak / rencana kerja
- **Klaim di PLAN**: 04 §7 `wkr-release-ci` (gelombang 3) memegang `.github/workflows/release.yml`, `ci.yml`,
  `dependabot.yml`. 04 §7 menyebut "nama aset rilis `panel-android-arm64` + `SHA256SUMS`" dan K19 memakai
  `actions/attest-build-provenance`. 05 §7 `wkr-adm-dist-01` (gelombang 1) memegang file yang sama. 05 K12 menetapkan aset
  `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS` dan memakai `actions/attest@v4`.
- **Masalah**: dua worker menulis satu file di gelombang berbeda dengan isi yang saling menimpa. URL di landing dan README
  (`releases/latest/download/install.sh`) hanya jalan bila aset bernama persis seperti yang diharapkan `install-release.sh`.
  Kalau 04 menulis ulang workflow di gelombang 3, perintah instal di landing langsung 404. Pilihan action attestation
  juga beda. Kedua penulis menyebutnya "diverifikasi saat implementasi", tetapi hanya 05 yang mengklaim [VERIF].
- **Usulan**: satu pemilik, yaitu PLAN-05 (`wkr-dist-01`, gelombang W1), untuk `release.yml`, `package-release.sh`,
  `install-release.sh`, dan `LICENSE`. PLAN-04 memegang `ci.yml` + `dependabot.yml` dan melakukan **review** keamanan
  `release.yml` (pin SHA, izin per job, tanpa cache), tanpa mengeditnya. Nama aset final = versi 05. Teks 04 §7 "nama
  aset rilis `panel-android-arm64`" dihapus. Sebelum menulis, cek sekali versi action attestation di repo `actions/attest`
  dan `actions/attest-build-provenance` (Rule 20).

### X2 — `src/shared/dev.types.ts` punya dua pemilik di gelombang 1, dan bentuk `DevAuditEntry` berbeda

- **Severity**: BLOCKER · **Area**: kontrak / rencana kerja
- **Klaim**: 04 §7 gelombang 1 `wkr-safety-audit` memegang `src/shared/dev.types.ts` (memperluas `DevAuditEntry`). 05
  §7 gelombang 1 `wkr-adm-server-01` memegang file yang sama (`DevHealth`, `SETTING_KEYS`, `DevSetting`, `DevUser`,
  setup). 05 §3.1 juga mendefinisikan `DevAuditEntry` versi union.
- **Masalah**: dua worker paralel di satu file berarti saling menimpa (Rule 23). Bentuk audit tidak sama (lihat K22).
  `targetLabel` versi 05 tidak dihasilkan server mana pun.
- **Usulan**: semua tipe shared baru atau yang berubah ditulis **satu worker kontrak di W0** (lihat §5). `DevAuditEntry`
  memakai bentuk 04 (datar). `describeAudit` 05 memetakan `actorKind/actorDeleted` → "Sistem" / "{label} (terhapus)".
  `targetLabel` dihapus; label target diturunkan klien dari `action` + `target` (email ada di `actorEmail`, nama setting
  dari `id.settings`).

### X3 — `settings.service.ts` disentuh tiga PLAN sekaligus; endpoint `PUT` dihapus padahal masih dipakai

- **Severity**: BLOCKER · **Area**: kontrak / rencana kerja
- **Klaim**: 05 K1/K3 (G1): restrukturisasi registri, hapus `label/description`, `PATCH` batch, hapus
  `PUT /api/dev/settings/:key`. 04 §7 G1 `wkr-safety-keys`: menambah 4 key + `KeyMismatchError` di file yang sama, di
  gelombang yang sama. 02 §7 G2 `wkr-mon-api-02`: menambah 6 key `alerts.*`/`monitor.*` + label server. 05 §3.1 menulis
  `notify.*` untuk Telegram, 02 menulis `alerts.*`.
- **Masalah**:
  1. 04 dan 05 sama-sama di G1 pada satu file berarti bentrok.
  2. Namespace Telegram berbeda (K16), jadi `satisfies Record<SettingKey,…>` di web 05 tidak akan cocok dengan
     registri 02.
  3. 02 §4.7 langkah 1 memakai `PUT …/settings/alerts.telegram_bot_token`, endpoint yang dihapus 05.
  4. Test hotfix di main `tests/csrf.origin.test.ts` mencantumkan `["PUT", "/api/dev/settings/sites.dir"]` di
     `MUTATIONS`. Setelah PUT dihapus, route itu 404, sehingga test yang mengharapkan 401 setelah lolos guard akan gagal.
     Atau lebih buruk: ada yang "memperbaikinya" dengan menghapus kasus itu dan cakupan CSRF untuk `/api/dev/settings`
     hilang.
- **Usulan**: satu worker `wkr-settings-01` di W1 memegang `settings.service.ts` + rute settings di `dev.routes.ts`.
  Worker ini mengerjakan sekaligus struktur 05, **semua** key baru (02: `alerts.telegram_bot_token`,
  `alerts.telegram_chat_id`, `alerts.enabled`, `alerts.min_severity`, `monitor.sample_interval_sec`, default baru
  `panel.protected_services`; 04: `backup.keep_min_runs`, `backup.include_secrets`, `backup.max_item_mb`,
  `audit.retention_days`), dan `KeyMismatchError`. Namespace final = **`alerts.*`** (02 memiliki mesinnya). Semua label
  ada di `id.settings.ts` (05). Teks Indonesia yang sudah ditulis 02 §3.6 dan 04 §5.3 disalin ke spec worker i18n.
  `MUTATIONS` di `csrf.origin.test.ts` diganti `["PATCH", "/api/dev/settings"]` oleh worker yang sama.

### X4 — Uji koneksi S3 dibangun dua kali

- **Severity**: BLOCKER · **Area**: kontrak / fitur
- **Klaim**: lihat K20 (04 `POST /api/dev/backup/test` vs 05 `POST /api/dev/backup/verify`).
- **Masalah**: dua endpoint, dua tipe, dua file, dua aksi audit, dan semantik berlawanan (04 menguji nilai form yang
  belum disimpan, 05 K4 menguji nilai tersimpan). UI Pengaturan (05) hanya bisa memakai satu. Langkah `list` versi 04
  justru tidak dibutuhkan, karena retensi 04 K3 sengaja **tidak** pernah me-list bucket.
- **Usulan**: satu endpoint `POST /api/dev/backup/verify` dengan bentuk 05 (`BackupVerify`, nilai tersimpan, alasannya
  ada di 05 K4). Pemilik implementasi adalah worker mesin cadangan 04 (`src/server/backup/backup.verify.ts`), karena
  pemetaan error S3 dan `describe()` ada di sana. 05 hanya memakai. Hapus `BackupTestInput/BackupTestResult` dan aksi
  `backup.test` dari 04. Aksi audit final: `backup.verify`.

### X5 — Header cache aset tidak punya pelaksana; pengukuran PLAN-04 salah untuk binary

- **Severity**: MAJOR · **Area**: kontrak / fakta
- **Klaim**: 04 K17: "`/chunk-*.js|css` sudah dikirim Bun dengan `Cache-Control: public, max-age=31536000, immutable`…
  PLAN/01 tidak perlu mengerjakan R1-G14 opsi B". Bukti 04 berasal dari `NODE_ENV=production bun src/server/index.ts`
  (tanpa compile). 01 §3.12 menyerahkan implementasi ke 04.
- **Masalah**: saya mengukur binary yang benar-benar dirilis (`bun scripts/build.ts local <scratchpad>/panel`, HEAD ini,
  Bun 1.4.2), lalu menjalankannya di port 3987:
  - `/chunk-7cay9e9f.js` → `200`, `Content-Type: text/javascript`, `ETag`, **tanpa `Cache-Control`**, tanpa `nosniff`.
  - `/` → `200` **tanpa `Cache-Control`**.
  - `/chunk-zzzzzzzz.js` (chunk lama yang sudah tidak ada) → `200 text/html` (SPA), bukan 404.
  - `/__spa` → `200` tanpa CSP/XFO (R4-G12 terkonfirmasi juga di binary).

  Jadi temuan 01 benar dan 04 K17 salah untuk artefak produksi. Akibatnya kontrak 01 D13 tidak punya pelaksana. D12
  (reload sekali saat chunk gagal) tetap bekerja karena `import()` gagal MIME, tetapi Cloudflare akan menerapkan Browser
  Cache TTL bawaannya pada aset tanpa header.
- **Usulan**: 04 K17 dibatalkan. Implementasi tabel 01 §3.12 + `/__spa` + status 404/`noindex` 05 K16/K17 + host check
  04 K2 semuanya ada di **satu modul penyaji** `src/server/http/spa.serve.ts` (pindahan `servePanel`/`canonicalRedirect`
  dari `index.ts:73-131`), dipegang satu worker di W1 (§5). Test integrasi memakai binary hasil `build:local`, bukan
  `bun src/…`.

### X6 — `src/server/index.ts` disentuh lima PLAN di gelombang yang tumpang tindih

- **Severity**: BLOCKER · **Area**: rencana kerja
- **Klaim**:
  - 01 §7: PLAN-04 mengerjakan `index.ts` paralel dengan G1 01.
  - 02 §7 G2 `wkr-mon-sampler-02`: start/stop sampler, `bootId` di `/health`.
  - 03 §7: satu baris dari `wkr-sites-jobs-02` (`apps.json` saat start, `PANEL_PORT`).
  - 04 §7 G1 `wkr-safety-http`: urutan boot F7 (snapshot, kunci data, `panel_version`, `pruneAudit`), opsi
    `createApiHandler`.
  - 05 §7 G1 `wkr-adm-seo-01`: route SEO, `pageCspCache` per varian ("hanya bila PLAN/01 & 04 tidak menyentuhnya").
- **Masalah**: file 133 baris dengan dua tanggung jawab (boot dan penyaji HTTP) jadi titik bentrok untuk lima worker.
  "Satu baris" dari tiap PLAN tetap merupakan edit bersamaan di satu working tree.
- **Usulan**: pecah dulu menjadi `src/server/boot.ts` (isi `start()`), `src/server/http/spa.serve.ts` (penyaji), dan
  `index.ts` (re-export + `import.meta.main`, ≤ 30 baris). Pemilik per gelombang:
  - W1: `wkr-http-01` untuk `spa.serve.ts`.
  - W2: `wkr-boot-02` untuk `boot.ts`. Satu worker merangkai boot 04, `apps.json` 03, sampler + `bootId` 02, dengan
    fungsi yang sudah diekspor worker domain W2 lewat nama yang dikunci di spec.

  Kalau sampler belum siap di W2, rangkai di W3 (lihat §5).

### X7 — Migrasi: tiga PLAN menulis "00NN" dan dua pemilik `drizzle/` di gelombang 1

- **Severity**: BLOCKER · **Area**: data / rencana kerja
- **Klaim**: 02 §7 G1 `wkr-mon-store-01` memegang `drizzle/00NN_monitor.sql` + `drizzle/meta/*` + `migrations.js`. 04
  §7 G1 `wkr-safety-audit` memegang `drizzle/*`, dengan aturan "satu worker per gelombang memegang `drizzle/`". 03 §7 G1
  `wkr-sites-contract-01` memegang `drizzle/00NN_sites_lifecycle.sql` + meta. Ketiganya di **G1** masing-masing.
- **Masalah**: `drizzle-kit generate` menulis ulang `meta/_journal.json` dan snapshot terakhir. Tiga worker paralel
  menghasilkan tiga `0006_*` dan tiga snapshot yang saling bertentangan. Selain itu `src/server/db/migrate.ts:7,25`
  memecah SQL di `--> statement-breakpoint`, tetapi contoh SQL 04 §3.2 tidak memiliki breakpoint sama sekali (11
  pernyataan + 2 `UPDATE` backfill). Blok backfill manual harus diberi breakpoint juga.
- **Usulan**: satu worker `wkr-db-01` di W1 menulis ketiga migrasi berurutan (generate → edit → generate):
  - **0006_data_safety** (04): `audit_log` + `backup_run` + backfill. `backup_restore` ditunda (§4).
  - **0007_sites_lifecycle** (03): kolom `site`/`job`/`deploy` + index.
  - **0008_monitor** (02): hanya `problem_event` di v0.3.0. `metric_sample`/`check_result` ditunda.

  Urutannya: 04 dulu karena punya backfill pada tabel berisi data dan paling berisiko, lalu 03 (ALTER), lalu 02
  (tabel baru, tanpa ketergantungan). `tests/db.migrate.test.ts` dipegang worker ini dan memuat kasus "DB v0.2.2
  berisi data → 0008".

### X8 — Kamus status: `interrupted` tidak ada, `rolled_back` berlawanan, 02 membuat tabel sendiri

- **Severity**: MAJOR · **Area**: kontrak / UI
- **Klaim**: lihat K09–K12. 01 §3.1: "PLAN lain yang butuh kunci baru harus mencantumkannya di PLAN-nya **sekarang**
  supaya masuk gelombang 1". 01 juga menetapkan hanya worker 02 yang boleh mengubah `status.vocab.ts` di G2.
- **Masalah**:
  - 03 butuh `interrupted` tetapi menitipkannya sebagai permintaan ke 01, bukan kunci yang sudah ada di tabel 01.
  - 03 meminta `rolled_back` = warning "Dikembalikan". 01 D3 menetapkan danger "Gagal, dibatalkan". Ini keputusan
    UX yang berlawanan, bukan sekadar nama.
  - 02 §5.4/§5.6 membuat `domainVerdict` dan kosakata di `id.panel` dengan label yang berbeda dari 01 ("Mati tak
    terduga" vs "Mati", `launching` info vs warning). Itu persis "tabel per domain" yang ditolak 01 D1.
- **Usulan**: tetapkan di W0/W1 (worker 01) kunci tambahan berikut:
  - `interrupted` ("Terputus", danger, `UnplugIcon`).
  - Untuk verdict domain: `auth_required` ("Butuh login", neutral), `unstable` ("Tidak stabil", warning),
    `tunnel_down` ("Tunnel terputus", danger), `app_stopped` → pakai `stopped`, wildcard → pakai `unchecked` dengan
    label override.
  - `key_mismatch` ("Kunci tidak cocok", danger).
  - `restoring`: pakai `processing`.

  Untuk `rolled_back` job, saya berpihak pada **03**: warning "Dikembalikan". Alasannya ada di 03 §4.5/§5.9: status itu
  berarti "aman, tidak ada yang perlu dibersihkan". Danger harus disimpan untuk `failed`/`interrupted`, yang memang butuh
  tindakan. Dengan begitu warna mengikuti "perlu tindakan atau tidak", sejalan dengan benchmark §11 yang dikutip 01 D3.
  Konsekuensinya 01 D3 direvisi. `domainVerdict` 02 tetap boleh ada sebagai fungsi yang **mengembalikan `StatusKey` +
  kalimat penjelasan**, bukan label/tone sendiri. Tabel §5.6 02 dihapus.

### X9 — Kontrak log: dua file `log.types.ts`, dua parser, dua daftar props, salah pemilik

- **Severity**: MAJOR · **Area**: kontrak
- **Klaim**: K01–K05.
- **Masalah**: lihat tabel. Selain itu 05 §F7 dan §5.4 menyebut "`LogViewer` dari PLAN/02 [DEP]", padahal pemiliknya
  01. Perilaku saat pengguna menggulir ke atas berlawanan antara 01 §3.4.2 dan 02 §4.5.3.
- **Usulan**:
  - `log.types.ts` ditulis worker kontrak W0: `LogLine {at,text,stream?,level?}` + `LogChunk`. Endpoint log 02
    mengembalikan `LogChunk`. Teks 01 dep 2 diganti "mengembalikan `LogChunk` (lines lama → baru)".
  - Parser satu: `src/shared/log.time.ts` (01). 02 `log.parse.ts` hanya memuat redaksi + baca dari cursor dan memanggil
    `splitLogTimestamp`.
  - Props LogViewer = versi 01. Aturan gulir 01 dipakai (unpin + polling jalan, tombol "Baris baru (n)"). `newCount`
    dihitung komponen dari `seq`, bukan prop.
  - `useLogFollow(url, {enabled})` milik 01 di `src/web/shared/` (W1), sehingga 05 `/dev/logs` memakai `useApiQuery`
    biasa dengan _replace_ (ring di memori, tanpa cursor).
  - `AppLogTail.lines` (03) menjadi `LogLine[]` (`at: null`).

### X10 — Masalah dan notifikasi cadangan/keamanan ditulis dua kali

- **Severity**: MAJOR · **Area**: kontrak / flow
- **Klaim**: K13–K15. 04 §3.5 punya `backup.problems.ts` dan `backup.events.ts`. 02 §3.1 menulis aturan `backup_*` di
  `overview.problems.ts` dan K11 mengirim lewat rekonsiliasi.
- **Masalah**: dua sumber aturan berarti angka di Ringkasan bisa berbeda dari angka notifikasi (justru yang ingin ditutup
  02 K1). `notify()` 04 tidak punya penerima. 05 `/dev/health` juga menghitung `backup` dan `storage` sendiri (§3.4),
  sehingga ada tempat ketiga.
- **Usulan**: semua aturan ada di `overview.problems.ts` (02). Kode 04 (`backup_item_stale`, `key_mismatch`,
  `access_not_seen`) dan kind `security` ditambahkan ke union di W0. `backup.problems.ts` dan `backup.events.ts`
  **dihapus** dari 04. "recovered" sudah otomatis jadi "PULIH" saat masalah tertutup (02 §4.6.4). Cek `backup` dan
  `storage` di `/dev/health` diturunkan dari `problems` hasil sampler terakhir (filter `kind`), tidak dihitung ulang.
  `backup_status_error` 02 tetap ada untuk kasus non-kunci.

### X11 — Cabut sesi pengguna lain: satu route, dua implementasi

- **Severity**: MAJOR · **Area**: kontrak / keamanan
- **Klaim**: K21.
- **Masalah**: 04 (`sessions.service.ts revokeUserSessions`, pemilik `wkr-safety-audit`) dan 05 (`users.service.ts`,
  pemilik `wkr-adm-server-01`) sama-sama menulis `POST /api/dev/users/:id/sessions/revoke`. Aturan perlindungannya beda:
  05 juga melindungi super admin env, 04 tidak. Aksi auditnya juga beda.
- **Usulan**: implementasi di 04 (`sessions.service.ts`), route di `dev.routes.ts` (05). Aturan 409 mengikuti 05
  (diri sendiri **dan** super admin env, konsisten dengan `assertMutable`). Aksi audit: `session.revoke` dengan
  `meta {userId, revoked}`. `session.revoke_all` khusus untuk "Keluarkan semua pengguna". Tipe: `RevokedSessions` (04).
  `DevUserRevokeSessions` dihapus.

### X12 — Deteksi Cloudflare Access: dua sumber, dua semantik

- **Severity**: MAJOR · **Area**: kontrak / keamanan
- **Klaim**: K24.
- **Masalah**: 05 menandai item `access` "selesai" bila request `/api/dev/setup` **ini** membawa header. Kalau
  super_admin membuka panel lewat `127.0.0.1` sekali saja, item menjadi "belum". 04 mencatat `lastSeenAt` dan memunculkan
  masalah `access_not_seen` setelah 24 jam.
- **Usulan**: sumber tunggal `accessSeen.at` (04, di `api.handler.ts`). `/api/dev/setup` dan cek `access` `/dev/health`
  (05) membacanya. Item onboarding "selesai otomatis" bila `lastSeenAt ≤ 24 jam`. Centang manual tetap ada.

### X13 — `install-phone.sh` tidak punya pemilik dan menerima permintaan yang bertentangan

- **Severity**: MAJOR · **Area**: flow / rencana kerja
- **Klaim**:
  - 03 §4.12: "installer diminta memakai `sv -w 130 restart panel`" + template ecosystem dengan snippet + minimal satu
    app.
  - 04 §7: installer memverifikasi `SHA256SUMS` + petunjuk rollback.
  - 05 F9.4: "[DEP PLAN/04] snapshot … dijalankan di `install-phone.sh`".
  - Tabel kerja PLAN mana pun tidak mencantumkan file ini.
- **Masalah**:
  1. Snapshot: 04 K9 sengaja menaruhnya di boot dan menolak installer, sementara 05 mengandalkan installer.
  2. `scripts/install-phone.sh:76` memakai `until sv restart panel …; do … done` dengan batas `SV_WAIT_SEC`. Dengan 03
     D11 (`SHUTDOWN_TIMEOUT_MS` 20 → 120 dtk), `sv restart` (bawaan tunggu 7 dtk) mengembalikan non-zero selama panel
     menunggu job. Loop mengirim TERM berulang lalu `die`, padahal panel sedang berhenti dengan benar.
  3. Checksum diminta 04 di `install-phone.sh`, tetapi 05 menaruhnya di `install-release.sh`.
- **Usulan**: `install-phone.sh` dipegang `wkr-dist-01` (05). Isinya:
  - `sv -w 130 restart panel` sekali, tanpa loop ulang restart; loop hanya menunggu status `run`.
  - Checksum tetap di `install-release.sh`.
  - Snapshot **tidak** di skrip; boot 04 K9 sudah menangani, dan teks 05 F9.4 dihapus.
  - Template ecosystem baru menunggu hasil E4 POCO (03 §8.1).

### X14 — Endpoint Telegram: path dan bentuk respons berbeda

- **Severity**: MAJOR · **Area**: kontrak
- **Klaim**: K17.
- **Masalah**: UI 05 memetakan `{ok, code, detail}` dengan status 200. 02 membalas 200 `{ok:true, sentAt}` atau 502
  `{error:<AlertErrorCode>}`.
- **Usulan**: pakai path 02 (`/api/dev/alerts/test`, `/api/dev/alerts/telegram/chats`), karena mesinnya milik 02. Bentuk
  error mengikuti pola API yang ada (`{error, message}` + status). 05 memetakan `error` → teks lewat `errorCodes`, pola
  yang sama dengan halaman lain. 05 §3.3 baris `notify/telegram/test` diganti.

### X15 — Merge `main` (hotfix CSRF) ke branch ini

- **Severity**: MAJOR · **Area**: rencana kerja / keamanan
- **Klaim**: 04 K1 dan §7 prasyarat: "merge `main` → branch; konflik yang diharapkan hanya `api.routes.ts` dan harness
  test". Lalu guard dipindah ke `createApiHandler` sebelum rate limit dan `.onRequest` dihapus.
- **Bukti**: `git merge-tree --write-tree HEAD main` menunjukkan **satu** konflik, di `src/server/routes/api.routes.ts`
  (branch sudah menulis ulang file itu: `/ready`, `createMeRoutes`, `siteJobs`). `tests/dev.api.test.ts` dan
  `tests/panel.api.test.ts` ter-auto-merge. 04 K1 benar: di HEAD, `respond()` memanggil `mutationLimit.take` lebih dulu
  (`api.handler.ts:100-103`), baru kemudian `api.handle`, sehingga kuota habis sebelum `onRequest` Elysia sempat menolak.
- **Masalah yang belum disebut PLAN-04**:
  1. `tests/csrf.origin.test.ts` (main) menyusun `new Elysia().use(app).use(createApiRoutes(…))` lalu memanggil
     `api.handle` **langsung**, tanpa `createApiHandler`. Begitu `.onRequest` dihapus, semua kasus BAD akan mendapat 401
     dari role guard, bukan 403. Test gagal, dan itu bagus, asalkan tidak "diperbaiki" dengan melonggarkan ekspektasi.
  2. Signature `createApiHandler(api, { https })` (`api.handler.ts:91`) harus menerima `appBaseUrl`. Pemanggilnya
     `servePanel` (`index.ts:103`) ikut berubah, padahal file itu milik worker lain (X6).
  3. `MUTATIONS` memuat `PUT /api/dev/settings/sites.dir`, yang akan dihapus 05 (X3).
- **Usulan** (W0, oleh orkestrator, satu commit `chore(merge)`):
  1. Merge `main`. Resolusi `api.routes.ts` = versi branch + baris `.onRequest(rejectForeignOrigin)` dari main
     **dipertahankan**, supaya perilakunya identik dengan produksi 0.2.2 selama transisi.
  2. Jalankan `bun test` (CSRF test harus hijau).

  Di W1, `wkr-http-01` memindahkan guard ke awal `createApiHandler`, menghapus `.onRequest`, mengubah
  `csrf.origin.test.ts` agar memakai `servePanel`/`createApiHandler`, dan menambah kasus "61 POST asing lalu 1 POST sah →
  200" (04 §6). Sekali jalan, tanpa periode tanpa guard.

### X16 — 404 publik dan router dikerjakan dua kali

- **Severity**: MAJOR · **Area**: rencana kerja
- **Klaim**: K32. 01 §7 1c memegang `router.tsx`, `session.redirect.ts`, `public-not-found.page.tsx`. 05 §7 G2
  `wkr-adm-account-web-01` memegang `public-not-found.page.tsx`, dan G3 `wkr-adm-routing-01` memegang `router.tsx` +
  `session.redirect.ts`.
- **Usulan**: semua sisi klien ada di 01 1c. Bagian 05 yang tersisa hanya sisi server: status 404 + `noindex` di
  `spa.serve.ts`, dan `SPA_ROOTS` di `roles.ts` yang ditulis worker kontrak W0 bersama `isProtectedPath`.
  `wkr-adm-routing-01` dihapus. Copy 404 publik: pakai teks 05 §5.7 (lebih pendek), cukup satu set di `id.shell`.

### X17 — Aturan i18n 01 dilanggar rencana kerja 02/03/04

- **Severity**: MINOR · **Area**: rencana kerja
- **Klaim**: 01 §7: file i18n baru di G2 di-import langsung, penggabungan ke `id.ts` di G3. Sementara itu 02
  (`id.ts (1 baris)`), 03 (`id.ts (daftarkan …)`), dan 04 (`id.ts (1 baris merge)`) masing-masing mengedit `id.ts`.
  05 juga memecah `id.dev.ts`.
- **Usulan**: tidak ada yang menyentuh `id.ts` di gelombang halaman. Penggabungan dilakukan sekali oleh
  `wkr-cleanup-04`.

### X18 — Tier konfirmasi yang tidak sejalan

- **Severity**: MINOR · **Area**: UI / kontrak
- **Masalah**:
  - "Keluarkan semua pengguna" di 04 = typed (`keluarkan`), sedangkan 01 §3.2 = AlertDialog. Menurut aturan 01 sendiri
    ("data hilang permanen atau semua situs padam → ketik"), mencabut semua sesi bisa dipulihkan dengan login ulang, jadi
    cukup **AlertDialog**.
  - Hapus situs adopsi di 03 §4.14 = confirm, sedangkan 01 menulis "Hapus situs" = typed. 03 benar, karena tidak ada
    data yang hilang. 01 perlu memberi catatan "hanya situs dikelola".
  - Restart `panel` di 01 F3.7: "`onConfirm` resolve setelah pulih". Di 02 §4.4: dialog ditutup saat 202, lalu overlay
    modal. Pakai versi 02: `onConfirm` resolve pada 202, overlay jadi komponen 02.
- **Usulan**: perbaiki tabel 01 §3.2 dengan tiga baris di atas.

### X19 — Backoff khusus halaman progres 03 dan teks detik

- **Severity**: MINOR · **Area**: UI / polling
- **Masalah**:
  - 03 §4.5.2 meminta backoff 1→2→4→5 dtk sampai 120 dtk dan menyembunyikan error selama `tunnel_restart`. Poller 01
    (P4) memakai ×2 sampai 60 dtk dan menampilkan `StaleNotice`.
  - 02 §5.1 dan 05 F2 menulis "Diperbarui 12 dtk lalu", padahal 01 D16 menetapkan detik tidak pernah tampil.
- **Usulan**: halaman job memakai `useApiQuery(url, 1000)` biasa (backoff 1, 2, 4, 8… sudah dekat). Halaman itu tidak
  merender `StaleNotice` selama langkah terakhir yang diketahui adalah `tunnel_restart`/`domain_probe` dan umur error
  < 120 dtk. Itu logika pemanggil, tanpa opsi hook baru. Contoh copy di 02/05 diganti "Diperbarui baru saja".

### X20 — Nama props komponen bersama tidak seragam

- **Severity**: MINOR · **Area**: kontrak
- **Masalah**: K06–K08. Worker domain akan menulis `rowActions`, `pauseHidden`, `tier:"none"`, sehingga compile gagal
  atau muncul "perbaikan" ke komponen 01 di gelombang halaman (dilarang).
- **Usulan**: spec worker gelombang halaman mengutip signature 01 §3.3/§3.5 secara harfiah. §3.9 02 dan §5 03 ditandai
  "digantikan 01".

### X21 — Adapter sistem dipegang dua PLAN

- **Severity**: MAJOR · **Area**: rencana kerja
- **Klaim**: K29. 02 G1 `wkr-mon-adapters-01` memegang `system.types.ts`, `system.fake.ts`, `pm2.termux.ts`, dan
  lainnya. 04 G2 `wkr-backup-engine` memegang `system.types.ts`, `system.fake.ts`, `postgres.termux.ts`,
  `archive.termux.ts`. 03 menitipkan kebutuhannya ke 02 ("bila tidak bisa, W2a setelah gelombang adapter").
- **Usulan**: satu worker `wkr-adapters-01` di W1 memegang semua tambahan adapter dari tiga PLAN (02 §3.5, 03 §3.7, 04
  §3.5) beserta data fake untuk ketiganya. Pengujian: `tests/panel.parsers.test.ts` + test adapter fake.

### X22 — `audit.service.ts` dan union `AuditAction` disentuh berulang

- **Severity**: MAJOR · **Area**: kontrak / rencana kerja
- **Klaim**: K23. 04 §3.6: "aksi yang diminta PLAN lain ditambahkan oleh PLAN itu di gelombang berikutnya (< 10 baris)".
- **Masalah**: tiga PLAN mengedit `audit.service.ts` di tiga gelombang. 05 butuh union di `src/shared` untuk
  `satisfies Record<AuditAction,…>`. 05 juga butuh `action` berulang (OR). 04 hanya mendukung satu `action` + `from/to`,
  dan 05 menunda filter tanggal ke P2.
- **Usulan**: `src/shared/audit.types.ts` (W0) memuat union lengkap dari semua PLAN sekarang: aksi 04 §3.6 ditambah
  `setup.update`, `backup.verify`, `session.revoke`, `log.download`, `site.adopt`, `deploy.upload_start`,
  `deploy.upload_cancel`, `job.cleanup`, `job.retry`. `listAudit` (04, W2) menerima `action: string[]` (OR, prefix bila
  diakhiri `.`). `from/to` tetap boleh ada di API, UI tidak perlu.

### X23 — Shutdown 120 dtk, kunci lintas subsistem

- **Severity**: MINOR · **Area**: flow
- **Masalah**:
  - 02 §3.7 menulis "shutdown hanya menunggu 20 dtk" sebagai alasan menolak restart `panel`, padahal 03 D11 menaikkannya
    ke 120 dtk. Alasan dan angkanya perlu diselaraskan (penolakannya tetap benar).
  - Daftar yang menolak restart `panel` belum memuat pemulihan 04 (`restoring`).
  - Kunci job situs (03) dan kunci cadangan/pemulihan (04) terpisah. `site.delete` dengan `database_drop` saat backup
    `pg_dump` jalan akan membuat run `partial`, dan situasi ini tidak disebut di kedua PLAN.
- **Usulan**: 02 menolak restart `panel` bila `jobs.active() || backup.running || backup.restoring`. 03
  `database_drop` memeriksa `backup.running` dan menunggu atau menolak `busy`. Cukup satu baris dokumentasi di kedua
  PLAN.

### X24 — Formatter shared belum ada di spec 01

- **Severity**: MINOR · **Area**: kontrak
- **Usulan**: tambahkan `src/shared/format.id.ts` (pindahan `formatBytes/formatDuration/formatNumber`, re-export dari
  `web/shared/format.ts`) ke 01 1a. Dengan begitu `problem.copy.ts` dan pesan Telegram (02) tidak mengimpor dari
  `src/web`.

### X25 — `http.error.ts` hanya diperluas untuk kebutuhan 03

- **Severity**: MINOR · **Area**: kontrak
- **Usulan**: worker kontrak W0 menetapkan `ApiError.status` = `400|401|403|404|409|410|421|429|502|503|507` + `extra`
  (K39) sekaligus, menggantikan edit 03 G1.

### X26 — Breakpoint di migrasi tulisan tangan

- **Severity**: MINOR · **Area**: data
- **Usulan**: lihat X7. Spec `wkr-db-01`: setiap pernyataan, termasuk `UPDATE` backfill, dipisah `--> statement-breakpoint`.
  Test migrasi memastikan backfill jalan (cek `actor_kind='user'` pada baris lama).

### X27 — Tiga nama untuk "cadangan terakhir DB"

- **Severity**: MINOR · **Area**: kontrak
- **Usulan**: satu fungsi repo `lastGoodItem(db, kind, name)` di backup engine 04. 02 (`DatabaseInfo.lastBackupAt`) dan
  03 (dialog hapus situs) memanggilnya.

### X28 — Kunci data dan onboarding bertentangan

- **Severity**: MINOR · **Area**: flow
- **Masalah**: K26. Teks item `secret_saved` di 05 juga menyatakan "`data/secret` tidak ikut dicadangkan". Itu benar
  hanya selama `backup.include_secrets=off`.
- **Usulan**: item selesai otomatis bila `exportedAt !== null` (04). Centang manual tetap ada untuk yang menyalin lewat
  shell. Teks dibuat kondisional terhadap `includeSecrets`.

### X29 — Total ruang lingkup terlalu besar untuk rilis publik pertama

- **Severity**: OVER · **Area**: rencana kerja
- **Masalah**: perkiraan PLAN sendiri:

  | PLAN | Baris diff (termasuk test) | Worker |
  | ---- | -------------------------- | ------ |
  | 01   | ±2.150                     | 2      |
  | 02   | ±6.000                     | 11     |
  | 03   | ±6.200                     | 9      |
  | 04   | ±2.500                     | 6      |
  | 05   | ±3.000–3.800               | 12     |
  | Docs | –                          | 1      |

  Jumlahnya **±20.000 baris dan sekitar 43 worker** dalam sekitar 5 gelombang berurutan, dengan dua gerbang eksternal
  (lab pm2 POCO, browser QA). Untuk panel satu pemilik di satu HP, sebagian besar P1/P2 tidak menentukan apakah v0.3.0
  aman dipublikasikan.
- **Usulan**: inti v0.3.0 dan daftar tunda ada di §4. Perkiraannya ±11–12 ribu baris dan sekitar 24 worker.

### X30 — Duplikasi kecil yang bisa dibuang

- **Severity**: OVER · **Area**: fitur
- **Masalah dan usulan**:
  - Heartbeat 05 K21 (`heartbeat.ts` + baris `beat()` di file 02/04) duplikat dengan `sampledAt` 02 dan
    `backup.status().nextRunAt`/tick 04. Cek `background` cukup membaca `monitor.sampledAt` dan waktu tick terakhir
    scheduler yang sudah ada. Tunda `heartbeat.ts`.
  - 02 `columns[].hidden` dan prop `error` DataTable (X20).
  - 04 `backup.events.ts` (X10).
  - 05 cek `backup`/`storage` (X10).

---

## 4. Ruang lingkup v0.3.0 (usulan pangkas)

Prinsipnya: rilis publik pertama harus **aman** (tidak menghapus cadangan, tidak mengunci pemilik, CSRF, tidak
mematikan pm2 saat reboot), **jujur** (tidak ada CPU% atau status palsu), dan **bisa dipasang orang lain** (landing,
rilis, LICENSE). Hal lain diambil di 0.3.x.

| PLAN | Masuk v0.3.0                                                                                                                                                                                                                                                                                                                                                                                                              | Ditunda (0.3.x / 0.4)                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01   | Semua G1 (kamus status, `ConfirmAction`, `QueryView`, poller, toaster tunggal, bottom bar + sheet, fokus route, code splitting + chunk error, format). LogViewer inti (follow, pin, cari, wrap, salin, unduh Blob)                                                                                                                                                                                                        | Layar penuh LogViewer, pemisah tanggal, `web.guard.test.ts` regex warna (cukup lint manual), target ukuran bundle sebagai gerbang CI                                                                                                                                                                                                 |
| 02   | `Problem` berkode + `problem.copy`, overview tidak pernah 500, tile jujur (load netral tanpa baseline), baterai, `pm2_unavailable`, debounce domain (counter di memori), cek lokal port, `internet_down`, sampler + cache snapshot, `problem_event` + mesin alert + Telegram (uji kirim, cari chat), proteksi layanan + `lockout` + restart 202/overlay, log API cursor + redaksi, request log debug                      | `metric_sample`/`check_result` + `/metrics` + `loadBaseline` + sparkline + strip heartbeat, riwayat masalah (`/problems/history` + halaman), unduh log server + audit `log.download` (pakai Blob klien), badge nav `/panel/status`                                                                                                   |
| 03   | G1 `apps.json` aman + snippet + probe, G2/G3 adopsi berbasis pm2 + ELF, G4 `interrupted` + Bersihkan/Ulangi, G5 unggah bisa dilanjut (sha per potongan, meta persist), G6 kode langkah, G7 ekor stderr, health 2 jawaban + stabil 5 dtk (path/timeout default), shutdown 120 dtk, kunci job untuk kontrol                                                                                                                 | Pengaturan health per situs (kolom migrasi tetap ditambah agar tidak migrasi lagi), job `site.env` "Simpan dan mulai ulang" (pakai Simpan + banner + Mulai ulang), Tempel `.env`, cek DNS di wizard, info cadangan di dialog hapus (cukup tautan ke Cadangan)                                                                        |
| 04   | Guard CSRF di handler + host check, retensi berbasis catatan, cakupan (`globals`, `sites`, `cloudflared`, `secrets` opsional off) + manifest + batas ukuran + verifikasi lokal, key-check + mode mismatch + reset, snapshot pra-migrasi, petunjuk pulih benar, `/__spa`, teks model kepercayaan, unduh kunci data (wajib karena secrets off), uji S3 (bentuk 05), kolom audit + backfill, `accessSeen`, CI + review rilis | Pulihkan ke database baru + `backup_restore` + hapus DB uji, umur sesi absolut 30 hari + sesi segar (kecuali untuk unduh kunci data, cukup `assertFresh`), revoke-all, retensi audit (`audit.retention_days`), `auth.sign_in_failed`, `stat` pasca-unggah bila Bun S3 belum terbukti                                                 |
| 05   | Settings PATCH batch + label di web + grup Telegram/Cadangan/Cloudflare + uji, Kesehatan sistem (vonis dari cek berkode, tanpa heartbeat), Pengguna (ubah peran dengan peringatan, hapus typed, cabut sesi), Audit UI (bentuk 04), `/dev/logs` → LogViewer, Profil + kartu `user` tanpa akses + sesi sendiri, login, landing "Pasang di HP-mu" + `#pasang`, LICENSE, rilis + `install-release.sh`                         | SEO (`robots`, `sitemap`, OG, `pageHead`, cache CSP per varian; cukup `noindex` header untuk non-`/`), pipeline screenshot (`demo-seed.ts` + browser automation + WebP; pakai satu screenshot manual), onboarding card (cukup kartu statis dengan tautan; item otomatis di 0.3.x), "Terakhir aktif"/filter peran pengguna, heartbeat |

Perkiraan: 01 ±1.900 · 02 ±3.200 · 03 ±3.800 · 04 ±1.700 · 05 ±2.100 → **±12.700 baris, 24 worker**.

---

## 5. Jadwal implementasi global (usulan untuk koordinator)

Aturan:

- Dalam satu gelombang tidak ada file dengan dua pemilik.
- Worker tidak commit/push/ganti branch.
- Typecheck + test hijau di akhir **setiap** gelombang. Perubahan tipe yang memecah konsumen dikerjakan bersama
  konsumennya dalam gelombang yang sama, atau kontrak W0 dibuat aditif (field baru opsional, tipe lama di-alias) lalu
  dikencangkan di W4.
- Nama worker unik.

### W0 — fondasi (orkestrator + 1 worker; gerbang eksternal paralel)

| Pelaksana                       | Pekerjaan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | File                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| orkestrator                     | Merge `main` → branch (X15): konflik `api.routes.ts` = versi branch + `.onRequest(rejectForeignOrigin)`; `bun test` hijau; commit `chore(merge): bring CSRF origin guard from main`                                                                                                                                                                                                                                                                                                                                                              | `api.routes.ts`, test main                              |
| orkestrator                     | Pecah `index.ts` → `boot.ts` + `http/spa.serve.ts` (refactor murni, tanpa perilaku baru; X6). Atau delegasikan ke worker bila Rule 23 aktif                                                                                                                                                                                                                                                                                                                                                                                                      | `src/server/index.ts`, `boot.ts`★, `http/spa.serve.ts`★ |
| `wkr-contracts-00`              | Semua tipe shared baru/berubah yang disepakati dokumen ini: `log.types.ts`★ (K01), `monitor.types.ts`★ (+ kode 04, kind `security`, params `site_job_failed`), `panel.types.ts` (re-export, field baru opsional), `site.types.ts`, `deploy.types.ts`, `backup.types.ts` (tanpa `BackupTest*`, tanpa `BackupRestore*`), `security.types.ts`★, `dev.types.ts` (05 + `DevAuditEntry` 04; `SETTING_KEYS` dengan `alerts.*` + key 04), `audit.types.ts`★ (X22), `roles.ts` (`isProtectedPath` + `SPA_ROOTS`), `src/server/routes/http.error.ts` (X25) | `src/shared/*`, `http.error.ts`                         |
| pemilik HP + `wkr-sites-lab-00` | Lab pm2 POCO E1–E7 (03 §8.1), terisolasi. **Gerbang** untuk keputusan snippet filter (03 Q1) dan template installer (X13). Tidak memblokir W1                                                                                                                                                                                                                                                                                                                                                                                                    | – (hasil dicatat di PLAN-03 §8.1)                       |

### W1 — modul murni & server dasar (paralel, 8 worker)

| Worker                | PLAN                                                                   | File (eksklusif)                                                                                                                                                                                                                                                                                                                                                                                                                           | Bergantung                |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `wkr-shell-found-01`  | 01 1a+1b                                                               | `src/shared/log.time.ts`★, `src/shared/format.id.ts`★, `src/web/shared/{poller★,use-api-query,format,chunk.error★,api.client,api.action,use-log-follow★}.ts`, `src/web/components/*` (status.vocab★ dengan kunci X8, status.tone, log.buffer★, now.store★, page-header, query-view★, data-table, confirm-action★, log-viewer*★, dll.), `components/ui/*`, `styles.css`, `src/web/i18n/{id.status★,id.shell,id.common,id}.ts`, test unit 01 | W0                        |
| `wkr-http-01`         | 04 K1/K2/K11/K16/K18 + 01 §3.12 + 05 K16 (status 404 + `noindex` saja) | `src/server/http/{api.handler,spa.serve,request.context★,security.headers}.ts`, `src/server/routes/origin.guard.ts`, `src/server/routes/api.routes.ts` (hapus `.onRequest`), `tests/{server.http,server.origin,csrf.origin}.test.ts` (uji di binary `build:local` untuk header cache)                                                                                                                                                      | W0                        |
| `wkr-settings-01`     | 05 K1–K3 + key 02/04 (X3)                                              | `src/server/settings.service.ts`, `src/server/routes/dev.routes.ts` (hanya rute settings), `tests/dev.settings.test.ts`★                                                                                                                                                                                                                                                                                                                   | W0                        |
| `wkr-db-01`           | 04/03/02 migrasi (X7)                                                  | `src/server/db/schema/*`, `drizzle/0006_data_safety.sql`, `drizzle/0007_sites_lifecycle.sql`, `drizzle/0008_monitor.sql`, `drizzle/meta/*`, `drizzle/migrations.js`, `tests/db.migrate.test.ts`                                                                                                                                                                                                                                            | W0                        |
| `wkr-adapters-01`     | 02 §3.5 + 03 §3.7 + 04 §3.5 (X21)                                      | `src/server/system/*` (termasuk `archive.termux.ts`★, `file.tail.ts`), `tests/panel.parsers.test.ts`, test adapter                                                                                                                                                                                                                                                                                                                         | W0                        |
| `wkr-sites-runner-01` | 03 G1                                                                  | `src/server/sites/{job.runner,job.legacy★}.ts`, `src/server/shutdown.ts`, `tests/{job.runner★,server.shutdown}.test.ts`                                                                                                                                                                                                                                                                                                                    | W0                        |
| `wkr-mon-rules-01`    | 02 + 04 aturan (X10)                                                   | `src/server/panel/overview.problems.ts`, `src/shared/problem.copy.ts`★, `src/server/alerts/{alert.engine,telegram.client,alert.messages}.ts`★, `tests/{panel.problems,alert.engine,telegram.client}.test.ts`                                                                                                                                                                                                                               | W0                        |
| `wkr-dist-01`         | 05 §3.7 + 04 K19 review (X1, X13)                                      | `LICENSE`★, `package.json` (`license`), `.github/workflows/{release,ci}.yml`★, `.github/dependabot.yml`★, `scripts/{package-release,install-release,install-release.test}.sh`★, `scripts/install-phone.sh` (`sv -w 130`, tanpa loop restart; template ecosystem setelah hasil lab)                                                                                                                                                         | W0 (+ lab untuk template) |

### W2 — layanan server + shell (paralel, 8 worker)

| Worker                 | PLAN                                                                     | File (eksklusif)                                                                                                                                                                                                                                                                                                                                         | Bergantung                                           |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `wkr-shell-layout-02`  | 01 1c + 05 K16 sisi klien (X16)                                          | `src/web/layout/*`, `src/web/session/*`, `src/web/pages/{route-error,not-found,public-not-found★}.page.tsx`, `src/web/router.tsx`, `src/web/{panel/panel.pages,dev/dev.pages}.ts`★, hapus `panel.layout`/`dev.layout`, `src/web/index.html`, `scripts/build.ts` (`splitting`), satu baris `useDocumentTitle` di landing & login, `docs/content-guide.md` | `wkr-shell-found-01`                                 |
| `wkr-keys-02`          | 04 K8/K9/K14 (sebagian)                                                  | `src/server/secret.ts`, `src/server/data-key.service.ts`★, `src/server/db/snapshot.ts`★, `src/server/routes/security.routes.ts`★, `tests/{secret,data-key★,db.snapshot★}.test.ts`                                                                                                                                                                        | W1 settings, db                                      |
| `wkr-audit-02`         | 04 K11/K12 + X11/X22                                                     | `src/server/audit.service.ts`, `src/server/auth/*` (`sessions.service` revoke user + `assertFresh`, `auth.audit`★), `src/server/routes/me.routes.ts`, `tests/{auth,me.sessions,audit★}.test.ts`                                                                                                                                                          | W1 db, http                                          |
| `wkr-backup-engine-02` | 04 F2/F3 + uji S3 bentuk 05 (X4) + `lastGoodItem` (X27)                  | `src/server/backup/*` (`backup.items`★, `backup.retention`★, `backup.verify`★, `backup.service`, `backup.routes`), `tests/backup.*.test.ts`, `tests/backup.s3mock.ts`                                                                                                                                                                                    | W1 adapters, db, settings                            |
| `wkr-mon-core-02`      | 02 sampler + snapshot + history (problem_event saja) + log parse/redaksi | `src/server/monitor/{monitor.snapshot,monitor.sampler,monitor.service,monitor.history}.ts`★, `src/server/system/log.parse.ts`★ (redaksi + cursor; timestamp dari `log.time.ts`), `tests/{monitor.snapshot,monitor.sampler,log.parse}.test.ts`                                                                                                            | W1 adapters, rules, db                               |
| `wkr-sites-server-02`  | 03 setup + jobs                                                          | `src/server/sites/*` (kecuali runner/legacy), `src/server/cloudflare/dns.provider.ts`, `src/server/routes/sites.routes.ts`, test situs                                                                                                                                                                                                                   | W1 runner, adapters, db                              |
| `wkr-deploy-server-02` | 03 deploy                                                                | `src/server/deploy/*`, `src/server/routes/deploy.routes.ts`, test deploy                                                                                                                                                                                                                                                                                 | W1 runner, adapters, db                              |
| `wkr-dev-server-02`    | 05 server (tanpa settings, tanpa uji S3, tanpa revoke)                   | `src/server/routes/dev.routes.ts` (rute non-settings: health, setup, users, audit, logs; mount route revoke memakai fungsi `wkr-audit-02`), `src/server/dev/{health,setup,users}.service.ts`, `tests/{dev.health★,dev.setup★,dev.api}.test.ts`                                                                                                           | W1 settings (`dev.routes.ts` berpindah tangan di W2) |

Catatan W2:

- `dev.routes.ts` dipegang `wkr-settings-01` di W1 dan `wkr-dev-server-02` di W2 (berurutan, bukan paralel).
- `api.routes.ts` dipegang `wkr-http-01` di W1. Mount `alerts.routes`, `security.routes`, dan `setup` dilakukan
  `wkr-boot-03` di W3 bersama wiring.
- `setup.service.ts` hanya dipegang 05. Worker 03 cukup mengekspor `integration().ecosystemIncludesAppsJson`.

### W3 — API panel + wiring + halaman web (paralel, 12 worker)

| Worker                    | PLAN                            | File                                                                                                                                                                                                                   | Bergantung                                                            |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `wkr-mon-api-03`          | 02 API                          | `src/server/panel/panel.service.ts`, `domain.health.ts` (hapus), `src/server/routes/{panel,alerts★}.routes.ts`, `src/server/http/request.log.ts`, `src/server/log.service.ts`, `tests/{panel.api,alerts.api★}.test.ts` | W2 mon-core, sites-server (`isLocked`), backup-engine                 |
| `wkr-boot-03`             | 04 F7 + 02 boot + 03 start (X6) | `src/server/boot.ts`, `src/server/routes/api.routes.ts` (mount `alerts`/`security`/setup), `tests/server.health.test.ts`                                                                                               | W2 semua server                                                       |
| `wkr-mon-web-03`          | 02 halaman                      | `src/web/panel/*` (overview, services, apps, domains, databases, log, restart.overlay★, control), `src/web/i18n/{id.panel,id.overview★}.ts`, `tests/web.panel.test.ts`                                                 | W2 shell-layout                                                       |
| `wkr-sites-web-list-03`   | 03                              | sesuai 03 §7 G3 (tanpa `id.ts`)                                                                                                                                                                                        | W2 shell-layout, sites-server                                         |
| `wkr-sites-web-detail-03` | 03                              | sesuai 03 §7 G3                                                                                                                                                                                                        | sama                                                                  |
| `wkr-sites-web-deploy-03` | 03                              | sesuai 03 §7 G3                                                                                                                                                                                                        | sama + deploy-server                                                  |
| `wkr-backup-web-03`       | 04                              | `src/web/backup/*`, `src/web/security/*`★, `id.backup.ts`, `id.security.ts`★                                                                                                                                           | W2 backup-engine, keys                                                |
| `wkr-adm-health-web-03`   | 05                              | `dev/health.page.tsx`, onboarding statis, `id.dev.health.ts`                                                                                                                                                           | W2 dev-server                                                         |
| `wkr-adm-settings-web-03` | 05                              | sesuai 05 §7 G2 + grup Telegram memakai API 02                                                                                                                                                                         | W1 settings, W3 mon-api (kontrak sudah dikunci W0, jadi paralel aman) |
| `wkr-adm-users-web-03`    | 05                              | users, audit (bentuk 04), logs (LogViewer 01)                                                                                                                                                                          | W2 dev-server, audit                                                  |
| `wkr-adm-account-web-03`  | 05                              | profile*, login* (tanpa public-not-found)                                                                                                                                                                              | W2 shell-layout                                                       |
| `wkr-adm-landing-03`      | 05                              | `src/web/landing/*`, `id.landing.ts` (satu screenshot statis)                                                                                                                                                          | W1 dist (URL aset final)                                              |

### W4 — pembersihan, integrasi, dokumen (berurutan)

1. `wkr-cleanup-04` (01 G3): hapus komponen lama, merge semua file i18n baru ke `id.ts`, kencangkan tipe W0 yang
   sementara opsional, `tests/web.guard.test.ts` (minimal: tanpa import lama, satu `<Toaster`).
2. `wkr-adm-cfverify-04` (05): `CloudflareVerify` berkode di `dns.provider.ts` (setelah `wkr-sites-server-02`).
3. QA browser (izin pemilik, Rule 1): 390 px dan 1440 px, kedua tema. QA POCO: CPU sampler, alert cabut charger, lab
   first-run 03 §4.3 langkah 1–7.
4. `wkr-docs-final-04`: README (bagian terbatas, Rule 16) + `CHANGELOG.md` `## [0.3.0]` + `.env.example`
   (`PANEL_SKIP_SNAPSHOT`, `PANEL_CONNECTIVITY_URL`).

Jalur kritis: W0 kontrak → W1 `wkr-shell-found-01` (ukuran L) → W2 `wkr-shell-layout-02` → W3 halaman. Server berjalan
paralel di sebelahnya. Gerbang eksternal: lab pm2 (sebelum `wkr-dist-01` menulis template ecosystem dan sebelum
`wkr-sites-server-02` mengunci snippet), izin browser QA, rilis tag oleh pemilik.

---

## 6. Hal yang sudah baik

- Setiap PLAN menulis tanda tangan modul dan tabel kepemilikan file. Tanpa itu kritik integrasi ini tidak mungkin
  dibuat. Pertahankan formatnya, perbaiki isinya.
- 02 K1/K11: satu sumber aturan masalah dan rekonsiliasi berbasis `problem_event`. Ini fondasi yang tepat untuk
  menyerap aturan 03/04 (X10).
- 04 K1 benar dan penting: guard CSRF harus berada sebelum rate limit. Sudah saya verifikasi di `api.handler.ts:100-103`.
- 01 D13 menemukan fakta yang benar soal header aset binary. Pengukuran saya mengonfirmasinya.
- 03 §8.1: lab pm2 terisolasi dengan aturan larangan yang jelas (`pkill -f`, `pm2 kill` global) dan tabel "hasil → perubahan
  PLAN". Pola yang patut ditiru PLAN lain yang bergantung pada eksperimen.
- 04 dan 05 sepakat soal model kepercayaan admin dan teks jujurnya. Cukup satu komponen `AdminTrustNote` (04) yang
  dipakai 05.

---

## 7. Pertanyaan untuk pemilik

1. **`rolled_back` job/deploy**: tampil sebagai peringatan "Dikembalikan" (usulan saya, mengikuti 03), atau bahaya
   "Gagal, dibatalkan" (01 D3)? Ini menentukan warna banyak baris riwayat.
2. **Pangkas v0.3.0 (§4)**: setuju menunda riwayat metrik, pulihkan ke database baru, SEO/OG, dan pipeline screenshot ke
   0.3.x agar rilis publik pertama lebih cepat?
