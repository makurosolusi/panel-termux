# PLAN 05 — Administrasi, onboarding, profil, login, landing publik & distribusi

> wkr-plan-admin-01 · 2026-11-26 · branch `feature/production-polish` @ 74fe380. Dokumen rencana, tidak ada kode yang diubah.
> Sumber: `R&D/05-admin-onboarding-landing.md` (gap G1–G28), dengan rujukan silang ke R&D-01 (shell), R&D-02 (monitoring),
> R&D-03 (situs), R&D-04 (keamanan). Klaim kode diverifikasi ulang di HEAD ini. Dua probe dijalankan di scratchpad
> (tidak menyentuh repo), lihat §2 K14 dan K15.

Konvensi dokumen: **[ASUMSI]** = belum dikonfirmasi pemilik; **[DEP PLAN/0x]** = kontrak yang harus dipenuhi PLAN lain;
**[VERIF]** = fakta yang sudah dicek di sesi ini (kode, docs, atau probe).

---

## 1. Tujuan & ruang lingkup

### 1.1 Tujuan

1. Super admin baru tahu persis apa yang harus disiapkan (Access, kunci data, cadangan, token) dan bisa memeriksanya dari satu tempat.
2. Halaman Administrasi menjawab pertanyaan operator: "panel sehat?", "siapa melakukan apa?", "pengaturan ini benar?".
3. Semua teks yang terlihat berbahasa Indonesia sesuai `docs/content-guide.md`, termasuk teks yang hari ini datang dari server.
4. `/` menjadi halaman produk publik yang membuat pengunjung bisa **memasang Panel Termux di HP-nya sendiri** dari rilis
   GitHub, tanpa build sendiri. Pintu masuk pemilik hanya tautan kecil "Masuk".
5. Peran `user` tidak lagi jalan buntu.

### 1.2 Masuk ruang lingkup (menutup gap R&D-05)

| Area                        | Gap R&D-05 yang ditutup                 | Gap domain lain yang ikut tertutup                       |
| --------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Kesehatan sistem + vonis    | G10, G5 (halaman /dev), G19 (/dev)      | R&D-04 G4 (bagian tampilan "tidak bisa dibaca")          |
| Onboarding super_admin      | G4                                      | R&D-04 G7 (pengingat Access), G16 (pengingat kunci data) |
| Pengguna                    | G7, G20, G26                            | R&D-04 G13 (cabut sesi pengguna lain)                    |
| Audit (UI)                  | G6 (tampilan), G11, G19                 | — (skema milik PLAN/04)                                  |
| Log panel                   | G25, G19                                | (G12 kebisingan: milik PLAN/02, lihat §7)                |
| Pengaturan                  | G3, G8, G9, G18                         | R&D-02 notifikasi (UI grup Telegram)                     |
| Profil + peran `user`       | G2, G17                                 | R&D-04 G13 (UI sesi sendiri)                             |
| Login                       | G24 (bagian login), G16 (brand login)   | R&D-01 G17                                               |
| Landing produk              | G1, G13, G14, G15, G16, G21, G22        | R&D-01 G18                                               |
| Rute tak dikenal untuk tamu | G24 (bagian rute)                       | R&D-01 G16                                               |
| Distribusi                  | G13, G14 (LICENSE, rilis, skrip instal) | R&D-04 G23 (`bun audit` di pipeline rilis)               |

### 1.3 Di luar ruang lingkup

- Komponen bersama, shell, bottom bar, tier `ConfirmAction`, `useApiQuery` jeda saat tab tersembunyi, router `lazy`,
  `Cache-Control` aset → **PLAN/01** (dikonsumsi di sini).
- `LogViewer` bersama, sampler latar, kanal Telegram (kirim, dedup, kunci setting), kebisingan log request (`QUIET_PATHS`) → **PLAN/02**.
- Skema & isi audit (aktor terhapus, IP/UA, aksi baru), kunci data/key-check, kit pemulihan, CSRF, keamanan pipeline rilis → **PLAN/04**.
- Integrasi `apps.json`, job runner → **PLAN/03** (dikonsumsi: status integrasi dan job berjalan).
- Hapus akun sendiri untuk peran `user` (G27, P2), ekspor audit CSV (G28, P2), filter rentang tanggal audit (P2),
  allowlist email (keputusan pemilik 4: login tetap terbuka), "Minta akses" yang mengirim notifikasi (P2).
- Instance root `/` = login (opsi O2 R&D-05): ditolak oleh keputusan pemilik 2.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                          | Alternatif                                                     | Alasan                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Teks pengaturan pindah ke web** (opsi L2): server mengirim `key` + `default`; label, bantuan, placeholder, pesan validasi ada di `src/web/i18n/id.settings.ts`, diindeks `SettingKey`. `DevSetting.label/description` **dihapus** dari kontrak.  | L1: terjemahkan di server                                      | Satu sumber teks UI (panduan konten merujuk `src/web/i18n`). Satu-satunya konsumen `label/description` adalah web (`grep` di `src/web/dev/setting.field.tsx`). `satisfies Record<SettingKey,…>` memaksa kelengkapan. |
| K2  | Pesan validasi **satu per kunci** (`fields[key].invalid`), bukan kode alasan per validator                                                                                                                                                         | Kode `format/range/...` + `params`                             | Setiap kunci hanya punya satu validator dan satu pesan Inggris hari ini (`settings.service.ts:63-171`); kode alasan menambah kontrak tanpa nilai.                                                                    |
| K3  | **Simpan per grup** lewat satu endpoint batch atomik `PATCH /api/dev/settings`; `PUT /api/dev/settings/:key` **dihapus**                                                                                                                           | Pertahankan per-kunci + tambah batch                           | Konfigurasi S3 tidak boleh setengah jadi (G18). Dua endpoint = kode mati.                                                                                                                                            |
| K4  | Tombol uji (**Cloudflare, S3, Telegram**) menguji **nilai yang sudah tersimpan**. Setelah grup Cloudflare/Cadangan/Telegram disimpan, UI otomatis menjalankan uji dan menampilkan hasil inline; ada tombol "Uji ulang".                            | Uji draft sebelum simpan                                       | Rahasia tidak perlu dikirim dua kali; kesalahan tetap ketahuan saat disimpan (tujuan G9), bukan jam 03.00.                                                                                                           |
| K5  | Uji S3 = PUT objek kecil `<prefix>.panel-termux-check-<rand>` → HEAD (bandingkan ukuran) → DELETE (opsi T1)                                                                                                                                        | T2 list-only; T3 tanpa tombol                                  | Menguji persis izin yang dipakai cadangan + retensi. Objek di bawah `backup.prefix`, jadi retensi tidak pernah menyentuh data lain.                                                                                  |
| K6  | Onboarding = kartu "Siapkan Panel Termux" di **atas `/dev`** (rumah super_admin). Status tutup & centang manual disimpan **server-side di tabel `app_meta`** (key-value yang sudah ada, tanpa migrasi).                                            | localStorage (D1); tabel `setting` (D2)                        | Super admin pindah HP ↔ laptop. `app_meta` bukan pengaturan yang bisa diedit, jadi tidak muncul di halaman Pengaturan dan tidak butuh validator.                                                                     |
| K7  | Deteksi Cloudflare Access = **petunjuk**, bukan pengaman: request ke `/api/dev/*` yang membawa header `Cf-Access-Jwt-Assertion` → item "Access" otomatis selesai. Tanpa header → item bisa dicentang manual.                                       | Validasi JWT (certs + aud)                                     | [VERIF] docs Cloudflare `validating-json`: JWT dikirim di header `Cf-Access-Jwt-Assertion`; `Cf-Access-Authenticated-User-Email` **tidak disebut**. Validasi JWT penuh = R&D-04 G21 (P2, PLAN/04).                   |
| K8  | Vonis kesehatan dihitung **server** dari daftar cek berkode (`HealthCheckKey`) → `ok/warn/fail`; teks di web                                                                                                                                       | Hitung di web                                                  | Satu aturan, bisa diuji unit, dan bisa dipakai PLAN/02 untuk notifikasi bila mau.                                                                                                                                    |
| K9  | "Terakhir aktif" = `max(session.updated_at)`, fallback `max(audit_log.at)` dengan `action='auth.sign_in'` untuk aktor itu                                                                                                                          | Kolom baru `user.last_sign_in_at` + migrasi                    | Data sudah ada (`auth.sign_in` dicatat setiap login, R&D-04 §2.5). Tanpa migrasi di tabel milik Better Auth.                                                                                                         |
| K10 | Landing = halaman produk publik (keputusan pemilik 2). CTA utama "Pasang di HP-mu" → `#pasang`; "Masuk"/"Buka panel" jadi tautan teks kecil di header saja.                                                                                        | —                                                              | Mengikat.                                                                                                                                                                                                            |
| K11 | Instal dari rilis: perintah dua langkah (unduh skrip, lalu jalankan), bukan `curl … \| sh`                                                                                                                                                         | Pipe ke `sh`                                                   | Pengguna bisa membaca skrip sebelum menjalankannya; tautan "Lihat isi skrip" di landing.                                                                                                                             |
| K12 | Rilis GitHub lewat workflow tag `v*`: aset bernama **tetap** (`panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`) agar `releases/latest/download/<nama>` stabil; provenance lewat `actions/attest@v4`; rilis dibuat dengan `gh` CLI   | `softprops/action-gh-release`                                  | [VERIF] `actions/attest` v4 adalah pengganti `attest-build-provenance` (README GitHub). `gh` sudah ada di runner, jadi tidak perlu action pihak ketiga tambahan.                                                     |
| K13 | `LICENSE` = MIT **[ASUMSI, tunggu pemilik]**, pemegang hak "makurosolusi" (nama org GitHub). `package.json` `"license": "MIT"`; `private: true` tetap (mencegah publish npm).                                                                      | Apache-2.0, AGPL                                               | Default brief. Landing baru boleh menulis "kode terbuka (MIT)" setelah file ada di `main`.                                                                                                                           |
| K14 | Landing dimuat dari **chunk awal kecil**; semua rute lain `lazy`. Butuh `Bun.build({ splitting: true })`.                                                                                                                                          | HTML statis terpisah                                           | [VERIF] probe Bun 1.4.2: `--compile` + HTML import + `splitting: true` menghasilkan chunk lazy yang dilayani server; tanpa `splitting` kode lazy di-inline. Router & build milik PLAN/01 [DEP].                      |
| K15 | Screenshot landing = gambar WebP asli dari **build mode demo** + seed data, di-import dari TSX                                                                                                                                                     | Mock HTML (sekarang)                                           | [VERIF] probe: `import shot from "./x.webp"` di chunk lazy menjadi URL ber-hash `/x-<hash>.webp` dengan `content-type: image/webp`.                                                                                  |
| K16 | **Tamu di alamat tak dikenal** → halaman 404 publik (gaya landing, tombol "Ke beranda" + "Masuk"), HTTP **404** + `noindex`. Tamu di area privat (`/profile`, `/panel/*`, `/dev/*`) tetap → `/login`. Pengguna login → 404 di dalam shell (tetap). | Redirect ke landing (README lama); redirect ke `/login` (kode) | Tamu tidak dipaksa login untuk tautan rusak; crawler mendapat 404 sungguhan, bukan soft-404. README & CHANGELOG diperbarui (bukan kode yang mengikuti README lama).                                                  |
| K17 | SEO lewat server: `robots.txt`, `sitemap.xml`, `og.png`, `apple-touch-icon.png` sebagai route nyata; meta OG/canonical absolut dari `APP_BASE_URL` disuntik ke HTML `/`; semua path lain `X-Robots-Tag: noindex, nofollow`.                        | Tag statis di `index.html`                                     | OG butuh URL absolut; tag statis tidak bisa tahu domain instance.                                                                                                                                                    |
| K18 | Satu logomark (`LogoMark` oranye dari `layout/brand.logo.tsx`) dan satu nama "Panel Termux" di landing, login, 404, app. Tipografi serif landing **dipertahankan** (gaya editorial).                                                               | Samakan tipografi                                              | R&D-05 §2.10: perbedaan gaya boleh, logomark & nama harus satu.                                                                                                                                                      |
| K19 | Promosi ke Admin = dialog konfirmasi (tier `confirm`) dengan penjelasan jujur "Admin = kendali penuh atas HP" (keputusan pemilik 1). Hapus pengguna = tier `typed` (ketik email).                                                                  | Tanpa konfirmasi                                               | Satu tap memberi akses setara shell.                                                                                                                                                                                 |
| K20 | Peran `user` di `/profile` melihat kartu "Akun kamu belum punya akses ke panel ini" + langkah konkret. Tautan landing untuk `user` berlabel "Akun saya", bukan "Buka panel".                                                                       | Tombol "Minta akses" (P2)                                      | Keputusan pemilik 4; tanpa mekanisme notifikasi baru.                                                                                                                                                                |
| K21 | Heartbeat proses latar lewat modul kecil `src/server/heartbeat.ts` (`beat(name)`); penjadwal cadangan dan sampler memanggil `beat` satu baris                                                                                                      | Kesehatan membaca internal tiap service                        | Kesehatan tidak bergantung pada bentuk internal service milik PLAN lain; kontraknya satu fungsi.                                                                                                                     |

Default brief yang relevan dan dipakai: target sentuh ≥ 44 px di < md; judul halaman terlihat di HP (`PageHeader`, PLAN/01);
pm2/postgres terlindungi (nilai default `panel.protected_services` milik PLAN/02, UI grup Keamanan menampilkannya); MIT (K13).
Bottom bar vs sheet diputuskan PLAN/01; halaman Administrasi tidak bergantung pada pilihan itu.

---

## 3. Model data & kontrak API

Semua mutasi lewat `apiFetch` (mengirim `X-Requested-With`), jadi sudah sesuai hotfix CSRF (same Origin + `X-Requested-With`).
Semua error 4xx memakai `ApiErrorBody { error, message? }` yang sudah ada.

### 3.1 Tipe bersama (`src/shared/dev.types.ts`, pemilik: PLAN/05)

```ts
import type { BackupRunStatus } from "./backup.types"; // tipe status run yang sudah ada
import type { PanelMode } from "./panel.types";

/** Hasil satu cek kesehatan / vonis keseluruhan. */
export type HealthStatus = "ok" | "warn" | "fail";

/** Cek yang membentuk vonis /dev. Urutan = urutan tampil. */
export type HealthCheckKey =
  | "schema" // app_meta.schema_version vs migrasi terbaru
  | "errors" // 5xx dalam 5 menit
  | "storage" // ruang bebas folder data
  | "settings_readable" // semua setting rahasia bisa didekripsi
  | "backup" // status cadangan
  | "background" // heartbeat penjadwal cadangan & sampler
  | "access"; // petunjuk Cloudflare Access (K7)

/** `value` = angka/kode pendukung untuk teks (mis. jumlah 5xx, persen bebas, nama heartbeat yang macet). */
export type HealthCheck = { key: HealthCheckKey; status: HealthStatus; value: number | string | null };

/** Proses latar yang melapor lewat heartbeat.ts. `lastAt` null = belum pernah berdetak sejak start. */
export type Heartbeat = { name: "backup_scheduler" | "sampler"; lastAt: string | null; everySec: number };

/** GET /api/dev/health. Field lama dipertahankan; yang baru ditandai. */
export type DevHealth = {
  verdict: HealthStatus; // baru: status terburuk dari checks
  checkedAt: string; // baru
  checks: HealthCheck[]; // baru
  mode: PanelMode; // baru: "termux" | "fake"
  version: string;
  schemaVersion: string;
  latestSchemaVersion: string; // baru
  startedAt: string;
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number };
  db: { sizeBytes: number };
  dataDir: { freeBytes: number; totalBytes: number };
  runtime: { bun: string; node: string; platform: string; arch: string };
  cpuCores: number;
  requestsPerMinute: number;
  errorCount5m: number;
  counts: { users: number; sessions: number };
  heartbeats: Heartbeat[]; // baru
  runningJob: { id: string; kind: string; target: string; startedAt: string } | null; // baru
  backup: {
    configured: boolean;
    lastStatus: BackupRunStatus | null;
    lastAt: string | null;
    nextRunAt: string | null;
  } | null; // baru; null = config tidak bisa dibaca
  lastErrors: DevLogEntry[]; // baru: maks 5 entri level error dari ring log, terbaru dulu
};

/** Semua kunci setting terdaftar. Server `SETTINGS` dan web `SETTING_UI` sama-sama `satisfies Record<SettingKey, …>`. */
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
  // PLAN/02 menambah kunci notify.* di sini; PLAN/04 menambah kunci backup.* barunya di sini.
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Satu setting (label/description DIHAPUS, lihat K1). */
export type DevSetting = {
  key: SettingKey;
  secret: boolean;
  value: string | null; // non-rahasia: nilai tersimpan atau default; rahasia: selalu null
  default: string | null; // baru: untuk status "Bawaan" yang benar (G8) dan teks "Bawaan: 3001-3999"
  isSet: boolean;
  readable: boolean; // baru: false = rahasia tersimpan tapi gagal didekripsi (kunci data berubah)
  updatedAt: string | null;
};
export type DevSettings = { items: DevSetting[] };

/** PATCH /api/dev/settings — semua divalidasi dulu, lalu ditulis dalam satu transaksi. null = kembali ke bawaan / hapus rahasia. */
export type DevSettingsPatch = { values: Partial<Record<SettingKey, string | null>> };
/** Body 400 invalid_value dari PATCH. */
export type DevSettingsInvalid = {
  error: "invalid_value";
  message: string;
  fields: Partial<Record<SettingKey, "invalid" | "empty">>;
};

/** Hasil uji koneksi; teks di web dari `code`. `detail` = pesan teknis Inggris (tanpa rahasia), ditampilkan kecil di bawah. */
export type CloudflareVerifyCode = "ok" | "not_set" | "inactive" | "no_zones" | "api_error" | "unreadable";
export type CloudflareVerify = { ok: boolean; code: CloudflareVerifyCode; zones: number | null; detail: string | null };

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
  ms: number;
  detail: string | null;
};

/** Item onboarding (menggantikan SetupItem lama; `hint` Inggris DIHAPUS). */
export type SetupItemKey =
  | "access"
  | "secret_saved"
  | "cloudflare_token"
  | "backup"
  | "apps_json"
  | "first_site"
  | "admins";
export type SetupLevel = "required" | "recommended" | "optional";
export type SetupItem = {
  key: SetupItemKey;
  level: SetupLevel;
  done: boolean;
  /** "auto" = dihitung dari data; "manual" = dicentang super admin (access bila tidak terdeteksi, secret_saved). */
  source: "auto" | "manual";
  /** Hanya `backup`: tersimpan tapi belum ada run sukses → UI menawarkan "Jalankan cadangan pertama". */
  partial: boolean;
  applicable: boolean; // false: access saat APP_BASE_URL bukan https (dev lokal) → tidak ditampilkan
};
export type DevSetup = { items: SetupItem[]; dismissedAt: string | null; complete: boolean }; // complete = semua required+recommended yang applicable selesai
export type SetupManualPut = { done: boolean };
export type SetupDismissPut = { dismissed: boolean };

/** DevUser: tambah dua field. */
export type DevUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  createdAt: string;
  lastSeenAt: string | null; // K9: sesi atau auth.sign_in terakhir
  activeSessions: number; // baru
  isEnvSuperAdmin: boolean;
};
export type DevUserRevokeSessions = { revoked: number };
```

`DevAuditEntry` **dimiliki PLAN/04**. Yang dibutuhkan UI ini [DEP PLAN/04]:

```ts
// minimal yang dikonsumsi UI Audit
type DevAuditEntry = {
  id: number;
  at: string;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  actor: { kind: "user"; id: string; name: string } | { kind: "deleted"; label: string } | { kind: "system" };
  targetLabel: string | null; // mis. email untuk target user, nama setting untuk settings.update; null bila tidak relevan
  ipMasked: string | null;
  userAgent: string | null; // ringkas, dari kolom baru PLAN/04
};
```

Bila PLAN/04 memilih bentuk lain, UI mengikuti; syarat tak bisa ditawar: **"Sistem" hanya untuk aksi tanpa aktor, aktor
terhapus tetap terbaca** (G6).

### 3.2 Database

**Tidak ada migrasi baru dari PLAN/05.** Alasan per kebutuhan:

| Kebutuhan                   | Penyimpanan                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status onboarding & centang | `app_meta` (tabel key-value yang sudah ada): `onboarding.dismissed_at`, `onboarding.access.done_at`, `onboarding.secret_saved.done_at` (ISO; baris dihapus = belum) |
| "Terakhir aktif" yang andal | subquery atas `session` dan `audit_log` (K9); index `audit_log_action_idx` sudah ada                                                                                |
| Aktor terhapus di audit     | migrasi milik **PLAN/04**                                                                                                                                           |
| Kunci setting Telegram      | tabel `setting` (key-value, tanpa migrasi), registri milik PLAN/02                                                                                                  |

Penulisan `app_meta` memakai `insert … onConflictDoUpdate` (idempoten) seperti `runMigrations`.

### 3.3 Endpoint

Semua di bawah `/api/dev` = `super_admin` (`roleGuard`), kecuali disebut lain. `401` tanpa sesi, `403` peran kurang (perilaku guard yang ada).

| Method | Path                                                                                                | Request                                                            | Response 2xx                   | Error                                                                                                                                     | Catatan                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/dev/health`                                                                                   | —                                                                  | `DevHealth`                    | —                                                                                                                                         | Tidak pernah 500 karena setting tak terbaca: `backup` jadi `null` + cek `settings_readable=fail`.                                                         |
| GET    | `/api/dev/setup`                                                                                    | —                                                                  | `DevSetup`                     | —                                                                                                                                         | Membaca header `cf-access-jwt-assertion` request ini (K7).                                                                                                |
| PUT    | `/api/dev/setup/items/:key`                                                                         | `SetupManualPut`                                                   | `DevSetup`                     | 404 `not_found` (key bukan `access`/`secret_saved`); 400 `invalid_body`                                                                   | Audit `setup.update` `{key, done}`.                                                                                                                       |
| PUT    | `/api/dev/setup/dismiss`                                                                            | `SetupDismissPut`                                                  | `DevSetup`                     | 400 `invalid_body`                                                                                                                        | Tidak diaudit (preferensi tampilan).                                                                                                                      |
| GET    | `/api/dev/settings`                                                                                 | —                                                                  | `DevSettings`                  | —                                                                                                                                         | Urutan = `SETTING_KEYS`.                                                                                                                                  |
| PATCH  | `/api/dev/settings`                                                                                 | `DevSettingsPatch` (1–30 kunci)                                    | `DevSettings` (semua, terbaru) | 400 `invalid_value` + `fields`; 400 `invalid_body` (bukan objek / kosong / nilai bukan string\|null); 404 `not_found` (kunci tak dikenal) | Validasi semua dulu; tulis dalam `db.transaction`. Audit satu baris `settings.update` per kunci yang **benar-benar berubah**, `meta {reset}` tanpa nilai. |
| POST   | `/api/dev/cloudflare/verify`                                                                        | —                                                                  | `CloudflareVerify`             | —                                                                                                                                         | Sudah ada; respons diganti ke bentuk berkode. Rate limit mutasi yang ada (60/mnt/sesi) berlaku.                                                           |
| POST   | `/api/dev/backup/verify`                                                                            | —                                                                  | `BackupVerify`                 | —                                                                                                                                         | Baru. Timeout total 15 dtk. Objek uji selalu dihapus di `finally` (best effort, error dicatat `warn`). Audit `backup.verify` `{ok, code}`.                |
| POST   | `/api/dev/notify/telegram/test`                                                                     | —                                                                  | (milik PLAN/02)                | (milik PLAN/02)                                                                                                                           | [DEP PLAN/02] Harus mengembalikan `{ ok: boolean; code: string; detail: string \| null }` dengan kode terbatas agar bisa dipetakan di web.                |
| GET    | `/api/dev/users?q&page&role`                                                                        | `role` opsional `user\|admin\|super_admin`                         | `Page<DevUser>`                | 400 `invalid_role`                                                                                                                        | Urutan baru: peran (super_admin → admin → user), lalu `lastSeenAt` desc nulls last.                                                                       |
| PATCH  | `/api/dev/users/:id`                                                                                | `DevUserPatch`                                                     | `DevUser`                      | 400 `invalid_role`; 404; 409 `protected`                                                                                                  | Tetap.                                                                                                                                                    |
| DELETE | `/api/dev/users/:id`                                                                                | —                                                                  | 204                            | 404; 409 `protected`                                                                                                                      | Tetap.                                                                                                                                                    |
| POST   | `/api/dev/users/:id/sessions/revoke`                                                                | —                                                                  | `DevUserRevokeSessions`        | 404; 409 `protected` untuk diri sendiri (pakai Profil) dan super admin env (aturan sama dengan `assertMutable`)                           | Baru. Hapus semua baris `session` user itu. Audit `session.revoke` `{userId, revoked, scope:"all"}`.                                                      |
| GET    | `/api/dev/audit?page&action&actorId`                                                                | `action` = nilai persis **atau** awalan berakhiran titik (`site.`) | `Page<DevAuditEntry>`          | —                                                                                                                                         | Semantik awalan [DEP PLAN/04 bila `audit.service.ts` milik mereka; lihat §7].                                                                             |
| GET    | `/api/dev/logs?level&q&limit`                                                                       | tetap                                                              | `DevLogs`                      | tetap                                                                                                                                     | Tetap.                                                                                                                                                    |
| GET    | `/api/me`, `/api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-others` | tetap                                                              | tetap                          | tetap                                                                                                                                     | Sesi apa pun. Sudah ada (`me.routes.ts:31-36`), hanya dipakai UI baru.                                                                                    |

Rute publik non-API baru (di `Bun.serve` `routes`, sebelum `/*`):

| Path                    | Response                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/robots.txt`           | `text/plain`, lihat §3.6                                                                                                           |
| `/sitemap.xml`          | `application/xml`, satu URL: `${APP_BASE_URL}/`                                                                                    |
| `/og.png`               | PNG 1200×630 yang di-embed (`import og from "../web/assets/og.png" with { type: "file" }`), `Cache-Control: public, max-age=86400` |
| `/apple-touch-icon.png` | PNG 180×180 yang di-embed, cache sama                                                                                              |

### 3.4 Aturan cek kesehatan (`health.service.ts`)

Konstanta bernama di file itu (Rule 15). Disk memakai ambang yang **sudah ada** (`DISK_WARN_RATIO 0.1`, `DISK_DANGER_RATIO 0.05`
dari `overview.problems.ts`) dan cadangan memakai `BACKUP_STALE_MS` yang sama, agar Ringkasan dan Kesehatan tidak bertentangan.

| Key                 | ok                                                                                          | warn                                                 | fail                                      | value                                                               |
| ------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `schema`            | `schemaVersion === latestSchemaVersion()`                                                   | —                                                    | berbeda                                   | `schemaVersion`                                                     |
| `errors`            | `errorCount5m === 0`                                                                        | `1 ≤ n < ERRORS_FAIL_5M` (=10)                       | `n ≥ 10`                                  | `n`                                                                 |
| `storage`           | bebas ≥ 10%                                                                                 | 5% ≤ bebas < 10%                                     | < 5%                                      | persen bebas (1 desimal)                                            |
| `settings_readable` | semua setting rahasia tersimpan bisa didekripsi                                             | —                                                    | ≥ 1 gagal                                 | jumlah yang gagal                                                   |
| `backup`            | terkonfigurasi, run terakhir `succeeded` < 36 jam                                           | belum dikonfigurasi; `partial`; tidak ada run 36 jam | run terakhir `failed`; config tak terbaca | kode: `not_configured`/`partial`/`stale`/`failed`/`unreadable`/null |
| `background`        | semua heartbeat `lastAt` ≤ 3 × `everySec` lalu, atau belum lewat 3 × `everySec` sejak start | —                                                    | ada heartbeat yang terlambat              | nama heartbeat pertama yang terlambat                               |
| `access`            | header `cf-access-jwt-assertion` ada, atau `APP_BASE_URL` bukan https                       | header tidak ada di instance https                   | —                                         | `"detected"`/`"local"`/`"missing"`                                  |

`verdict` = `fail` bila ada fail, `warn` bila ada warn, selain itu `ok`. Mode `fake` **bukan** cek (tidak menurunkan vonis),
ditampilkan sebagai badge "Mode demo" di header.

`runningJob` = `select … from job where status = 'running' order by started_at desc limit 1` (tabel `job` yang ada,
tanpa menyentuh `job.runner.ts`). `lastErrors` = `readLogs({ level: "error", limit: 5 })`.

`heartbeat.ts` (baru, ±20 baris):

```ts
/** Records that background loop `name` ran; `everySec` = its expected interval. */
export function beat(name: Heartbeat["name"], everySec: number, now = Date.now()): void;
/** Snapshot for /dev/health (only loops that registered at least once, plus `expected` names with lastAt null). */
export function heartbeats(expected: readonly Heartbeat["name"][]): Heartbeat[];
```

[DEP PLAN/04] `backup.service.ts` `startScheduler`: panggil `beat("backup_scheduler", tickMs / 1000)` di awal setiap tick
(di luar `try`). [DEP PLAN/02] sampler memanggil `beat("sampler", intervalSec)` setiap siklus. Bila sampler belum ada,
`expected` hanya `["backup_scheduler"]`.

### 3.5 Pengaturan — registri web (`src/web/dev/settings.registry.ts`, baru)

```ts
export type SettingGroup = "cloudflare" | "backup" | "notify" | "sites" | "security";
export type SettingControl =
  | { kind: "text"; inputMode?: "url" | "text" } | { kind: "secret" }
  | { kind: "number"; min: number; max: number }
  | { kind: "hour" }            // Select 00.00–23.00 + "Mati" (nilai "off")
  | { kind: "portRange" }       // dua input angka "Dari"/"Sampai" → "a-b"
  | { kind: "services" };       // checkbox per layanan runit dari GET /api/panel/services; fallback input teks CSV bila gagal
export const SETTING_UI = { "cloudflare.api_token": { group: "cloudflare", control: { kind: "secret" }, required: false }, /* … */ }
  satisfies Record<SettingKey, { group: SettingGroup; control: SettingControl; required: boolean; helpUrl?: string }>;
export const GROUP_ORDER: readonly SettingGroup[] = ["cloudflare", "backup", "notify", "sites", "security"];
```

| Grup (judul)        | Kunci (urutan)                                                                                                                                                                                        | Kontrol khusus                                   | Uji               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------- |
| Cloudflare          | `cloudflare.api_token`, `cloudflare.account_id`                                                                                                                                                       | token = secret                                   | "Uji token"       |
| Cadangan            | `backup.s3_endpoint`_, `backup.s3_bucket`_, `backup.s3_access_key_id`_, `backup.s3_secret_access_key`_, `backup.s3_region`, `backup.prefix`, `backup.hour`, `backup.retention_days` (+ kunci PLAN/04) | `hour`, `number 1–365`, endpoint `inputMode url` | "Uji koneksi"     |
| Notifikasi Telegram | kunci `notify.*` dari PLAN/02 [DEP]                                                                                                                                                                   | token bot = secret                               | "Kirim pesan uji" |
| Situs               | `sites.dir`, `sites.port_range`                                                                                                                                                                       | `portRange`                                      | —                 |
| Keamanan            | `panel.protected_services`                                                                                                                                                                            | `services`                                       | —                 |

`*` = wajib agar cadangan jalan (`REQUIRED` di `backup.config.ts`); label diberi tanda `*` + teks "wajib" untuk pembaca layar.

`helpUrl` (konstanta, bukan nilai env karena URL produk publik): token Cloudflare → `https://dash.cloudflare.com/profile/api-tokens`;
kunci R2 → `https://developers.cloudflare.com/r2/api/tokens/`; bot Telegram → milik PLAN/02.

### 3.6 SEO (`src/server/http/seo.ts`, baru)

```ts
/** Top-level SPA paths; anything else is a 404 page (K16). */
export const SPA_ROOTS = ["/", "/login", "/profile", "/panel", "/dev"] as const; // di src/shared/roles.ts agar web & server sama
export function isKnownSpaPath(pathname: string): boolean;
export function robotsTxt(baseUrl: string): string;
export function sitemapXml(baseUrl: string): string;
/** Rewrites <head> of the SPA HTML for `pathname`: OG/canonical for "/", robots noindex otherwise. */
export function pageHead(
  html: string,
  pathname: string,
  baseUrl: string,
): { html: string; status: 200 | 404; robots: string | null };
```

`robots.txt`:

```
User-agent: *
Allow: /$
Disallow: /login
Disallow: /profile
Disallow: /panel
Disallow: /dev
Disallow: /api/
Sitemap: <APP_BASE_URL>/sitemap.xml
```

Disuntik di `<head>` untuk `/` saja: `link rel=canonical` (`${base}/`), `og:type=website`, `og:site_name=Panel Termux`,
`og:title`, `og:description`, `og:url`, `og:image=${base}/og.png`, `og:image:width=1200`, `og:image:height=630`,
`og:image:alt`, `og:locale=id_ID`, `twitter:card=summary_large_image`, `link rel=apple-touch-icon`. Path lain: `<meta name="robots" content="noindex, nofollow">`

- header `X-Robots-Tag: noindex, nofollow` + `<title>Panel Termux</title>`. Teks OG diambil dari konstanta server
  (`seo.ts`), sama dengan `id.landing.meta` — test membandingkan keduanya agar tidak menyimpang.

`pageCspCache` di `index.ts` diubah jadi cache per varian HTML (maks 3: landing, noindex, 404); suntikan hanya meta,
tidak mengubah script inline, jadi hash CSP sama.

### 3.7 Distribusi (pemilik: PLAN/05; keamanan pipeline diaudit PLAN/04)

File baru:

| File                              | Isi                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LICENSE`                         | MIT, `Copyright (c) 2026 makurosolusi` [ASUMSI K13]                                                                                                                                                                                                                                                                                              |
| `scripts/package-release.sh`      | `sh scripts/package-release.sh <binary> <outdir>` → `<outdir>/panel-termux-android-arm64.tar.gz` (isi: `panel-android-arm64`, `scripts/install-phone.sh`, `deploy/sv/panel/run`, `.env.example`, `LICENSE`, `VERSION`), `<outdir>/install.sh` (salinan `scripts/install-release.sh`), `<outdir>/SHA256SUMS` (kedua file). Bisa dijalankan lokal. |
| `scripts/install-release.sh`      | Skrip yang dijalankan **di Termux**. Lihat flow F9.                                                                                                                                                                                                                                                                                              |
| `scripts/install-release.test.sh` | Uji dengan stub `curl`/`uname`/`sh install-phone.sh`, pola sama dengan `install-phone.test.sh`.                                                                                                                                                                                                                                                  |
| `.github/workflows/release.yml`   | Lihat di bawah.                                                                                                                                                                                                                                                                                                                                  |

`release.yml` (trigger `push: tags: ["v*"]`, satu job `ubuntu-latest`):

1. `permissions: { contents: write, id-token: write, attestations: write, artifact-metadata: write }` (job-level, bukan workflow-level).
2. `actions/checkout@<sha v4>` dengan `persist-credentials: false`.
3. `oven-sh/setup-bun@<sha v2>` dengan `bun-version: 1.4.2` (sama dengan Bun lokal; menentukan runtime yang di-embed. Naik versi = keputusan rilis tercatat di CHANGELOG).
4. `bun install --frozen-lockfile` → `bun run typecheck` → `bun run lint` → `bun test` → `bun audit --audit-level=high` (gagal bila high/critical).
5. Cek tag = `v` + `package.json.version`, dan `CHANGELOG.md` punya `## [<versi>]` (Rule 5). Gagal bila tidak.
6. `bun run build` → `sh scripts/package-release.sh dist/panel-android-arm64 dist/release`.
7. `actions/attest@<sha v4>` dengan `subject-path` tarball dan `install.sh`.
8. Catatan rilis = potongan CHANGELOG versi itu (awk) → `gh release create "$TAG" dist/release/* --title "$TAG" --notes-file notes.md` dengan `GH_TOKEN: ${{ github.token }}`.

Semua action dipin ke **commit SHA** (komentar tag di sampingnya). Tidak ada `pull_request_target`, tidak ada secret selain
`github.token`. [DEP PLAN/04] review pipeline: pin SHA, izin minimal, tanpa cache yang bisa diracuni (tidak memakai
`actions/cache`), tag hanya dibuat pemilik (Rule 1: worker tidak pernah push tag).

Perintah yang ditampilkan di landing & README:

```sh
curl -fsSLo install.sh https://github.com/makurosolusi/panel-termux/releases/latest/download/install.sh
sh install.sh
```

Verifikasi opsional di komputer: `gh attestation verify panel-termux-android-arm64.tar.gz --repo makurosolusi/panel-termux`.

---

## 4. Flow

### F1. Super admin pertama kali masuk (onboarding)

1. Login Google → `/login` → full load ke `/dev` (perilaku `needsFullLoad` yang ada).
2. `/dev` memuat `GET /api/dev/health` dan `GET /api/dev/setup` paralel.
3. `dismissedAt === null && !complete` → kartu "Siapkan Panel Termux" di atas vonis, berisi item `applicable` berurutan
   `access, secret_saved, backup, cloudflare_token, apps_json, first_site, admins`, progres "2 dari 6 selesai"
   (hanya required + recommended dihitung).
4. Item auto selesai = tercentang dengan teks "Selesai"; item belum = kalimat apa + kenapa + tombol aksi:
   - `access`: tautan "Lihat resep Access" (README GitHub, anchor "Instal di HP" langkah 4) + tombol "Sudah saya pasang" (PUT manual). Bila
     header terdeteksi → selesai otomatis, tombol hilang.
   - `secret_saved`: penjelasan (tanpa kunci data, rahasia di cadangan tidak bisa dibaca) + `CopyButton` perintah
     `scp <hp>:panel/data/secret ./panel-termux-secret` + "Sudah saya simpan". [DEP PLAN/04] bila PLAN/04 menyediakan kit
     pemulihan, tombol "Unduh kit pemulihan" menggantikan perintah scp dan mengklik unduh **tidak** otomatis mencentang (pengguna tetap mengonfirmasi).
   - `backup`: belum diisi → "Atur cadangan" (ke `/dev/settings#cadangan`); `partial` → "Jalankan cadangan pertama" (ke `/panel/backups`).
   - `cloudflare_token` → `/dev/settings#cloudflare`; `apps_json` → `/panel/sites` (banner integrasi PLAN/03); `first_site` → `/panel/sites/new`; `admins` → `/dev/users`.
5. "Sembunyikan panduan" → `PUT /setup/dismiss {dismissed:true}` → kartu hilang di semua perangkat; tombol "Panduan penyiapan" muncul di aksi `PageHeader` `/dev`.
6. "Panduan penyiapan" → `PUT {dismissed:false}` → kartu muncul lagi.
7. `complete` → kartu hilang otomatis (tanpa dismiss); tombol "Panduan penyiapan" tetap ada untuk melihat item opsional.

Edge: PUT gagal (jaringan) → toast error pola konten, centang kembali ke keadaan semula (tanpa optimistic update).
Dua tab: tab lain melihat perubahan pada polling berikutnya (15 dtk). Item manual yang sudah dicentang bisa dibatalkan
("Tandai belum") karena status hanya preferensi.

### F2. Kesehatan sistem

1. `GET /api/dev/health` tiap 15 dtk (dijeda saat tab tersembunyi oleh PLAN/01).
2. Header: h1 "Kesehatan sistem", meta "Diperbarui 12 dtk lalu" + tombol muat ulang, badge "Mode demo" bila `mode === "fake"`.
3. Kartu vonis: ikon + "Sehat" / "Perlu perhatian" / "Bermasalah" + satu kalimat (cek terburuk pertama). Di bawahnya daftar
   cek (`checks`) sebagai baris `StatusBadge` + teks + tautan aksi (mis. `errors` → `/dev/logs?level=error`, `backup` → `/panel/backups`,
   `settings_readable` → `/dev/settings`, `access` → resep README).
4. Grid `StatTile` 2×2 di HP / 4 kolom di desktop: Waktu aktif, Memori, Penyimpanan (progress, ambang 90/95 = kebalikan 10%/5% bebas), Request/menit + 5xx.
5. "Proses latar": penjadwal cadangan (terakhir berdetak, cadangan berikutnya `nextRunAt`), sampler, perubahan yang sedang berjalan (tautan ke `/panel/jobs/:id`) atau "Tidak ada perubahan yang berjalan".
6. "Kesalahan terakhir": maks 5 baris (jam + pesan, mono, `break-words`), tautan "Lihat semua log kesalahan". Kosong → "Tidak ada kesalahan sejak panel menyala."
7. "Detail": `KeyValue` versi, skema (+ "terbaru"/"tertinggal"), mode, runtime, CPU core, ukuran database panel, pengguna · sesi aktif.

Edge: request gagal tapi data lama ada → data tetap tampil + `ErrorState` ringkas di atas ("Data terakhir 2 mnt lalu"); gagal
tanpa data → `ErrorState` penuh + "Coba lagi". Panel restart → `uptimeSec` kecil, heartbeat `lastAt null` dianggap ok sampai
3 × interval sejak start (tidak ada vonis palsu setelah restart).

### F3. Pengaturan per grup

1. `GET /api/dev/settings` → kartu per grup (`Section`), anchor `#cloudflare`, `#cadangan`, `#notifikasi`, `#situs`, `#keamanan`.
2. Mengubah field → grup "belum disimpan" (titik + teks "Ada perubahan"), tombol "Simpan" grup aktif; `beforeunload` memperingatkan bila ada grup kotor.
3. "Simpan" → `PATCH /api/dev/settings` hanya kunci grup itu yang berubah.
   - 200 → toast "Pengaturan Cadangan disimpan.", data diganti respons, grup bersih. Grup Cloudflare/Cadangan/Telegram → jalankan uji otomatis (F4).
   - 400 `invalid_value` → field terkait `aria-invalid` + pesan `id.settings.fields[key].invalid` (atau `common.empty`), fokus ke field invalid pertama; **tidak ada** yang tersimpan (atomik).
   - Jaringan/5xx → pesan error di kaki grup (bukan hanya toast), draft dipertahankan.
4. Rahasia: lihat §5.5. "Hapus nilai" → `ConfirmAction` tier `confirm` → PATCH `{key: null}`.
5. `sites.dir` diubah saat `first_site` selesai → dialog `confirm`: "Situs yang sudah ada tetap di folder lama dan tidak dipindahkan."
6. `panel.protected_services`: menghapus centang `panel`/`sshd`/`cloudflared` → teks peringatan inline (tanpa dialog).

Edge: dua super admin menyimpan grup sama bersamaan → last-write-wins per kunci (diterima; audit mencatat keduanya).
Kunci data berubah → field rahasia `readable:false` tampil "Tidak bisa dibaca, isi ulang"; GET tetap 200 (§3.3).

### F4. Uji koneksi

1. Tombol uji tampil bila prasyarat tersimpan (`cloudflare.api_token.isSet`; semua `REQUIRED` cadangan `isSet`; kunci Telegram PLAN/02). Selain itu tombol disabled + teks "Simpan token dulu untuk mengujinya."
2. Klik → tombol "Menguji…" (disabled, `aria-busy`) → POST.
3. Hasil inline di kaki grup dalam `role="status"`: ikon + kalimat dari `code` + `detail` kecil mono bila ada. Tanpa toast tambahan (hasil sudah inline).
4. Uji S3 per langkah: `write_denied` → "Kunci tidak punya izin menulis ke bucket.", `delete_denied` → "Bisa menulis, tapi tidak bisa menghapus: retensi tidak akan jalan.", dst. (§5.5).
5. Timeout 15 dtk → `timeout`. Objek uji tertinggal (DELETE gagal) → `delete_denied`, nama objek disebut di `detail` agar bisa dihapus manual.

### F5. Pengguna

1. Daftar `DataTable`: Nama+email (primary), Peran (`RoleBadge`), Terakhir aktif (`RelativeTime`), Sesi aktif, aksi "⋯".
   Filter peran (Select: Semua / Super Admin / Admin / Pengguna) + cari. Urutan peran dulu.
2. "Ubah peran" (menu ⋯) → dialog `confirm` dengan dua opsi radio dan deskripsi per peran (§5.3). Promosi ke Admin
   menampilkan peringatan risiko. Tombol "Jadikan Admin" / "Jadikan Pengguna". Sukses → toast "Peran Citra diubah ke Admin.", baris diperbarui.
3. "Keluarkan dari semua perangkat" → `confirm` → POST revoke → toast "Citra dikeluarkan dari 2 sesi."
4. "Hapus pengguna" → tier `typed` (ketik email) → DELETE → toast "Pengguna dihapus.", daftar dimuat ulang.
5. Baris diri sendiri & super admin env: menu ⋯ diganti ikon gembok + tooltip (`users.locked`/`envSuperAdmin`).

Edge: 409 `protected` (race: pengguna jadi super admin env setelah daftar dimuat) → pesan `errorCodes.protected`;
404 → `errorCodes.not_found` + muat ulang. Demosi berlaku seketika (guard membaca DB tiap request) — dinyatakan di dialog.

### F6. Audit

1. `DataTable`: Waktu (relatif + absolut di tooltip), kalimat aksi (`describeAudit(entry)`), Aktor, IP/perangkat (`hideOnMobile`).
2. Filter "Jenis aksi" (Select grup: Semua, Masuk & sesi `auth.`+`session.`, Pengguna `user.`, Pengaturan `settings.`+`setup.`, Situs `site.`+`hostname.`+`dns.`, Layanan & aplikasi `service.`+`app.`, Cadangan `backup.`) → query `action=<awalan>`; grup dengan dua awalan memakai `action` berulang dalam satu request (`?action=auth.&action=session.`), digabung OR di server. [DEP PLAN/04 bila mereka pemilik `listAudit`].
3. Klik nama aktor → filter `actorId` (chip "Aktor: Citra ✕").
4. Baris bisa diperluas (`<details>`) menampilkan `meta` sebagai `KeyValue` (kunci mentah boleh, nilai string).
5. Kosong tanpa filter → `audit.empty`; kosong dengan filter → `common.noResults` + tombol "Hapus filter".

### F7. Log panel

1. `LogViewer` dari PLAN/02 [DEP] dengan sumber `GET /api/dev/logs`; level Select (Debug/Info/Peringatan/Kesalahan), cari, ikuti/jeda, salin, unduh.
2. Tiap baris: jam `HH.MM.SS` (bukan tanggal penuh), badge level, pesan `break-words` (bukan `break-all`).
3. Catatan di bawah header: "Log disimpan di memori, maks 2.000 baris, dan hilang saat panel dimulai ulang. Log lengkap ada di `$PREFIX/var/log/sv/panel/current`." + `CopyButton` path.
4. `?level=error` dari tautan Kesehatan → level awal Kesalahan.

### F8. Profil & peran `user`

1. Semua peran: header "Profil"; kartu Akun (avatar, nama, email, `RoleBadge`, "Keluar"); kartu Tema (radio Sistem/Terang/Gelap, `setThemePreference`); kartu Sesi.
2. Sesi: `GET /api/me/sessions` → daftar: perangkat (`userAgent` atau "Perangkat tidak dikenal"), IP tersamar, "Aktif 3 mnt lalu", badge "Perangkat ini" untuk `current`.
   Baris lain: "Keluarkan" (`confirm`) → `DELETE` → baris hilang. Kaki: "Keluar dari semua perangkat lain" (`confirm`, tampil bila ada > 1) → POST → toast "2 sesi lain dikeluarkan."
3. Peran `user`: kartu **di atas** kartu Akun, tone info:
   - Judul "Akun kamu belum punya akses ke panel ini"
   - Isi "Panel Termux ini milik pemiliknya. Bila kamu anggota tim, kirim alamat email akunmu ke pemilik dan minta peran Admin. Setelah perannya diubah, muat ulang halaman ini."
   - Email + `CopyButton`; tombol "Muat ulang" (`window.location.reload()` → `/api/me` mengembalikan peran baru → `SessionGate` mengarahkan ke rumah peran);
   - Tautan "Ingin server sendiri? Pasang Panel Termux di HP-mu" → `/#pasang`.
4. Landing untuk `user` yang login: tautan header "Akun saya" → `/profile`.

Edge: revoke sesi yang sudah kedaluwarsa → 404 → baris dihapus + muat ulang daftar; revoke `current` tidak ditawarkan (pakai "Keluar").

### F9. Pengunjung memasang dari landing

1. Landing → "Pasang di HP-mu" → `#pasang`: prasyarat (HP Android 64-bit/arm64, Termux dari F-Droid atau GitHub, domain di Cloudflare, OAuth client Google) dengan tautan README.
2. Blok perintah dua baris + `CopyButton` (menyalin kedua baris) + "Lihat isi skrip" (URL `install.sh` rilis terbaru) + "Panduan lengkap di GitHub".
3. Di Termux `install.sh`:
   1. `set -eu`; cek `uname -m` = `aarch64` (selain itu: "Panel Termux butuh HP Android 64-bit (arm64)." exit 1).
   2. Cek Termux (`$PREFIX` ada) dan `curl`, `tar`, `sha256sum` ada; `termux-services` (`$PREFIX/share/termux-services/svlogger`) ada, bila tidak: cetak `pkg install termux-services` lalu exit 1.
   3. Versi: `PANEL_VERSION` env (mis. `v0.3.0`) → `releases/download/$PANEL_VERSION/`, default `releases/latest/download/`.
   4. Unduh tarball + `SHA256SUMS` ke `mktemp -d` di `$TMPDIR`; `sha256sum -c --ignore-missing`; gagal → hapus temp, exit 1 "Checksum tidak cocok; unduhan rusak atau diubah. Jangan lanjutkan."
   5. Ekstrak ke `~/panel-src/<VERSION>`; jalankan `sh scripts/install-phone.sh ./panel-android-arm64` (skrip yang ada, idempoten).
   6. `install-phone.sh` berhenti meminta `.env` diisi → install.sh mencetak langkah berikutnya: edit `~/panel/.env`, lalu jalankan ulang `sh install.sh` (tanpa unduh ulang bila versi sama: skip bila `~/panel-src/<VERSION>` sudah ada dan checksum cocok).
4. Upgrade = perintah yang sama. [DEP PLAN/04] snapshot `panel.db` sebelum upgrade (R&D-04 G5) dijalankan di `install-phone.sh`; install.sh tidak menduplikasinya.

Edge: jaringan putus di tengah → `curl -f` gagal → temp dibersihkan (trap EXIT), tidak ada file setengah di `~/panel`. GitHub tanpa
rilis (sebelum rilis pertama) → 404 → "Belum ada rilis yang bisa dipasang." Arsitektur salah → berhenti sebelum unduh.

### F10. Login

1. `/login`: `LogoMark` + h1 "Masuk ke Panel Termux" + host instance (`window.location.host`, mono kecil) + subjudul + tombol Google 44 px + tautan "← Kembali ke beranda".
2. `?error=` dipetakan: `access_denied` → dibatalkan; `state_mismatch`/`state_not_found` → sesi login kedaluwarsa/cookie diblokir;
   lainnya → generic. [VERIF] kode-kode ini ada di `node_modules/better-auth/dist`.
3. Kaki: "Panel ini milik pemiliknya. Ingin punya sendiri? Pasang Panel Termux" → `/#pasang`.

### F11. Tamu di alamat tak dikenal (K16)

1. Server: `isKnownSpaPath(pathname)` false → SPA HTML dengan status 404 + noindex.
2. Klien: `resolveRedirect` untuk tamu: path area privat (`canAccess` punya area) → `/login`; path tak dikenal → `null` (tetap).
3. Router: `*` dipindah ke tingkat root: `NotFoundRoute` → login ? `<AppLayout><NotFoundPage/></AppLayout>` : `<PublicNotFoundPage/>`.
   [DEP PLAN/01] `AppLayout` menerima `children` opsional (`{children ?? <Outlet/>}`).

---

## 5. Spesifikasi UI per halaman

Semua halaman: `PageHeader` (h1), satu `<h1>`, komponen dari `src/web/components` (PLAN/01 menyiapkan API-nya), target
sentuh ≥ 44 px di < md, kedua tema memakai token (tanpa warna Tailwind mentah). Empty state spesifik wajib (prop `empty`).
Kunci copy di bawah = path di `id.*`; teks final Indonesia, sentence case, "kamu".

### 5.1 `/dev` Kesehatan sistem (`dev/health.page.tsx`, `dev/onboarding.card.tsx`)

Layout desktop: header → kartu onboarding (bila tampil) → kartu vonis (lebar penuh) → `StatTile` ×4 satu baris → dua kolom
(Proses latar | Kesalahan terakhir) → Detail (`KeyValue`). HP: semua satu kolom, `StatTile` grid 2×2 (±180 px total, bukan 760 px).

Komponen: `PageHeader` (meta, actions: "Panduan penyiapan"), `Section`, `StatusBadge`, `StatTile`, `KeyValue`, `RelativeTime`,
`InlineCode`, `CopyButton`, `StatTilesSkeleton`, `ErrorState`, `Button`.

States: loading = `HeaderSkeleton` + `StatTilesSkeleton(4)`; error tanpa data = `ErrorState` + "Coba lagi"; error dengan data
lama = data + baris peringatan "Gagal memperbarui. Data terakhir {relatif}."; partial = `backup: null` → baris cek backup "Tidak bisa dibaca".

Copy (`id.dev.health.*`, file `i18n/id.dev.health.ts`):

| Kunci                                       | Teks                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                                     | Kesehatan sistem                                                                                                                                                                                                   |
| `verdict.ok/warn/fail`                      | Sehat / Perlu perhatian / Bermasalah                                                                                                                                                                               |
| `checks.schema.ok/fail`                     | Database panel memakai skema terbaru. / Skema database tertinggal ({v}). Mulai ulang panel; bila tetap, lihat log.                                                                                                 |
| `checks.errors.ok/warn/fail`                | Tidak ada galat server dalam 5 menit. / {n} galat server dalam 5 menit. / {n} galat server dalam 5 menit. Lihat log kesalahan.                                                                                     |
| `checks.storage.*`                          | Penyimpanan cukup ({p}% bebas). / Penyimpanan hampir penuh ({p}% bebas). / Penyimpanan kritis ({p}% bebas). Database bisa gagal menulis.                                                                           |
| `checks.settings_readable.fail`             | {n} pengaturan rahasia tidak bisa dibaca karena kunci data berubah. Isi ulang di Pengaturan.                                                                                                                       |
| `checks.backup.*`                           | Cadangan terakhir berhasil {relatif}. / Cadangan belum diatur. / Cadangan terakhir hanya berhasil sebagian. / Tidak ada cadangan dalam 36 jam. / Cadangan terakhir gagal. / Pengaturan cadangan tidak bisa dibaca. |
| `checks.background.ok/fail`                 | Proses latar berjalan normal. / {nama} berhenti berdetak sejak {relatif}. Mulai ulang panel.                                                                                                                       |
| `checks.access.ok/warn/local`               | Cloudflare Access terdeteksi di depan panel. / Cloudflare Access tidak terdeteksi. Siapa pun dengan akun Google bisa masuk sebagai Pengguna. / Instance lokal, Access tidak diperlukan.                            |
| `demoMode`                                  | Mode demo                                                                                                                                                                                                          |
| `background.title/backup/sampler/job/noJob` | Proses latar / Penjadwal cadangan / Sampler / Perubahan berjalan / Tidak ada perubahan yang berjalan.                                                                                                              |
| `lastErrors.title/empty/all`                | Kesalahan terakhir / Tidak ada kesalahan sejak panel menyala. / Lihat semua log kesalahan                                                                                                                          |
| hapus                                       | `refreshing` (lama), `counts` ganda — `countsDetail` dipakai di Detail                                                                                                                                             |

Onboarding (`id.dev.setup.*`, `i18n/id.dev.setup.ts`): `title` "Siapkan Panel Termux", `progress(n,total)` "{n} dari {total} selesai",
`hide` "Sembunyikan panduan", `reopen` "Panduan penyiapan", `levels.required/recommended/optional` "Wajib"/"Disarankan"/"Opsional",
`markDone` "Sudah", `markUndone` "Tandai belum", dan per item `title` + `body` + `action`:

| Item             | title                                   | body (inti)                                                                                                         |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| access           | Lindungi panel dengan Cloudflare Access | Login terbuka untuk semua akun Google. Access memastikan hanya email yang kamu izinkan yang sampai ke panel.        |
| secret_saved     | Simpan salinan kunci data               | `data/secret` tidak ikut dicadangkan. Tanpa file ini, token dan kunci yang tersimpan di cadangan tidak bisa dibaca. |
| backup           | Atur cadangan ke R2 atau S3             | Cadangan harian dikirim ke luar HP. Selesai setelah cadangan pertama berhasil.                                      |
| cloudflare_token | Isi token API Cloudflare                | Agar domain situs baru langsung mendapat record DNS.                                                                |
| apps_json        | Hubungkan `apps.json` ke pm2            | Agar situs buatan panel tetap jalan setelah HP dinyalakan ulang.                                                    |
| first_site       | Buat atau adopsi situs pertama          | Hubungkan domain ke aplikasimu.                                                                                     |
| admins           | Tambah Admin kedua                      | Opsional. Admin punya kendali penuh atas HP ini; berikan hanya ke orang yang kamu percaya.                          |

A11y: kartu onboarding `<section aria-labelledby>`; daftar `<ol>`; item selesai punya teks "Selesai" (bukan hanya ikon); vonis
diberi `role="status"` hanya saat berubah (bukan setiap poll) agar pembaca layar tidak diganggu tiap 15 dtk.

### 5.2 `/dev/settings` Pengaturan (`settings.page.tsx`, `settings.group.tsx` baru, `setting.field.tsx`, `secret.field.tsx` baru, `settings.test.tsx` baru menggantikan `cloudflare.verify.tsx`, `settings.state.ts`, `settings.registry.ts` baru)

Layout: header (h1 "Pengaturan", deskripsi "Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.") → desktop: daftar isi
grup di kiri (sticky, tautan anchor) + kartu grup di kanan; HP: kartu bertumpuk, tiap kartu bisa dilipat (`<details open>` untuk
grup dengan field kosong wajib, lainnya tertutup). Tiap kartu: judul grup, deskripsi satu kalimat, field, kaki = hasil uji + "Uji …" + "Simpan".

Field: label (+ `*` wajib), kunci teknis kecil mono (sekunder), kontrol, bantuan + tautan "Cara membuatnya" (`helpUrl`, `target=_blank rel=noreferrer`),
baris status: `StatusBadge` — non-rahasia: "Bawaan" **hanya bila `!isSet && default !== null`**, "Belum diisi" bila `!isSet && default === null`,
"Diubah {relatif}" bila `isSet`; rahasia: "Tersimpan · diubah {relatif}" / "Belum diisi" / "Tidak bisa dibaca" (danger).
"Kembalikan ke bawaan" (non-rahasia, `isSet && default !== null`) = tombol teks; tanpa dialog (bisa diulang).

Copy (`i18n/id.settings.ts`): `groups.<g>.title/description`, `fields.<key>.label/help/placeholder/invalid`, `status.*`, `save` "Simpan",
`saved(group)` "Pengaturan {grup} disimpan.", `dirty` "Ada perubahan yang belum disimpan", `leaveWarning`, `empty` "Wajib diisi.",
`reset` "Kembalikan ke bawaan", `defaultIs(v)` "Bawaan: {v}", `test.*` (§5.5). Contoh isi wajib (semua 13 kunci ditulis worker; contoh):

| Kunci                      | label                         | placeholder                                  | invalid                                                                    |
| -------------------------- | ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `cloudflare.api_token`     | Token API Cloudflare          | Tempel token baru                            | Token berisi 20–200 karakter huruf, angka, `_` atau `-`.                   |
| `cloudflare.account_id`    | ID akun Cloudflare            | mis. 0123456789abcdef0123456789abcdef        | ID akun berisi 32 karakter heksadesimal.                                   |
| `sites.dir`                | Folder situs                  | mis. ~/sites                                 | Isi path absolut atau yang diawali `~/`.                                   |
| `sites.port_range`         | Rentang port situs            | Dari 3001, sampai 3999                       | Port awal harus di atas 1024 dan lebih kecil dari port akhir (maks 65535). |
| `panel.protected_services` | Layanan yang dilindungi       | —                                            | Nama layanan hanya boleh berisi huruf, angka, `.`, `_` atau `-`.           |
| `backup.s3_endpoint`       | Endpoint S3                   | mis. https://<akun>.r2.cloudflarestorage.com | Isi URL http(s) tanpa path, query, atau nama pengguna.                     |
| `backup.hour`              | Jam cadangan harian           | —                                            | Pilih jam 00.00–23.00 atau Mati.                                           |
| `backup.retention_days`    | Simpan cadangan selama (hari) | 14                                           | Isi angka 1–365.                                                           |

Tier konfirmasi: "Hapus nilai" rahasia = `confirm` ("Hapus token API Cloudflare? Domain situs baru tidak akan mendapat record DNS otomatis." / tombol "Hapus token");
ubah `sites.dir` saat ada situs = `confirm`; lainnya tanpa dialog.

States: loading = `RowsSkeleton` per kartu; error = `ErrorState` halaman; tidak ada empty (registri tak pernah kosong).

A11y: setiap grup `<form aria-labelledby>`; error field `aria-invalid` + `aria-describedby`; fokus ke field invalid pertama; hasil uji `role="status"`;
toggle tampilkan rahasia `aria-pressed` + label "Tampilkan nilai"/"Sembunyikan nilai".

### 5.3 `/dev/users` Pengguna (`users.page.tsx`, `users.list.tsx`, `user.role.dialog.tsx` baru)

`DataTable` (tabel ≥ md, kartu di HP; kartu: nama tebal, email, peran + terakhir aktif satu baris, ⋯ kanan 44 px). Toolbar: `SearchBox` + Select peran.
Deskripsi header: "Akun baru masuk sebagai Pengguna. Admin punya kendali penuh atas HP ini." (mengganti `newAccounts`).

Dialog ubah peran (`id.dev.users.role.*`):

- Judul "Ubah peran {nama}?"
- Opsi "Pengguna — hanya membuka Profil." / "Admin — mengelola layanan, aplikasi, situs, deploy, database, dan cadangan."
- Peringatan (tone warning, tampil bila memilih Admin): "Admin bisa menjalankan program apa pun di HP ini lewat deploy, membaca log semua aplikasi, dan mengunduh cadangan database. Berikan hanya ke orang yang kamu percaya penuh."
- Catatan "Perubahan berlaku seketika, juga di perangkat yang sedang terbuka."
- Tombol "Jadikan Admin"/"Jadikan Pengguna" + "Batal".

Empty: tanpa filter = `users.empty`; dengan filter = `common.noResults`. Hapus: `deleteTitle` "Hapus pengguna {nama}?", body tetap, input "Ketik {email} untuk konfirmasi", tombol "Hapus pengguna".

### 5.4 `/dev/audit` & `/dev/logs`

Audit: `DataTable` + toolbar (Select jenis aksi, chip aktor). Kalimat per aksi dari kamus `id.dev.audit.actions` (`audit.describe.ts` baru,
fungsi murni `describeAudit(entry): { text: string; tone: StatusTone }`) untuk **semua** `AuditAction` (`satisfies Record<AuditAction, …>` dari tipe
yang diekspor PLAN/04 ke shared) + fallback "{aktor} menjalankan {action}" untuk aksi lama/tak dikenal. Contoh:
`user.role_change` → "{aktor} mengubah peran {target}: {from} → {to}"; `auth.sign_in` → "{aktor} masuk"; `settings.update` → "{aktor} mengubah {label setting}" (label dari `id.settings`);
`backup.run` aktor system → "Sistem menjalankan cadangan terjadwal". Aktor: user → nama (tautan filter); deleted → "{label} (terhapus)"; system → "Sistem".

Logs: §F7. Komponen `LogViewer` [DEP PLAN/02]. Header h1 "Log panel".

### 5.5 Hasil uji (`id.settings.test.*`)

| Kode                      | Teks                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| cf `ok`                   | Token aktif dan bisa mengakses {n} zona.                                              |
| cf `not_set`              | Token belum diisi.                                                                    |
| cf `inactive`             | Token tidak aktif. Buat token baru di dashboard Cloudflare.                           |
| cf `no_zones`             | Token aktif, tapi tidak bisa melihat zona apa pun. Tambahkan izin Zone:Read.          |
| cf `api_error`            | Cloudflare menolak permintaan. Periksa token dan ID akun.                             |
| cf/s3 `unreadable`        | Nilai tersimpan tidak bisa dibaca karena kunci data berubah. Isi ulang.               |
| s3 `ok`                   | Koneksi berhasil: bisa menulis, membaca, dan menghapus di bucket ({ms} md).           |
| s3 `not_configured`       | Lengkapi kolom wajib Cadangan dulu.                                                   |
| s3 `unreachable`          | Endpoint tidak bisa dihubungi. Periksa alamat endpoint dan koneksi internet HP.       |
| s3 `bucket_not_found`     | Bucket tidak ditemukan. Periksa nama bucket.                                          |
| s3 `write_denied`         | Kunci tidak punya izin menulis ke bucket.                                             |
| s3 `read_failed`          | Objek uji tertulis tapi tidak bisa dibaca kembali.                                    |
| s3 `delete_denied`        | Bisa menulis, tapi tidak bisa menghapus: retensi cadangan tidak akan jalan.           |
| s3 `timeout` / `s3_error` | Bucket tidak menjawab dalam 15 detik. / S3 menolak permintaan. Lihat detail di bawah. |

Pemetaan kode S3 (di `backup.verify.ts`): `AccessDenied` pada PUT → `write_denied`, pada DELETE → `delete_denied`; `NoSuchBucket` → `bucket_not_found`;
error jaringan (`ECONNREFUSED`/`ENOTFOUND`/fetch gagal) → `unreachable`; lainnya → `s3_error`. `detail` lewat fungsi `describe()` yang sudah menyamarkan kunci (`backup.service.ts:27-31`, diekspor).

### 5.6 `/profile` (`profile.page.tsx`, `profile.sessions.tsx` baru, `profile.no-access.tsx` baru, `profile.theme.tsx` baru)

Layout lebar `narrow` (max-w-3xl). Urutan: [kartu belum punya akses bila `user`] → Akun → Sesi → Tema. Sesi: `DataTable` tanpa header di HP
(kartu), kolom Perangkat / IP / Aktif / aksi. Empty tidak mungkin (minimal sesi ini). Loading `RowsSkeleton(2)`; error `ErrorState` di dalam kartu Sesi (kartu lain tetap).
Copy `id.profile.*` (`i18n/id.account.ts`): `sessions.title` "Sesi aktif", `sessions.current` "Perangkat ini", `sessions.unknownDevice`
"Perangkat tidak dikenal", `sessions.revoke` "Keluarkan", `sessions.revokeTitle` "Keluarkan {perangkat}?", `sessions.revokeBody`
"Perangkat itu harus masuk lagi dengan Google.", `sessions.revokeOthers` "Keluar dari semua perangkat lain", `sessions.revokedOthers(n)`,
`noAccess.*` (§F8), `theme.title` "Tema".

### 5.7 `/login` & 404 publik

Login: kartu 384 px di tengah, `LogoMark` 40 px, h1, host, error `role="alert"` token `danger-subtle`, tombol Google `size="lg"` ≥ 44 px, tautan kembali.
Copy `id.login.errors.cancelled` "Masuk dibatalkan. Pilih akun Google untuk melanjutkan.", `errors.state` "Sesi masuk kedaluwarsa atau cookie diblokir. Buka halaman ini lagi lalu coba sekali lagi.", `back` "Kembali ke beranda", `own` "Panel ini milik pemiliknya. Ingin punya sendiri?", `ownLink` "Pasang Panel Termux".
404 publik (`pages/public-not-found.page.tsx`): header landing ringkas (logo + "Masuk"), `EmptyState` judul "Halaman tidak ditemukan", isi "Alamat ini tidak ada di Panel Termux.", aksi "Ke beranda" + "Masuk". `document.title` "Halaman tidak ditemukan · Panel Termux".

### 5.8 `/` Landing produk (`src/web/landing/*`, `i18n/id.landing.ts`)

Urutan seksi dan perubahan:

| #   | Seksi (id anchor)         | Isi                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Header sticky             | `BrandLogo` (logomark oranye + "Panel Termux", tidak patah di 390 px), tautan Fitur/Cara kerja/FAQ/GitHub (≥ md), kanan: tautan teks kecil "Masuk" (tamu) / "Buka panel" (admin+) / "Akun saya" (`user`). Full load untuk yang login (Access).                                                                                                                                                                                                              |
| 1   | Hero (`top`)              | Eyebrow pendek "Tanpa root · tanpa Docker" (tidak uppercase panjang), judul, lead, CTA utama "Pasang di HP-mu" → `#pasang`, sekunder "Lihat di GitHub". Kanan/bawah: **screenshot asli** Ringkasan HP dalam bingkai HP (`fetchpriority=high`, `width/height` eksplisit), caption "Tangkapan layar mode demo, data contoh".                                                                                                                                  |
| 2   | Pasang (`pasang`)         | Prasyarat (4 butir), blok perintah 2 baris + `CopyButton`, "Lihat isi skrip", catatan checksum ("Skrip memeriksa SHA-256 sebelum memasang"), "Panduan lengkap di GitHub". Baris kecil: "Upgrade: jalankan perintah yang sama."                                                                                                                                                                                                                              |
| 3   | Tangkapan layar (`layar`) | 3 gambar (Situs + deploy, Kesehatan sistem desktop, Layanan HP) dengan caption; scroll-snap horizontal di HP, grid 3 kolom desktop; `loading="lazy"`.                                                                                                                                                                                                                                                                                                       |
| 4   | Kenapa HP lama            | tetap (4 butir).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | Fitur (`fitur`)           | tetap 6 butir, teks diselaraskan dengan glosarium; "Akses & audit" menambah "Admin punya kendali penuh atas HP".                                                                                                                                                                                                                                                                                                                                            |
| 6   | Cara kerja (`cara-kerja`) | langkah 2 diganti "Pasang panel: jalankan skrip instal dari rilis GitHub"; kode `sh install.sh`. Diagram arsitektur dipertahankan.                                                                                                                                                                                                                                                                                                                          |
| 7   | Keterbatasan (`batasan`)  | Baru, jujur: CPU% per proses tidak tersedia di Android; setiap perubahan domain memutus semua domain beberapa detik; panel tidak bisa memberi tahu bila dirinya mati (pakai pemantau luar); Android bisa menghentikan Termux bila optimasi baterai aktif; Admin = kendali penuh atas HP; login terbuka untuk akun Google sehingga Cloudflare Access praktis wajib; R2/Cloudflare API belum diuji end-to-end dengan akun nyata (hapus butir ini bila sudah). |
| 8   | FAQ (`faq`)               | "Aman dibuka ke internet?" ditulis ulang: Access **wajib** untuk path privat; tambah "Gratis?" ("Ya, kode terbuka berlisensi MIT." — hanya setelah LICENSE ada), "Perlu komputer?" ("Tidak untuk memasang; perlu untuk membuat OAuth client Google dan mem-build aplikasimu sendiri."), "Data saya dikirim ke kalian?" ("Tidak. Panel tidak mengirim telemetri; semuanya di HP-mu dan bucket milikmu.").                                                    |
| 9   | Penutup + footer          | CTA "Pasang di HP-mu"; footer: GitHub, Lisensi MIT (`/blob/main/LICENSE`), Catatan perubahan (`/blob/main/CHANGELOG.md`), Rilis (`/releases`), tagline.                                                                                                                                                                                                                                                                                                     |

Strip spesifikasi: "~110 MB ukuran binary" diganti "1 perintah pasang"; "~65 MB RAM" diberi catatan "diukur di HP sungguhan (v0.2)".
Mock HP `phone.mock.tsx` **dihapus** (diganti screenshot).

Gambar: `src/web/assets/landing/{overview-m,sites-d,health-d,services-m}-{light,dark}.webp`; varian tema dengan kelas `dark:hidden` / `hidden dark:block`
(custom variant `dark` sudah mengikuti `data-theme`), jadi gambar galeri tema lain tidak diunduh (`display:none` + `loading=lazy`). Hero memakai
**satu** gambar (varian terang, dibingkai bezel gelap) di kedua tema, agar hanya satu unduhan `fetchpriority=high`. Anggaran: tiap WebP ≤ 120 KB, total gambar landing ≤ 700 KB, `og.png` ≤ 300 KB.

Copy `id.landing.meta.title` "Panel Termux — HP Android jadi server", `meta.description` (≤ 155 karakter), `cta.install` "Pasang di HP-mu", `cta.github` "Lihat di GitHub",
`cta.signIn` "Masuk", `cta.open` "Buka panel", `cta.account` "Akun saya", `install.*`, `shots.*`, `limits.*`, `footer.license/changelog/releases`.
Landing memanggil `document.title = id.landing.meta.title` saat mount (G18) dan meng-import `idLanding` langsung (bukan `id` gabungan) agar i18n app tidak masuk chunk awal.

A11y: satu h1 (hero); gambar `alt` deskriptif ("Ringkasan panel di HP: baterai 88%, 4 layanan berjalan"); blok perintah `<pre><code>` + tombol salin berlabel
"Salin perintah instal"; scroll-snap galeri bisa dioperasikan keyboard (`tabIndex=0` + `aria-label`); kontras `--lp-*` sudah ≥ 4,5:1 (komentar `styles.css:96`).

---

## 6. Kriteria penerimaan

### 6.1 Unit / integrasi (`bun test`, DB test in-memory seperti test yang ada)

- [ ] `tests/dev.health.test.ts` (baru): tiap baris tabel §3.4 — skema beda → `fail`; 0/3/12 galat → ok/warn/fail; bebas 12%/7%/3% → ok/warn/fail; setting rahasia
      dienkripsi dengan secret lain → `settings_readable=fail` **dan** respons 200 dengan `backup: null`; heartbeat belum lewat 3× interval sejak start → ok, lewat → fail;
      header `cf-access-jwt-assertion` ada → `access=ok`, tidak ada di base https → warn, base http → ok `"local"`; `verdict` = terburuk; job `running` di tabel → `runningJob` terisi.
- [ ] `tests/heartbeat.test.ts`: `beat` + `heartbeats(expected)` mengembalikan `lastAt null` untuk nama yang belum berdetak.
- [ ] `tests/dev.settings.test.ts` (ganti bagian settings di `dev.api.test.ts`): PATCH 3 kunci valid → 200, 3 baris audit; PATCH 1 valid + 1 invalid → 400 `fields` berisi kunci invalid, **0** kunci tersimpan, 0 audit;
      kunci tak dikenal → 404; body `{}`/`values:{}` → 400 `invalid_body`; `PUT /settings/:key` → 404 (dihapus); `default` & `readable` benar; nilai rahasia tidak pernah ada di respons/audit/log (grep nilai di `readLogs`).
- [ ] `tests/backup.verify.test.ts` dengan `tests/backup.s3mock.ts` yang ada: sukses → `ok` dan objek uji tidak tersisa; PUT ditolak → `write_denied`/`failedStep:"write"`; DELETE ditolak → `delete_denied` + nama objek di `detail`; tidak dikonfigurasi → `not_configured`; kunci tidak muncul di `detail`.
- [ ] `tests/dev.setup.test.ts`: urutan & level item; manual PUT hanya `access`/`secret_saved` (lainnya 404); dismiss round-trip disimpan di `app_meta`; `complete` mengabaikan optional; `backup.partial` saat config ada tanpa run sukses; access `applicable=false` di base http.
- [ ] `tests/dev.api.test.ts` (users): filter `role`; urutan peran; `lastSeenAt` dari `auth.sign_in` setelah semua sesi dihapus; `activeSessions`; revoke sesi pengguna lain → `revoked` = n, 409 untuk diri sendiri & super admin env, audit tercatat.
- [ ] `tests/server.seo.test.ts`: `/robots.txt` 200 `text/plain` berisi `Disallow: /panel` dan `Sitemap:` absolut; `/sitemap.xml` XML valid satu `<loc>`; `/og.png` 200 `image/png`;
      `/` berisi `og:image` absolut dari `APP_BASE_URL` dan `canonical`, **tanpa** `noindex`; `/login` dan `/dev` → `X-Robots-Tag: noindex`; `/xyz` → status 404 + noindex; teks OG server = `idLanding.meta`.
- [ ] `tests/web.landing.test.ts` diperbarui: tamu → `{kind:"signIn", label:"Masuk", to:"/login"}`; `user` → "Akun saya" `/profile`; admin/super_admin → "Buka panel" ke rumah peran.
- [ ] `tests/web.session.test.ts`: tamu di `/xyz` → `null`; tamu di `/panel/sites` → `/login`; login di `/xyz` → `null`.
- [ ] `tests/web.dev.test.ts`: `settingStatus` ("Bawaan" hanya bila default non-null); `SETTING_UI` dan `id.settings.fields` lengkap untuk semua `SETTING_KEYS` (dijamin compiler + satu test runtime); serialisasi `portRange`/`hour`; `describeAudit` untuk tiap `AuditAction` + aktor deleted/system; `loginErrorMessage` 3 kelompok kode.
- [ ] `sh scripts/install-release.test.sh`: arsitektur salah → exit 1 sebelum `curl`; checksum salah → exit 1, temp dibersihkan, `install-phone.sh` tidak dipanggil; sukses → `install-phone.sh` dipanggil dengan path binary; `PANEL_VERSION` memilih URL `releases/download/<v>/`; 404 → pesan "Belum ada rilis".
- [ ] `sh scripts/package-release.sh` lokal pada `dist/panel` palsu → tarball berisi 6 file, `SHA256SUMS` lolos `sha256sum -c`.

### 6.2 Build & ukuran

- [ ] `bun run build:local` sukses; skrip ukuran (bagian test atau `scripts/bundle-report.ts` milik PLAN/01) mencatat JS awal untuk `/` ≤ **150 KB gzip** dan landing tidak memuat kode `src/web/dev`, `src/web/panel`, `src/web/site` (cek string penanda di chunk awal).
- [ ] `bun run typecheck`, `bun run lint` bersih.

### 6.3 UI-QA di browser (build mode demo, 390×844 dan 1440×900, tema terang **dan** gelap)

- [ ] Setiap halaman di ruang lingkup punya satu `<h1>` yang terlihat di 390 px; tanpa scroll horizontal (`scrollWidth === innerWidth`).
- [ ] `/dev`: kartu onboarding tampil untuk DB baru, "Sembunyikan" bertahan setelah login di browser lain; vonis berubah ke "Perlu perhatian" saat cadangan belum diatur.
- [ ] `/dev/settings`: semua teks Indonesia (tidak ada string Inggris dari server kecuali `detail` uji); simpan grup Cadangan dengan satu nilai salah → tidak ada yang tersimpan, fokus ke field salah; target sentuh tombol ↺/Simpan/Uji ≥ 44 px di HP.
- [ ] `/dev/users`: promosi ke Admin selalu lewat dialog dengan peringatan; hapus butuh ketik email.
- [ ] `/profile` sebagai `user`: kartu belum punya akses terlihat tanpa scroll; daftar sesi + revoke bekerja.
- [ ] `/`: header satu baris di 390 px; "Pasang di HP-mu" ke `#pasang`; tombol salin menyalin dua baris; tidak ada tombol "Masuk dengan Google"; gambar tema mengikuti tema; Lighthouse mobile (lokal) LCP < 2,5 dtk di throttle "Fast 4G".
- [ ] Pratinjau tautan: `curl` `/` tanpa JS menampilkan `og:*` lengkap (validasi manual di debugger pratinjau Telegram/WhatsApp setelah deploy).
- [ ] `/xyz` sebagai tamu → 404 publik; `/panel` sebagai tamu → `/login`.

### 6.4 Rilis (setelah merge, oleh pemilik)

- [ ] Tag `v<versi>` → workflow hijau, rilis berisi 3 aset, `gh attestation verify` lolos, perintah landing berhasil di HP bersih (Termux baru) sampai pesan "isi `.env`".

---

## 7. Rencana kerja

Ukuran: S < 150 baris diff, M 150–400, L > 400. Nama worker unik; worker tidak commit/push/ganti branch.
**Tidak ada dua worker di satu file dalam satu gelombang** — termasuk lintas PLAN; urutan lintas PLAN ditandai.

### Gelombang 1 — server, shared, distribusi (paralel; prasyarat: hotfix CSRF sudah masuk)

| Worker              | File (kepemilikan eksklusif)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Ukuran |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-server-01` | `src/shared/dev.types.ts`, `src/server/settings.service.ts` (struktur: `SettingKey` dari shared, hapus label/description, `default`, `readable`, `setSettings` batch), `src/server/routes/dev.routes.ts`, `src/server/dev/health.service.ts`, `src/server/heartbeat.ts` (baru), `src/server/dev/setup.service.ts`, `src/server/dev/users.service.ts`, `src/server/backup/backup.verify.ts` (baru), `src/server/routes/api.routes.ts` (rute setup), tests §6.1 server | L      |
| `wkr-adm-seo-01`    | `src/server/http/seo.ts` (baru), `src/shared/roles.ts` (`SPA_ROOTS`, `isKnownSpaPath`), `src/web/assets/og.png` + `apple-touch-icon.png` (placeholder bermerek dulu, diganti gelombang 3), `tests/server.seo.test.ts`. **`src/server/index.ts`** hanya bila PLAN/01 & PLAN/04 tidak menyentuhnya di gelombang ini (lihat dependensi)                                                                                                                                 | M      |
| `wkr-adm-dist-01`   | `LICENSE`, `package.json` (hanya `"license"`), `.github/workflows/release.yml`, `scripts/package-release.sh`, `scripts/install-release.sh`, `scripts/install-release.test.sh`                                                                                                                                                                                                                                                                                        | M      |
| `wkr-adm-i18n-01`   | Pecah `src/web/i18n/id.dev.ts` → `id.dev.health.ts`, `id.dev.setup.ts`, `id.dev.users.ts`, `id.dev.audit.ts`, `id.dev.logs.ts` (id.dev.ts jadi re-export); buat `id.settings.ts` (13 kunci + grup + uji), `id.account.ts` (login + profil dipindah dari `id.ts`); `id.ts` hanya merge. Mekanis + teks baru §5                                                                                                                                                        | M      |

### Gelombang 2 — halaman web (paralel; prasyarat: gelombang 1 + PLAN/01 gelombang komponen: `PageHeader`, `DataTable` slot aksi, `ConfirmAction` tier, `QueryView` dengan `empty` wajib, `Toaster` tunggal)

| Worker                    | File                                                                                                                                                                                                                                                                   | Ukuran |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-health-web-01`   | `dev/health.page.tsx`, `dev/onboarding.card.tsx` (baru), `dev/onboarding.state.ts` (baru), `i18n/id.dev.health.ts`, `i18n/id.dev.setup.ts`, test web terkait                                                                                                           | M      |
| `wkr-adm-settings-web-01` | `dev/settings.page.tsx`, `dev/settings.group.tsx` (baru), `dev/setting.field.tsx`, `dev/secret.field.tsx` (baru), `dev/settings.test.tsx` (baru), hapus `dev/cloudflare.verify.tsx`, `dev/settings.state.ts`, `dev/settings.registry.ts` (baru), `i18n/id.settings.ts` | L      |
| `wkr-adm-users-web-01`    | `dev/users.page.tsx`, `dev/users.list.tsx`, `dev/user.role.dialog.tsx` (baru), `dev/audit.page.tsx`, `dev/audit.describe.ts` (baru), `dev/logs.page.tsx`, `i18n/id.dev.users.ts`, `id.dev.audit.ts`, `id.dev.logs.ts`                                                  | L      |
| `wkr-adm-account-web-01`  | `pages/profile.page.tsx`, `pages/profile.sessions.tsx`, `pages/profile.no-access.tsx`, `pages/profile.theme.tsx` (baru semua), `pages/login.page.tsx`, `pages/login.error.ts`, `pages/public-not-found.page.tsx` (baru), `i18n/id.account.ts`                          | M      |
| `wkr-adm-landing-01`      | `src/web/landing/*` (hapus `phone.mock.tsx`, tambah `install.section.tsx`, `shots.section.tsx`, `limits.section.tsx`), `landing.cta.ts`, `i18n/id.landing.ts`, `tests/web.landing.test.ts`                                                                             | L      |

### Gelombang 3 — rute, screenshot, integrasi (berurutan per file)

| Worker                | File                                                                                                                                                                                                                  | Ukuran |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-routing-01`  | `src/web/session/session.redirect.ts`, `src/web/router.tsx` (`*` ke root + `NotFoundRoute`), `tests/web.session.test.ts` — **setelah** PLAN/01 selesai mengubah `router.tsx` (lazy) dan `app.layout.tsx` (`children`) | S      |
| `wkr-adm-cfverify-01` | fungsi `verify()` di `src/server/cloudflare/dns.provider.ts` → `CloudflareVerify` berkode, `cloudflare.routes.ts` — **setelah** gelombang PLAN/03 yang menyentuh `dns.provider.ts`                                    | S      |
| `wkr-adm-shots-01`    | `scripts/demo-seed.ts` (baru, tidak masuk binary), aset `src/web/assets/landing/*.webp`, `og.png`, `apple-touch-icon.png` final — **setelah** semua halaman PLAN/01–05 yang difoto selesai                            | M      |

`scripts/demo-seed.ts <dataDir>`: membuka `panel.db` build demo (`bun run build:local`, adapter fake otomatis karena tidak ada `$PREFIX/bin/sv`),
menjalankan migrasi, menulis data contoh fiktif (`toko-kopi.contoh.com`, `blog.contoh.com`, 3 job, 5 run cadangan, 20 audit, 1 super admin
`demo@contoh.test`), membuat sesi lewat `internalAdapter.createSession` (pola `tests/panel.api.test.ts:40-53`) dan menulis cookie ke
`<dataDir>/demo-cookie.txt` mode 600 (tidak dicetak). Worker screenshot memasang cookie itu di browser (izin browser automation dari pemilik
diminta saat gelombang ini — Rule 1), memotret 390×844 @2x dan 1440×900 @1x di kedua tema, mengonversi ke WebP (skill `agent-media`), lalu menghapus data dir sementara.
Screenshot dibuat ulang bila UI halaman yang difoto berubah (catat di checklist rilis).

### Gelombang 4 — dokumen (satu worker, setelah semua bukti masuk)

| Worker            | File                                                                                                                                                                                                                                                                      | Ukuran |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-adm-docs-01` | `README.md` (bagian terbatas: "Layar dan peran" — perilaku `/` & alamat tak dikenal; "Instal di HP" — jalur rilis di atas jalur build; tabel Pengaturan tanpa label Inggris + grup; "Login dan peran" — risiko Admin; "Lisensi"), `CHANGELOG.md` (entri versi berikutnya) | M      |

Bila Rule 23 berlaku untuk seluruh program, satu worker dokumen global boleh menggabungkan gelombang 4 semua PLAN.

### Dependensi lintas PLAN (harus dihormati)

| Kepada  | Yang dibutuhkan PLAN/05                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN/01 | `PageHeader` (meta + actions), `DataTable` dengan slot aksi baris "⋯", `ConfirmAction` tier `none/confirm/typed`, `QueryView` dengan `empty` wajib, `Toaster` tunggal (termasuk landing/profile), `useApiQuery` jeda saat hidden, `RelativeTime` satu timer global; `router.tsx` dengan `lazy` untuk semua rute non-landing + `scripts/build.ts` `splitting: true` (K14); `AppLayout` menerima `children`; laporan ukuran bundle. Kepemilikan `router.tsx`, `app.layout.tsx`, `build.ts`, `styles.css`, `index.ts` (cache header) di PLAN/01; PLAN/05 menyentuh `router.tsx` hanya di gelombang 3.                      |
| PLAN/02 | Kunci `notify.*` di `SETTING_KEYS` + registri server **setelah** gelombang 1 PLAN/05 (struktur baru `settings.service.ts`), plus teks labelnya diserahkan ke `wkr-adm-settings-web-01` (atau PLAN/02 menulis langsung `id.settings.ts` di gelombang berbeda); endpoint `POST /api/dev/notify/telegram/test` dengan kode terbatas; `beat("sampler", …)`; `LogViewer`; `QUIET_PATHS` mencakup `/api/me`, `/api/dev/logs`, `/api/dev/health` (G12); default `panel.protected_services` baru.                                                                                                                               |
| PLAN/03 | `integration().ecosystemIncludesAppsJson` tetap ada (onboarding `apps_json`); urutan file `dns.provider.ts`; status job tetap `running` di tabel `job`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| PLAN/04 | Skema audit (aktor terhapus/IP/UA) + `DevAuditEntry` §3.1; `AuditAction` diekspor ke `src/shared` dan ditambah `setup.update`, `backup.verify`; `listAudit` menerima awalan dan `action` berulang (dikerjakan PLAN/04 bersama migrasinya; bila PLAN/04 menolak, `wkr-adm-server-01` mengerjakannya di gelombang sesudah migrasi PLAN/04 masuk); `beat("backup_scheduler", …)` di `backup.service.ts`; ekspor `describe()` S3; kit pemulihan (opsional) untuk item `secret_saved`; snapshot `panel.db` di `install-phone.sh`; review keamanan `release.yml`. Kunci `backup.*` baru ditambah setelah gelombang 1 PLAN/05. |

Perkiraan total PLAN/05: ±3.000–3.800 baris diff (termasuk test), 4 gelombang.

---

## 8. Risiko, asumsi, pertanyaan terbuka

**Risiko**

1. **`settings.service.ts` jadi titik bentrok** tiga PLAN (05 struktur, 02 kunci notify, 04 kunci backup). Mitigasi: PLAN/05 gelombang 1 lebih dulu, PLAN lain hanya menambah entri ke `SETTING_KEYS` + registri setelahnya.
2. **Menghapus `PUT /api/dev/settings/:key` dan `DevSetting.label`** memecah kontrak. Konsumen hanya web panel sendiri (diverifikasi `grep`); dicatat di CHANGELOG sebagai perubahan API admin.
3. **Uji S3 menulis ke bucket nyata.** Objek di bawah `backup.prefix`, nama acak, selalu dicoba dihapus; bila izin delete tidak ada, objek kecil tertinggal dan namanya ditampilkan. Panggilan R2 nyata masih belum pernah diuji end-to-end (README Keterbatasan) — uji manual pertama dengan akun pemilik wajib sebelum rilis.
4. **Deteksi Access bisa salah dua arah**: proses lokal bisa memalsukan header lewat loopback (hanya membuat checklist tercentang, bukan membuka akses), dan Access yang hanya melindungi path halaman (bukan `api/dev`) tidak terlihat di request API. Teks UI menyebutnya "terdeteksi", centang manual tetap tersedia.
5. **Landing di setiap instance bisa diindeks** sebagai duplikat (canonical tiap instance menunjuk dirinya sendiri). Dampak SEO kecil; lihat Q2.
6. **Pipeline rilis = jalur supply chain baru.** Pin SHA, izin per job, tanpa cache, attestation, `bun audit` high — tetap butuh review PLAN/04. Binary ±111 MB per rilis (batas aset GitHub 2 GB, aman).
7. **Screenshot cepat basi** bila UI berubah; dimasukkan ke checklist rilis. Seed demo tidak boleh memuat data asli (hanya nama `contoh.com`/`contoh.test`).
8. **Code splitting**: chunk lama hilang setelah upgrade panel → tab lama gagal memuat rute lazy. Penanganan "Versi panel baru tersedia. Muat ulang." milik PLAN/01 (R&D-01 G24) dan wajib ikut sebelum K14 dirilis.
9. **Skrip instal**: Termux dari Play Store (usang) bisa gagal di `pkg`; prasyarat landing menyebut F-Droid/GitHub. `sha256sum --ignore-missing` butuh coreutils GNU (ada di Termux) — diuji di HP sungguhan pada QA rilis.

**Asumsi**

- A1 [ASUMSI] LICENSE MIT, pemegang hak "makurosolusi". Landing tidak menulis "kode terbuka" sebelum file ada di `main`.
- A2 Nama kunci Telegram dan endpoint uji mengikuti PLAN/02; tabel di §3.5 menyesuaikan tanpa mengubah desain.
- A3 Bentuk `DevAuditEntry` mengikuti PLAN/04; `describeAudit` beradaptasi.
- A4 Bun 1.4.2 tetap versi build sampai rilis pertama (probe K14/K15 dijalankan di versi ini).

**Pertanyaan terbuka untuk pemilik**

1. **Q1 Lisensi**: konfirmasi MIT dan nama pemegang hak di `LICENSE`?
2. **Q2 Rumah kanonik landing**: biarkan setiap instance mengindeks landing-nya sendiri (default plan), atau semua instance memakai `canonical` ke satu URL produk (mis. `https://panel.malikkurosaki.com/`) — butuh satu konstanta `PRODUCT_HOME_URL`?
3. **Q3 Rilis pertama**: versi berapa (usul `0.3.0`), dan kamu sendiri yang membuat tag (worker tidak pernah push tag)?
4. **Q4 Produksi tanpa Access** (R&D-04 G7, R&D-05 §2.11): setelah fitur ini rilis, cek `access` di produksi akan "Perlu perhatian" sampai Access dipasang — sengaja dibiarkan begitu?
