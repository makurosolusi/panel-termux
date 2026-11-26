# PLAN 05 — Administrasi, onboarding, profil, login, landing publik & distribusi

> wkr-plan-admin-01 · 2026-11-26 · branch `feature/production-polish`. Dokumen rencana, tidak ada kode yang diubah.
> Sumber: `R&D/05-admin-onboarding-landing.md` (gap G1–G28), dengan rujukan silang ke R&D-01 (shell), R&D-02 (monitoring),
> R&D-03 (situs), R&D-04 (keamanan), PLAN/01–04, `PLAN/debate/05-critique.md` dan `PLAN/debate/00-integration-critique.md`.
> Klaim kode diverifikasi ulang. Dua probe dijalankan di scratchpad (tidak menyentuh repo), lihat K14 dan K15.

Konvensi dokumen: **[TERBUKA]** = default sementara, menunggu pemilik; **[DEP PLAN/0x]** = kontrak yang harus dipenuhi PLAN lain;
**[VERIF]** = fakta yang sudah dicek (kode, docs, atau probe). Revisi 1 (debat) dirangkum di "Riwayat revisi" di akhir file;
jawaban per temuan ada di `PLAN/debate/05-response.md`.

**Keputusan pemilik yang mengikat** (selain brief): `backup.include_secrets` default `off`; LICENSE MIT, pemegang hak makurosolusi;
rilis publik pertama **v0.3.0**; tamu di URL tak dikenal → 404 publik.
**Selaras dengan `PLAN/DECISIONS.md`** (mengikat; revisi 2): A8 lingkup penuh di v0.3.0, A11/B19 beranda super_admin = `/panel`,
B4 cadangan belum diatur & Access belum terdeteksi = informasi, B5 tanpa heartbeat, B6 cabut sesi kecuali diri sendiri, B7 uji S3,
B8 PATCH pengaturan, B9 rilis, B10 snapshot di boot, B11 header HTML, B13 `usePoller`, B17 test CSRF.
**Default [TERBUKA]** yang tetap berlaku: `/profile` di luar path Cloudflare Access (pemilik tidak keberatan; tetap ditandai default).

---

## 1. Tujuan & ruang lingkup

### 1.1 Tujuan

1. Super admin baru tahu persis apa yang harus disiapkan (Access, kunci data, cadangan, token) dan bisa memeriksanya dari satu tempat.
2. Halaman Administrasi menjawab pertanyaan operator: "panel sehat?", "siapa melakukan apa?", "pengaturan ini benar?".
3. Semua teks yang terlihat berbahasa Indonesia sesuai `docs/content-guide.md`, termasuk teks yang hari ini datang dari server.
4. `/` menjadi halaman produk publik yang membuat pengunjung bisa **memasang Panel Termux di HP-nya sendiri** dari rilis
   GitHub, tanpa build sendiri, dengan daftar langkah yang jujur. Pintu masuk pemilik hanya tautan kecil "Masuk".
5. Peran `user` tidak lagi jalan buntu, juga di instance yang memakai Cloudflare Access.

### 1.2 Masuk ruang lingkup (menutup gap R&D-05)

| Area                        | Gap R&D-05 yang ditutup                             | Gap domain lain yang ikut tertutup                       |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Kesehatan sistem + vonis    | G10, G5 (halaman /dev), G19 (/dev)                  | R&D-04 G4 (tampilan "tidak bisa dibaca")                 |
| Onboarding super_admin      | G4                                                  | R&D-04 G7 (pengingat Access), G16 (pengingat kunci data) |
| Pengguna                    | G7, G20, G26                                        | R&D-04 G13 (UI cabut sesi pengguna lain)                 |
| Audit (UI)                  | G6 (tampilan), G11, G19                             | — (skema milik PLAN/04)                                  |
| Log panel                   | G25, G19                                            | (G12 kebisingan: sudah ditutup PLAN/02 K16)              |
| Pengaturan                  | G3, G8, G9, G18                                     | R&D-02 notifikasi (UI grup Telegram)                     |
| Profil + peran `user`       | G2, G17                                             | R&D-04 G13 (UI sesi sendiri)                             |
| README resep Access         | G2 (di produksi: `/profile` keluar dari Access)     | R&D-04 G7                                                |
| Login                       | G24 (bagian login), G16 (brand login)               | R&D-01 G17                                               |
| Landing produk              | G1, G13, G14, G15, G16, G21, G22                    | R&D-01 G18                                               |
| Rute tak dikenal untuk tamu | G24 (bagian rute) — aturan & copy; klien di PLAN/01 | R&D-01 G16                                               |
| Distribusi                  | G13, G14 (LICENSE, rilis, skrip instal)             | R&D-04 G23 (`bun audit` di pipeline rilis)               |

### 1.3 Di luar ruang lingkup (pemilik lain, dikonsumsi di sini)

- **PLAN/01**: komponen bersama, shell, bottom bar, tier `ConfirmAction` (`confirm` | `typed`), `useApiQuery` jeda saat tab
  tersembunyi, router `lazy` + `splitting`, `Cache-Control` aset, **`LogViewer`**, klien rute tak dikenal (`isProtectedPath` +
  `isKnownSpaPath` di `roles.ts`, `resolveRedirect`, `router.tsx`, `public-not-found.page.tsx`). PLAN/05 memberi aturan K16 dan copy.
- **PLAN/02**: sampler, `Problem[]`/`computeProblems`, kanal Telegram (kunci `alerts.*` + `monitor.sample_interval_sec`,
  `POST /api/dev/alerts/test`, `POST /api/dev/alerts/telegram/chats`), kebisingan log request (K16 GET < 400 → debug).
- **PLAN/04**: skema & isi audit, `SecurityStatus`, kunci data (`KeyMismatchError`, kit pemulihan, `secret_check`), CSRF,
  **implementasi uji S3** (`backup.verify.ts`), `revokeUserSessions`, snapshot pra-migrasi di boot, `ci.yml` + `dependabot.yml`,
  review keamanan `release.yml`.
- **`wkr-http-01`** (lintas PLAN, X5/X6): penyaji `src/server/http/spa.serve.ts` hasil pecahan `index.ts`; PLAN/05 menyediakan `seo.ts` murni.
- **`wkr-settings-01`** (lintas PLAN, X3): `settings.service.ts`, `settings.registry.ts`, rute settings di `dev.routes.ts`, semua kunci baru.
- **Dikembalikan ke v0.3.0 (A8, gelombang akhir boleh)**: `sitemap.xml`, screenshot landing terang **dan** gelap, `og.png`, filter rentang
  tanggal audit (API PLAN/04 `from/to`), ekspor audit CSV (G28), hapus akun sendiri untuk peran `user` (G27), tombol "Keluarkan semua
  pengguna" (UI untuk `POST /api/dev/sessions/revoke-all` PLAN/04), UI `audit.retention_days`.
- Tetap di luar (bukan pemangkasan debat): allowlist email (A4 login terbuka), "Minta akses" bernotifikasi ke super admin (P2 R&D, butuh
  kanal ke super admin di luar Telegram pemilik), deteksi downgrade versi (B5: tidak ada heartbeat/cek yang tidak bisa gagal).
- Ditolak: root `/` = login (O2 R&D-05), karena keputusan pemilik 2.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Alternatif                                                        | Alasan                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Teks pengaturan pindah ke web** (L2): server mengirim `key`, `default`, status; label, bantuan, placeholder, pesan validasi ada di `src/web/i18n/id.settings.ts`, diindeks `SettingKey`. `DevSetting.label/description` **dihapus**; registri server tidak memuat label.                                                                                                                                                                                                                                             | L1: terjemahkan di server                                         | Satu sumber teks UI. Satu-satunya konsumen `label/description` adalah web. `satisfies Record<SettingKey,…>` memaksa kelengkapan. Teks Indonesia PLAN/02 §3.6 dan PLAN/04 §5.3 disalin ke sini.                                                                                          |
| K2  | Pesan validasi **satu per kunci** (`fields[key].invalid`)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Kode alasan + `params`                                            | Tiap kunci punya satu validator.                                                                                                                                                                                                                                                        |
| K3  | **Simpan per grup** lewat `PATCH /api/dev/settings` (atomik per request: semua valid atau tidak ada yang ditulis). `PUT /api/dev/settings/:key` dihapus. `setSetting(deps, key, value, actor)` **tetap ada** sebagai pembungkus satu kunci atas `setSettings`. Atomik **tidak** berarti menegakkan kelengkapan grup (PATCH satu kunci S3 tetap sah).                                                                                                                                                                   | Pertahankan PUT + tambah batch                                    | Grup yang disimpan bersama tidak setengah jadi. Pembungkus menjaga semua pemanggil server dan test yang ada tidak berubah.                                                                                                                                                              |
| K4  | **Uji koneksi**: S3 menerima **draft** (field yang tidak dikirim memakai nilai tersimpan, rahasia yang tidak diubah tidak dikirim), jadi bisa diuji **sebelum** disimpan. Cloudflare menguji token tersimpan. Telegram selalu manual (mengirim pesan sungguhan). Setelah simpan, uji otomatis hanya untuk Cloudflare/S3 **dan hanya bila kunci koneksinya berubah**.                                                                                                                                                   | Uji nilai tersimpan saja; uji otomatis tiap simpan                | Kredensial salah tidak perlu menimpa yang bekerja; mengubah `backup.hour` tidak memicu tulis ke bucket; Telegram punya batas 1 per 5 dtk. Token Cloudflare draft butuh mengubah `dns.provider.ts` (PLAN/03), sedangkan token salah tidak merusak apa pun (DNS dilewati dengan catatan). |
| K5  | Satu endpoint uji S3 `POST /api/dev/backup/verify`, **implementasi PLAN/04**, langkah `write → read → list → delete` pada objek `<prefix>.panel-termux-check-<rand>`. PLAN/05 memiliki UI + pemetaan kode → teks.                                                                                                                                                                                                                                                                                                      | Dua endpoint (04 `/test`, 05 `/verify`)                           | Pemetaan error S3 dan `describe()` ada di mesin cadangan PLAN/04. `list` diuji karena `prune()` hari ini me-list (`backup.service.ts:38`); bila retensi final PLAN/04 tidak me-list, langkah itu dibuang tanpa mengubah UI.                                                             |
| K6  | Onboarding = kartu "Siapkan Panel Termux" di **atas `/dev`**, plus **banner ringkas di Ringkasan `/panel`** untuk super_admin (beranda super_admin = `/panel`, A11/B19) yang menaut ke kartu itu. Status tutup & centang manual disimpan server-side di `app_meta` (tanpa migrasi).                                                                                                                                                                                                                                    | localStorage; tabel `setting`                                     | Super admin pindah perangkat. `app_meta` tidak muncul di Pengaturan. [VERIF] PK `key`, upsert idempoten, ikut cadangan `panel.db`.                                                                                                                                                      |
| K7  | **Status Access dan kunci data dibaca dari `SecurityStatus` PLAN/04**, tidak dihitung ulang. Access selesai bila `access.lastSeenAt !== null` atau dicentang manual. Kunci data selesai bila `dataKey.exportedAt !== null` atau dicentang manual **dengan sidik** `app_meta.onboarding.secret_saved.check` = `secret_check` saat itu (basi otomatis setelah reset kunci).                                                                                                                                              | Header pada request onboarding itu sendiri                        | Satu jawaban untuk "Access aktif?" dan "kunci tersimpan?". [VERIF] Cloudflare mengirim JWT di `Cf-Access-Jwt-Assertion`. Deteksi tetap petunjuk; validasi JWT = P2 PLAN/04.                                                                                                             |
| K8  | **Vonis kesehatan = `Problem[]` PLAN/02 + tiga cek khusus panel**, dihitung server. Kode masalah informasi (`backup_not_configured`, `access_not_seen`) tidak menurunkan vonis (B4). Cek panel: `errors` (hanya respons **500**, warn ≥ 3, fail ≥ 10 dalam 5 mnt), `sampler` (`monitor.status().sampledAt` lebih tua dari `max(3 × monitor.sample_interval_sec, 10 mnt)` → warn), `backup_scheduler` (`backupScheduler.lastTickAt()` lebih tua dari 10 mnt → warn), `fake_on_https` (fail). Tanpa `heartbeat.ts` (B5). | Aturan cek sendiri (revisi 0)                                     | Ringkasan dan Kesehatan tidak memberi dua vonis berbeda. 502/503 yang dipetakan (uji Telegram gagal, runit tak terbaca, boot) bukan bug panel. Doze bisa menunda timer, jadi sampler terlambat = warn, bukan fail.                                                                      |
| K9  | "Terakhir aktif" = `max(session.updated_at)`, fallback `max(audit_log.at)` aksi `auth.sign_in`; ditampilkan **beresolusi hari** ("Aktif hari ini" / "kemarin" / tanggal).                                                                                                                                                                                                                                                                                                                                              | Kolom `user.last_sign_in_at`                                      | Tanpa migrasi. [VERIF] Better Auth memperbarui `updated_at` paling sering sekali per `updateAge` 24 jam, jadi resolusi menit tidak jujur.                                                                                                                                               |
| K10 | Landing = halaman produk publik. CTA utama "Pasang di HP-mu" → `#pasang`; "Masuk"/"Buka panel"/"Akun saya" = tautan teks kecil di header.                                                                                                                                                                                                                                                                                                                                                                              | —                                                                 | Mengikat (keputusan pemilik 2).                                                                                                                                                                                                                                                         |
| K11 | Instal dari rilis: dua langkah (unduh skrip, jalankan), bukan `curl … \| sh`.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pipe ke `sh`                                                      | Skrip bisa dibaca dulu ("Lihat isi skrip").                                                                                                                                                                                                                                             |
| K12 | Rilis: `release.yml`, `ci.yml`, `dependabot.yml`, `install-release.sh` milik **PLAN/05** (`wkr-dist-01`, B9); PLAN/04 menetapkan gerbang keamanan dan me-review. Trigger tag `v*`; `workflow_dispatch` `dry_run` **wajib hijau sebelum tag**. Aset bernama **tetap**: `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`. `install.sh` membawa versinya sendiri (`PANEL_VERSION_DEFAULT`). Provenance `actions/attest@v4`. Rilis dengan `gh` CLI.                                                         | Aset mentah `panel-android-arm64` (04); `attest-build-provenance` | URL landing `releases/latest/download/install.sh` stabil; tarball membawa `install-phone.sh`, run script, `.env.example` yang dibutuhkan instalasi. [VERIF] `actions/attest` v4 = penerus resmi; repo PUBLIC → attestation tersedia.                                                    |
| K13 | `LICENSE` = MIT, `Copyright (c) 2026 makurosolusi`. `package.json` `"license": "MIT"`; `private: true` tetap.                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                 | Keputusan pemilik. Landing menulis "kode terbuka (MIT)" setelah file ada di `main`.                                                                                                                                                                                                     |
| K14 | Landing dari **chunk awal kecil**; rute lain `lazy`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | HTML statis terpisah                                              | [VERIF] probe Bun 1.4.2: `--compile` + HTML import + `splitting: true` menghasilkan chunk lazy yang dilayani; tanpa `splitting` kode di-inline. Router & build milik PLAN/01 [DEP].                                                                                                     |
| K15 | Screenshot landing = **4 tampilan × 2 tema (8 WebP)** dari panel yang berjalan dalam **mode fake** (otomatis di luar Termux) + data seed, di-import dari TSX; varian mengikuti tema (A8 lingkup penuh). `og.png` dibuat dari screenshot hero dan di-commit.                                                                                                                                                                                                                                                            | Mock HTML; 8 gambar terang+gelap                                  | [VERIF] probe: import `.webp` menjadi URL ber-hash `image/webp`. Empat gambar cukup dan murah dirawat.                                                                                                                                                                                  |
| K16 | **Tamu di alamat tak dikenal** → 404 publik (logo, "Ke beranda", "Masuk"), HTTP **404** + `noindex`. Tamu di area privat (`/profile`, `/panel/*`, `/dev/*`) → `/login`. Pengguna login → 404 di dalam shell. Server: `isKnownSpaPath` false → status 404.                                                                                                                                                                                                                                                              | Redirect ke landing; ke `/login`                                  | Keputusan pemilik. Tidak ada soft-404. Klien dikerjakan PLAN/01 1c.                                                                                                                                                                                                                     |
| K17 | SEO lewat server: `robots.txt` (hanya `Disallow: /api/` + baris `Sitemap:`), `sitemap.xml` (satu URL `/`), `og.png`, `apple-touch-icon.png` sebagai route nyata; semua HTML SPA (termasuk 404) `Cache-Control: no-cache` (B11); OG/canonical absolut dari `APP_BASE_URL` disuntik ke HTML `/`; path lain `X-Robots-Tag: noindex, nofollow`. Canonical ke instance sendiri. HTML yang ditulis ulang **tanpa** `ETag`/`Last-Modified`, jadi tidak pernah 304.                                                            | Disallow per path privat; sitemap                                 | Disallow menghalangi crawler membaca `noindex`. Sitemap satu URL tidak menambah apa pun; `/sitemap.xml` kini 404 sungguhan.                                                                                                                                                             |
| K18 | Satu logomark (`LogoMark` oranye) dan satu nama "Panel Termux" di landing, login, 404, app. Serif landing dipertahankan.                                                                                                                                                                                                                                                                                                                                                                                               | Samakan tipografi                                                 | Logomark & nama harus satu.                                                                                                                                                                                                                                                             |
| K19 | Promosi ke Admin = dialog `confirm` dengan penjelasan jujur ("Admin = kendali penuh atas HP") **dan** catatan "tambahkan email ke policy Access". Hapus pengguna = `typed` (ketik email), dengan kalimat "ia tetap bisa masuk lagi sebagai Pengguna".                                                                                                                                                                                                                                                                  | Tanpa konfirmasi                                                  | Satu tap memberi akses setara shell; di instance ber-Access promosi saja tidak cukup.                                                                                                                                                                                                   |
| K20 | Peran `user` di `/profile` melihat kartu "Akun kamu belum punya akses ke panel ini" + langkah konkret. Tautan landing untuk `user` = "Akun saya".                                                                                                                                                                                                                                                                                                                                                                      | Tombol "Minta akses" (P2)                                         | Keputusan pemilik 4.                                                                                                                                                                                                                                                                    |
| K21 | Cabut sesi pengguna lain: **409 `self` hanya bila id = pemanggil** (B6) (termasuk boleh untuk super admin env lain). Ubah peran/hapus tetap memakai `assertMutable`.                                                                                                                                                                                                                                                                                                                                                   | Lindungi super admin env (revisi 0, usulan integrasi X11)         | Respons insiden: sesi curian super admin lain harus bisa dicabut. Cabut sesi tidak merusak; orangnya cukup login lagi.                                                                                                                                                                  |
| K22 | **Resep Access di README**: path yang dilindungi = `panel`, `dev`, `api/panel`, `api/dev`. `profile` dihapus [TERBUKA (a)].                                                                                                                                                                                                                                                                                                                                                                                            | Tetap melindungi `profile`                                        | Akun non-pemilik harus bisa melihat kartu K20. Data `/profile` datang dari `/api/me*`, yang sudah publik di balik login Google; melindungi halaman itu tidak menambah keamanan.                                                                                                         |
| K23 | `install-phone.sh` dipegang PLAN/05: exit **3** = "isi `.env`", 0 = sehat, 1 = gagal. Worker yang sama memasukkan `sv -w 130 restart panel` (PLAN/03) dan petunjuk rollback (PLAN/04).                                                                                                                                                                                                                                                                                                                                 | Tanpa pemilik (K37 integrasi)                                     | `install.sh` harus bisa membedakan "isi `.env`" dari sukses tanpa mem-parse teks.                                                                                                                                                                                                       |

Default brief yang dipakai: target sentuh ≥ 44 px di < md; judul halaman terlihat di HP; pm2/postgres terlindungi (default
`sshd,cloudflared,panel,pm2,postgres` milik PLAN/02); bottom bar vs sheet diputuskan PLAN/01.

---

## 3. Model data & kontrak API

Semua mutasi lewat `apiFetch` (mengirim `X-Requested-With`), sesuai hotfix CSRF. Error 4xx = `ApiErrorBody { error, message? }`.

### 3.1 Tipe bersama

Ditulis oleh worker kontrak lintas PLAN **W0** (`wkr-contracts-00`, dijadwalkan koordinator) di `src/shared/dev.types.ts`, dari spesifikasi berikut.
`SecurityStatus`, `RevokedSessions` ada di `src/shared/security.types.ts` (PLAN/04), `Problem`/`ProblemCode` di `panel.types.ts` (PLAN/02).

```ts
import type { Problem } from "./panel.types";
import type { PanelMode } from "./panel.types";

export type HealthStatus = "ok" | "warn" | "fail";

/** Cek khusus panel, di luar Problem[] (K8). */
export type PanelCheckKey = "errors" | "sampler" | "backup_scheduler" | "fake_on_https";
export type PanelCheck = { key: PanelCheckKey; status: HealthStatus; value: number | string | null };

/** GET /api/dev/health. Field lama dipertahankan. */
export type DevHealth = {
  verdict: HealthStatus; // terburuk dari problems (tanpa kode info) + checks
  checkedAt: string;
  problems: Problem[]; // snapshot sampler terakhir PLAN/02, termasuk kind "security" PLAN/04
  infoCodes: string[]; // kode di problems yang tidak ikut vonis (K8): ["backup_not_configured", "access_not_seen"]
  checks: PanelCheck[];
  mode: PanelMode;
  sampledAt: string | null; // monitor.status() PLAN/02 (B5)
  backupTickAt: string | null; // backupScheduler.lastTickAt() PLAN/04 (B5)
  version: string;
  schemaVersion: string; // ditampilkan di Detail saja, bukan cek
  startedAt: string;
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number };
  db: { sizeBytes: number };
  dataDir: { freeBytes: number; totalBytes: number };
  runtime: { bun: string; node: string; platform: string; arch: string };
  cpuCores: number;
  requestsPerMinute: number;
  errorCount5m: number; // semua 5xx (informasi)
  unhandled5m: number; // hanya 500 (dasar cek errors)
  counts: { users: number; sessions: number };
  runningJob: { id: string; kind: string; target: string; startedAt: string } | null;
  backup: { configured: boolean; nextRunAt: string | null } | null; // null = tak terbaca (key_mismatch)
  lastErrors: DevLogEntry[]; // maks 5 entri level error, terbaru dulu
};

/** Semua kunci setting terdaftar (urutan = urutan registri). Server & web `satisfies Record<SettingKey, …>`. */
export const SETTING_KEYS = [
  "cloudflare.api_token",
  "cloudflare.account_id",
  "sites.dir",
  "sites.port_range",
  "panel.protected_services",
  "backup.s3_endpoint",
  "backup.s3_bucket",
  "backup.s3_region",
  "backup.s3_access_key_id",
  "backup.s3_secret_access_key",
  "backup.prefix",
  "backup.hour",
  "backup.retention_days",
  "backup.keep_min_runs",
  "backup.include_secrets",
  "backup.max_item_mb",
  "audit.retention_days", // PLAN/04
  "alerts.enabled",
  "alerts.telegram_bot_token",
  "alerts.telegram_chat_id",
  "alerts.min_severity",
  "monitor.sample_interval_sec", // PLAN/02
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type DevSetting = {
  key: SettingKey;
  secret: boolean;
  value: string | null; // non-rahasia: tersimpan atau default; rahasia: selalu null
  default: string | null; // status "Bawaan" yang benar (G8)
  isSet: boolean;
  readable: boolean; // false = rahasia tersimpan tapi tak bisa didekripsi (dari dataKeyState PLAN/04)
  updatedAt: string | null;
};
export type DevSettings = { items: DevSetting[] };

/** PATCH /api/dev/settings. null = kembali ke bawaan / hapus rahasia. 1–30 kunci. */
export type DevSettingsPatch = { values: Partial<Record<SettingKey, string | null>> };
/** Body 400 dari PATCH. "unknown" = kunci tidak terdaftar. */
export type DevSettingsInvalid = {
  error: "invalid_value" | "invalid_body";
  message: string;
  fields: Partial<Record<string, "invalid" | "empty" | "unknown">>;
};

/** POST /api/dev/cloudflare/verify (token tersimpan). */
export type CloudflareVerifyCode = "ok" | "not_set" | "inactive" | "no_zones" | "api_error" | "key_mismatch";
export type CloudflareVerify = { ok: boolean; code: CloudflareVerifyCode; zones: number | null; detail: string | null };

/** Onboarding. */
export type SetupItemKey =
  | "access"
  | "secret_saved"
  | "backup"
  | "cloudflare_token"
  | "apps_json"
  | "first_site"
  | "admins";
export type SetupLevel = "required" | "recommended" | "optional";
export type SetupItem = {
  key: SetupItemKey;
  level: SetupLevel;
  done: boolean;
  source: "auto" | "manual"; // manual = selesai karena dicentang
  needsFirstRun: boolean; // hanya backup: tersimpan tapi belum ada run sukses
  applicable: boolean; // false: access saat APP_BASE_URL bukan https
};
export type DevSetup = { items: SetupItem[]; dismissedAt: string | null; complete: boolean };
export type SetupManualPut = { done: boolean };
export type SetupDismissPut = { dismissed: boolean };

export type DevUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  createdAt: string;
  lastSeenAt: string | null; // K9
  activeSessions: number;
  isEnvSuperAdmin: boolean;
};
```

Level item onboarding (C19), tetap:

| Item               | Level      | Selesai bila                                                                                             |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| `access`           | wajib      | `SecurityStatus.access.lastSeenAt !== null` atau dicentang manual; `applicable = access.https`           |
| `secret_saved`     | wajib      | `dataKey.exportedAt !== null` atau centang manual yang sidiknya = `app_meta.secret_check` sekarang       |
| `backup`           | wajib      | terkonfigurasi **dan** ada ≥ 1 run `succeeded`; `needsFirstRun` = terkonfigurasi tanpa run sukses        |
| `cloudflare_token` | disarankan | `cloudflare.api_token` `isSet`                                                                           |
| `apps_json`        | disarankan | `integration().ecosystemIncludesAppsJson` [DEP PLAN/03, bentuk bisa berubah setelah eksperimen pm2 POCO] |
| `first_site`       | disarankan | ada ≥ 1 baris `site`                                                                                     |
| `admins`           | opsional   | ada ≥ 1 pengguna peran `admin`                                                                           |

`complete` = semua item wajib + disarankan yang `applicable` selesai.

**Audit**: bentuk datar PLAN/04 dipakai apa adanya (`actor: UserRef | null`, `actorKind: "user" | "system" | "unknown"`,
`actorLabel`, `actorEmail`, `actorDeleted`, `action`, `target`, `meta`, `ipMasked`, `userAgent`, `requestId`). PLAN/05 menambah
`meta.targetEmail` saat `users.service.ts` mencatat `user.role_change` dan `user.delete` (label tetap terbaca setelah
pengguna dihapus), plus aksi `setup.update`. `AuditAction` diekspor ke `src/shared` oleh W0.

**Uji S3 (kontrak usulan, implementasi PLAN/04)**:

```ts
// POST /api/dev/backup/verify. Body opsional; field yang tidak dikirim memakai nilai tersimpan.
export type BackupVerifyInput = Partial<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}>;
export type BackupVerifyStep = "write" | "read" | "list" | "delete";
export type BackupVerifyCode =
  | "ok"
  | "not_configured"
  | "key_mismatch"
  | "unreachable"
  | "bucket_not_found"
  | "write_denied"
  | "read_failed"
  | "list_denied"
  | "delete_denied"
  | "timeout"
  | "s3_error";
export type BackupVerify = {
  ok: boolean;
  code: BackupVerifyCode;
  failedStep: BackupVerifyStep | null;
  steps: { step: BackupVerifyStep; ok: boolean }[];
  ms: number;
  detail: string | null; // pesan teknis lewat describe() (kunci disamarkan)
};
```

### 3.2 Database

**Tidak ada migrasi dari PLAN/05.** Kunci `app_meta` baru (upsert idempoten `insert … onConflictDoUpdate`, baris dihapus = belum):
`onboarding.dismissed_at`, `onboarding.access.done_at`, `onboarding.secret_saved.done_at`, `onboarding.secret_saved.check`
(nilai `secret_check` saat dicentang). Aktor terhapus di audit = migrasi PLAN/04. Kunci Telegram = tabel `setting` (registri PLAN/02).

### 3.3 Endpoint

Semua `/api/dev/*` = `super_admin`. `401` tanpa sesi, `403` peran kurang.

| Method          | Path                                               | Request                               | 2xx                                                                                                                                 | Error                                                                                                                                                    | Pemilik implementasi / catatan                                                                                                                                                               |
| --------------- | -------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET             | `/api/dev/health`                                  | —                                     | `DevHealth`                                                                                                                         | —                                                                                                                                                        | PLAN/05 `health.service.ts`. Tidak pernah 500 karena kunci data: `backup: null`.                                                                                                             |
| GET             | `/api/dev/setup`                                   | —                                     | `DevSetup`                                                                                                                          | —                                                                                                                                                        | PLAN/05 `setup.service.ts`, membaca `getSecurityStatus()` PLAN/04.                                                                                                                           |
| PUT             | `/api/dev/setup/items/:key`                        | `SetupManualPut`                      | `DevSetup`                                                                                                                          | 404 `not_found` (bukan `access`/`secret_saved`); 400 `invalid_body`                                                                                      | PLAN/05. Audit `setup.update {key, done}`.                                                                                                                                                   |
| PUT             | `/api/dev/setup/dismiss`                           | `SetupDismissPut`                     | `DevSetup`                                                                                                                          | 400 `invalid_body`                                                                                                                                       | PLAN/05. Tidak diaudit.                                                                                                                                                                      |
| GET             | `/api/dev/settings`                                | —                                     | `DevSettings`                                                                                                                       | —                                                                                                                                                        | `wkr-settings-01`. `readable` dari `dataKeyState()` PLAN/04 di `listSettings(deps)`; `describeSetting(db, key)` tidak berubah.                                                               |
| PATCH           | `/api/dev/settings`                                | `DevSettingsPatch`                    | `DevSettings`                                                                                                                       | 400 `invalid_value` + `fields`; 400 `invalid_body` (bukan objek, kosong, > 30 kunci, nilai bukan string/null, kunci tak dikenal → `fields[k]="unknown"`) | `wkr-settings-01`. `db.transaction`. Audit `settings.update` per kunci yang berubah, `meta {reset}` tanpa nilai; kunci rahasia yang dikirim **selalu** dianggap berubah.                     |
| POST            | `/api/dev/cloudflare/verify`                       | —                                     | `CloudflareVerify`                                                                                                                  | —                                                                                                                                                        | `verify()` di `dns.provider.ts` diubah PLAN/05 (W3, setelah PLAN/03).                                                                                                                        |
| POST            | `/api/dev/backup/verify`                           | `BackupVerifyInput?`                  | `BackupVerify` (200 juga saat gagal)                                                                                                | 400 `invalid_value` + `fields` (override tidak lolos validator)                                                                                          | **PLAN/04**. Timeout 15 dtk, DELETE di `finally`. Audit `backup.verify {ok, code}`.                                                                                                          |
| POST            | `/api/dev/alerts/test`                             | —                                     | `AlertTestResult`                                                                                                                   | 409 `alerts_not_configured`; 429 `too_soon`; 502 `<AlertErrorCode>`                                                                                      | **PLAN/02**; UI memetakan status + `error`.                                                                                                                                                  |
| POST            | `/api/dev/alerts/telegram/chats`                   | —                                     | `TelegramChats`                                                                                                                     | 409 `alerts_token_missing`/`telegram_webhook_set`; 502                                                                                                   | **PLAN/02**; tombol "Cari chat".                                                                                                                                                             |
| GET             | `/api/dev/users?q&page&role`                       | `role` opsional                       | `Page<DevUser>`                                                                                                                     | 400 `invalid_role`                                                                                                                                       | PLAN/05. Urut peran (super_admin → admin → user), lalu `lastSeenAt` desc nulls last.                                                                                                         |
| PATCH/DELETE    | `/api/dev/users/:id`                               | tetap                                 | tetap                                                                                                                               | 404; 409 `protected` (`assertMutable`)                                                                                                                   | PLAN/05; tambah `meta.targetEmail`.                                                                                                                                                          |
| POST            | `/api/dev/users/:id/sessions/revoke`               | —                                     | `RevokedSessions`                                                                                                                   | 404; 409 `self` **hanya** bila id = pemanggil (B6)                                                                                                       | Route PLAN/05 (`dev.routes.ts`), fungsi `revokeUserSessions` PLAN/04. Audit `session.revoke {userId, revoked, scope:"user"}`.                                                                |
| GET             | `/api/dev/audit?page&action&actorId&from&to`       | `action` diakhiri `.` = awalan        | `Page<DevAuditEntry>`                                                                                                               | 400 `invalid_date`                                                                                                                                       | **PLAN/04**. UI hanya mengirim satu `action`.                                                                                                                                                |
| GET             | `/api/dev/audit/export.csv?action&actorId&from&to` | filter sama                           | `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="audit-<yyyymmdd>.csv"`, maks 10.000 baris terbaru, di-stream | 400 `invalid_date`                                                                                                                                       | PLAN/05 (G28, A8) memakai query `listAudit` PLAN/04 per halaman 500; kolom: waktu ISO, aktor, email aktor, aksi, target, IP tersamar, request id; tanpa `meta` mentah. Audit `audit.export`. |
| POST            | `/api/dev/sessions/revoke-all`                     | —                                     | `RevokedSessions`                                                                                                                   | —                                                                                                                                                        | **PLAN/04**; UI "Keluarkan semua pengguna" di Pengguna (A8).                                                                                                                                 |
| DELETE          | `/api/me`                                          | `{ confirm: string }` = email sendiri | 204                                                                                                                                 | 403 `forbidden` (peran ≠ `user`); 400 `confirm_mismatch`                                                                                                 | PLAN/05 (G27, A8). Hapus akun sendiri (FK cascade sesi & akun OAuth), audit `user.self_delete` `meta.targetEmail`. Peran admin/super_admin ditolak agar panel tidak kehilangan pengelola.    |
| GET             | `/api/dev/logs`                                    | tetap                                 | `DevLogs`                                                                                                                           | tetap                                                                                                                                                    | —                                                                                                                                                                                            |
| GET/DELETE/POST | `/api/me`, `/api/me/sessions*`                     | tetap                                 | tetap                                                                                                                               | tetap                                                                                                                                                    | Sudah ada; hanya UI baru.                                                                                                                                                                    |

Rute publik non-API (dirangkai di `spa.serve.ts` oleh `wkr-http-01`, isi dari `seo.ts`):

| Path                    | Response                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `/robots.txt`           | `text/plain`: `User-agent: *` + `Disallow: /api/` + `Sitemap: <APP_BASE_URL>/sitemap.xml` |
| `/sitemap.xml`          | `application/xml`, satu `<loc>` `${APP_BASE_URL}/` (A8)                                   |
| `/og.png`               | PNG 1200×630 di-embed (`with { type: "file" }`), `Cache-Control: public, max-age=86400`   |
| `/apple-touch-icon.png` | PNG 180×180 di-embed, cache sama                                                          |

### 3.4 Aturan vonis (`health.service.ts`)

1. `problems` dan `sampledAt` = `monitor.status()` PLAN/02 (B5). Aturan masalah hanya di `overview.problems.ts` (B2).
   Tidak menghitung ulang cadangan/disk (X10).
2. `INFO_CODES = ["backup_not_configured", "access_not_seen"]` (konstanta bernama, B4: tone info, juga di Ringkasan, tidak dikirim ke Telegram) tidak ikut vonis.
   Masalah lain: `danger` → fail, `warning` → warn.
3. Cek panel (konstanta bernama, Rule 15):

| Key                | ok                                                                      | warn                                  | fail                       | value              |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------- | -------------------------- | ------------------ |
| `errors`           | `unhandled5m < 3`                                                       | `3 ≤ n < 10`                          | `n ≥ 10`                   | `n`                |
| `sampler`          | `sampledAt` ≤ `max(3 × interval, 10 mnt)` lalu, atau uptime < batas itu | lebih tua                             | —                          | menit sejak sampel |
| `backup_scheduler` | `backupScheduler.lastTickAt()` ≤ 10 mnt lalu, atau uptime < 10 mnt      | lebih tua (timer tertunda, mis. Doze) | —                          | menit sejak tick   |
| `fake_on_https`    | mode `termux`, atau base http                                           | —                                     | mode `fake` dan base https | `mode`             |

4. `verdict` = fail bila ada fail, warn bila ada warn, selain itu ok.
5. `unhandled5m` = respons tepat 500 dalam 5 mnt: satu field baru di `requestStats()` `request.log.ts` [DEP PLAN/02, pemilik file].
6. `runningJob` = query tabel `job` `status = 'running'` terbaru (tanpa menyentuh `job.runner.ts`). `lastErrors` = `readLogs({ level: "error", limit: 5 })`.
7. `backup` = `{configured, nextRunAt}` dari `backup.status()`; `KeyMismatchError` → `null`.

### 3.5 Pengaturan — registri web (`src/web/dev/settings.registry.ts`)

```ts
export type SettingGroup = "cloudflare" | "backup" | "alerts" | "sites" | "security";
export type SettingControl =
  | { kind: "text"; inputMode?: "url" | "text" }
  | { kind: "secret" }
  | { kind: "number"; min: number; max: number }
  | { kind: "hour" } // Select 00.00–23.00 + "Mati" ("off")
  | { kind: "portRange" } // "Dari"/"Sampai" → "a-b"
  | { kind: "services" } // checkbox per layanan runit; fallback teks CSV
  | { kind: "choice"; options: readonly string[] } // Select/radio (mis. alerts.min_severity)
  | { kind: "switch"; on: string; off: string; confirmOn?: boolean }; // mis. alerts.enabled, backup.include_secrets
export const SETTING_UI = {
  /* … */
} satisfies Record<
  SettingKey,
  {
    group: SettingGroup;
    control: SettingControl;
    required: boolean;
    helpUrl?: string;
    connection?: boolean;
  }
>;
export const GROUP_ORDER: readonly SettingGroup[] = ["cloudflare", "backup", "alerts", "sites", "security"];
```

`connection: true` menandai kunci yang memicu uji otomatis setelah simpan (K4).

| Grup (anchor)                           | Kunci (urutan)                                                                                                                                                                                                                                                    | Kontrol khusus                                                                                   | Uji                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| Cloudflare (`#cloudflare`)              | `cloudflare.api_token`ᶜ, `cloudflare.account_id`ᶜ                                                                                                                                                                                                                 | secret                                                                                           | "Uji token" (tersimpan)    |
| Cadangan (`#cadangan`)                  | `backup.s3_endpoint`*ᶜ, `backup.s3_bucket`*ᶜ, `backup.s3_access_key_id`*ᶜ, `backup.s3_secret_access_key`*ᶜ, `backup.s3_region`ᶜ, `backup.prefix`ᶜ, `backup.hour`, `backup.retention_days`, `backup.keep_min_runs`, `backup.max_item_mb`, `backup.include_secrets` | `hour`; `number`; `switch` + dialog `confirm` saat dinyalakan (`include_secrets`, default `off`) | "Uji koneksi" (draft)      |
| Notifikasi & pemantauan (`#notifikasi`) | `alerts.enabled`, `alerts.telegram_bot_token`, `alerts.telegram_chat_id`, `alerts.min_severity`, `monitor.sample_interval_sec`                                                                                                                                    | `switch`; secret; chat id + tombol "Cari chat"; `choice` (`warning`/`danger`); `number 30–600`   | "Kirim pesan uji" (manual) |
| Situs (`#situs`)                        | `sites.dir`, `sites.port_range`                                                                                                                                                                                                                                   | `portRange`                                                                                      | —                          |
| Keamanan (`#keamanan`)                  | `panel.protected_services`, `audit.retention_days`                                                                                                                                                                                                                | `services`; `number 90–3650`                                                                     | —                          |

`*` = wajib untuk cadangan; ᶜ = `connection`. `helpUrl` (konstanta URL produk publik): token Cloudflare `https://dash.cloudflare.com/profile/api-tokens`;
kunci R2 `https://developers.cloudflare.com/r2/api/tokens/`; bot Telegram `https://core.telegram.org/bots/features#botfather`.

### 3.6 SEO (`src/server/http/seo.ts`, murni, pemilik PLAN/05)

```ts
export function robotsTxt(): string;
/** Rewrites <head> for `pathname`. status 404 when !isKnownSpaPath(pathname) (roles.ts, PLAN/01). */
export function pageHead(html: string, pathname: string, baseUrl: string): { html: string; status: 200 | 404; robots: string | null };
export const OG_TEXT: { title: string; description: string; imageAlt: string }; // = idLanding.meta (dibandingkan test)
```

Untuk `/` saja: `link rel=canonical` (`${base}/`), `og:type=website`, `og:site_name`, `og:title`, `og:description`, `og:url`,
`og:image=${base}/og.png` (+ width/height/alt), `og:locale=id_ID`, `twitter:card=summary_large_image`, `link rel=apple-touch-icon`.
Path lain: `<meta name="robots" content="noindex, nofollow">` + header `X-Robots-Tag` + `<title>Panel Termux</title>`.
Kontrak untuk `wkr-http-01`: respons hasil `pageHead` membuang `ETag`/`Last-Modified`, fetch internal tidak meneruskan `If-None-Match`,
status dari `pageHead`; cache CSP per varian HTML (maks 3). Suntikan hanya meta, hash script inline tidak berubah.

### 3.7 Distribusi (pemilik PLAN/05; PLAN/04 me-review)

| File                                                | Isi                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                           | MIT, `Copyright (c) 2026 makurosolusi`                                                                                                                                                                                                                                                                                                 |
| `scripts/install-phone.sh` (ubah)                   | Exit 3 bila `.env` belum lengkap; header mendokumentasikan 0/1/3; `sv -w 130 restart panel` (PLAN/03); petunjuk rollback `panel.prev` + snapshot terbaru (PLAN/04). Snapshot sendiri terjadi saat boot (PLAN/04 K9), bukan di skrip.                                                                                                   |
| `scripts/package-release.sh`                        | `sh scripts/package-release.sh <binary> <outdir> <tag>` → `panel-termux-android-arm64.tar.gz` (isi: `panel-android-arm64`, `scripts/install-phone.sh`, `deploy/sv/panel/run`, `.env.example`, `LICENSE`, `VERSION`), `install.sh` (salinan `install-release.sh` dengan `PANEL_VERSION_DEFAULT=<tag>` ditanam), `SHA256SUMS` (keduanya) |
| `scripts/install-release.sh`                        | Dijalankan di Termux (flow F9)                                                                                                                                                                                                                                                                                                         |
| `scripts/{install-release,package-release}.test.sh` | Stub `curl`/`uname`/`sh`, pola `install-phone.test.sh`                                                                                                                                                                                                                                                                                 |
| `.github/workflows/release.yml`                     | Lihat di bawah                                                                                                                                                                                                                                                                                                                         |

`release.yml` (trigger `push: tags: ["v*"]` dan `workflow_dispatch` input `dry_run` boolean default `true`; satu job `ubuntu-latest`):

1. `permissions` level job: `contents: write`, `id-token: write`, `attestations: write`, `artifact-metadata: write`.
2. `actions/checkout@<sha v4>` dengan `persist-credentials: false`.
3. `oven-sh/setup-bun@<sha v2>` `bun-version: 1.4.2`. [VERIF kritik] cross-compile `bun-linux-aarch64-android` jalan di runner Linux.
4. `bun install --frozen-lockfile` → `bun run typecheck` → `bun run lint` → `bun test` → `bun audit --audit-level=high` →
   `sh scripts/install-phone.test.sh && sh scripts/install-release.test.sh && sh scripts/package-release.test.sh`.
5. Hanya saat tag: tag = `v` + `package.json.version` dan `CHANGELOG.md` punya `## [<versi>]` (Rule 5).
6. `bun run build` → `sh scripts/package-release.sh dist/panel-android-arm64 dist/release "$TAG"` (dry run: tag `v0.0.0-dryrun`).
7. Bukan dry run: `actions/attest@<sha v4>` `subject-path` tarball + `install.sh`; catatan rilis = potongan CHANGELOG →
   `gh release create "$TAG" dist/release/* --title "$TAG" --notes-file notes.md` (`GH_TOKEN: ${{ github.token }}`).

Semua action dipin ke commit SHA. Tanpa `pull_request_target`, tanpa `actions/cache`, tanpa secret selain `github.token`. Tag dibuat pemilik
(Rule 1). [DEP PLAN/04] `ci.yml` menjalankan ketiga test shell juga, agar kegagalan Linux ketahuan sebelum tag.

Perintah di landing & README:

```sh
curl -fsSLo install.sh https://github.com/makurosolusi/panel-termux/releases/latest/download/install.sh
sh install.sh
```

Verifikasi asal (opsional, di komputer): `gh attestation verify panel-termux-android-arm64.tar.gz --repo makurosolusi/panel-termux`.

### 3.8 README — resep Access yang direvisi [TERBUKA (a)]

Langkah 4 "Instal di HP": tabel path menjadi `panel`, `dev`, `api/panel`, `api/dev` (baris `profile` dihapus). Daftar "sengaja **tidak**
dilindungi" ditambah: "`/profile`: hanya menampilkan akunmu sendiri dari `/api/me`, dan akun Google lain yang login perlu melihat
penjelasan 'belum punya akses' di sana." Tambahan langkah: "Saat menjadikan seseorang Admin, tambahkan juga emailnya ke policy Access."
Bagian Keamanan menyebut `/profile` di daftar publik. CHANGELOG `0.3.0` → Changed: "Resep Cloudflare Access tidak lagi melindungi `/profile`."

---

## 4. Flow

### F1. Super admin pertama kali masuk (onboarding)

1. Login Google → `/login` → full load ke **`/panel`** (A11/B19).
2. Ringkasan `/panel` untuk super_admin memuat `GET /api/dev/setup`; bila `dismissedAt === null && !complete` tampil banner ringkas
   (`dev/onboarding.banner.tsx`, disisipkan PLAN/02 di `overview.page.tsx`): "Siapkan Panel Termux: 2 dari 6 selesai" + "Lanjutkan" → `/dev`.
   Peran admin tidak melihat banner (tidak memanggil `/api/dev/*`). `/dev` memuat `GET /api/dev/health` dan `GET /api/dev/setup` paralel.
3. `dismissedAt === null && !complete` → kartu "Siapkan Panel Termux" di atas vonis, item `applicable` berurutan sesuai tabel §3.1,
   progres "2 dari 6 selesai" (wajib + disarankan saja).
4. Item selesai = tercentang, teks "Selesai" (dan "dicentang manual" bila `source = manual`). Item belum = apa + kenapa + aksi:
   - `access`: "Lihat resep Access" (README langkah 4) + "Sudah saya pasang". Otomatis selesai setelah satu request lewat Access.
   - `secret_saved`: "Unduh kunci data" (`POST /api/dev/security/data-key/export` PLAN/04, sesi segar) → selesai otomatis via `exportedAt`.
     Alternatif: `CopyButton` perintah `scp <hp>:panel/data/secret ./panel-termux-secret` + "Sudah saya simpan" (menyimpan sidik).
   - `backup`: belum diatur → "Atur cadangan" (`/dev/settings#cadangan`); `needsFirstRun` → "Jalankan cadangan pertama" (`/panel/backups`).
   - `cloudflare_token` → `/dev/settings#cloudflare`; `apps_json` → `/panel/sites`; `first_site` → `/panel/sites/new`;
     `admins` → `/dev/users` (body menyebut "tambahkan juga emailnya ke policy Access").
5. "Sembunyikan panduan" (di kartu atau banner) → `PUT /setup/dismiss {dismissed:true}`; kartu dan banner hilang; tombol "Panduan penyiapan" muncul di aksi `PageHeader` `/dev`.
6. "Panduan penyiapan" → `PUT {dismissed:false}`.
7. `complete` → kartu hilang otomatis; tombol "Panduan penyiapan" tetap ada.

Edge: PUT gagal → toast error, tanpa optimistic update. Dua tab → sinkron di poll berikutnya. Reset kunci data (PLAN/04) → sidik
berubah → `secret_saved` kembali belum selesai. Centang manual bisa dibatalkan ("Tandai belum").

### F2. Kesehatan sistem

1. `GET /api/dev/health` tiap 15 dtk (dijeda saat tab tersembunyi, PLAN/01).
2. Header: h1 "Kesehatan sistem", meta "Diperbarui 12 dtk lalu" + muat ulang, badge "Mode fake" bila `mode === "fake"`.
3. Kartu vonis: "Sehat" / "Perlu perhatian" / "Bermasalah" + kalimat dari masalah/cek terburuk. Di bawahnya: masalah (`problems` tanpa
   kode info, teks dari kamus `ProblemCode` PLAN/02) dan cek panel, masing-masing `StatusBadge` + teks + tautan aksi
   (`errors` → `/dev/logs?level=error`). Kode info tampil sebagai baris netral di bagian "Informasi" ("Cadangan belum diatur",
   "Cloudflare Access belum terdeteksi"), dengan tautan ke item onboarding.
4. `StatTile` 2×2 (HP) / 4 kolom: Waktu aktif, Memori, Penyimpanan (bar dengan ambang disk PLAN/02), Request/menit (+ "5xx: n").
5. "Proses latar": pemantauan (`sampledAt`), penjadwal cadangan (`backupTickAt`), cadangan berikutnya (`backup.nextRunAt` atau "Jadwal cadangan mati"), perubahan berjalan (tautan) atau "Tidak ada perubahan yang berjalan".
6. "Kesalahan terakhir": ≤ 5 baris jam + pesan; kosong → "Tidak ada kesalahan sejak panel menyala."
7. "Detail": `KeyValue` versi, skema, mode, runtime, CPU core, ukuran database panel, pengguna · sesi aktif.

Edge: gagal dengan data lama → data + "Gagal memperbarui. Data terakhir {relatif}."; gagal tanpa data → `ErrorState`. Sebelum sampel pertama
(`sampledAt null`, uptime < batas) → baris sampler "Menunggu sampel pertama", tidak menurunkan vonis.

### F3. Pengaturan per grup

1. `GET /api/dev/settings` → kartu per grup (`Section`).
2. Field berubah → grup "Ada perubahan", "Simpan" aktif; `beforeunload` bila ada grup kotor.
3. "Simpan" → `PATCH /api/dev/settings` hanya kunci grup itu yang berubah.
   - 200 → toast "Pengaturan {grup} disimpan.", data diganti respons. Bila ada kunci `connection` yang berubah di grup Cloudflare/Cadangan → uji otomatis (F4).
   - 400 `invalid_value` → field `aria-invalid` + pesan `id.settings.fields[key].invalid` / `common.empty`, fokus ke field invalid pertama; tidak ada yang tersimpan.
   - Jaringan/5xx → pesan error di kaki grup, draft dipertahankan. Tab lama yang masih memanggil `PUT` (sebelum muat ulang versi baru) mendapat 404 → pesan `errorCodes.not_found` ("Muat ulang halaman").
4. Rahasia: §5.2. "Hapus nilai" → `ConfirmAction tier="confirm"` → PATCH `{key: null}`.
5. `backup.include_secrets` dinyalakan → dialog `confirm` (teks PLAN/04 `settings.includeSecrets`), baru masuk draft.
6. `sites.dir` diubah saat `first_site` selesai → `confirm` "Situs yang sudah ada tetap di folder lama dan tidak dipindahkan."
7. `panel.protected_services`: hapus centang `panel`/`sshd`/`cloudflared` → peringatan inline.

Edge: dua super admin menyimpan bersamaan → last-write-wins per kunci (audit mencatat keduanya). Kunci data berubah → rahasia `readable:false`.

### F4. Uji koneksi

1. **S3** ("Uji koneksi", kapan saja): body = draft field koneksi yang **diubah** (rahasia yang tidak diketik tidak dikirim). Tombol disabled
   bila setelah digabung dengan nilai tersimpan masih ada wajib kosong ("Lengkapi kolom wajib dulu.").
2. **Cloudflare** ("Uji token"): tersedia bila token `isSet` **dan** tidak ada draft token; selain itu disabled + "Simpan token dulu untuk mengujinya."
3. **Telegram** ("Kirim pesan uji"): manual; disabled bila token/chat id belum tersimpan. 429 → "Tunggu beberapa detik, lalu coba lagi."
4. Klik → "Menguji…" (`aria-busy`) → hasil inline di kaki grup (`role="status"`): kalimat dari kode + `detail` kecil mono. Tanpa toast tambahan.
5. S3 per langkah sesuai §5.5. DELETE gagal → `delete_denied`, nama objek di `detail` untuk dihapus manual.

### F5. Pengguna

1. `DataTable`: Nama+email (primary), Peran, Terakhir aktif (beresolusi hari), Sesi aktif, aksi "⋯". Filter peran + cari.
2. "Ubah peran" → dialog `confirm` (§5.3). Sukses → toast "Peran Citra diubah ke Admin."
3. "Keluarkan dari semua perangkat" → `confirm` → revoke → toast "Citra dikeluarkan dari 2 sesi." Tersedia juga untuk super admin env lain (K21).
4. "Hapus pengguna" → `typed` (ketik email) → DELETE → toast "Pengguna dihapus."
5. Baris diri sendiri: ⋯ diganti gembok. Super admin env: hanya "Keluarkan dari semua perangkat" yang tersedia.
6. Aksi header "Keluarkan semua pengguna" → `typed` (ketik `keluarkan`) → `POST /api/dev/sessions/revoke-all` (PLAN/04; sesi pemanggil tetap) →
   toast "{n} sesi dikeluarkan." Dipakai saat insiden (laptop/HP hilang).

Edge: 409 `protected`/`self` → `errorCodes.protected`/`errorCodes.self`; 404 → `errorCodes.not_found` + muat ulang.

### F6. Audit

1. `DataTable`: Waktu (relatif + absolut di tooltip), kalimat aksi (`describeAudit`), Aktor, IP/perangkat (`hideOnMobile`).
2. Filter "Jenis aksi", **satu awalan per opsi**: Semua, Masuk `auth.`, Sesi `session.`, Pengguna `user.`, Pengaturan `settings.`,
   Penyiapan `setup.`, Situs `site.`, Domain `hostname.`, DNS `dns.`, Layanan `service.`, Aplikasi `app.`, Cadangan `backup.`.
3. Klik nama aktor → filter `actorId` (chip "Aktor: Citra ✕").
4. Baris bisa diperluas (`<details>`) → `meta` sebagai `KeyValue`.
5. Kosong tanpa filter → `audit.empty`; dengan filter → `common.noResults` + "Hapus filter".
6. Rentang tanggal: dua `<input type="date">` "Dari"/"Sampai" (zona lokal → ISO `from`/`to`); 400 `invalid_date` → pesan inline.
7. "Unduh CSV" → `GET /api/dev/audit/export.csv` dengan filter aktif (unduhan biasa, maks 10.000 baris; teks bantuan menyebut batas itu).

### F7. Log panel

1. `LogViewer` PLAN/01 [DEP] diisi `usePoller` PLAN/01 (B13; ring di memori diganti utuh tiap poll, tanpa cursor) dari `GET /api/dev/logs`;
   Select level, cari, salin, unduh (fitur `LogViewer`).
2. Jam `HH.MM.SS`, badge level, pesan `break-words`.
3. Catatan: "Log disimpan di memori, maks 2.000 baris, dan hilang saat panel dimulai ulang. Log lengkap ada di `$PREFIX/var/log/sv/panel/current`." + `CopyButton`.
4. `?level=error` → level awal Kesalahan.

### F8. Profil & peran `user`

1. Semua peran: header "Profil"; kartu Akun (avatar, nama, email, `RoleBadge`, "Keluar"); kartu Sesi; kartu Tema (`setThemePreference`).
2. Sesi: `GET /api/me/sessions` → perangkat, IP tersamar, "Aktif hari ini" (resolusi hari, K9), badge "Perangkat ini". Baris lain: "Keluarkan"
   (`confirm`) → `DELETE`. "Keluar dari semua perangkat lain" (`confirm`, bila > 1) → toast "2 sesi lain dikeluarkan."
3. Peran `user`: kartu info di atas kartu Akun: judul "Akun kamu belum punya akses ke panel ini"; isi "Panel Termux ini milik pemiliknya.
   Bila kamu anggota tim, kirim alamat email akunmu ke pemilik dan minta peran Admin. Setelah perannya diubah, muat ulang halaman ini.";
   email + `CopyButton`; "Muat ulang"; tautan "Ingin server sendiri? Pasang Panel Termux di HP-mu" → `/#pasang`.
4. Di instance ber-Access, halaman ini tetap terbuka untuk akun non-pemilik (K22). Setelah dipromosikan, `/panel` baru terbuka bila pemilik
   juga menambahkan email ke policy Access; kartu `user` tidak berjanji lebih dari itu.

5. Peran `user` saja: kartu "Hapus akun saya" di bawah: "Email dan namamu dihapus dari panel ini. Kamu bisa masuk lagi kapan saja sebagai Pengguna baru."
   → `typed` (ketik email) → `DELETE /api/me` → keluar → `/`.

Edge: revoke sesi yang sudah kedaluwarsa → 404 → muat ulang daftar; sesi `current` tidak ditawarkan "Keluarkan" (pakai "Keluar"). `DELETE /api/me` oleh admin → 403 (tombol tidak dirender).

### F9. Pengunjung memasang dari landing

1. Landing → "Pasang di HP-mu" → `#pasang`: prasyarat lengkap dan 5 langkah (§5.8).
2. Langkah 1: blok perintah dua baris + `CopyButton` + "Lihat isi skrip" + "Panduan lengkap di GitHub".
3. Di Termux, `install.sh`:
   1. `set -eu`, `trap` hapus temp. `uname -m` ≠ `aarch64` → "Panel Termux butuh HP Android 64-bit (arm64)." exit 1 (sebelum unduh).
   2. `$PREFIX`, `curl`, `tar`, `sha256sum` ada; `$PREFIX/share/termux-services/svlogger` tidak ada → cetak
      "`pkg install termux-services`, lalu tutup dan buka lagi Termux, lalu jalankan skrip ini lagi." exit 1.
      `cloudflared` tidak ada → **peringatan** (lanjut): "Tanpa cloudflared, panel tidak bisa dibuka dari luar HP."
      Ruang bebas `$HOME` < 3 × ukuran tarball (dari `SHA256SUMS`/`Content-Length`, minimal 400 MB) → exit 1 "Ruang penyimpanan tidak cukup …"
      (B10: installer hanya cek ruang + petunjuk rollback; snapshot `panel.db` dibuat panel saat boot di `<dataDir>/snapshots/`)."
   3. Versi = `PANEL_VERSION` env bila ada, selain itu `PANEL_VERSION_DEFAULT` yang ditanam saat rilis → URL `releases/download/<versi>/`.
   4. Bila `~/panel-src/<versi>` sudah ada dan `sha256sum -c` lolos → lewati unduh. Selain itu unduh tarball + `SHA256SUMS` ke `mktemp -d`;
      `sha256sum -c --ignore-missing` gagal → "Checksum tidak cocok: unduhan rusak. Ulangi; untuk memastikan asal rilis, pakai `gh attestation verify`." exit 1.
   5. Ekstrak ke `~/panel-src/<versi>`, jalankan `sh scripts/install-phone.sh ./panel-android-arm64`.
   6. Exit 3 → cetak langkah berikutnya: buat OAuth client Google (tautan README), isi `~/panel/.env`, lalu `sh install.sh` lagi. Exit 0 →
      "Panel menyala. Lanjutkan: hubungkan Cloudflare Tunnel dan pasang Access (README langkah 3–4)." Exit lain → teruskan kode dan pesan.
4. Upgrade = perintah yang sama (unduh `install.sh` terbaru). Snapshot `panel.db` terjadi di boot (PLAN/04 K9).

Edge: jaringan putus → `curl -f` gagal → temp dibersihkan, `~/panel` tidak tersentuh. Belum ada rilis (404) → "Belum ada rilis yang bisa dipasang."

### F10. Login

1. `/login`: `LogoMark` + h1 "Masuk ke Panel Termux" + host instance (mono kecil) + subjudul + tombol Google ≥ 44 px + "← Kembali ke beranda".
2. `?error=`: `access_denied` → dibatalkan; `state_mismatch`/`state_not_found` → sesi masuk kedaluwarsa/cookie diblokir; lainnya → generic.
   [VERIF] kode ada di Better Auth 1.7.28. `error_description` **tidak pernah** dirender (dikendalikan pihak luar).
3. Kaki: "Panel ini milik pemiliknya. Ingin punya sendiri? Pasang Panel Termux" → `/#pasang`.

### F11. Tamu di alamat tak dikenal (K16)

1. Server (`spa.serve.ts` + `seo.ts`): `isKnownSpaPath` false → HTML SPA status 404 + noindex, tanpa ETag.
2. Klien (PLAN/01 1c): `resolveRedirect` tamu → `/login` hanya bila `isProtectedPath`; selain itu tetap, router `*` root → 404 publik
   (tamu) atau 404 di shell (login). Copy dari PLAN/05 (§5.7).

---

## 5. Spesifikasi UI per halaman

Semua halaman: `PageHeader` (h1), komponen `src/web/components`, target ≥ 44 px di < md, token (tanpa warna mentah), `empty` spesifik.
Kunci copy = path `id.*`; sentence case, "kamu".

### 5.1 `/dev` Kesehatan sistem (`dev/health.page.tsx`, `dev/onboarding.card.tsx`)

Desktop: header → onboarding (bila tampil) → kartu vonis → `StatTile` ×4 → dua kolom (Proses latar | Kesalahan terakhir) → Informasi → Detail.
HP: satu kolom, `StatTile` 2×2.

Komponen: `PageHeader`, `Section`, `StatusBadge`, `StatTile`, `KeyValue`, `RelativeTime`, `InlineCode`, `CopyButton`, `StatTilesSkeleton`, `ErrorState`, `Button`.
States: loading `HeaderSkeleton` + `StatTilesSkeleton(4)`; error tanpa data `ErrorState`; error dengan data lama = data + peringatan; `backup: null` → "Pengaturan cadangan tidak bisa dibaca".

Copy `id.dev.health.*` (`i18n/id.dev.health.ts`):

| Kunci                                                     | Teks                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                                                   | Kesehatan sistem                                                                                                                                                                   |
| `verdict.ok/warn/fail`                                    | Sehat / Perlu perhatian / Bermasalah                                                                                                                                               |
| `checks.errors.ok/warn/fail`                              | Tidak ada galat tak tertangani dalam 5 menit. / {n} galat tak tertangani dalam 5 menit. / {n} galat tak tertangani dalam 5 menit. Lihat log kesalahan.                             |
| `checks.sampler.ok/warn/waiting`                          | Pemantauan berjalan, sampel terakhir {relatif}. / Pemantauan terlambat: sampel terakhir {relatif}. HP mungkin sedang menahan Termux (optimasi baterai). / Menunggu sampel pertama. |
| `checks.fake_on_https.fail`                               | Panel berjalan dengan data contoh, bukan data HP. Periksa apakah `sv` ada di Termux.                                                                                               |
| `checks.backup_scheduler.ok/warn`                         | Penjadwal cadangan berjalan, terakhir {relatif}. / Penjadwal cadangan terlambat: terakhir {relatif}. HP mungkin sedang menahan Termux.                                             |
| `info.title`                                              | Informasi                                                                                                                                                                          |
| `info.backup_not_configured`                              | Cadangan belum diatur. Atur di panduan penyiapan.                                                                                                                                  |
| `info.access_not_seen`                                    | Cloudflare Access belum terdeteksi. Siapa pun dengan akun Google bisa masuk sebagai Pengguna.                                                                                      |
| `fakeMode`                                                | Mode fake                                                                                                                                                                          |
| `background.title/sampler/nextBackup/backupOff/job/noJob` | Proses latar / Pemantauan / Cadangan berikutnya / Jadwal cadangan mati / Perubahan berjalan / Tidak ada perubahan yang berjalan.                                                   |
| `lastErrors.title/empty/all`                              | Kesalahan terakhir / Tidak ada kesalahan sejak panel menyala. / Lihat semua log kesalahan                                                                                          |
| dihapus                                                   | `refreshing` (lama); `countsDetail` dipakai di Detail                                                                                                                              |

Onboarding (`i18n/id.dev.setup.ts`): `title` "Siapkan Panel Termux", `progress(n,total)`, `hide` "Sembunyikan panduan", `reopen` "Panduan penyiapan",
`levels.*` "Wajib"/"Disarankan"/"Opsional", `markDone` "Sudah", `markUndone` "Tandai belum", `manual` "dicentang manual", `banner.title(n,total)` "Siapkan Panel Termux: {n} dari {total} selesai", `banner.continue` "Lanjutkan", per item:

| Item             | title                                   | body (inti)                                                                                                                  |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| access           | Lindungi panel dengan Cloudflare Access | Login terbuka untuk semua akun Google. Access memastikan hanya email yang kamu izinkan yang sampai ke halaman dan API panel. |
| secret_saved     | Simpan salinan kunci data               | `data/secret` tidak ikut dicadangkan. Tanpa file ini, token dan kunci yang tersimpan di cadangan tidak bisa dibaca.          |
| backup           | Atur cadangan ke R2 atau S3             | Cadangan harian dikirim ke luar HP. Selesai setelah cadangan pertama berhasil.                                               |
| cloudflare_token | Isi token API Cloudflare                | Agar domain situs baru langsung mendapat record DNS.                                                                         |
| apps_json        | Hubungkan `apps.json` ke pm2            | Agar situs buatan panel tetap jalan setelah HP dinyalakan ulang.                                                             |
| first_site       | Buat atau adopsi situs pertama          | Hubungkan domain ke aplikasimu.                                                                                              |
| admins           | Tambah Admin kedua                      | Opsional. Admin punya kendali penuh atas HP ini. Bila panel memakai Access, tambahkan juga emailnya ke policy Access.        |

A11y: `<section aria-labelledby>`; `<ol>`; status selesai berupa teks; vonis `role="status"` hanya saat berubah.

### 5.2 `/dev/settings` (`settings.page.tsx`, `settings.group.tsx`, `setting.field.tsx`, `secret.field.tsx`, `settings.test.tsx`, `settings.state.ts`, `settings.registry.ts`; `cloudflare.verify.tsx` dihapus)

Layout: header (h1 "Pengaturan", "Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.") → desktop: daftar isi grup sticky +
kartu; HP: kartu bertumpuk, bisa dilipat (`<details open>` bila ada wajib kosong). Kaki kartu: hasil uji + tombol uji + "Simpan".

Field: label (+ `*`), kunci teknis mono kecil, kontrol, bantuan + "Cara membuatnya" (`helpUrl`), status `StatusBadge`:
non-rahasia "Bawaan" **hanya bila `!isSet && default !== null`**, "Belum diisi" bila tanpa default, "Diubah {relatif}" bila `isSet`;
rahasia "Tersimpan · diubah {relatif}" / "Belum diisi" / "Tidak bisa dibaca" (danger, "Kunci data berubah. Isi ulang nilainya.").
"Kembalikan ke bawaan" = tombol teks tanpa dialog.

**Rahasia** (`secret.field.tsx`): tersimpan → baris status + "Ganti" + "Hapus"; "Ganti" membuka input `type=password`,
`autoComplete="new-password"`, `spellCheck=false`, toggle tampilkan (`aria-pressed`) + "Batal". Tidak pernah diisi ulang dari server.

Copy `i18n/id.settings.ts`: `groups.<g>.title/description`, `fields.<key>.label/help/placeholder/invalid` untuk **22 kunci** (teks PLAN/02 §3.6 dan
PLAN/04 §5.3 disalin), `status.*`, `save`, `saved(group)`, `dirty`, `leaveWarning`, `empty` "Wajib diisi.", `reset`, `defaultIs(v)`, `test.*`.
Contoh:

| Kunci                         | label                       | placeholder                                  | invalid                                                                    |
| ----------------------------- | --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `cloudflare.api_token`        | Token API Cloudflare        | Tempel token baru                            | Token berisi 20–200 karakter huruf, angka, `_` atau `-`.                   |
| `cloudflare.account_id`       | ID akun Cloudflare          | mis. 0123456789abcdef0123456789abcdef        | ID akun berisi 32 karakter heksadesimal.                                   |
| `sites.port_range`            | Rentang port situs          | Dari 3001, sampai 3999                       | Port awal harus di atas 1024 dan lebih kecil dari port akhir (maks 65535). |
| `backup.s3_endpoint`          | Endpoint S3                 | mis. https://<akun>.r2.cloudflarestorage.com | Isi URL http(s) tanpa path, query, atau nama pengguna.                     |
| `backup.hour`                 | Jam cadangan harian         | —                                            | Pilih jam 00.00–23.00 atau Mati.                                           |
| `alerts.telegram_bot_token`   | Token bot Telegram          | Tempel token dari @BotFather                 | Token berbentuk `123456:ABC…` dari @BotFather.                             |
| `alerts.telegram_chat_id`     | ID chat Telegram            | mis. -1001234567890                          | Isi ID angka (mis. `-1001234567890`) atau `@namakanal`.                    |
| `monitor.sample_interval_sec` | Interval pemantauan (detik) | 60                                           | Isi angka 30–600.                                                          |

Tier: "Hapus nilai" rahasia = `confirm` ("Hapus token API Cloudflare? Domain situs baru tidak akan mendapat record DNS otomatis." / "Hapus token");
`include_secrets` on = `confirm`; ubah `sites.dir` saat ada situs = `confirm`.
States: loading `RowsSkeleton` per kartu; error `ErrorState` halaman. A11y: tiap grup `<form aria-labelledby>`; `aria-invalid` + `aria-describedby`; hasil uji `role="status"`.

### 5.3 `/dev/users` (`users.page.tsx`, `users.list.tsx`, `user.role.dialog.tsx`)

`DataTable` (tabel ≥ md, kartu di HP; ⋯ 44 px). Toolbar: `SearchBox` + Select peran. Deskripsi: "Akun baru masuk sebagai Pengguna. Admin punya kendali penuh atas HP ini."

Dialog ubah peran (`id.dev.users.role.*`): judul "Ubah peran {nama}?"; opsi "Pengguna — hanya membuka Profil." / "Admin — mengelola layanan, aplikasi, situs,
deploy, database, dan cadangan."; peringatan bila Admin: "Admin bisa menjalankan program apa pun di HP ini lewat deploy, membaca log semua aplikasi,
dan mengunduh cadangan database. Berikan hanya ke orang yang kamu percaya penuh."; catatan Access: "Bila panel memakai Cloudflare Access, tambahkan
juga {email} ke policy Access, atau ia tidak bisa membuka panel." + tautan resep; "Perubahan berlaku seketika."; tombol "Jadikan Admin"/"Jadikan Pengguna".

Hapus: judul "Hapus pengguna {nama}?", body "{nama} akan keluar dari semua perangkat dan akunnya dihapus. Tindakan ini tidak bisa dibatalkan. Ia tetap bisa
masuk lagi dengan Google sebagai Pengguna baru.", input "Ketik {email} untuk konfirmasi", tombol "Hapus pengguna".
Empty: `users.empty` / `common.noResults`.

### 5.4 `/dev/audit` & `/dev/logs`

Audit: `DataTable` + toolbar (Select jenis aksi, chip aktor). `audit.describe.ts`: `describeAudit(entry): { text; tone }`, `satisfies Record<AuditAction, …>`

- fallback "{aktor} menjalankan {action}". Aktor: `system` → "Sistem"; `user && actorDeleted` → "{actorLabel} (terhapus)"; `user` → nama (tautan filter);
  `unknown` → "Tidak diketahui". Target pengguna: `meta.targetEmail` atau "pengguna lain" (baris lama). Contoh: `user.role_change` → "{aktor} mengubah
  peran {targetEmail}: {from} → {to}"; `settings.update` → "{aktor} mengubah {label dari id.settings}"; `backup.run` system → "Sistem menjalankan cadangan terjadwal".

Logs: F7. Header h1 "Log panel".

### 5.5 Hasil uji (`id.settings.test.*`)

| Kode                                                                                                                                                           | Teks                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cf `ok`                                                                                                                                                        | Token aktif dan bisa mengakses {n} zona.                                                                                                                                                                                                                        |
| cf `not_set`                                                                                                                                                   | Token belum diisi.                                                                                                                                                                                                                                              |
| cf `inactive`                                                                                                                                                  | Token tidak aktif. Buat token baru di dashboard Cloudflare.                                                                                                                                                                                                     |
| cf `no_zones`                                                                                                                                                  | Token aktif, tapi tidak bisa melihat zona apa pun. Tambahkan izin Zone:Read.                                                                                                                                                                                    |
| cf `api_error`                                                                                                                                                 | Cloudflare menolak permintaan. Periksa token dan ID akun.                                                                                                                                                                                                       |
| cf/s3 `key_mismatch`                                                                                                                                           | Nilai tersimpan tidak bisa dibaca karena kunci data berubah. Isi ulang.                                                                                                                                                                                         |
| s3 `ok`                                                                                                                                                        | Koneksi berhasil: bisa menulis, membaca, melihat daftar, dan menghapus di bucket ({ms} md).                                                                                                                                                                     |
| s3 `not_configured`                                                                                                                                            | Lengkapi kolom wajib Cadangan dulu.                                                                                                                                                                                                                             |
| s3 `unreachable`                                                                                                                                               | Endpoint tidak bisa dihubungi. Periksa alamat endpoint dan koneksi internet HP.                                                                                                                                                                                 |
| s3 `bucket_not_found`                                                                                                                                          | Bucket tidak ditemukan. Periksa nama bucket.                                                                                                                                                                                                                    |
| s3 `write_denied`                                                                                                                                              | Kunci tidak punya izin menulis ke bucket.                                                                                                                                                                                                                       |
| s3 `read_failed`                                                                                                                                               | Objek uji tertulis tapi tidak bisa dibaca kembali.                                                                                                                                                                                                              |
| s3 `list_denied`                                                                                                                                               | Kunci tidak bisa melihat daftar objek: retensi cadangan tidak akan jalan.                                                                                                                                                                                       |
| s3 `delete_denied`                                                                                                                                             | Bisa menulis, tapi tidak bisa menghapus: retensi cadangan tidak akan jalan.                                                                                                                                                                                     |
| s3 `timeout` / `s3_error`                                                                                                                                      | Bucket tidak menjawab dalam 15 detik. / S3 menolak permintaan. Lihat detail di bawah.                                                                                                                                                                           |
| tg 200                                                                                                                                                         | Pesan uji terkirim ke Telegram.                                                                                                                                                                                                                                 |
| tg 409 `alerts_not_configured`                                                                                                                                 | Isi dan simpan token bot dan ID chat dulu.                                                                                                                                                                                                                      |
| tg 429 `too_soon`                                                                                                                                              | Tunggu beberapa detik, lalu coba lagi.                                                                                                                                                                                                                          |
| tg 502 `telegram_token_invalid` / `telegram_chat_not_found` / `telegram_forbidden` / `telegram_rate_limited` / `telegram_bad_request` / `telegram_unreachable` | Token bot ditolak Telegram. / Chat tidak ditemukan. Kirim pesan ke bot dulu, lalu pakai "Cari chat". / Bot diblokir atau belum masuk grup. / Telegram membatasi pengiriman. Coba lagi nanti. / Telegram menolak pesan. / Telegram tidak bisa dihubungi dari HP. |
| chats 409 `telegram_webhook_set`                                                                                                                               | Bot ini memakai webhook, jadi daftar chat tidak bisa diambil. Isi ID chat manual.                                                                                                                                                                               |

### 5.6 `/profile` (`profile.page.tsx`, `profile.sessions.tsx`, `profile.no-access.tsx`, `profile.theme.tsx`)

Lebar `narrow`. Urutan: [kartu belum punya akses bila `user`] → Akun → Sesi → Tema. Sesi = `DataTable` (kartu di HP). Loading `RowsSkeleton(2)`;
error `ErrorState` di kartu Sesi saja. Copy `i18n/id.account.ts`: `sessions.title` "Sesi aktif", `sessions.current` "Perangkat ini",
`sessions.unknownDevice` "Perangkat tidak dikenal", `sessions.activeToday/yesterday/on(date)` "Aktif hari ini"/"Aktif kemarin"/"Aktif {tanggal}",
`sessions.revoke` "Keluarkan", `sessions.revokeTitle` "Keluarkan {perangkat}?", `sessions.revokeBody` "Perangkat itu harus masuk lagi dengan Google.",
`sessions.revokeOthers` "Keluar dari semua perangkat lain", `noAccess.*` (F8), `theme.title` "Tema", `deleteAccount.title` "Hapus akun saya", `deleteAccount.body` (F8 langkah 5), `deleteAccount.confirm` "Ketik {email} untuk konfirmasi", `deleteAccount.button` "Hapus akun saya".
Pengguna (`id.dev.users.*`): `revokeAll` "Keluarkan semua pengguna", `revokeAllTitle` "Keluarkan semua pengguna dari semua perangkat?", `revokeAllBody` "Semua orang, termasuk Super Admin lain, harus masuk lagi dengan Google. Sesimu sendiri tetap aktif.", `revokeAllConfirm` "Ketik keluarkan untuk konfirmasi", `revokedAll(n)` "{n} sesi dikeluarkan."; `errorCodes.self` "Untuk sesimu sendiri, pakai halaman Profil."; audit `from`/`to` "Dari"/"Sampai", `exportCsv` "Unduh CSV", `exportHint` "Maksimal 10.000 entri terbaru sesuai filter."

### 5.7 `/login` & copy 404 publik

Login: kartu 384 px, `LogoMark` 40 px, h1, host, error `role="alert"` token `danger-subtle`, tombol Google `size="lg"`, tautan kembali.
Copy `id.login.errors.cancelled` "Masuk dibatalkan. Pilih akun Google untuk melanjutkan.", `errors.state` "Sesi masuk kedaluwarsa atau cookie diblokir.
Buka halaman ini lagi lalu coba sekali lagi.", `back` "Kembali ke beranda", `own` "Panel ini milik pemiliknya. Ingin punya sendiri?", `ownLink` "Pasang Panel Termux".
Aturan: hanya teks kamus yang dirender; `error_description` dan nilai `?error` mentah tidak pernah tampil.
404 publik (komponen PLAN/01): judul "Halaman tidak ditemukan", isi "Alamat ini tidak ada di Panel Termux.", aksi "Ke beranda" + "Masuk",
`document.title` "Halaman tidak ditemukan · Panel Termux". Kunci di `id.account.ts` (`publicNotFound.*`), diserahkan ke worker PLAN/01.

### 5.8 `/` Landing produk (`src/web/landing/*`, `i18n/id.landing.ts`)

| #   | Seksi (anchor)            | Isi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Header sticky             | `BrandLogo` (tidak patah di 390 px), Fitur/Cara kerja/FAQ/GitHub (≥ md), kanan: tautan teks "Masuk" (tamu) / "Buka panel" (admin+) / "Akun saya" (`user`); full load untuk yang login.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1   | Hero (`top`)              | Eyebrow "Tanpa root · tanpa Docker", judul, lead, CTA "Pasang di HP-mu" → `#pasang`, sekunder "Lihat di GitHub". Screenshot Ringkasan HP dalam bezel (`fetchpriority=high`, width/height), caption "Tangkapan layar dari mode fake, data contoh".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | Pasang (`pasang`)         | **Prasyarat**: HP Android 64-bit (arm64) yang bisa dibiarkan menyala dan tercolok; Termux dari F-Droid atau GitHub (bukan Play Store) + `termux-services` (tutup dan buka lagi Termux setelah memasangnya); `cloudflared`; PostgreSQL dan pm2 bila ingin situs dengan database; domain yang dikelola Cloudflare; akun Google Cloud untuk OAuth client; komputer untuk mem-build aplikasimu. **Langkah**: (1) jalankan skrip instal (blok perintah + salin, "Lihat isi skrip", "Skrip memeriksa SHA-256 unduhan"); (2) buat OAuth client Google dan isi `~/panel/.env`; (3) hubungkan Cloudflare Tunnel (cloudflared, DNS, ingress); (4) pasang Cloudflare Access; (5) jalankan skrip lagi. Langkah 2–5 menaut ke README. "Upgrade: jalankan perintah yang sama." |
| 3   | Tangkapan layar (`layar`) | 3 gambar (Situs + deploy desktop, Kesehatan sistem desktop, Layanan HP); scroll-snap di HP, grid 3 kolom desktop; `loading="lazy"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Kenapa HP lama            | tetap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | Fitur (`fitur`)           | tetap 6; "Akses & audit" menambah "Admin punya kendali penuh atas HP".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | Cara kerja (`cara-kerja`) | langkah 2 = "Pasang panel dari rilis GitHub" (`sh install.sh`); diagram arsitektur tetap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Keterbatasan (`batasan`)  | CPU% per proses tidak tersedia di Android; setiap perubahan domain memutus semua domain beberapa detik; panel tidak bisa memberi tahu bila dirinya mati (pakai pemantau luar); Android bisa menghentikan Termux bila optimasi baterai aktif; Admin = kendali penuh atas HP; login terbuka untuk akun Google, jadi Cloudflare Access praktis wajib; R2/Cloudflare API belum diuji end-to-end dengan akun nyata (hapus butir ini bila sudah).                                                                                                                                                                                                                                                                                                                      |
| 8   | FAQ (`faq`)               | "Aman dibuka ke internet?" → Access **wajib** untuk halaman & API panel; "Gratis?" → "Ya, kode terbuka berlisensi MIT."; "Perlu komputer?" → "Tidak untuk memasang panel; perlu untuk membuat OAuth client Google dan mem-build aplikasimu."; "Data saya dikirim ke kalian?" → "Tidak ada telemetri. Panel hanya menghubungi layanan yang kamu atur (Cloudflare, bucket cadangan, Telegram) dan satu alamat Google untuk mengecek koneksi internet HP."                                                                                                                                                                                                                                                                                                          |
| 9   | Penutup + footer          | CTA "Pasang di HP-mu"; footer: GitHub, Lisensi MIT (`/blob/main/LICENSE`), Catatan perubahan (`/blob/main/CHANGELOG.md`), Rilis (`/releases`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Strip spesifikasi: "~110 MB ukuran binary" → "±30 menit penyiapan"; "~65 MB RAM" + catatan "diukur di HP sungguhan (v0.2)". `phone.mock.tsx` dihapus.

Gambar: `src/web/assets/landing/{overview-m,sites-d,health-d,services-m}-{light,dark}.webp` (8 file). Varian dipilih dengan kelas `dark:hidden` /
`hidden dark:block` (variant `dark` mengikuti `data-theme`); gambar `display:none` + `loading="lazy"` tidak diunduh. Hero: dua `<img>` dengan
`width/height`; `fetchpriority="high"` hanya pada varian terang (tema terbanyak), varian gelap `loading="eager"` tanpa prioritas. Anggaran: tiap WebP
≤ 120 KB, total yang diunduh per kunjungan ≤ 400 KB, `og.png` ≤ 300 KB.
Copy `id.landing.meta.title/description` (≤ 155 karakter, = `OG_TEXT`), `cta.install/github/signIn/open/account`, `install.*`, `shots.*`, `limits.*`,
`footer.license/changelog/releases`. Landing meng-import `idLanding` langsung agar i18n app tidak masuk chunk awal; judul tab lewat
`useDocumentTitle` PLAN/01.

A11y: satu h1; `alt` deskriptif; `<pre><code>` + "Salin perintah instal"; galeri `tabIndex=0` + `aria-label`; kontras `--lp-*` ≥ 4,5:1.

---

## 6. Kriteria penerimaan

### 6.1 Unit / integrasi (`bun test`)

- [ ] **Regresi**: semua test yang ada lulus tanpa diubah, kecuali kasus `PUT /api/dev/settings/:key` di `dev.api.test.ts` dan entri `MUTATIONS` di
      `tests/csrf.origin.test.ts` (diganti `["PATCH", "/api/dev/settings"]`, tetap mengharapkan penolakan CSRF).
- [ ] `tests/dev.health.test.ts`: problems dengan kode info saja → `verdict ok`; satu `danger` → fail; `unhandled5m` 0/3/10 → ok/warn/fail; 502 tidak dihitung;
      `sampledAt` basi → warn, `null` saat uptime kecil → ok; fake + base https → fail, fake + base http → ok; `KeyMismatchError` → 200 dengan `backup: null`;
      job `running` → `runningJob` terisi.
- [ ] `tests/dev.settings.test.ts` (`wkr-settings-01`): PATCH 3 kunci → 200, 3 audit; 1 valid + 1 invalid → 400 `fields`, 0 tersimpan, 0 audit; kunci tak dikenal →
      400 `invalid_body` `fields.k="unknown"`; > 30 kunci → 400; `PUT /settings/:key` → 404; `default` & `readable` benar; nilai rahasia tidak ada di respons/audit/`readLogs`;
      `setSetting` lama tetap bekerja.
- [ ] `tests/dev.setup.test.ts`: level & urutan sesuai tabel §3.1; `access` selesai dari `lastSeenAt`; `secret_saved` selesai dari `exportedAt`; centang manual
      `secret_saved` jadi belum setelah `secret_check` berubah; manual PUT selain `access`/`secret_saved` → 404; dismiss round-trip; `complete` mengabaikan opsional;
      `needsFirstRun`; `access.applicable=false` di base http.
- [ ] `tests/dev.api.test.ts` (users): filter `role`; urutan; `lastSeenAt` dari `auth.sign_in` setelah sesi dihapus; `activeSessions`; revoke → `revoked = n`;
      409 `self` hanya untuk diri sendiri (super admin env lain boleh); `meta.targetEmail` tercatat di role_change & delete.
- [ ] `tests/server.seo.test.ts` (fungsi murni + integrasi lewat `spa.serve.ts`): `/robots.txt` hanya `Disallow: /api/`; `/og.png` `image/png`; `/` punya `og:image`
      absolut + canonical, tanpa noindex; `/login`, `/dev` → `X-Robots-Tag: noindex`; `/xyz` → 404; `/xyz` dengan `If-None-Match` → tetap 404; `/sitemap.xml` 200 XML satu `<loc>`; robots memuat `Sitemap:` absolut; HTML `/`, `/login`, `/xyz` `Cache-Control: no-cache`;
      `OG_TEXT` = `idLanding.meta`.
- [ ] `tests/web.landing.test.ts`: tamu → `{kind:"signIn", label:"Masuk", to:"/login"}`; `user` → "Akun saya" `/profile`; admin **dan super_admin** → "Buka panel" ke `/panel` (A11/B19).
- [ ] `tests/me.delete.test.ts`: `user` + email cocok → 204, sesi & akun OAuth terhapus, audit `user.self_delete`; email salah → 400; admin → 403.
- [ ] `tests/dev.audit.export.test.ts`: CSV dengan header kolom tetap; filter `action`/`from`/`to` diterapkan; > 10.000 baris dipotong ke 10.000 terbaru; tidak ada kolom `meta`; audit `audit.export`.
- [ ] `tests/web.dev.test.ts`: `settingStatus`; `SETTING_UI` dan `id.settings.fields` lengkap untuk semua `SETTING_KEYS`; `portRange`/`hour`/`switch`;
      `describeAudit` tiap `AuditAction` + `system`/deleted/`unknown`; `loginErrorMessage` 3 kelompok; `?error=access_denied&error_description=<x>` tidak merender `<x>`;
      pemetaan kode uji S3/Telegram lengkap.
- [ ] `sh scripts/install-release.test.sh`: arsitektur salah → exit 1 sebelum `curl`; termux-services hilang → pesan buka ulang Termux; cloudflared hilang → peringatan, lanjut;
      ruang kurang → exit 1 sebelum unduh; checksum salah → exit 1, temp bersih, `install-phone.sh` tidak dipanggil; `install-phone.sh` exit 3 → cetak langkah `.env`; exit 0 → pesan lanjut tunnel/Access;
      `PANEL_VERSION` override; 404 → "Belum ada rilis"; versi sudah terunduh + checksum cocok → tidak unduh ulang.
- [ ] `sh scripts/install-phone.test.sh`: `.env` belum lengkap → exit 3 (bukan 0).
- [ ] `sh scripts/package-release.test.sh`: tarball 6 file; `SHA256SUMS` lolos `sha256sum -c`; `install.sh` memuat `PANEL_VERSION_DEFAULT=<tag>`.

### 6.2 Build & ukuran

- [ ] JS awal untuk `/` ≤ **150 KB gzip** (laporan bundle PLAN/01); chunk awal tidak memuat penanda `src/web/dev`, `src/web/panel`, `src/web/site`.
- [ ] `bun run typecheck`, `bun run lint` bersih; `workflow_dispatch dry_run` hijau di GitHub sebelum tag pertama.

### 6.3 UI-QA di browser (panel mode fake, 390×844 dan 1440×900, tema terang dan gelap)

- [ ] Satu `<h1>` terlihat di 390 px per halaman; tanpa scroll horizontal.
- [ ] `/dev`: onboarding tampil di DB baru, "Sembunyikan" bertahan di browser lain; instance tanpa cadangan tetap "Sehat" dengan baris Informasi.
- [ ] `/dev/settings`: semua teks Indonesia (kecuali `detail` uji); simpan grup Cadangan dengan satu nilai salah → tidak ada yang tersimpan; mengubah `backup.hour` tidak memicu uji;
      "Uji koneksi" dengan draft sebelum simpan bekerja; target sentuh ≥ 44 px.
- [ ] `/dev/users`: promosi selalu lewat dialog dengan catatan risiko dan Access; hapus butuh ketik email.
- [ ] `/profile` sebagai `user`: kartu belum punya akses terlihat tanpa scroll; sesi + revoke bekerja.
- [ ] `/`: header satu baris di 390 px; "Pasang di HP-mu" → `#pasang` dengan 5 langkah; tidak ada "Masuk dengan Google"; LCP < 2,5 dtk (Lighthouse mobile lokal, Fast 4G).
- [ ] `curl /` tanpa JS menampilkan `og:*` lengkap. `/xyz` sebagai tamu → 404 publik; `/panel` sebagai tamu → `/login`.

### 6.4 Setelah merge, di HP uji (izin eksperimen POCO, atas perintah pemilik)

- [ ] Tag `v0.3.0` → workflow hijau, 3 aset, `gh attestation verify` lolos.
- [ ] Instal bersih dari rilis di Termux baru: berhenti di "isi `.env`" (exit 3), lalu setelah `.env` diisi sampai `panel healthy`.
- [ ] Di instance ber-Access (resep §3.8): akun Google non-pemilik login → melihat kartu "belum punya akses".
- [ ] Akun itu dipromosikan ke Admin + emailnya ditambah ke policy Access → `/panel` terbuka.
- [ ] Pratinjau tautan Telegram/WhatsApp untuk `/` menampilkan judul, deskripsi, dan gambar.

---

## 7. Rencana kerja

Ukuran: S < 150 baris diff, M 150–400, L > 400. Nama worker unik; worker tidak commit/push/ganti branch. Tidak ada dua worker di satu file dalam satu gelombang, lintas PLAN.

### W0 — kontrak lintas PLAN (koordinator, `wkr-contracts-00`)

PLAN/05 menyerahkan spesifikasi §3.1 (`DevHealth`, `PanelCheck*`, `SETTING_KEYS`, `DevSetting*`, `CloudflareVerify*`, `Setup*`, `DevUser`, `BackupVerify*` usulan)
untuk ditulis di `src/shared/dev.types.ts` bersama tipe PLAN/04 (`DevAuditEntry`) dan export `AuditAction` ke shared.

### W1 — server & distribusi

| Worker                              | File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Ukuran |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-settings-01` (lintas PLAN, X3) | `src/server/settings.registry.ts` (baru: definisi + validator semua 22 kunci, tanpa label), `src/server/settings.service.ts` (baca/tulis, `setSettings`, pembungkus `setSetting`, `listSettings(deps)` dengan `readable`, `KeyMismatchError`), rute settings di `dev.routes.ts`, `tests/dev.settings.test.ts` (entri `MUTATIONS` `PATCH /api/dev/settings` diserahkan ke `wkr-http-01`, pemilik `tests/csrf.origin.test.ts`, B17)                                                                                                                                                            | L      |
| `wkr-adm-server-01`                 | `src/server/dev/health.service.ts`, `src/server/dev/setup.service.ts`, `src/server/dev/users.service.ts`, rute health/setup/users/revoke di `dev.routes.ts` (**setelah** `wkr-settings-01` selesai dengan file itu, atau rute dipisah ke `src/server/routes/dev.admin.routes.ts` baru agar paralel — pilihan ini dipakai), `src/server/routes/api.routes.ts` (pasang `dev.admin.routes`), rute `audit/export.csv` (`src/server/dev/audit.export.ts` baru), `DELETE /api/me` di `src/server/routes/me.routes.ts` (satu handler; tidak ada worker lain di file itu pada W1), tests §6.1 server | L      |
| `wkr-adm-seo-01`                    | `src/server/http/seo.ts`, `src/web/assets/og.png` + `apple-touch-icon.png` (placeholder bermerek, diganti W3), `tests/server.seo.test.ts` (bagian fungsi murni)                                                                                                                                                                                                                                                                                                                                                                                                                              | S      |
| `wkr-dist-01` (B9)                  | `LICENSE`, `package.json` (`"license"` saja), `.github/workflows/{release,ci}.yml`, `.github/dependabot.yml` (ekosistem `github-actions`), gerbang keamanan dari spec PLAN/04, `scripts/install-phone.sh` (+ spec PLAN/03 & PLAN/04), `scripts/install-phone.test.sh`, `scripts/package-release.sh`, `scripts/install-release.sh`, `scripts/{install-release,package-release}.test.sh`                                                                                                                                                                                                       | M      |
| `wkr-adm-i18n-01`                   | Pecah `src/web/i18n/id.dev.ts` → `id.dev.{health,setup,users,audit,logs}.ts` (`id.dev.ts` re-export); `id.settings.ts` (22 kunci + grup + uji); `id.account.ts` (login + profil + `publicNotFound`). `id.ts` **tidak** disentuh di gelombang yang sama dengan PLAN/01 1a: worker ini menambah import di `id.ts` hanya setelah 1a selesai, atau PLAN/01 1a menambah tiga baris import itu dari spec ini                                                                                                                                                                                       | M      |

Prasyarat W1: hotfix CSRF masuk; W0 selesai; PLAN/04 `getSecurityStatus()`/`dataKeyState()` tersedia untuk `setup.service`/`listSettings` (bila belum, stub bernama sama dari spec W0 dan test memakai fixture).

### W2 — halaman web (prasyarat: W1 + PLAN/01 komponen: `PageHeader`, `DataTable` slot aksi, `ConfirmAction` tier, `QueryView` `empty` wajib, `Toaster` tunggal, `LogViewer`, `useDocumentTitle`)

| Worker                    | File                                                                                                                                                                                                                                            | Ukuran |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-health-web-01`   | `dev/health.page.tsx`, `dev/onboarding.card.tsx`, `dev/onboarding.banner.tsx` (baru; disisipkan PLAN/02 di Ringkasan), `dev/onboarding.state.ts`, `i18n/id.dev.health.ts`, `i18n/id.dev.setup.ts`, test web                                     | M      |
| `wkr-adm-settings-web-01` | `dev/settings.page.tsx`, `dev/settings.group.tsx`, `dev/setting.field.tsx`, `dev/secret.field.tsx`, `dev/settings.test.tsx`, hapus `dev/cloudflare.verify.tsx`, `dev/settings.state.ts`, `dev/settings.registry.ts`, `i18n/id.settings.ts`      | L      |
| `wkr-adm-users-web-01`    | `dev/users.page.tsx` (+ "Keluarkan semua pengguna"), `dev/users.list.tsx`, `dev/user.role.dialog.tsx`, `dev/audit.page.tsx` (+ rentang tanggal, "Unduh CSV"), `dev/audit.describe.ts`, `dev/logs.page.tsx`, `i18n/id.dev.{users,audit,logs}.ts` | L      |
| `wkr-adm-account-web-01`  | `pages/profile.page.tsx`, `pages/profile.{sessions,no-access,theme,delete}.tsx`, `pages/login.page.tsx` (kecuali baris `useDocumentTitle` PLAN/01), `pages/login.error.ts`, `i18n/id.account.ts`                                                | M      |
| `wkr-adm-landing-01`      | `src/web/landing/*` (kecuali baris `useDocumentTitle`; hapus `phone.mock.tsx`; tambah `install.section.tsx`, `shots.section.tsx`, `limits.section.tsx`), `landing.cta.ts`, `i18n/id.landing.ts`, `tests/web.landing.test.ts`                    | L      |

### W3 — integrasi & aset (berurutan per file)

| Worker                | File                                                                                                                                                                                        | Ukuran |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-cfverify-01` | `verify()` di `src/server/cloudflare/dns.provider.ts` + `cloudflare.routes.ts` → `CloudflareVerify` — **setelah** gelombang PLAN/03 yang menyentuh `dns.provider.ts`                        | S      |
| `wkr-adm-shots-01`    | `scripts/demo-seed.ts` (tidak masuk binary), `src/web/assets/landing/*.webp` (8: 4 tampilan × terang/gelap), `og.png`, `apple-touch-icon.png` final — **setelah** halaman yang difoto final | M      |

Seed (`scripts/demo-seed.ts <dataDir>`): dijalankan dengan env `APP_BASE_URL=http://localhost:3415`, `GOOGLE_CLIENT_ID=demo`, `GOOGLE_CLIENT_SECRET=demo`,
`SUPER_ADMIN_EMAILS=demo@contoh.test`, `PANEL_DATA_DIR=$TMPDIR/panel-demo-<rand>` (tidak di repo). Binary `bun run build:local` berjalan dalam
**mode fake** otomatis (tidak ada `$PREFIX/bin/sv`). Seed menjalankan migrasi, menulis data fiktif (`toko-kopi.contoh.com`, `blog.contoh.com`, 3 job,
5 run cadangan, 20 audit, super admin `demo@contoh.test`), membuat sesi lewat `internalAdapter.createSession` (pola `tests/panel.api.test.ts:40-53`), menulis
cookie ke `<dataDir>/demo-cookie.txt` mode 600 (tidak dicetak). Worker memotret 390×844 @2x dan 1440×900 @1x di tema terang dan gelap (izin browser automation diminta
ke pemilik, Rule 1), mengonversi ke WebP (skill `agent-media`), lalu menghapus data dir. Screenshot dibuat ulang hanya bila halaman yang difoto berubah
secara visual (checklist rilis).

### W4 — dokumen (satu worker, akhir; boleh digabung dengan worker dokumen global)

| Worker            | File                                                                                                                                                                                                                                                                                              | Ukuran |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-docs-01` | `README.md` (terbatas: "Layar dan peran" — `/` & alamat tak dikenal; "Instal di HP" — jalur rilis + resep Access §3.8; tabel Pengaturan per grup tanpa label Inggris; "Login dan peran" — risiko Admin + Access; "Lisensi"), `CHANGELOG.md` `## [0.3.0]`, **`package.json` `"version": "0.3.0"`** | M      |

### Dependensi lintas PLAN

| Kepada      | Yang dibutuhkan PLAN/05                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Koordinator | W0 `wkr-contracts-00`; `wkr-settings-01` (X3); `wkr-http-01` merangkai `seo.ts` di `spa.serve.ts` (route `/robots.txt`, `/og.png`, `/apple-touch-icon.png`; status & header dari `pageHead`; tanpa ETag pada HTML yang ditulis ulang).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PLAN/01     | `homeFor(super_admin) = "/panel"` di `roles.ts` (A11/B19) dan test perannya; `usePoller` (B13); Komponen W2; `LogViewer`; `useDocumentTitle`; router `lazy` + `splitting: true`; `isKnownSpaPath` (dari `SPA_ROOTS = ["/", "/login", "/profile", "/panel", "/dev"]`) di samping `isProtectedPath` di `roles.ts`; klien K16 + `public-not-found.page.tsx` memakai copy `id.account.publicNotFound`; import tiga file i18n baru di `id.ts` bila 1a masih memegangnya; penanganan chunk lama setelah upgrade; laporan ukuran bundle.                                                                                                                                                                                                              |
| PLAN/02     | Menyisipkan `<OnboardingBanner />` (PLAN/05) di `overview.page.tsx` untuk super_admin; `monitor.status()` → `{problems, sampledAt}` (B5); kode info B4 bertone info di Ringkasan dan tidak dikirim Telegram; Kunci `alerts.*`/`monitor.sample_interval_sec` + validator (ditulis `wkr-settings-01`, tanpa label server); endpoint `alerts/test` dan `alerts/telegram/chats` sesuai §3.7 PLAN/02; flow §4.7 memakai `PATCH`; accessor snapshot `problems` + `sampledAt` untuk `health.service`; field `unhandled5m` di `requestStats()`; kode `access_not_seen` dan `backup_not_configured` tetap stabil.                                                                                                                                       |
| PLAN/03     | `integration().ecosystemIncludesAppsJson` (atau penggantinya setelah eksperimen pm2) untuk `apps_json`; jadwal `dns.provider.ts`; spec `sv -w 130 restart panel` untuk `install-phone.sh`; status `running` di tabel `job`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PLAN/04     | `backupScheduler.lastTickAt()` (B5); `POST /api/dev/sessions/revoke-all` (UI PLAN/05); gerbang keamanan untuk `release.yml`/`ci.yml`/`dependabot.yml` (dikerjakan `wkr-dist-01`, B9); `getSecurityStatus()`, `dataKeyState()`, `KeyMismatchError`; `POST /api/dev/backup/verify` sesuai kontrak §3.1 (ganti `/test` + `BackupTest*`); `revokeUserSessions` (409 diri sendiri saja ada di route PLAN/05); `listAudit` awalan + `from/to`; ekspor `AuditAction` (+ `setup.update`, `backup.verify`) ke shared lewat W0; kode masalah `access_not_seen`; `ci.yml` menjalankan 3 test shell; review `release.yml` tanpa mengedit; K19 PLAN/04 diselaraskan ke aset tarball + `actions/attest@v4`; spec petunjuk rollback untuk `install-phone.sh`. |

Perkiraan total PLAN/05: ±2.600–3.200 baris diff (termasuk test), 5 gelombang (W0–W4).

---

## 8. Risiko, asumsi, pertanyaan terbuka

**Risiko**

1. **Kontrak lintas PLAN** (uji S3, Telegram, audit, rilis, revoke) baru stabil setelah arbitrase koordinator; usulan kanonik ada di `PLAN/debate/05-response.md`.
2. **Menghapus `PUT /api/dev/settings/:key` dan `DevSetting.label`** memecah kontrak admin; konsumen hanya web dan test (diperbarui, §6.1). Dicatat di CHANGELOG.
3. **Uji S3 menulis ke bucket nyata**: objek di bawah `backup.prefix`, nama acak, selalu dicoba dihapus. R2 nyata belum pernah diuji end-to-end; uji manual dengan akun pemilik wajib sebelum rilis.
4. **Deteksi Access hanya petunjuk**: proses lokal bisa memalsukan header lewat loopback (hanya mencentang checklist), dan Access yang tidak menutup `api/dev` tidak terlihat. Centang manual tersedia.
5. **Mengeluarkan `/profile` dari Access [TERBUKA (a)]**: halaman itu bisa dibuka siapa pun yang login Google, tapi hanya menampilkan akunnya sendiri (data yang sama sudah publik lewat `/api/me`).
6. **Vonis tanpa cadangan tetap "Sehat" (B4)**: pemilik bisa lupa mengatur cadangan bila menutup onboarding; mitigasinya baris Informasi di `/dev` tetap tampil.
7. **Pipeline rilis = jalur supply chain**: pin SHA, izin per job, tanpa cache, attestation, `bun audit` high, review PLAN/04. Binary ±111 MB (batas aset GitHub 2 GB).
8. **Code splitting**: chunk lama hilang setelah upgrade → PLAN/01 wajib menangani sebelum K14 dirilis.
9. **Skrip instal**: Termux Play Store usang bisa gagal di `pkg`; `service-daemon` perlu Termux dibuka ulang; `sha256sum --ignore-missing` diuji di HP sungguhan (§6.4).
10. **"Terakhir aktif" bergantung pada retensi audit** PLAN/04 (`audit.retention_days` minimal 90): pengguna yang tidak login > retensi dan tanpa sesi tampil "Belum pernah".
11. **Token Cloudflare tidak bisa diuji sebelum disimpan** (K4): token baru yang salah menimpa yang lama; dampaknya hanya DNS situs baru dilewati dengan catatan sampai diperbaiki.

**Asumsi**

- A1 Bentuk final `DevAuditEntry`, `SecurityStatus`, accessor `problems`/`sampledAt` mengikuti PLAN/02/04; UI beradaptasi tanpa mengubah desain.
- A2 Bun 1.4.2 tetap versi build sampai v0.3.0 (probe K14/K15 dan cross-compile diverifikasi di versi ini).

**Pertanyaan terbuka untuk pemilik**

1. **(a)** `/profile` dikeluarkan dari path Access (default rencana ini)?
   (Pertanyaan (b) sudah diputuskan B4: informasi di Ringkasan, onboarding, dan Kesehatan sistem; tidak dikirim ke Telegram.)

---

## Riwayat revisi

| Revisi | Tanggal    | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | 2026-11-26 | Rencana awal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1      | 2026-11-26 | Debat (`PLAN/debate/05-critique.md` C1–C22, `00-integration-critique.md`): `/profile` keluar dari resep Access (K22, §3.8); uji S3 satu endpoint milik PLAN/04 dengan draft + `list` (K5, §3.1); kunci Telegram `alerts.*` + endpoint PLAN/02, kontrol `choice`/`switch`, "Cari chat" (§3.5); onboarding & Kesehatan membaca `SecurityStatus` (K7); vonis dari `Problem[]` + cek panel, hanya 500, kode info tidak menurunkan vonis (K8, §3.4); `heartbeat.ts` dan cek skema dihapus; revoke 409 hanya diri sendiri (K21); `setSetting` dipertahankan, kunci tak dikenal 400, registri server dipecah (K3); audit bentuk datar PLAN/04 + `meta.targetEmail`, filter satu awalan; uji otomatis hanya CF/S3 saat kunci koneksi berubah (K4); `install-phone.sh` exit 3 + versi ditanam di `install.sh` (K23, F9); landing 5 langkah jujur, FAQ telemetri akurat; mode fake + https = fail; 4 screenshot terang, sitemap dihapus, robots hanya `/api/`, tanpa ETag pada HTML ditulis ulang (K15, K17); `release.yml` milik PLAN/05 + dry run + test shell + naik versi 0.3.0 oleh worker dokumen; "Terakhir aktif" beresolusi hari (K9); level onboarding eksplisit, `needsFirstRun`; `error_description` tidak dirender; `LogViewer` & klien 404 milik PLAN/01; QA Access & instal nyata di §6.4; MIT/v0.3.0 bukan asumsi lagi; matriks kepemilikan dengan W0/`wkr-settings-01`/`wkr-http-01`. |
| 2      | 2026-11-26 | Selaras `PLAN/DECISIONS.md`: A8 lingkup penuh — `sitemap.xml` + baris `Sitemap:`, screenshot 8 WebP terang+gelap, `og.png` dari hero, filter rentang tanggal & ekspor CSV audit (G28), hapus akun sendiri peran `user` (G27, `DELETE /api/me`), UI "Keluarkan semua pengguna", UI `audit.retention_days` masuk v0.3.0; A11/B19 beranda super_admin `/panel` + banner onboarding di Ringkasan, test landing diperbarui; B4 kode info final (pertanyaan (b) ditutup); B5 cek `sampler` dari `monitor.status()` + cek `backup_scheduler` dari `lastTickAt()`; B6 409 `self`; B7 tetap (list hanya bila retensi me-list); B9 `wkr-dist-01` memegang `release.yml`, `ci.yml`, `dependabot.yml`, `install-release.sh`, dry run wajib sebelum tag, versi 0.3.0 oleh worker dokumen akhir; B10 installer cek ruang; B11 HTML `no-cache`; B13 `/dev/logs` pakai `usePoller`; B17 entri `MUTATIONS` ke `wkr-http-01`. `/profile` di luar Access tetap default [TERBUKA].                                                                                                                                                                                                                                                                                                                                                                                                                               |
