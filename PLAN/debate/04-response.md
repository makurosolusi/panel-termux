# Tanggapan penulis PLAN/04 atas `04-critique.md` (dan bagian `00-integration-critique.md` yang menyentuh PLAN/04)

Penulis: `wkr-plan-safety-01` · 2026-11-26 · Rencana yang direvisi: `PLAN/04-data-safety-security.md` (revisi r2; ringkasannya ada di "Riwayat revisi" di akhir file itu).

Bukti tambahan yang dikumpulkan untuk tanggapan ini:

- `~/test/server-termux/install.sh` (repo `makurosolusi/server-termux`, commit `3394c98`) adalah installer server HP yang dipakai pemilik. Installer ini:
  - menjalankan `initdb -D $PREFIX/var/lib/postgresql -U postgres --auth-local=trust --auth-host=scram-sha-256`, jadi role `postgres` **ada** di cluster baru;
  - memasang paket `postgresql cloudflared nodejs-lts termux-services …`;
  - membuat `~/sites/ecosystem.config.js` hanya bila belum ada (`put_once`);
  - membuat tunnel baru **hanya bila** `config.yml` belum ada dan `cert.pem` ada;
  - menjalankan `sv_on cloudflared` dan `sv -w 30 check` bila `config.yml` ada. Akibatnya kredensial tunnel harus sudah ada sebelum installer dijalankan, kalau tidak installer `die`.
- `files/sv/pm2/run` menjalankan `pm2-runtime --no-auto-exit ~/sites/ecosystem.config.js`, jadi `pm2 save` tidak perlu. `files/sv/cloudflared/run` menjalankan `cloudflared tunnel --no-autoupdate run` dengan `~/.cloudflared/config.yml`.
- `main` = `112de15` (0.2.2, hotfix CSRF sudah di produksi).
- `site.schema.ts:13` punya kolom `database`, sehingga cek "DB dipakai situs" cukup satu query.
- PLAN/01 §3.12 mengusulkan server bundle internal di `127.0.0.1:0` + proksi. Kritikus integrasi X5 mengukur bahwa binary `--compile` tidak mengirim `Cache-Control`.

Jumlah: **25 temuan**. TERIMA 20 · TERIMA SEBAGIAN 5 · TOLAK 0. Satu sub-usulan C16 ditolak; alasannya ada di bawah.

---

## Temuan `04-critique.md`

### C1 — BLOCKER · `secret_check` bisa bohong → **TERIMA**

- **Alasan**: skenario kritikus benar. `setSetting` (`settings.service.ts:697-712`) selalu mengenkripsi dengan secret aktif. Satu nilai check tidak bisa mewakili baris yang dienkripsi dengan dua kunci. Coba-dekripsi per baris (≤ 6 baris rahasia: S3 ×2, Cloudflare, Telegram) memang deterministik karena AES-GCM gagal pada tag yang salah.
- **Perubahan**:
  - `secret_check`, `keyCheckValue`, dan HKDF info `key-check/v1` dihapus (K8, §3.2, §3.5).
  - `settings.service.ts` mengekspor `unreadableSecretSettings(deps): SettingKey[]`.
  - `setSetting` untuk **key rahasia apa pun** melempar `KeyMismatchError` (409 `key_mismatch`) selama `unreadableSecretSettings` tidak kosong. Aturannya lebih ketat dari usulan kritikus (bukan hanya key yang tidak terbaca), supaya keadaan campuran tidak pernah terjadi.
  - Jalan keluar hanya reset (F8-B) atau mengembalikan file (F8-A).
  - Test ditambah: mismatch → simpan S3 → 409; mismatch → simpan Telegram (belum pernah diisi) → 409; kembalikan file → semua terbaca.

### C2 — BLOCKER · Runbook F11 tidak bisa dijalankan → **TERIMA**

- **Alasan**: penelusuran kritikus benar untuk langkah 2–4 dan 7–9. Ada satu koreksi: langkah 5 (`psql -U postgres`) **benar** bila HP disiapkan dengan `server-termux/install.sh`, karena installer itu membuat cluster dengan `-U postgres`. Saya menelusuri ulang semua langkah terhadap `server-termux/install.sh`, `install-phone.sh`, dan F9 PLAN/05, lalu menemukan dua kegagalan baru yang tidak disebut kritikus:
  1. Bila `config.yml` dipulihkan sebelum installer server dijalankan **tanpa** kredensial tunnel, installer `die` di `sv -w 30 check`.
  2. Bila installer server dijalankan **sebelum** `sites` dipulihkan, `put_once` membuat `ecosystem.config.js` kosong, dan `tar -k` lalu **tidak** memulihkan ecosystem asli.
- **Perubahan**: F11 ditulis ulang menjadi 14 langkah yang bisa disalin (§4 F11), dengan urutan:
  - langkah 0: matikan konektor lama;
  - `rclone` dengan token R2 baca-saja;
  - pilih stem dari daftar file;
  - `sha256sum -c <stem>SHA256SUMS`;
  - pulihkan `sites` dan `cloudflared` **sebelum** installer server, ke folder kosong (tanpa `-k`);
  - kredensial tunnel (`tunnel login` + `tunnel token --cred-file`) lalu `tunnel cleanup`;
  - installer server;
  - `globals` + `pg_restore --create`;
  - installer panel (service `down`), lalu salin `panel.db`/`secret`/`.env` dan jalankan ulang installer panel (menghapus `down` + cek kesehatan);
  - login → reset kunci bila perlu → isi ulang token;
  - deploy binary per situs.
  - Teks runbook juga ditulis ke `manifest.restoreSteps` dan README. Gerbang rilis = latihan penuh (C12).

### C3 — MAJOR · `partial` tidak pernah memicu prune → **TERIMA**

- **Alasan**: item gagal permanen (`too_large`, `insufficient_space`, `globals` tanpa trust) adalah keadaan yang direncanakan PLAN ini sendiri. `protectedItems` sudah menjamin salinan valid terakhir.
- **Perubahan**: F2.7/F3 prune setelah `succeeded` **atau** `partial`, tidak setelah `failed`. Acceptance diubah: "run partial memangkas item lama; item `b` terakhir yang ok tetap ada".

### C4 — MAJOR · Item `secrets` dilindungi selamanya setelah dimatikan → **TERIMA SEBAGIAN** (versi lebih sederhana)

- **Alasan**: bug-nya nyata. Tetapi tombol "Hapus juga cadangan kunci rahasia" menambah aksi, endpoint, dan dialog. Ada aturan yang lebih sederhana dan memenuhi kebutuhan yang sama.
- **Perubahan**: saat `include_secrets=off`, `planPrune` menjadikan **semua** item `secrets` kandidat tanpa melihat umur, lalu menghapusnya setelah run berikutnya yang tidak `failed`. Dialog switch-off (PLAN/05) cukup memberi tahu: "Cadangan kunci rahasia yang sudah ada dihapus setelah pencadangan berikutnya." Test: on → run → off → run → objek `secrets` dihapus.

### C5 — MAJOR · DB hasil pulih ikut dicadangkan dan bisa dihapus setelah dipakai → **TERIMA**

- **Perubahan**:
  - (a) Run melewati item `database` bila namanya ada di `backup_restore` dengan `dropped_at IS NULL` **dan** `site.database` tidak memakainya.
  - (b) `DELETE …/restores/:id/database` menolak dengan 409 `in_use` bila `site.database = target` (`site.schema.ts:13`).
  - (c) `useHint` diganti: "Untuk dipakai situs, hubungkan lewat halaman situs. Database yang dipakai situs tidak bisa dihapus dari sini."
  - Ketiganya ikut fitur "Pulihkan ke database baru", yang sekarang dijadwalkan v0.3.1 (lihat X29).

### C6 — MAJOR · Sesi segar bisa dilewati → **TERIMA SEBAGIAN**

- **Alasan**: empat jalan memutar yang disebut kritikus memang ada. Usulan "hapus sesi lama saat re-auth" saya tolak: sesi lama terlihat di daftar Sesi (PLAN/05) dan bisa dicabut dengan "Keluarkan perangkat lain". Menambah logika di callback Better Auth tidak sebanding.
- **Perubahan**:
  - `assertFresh` dipasang juga di: unduh item `secrets`; `PATCH` setting yang menyalakan `backup.include_secrets` atau mengubah `backup.s3_endpoint|s3_bucket|prefix`. Pemanggilannya di route settings (milik `wkr-settings-01`, spec dari PLAN ini).
  - PLAN/05 memetakan 403 `reauth_required` di form Pengaturan.
  - Kalimat jujur ditambahkan di docs dan copy: "Sesi segar mencegah pemakaian cookie curian di perangkat lain, bukan akun Google yang diambil alih."

### C7 — MAJOR · Event notifikasi dan Problem tidak cocok dengan PLAN/02 → **TERIMA**

- **Perubahan**:
  - `backup.events.ts`, `backup.problems.ts`, dan tipe event dihapus.
  - PLAN/04 hanya menetapkan **kode, kind, severity, params, href, dan input datanya**. Aturannya ditulis di `overview.problems.ts` (02) oleh `wkr-mon-rules-01`.
  - "Pulih" otomatis terjadi saat Problem tertutup.
  - Ditulis jujur: `key_mismatch` tidak bisa dikirim ke Telegram karena tokennya ikut terkunci. Token Telegram tidak dipindah keluar dari enkripsi.
  - Kontrak lengkap ada di §3.7.

### C8 — MAJOR · Snapshot, aset rilis, dan attestation bertentangan dengan PLAN/05 → **TERIMA**

- **Perubahan**:
  - `release.yml`, `package-release.sh`, `install-release.sh`, `ci.yml`, dan `dependabot.yml` dipegang PLAN/05 (`wkr-dist-01`).
  - Nama aset mengikuti PLAN/05: `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`.
  - PLAN/04 memberi **gerbang keamanan wajib** (K19, daftar periksa) dan me-review diff. Isinya: `actions/attest@<sha>` (bukan `attest-build-provenance`), `subject-checksums: SHA256SUMS` atau `subject-path`, `permissions` per job (`contents: write`, `id-token: write`, `attestations: write`), dan catatan "attestation butuh repo publik".
  - Snapshot tetap di boot (K9). Teks PLAN/05 F9.4 harus diganti menjadi "installer tidak membuat snapshot; panel membuatnya saat boot; installer mencetak snapshot terbaru di petunjuk rollback".

### C9 — MAJOR · Pola `--exclude` tar bisa membuang data → **TERIMA**

- **Alasan**: semantik default GNU tar (`--no-anchored`, `--wildcards-match-slash`) memang cocok di kedalaman mana pun.
- **Perubahan**:
  - Daftar entri dibangun di kode: `readdir(sitesDir)` → file di level atas ikut semua. Untuk setiap folder situs, `readdir` lalu buang nama yang ada di `SITE_BINARY_NAMES = ["app","app.prev","app.new",".app.prev.drop",".app.swap"]` + `node_modules`, **hanya di level 1**.
  - Hasilnya `tar -czf f -C sitesDir <entri…>` tanpa `--exclude`.
  - Konstanta `SITE_BINARY_NAMES` diekspor PLAN/03 dari `src/shared/site.types.ts` (W0 kontrak).
  - Situs dengan `site.dir` di luar `sitesDir` → item mendapat `warning`.
  - Test: `sites/a/data/app/x.txt` ada di arsip, `sites/a/app` tidak.

### C10 — MAJOR · Permintaan PLAN/03 dan PLAN/05 tidak dijawab → **TERIMA**

- **Perubahan** (tabel §7):
  - `src/shared/audit.types.ts` (W0) memuat union `AuditAction` lengkap dari semua PLAN.
  - `listAudit` menerima `action: string[]` (OR, prefix bila diakhiri `.`).
  - Aksi `setup.update` dan `backup.verify` dimasukkan ke union.
  - `lastGoodItem(db, kind, name)` dipakai 02 (`lastBackupAt`) dan 03 (dialog hapus situs). Nama `lastSuccessfulBackupOf` tidak dipakai.
  - `beat()` **tidak** dipasang, mengikuti X30 (heartbeat ditunda). Sebagai gantinya backup engine mengekspor `backupScheduler.lastTickAt(): Date | null` untuk Kesehatan sistem.
  - `describe()` tidak perlu diekspor, karena uji koneksi S3 sekarang diimplementasikan di backup engine PLAN/04 (X4).

### C11 — MAJOR · Kepemilikan file lintas PLAN bentrok → **TERIMA**

- **Perubahan**: §7 sekarang mengikuti jadwal global kritik integrasi §5:
  - `wkr-db-01`: semua migrasi, 0006 = PLAN/04.
  - `wkr-settings-01`: `settings.service.ts`.
  - `wkr-http-01`: `api.handler`, `spa.serve`, `api.routes` W1.
  - `wkr-adapters-01`: `src/server/system/*`.
  - `wkr-boot-03`: `boot.ts`.
  - `wkr-dist-01`: `.github/*` dan installer.
  - Worker PLAN/04 tinggal `wkr-keys-02`, `wkr-audit-02`, `wkr-backup-engine-02`, dan `wkr-backup-web-03`. Spec titipan per file tercantum.

### C12 — MAJOR · Kriteria DR terlalu lemah → **TERIMA**

- **Perubahan**: gerbang rilis v0.3.0 = satu latihan penuh F11 dengan `include_secrets=off` di HP/emulator kedua. Checklist hasilnya dicatat di CHANGELOG:
  - situs X merespons lewat hostname;
  - DB X berisi N baris;
  - super_admin aktif;
  - token diisi ulang;
  - panel start sendiri setelah reboot;
  - hanya satu konektor di dashboard tunnel.

  Test otomatis ditambah: `<stem>SHA256SUMS` hasil run mock lolos `sha256sum -c` di temp dir.

### C13 — MAJOR · Manifest kurang informasi DR → **TERIMA**

- **Perubahan**: `BackupManifest` ditambah:
  - `paths { dataDir, sitesDir, cloudflaredDir, panelDir }`;
  - `postgresVersion`, `appBaseUrl`;
  - `tunnel { ref, credentialsFile }` (`ref` dari `config.yml` `tunnel:`, nama berkas kredensial saja);
  - `sites [{ name, database, needsBinary }]`;
  - `restoreSteps: string[]`.

  `<stem>SHA256SUMS` (format `hash  nama`) diunggah sebelum manifest. Tidak ada secret di kedua file.

### C14 — MINOR · Urutan item → **TERIMA**

- **Perubahan**: urutannya menjadi `globals → database… → sites → cloudflared → secrets → panel → SHA256SUMS → manifest`. Didokumentasikan bahwa run terakhir tampil "Terputus" setelah DR, dan itu wajar.

### C15 — MINOR · "Terverifikasi" melebih-lebihkan → **TERIMA**

- **Perubahan**: badge menjadi "Diperiksa" dengan `title` "Struktur file dicek sebelum diunggah. Bukti bisa dipulihkan: Uji pemulihan." Field tipe `verified` diganti nama menjadi `checked`.

### C16 — MINOR · Urutan "terbaru" memakai jam dinding → **TERIMA SEBAGIAN**

- **Diterima**: urutan memakai `rowid` (urutan insert) untuk `protectedRuns`, `lastGood`, dan "run terakhir". `startedAt` di masa depan (> now + 1 jam) dianggap stale. Ditambah satu test murni untuk jam mundur.
- **Ditolak**: "tolak `start()` bila `now < startedAt` run terakhir". Pada contoh kritikus sendiri (jam sempat 2030 lalu dikoreksi), aturan ini **mematikan cadangan bertahun-tahun**, dan itu lebih buruk daripada masalah yang mau dicegah. SigV4 (`RequestTimeTooSkewed`) sudah membuat run berjam-salah gagal total.

### C17 — MINOR · Audit `auth.sign_in_failed` dari endpoint publik → **TERIMA**

- **Perubahan**: aksi `auth.sign_in_failed` dihapus. Sebagai gantinya `log.warn` per menit dengan jumlah dan kode error (`[auth] N failed sign-in callbacks in the last minute: state_mismatch×3`).

### C18 — MINOR · Detail guard CSRF → **TERIMA**

- **Perubahan**:
  - Gelombang 0 = orkestrator merge `main` (`112de15`) → branch. Konflik hanya `api.routes.ts` (X15), dan `.onRequest` dipertahankan sementara.
  - Klaim K1 dikoreksi: DoS kuota baru muncul setelah merge.
  - `tests/csrf.origin.test.ts` dimigrasi `wkr-http-01` ke `servePanel`/`createApiHandler`, dengan ekspektasi tetap 403. Kasus `PUT /api/dev/settings/sites.dir` diganti `PATCH /api/dev/settings` sesuai X3.
  - Log `[csrf]` di-throttle: maksimal satu baris per host origin per menit, plus jumlah.
  - Pemanggil `createApiHandler` = `servePanel` di `spa.serve.ts`.

### C19 — MINOR · Threat model belum lengkap → **TERIMA SEBAGIAN**

- **Diterima**:
  - Baris "akun Google super_admin diambil alih" dan "binary situs disusupi" ditambahkan.
  - README menyarankan 2-Step/passkey dan kebijakan Access dengan faktor kedua.
  - `adminTrust` ditambah kalimat "program situs juga bisa membaca kunci panel".
  - Problem persisten `backup_secrets_included` (security, warning) selama `include_secrets=on`.
- **Tidak diambil**: notifikasi per event untuk `secret.export` / perubahan endpoint S3. PLAN/02 K11 menolak kanal per event, dan audit sudah mencatat keduanya. Tidak ada ruang di mesin Problem untuk "event sekali".

### C20 — MINOR · Kejujuran tentang yang tidak bisa dipulihkan → **TERIMA**

- **Perubahan**:
  - Baris "Tidak dicadangkan" ditampilkan dari `excluded`: "Binary situs (simpan file build-nya sendiri)", `cert.pem`, dan kunci rahasia bila off.
  - Warning muncul bila `includeSecrets=off && exportedAt=null`.
  - `resetBody` dibangun dari `unreadableSettings` (label dari `id.settings` PLAN/05).
  - Teks file kunci data memakai `SVDIR=$PREFIX/var/service`.
  - `exportBody` ditambah kalimat "Pindahkan dari folder Unduhan ke pengelola kata sandi, lalu hapus."

### C21 — MINOR · Perkiraan ruang dan peringatan item → **TERIMA**

- **Perubahan**: perkiraan ruang = `sizeBytes` item yang sama di run terakhir (fallback `sizeBytes` DB untuk dump, 0 untuk lainnya). `BackupItem.warning: string | null` ditambahkan dengan kode `file_changed | outside_sites_dir | retention_denied`, dan riwayat menampilkan badge "Disalin saat berubah".

### C22 — MINOR · Tabel keputusan rusak → **TERIMA**

- **Perubahan**: `|` di dalam backtick ditulis ulang dengan " / ". Tabel keputusan dicek setelah `biome format`.

### C23 — MINOR · Snapshot: ketersediaan vs keamanan → **TERIMA**

- **Perubahan**:
  - Bila snapshot gagal: file parsial dihapus, lalu `await Bun.sleep(60_000)` sebelum `exit(1)` agar crash-loop runit melambat.
  - Preflight ruang (≥ 2 × `panel.db` + 256 MB) dan petunjuk rollback (`panel.prev` + snapshot terbaru + `PANEL_SKIP_SNAPSHOT=1`) diminta ke `install-phone.sh` (PLAN/05 `wkr-dist-01`).

### C24 — OVER · Tiga setting baru sebaiknya konstanta → **TERIMA**

- **Perubahan**: `KEEP_MIN_RUNS = 3`, `MAX_ITEM_MB = 2048`, dan `AUDIT_RETENTION_DAYS = 365` menjadi konstanta. Setting baru hanya `backup.include_secrets`. Daftar key 04 untuk `wkr-settings-01` (X3) ikut menyusut menjadi satu.

### C25 — OVER · `secret_check` + HKDF → **TERIMA** (sama dengan C1)

---

## Bagian `00-integration-critique.md` yang menyentuh PLAN/04

| #                            | Verdict                                           | Perubahan di PLAN/04                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1 `release.yml` dua pemilik | TERIMA                                            | Lihat C8. PLAN/04 memegang gerbang + review saja                                                                                                                                                                                                                                                                      |
| X2 `DevAuditEntry`           | TERIMA                                            | Bentuk datar 04 dipakai. `targetLabel` tidak ada. Tipe ditulis `wkr-contracts-00` (W0)                                                                                                                                                                                                                                |
| X3 `settings.service.ts`     | TERIMA                                            | Key 04 = `backup.include_secrets` saja. `KeyMismatchError` + `unreadableSecretSettings` + aturan `assertFresh` untuk key S3/secrets ada di spec `wkr-settings-01`                                                                                                                                                     |
| X4 uji S3 dua kali           | TERIMA                                            | Satu endpoint `POST /api/dev/backup/verify`, bentuk `BackupVerify` 05 (nilai tersimpan, langkah write/read/delete). Implementasinya `backup.verify.ts` oleh `wkr-backup-engine-02`, aksi audit `backup.verify`. `BackupTestInput/Result` dihapus. Kode `delete_denied` ditafsirkan ramah untuk opsi token tanpa hapus |
| X5 header aset               | TERIMA (pengukuran saya salah: tanpa `--compile`) | K17 dibatalkan. Tabel PLAN/01 §3.12 diimplementasikan `wkr-http-01` di `spa.serve.ts` lewat server bundle internal `127.0.0.1:0` + proksi. Cara ini juga menggantikan K16 (tidak ada `/__spa` di server utama, sehingga 404). `/api/*` mendapat `cache-control: no-store`. Test di binary `build:local`               |
| X6 `index.ts`                | TERIMA                                            | Boot F7 ada di `boot.ts` (`wkr-boot-03`, W3) dengan fungsi bernama dari §3.7                                                                                                                                                                                                                                          |
| X7 / X26 migrasi             | TERIMA                                            | `0006_data_safety` (`wkr-db-01`, W0/W1): kolom `audit_log` + `backup_run` + backfill, setiap pernyataan dipisah `--> statement-breakpoint`. Tabel `backup_restore` ditunda ke migrasi v0.3.1 bersama fiturnya                                                                                                         |
| X10 aturan masalah           | TERIMA                                            | Lihat C7                                                                                                                                                                                                                                                                                                              |
| X11 cabut sesi pengguna      | TERIMA                                            | Implementasi `revokeUserSessions` di `sessions.service.ts` (04). Route di `dev.routes.ts` (05). 409 untuk diri sendiri **dan** super admin env. Audit `session.revoke {userId, revoked}`. `session.revoke_all` hanya untuk "Keluarkan semua pengguna" (v0.3.1)                                                        |
| X12 deteksi Access           | TERIMA                                            | `accessSeen.at` (04) = sumber tunggal. 05 membacanya lewat `GET /api/dev/security`                                                                                                                                                                                                                                    |
| X13 `install-phone.sh`       | TERIMA                                            | Pemilik 05. Permintaan 04: preflight ruang + petunjuk rollback, tanpa snapshot                                                                                                                                                                                                                                        |
| X15 merge main               | TERIMA                                            | Lihat C18                                                                                                                                                                                                                                                                                                             |
| X17 `id.ts`                  | TERIMA                                            | `wkr-backup-web-03` tidak menyentuh `id.ts`. Penggabungan dilakukan oleh `wkr-cleanup-04`                                                                                                                                                                                                                             |
| X18 tier                     | TERIMA                                            | "Keluarkan semua pengguna" = confirm (AlertDialog), bukan typed                                                                                                                                                                                                                                                       |
| X21 adapter                  | TERIMA                                            | Tambahan adapter 04 (§3.7) dikerjakan `wkr-adapters-01`                                                                                                                                                                                                                                                               |
| X22 `AuditAction`            | TERIMA                                            | Lihat C10                                                                                                                                                                                                                                                                                                             |
| X23 kunci lintas subsistem   | TERIMA                                            | `backup.busy()` (run atau restore) diekspor. 02 menolak restart `panel` bila busy. 03 `database_drop` menolak `busy` selama run cadangan                                                                                                                                                                              |
| X27 `lastGoodItem`           | TERIMA                                            | Lihat C10                                                                                                                                                                                                                                                                                                             |
| X28 onboarding kunci data    | TERIMA                                            | Selesai otomatis bila `exportedAt !== null`, centang manual tetap ada, teks kondisional terhadap `includeSecrets`                                                                                                                                                                                                     |
| X29 pangkas v0.3.0           | TERIMA SEBAGIAN (menunggu jawaban pemilik)        | Ditunda ke v0.3.1: Pulihkan ke database baru + `backup_restore`, umur sesi absolut + keluarkan semua pengguna, retensi audit. **Tetap di v0.3.0**: `stat` pasca-unggah (3 baris, satu-satunya bukti ukuran di R2), unduh kunci data + `assertFresh`                                                                   |

---

## Usulan kontrak kanonik (untuk arbitrase koordinator)

1. **Masalah (PLAN/02 ↔ 04)**:
   - `ProblemKind` ditambah `"security"` (ditulis `wkr-contracts-00` di `monitor.types.ts`). Kode baru:
     - `key_mismatch` (security, danger, params `{ count }`, href `/dev/health#kunci-data`);
     - `access_not_seen` (security, warning, href `/dev/health#access`);
     - `backup_secrets_included` (security, warning, href `/panel/backups`);
     - `backup_item_stale` (backup, warning, params `{ itemKind, name, hours }` dengan `hours` null bila belum pernah berhasil, target `<kind>:<name>`, href `/panel/backups`).
   - Aturannya di `overview.problems.ts` (02). Inputnya dari PLAN/04: `backup.status()` (tidak pernah melempar karena kunci), `dataKeyState()`, `accessSeen.at`.
   - `backup_status_error` (02) tetap ada untuk error selain kunci. Saat kunci tidak cocok, yang muncul hanya `key_mismatch`.
   - Tidak ada API `notify()`. Pemulihan masalah = Problem tertutup.
2. **Snapshot (PLAN/05 ↔ 04)**:
   - Hanya saat boot, sebelum migrasi tertunda.
   - Lokasi `<dataDir>/snapshots/panel.db.<prevVersion>.<yyyymmddHHMMSS>` (mode 600), simpan 3.
   - `install-phone.sh` tidak membuat snapshot. Saat cek kesehatan gagal, installer mencetak `panel.prev` + `ls -t ~/panel/data/snapshots | head -1` + `PANEL_SKIP_SNAPSHOT=1`.
3. **Rilis (PLAN/05 ↔ 04)**:
   - Pemilik `release.yml`, `ci.yml`, `dependabot.yml`, `package-release.sh`, `install-release.sh`, `install-phone.sh` = PLAN/05 `wkr-dist-01`.
   - Nama aset = `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`.
   - Gerbang keamanan wajib (diperiksa PLAN/04 sebelum merge):
     - `bun install --frozen-lockfile`, `bun audit --audit-level=high` (gagal = stop), typecheck, lint, test, build;
     - action dipin ke commit SHA, tanpa `actions/cache`, `permissions` per job minimal;
     - `actions/attest@<sha>` dengan `subject-checksums: SHA256SUMS`;
     - installer memverifikasi `sha256sum -c` sebelum ekstrak.
4. **Kepemilikan file bersama**:
   - `drizzle/*` + `db/schema/*` → `wkr-db-01` (satu worker, migrasi berurutan, 0006 = 04).
   - `settings.service.ts` → `wkr-settings-01`.
   - `api.routes.ts` → `wkr-http-01` (W1: hapus `.onRequest`), lalu `wkr-boot-03` (W3: mount `security.routes` + `handleAuthRequest`).
   - `index.ts` → dipecah di W0 menjadi `boot.ts` (`wkr-boot-03`) dan `http/spa.serve.ts` (`wkr-http-01`).
   - `src/server/system/*` → `wkr-adapters-01`.
   - `audit.types.ts`, `security.types.ts`, `backup.types.ts`, `dev.types.ts` → `wkr-contracts-00`.
5. **Fungsi yang diekspor PLAN/04 untuk PLAN lain**:
   - `lastGoodItem(db, kind, name)`
   - `backup.busy()`
   - `backupScheduler.lastTickAt()`
   - `dataKeyState(deps)`
   - `accessSeen`
   - `revokeUserSessions(db, userId)`
   - `KeyMismatchError` (dari `settings.service.ts`)

## Pertanyaan pemilik yang masih terbuka (default dipakai sampai dijawab)

1. **Token R2 tanpa izin hapus + lifecycle rule**: default = **opsi P1 yang didokumentasikan, tidak dipaksakan**. Panel mendeteksi `AccessDenied` saat prune, lalu mencatat `retention_denied` sebagai warning run. Status tetap `succeeded`, dan UI menjelaskan bahwa retensi diserahkan ke bucket.
2. **Binary situs**: default = **tidak dicadangkan**. Pemilik membangun ulang dari kode sumber/CI, dan UI menyatakannya terang-terangan ("Binary situs tidak dicadangkan. Simpan file build-nya sendiri").
3. Pangkas v0.3.0 (X29): daftar tunda di atas dipakai bila pemilik setuju.
