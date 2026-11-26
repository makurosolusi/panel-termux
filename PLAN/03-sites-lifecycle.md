# PLAN 03 — Siklus hidup Situs (integrasi pm2, adopsi, wizard, perubahan, deploy, rollback, variabel lingkungan, domain, hapus)

> Worker: wkr-plan-sites-01 · 2026-11-26 · branch `feature/production-polish` @ 74fe380.
> Sumber: `R&D/03-sites-lifecycle.md` (selanjutnya "R3-Gn"), silang dengan R&D-01/02/04/05, `PLAN/02` dan `PLAN/05`
> yang sudah ada, `docs/content-guide.md`, `docs/research/ui-benchmark.md`, dan kode di HEAD (dikutip `file:baris`).
> Bukti baru di PLAN ini: (1) snippet ecosystem diuji dengan `node` v26 terhadap 7 kondisi `apps.json`; (2) lab pm2
> lokal (pm2 5.4.3, macOS, `PM2_HOME` terisolasi, sudah dibongkar) untuk dua perilaku pm2 yang ditanyakan R3 §7.5.
> Hasil lab lokal **bukan** pengganti uji di HP (POCO memakai pm2 7.1.2 di Termux); lihat §8.1 untuk eksperimen POCO.
> Tidak ada kode yang diubah. Istilah UI mengikuti glosarium (Situs, Domain, Aplikasi, Perubahan, Deploy, Rollback /
> Kembalikan versi sebelumnya, Variabel lingkungan, Unggah).

---

## 1. Tujuan & ruang lingkup

**Tujuan.** Pemilik HP bisa (a) menghubungkan pm2 dengan aman tanpa risiko mematikan aplikasi produksi saat reboot,
(b) mengadopsi `makuro-solusi` dengan data yang benar dari pm2, (c) men-deploy binary 89 MB lewat VPN/4G yang putus-putus
tanpa mengulang dari nol, (d) tahu kenapa deploy gagal dan apa langkah berikutnya, (e) memulihkan perubahan yang
terputus oleh restart panel, semuanya dalam bahasa Indonesia.

### Masuk (menutup gap R&D-03)

| Bagian                                                                                                           | Gap R&D-03                         |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Integrasi pm2 aman: panel membuat `apps.json` = `[]`, snippet aman, verifikasi `node`                            | **G1** (P0), G14                   |
| Adopsi dari aplikasi pm2 nyata (cwd, script, runtime ELF, port), host panel dikecualikan                         | **G2**, **G3** (P0), G11, G23, G31 |
| Journal + "Bersihkan"/"Ulangi" untuk perubahan terputus; timeout shutdown; `save()` aman                         | **G4** (P0), G21                   |
| Unggah yang bisa dilanjutkan (server menyimpan meta, klien memakai `received`), retry ≥ 90 dtk, sha per potongan | **G5** (P0), G22, G24              |
| Kode langkah + parameter (tanpa string Inggris ke UI), error berkode                                             | **G6** (P0)                        |
| Ekor stderr aplikasi + aksi lanjutan saat deploy gagal                                                           | **G7** (P0)                        |
| Cek kesehatan: path, status yang diharapkan, timeout per situs, syarat stabil                                    | G8                                 |
| Simpan variabel lingkungan = file saja, atau perubahan `site.env` (tulis → mulai ulang → cek)                    | G9, G25 (tempel `.env`)            |
| Kunci perubahan dihormati kontrol `/panel/apps` & `/panel/services` (kontrak untuk PLAN/02)                      | G10                                |
| Entri `apps.json` baru dibuat saat deploy pertama, bukan saat buat situs                                         | G12                                |
| Cek DNS di wizard; CNAME manual ke tunnel yang sama diterima                                                     | G13                                |
| `hasPrevious`/versi aktif dari file nyata, dialog rollback "dari → ke" + yang tidak ikut kembali                 | G15, G16                           |
| Hapus situs dengan ketik nama + info cadangan database                                                           | G17                                |
| Header detail dengan status + aksi utama, Mulai ulang, Cek kesehatan, Log                                        | G18                                |
| Aktor, durasi, filter per situs di riwayat perubahan; 409 `busy` membawa `jobId`                                 | G19                                |
| Makna `rolled_back` vs `failed` vs `interrupted` di UI                                                           | G20                                |
| Probe HTTPS domain baru setelah restart cloudflared (non-fatal)                                                  | G27 (sebagian; tanpa `/ready`)     |
| Cache `pm2 jlist` (memakai snapshot PLAN/02)                                                                     | G28                                |

### Keluar

- Nilai env multi-line (G26) — tetap ditolak dengan pesan jelas. P2.
- Deploy dari URL (G29) — P2 (keputusan default brief). Build dari Git — di luar scope.
- Tambah database ke situs yang sudah ada (G30) — P2.
- Deploy dari CI dengan token (G32) — P3/keputusan pemilik.
- Simpan N versi binary (`releases/`) — tetap 1 versi sebelumnya (`app.prev`), sesuai default brief.
- Mengubah `ecosystem.config.js` oleh panel, mengubah situs adopsi menjadi "dikelola", restart pm2-runtime oleh panel.
- Tunnel remote-managed (R3 §6.9-B), `/ready` metrics cloudflared (butuh ubah run script POCO).
- Antrian perubahan (tetap tolak 409 `busy`).

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                               | Alternatif                                                                         | Alasan                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Panel tidak pernah mengedit `ecosystem.config.js`.** Panel membuat `apps.json` berisi `[]` (bila belum ada, tidak pernah menimpa), menampilkan snippet aman, dan memverifikasi dengan `node`. (default brief)                                                                                         | Panel menyisipkan baris sendiri (R3 6.1-B); panel mengambil alih ecosystem (6.1-C) | Parser teks JS rapuh (helper `site()`, komentar); satu kesalahan = semua aplikasi mati saat reboot. Snippet aman + verifikasi menutup risiko yang sama dengan diff kecil                        |
| D2  | Snippet memakai `try/catch` + `Array.isArray` + filter entri ber-`name`, bukan `existsSync`                                                                                                                                                                                                             | `existsSync ? require : []` (R3 6.1-A)                                             | `existsSync` tetap melempar bila JSON rusak/kosong; diuji (§3.6): 7 kondisi, aplikasi tulisan tangan selalu termuat                                                                             |
| D3  | **Pembuatan `apps.json`**: saat panel start (mode termux, bila `sites.dir` ada) dan di `POST /integration/verify`. Tidak di `GET`                                                                                                                                                                       | Saat situs pertama dibuat (sekarang)                                               | Snippet tidak bergantung pada urutan; `GET` bebas efek samping                                                                                                                                  |
| D4  | **Integrasi wajib "siap" sebelum Buat situs dan sebelum deploy pertama situs dikelola**. Adopsi dan deploy situs adopsi tidak butuh integrasi                                                                                                                                                           | Hanya peringatan (sekarang)                                                        | Situs yang "berhasil" tetapi tak akan jalan setelah reboot adalah kegagalan senyap                                                                                                              |
| D5  | **Entri `apps.json` hanya ada bila `app` ada.** Entri ditulis di deploy pertama (setelah swap), dihapus sebelum binary dihapus                                                                                                                                                                          | Tulis saat buat situs (sekarang)                                                   | Lab lokal E1: pm2-runtime yang menemukan satu entri dengan script hilang menghentikan **semua** aplikasi lalu keluar, juga dengan `--no-auto-exit` (§8.1). Harus dikonfirmasi di POCO           |
| D6  | **Adopsi berbasis aplikasi pm2** (dropdown dari pm2, bukan teks bebas). `dir` = `pm_cwd` (harus di dalam `sites.dir`), runtime dari ELF `<cwd>/app`, port dari ingress, cocokkan via port pm2/args/`.env PORT`                                                                                          | Form bebas + validasi (R3 6.2-B)                                                   | Pemilik tidak perlu tahu nama yang benar; data POCO membuktikan form bebas menghasilkan situs yang tak bisa di-deploy                                                                           |
| D7  | Baca `PORT` dari `<cwd>/.env` dengan parser satu-kunci (hanya baris `PORT=<1-5 digit>`), hasil hanya integer, tidak pernah dilog                                                                                                                                                                        | Tidak membaca `.env`; atau parse penuh                                             | `makuro-solusi` hanya punya port di `.env`. Parser satu-kunci tidak bisa membocorkan nilai lain                                                                                                 |
| D8  | Host panel sendiri (`APP_BASE_URL`) dan rule ingress yang menuju `PORT` panel ditandai `self` → tampil "Panel Termux (domain ini)" tanpa tombol Adopsi; server menolak 409 `self_hostname`                                                                                                              | Disembunyikan                                                                      | Pemilik melihat semua rule (tak ada yang "hilang"), tetapi tidak bisa memutus akses panel. Port panel juga dikeluarkan dari `suggestPort` (G31)                                                 |
| D9  | **Langkah dan hasil berkode**: `JobStep.key` (union tetap) + `code` hasil + `params` + `detail` teknis (Inggris boleh, bisa disalin). Klien menerjemahkan; server tidak mengirim label                                                                                                                  | Server menulis bahasa Indonesia                                                    | Satu sumber kebenaran teks di i18n (pola `errorCodes`); `satisfies Record<...>` memaksa terjemahan lengkap saat compile                                                                         |
| D10 | **Perubahan terputus = status `interrupted`** + journal (`job.input` + status langkah yang sudah persisten). Pemulihan **manual**: "Bersihkan" (create/hostname.add/deploy/rollback/env/restart) atau "Ulangi" (delete/hostname.remove). Tanpa undo otomatis saat boot                                  | Undo otomatis saat boot (R3 6.3-B); tetap "failed"                                 | Undo saat boot bisa bertabrakan dengan pm2/cloudflared yang baru start dan me-restart cloudflared tanpa ada orang. Pemeriksaan idempoten berbasis file nyata lebih kuat daripada closure memori |
| D11 | `SHUTDOWN_TIMEOUT_MS` 20 → **120 dtk** (§4.12)                                                                                                                                                                                                                                                          | 90 dtk (R3); 360 dtk (batas health maks)                                           | 120 dtk menutup perubahan tipikal (create ≤ 45 dtk, deploy ≤ 90 dtk dengan health default 60). Sisanya masuk jalur D10. Panel tidak bisa dibuka selama menunggu, hanya bila ada perubahan       |
| D12 | **Unggah: sha-256 per potongan** (header `X-Chunk-Sha256`), sha akhir dihitung server saat assemble. `UploadStartRequest.sha256` dihapus                                                                                                                                                                | SHA-256 inkremental di klien (R3 6.5 opsi 1)                                       | Memori browser tidak lagi sebesar file (G24 ikut tertutup); integritas per potongan memungkinkan resume yang aman (cocokkan sha potongan)                                                       |
| D13 | **Meta unggahan dipersist** di `<data>/uploads/<id>/meta.json`; panel restart tidak lagi menghapus unggahan (TTL 1 jam sejak potongan terakhir tetap)                                                                                                                                                   | Hanya memori (sekarang)                                                            | Resume harus bertahan restart panel (upgrade) dan reload karena Access 401                                                                                                                      |
| D14 | Runtime binary dibaca dari **potongan 0** saat diterima; ELF tidak valid → 400 `invalid_binary`, situs adopsi dengan runtime ≠ script pm2 → 409 `runtime_mismatch`, **sebelum** sisa 81 MB dikirim                                                                                                      | Tolak setelah swap (sekarang, G11)                                                 | Header ELF + program header ada di 8 MB pertama (`deploy.service.ts:143` sudah mengandalkannya)                                                                                                 |
| D15 | Retry potongan: jeda 1, 2, 4, 8, 15, 30, 30 dtk (total 90 dtk) untuk galat jaringan, 408, 429, 5xx, 52x; `offline` menjeda tanpa menghitung; setelah habis → "Unggahan terhenti" + "Lanjutkan unggahan"                                                                                                 | 1/2/4 dtk (sekarang, ±7 dtk)                                                       | Restart cloudflared bisa 30 dtk (`site.steps.ts:13`) + reconnect edge                                                                                                                           |
| D16 | Cek kesehatan per situs: `healthPath` (default `/`), `healthExpectStatus` (null = apa pun < 500; angka = harus sama persis), `healthTimeoutSec` (default 60, 10–300). Sukses = 2 jawaban lolos berturut-turut (jarak 1 dtk) **dan** `restarts` pm2 tidak naik + status `online` selama 5 dtk sesudahnya | Satu jawaban < 500, 30 dtk (sekarang)                                              | Menangkap crash 2 dtk setelah start (migrasi gagal) dan start lambat. Batas 300 dtk mengikuti Railway                                                                                           |
| D17 | Ekor stderr aplikasi (50 baris) diambil saat `app_restart`/`health` gagal, **diredaksi** (nilai `.env` situs ≥ 6 karakter + userinfo URL), disimpan **di memori saja** (maks 20 job, 1 jam)                                                                                                             | Disimpan di `job.steps`                                                            | Log aplikasi bisa memuat rahasia (R3 4.1); redaksi nilai `.env` murah karena server tahu nilainya                                                                                               |
| D18 | Simpan variabel lingkungan: **"Simpan"** = tulis file saja (di bawah kunci, tercatat audit) → banner "Perlu mulai ulang"; **"Simpan dan mulai ulang"** = perubahan `site.env` (tulis → mulai ulang → cek kesehatan; gagal → `.env` lama dipulihkan + mulai ulang lagi)                                  | Simpan = restart langsung (sekarang)                                               | Nilai salah tidak lagi membuat aplikasi mati tanpa jejak; banyak kunci bisa diubah lalu restart sekali                                                                                          |
| D19 | `restartPending` dihitung, bukan disimpan: `mtime(.env) > pm2 pm_uptime`                                                                                                                                                                                                                                | Kolom flag                                                                         | Tanpa state tambahan; benar juga bila `.env` diedit lewat ssh                                                                                                                                   |
| D20 | Kunci terkunci (`PORT`, dan `DATABASE_URL` bila situs punya database) hanya untuk situs **dikelola**, ditegakkan di server juga. Situs adopsi bebas. Regex kunci satu sumber di `src/shared/site.types.ts`                                                                                              | Aturan klien ≠ server (sekarang, G23)                                              | Pemilik harus bisa mengganti `DATABASE_URL` makuro-solusi                                                                                                                                       |
| D21 | Versi: tetap `app` + `app.prev` (default brief). `binary.live/previous` dari `stat` + sha (cache per `ino/size/mtimeMs`), badge "Aktif" = baris deploy yang sha-nya sama dengan file `app`                                                                                                              | `releases/<sha>` N=3 (R3 6.7-A)                                                    | Menutup kebohongan UI tanpa biaya disk; jujur juga bila binary diganti lewat ssh                                                                                                                |
| D22 | Konfirmasi: hapus situs = **typed** (ketik nama, server juga mensyaratkan `?confirm=<nama>`); rollback, mulai ulang, hapus domain = **confirm**; Cek kesehatan, Bersihkan inspeksi = tanpa konfirmasi                                                                                                   | Satu tingkat (sekarang)                                                            | Tier PLAN/01 (R1 G8). Parameter server menahan panggilan API tak sengaja                                                                                                                        |
| D23 | Detail situs = **satu halaman dengan bagian + navigasi jangkar** (chip lengket di HP), bukan tab                                                                                                                                                                                                        | Tab (radix tersedia lewat `radix-ui`)                                              | Konten tidak tersembunyi (Ctrl-F, deep link `#deploy`), lebih sedikit state, cocok dengan "scroll di HP"                                                                                        |
| D24 | Buat situs **tidak** menyertakan unggah di dalam wizard; halaman hasil memberi CTA besar "Unggah binary pertama" (R3 6.4-B)                                                                                                                                                                             | Wizard 4 langkah dengan unggah (6.4-A)                                             | Dua job berbeda dalam satu alur membuat kegagalan sulit dijelaskan                                                                                                                              |
| D25 | Cleanup deploy/rollback yang terputus = **kembali ke keadaan sebelum perubahan** (bila swap sudah terjadi), lalu mulai ulang + cek kesehatan                                                                                                                                                            | Pilihan "pertahankan versi baru"                                                   | Status kesehatan versi baru tidak diketahui; deploy ulang murah karena unggahan bisa dilanjutkan. Opsi "pertahankan" = pertanyaan terbuka Q3                                                    |
| D26 | Kunci perubahan untuk kontrol lain: `jobs.isLocked(resource)` (nama final untuk PLAN/02). Saat perubahan berjalan: layanan `cloudflared` dan `pm2` terkunci; layanan `postgres` terkunci selama create/delete ber-database; aplikasi pm2 milik situs target terkunci                                    | Satu kunci untuk semuanya                                                          | Mencegah restart cloudflared/aplikasi di tengah health check (R3 4.3) tanpa mengunci hal yang tak terkait                                                                                       |

Default brief yang dipakai di sini: D1 (apps.json), 1 binary sebelumnya (D21), deploy dari URL = P2, git di luar scope,
admin dipercaya penuh (aksi admin ≈ pemilik HP; tidak ada sandbox — catatan risiko di README: admin bisa menjalankan
binary apa pun sebagai user Termux). `pm2` dan `postgres` sebagai layanan terlindungi = milik PLAN/02, dipakai di sini
untuk teks akibat.

---

## 3. Model data & kontrak API

### 3.1 Tipe bersama — `src/shared/site.types.ts` (diganti)

```ts
// Contract of the site management API under /api/panel (role ≥ admin). Errors: { error, message, ...extra }.
import type { AppStatus } from "./panel.types";

/** How pm2 runs the binary: directly (Android linker / static) or through grun (glibc). */
export type SiteRuntime = "native" | "grun";
/** What a hand-written pm2 entry runs, read from pm2_env.pm_exec_path: grun wrapper, the binary itself, or anything else. */
export type ScriptRuntime = SiteRuntime | "other";
export type SiteAppStatus = AppStatus | "not_deployed";

/** Allowed env key (one source for client and server). */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Health check bounds. */
export const HEALTH_TIMEOUT_MIN_SEC = 10;
export const HEALTH_TIMEOUT_MAX_SEC = 300;
export const HEALTH_TIMEOUT_DEFAULT_SEC = 60;

export type SiteHealthConfig = { path: string; expectStatus: number | null; timeoutSec: number };

/** Item of GET /sites. */
export type Site = {
  name: string;
  port: number;
  hostnames: string[];
  database: string | null;
  runtime: SiteRuntime;
  managed: boolean;
  app: string; // pm2 process name (site.app ?? site.name)
  appStatus: SiteAppStatus;
  restarts: number | null;
  lastDeploy: { at: string; kind: DeployKindRef; status: DeployStatusRef; actorName: string | null } | null;
  createdAt: string;
};
type DeployKindRef = "deploy" | "rollback";
type DeployStatusRef = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";

/** One binary file of a site. `sha256` null only when hashing failed (I/O error). */
export type BinaryInfo = {
  sizeBytes: number;
  modifiedAt: string;
  sha256: string | null;
  /** Deploy row that put this exact binary in place (newest succeeded with same sha), if any. */
  deployId: string | null;
  fileName: string | null;
};

/** GET /sites/:name. Env values are never returned. */
export type SiteDetail = Site & {
  dir: string;
  envKeys: string[];
  /** Keys the panel owns for this site (managed: PORT, DATABASE_URL when database); [] for adopted sites. */
  lockedEnvKeys: string[];
  /** .env changed after the app (re)started: changes are not live yet. */
  restartPending: boolean;
  dns: { hostname: string; managed: boolean }[];
  health: SiteHealthConfig;
  binary: { live: BinaryInfo | null; previous: BinaryInfo | null };
  /** Adopted sites: what the hand-written pm2 entry runs (null when pm2 does not know the app). */
  scriptRuntime: ScriptRuntime | null;
  /** Why "Deploy" is disabled, or null when allowed. */
  deployBlocker: "integration" | "no_folder" | null;
  /** Running change touching this site, for the "Perubahan sedang berjalan" banner. */
  activeJob: ActiveJob | null;
};

export type ActiveJob = { id: string; kind: JobKind; target: string; startedAt: string };

/** GET /sites/discovered. */
export type Discovered = { ingress: DiscoveredIngress[]; apps: AdoptCandidateApp[] };

/** Ingress rule that belongs to no site. `self` = the panel's own hostname/port (never adoptable). */
export type DiscoveredIngress = {
  hostname: string;
  port: number | null;
  self: boolean;
  /** pm2 app whose known port equals `port` (first candidate without blockers), else null. */
  match: string | null;
  blockers: ("self" | "no_port" | "wildcard")[];
};

/** pm2 app not used by any site, as adoption candidate. Paths are shown to admins only. */
export type AdoptCandidateApp = {
  name: string;
  status: AppStatus;
  cwd: string | null;
  port: number | null;
  portSource: "pm2_env" | "pm2_args" | "dotenv" | null;
  /** From the ELF header of <cwd>/app; null when there is no readable binary. */
  runtime: SiteRuntime | null;
  scriptRuntime: ScriptRuntime;
  blockers: ("outside_sites_dir" | "no_binary" | "invalid_binary" | "pm2_module" | "name_invalid")[];
  /** Non-blocking notes shown in the dialog. */
  warnings: ("runtime_script_mismatch" | "port_unknown" | "port_mismatch")[];
};

/** Body of POST /sites/adopt (→ 201 SiteDetail). Everything else is derived on the server. */
export type SiteAdoptRequest = { hostname: string; app: string; name?: string };

/** Body of POST /sites/check. `scope: "hostname"` checks only the hostname (domain dialog). */
export type SiteCheckRequest = {
  name?: string;
  hostname: string;
  port?: number;
  database?: boolean;
  scope?: "site" | "hostname";
};

export type SiteIssueCode =
  | "name_invalid"
  | "name_taken"
  | "name_folder_exists"
  | "name_database_exists"
  | "name_leftover"
  | "hostname_invalid"
  | "hostname_in_use"
  | "hostname_self"
  | "hostname_zone_missing"
  | "hostname_dns_conflict"
  | "port_invalid"
  | "port_out_of_range"
  | "port_in_use"
  | "port_panel";
/** Non-blocking hints, e.g. "existing CNAME already points at this tunnel". */
export type SiteNoteCode = "dns_same_tunnel" | "dns_owned" | "dns_token_missing" | "dns_check_failed";

export type SiteIssue = {
  field: "name" | "hostname" | "port";
  code: SiteIssueCode;
  params: Record<string, string | number>;
};
export type SiteNote = { field: "hostname"; code: SiteNoteCode; params: Record<string, string | number> };
export type SiteCheckResult = { ok: boolean; issues: SiteIssue[]; notes: SiteNote[] };

export type SiteCreateRequest = {
  name: string;
  hostname: string;
  port?: number;
  database: boolean;
  env?: Record<string, string>;
};

/** PUT /sites/:name/env. `restart` true → 202 { jobId } (job site.env); false → 200 SiteEnvSaved. */
export type SiteEnvUpdate = { set: Record<string, string>; unset: string[]; restart: boolean };
export type SiteEnvSaved = { envKeys: string[]; restartPending: boolean };

/** PATCH /sites/:name/settings (→ 200 SiteDetail). Omitted fields stay. */
export type SiteSettingsUpdate = { health?: Partial<SiteHealthConfig> };

/** GET /sites/:name/health: one probe now (no stability wait, no job). */
export type HealthProbe = { ok: boolean; status: number | null; ms: number | null; path: string; checkedAt: string };

export type JobAccepted = { jobId: string };

export type JobKind =
  | "site.create"
  | "site.delete"
  | "hostname.add"
  | "hostname.remove"
  | "site.deploy"
  | "site.rollback"
  | "site.restart"
  | "site.env"
  | "job.cleanup";
export type JobStatus = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";
export type JobStepStatus = "pending" | "running" | "done" | "failed" | "rolled_back" | "skipped";

export type JobStepKey =
  | "validate"
  | "inspect"
  | "folder"
  | "database"
  | "env_write"
  | "ingress"
  | "dns"
  | "tunnel_restart"
  | "domain_probe"
  | "apps_remove"
  | "app_remove"
  | "database_drop"
  | "folder_remove"
  | "assemble"
  | "detect"
  | "chmod"
  | "swap"
  | "apps_entry"
  | "app_restart"
  | "health";

/** Result/skip/failure codes (i18n: id.job.outcomes). Grouped by step; see PLAN 03 §3.4. */
export type JobOutcomeCode = /* union listed in §3.4 */ string;

export type JobParams = Record<string, string | number | boolean | null>;

export type JobStep = {
  key: JobStepKey;
  status: JobStepStatus;
  code: JobOutcomeCode | null;
  params: JobParams;
  /** Technical detail (English allowed, copyable). Never secrets. */
  detail: string | null;
  /** Short technical lines (max 20 × 300 chars). Never secrets, never app output. */
  log: string[];
  startedAt: string | null;
  finishedAt: string | null;
  /** Only on rows written before migration 00NN: the old English label/message. */
  legacyLabel?: string;
};

export type JobError = { code: JobOutcomeCode; params: JobParams; detail: string | null };

/** What the UI may offer after the job; computed by the server (one source). */
export type JobNextAction = "cleanup" | "retry" | "rollback" | "app_log" | "open_site" | "first_deploy" | "redeploy";

export type Job = {
  id: string;
  kind: JobKind;
  target: string;
  status: JobStatus;
  steps: JobStep[];
  error: JobError | null;
  actor: { id: string; name: string } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  next: JobNextAction[];
  /** Job id of the cleanup/retry that resolved this interrupted/failed job. */
  resolvedBy: string | null;
  /** job.cleanup only: the job it cleans up. */
  cleans: string | null;
  /** True while the stderr tail of the app is still held in memory (GET /jobs/:id/app-log). */
  hasAppLog: boolean;
};

export type AppLogTail = { lines: string[]; capturedAt: string; redacted: number };

/** GET /integration and POST /integration/verify. */
export type IntegrationCheckKey =
  | "sites_dir"
  | "apps_json"
  | "ecosystem_file"
  | "ecosystem_loads"
  | "ecosystem_spreads_apps_json"
  | "apps_entries_runnable"
  | "tunnel"
  | "cloudflare_token";
export type IntegrationCheck = {
  key: IntegrationCheckKey;
  state: "ok" | "warning" | "error";
  params: JobParams;
  detail: string | null;
};
export type Integration = {
  /** sites_dir, apps_json, ecosystem_loads, ecosystem_spreads_apps_json, apps_entries_runnable and tunnel are ok. */
  ready: boolean;
  checks: IntegrationCheck[];
  /** Exact snippet with this phone's paths (§3.6). */
  snippet: string;
  ecosystemPath: string;
  appsJsonPath: string;
  /** Names pm2 would load from ecosystem.config.js (no env, no paths). */
  appNames: string[];
  checkedAt: string;
};
```

`JobOutcomeCode` ditulis sebagai union literal lengkap (daftar §3.4), bukan `string`; blok di atas hanya menyingkat.

### 3.2 Tipe bersama — `src/shared/deploy.types.ts` (diganti)

```ts
export const DEPLOY_CHUNK_SIZE = 8 * 1024 * 1024;
export const DEPLOY_MAX_BYTES = 300 * 1000 * 1000;
/** Header carrying the lowercase hex sha256 of a chunk body. */
export const CHUNK_SHA_HEADER = "X-Chunk-Sha256";

/** POST /sites/:name/uploads (→ 201 UploadState). Replaces that site's previous unfinished upload. */
export type UploadStartRequest = { sizeBytes: number; fileName: string };

/** GET /uploads/:id, GET /sites/:name/uploads/active (null when none), and 201 of POST uploads. */
export type UploadState = {
  uploadId: string;
  site: string;
  fileName: string;
  sizeBytes: number;
  chunkSize: number;
  chunks: number;
  received: { index: number; sha256: string }[];
  /** From chunk 0, once received. */
  runtime: "native" | "grun" | null;
  expiresAt: string;
};

/** PUT /uploads/:id/chunks/:index response. */
export type ChunkReceived = { received: number[]; runtime: "native" | "grun" | null };

export type DeployStatus = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";
export type DeployKind = "deploy" | "rollback";

/** Item of GET /sites/:name/deploys?page&pageSize (Page<Deploy>, newest first). */
export type Deploy = {
  id: string;
  at: string;
  finishedAt: string | null;
  actor: { id: string; name: string } | null;
  sha256: string;
  sizeBytes: number;
  fileName: string | null;
  runtime: "native" | "grun";
  status: DeployStatus;
  jobId: string;
  kind: DeployKind;
  /** This row's binary is the live `app` right now. At most one row per site. */
  active: boolean;
};
```

### 3.3 Basis data — migration `drizzle/00NN_sites_lifecycle.sql`

Nomor `00NN` ditetapkan orkestrator (PLAN/02, /04, /05 juga menambah migration). Dibuat dengan `bun run db:generate`
dari perubahan schema, lalu diberi komentar. SQLite tidak punya `ADD COLUMN IF NOT EXISTS`; idempotensi dijamin journal
drizzle (`__drizzle_migrations`), diuji di `tests/db.migrate.test.ts` (migrasi DB kosong + DB berisi baris v0.2.x).

```sql
-- Health check per site (D16). Existing rows get the old behaviour's path and a longer, safer timeout.
ALTER TABLE `site` ADD `health_path` text DEFAULT '/' NOT NULL;
--> statement-breakpoint
-- null = any status < 500 (the pre-00NN rule); a number = that exact status.
ALTER TABLE `site` ADD `health_expect_status` integer;
--> statement-breakpoint
ALTER TABLE `site` ADD `health_timeout_sec` integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
-- Journal for recovering interrupted jobs (D10): non-secret request input (names, hostname, port, sha256, flags).
ALTER TABLE `job` ADD `input` text;
--> statement-breakpoint
-- Id of the cleanup/retry job that resolved this one; null = still needs attention when interrupted/failed.
ALTER TABLE `job` ADD `resolved_by` text;
--> statement-breakpoint
-- Per-site change history (GET /jobs?target=) and "latest job of a site" lookups.
CREATE INDEX `job_target_started_idx` ON `job` (`target`,`started_at`);
--> statement-breakpoint
-- Original file name of the uploaded binary, shown in the deploy history (sanitized, ≤ 255 chars).
ALTER TABLE `deploy` ADD `file_name` text;
--> statement-breakpoint
ALTER TABLE `deploy` ADD `finished_at` integer;
```

- `job.steps` tetap kolom JSON; bentuk `JobStep` baru tidak butuh migrasi. Baris lama (`{key,label,status,message}`)
  dibaca `toJob()` lewat `legacyStep()`: `key` lama dipetakan (`restart` → `tunnel_restart` untuk jenis `site.*`/
  `hostname.*`, → `app_restart` untuk `site.deploy`/`site.rollback`; `env` → `env_write`; `apps` → `apps_entry`/
  `apps_remove`; `pm2` → `app_remove`; database pada `site.delete` → `database_drop`; folder pada `site.delete` →
  `folder_remove`), `code` = null, `detail` = `message` lama, `legacyLabel` = `label` lama.
- Status `interrupted` untuk baris yang sedang `running` saat boot (bukan `failed` lagi). Baris lama `failed` dengan
  `error = 'interrupted by panel restart'` tidak dikonversi (tidak ada journal untuk dibersihkan); UI menampilkannya
  sebagai gagal biasa.
- `job.input` per jenis (tanpa rahasia; password database tidak pernah masuk):
  `site.create {name, hostname, port, database}` · `site.delete {name, keepData, keepDatabase}` ·
  `hostname.add|remove {site, hostname}` · `site.deploy {site, uploadId, sha256, sizeBytes, fileName, runtime}` ·
  `site.rollback {site, toSha256, fromSha256}` · `site.env {site, set: string[] /* keys */, unset: string[]}` ·
  `site.restart {site}` · `job.cleanup {jobId}`.
- Tidak ada setting baru. `sites.dir` dan `sites.port_range` tetap (struktur registri milik PLAN/05).

### 3.4 Kode langkah, kode hasil, kode error

Langkah per jenis perubahan (urutan = urutan eksekusi; `!` = irreversible):

| Jenis             | Langkah                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `site.create`     | validate → folder → database → env_write → ingress → dns → tunnel_restart → domain_probe                |
| `site.delete`     | validate → ingress → tunnel_restart → dns → apps_remove → app_remove! → database_drop! → folder_remove! |
| `hostname.add`    | validate → ingress → dns → tunnel_restart → domain_probe                                                |
| `hostname.remove` | ingress → dns → tunnel_restart                                                                          |
| `site.deploy`     | assemble → detect → chmod → swap → apps_entry → app_restart → health                                    |
| `site.rollback`   | swap → apps_entry → app_restart → health                                                                |
| `site.restart`    | app_restart → health                                                                                    |
| `site.env`        | env_write → app_restart → health                                                                        |
| `job.cleanup`     | inspect → (langkah perbaikan yang dibutuhkan, dari daftar yang sama) — §4.11                            |

`domain_probe` tidak pernah gagal (hasil `not_yet` = selesai dengan nada peringatan). `apps_entry` pada situs dikelola
yang belum punya entri = **mendaftarkan** entri (D5), pada situs yang sudah punya entri = menyetel runtime.

Kode hasil (`JobOutcomeCode`, union di shared; teks di `id.job.outcomes`, contoh teks di §5.9):

| Langkah        | Sukses / dilewati                                                                                                             | Gagal                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| validate       | `validated`                                                                                                                   | `invalid_site {issues}` (params `issues` = kode dipisah koma)                                  |
| inspect        | `inspect_found {count}`, `inspect_nothing`                                                                                    | `unexpected`                                                                                   |
| folder         | `folder_created {path}`                                                                                                       | `folder_failed`                                                                                |
| database       | `database_created {name}`, `database_skipped`                                                                                 | `database_failed`                                                                              |
| env_write      | `env_written {count}`, `env_updated {set, unset}`                                                                             | `env_failed`                                                                                   |
| ingress        | `ingress_added {hostname}`, `ingress_removed {hostnames}`, `ingress_unchanged`                                                | `ingress_rejected`, `ingress_config_missing {path}`, `ingress_unsupported`                     |
| dns            | `dns_created {hostname}`, `dns_owned_present`, `dns_same_tunnel`, `dns_deleted {hostnames}`, `dns_no_token`, `dns_none_owned` | `dns_conflict {hostname}`, `dns_zone_missing {hostname}`, `dns_api_failed`, `dns_no_tunnel_id` |
| tunnel_restart | `tunnel_restarted {seconds}`, `tunnel_unchanged`                                                                              | `tunnel_not_running {seconds}`, `tunnel_service_missing`                                       |
| domain_probe   | `domain_reachable {hostname, status}`, `domain_not_yet {hostname, status}`                                                    | –                                                                                              |
| apps_remove    | `apps_removed {name}`, `apps_absent`, `apps_adopted_skip`                                                                     | `apps_json_invalid`                                                                            |
| app_remove     | `app_removed {name}`, `app_not_deployed`, `app_adopted_skip`                                                                  | `pm2_failed`                                                                                   |
| database_drop  | `database_dropped {name}`, `database_kept`, `database_none`, `database_adopted_skip`                                          | `database_failed`                                                                              |
| folder_remove  | `folder_removed {path}`, `folder_kept`, `folder_gone`, `folder_adopted_skip`, `folder_not_empty {path, entries}`              | `folder_failed`                                                                                |
| assemble       | `assembled {sizeBytes}`                                                                                                       | `size_mismatch {got, expected}`, `chunk_missing {index}`, `folder_missing {path}`, `disk_full` |
| detect         | `runtime_native`, `runtime_grun`                                                                                              | `invalid_binary`, `runtime_mismatch {expected, got}`                                           |
| chmod          | `chmod_done`                                                                                                                  | `chmod_failed`                                                                                 |
| swap           | `swap_first`, `swap_kept_previous`, `swap_back`                                                                               | `swap_failed`                                                                                  |
| apps_entry     | `apps_registered {runtime}`, `apps_runtime_set {runtime}`, `apps_unchanged`, `apps_adopted_skip`                              | `apps_json_invalid`, `integration_not_ready`                                                   |
| app_restart    | `app_restarted {name}`, `app_started {name}`                                                                                  | `app_missing {name}`, `app_not_loaded {name}`, `pm2_failed`                                    |
| health         | `healthy {status, ms, path, seconds}`                                                                                         | `health_timeout {seconds, last, path}`, `app_errored {name}`, `app_unstable {restarts}`        |
| (semua)        | –                                                                                                                             | `unexpected` (detail = pesan error mentah yang sudah aman), `interrupted`                      |

`params.last` untuk `health_timeout`: `"refused"`, `"no_answer"`, atau kode HTTP sebagai string.

Kode error API baru/diubah (semua `{ error, message, ...extra }`; `message` Inggris untuk log, UI memakai `error`):

| Kode                       | HTTP | Extra                                                                                         | Endpoint                                          |
| -------------------------- | ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `busy`                     | 409  | `job: ActiveJob`                                                                              | semua yang memulai perubahan, PUT env, adopt      |
| `integration_required`     | 409  | `failing: IntegrationCheckKey[]`                                                              | POST /sites, complete (deploy pertama dikelola)   |
| `self_hostname`            | 409  | –                                                                                             | POST /sites/adopt                                 |
| `app_not_found`            | 404  | –                                                                                             | POST /sites/adopt                                 |
| `app_in_use`               | 409  | `site`                                                                                        | POST /sites/adopt                                 |
| `adopt_blocked`            | 409  | `blockers: string[]`                                                                          | POST /sites/adopt                                 |
| `hand_written`             | 409  | –                                                                                             | DELETE hostnames (sudah ada; kini dipetakan i18n) |
| `last_hostname`            | 400  | –                                                                                             | DELETE hostnames                                  |
| `confirm_mismatch`         | 400  | –                                                                                             | DELETE /sites/:name                               |
| `env_locked`               | 400  | `keys: string[]`                                                                              | PUT env                                           |
| `invalid_env`              | 400  | `key: string \| null`, `reason: "key" \| "multiline" \| "quote" \| "backslash" \| "too_long"` | PUT env, POST /sites                              |
| `invalid_settings`         | 400  | `field`                                                                                       | PATCH settings                                    |
| `no_folder`                | 409  | –                                                                                             | PUT env, uploads                                  |
| `upload_expired`           | 404  | –                                                                                             | semua `/uploads/:id*`                             |
| `chunk_sha_mismatch`       | 400  | `index`                                                                                       | PUT chunk                                         |
| `missing_chunk_sha`        | 400  | –                                                                                             | PUT chunk                                         |
| `invalid_binary`           | 400  | `reason: "not_elf" \| "not_64le" \| "not_aarch64" \| "interp" \| "truncated"`                 | PUT chunk 0, rollback                             |
| `runtime_mismatch`         | 409  | `expected: ScriptRuntime`, `got: SiteRuntime`                                                 | PUT chunk 0, complete                             |
| `no_space`                 | 507  | `needBytes`, `freeBytes`                                                                      | POST uploads, complete                            |
| `incomplete`               | 400  | `missing: number[]`                                                                           | complete                                          |
| `no_previous`/`no_current` | 409  | –                                                                                             | rollback                                          |
| `not_recoverable`          | 409  | `status`                                                                                      | POST /jobs/:id/cleanup, /retry                    |
| `already_resolved`         | 409  | `resolvedBy`                                                                                  | POST /jobs/:id/cleanup, /retry                    |
| `log_expired`              | 404  | –                                                                                             | GET /jobs/:id/app-log                             |

`ApiError` (`src/server/routes/http.error.ts`) diperluas: `status: 400 | 401 | 404 | 409 | 507` dan argumen keempat
opsional `extra: Record<string, unknown>` yang ikut ke body di `panelOnError` (`panel.routes.ts:29-30`).

### 3.5 Endpoint (semua di `/api/panel`, peran `admin`; mutasi melewati cek Origin + `X-Requested-With` dari hotfix CSRF)

| Metode | Path                                                | Request                              | Response                                                    | Error                                                                                                                                                            |
| ------ | --------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/sites`                                            | –                                    | `Site[]` (urut: bermasalah dulu, lalu nama)                 | –                                                                                                                                                                |
| GET    | `/sites/discovered`                                 | –                                    | `Discovered`                                                | 502 `system_error`                                                                                                                                               |
| GET    | `/sites/suggest-port`                               | –                                    | `{ port }`                                                  | 409 `no_free_port`                                                                                                                                               |
| POST   | `/sites/check`                                      | `SiteCheckRequest`                   | `SiteCheckResult`                                           | –                                                                                                                                                                |
| POST   | `/sites`                                            | `SiteCreateRequest`                  | 202 `JobAccepted`                                           | 400 `invalid_site{issues}`/`invalid_env`, 409 `busy`/`integration_required`                                                                                      |
| POST   | `/sites/adopt`                                      | `SiteAdoptRequest`                   | 201 `SiteDetail`                                            | 400 `invalid_name`/`invalid_hostname`, 404 `app_not_found`, 409 `exists`/`self_hostname`/`app_in_use`/`adopt_blocked`/`busy`                                     |
| GET    | `/sites/:name`                                      | –                                    | `SiteDetail`                                                | 404 `not_found`                                                                                                                                                  |
| PATCH  | `/sites/:name/settings`                             | `SiteSettingsUpdate`                 | `SiteDetail`                                                | 400 `invalid_settings`, 409 `busy`                                                                                                                               |
| GET    | `/sites/:name/health`                               | –                                    | `HealthProbe`                                               | 404                                                                                                                                                              |
| POST   | `/sites/:name/restart`                              | –                                    | 202 `JobAccepted` (`site.restart`)                          | 409 `busy`                                                                                                                                                       |
| PUT    | `/sites/:name/env`                                  | `SiteEnvUpdate`                      | 200 `SiteEnvSaved` atau 202 `JobAccepted`                   | 400 `invalid_env`/`env_locked`, 409 `no_folder`/`busy`                                                                                                           |
| POST   | `/sites/:name/hostnames`                            | `{ hostname }`                       | 202 `JobAccepted`                                           | 400 `invalid_hostname`, 409 `busy`                                                                                                                               |
| DELETE | `/sites/:name/hostnames/:hostname`                  | –                                    | 202 `JobAccepted`                                           | 400 `last_hostname`, 404, 409 `hand_written`/`busy`                                                                                                              |
| DELETE | `/sites/:name?keepData&keepDatabase&confirm=<nama>` | –                                    | 202 `JobAccepted`                                           | 400 `confirm_mismatch`, 409 `busy`                                                                                                                               |
| GET    | `/jobs?page&pageSize&target&kind&status`            | –                                    | `Page<Job>` (terbaru dulu)                                  | 400 `invalid_pagination`                                                                                                                                         |
| GET    | `/jobs/active`                                      | –                                    | `{ job: ActiveJob \| null }`                                | –                                                                                                                                                                |
| GET    | `/jobs/:id`                                         | –                                    | `Job`                                                       | 404                                                                                                                                                              |
| GET    | `/jobs/:id/app-log`                                 | –                                    | `AppLogTail`                                                | 404 `log_expired`                                                                                                                                                |
| POST   | `/jobs/:id/cleanup`                                 | –                                    | 202 `JobAccepted` (`job.cleanup`)                           | 409 `not_recoverable`/`already_resolved`/`busy`                                                                                                                  |
| POST   | `/jobs/:id/retry`                                   | –                                    | 202 `JobAccepted` (jenis sama)                              | 409 `not_recoverable`/`already_resolved`/`busy`                                                                                                                  |
| GET    | `/integration`                                      | –                                    | `Integration` (cache ≤ 30 dtk; dihitung bila belum ada)     | –                                                                                                                                                                |
| POST   | `/integration/verify`                               | –                                    | `Integration` (buat `apps.json` bila belum ada, lalu probe) | 409 `busy`                                                                                                                                                       |
| POST   | `/sites/:name/uploads`                              | `UploadStartRequest`                 | 201 `UploadState`                                           | 400 `invalid_size`/`too_large`/`invalid_file_name`, 409 `no_folder`/`integration_required`, 507 `no_space`                                                       |
| GET    | `/sites/:name/uploads/active`                       | –                                    | `UploadState \| null`                                       | 404                                                                                                                                                              |
| GET    | `/uploads/:id`                                      | –                                    | `UploadState`                                               | 404 `upload_expired`                                                                                                                                             |
| PUT    | `/uploads/:id/chunks/:index`                        | body mentah, header `X-Chunk-Sha256` | `ChunkReceived`                                             | 400 `invalid_index`/`invalid_chunk_size`/`chunk_sha_mismatch`/`missing_chunk_sha`/`invalid_binary`, 404 `upload_expired`, 409 `runtime_mismatch`, 507 `no_space` |
| POST   | `/uploads/:id/complete`                             | –                                    | 202 `JobAccepted`                                           | 400 `incomplete`, 404 `upload_expired`, 409 `busy`/`runtime_mismatch`/`integration_required`, 507 `no_space`                                                     |
| DELETE | `/uploads/:id`                                      | –                                    | 204                                                         | 404 `upload_expired`                                                                                                                                             |
| POST   | `/sites/:name/rollback`                             | –                                    | 202 `JobAccepted`                                           | 400 `invalid_binary`, 409 `no_previous`/`no_current`/`busy`                                                                                                      |
| GET    | `/sites/:name/deploys?page&pageSize`                | –                                    | `Page<Deploy>`                                              | 404                                                                                                                                                              |

Aturan tambahan:

- `/retry` hanya untuk `site.delete` dan `hostname.remove` yang `interrupted`/`failed` dan belum `resolvedBy`
  (langkahnya idempoten: `removeIngressRule` mengembalikan teks sama bila host tidak ada → `ingress_unchanged`,
  `ingress.editor.ts:104`; `dropSql` memakai `IF EXISTS`, `postgres.termux.ts:47-49`). Input diambil dari `job.input`.
- `/cleanup` untuk `site.create`, `hostname.add`, `site.deploy`, `site.rollback`, `site.env`, `site.restart` yang
  `interrupted`, dan untuk jenis mana pun yang `failed` dengan undo tidak bersih. Juga untuk `job.cleanup` yang
  terputus → membuat cleanup baru atas job **asli**.
- `POST /integration/verify` memakai kunci perubahan (`assertIdle`) karena bisa menulis `apps.json`.
- Laju: mutasi lewat rate limiter yang ada (60/menit/sesi, `rate.limit.ts:6`). PUT chunk sudah dikecualikan
  (`CHUNK_ROUTE`, `api.handler.ts:15-16,98`) dan regex itu tidak boleh berubah. Retry `complete` tiap 5 dtk = 12/menit,
  di bawah batas. Body JSON maks 1 MiB (`api.handler.ts:8`) cukup untuk `.env` tempelan (validasi nilai maks 16.384
  karakter per kunci tetap).

### 3.6 Snippet ecosystem aman (diuji)

Teks persis yang dikembalikan `Integration.snippet` (path relatif ke file ecosystem, jadi sama di semua HP):

```js
// Panel Termux: situs buatan panel tercatat di apps.json (dikelola panel, jangan diedit tangan).
// Blok ini aman bila apps.json belum ada, kosong, atau rusak: aplikasi lain di bawah tetap dijalankan pm2.
const panelApps = (() => {
  try {
    const list = require("./apps.json");
    return Array.isArray(list) ? list.filter((a) => a && typeof a.name === "string") : [];
  } catch (e) {
    console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
    return [];
  }
})();
```

lalu di daftar `apps`: `...panelApps,` sebagai elemen terakhir.

Hasil uji (`node` v26.7.0, 2026-11-26; skrip di scratchpad, bukan di repo): ecosystem berisi satu app tulisan tangan

- snippet, dimuat dengan `require()`:

| Kondisi `apps.json`                            | Snippet aman              | Snippet lama `...require('./apps.json')` |
| ---------------------------------------------- | ------------------------- | ---------------------------------------- |
| tidak ada                                      | `["hand"]` + baris stderr | **melempar `MODULE_NOT_FOUND`**          |
| file kosong                                    | `["hand"]` + stderr       | melempar                                 |
| JSON rusak `[{"name":`                         | `["hand"]` + stderr       | melempar                                 |
| objek `{"name":"x"}`                           | `["hand"]`                | melempar (spread objek ke array)         |
| `[]`                                           | `["hand"]`                | `["hand"]`                               |
| `[{"name":"blog",…}]`                          | `["hand","blog"]`         | `["hand","blog"]`                        |
| `apps.json` berupa direktori / tanpa izin baca | `["hand"]` + stderr       | melempar                                 |

Catatan: filter `a && typeof a.name === "string"` ditambahkan setelah uji (entri `null` membuat pm2 gagal memproses
array); test repo §6 wajib mencakup `[null, {"name":"blog"}]`. Uji tingkat pm2-runtime nyata = E5 di §8.1.

**Probe verifikasi** (`src/server/sites/ecosystem.probe.ts`, dijalankan `runTermux("node", ["-e", PROBE, ecosystemPath],
{ cwd: sitesDir, timeoutMs: 15_000 })`). Memuat ecosystem seperti pm2, mencatat apakah `apps.json` ikut di-`require`,
dan hanya mencetak nama aplikasi (env/args tidak pernah keluar):

```js
const Module = require("module");
const path = require("path");
const eco = process.argv[1];
const appsJson = path.join(path.dirname(eco), "apps.json");
let loadedAppsJson = false;
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  try {
    if (Module._resolveFilename(req, parent, isMain) === appsJson) loadedAppsJson = true;
  } catch {}
  return orig.apply(this, arguments);
};
const cfg = require(eco);
const apps = Array.isArray(cfg) ? cfg : (cfg && cfg.apps) || [];
process.stdout.write(
  JSON.stringify({ loadedAppsJson, names: apps.map((a) => a && a.name).filter((n) => typeof n === "string") }) + "\n",
);
```

(Diuji lokal: `{"loadedAppsJson":true,…}` dengan snippet, `false` tanpa snippet.) Catatan `-e`: `process.argv[1]` =
argumen pertama setelah skrip. Ecosystem pemilik **dieksekusi** oleh probe (sama seperti oleh pm2); efek sampingnya
tanggung jawab file itu — dicatat di README. Mode fake: probe membaca `apps.json` sandbox dan menganggap ecosystem
menyebarnya (bisa dimatikan lewat flag fake untuk test).

Pemeriksaan `Integration.checks` (urutan tampil):

| key                           | ok bila                                                                 | state bila tidak                                          |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `sites_dir`                   | folder `sites.dir` ada                                                  | error                                                     |
| `apps_json`                   | `apps.json` ada dan `parseApps` lolos                                   | error (`params.reason: missing/invalid`)                  |
| `ecosystem_file`              | `ecosystem.config.js` ada                                               | error                                                     |
| `ecosystem_loads`             | probe keluar 0 dan mencetak JSON                                        | error (`detail` = 300 char stderr pertama, tanpa isi env) |
| `ecosystem_spreads_apps_json` | `loadedAppsJson` true **dan** setiap nama di `apps.json` ada di `names` | error                                                     |
| `apps_entries_runnable`       | setiap entri `apps.json` punya file `cwd/script` yang ada               | error (`params.names`) — lihat D5                         |
| `tunnel`                      | `config.yml` terbaca + UUID tunnel                                      | error                                                     |
| `cloudflare_token`            | token diisi                                                             | warning (tidak memengaruhi `ready`)                       |

Untuk PLAN/05: fungsi server `integration()` tetap mengembalikan field turunan `ecosystemIncludesAppsJson` (= check
`ecosystem_spreads_apps_json` ok) di objek internal yang dipakai `setup.service.ts`, sehingga item onboarding
`apps_json` tidak berubah kontrak.

### 3.7 Data adapter yang dibutuhkan (diminta ke PLAN/02, pemilik `src/server/system/*`)

`Pm2Proc` (internal, tidak ke klien) ditambah: `cwd: string | null` (`pm2_env.pm_cwd`), `execPath: string | null`
(`pm2_env.pm_exec_path`), `args: string[]` (`pm2_env.args`), `startedAtMs: number | null` (`pm2_env.pm_uptime`,
juga saat tidak online), `module: boolean` (sudah direncanakan PLAN/02). `NetAdapter.httpStatus(port, path = "/",
timeoutMs?)`. Fake adapter: app fake punya `cwd` di bawah sandbox `sites.dir`, satu app tanpa binary, satu app glibc
(`execPath` `.../grun`), satu app modul. Bila PLAN/02 tidak bisa, W2a mengerjakannya **setelah** gelombang adapter
PLAN/02 selesai (bukan paralel).

---

## 4. Flow

### 4.1 Persiapan integrasi (first run, termasuk HP baru)

1. Panel start (termux): bila `sites.dir` ada dan `apps.json` tidak ada → tulis `[]\n` atomik (0644), log info
   `[sites] created apps.json`. Bila `sites.dir` tidak ada → tidak membuat apa pun (check `sites_dir` error).
2. Admin membuka `/panel/sites` → `GET /integration` (cache 30 dtk, dihitung bila kosong; probe `node` ±0,3–0,5 dtk
   di HP). `ready` false → kartu **Persiapan** di atas daftar (§5.1).
3. Kartu menampilkan checklist, snippet + Salin, perintah `nano ~/sites/ecosystem.config.js` + Salin, dan tombol
   **Periksa lagi** → `POST /integration/verify` (buat `apps.json` bila hilang, probe ulang, buang cache).
4. Hasil: semua ok → kartu berubah jadi satu baris sukses "pm2 siap: 3 aplikasi terbaca, termasuk dari apps.json"
   (bisa disembunyikan; muncul lagi bila `ready` turun).
5. Gagal:
   - `ecosystem_loads` error (sintaks salah setelah edit) → pesan "pm2 tidak bisa memuat ecosystem.config.js. Situs
     yang sudah berjalan tidak terganggu sekarang, tetapi **semua aplikasi tidak akan jalan setelah HP dinyalakan
     ulang**. Perbaiki file, lalu periksa lagi." + detail stderr. Nada danger.
   - `node` tidak ada / timeout 15 dtk → `ecosystem_loads` error, `params.reason: "node_missing" | "timeout"`.
   - `busy` → toast standar + tautan perubahan berjalan.
6. Edge: `sites.dir` diubah (PLAN/05 memberi dialog) → cache integrasi dibuang saat setting berubah.
7. **HP baru** (installer PLAN/05): ecosystem tanpa aplikasi tulisan tangan + `apps.json` `[]` → pm2-runtime keluar
   karena 0 aplikasi (lab lokal E4: juga dengan `--no-auto-exit`). Lihat ketergantungan ke PLAN/05 §7.

### 4.2 Adopsi (dari aplikasi pm2 nyata)

1. `GET /sites/discovered`: ingress dari `config.yml` yang hostname-nya bukan milik situs + daftar app pm2 yang tidak
   dipakai situs mana pun (`site.app`) dan bukan modul.
2. Server per app: `cwd` = `realpath(pm_cwd)`; `insideSitesDir` = diawali `realpath(sitesDir) + "/"` (dan bukan
   `sitesDir` itu sendiri); `hasBinary` = `<cwd>/app` adalah file; `runtime` = `detectRuntime(<cwd>/app)` (error →
   blocker `invalid_binary`); `scriptRuntime` = `basename(execPath) === "grun"` → `grun`; `execPath === <cwd>/app` →
   `native`; selain itu `other`; port = env pm2 → args → `.env PORT` (`readEnvPort`, D7).
3. `readEnvPort(dir)`: baca `<dir>/.env` (maks 64 KiB), cari baris pertama `^\s*(?:export\s+)?PORT\s*=\s*(['"]?)(\d{1,5})\1\s*(?:#.*)?$`,
   kembalikan integer 1–65535 atau null. Fungsi tidak mengembalikan/men-log teks lain; error baca → null.
4. Ingress: `self` = hostname sama dengan host `APP_BASE_URL` **atau** port = `PORT` panel. `match` = app pertama tanpa
   blocker yang port-nya = port ingress. Wildcard (`*.x`) → blocker `wildcard`.
5. UI "Belum dikelola" (§5.1): baris per ingress; tombol **Adopsi** membuka dialog dengan app terpilih = `match`.
6. Dialog: Select aplikasi pm2 (wajib; opsi ber-blocker tampil disabled dengan alasan), Nama situs (prefill = nama app
   bila lolos `SITE_NAME_RE`, else kosong), ringkasan read-only: folder, runtime + script, port + sumbernya. Peringatan
   non-blokir: `runtime_script_mismatch` ("Binary glibc tetapi pm2 menjalankannya langsung…"), `port_mismatch`
   ("Domain mengarah ke port 3005, aplikasi mendengar di 3006"), `port_unknown`.
7. Submit → `POST /sites/adopt {hostname, app, name}`. Server mengulang semua pemeriksaan (tidak percaya klien), lalu
   menyisipkan `site {name, port: ingress port, app, runtime: ELF, managed: false, dir: cwd, health default}` +
   `site_hostname {ingressManaged: false, dnsManaged: false}`. Audit `site.adopt` dengan meta {hostname, app, port}.
8. Error: app hilang (dihapus di antara) → 404 `app_not_found` → dialog memuat ulang daftar; `self_hostname`; app sudah
   dipakai (dua admin) → 409 `app_in_use{site}`; `busy` → banner.
9. Setelah adopsi → navigasi ke `/panel/sites/<nama>`; toast "Situs makuro-solusi diadopsi."
10. Kosong: tidak ada ingress tak tercatat → bagian tidak tampil. Ada ingress tapi semua app ber-blocker → baris tampil
    dengan teks "Tidak ada aplikasi pm2 yang cocok. Pastikan aplikasinya berjalan dari folder di ~/sites."

### 4.3 Jalur first-run konkret di POCO (kondisi hari ini: R3 §2.11)

1. **Upgrade panel** ke rilis yang memuat PLAN ini. Saat start, panel membuat `~/sites/apps.json` = `[]` (D3). Tidak
   ada aplikasi yang terpengaruh: ecosystem belum menyebutnya.
2. `/panel/sites` → kartu Persiapan: ✓ Folder situs, ✓ `apps.json`, ✓ ecosystem bisa dimuat (2 aplikasi:
   makuro-solusi, adminneo), ✗ "ecosystem belum memuat apps.json", ✓ apps.json tanpa entri bermasalah, ✓ Tunnel `poco`,
   ⚠ Token Cloudflare (opsional).
3. Pemilik `ssh poco`, `nano ~/sites/ecosystem.config.js`: tempel blok snippet di atas `module.exports`, tambah
   `...panelApps,` sebagai elemen terakhir `apps` (setelah entri `adminneo`). Contoh hasil (file pemilik memakai helper
   `site(name)`; itu tidak berubah):

   ```js
   module.exports = {
     apps: [
       site("makuro-solusi"),
       { name: "adminneo", /* …tetap… */ },
       ...panelApps,
     ],
   };
   ```

   Tidak perlu `sv restart pm2` (pm2-runtime membaca ecosystem hanya saat start; reboot berikutnya memakai snippet).
4. **Periksa lagi** → semua ✓ → `ready`.
5. "Belum dikelola": `solusi.malikkurosaki.com · port 3005 → makuro-solusi` (port dari `.env`, karena env pm2 tidak
   punya PORT) dan `panel.malikkurosaki.com · Panel Termux (domain ini)` tanpa tombol.
6. **Adopsi** solusi → dialog: aplikasi `makuro-solusi` (Berjalan), nama `makuro-solusi`, folder
   `~/sites/makuro-solusi` ✓, runtime glibc · dijalankan lewat grun ✓, port 3005 dari `.env` ✓. Teks: "Panel hanya
   mencatat situs ini. File, aplikasi pm2, dan domainnya tidak diubah sampai kamu deploy."
7. Detail situs: header "Berjalan", domain, **Cek kesehatan** → `GET /` 200. Bagian Pengaturan: pemilik boleh mengganti
   path cek kesehatan (mis. `/api/health` bila aplikasinya punya) — opsional.
8. **Deploy pertama ke makuro-solusi**: pemilik build `bun build --compile --target=bun-linux-arm64` (glibc, cocok
   dengan script grun). Bila memilih build Android, server menolak di potongan 0 dengan `runtime_mismatch` + petunjuk
   ganti `script` di helper `site()` menjadi `./app` (tanpa grun) lalu `sv restart pm2` **oleh pemilik** (blip semua
   aplikasi; dijelaskan). Unggahan 89 MB bisa dilanjutkan bila VPN putus. Perubahan: assemble → detect (grun) →
   chmod → swap (`app.prev` = binary tulisan tangan lama) → apps_entry dilewati (adopsi) → `pm2 restart makuro-solusi`
   → cek kesehatan (2 jawaban + stabil 5 dtk). Situs terputus beberapa detik (dijelaskan sebelum mulai).
9. Riwayat deploy: 1 baris "Aktif". **Kembalikan versi sebelumnya** aktif dengan dialog "dari `3f9a…` (app-v2, 26 Nov
   22.40) → versi sebelum panel (89,2 MB, diubah 25 Nov 2026)". Dialog menyebut database tidak ikut kembali (aplikasi
   ini memigrasi database dari Mac; versi lama bisa gagal bila skema sudah berubah).
10. **Situs kedua**: Buat situs (wizard aktif karena `ready`) → perubahan `site.create` (tanpa `apps.json`) → halaman
    hasil dengan CTA **Unggah binary pertama** → deploy pertama: … swap → apps_entry `apps_registered` → app_restart
    `pm2 start ecosystem.config.js --only <nama>` (lab E2: masuk daemon pm2-runtime yang sama) → health.
11. Reboot berikutnya: pm2-runtime memuat makuro-solusi, adminneo, dan situs kedua dari `apps.json`.

Yang sengaja tidak otomatis: edit ecosystem, `sv restart pm2`, ubah situs adopsi jadi dikelola.

### 4.4 Wizard buat situs

1. `/panel/sites/new`: bila `!integration.ready` → wizard tetap tampil, kartu Persiapan ringkas di atas, tombol
   **Buat situs** disabled + teks "Selesaikan persiapan pm2 dulu." (server juga 409 `integration_required`).
2. Langkah 1 **Alamat**: Nama, Domain, Port (prefill `suggest-port`; port panel tidak pernah ditawarkan). Cek langsung
   `POST /sites/check` debounce 400 ms (sudah ada, `site.api.ts:56-77`); hasil per field dengan kode → teks Indonesia
   (§5.9). Cek DNS (bila token diisi): zona ditemukan? record ada? CNAME ke tunnel ini → catatan `dns_same_tunnel`
   (lolos); record lain → `hostname_dns_conflict` (blokir); token kosong → catatan `dns_token_missing`; API gagal →
   catatan `dns_check_failed` (tidak blokir, dicek lagi di langkah dns). Hasil DNS di-cache 30 dtk per hostname.
   `name_leftover {jobId}` bila nama/folder dipakai sisa perubahan terputus → tautan "Bersihkan".
3. Langkah 2 **Opsi**: toggle database dengan penjelasan ("Membuat database dan role PostgreSQL baru di HP ini.
   `DATABASE_URL` ditulis ke `.env` situs dan memakai 127.0.0.1:5432."), editor variabel tambahan (komponen env §5.6,
   termasuk Tempel `.env`).
4. Langkah 3 **Ringkasan**: rencana per langkah (teks dari kode langkah) + peringatan blip cloudflared ("Semua domain di
   HP ini, termasuk panel, terputus beberapa detik. Halaman progres lanjut otomatis.").
5. **Buat situs** → 202 → `/panel/jobs/:id`.
6. Halaman progres selesai `succeeded` → panel hasil: "Situs blog siap. Unggah binary pertama untuk menjalankannya."
   CTA utama **Unggah binary pertama** (`/panel/sites/blog#deploy`), sekunder "Buka detail situs".
7. Gagal: `rolled_back` → "Semua langkah sudah dikembalikan. Tidak ada yang perlu kamu bersihkan." + aksi **Coba lagi**
   (`/panel/sites/new?from=<jobId>` — wizard diisi ulang dari `job.input` lewat `GET /jobs/:id`, variabel tambahan tidak
   ikut karena nilainya tidak disimpan). `failed` (undo tidak bersih) → "Sebagian langkah tidak bisa dikembalikan" +
   **Bersihkan**.
8. Edge: dua admin membuat bersamaan → yang kedua 409 `busy` → banner "Perubahan _Buat situs · blog_ sedang berjalan ·
   Lihat". Wizard ditinggal di tengah → tidak ada state server (tidak ada yang dibersihkan).

### 4.5 Perubahan berjalan & halaman progres

1. `GET /jobs/:id` dipoll 1 dtk selama `running` (pola sekarang, `job.state.ts:5`), berhenti saat status akhir.
2. Selama langkah `tunnel_restart`/`domain_probe` berjalan, galat jaringan diharapkan: klien **tidak** menampilkan error;
   tampilkan catatan "Panel terputus sebentar karena cloudflared dimulai ulang. Halaman ini lanjut sendiri." dan backoff
   1→2→4→5 dtk hingga 120 dtk; lebih dari itu → `ErrorState` dengan **Coba lagi**.
3. Galat jaringan di luar itu: 3 gagal berturut → banner offline + backoff yang sama; data terakhir tetap tampil.
4. 401 Access → alur reload yang ada (`api.client.ts`); halaman progres bisa dibuka ulang dari URL.
5. Ringkasan per langkah: ikon status + label + durasi (`finishedAt - startedAt`, format durasi guide) + `Detail` yang
   bisa dibuka (log teknis + detail, tombol Salin).
6. Status akhir: `succeeded` (hijau), `rolled_back` (peringatan: "aman, semua dikembalikan"), `failed` (danger: "butuh
   tindakan"), `interrupted` (danger: "terputus karena panel dimulai ulang"). Aksi dari `job.next`.
7. Deploy/rollback/restart/env gagal di `app_restart`/`health` → panel "Kenapa gagal" dengan ekor stderr (§4.9).

### 4.6 Deploy (unggah yang bisa dilanjutkan)

1. Detail situs `#deploy`. Bila ada `GET /sites/:name/uploads/active` → kartu "Unggahan belum selesai: app-v2 · 89,2 MB ·
   6 dari 11 potongan · kedaluwarsa 21.40" + [Pilih file yang sama] [Batalkan unggahan].
2. Pilih file → cek ukuran (0 / > 300 MB ditolak) → bila ada unggahan aktif dan `name + size` sama → **resume**; else
   `POST /sites/:name/uploads {sizeBytes, fileName}` (server: preflight ruang bebas ≥ `2 × size + 200 MB` di filesystem
   `dataDir`, situs dikelola tanpa entri apps.json + `!ready` → 409 `integration_required`).
3. Konfirmasi sebelum kirim (tier none, teks di kartu): "Setelah unggahan selesai, aplikasi dimulai ulang dan situs
   terputus beberapa detik."
4. Kirim potongan berurutan; tiap potongan: `slice` 8 MB → `crypto.subtle.digest` → bila `received` punya index ini
   dengan sha sama → lewati; else `PUT` + header sha. Progres: persen, terkirim/total, kecepatan, sisa waktu.
5. Potongan 0: server menjalankan `detectRuntime` pada `0.part`; tidak valid → 400 `invalid_binary` (unggahan dihapus);
   situs adopsi dengan `scriptRuntime` ∉ {runtime baru} → 409 `runtime_mismatch` (unggahan dihapus) → kartu menampilkan
   langkah perbaikan.
6. Galat sementara → jadwal D15; `navigator.onLine === false` → jeda sampai event `online`. Habis → status "Unggahan
   terhenti" + **Lanjutkan unggahan** (GET state → lanjut dari `received`).
7. Unggahan 404 `upload_expired` → "Unggahan ini sudah kedaluwarsa (lebih dari 1 jam tanpa potongan baru). Unggah ulang
   file-nya." + tombol Unggah ulang.
8. Semua terkirim → `POST complete`: server cek kelengkapan, ruang bebas ≥ size + 100 MB, `assertIdle`, runtime ulang
   (pm2 bisa berubah), integrasi untuk deploy pertama dikelola → job `site.deploy`. 409 `busy` → "Menunggu perubahan
   lain selesai…" + tautan; klien mencoba `complete` lagi tiap 5 dtk selama halaman terbuka (maks 10 mnt), unggahan
   tetap aman di server.
9. Sukses → navigasi ke halaman progres (§4.5).
10. Meninggalkan halaman: fetch yang berjalan dibatalkan, **unggahan di server tidak dihapus**; localStorage
    `panel.upload.<site>` = `{uploadId, fileName, sizeBytes, lastModified}` (try/catch) untuk mencocokkan file. Reload
    karena Access 401 → langkah 1.
11. File berbeda saat resume (sha potongan yang sudah diterima tidak cocok) → dialog "File ini berbeda dari unggahan
    sebelumnya. Mulai unggahan baru?" [Mulai unggahan baru] [Batal].
12. **Batalkan unggahan** (tier none) → `DELETE /uploads/:id` → toast "Unggahan dibatalkan."
13. Restart panel di tengah unggahan: meta dipersist (D13) → setelah panel kembali, PUT berikutnya sukses (retry
    menutupi jeda restart ≤ 90 dtk); bila panel mati lebih lama → "Unggahan terhenti" → Lanjutkan.
14. Dua admin mengunggah ke situs sama: unggahan kedua menggantikan yang pertama (satu aktif per situs, perilaku lama);
    admin pertama mendapat 404 `upload_expired` dengan teks tambahan "mungkin admin lain memulai unggahan baru".

### 4.7 Rollback

1. Tombol **Kembalikan versi sebelumnya** aktif hanya bila `binary.previous !== null` dan `binary.live !== null`
   (dari file, bukan tebakan riwayat).
2. Dialog (tier confirm) "Kembalikan blog ke versi sebelumnya?": baris "Dari → Ke" (sha12 · nama file · waktu deploy ·
   oleh) + tabel "Ikut dikembalikan / Tidak ikut" (§5.4).
3. **Kembalikan** → `POST rollback` → job `site.rollback` (swap → apps_entry → app_restart → health). Gagal health →
   swap dibalik + restart lagi → `rolled_back`.
4. Setelah rollback sukses, versi yang diganti menjadi `app.prev` (rollback bisa diulang = maju lagi).

### 4.8 Cek kesehatan & mulai ulang

1. **Cek kesehatan** (menu header): `GET /sites/:name/health` → toast "Sehat: HTTP 200 dalam 85 ms" atau "Tidak sehat:
   GET /api/health menjawab 502" / "tidak menjawab". Tidak memakai kunci (read-only).
2. **Mulai ulang** (tier confirm, "Situs terputus beberapa detik"): `POST /sites/:name/restart` → job `site.restart`
   (app_restart → health). Gagal → `failed` + ekor stderr + aksi **Kembalikan versi sebelumnya** (bila ada) dan
   **Lihat log aplikasi**.
3. Algoritme `health` (D16), tiap iterasi 1 dtk: cek pm2 (maks tiap 3 dtk, memakai snapshot/adapter); status `errored`
   → gagal cepat `app_errored`; port mendengar → `httpStatus(port, path, 5 dtk)` → lolos bila sesuai aturan → `streak++`
   else `streak = 0`; `streak ≥ 2` → catat `restarts` awal, tunggu 5 dtk, baca lagi: naik atau bukan `online` →
   `app_unstable`; deadline `timeoutSec` → `health_timeout {last}`.

### 4.9 Gagal deploy: alasan + aksi lanjutan

1. Langkah `app_restart` atau `health` gagal → runner memanggil `captureAppLog(jobId, site)`: `pm2.readLog(app, "err",
   50)` → redaksi (D17: setiap nilai `.env` situs dengan panjang ≥ 6 diganti `•••`, pola `://user:pass@` →
   `://•••@`) → simpan di memori (`Map`, maks 20, TTL 1 jam). `job.hasAppLog` true selama tersimpan.
2. Halaman progres: kotak "Kenapa gagal" = teks kode error + `LogViewer` (PLAN/01) berisi ekor stderr (mono, maks 50
   baris) + catatan "Disamarkan: 2 nilai rahasia." + [Lihat log aplikasi] (`/panel/apps/<app>/log?stream=err`).
3. `job.next`: `rolled_back` deploy → `redeploy`, `app_log`; `failed` deploy → `cleanup`, `app_log`; restart gagal →
   `rollback` (bila ada `app.prev`), `app_log`.
4. Log kedaluwarsa (restart panel / > 1 jam) → `GET app-log` 404 → teks "Potongan log sudah tidak tersedia. Buka log
   aplikasi untuk melihat semuanya."

### 4.10 Variabel lingkungan

1. Bagian `#env`: daftar kunci (nilai tidak pernah tampil), kunci terkunci dengan lencana "Diatur panel" dan tanpa aksi
   (hanya situs dikelola, D20).
2. Aksi per kunci: **Ganti nilai** (input kosong, `type=password` + tombol tampilkan), **Hapus** (menandai). **Tambah
   variabel**. **Tempel `.env`** (§5.6) → pratinjau → "Terapkan ke daftar".
3. Footer muncul saat ada perubahan: ringkasan "2 diganti · 1 baru · 1 dihapus", **Simpan** (sekunder) dan
   **Simpan dan mulai ulang** (utama).
4. **Simpan** → `PUT {restart:false}` (server: `assertIdle`, validasi, `env_locked`, tulis atomik 0600, audit kunci saja)
   → 200 → toast "Variabel lingkungan disimpan. Mulai ulang aplikasi agar berlaku." → banner `restartPending`.
5. **Simpan dan mulai ulang** → `PUT {restart:true}` → 202 → job `site.env`: `env_write` (simpan byte lama di memori job
   saja) → `app_restart` → `health`. Gagal → undo `env_write` (tulis byte lama) + afterRollback restart lagi →
   `rolled_back` "Nilai lama dipulihkan dan aplikasi dimulai ulang." Panel terputus di tengah → `interrupted`; Bersihkan =
   mulai ulang + cek (nilai lama **tidak** bisa dipulihkan; disebut jujur).
6. Banner `restartPending`: "Variabel lingkungan berubah sejak aplikasi terakhir dimulai. Mulai ulang agar berlaku."
   [Mulai ulang] (job `site.restart`).
7. Error: `invalid_env{key, reason}` → pesan di baris kunci; `multiline` → "Nilai multi-baris belum didukung."

### 4.11 Perubahan terputus: Bersihkan / Ulangi

1. Boot: `UPDATE job SET status='interrupted', error={code:'interrupted'} WHERE status='running'`; baris `deploy`
   `running` → `interrupted`. Log warn per job.
2. Tampil di: halaman progres job itu (panel danger), banner di `/panel/sites` dan di detail situs target ("Perubahan
   _Deploy · blog_ terputus saat panel dimulai ulang. Periksa dan bersihkan."), masalah Ringkasan `site_job_failed`
   (§7), dan catatan wizard `name_leftover`.
3. **Bersihkan** (tier none; tombol menjelaskan isinya: "Panel memeriksa file dan mengembalikan yang setengah jadi") →
   `POST /jobs/:id/cleanup` → job `job.cleanup` (target = target asli, `input.jobId`). Langkah `inspect` membaca
   keadaan nyata lalu runner menambahkan langkah perbaikan yang dibutuhkan (step list dibangun **setelah** inspect,
   disimpan ke `job.steps`):

   | Jenis asli                 | Pemeriksaan & perbaikan (semua idempoten)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `site.create`              | Bila baris `site` sudah ada → `inspect_nothing` (onSuccess sempat jalan). Else: `ingress` hapus rule hostname bila ada dan tidak milik situs mana pun → `tunnel_restart` bila ingress berubah → `dns` hapus record bila dimiliki panel (`dns_record`) dan tidak dipakai situs → `apps_remove` entri bernama sama bila ada (baris lama sebelum PLAN ini) → `database_drop` hanya bila `input.database` **dan** langkah `database` asli `running`/`done` **dan** tidak ada situs dengan database itu → `folder_remove` hanya bila isinya ⊆ {`data/` kosong, `.env`}; selain itu `folder_not_empty {entries}` (dibiarkan, pengguna memutuskan) |
   | `hostname.add`             | `ingress`/`tunnel_restart`/`dns` seperti di atas untuk `input.hostname`, hanya bila hostname tidak ada di `site_hostname`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | `site.deploy`              | `app.new` ada → hapus. `swapped` = sha(`app`) == `input.sha256`. Swapped → `swap` balik: `app.prev`→`app`, `.app.prev.drop`→`app.prev` (yang ada). Tidak swapped → `.app.prev.drop` dikembalikan ke `app.prev` bila `app.prev` hilang, else dihapus. `apps_entry`: dikelola + `app` ada → setel runtime = ELF `app`; dikelola + `app` tidak ada → **hapus entri** (D5). `app_restart` bila pm2 mengenal app atau `app` ada → `health`                                                                                                                                                                                                       |
   | `site.rollback`            | swapped = sha(`app`) == `input.toSha256` → swap balik; lalu `apps_entry`, `app_restart`, `health` seperti di atas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
   | `site.env`, `site.restart` | `app_restart` → `health` (nilai `.env` lama tidak tersedia; teks jujur)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
   | `job.cleanup`              | Cleanup baru atas job asli (pemeriksaan sama)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

4. Cleanup sukses → job asli `resolved_by = <cleanupId>`; banner hilang. Cleanup gagal → `failed` + ekor stderr bila
   ada; banner tetap, aksi "Bersihkan lagi" dan teks "Bila tetap gagal, periksa lewat ssh: …" dengan path relevan.
5. **Ulangi** (`site.delete`, `hostname.remove`): `POST /jobs/:id/retry` → job baru jenis sama dari `job.input`
   (hapus situs: `?confirm` tidak diminta ulang karena konfirmasi sudah diberikan untuk job asli; aksi diaudit).
6. Edge: target sudah tidak ada (situs dihapus lewat jalur lain) → inspect `inspect_nothing`, resolved. Dua admin
   menekan Bersihkan → kedua 409 `busy` atau `already_resolved`.

### 4.12 Shutdown vs perubahan terpanjang

| Perubahan               | Tipikal di POCO (perkiraan dari R2/R3)          | Terburuk dengan default                                                                             |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| site.create             | ±15 dtk (cloudflared 3–10 dtk + DNS 1–3 dtk)    | validate 20 (timeout pm2) + tunnel 30 + probe 30 + rollback reapply 30 ≈ 110 dtk                    |
| hostname.add/remove     | ±10 dtk                                         | ≈ 90 dtk                                                                                            |
| site.delete             | ±15 dtk (+ `rm -rf` data)                       | ≈ 80 dtk + ukuran `data/`                                                                           |
| site.deploy (89 MB)     | ±20 dtk (assemble 2–4, restart 2–5, health 2–8) | assemble 5 + restart 40 (2 panggilan pm2 × 20) + health 60 + stabil 5 + revert restart 40 ≈ 150 dtk |
| site.deploy, health 300 | –                                               | ≈ 390 dtk                                                                                           |

`SHUTDOWN_TIMEOUT_MS = 120_000`. Saat SIGTERM: server berhenti menerima request (sudah), runner tidak menerima job baru,
lalu menunggu. Lewat 120 dtk → keluar; job menjadi `interrupted` saat boot (§4.11). Konsekuensi: `sv restart panel`
saat ada perubahan bisa membuat panel tak terjangkau hingga 2 menit. PLAN/02 sudah menolak restart `panel` dari UI saat
ada job (409 `job_running`); installer (`install-phone.sh`, PLAN/05) diminta memakai `sv -w 130 restart panel` dan
mencetak "Menunggu perubahan yang sedang berjalan selesai…".

### 4.13 Domain: tambah & hapus

1. Bagian `#domains`: daftar domain situs (domain utama pertama), lencana "DNS otomatis"/"DNS manual", status HTTPS
   (dari snapshot domain PLAN/02, bila ada), aksi Hapus.
2. **Tambah domain** → dialog: input + cek langsung (`POST /sites/check {hostname, scope:"hostname"}`, termasuk DNS) +
   peringatan blip → **Tambah domain** → job `hostname.add` → progres. Konflik DNS terdeteksi di dialog, bukan di langkah
   ke-3.
3. **Hapus domain** (tier confirm) "Hapus domain www.blog.com?" — akibat: rute cloudflared + record DNS otomatis dihapus,
   semua domain terputus sebentar. Domain terakhir: tombol disabled + tooltip/teks `lastHostname`. Domain tulisan tangan
   situs adopsi: tombol disabled + "Rute ini ditulis manual di config.yml. Hapus lewat ssh bila perlu."
4. `ensureTunnelCname`: record CNAME yang sudah ada, tidak dimiliki panel, dengan `content` = `<tunnel>.cfargotunnel.com`
   → `{created:false, managed:false}` (bukan konflik); langkah `dns_same_tunnel`. Record lain → `dns_conflict`.

### 4.14 Hapus situs

1. Menu header ⋯ → **Hapus situs** → dialog typed (komponen PLAN/01): judul "Hapus situs blog?", daftar akibat konkret
   dari data detail (domain yang berhenti, folder `~/sites/blog` termasuk `data/`, database `blog` + role, aplikasi
   pm2), checkbox "Simpan folder dan file situs" dan "Simpan database", info cadangan: "Cadangan terakhir database blog:
   26 Nov 2026, 03.00" atau "Database ini belum pernah dicadangkan." + tautan **Cadangkan sekarang** (`/panel/backups`)
   — data dari PLAN/04 (§7).
2. Input "Ketik `blog` untuk konfirmasi" (case-sensitive, trim); tombol **Hapus situs blog** (destructive) aktif bila
   cocok.
3. `DELETE /sites/blog?keepData=…&keepDatabase=…&confirm=blog` → job `site.delete` → progres. Urutan langkah menjamin
   entri `apps.json` dihapus **sebelum** binary/folder (D5).
4. Situs adopsi: dialog tier confirm (bukan typed) karena hanya catatan + rule/record buatan panel yang dihapus; teks
   `unmanaged` yang ada.

### 4.15 Izin, kosong, konkurensi

- Peran `user` membuka `/panel/sites*` → SessionGate mengarahkan (perilaku sekarang); API 403.
- Tidak ada situs + integrasi siap → `EmptyState` "Belum ada situs. Buat situs pertama untuk menghubungkan domain ke
  aplikasi di HP ini." [Buat situs]; bila ada "Belum dikelola", teks tambahan "atau adopsi situs yang sudah berjalan di
  bawah."
- Semua aksi yang memulai perubahan saat ada perubahan lain → 409 `busy{job}` → banner dengan tautan, tombol aksi
  disabled sampai `GET /jobs/active` kosong (dipoll 5 dtk hanya saat banner tampil).
- `pm2 jlist` gagal → `Site.appStatus` "unknown" (bukan "not_deployed"), discovered menampilkan error di bagian itu saja.

---

## 5. Spesifikasi UI per halaman

Komponen dari `src/web/components/` (PLAN/01 memperluas API-nya): `PageHeader` (judul, meta, status, actions),
`DataTable` (kolom, `rowActions` ⋯, baris-link, tampilan list di < md), `StatusBadge` + kamus status per jenis
resource (PLAN/01 `status.vocab`), `EmptyState`, `ErrorState`, `RowsSkeleton`/`HeaderSkeleton`, `Section`,
`KeyValue`, `InlineCode`, `CopyButton`, `RelativeTime`, `ConfirmAction` tier `none|confirm|typed`, `LogViewer`
(PLAN/01/02). Primitive `ui/*`: `Dialog`, `AlertDialog`, `Sheet`, `Select`, `Switch`, `Checkbox`, `Progress`, `Input`,
`Button`. Warna hanya token tone (tanpa kelas amber mentah: `integration.banner.tsx:22`, `wizard.summary.tsx:35` dihapus).
Target sentuh ≥ 44 px di < md (default brief). Semua teks dari `src/web/i18n/*`.

### 5.1 `/panel/sites` — Situs

- **Header**: `PageHeader` "Situs", meta `updatedAgo`, actions: **Buat situs** (utama; disabled + alasan bila
  `!ready`), "Riwayat perubahan" (sekunder, `/panel/jobs`).
- **Banner perubahan terputus/berjalan** (tone danger/info) di atas.
- **Kartu Persiapan** (`site.setup.tsx`, `Section` tone warning/danger) bila `!ready`: judul "Siapkan pm2 untuk situs
  buatan panel", daftar check (ikon + teks + detail lipat), blok kode snippet (`InlineCode` block + `CopyButton`), langkah
  "1. Buka `ecosystem.config.js` di HP: `nano ~/sites/ecosystem.config.js` [Salin] · 2. Tempel blok ini di atas
  `module.exports` · 3. Tambahkan `...panelApps,` di akhir daftar `apps` · 4. Simpan, lalu periksa lagi.", tombol
  **Periksa lagi** (loading "Memeriksa…"). Teks peringatan penting: "Jangan menulis `...require('./apps.json')` tanpa
  blok ini: bila file itu rusak, semua aplikasi tidak akan jalan setelah HP dinyalakan ulang."
- **Daftar**: desktop `DataTable` kolom Nama (tautan, + lencana "Diadopsi"), Status (`StatusBadge` app), Domain utama
  (+ "+2"), Deploy terakhir (`RelativeTime` + status kecil), Port (mono), ⋯ (Buka situs ↗, Deploy, Mulai ulang, Log
  aplikasi). Urutan: bermasalah (errored/stopped tak sengaja/perubahan gagal) dulu. HP: list padat 2 baris (nama +
  status; domain · deploy terakhir).
- **Belum dikelola** (`site.discovered.tsx`): `Section` dengan deskripsi; baris: hostname · "port 3005 → makuro-solusi"
  atau "port tidak diketahui"; tombol **Adopsi** (44 px); baris `self` = "Panel Termux (domain ini)" lencana netral tanpa
  tombol.
- **States**: loading → `HeaderSkeleton` + `RowsSkeleton`; error list → `ErrorState` + Coba lagi (kartu Persiapan tetap
  dimuat terpisah); partial (pm2 gagal) → status "Tidak diketahui" + catatan "Status aplikasi tidak bisa dibaca dari pm2."
- **a11y**: checklist sebagai `<ul>` dengan teks status (bukan hanya ikon); tombol Periksa lagi mengumumkan hasil lewat
  `aria-live="polite"`.

### 5.2 Dialog Adopsi (`adopt.dialog.tsx`)

- `Dialog` (desktop) / `Sheet` bawah (HP). Judul "Adopsi solusi.malikkurosaki.com".
- Field: **Aplikasi pm2** (`Select`, opsi "makuro-solusi · Berjalan · port 3005"; opsi ber-blocker disabled + alasan),
  **Nama situs** (`Input`, hint nama). `KeyValue` read-only: Folder, Runtime ("glibc · dijalankan lewat grun"), Port
  ("3005 · dari `.env`"). Peringatan non-blokir di `Section` tone warning.
- Tombol **Adopsi** / **Batal**. Error server ditampilkan inline di atas tombol (pola error).
- Teks: "Panel hanya mencatat situs ini. File, aplikasi pm2, dan domainnya tidak diubah sampai kamu deploy."

### 5.3 `/panel/sites/new` — wizard

- `PageHeader` "Buat situs baru" + indikator "Langkah 1 dari 3: Alamat" (teks + `aria-current="step"` pada daftar
  langkah). Langkah: Alamat · Opsi · Ringkasan.
- Field dengan `aria-describedby` → hint + pesan error, `aria-invalid` saat error (perbaiki `form.field.tsx:24`).
- Status cek per field: "Memeriksa…", "Tersedia.", catatan DNS (info), error (danger).
- HP: tombol Kembali/Lanjut di bar lengket bawah (safe-area), 44 px.
- Ringkasan: daftar rencana dari kode langkah (teks `id.site.wizard.plan.*`), peringatan blip (tone warning).
- Halaman hasil (di `job.page.tsx` untuk `site.create` sukses): `EmptyState`-like panel dengan CTA **Unggah binary
  pertama**.

### 5.4 `/panel/sites/:name` — detail

- **Header** (`site.header.tsx` → `PageHeader`): judul nama situs, `StatusBadge` app, meta: domain utama (tautan ↗),
  "Deploy terakhir 3 mnt lalu oleh Malik". Actions: **Deploy** (utama → scroll `#deploy` dan buka pemilih file),
  **Mulai ulang** (sekunder, confirm), menu ⋯: Cek kesehatan, Log aplikasi, Riwayat perubahan situs
  (`/panel/jobs?target=blog`), Hapus situs (destructive). Header lengket di desktop.
- **Navigasi jangkar** (`<nav aria-label="Bagian situs">`): Ringkasan · Deploy · Domain · Variabel lingkungan ·
  Pengaturan. HP: chip horizontal lengket di bawah top bar, bisa di-scroll.
- **Banner**: perubahan berjalan (info, tautan), terputus (danger, Bersihkan), `restartPending` (warning, Mulai ulang),
  `deployBlocker=integration` (warning, ke Persiapan).
- `#ringkasan`: `KeyValue` Aplikasi pm2, Port, Runtime ("Android native" / "glibc lewat grun"), Database, Folder (mono +
  Salin), Dikelola ("Dibuat lewat panel" / "Diadopsi: entri pm2 ditulis manual"), Dibuat.
- `#deploy` (`deploy.card.tsx`): kartu **Versi berjalan** (sha12 · nama file · ukuran · runtime · waktu · oleh; adopsi
  tanpa deploy: "Binary 89,2 MB, belum di-deploy lewat panel"), kartu unggah (§4.6), tombol **Kembalikan versi
  sebelumnya** (`deploy.rollback.tsx`), lalu **Riwayat deploy** (`deploy.history.tsx`): `DataTable` kolom Waktu, Jenis,
  Versi (sha12 mono + nama file), Ukuran, Runtime, Oleh, Durasi, Status (+ lencana "Aktif"), ⋯ Lihat perubahan. HP: list.
  Paginasi 10. Kosong: "Belum ada deploy. Unggah binary pertama untuk menjalankan situs ini."
- **Dialog rollback** (confirm): judul "Kembalikan blog ke versi sebelumnya?"; "Dari: `3f9a2c1b7e0d` · app-v2 · 26 Nov
  22.40 · Malik" → "Ke: `a17c…` · app-v1 · 25 Nov 19.02"; tabel dua kolom:
  - Ikut dikembalikan: binary aplikasi; cara menjalankan (native/grun) untuk situs buatan panel.
  - Tidak ikut: variabel lingkungan (`.env`); isi dan struktur database; file di `data/`; domain.
  - Catatan: "Bila versi baru sudah mengubah struktur database, versi lama bisa gagal berjalan. Situs terputus beberapa
    detik." Tombol **Kembalikan versi sebelumnya**.
- `#domains` (`site.hostnames.tsx`): §4.13.
- `#env` (`site.env-editor.tsx`): §5.6.
- `#settings` (`site.settings.tsx`): form Cek kesehatan — Path (`Input`, mis. `/api/health`), Status yang diharapkan
  (`Select`: "Apa pun di bawah 500" / "Harus 200" / "Lainnya…" → input angka), Batas waktu (detik, 10–300). **Simpan**.
  Danger zone: **Hapus situs**.
- **States**: loading skeleton header + bagian; 404 → `ErrorState` "Situs ini sudah tidak ada…" + Ke daftar situs;
  pm2 gagal → status "Tidak diketahui", aksi Mulai ulang tetap ada.

### 5.5 `/panel/jobs` dan `/panel/jobs/:id`

- **Daftar**: `PageHeader` "Riwayat perubahan" (+ "· blog" bila `?target`), filter `Select` Situs dan Status. `DataTable`
  kolom Perubahan ("Deploy · blog"), Status (`StatusBadge` kamus job: Berjalan/Berhasil/Dikembalikan/Gagal/Terputus),
  Oleh, Mulai (`RelativeTime`), Durasi, ⋯ Lihat. Kosong: teks `jobs.empty` + filter aktif → "Tidak ada perubahan yang
  cocok dengan filter."
- **Progres** (`job.page.tsx` + `job.steps.tsx`): `PageHeader` "Deploy · blog" + `StatusBadge` + meta "Dimulai 21.40 oleh
  Malik · 42 dtk". Stepper vertikal: tiap langkah = ikon status (teks sr-only), label (kode → i18n), hasil singkat
  (outcome), durasi kanan, tombol "Detail" (`aria-expanded`) membuka log + detail + Salin. Region `aria-live="polite"`
  tunggal mengumumkan "Langkah 4 dari 7: Menukar binary… selesai". Progress bar = langkah selesai/total, tone info saat
  berjalan.
- **Panel akhir**: sukses (create → CTA unggah; deploy → "Buka situs ↗"), `rolled_back` ("aman"), `failed` ("butuh
  tindakan" + Bersihkan/Rollback/Log), `interrupted` ("terputus" + Bersihkan/Ulangi), kotak "Kenapa gagal" (§4.9).
- HP: stepper satu kolom, durasi di bawah label; log di `Sheet` layar penuh.

### 5.6 Editor variabel lingkungan & Tempel `.env`

- Tabel kunci: Nama (mono), keterangan ("Diatur panel" lencana; "akan diganti"/"baru"/"akan dihapus" lencana tone),
  aksi Ganti nilai / Hapus / Urungkan. Input nilai `type=password` + tombol Tampilkan (`aria-pressed`).
- **Tempel `.env`** → `Dialog`/`Sheet`: `textarea` (mono, `autocomplete=off`, `spellcheck=false`), parser klien
  `env.paste.ts` (baris `KEY=VALUE`, `export`, kutip tunggal/ganda, komentar `#`, baris kosong; nilai multi-baris
  ditolak) → pratinjau `DataTable`: Nama, Aksi ("Baru"/"Ganti nilai"), Nilai ("•••• (24 karakter)"), Masalah (kunci
  tidak valid, kunci terkunci, duplikat → baris terakhir menang + catatan, multi-baris). Tombol **Terapkan ke daftar**
  (tidak menyimpan; perubahan masuk ke daftar, lalu Simpan seperti biasa). Teks: "Nilai tidak dikirim sampai kamu
  menekan Simpan. Setelah disimpan, nilai tidak bisa dilihat lagi."
- Footer sticky saat ada perubahan: ringkasan + **Simpan** + **Simpan dan mulai ulang**.

### 5.7 Konfirmasi (ringkas)

| Aksi                                                      | Tier                             | Tombol                      |
| --------------------------------------------------------- | -------------------------------- | --------------------------- |
| Cek kesehatan, Periksa lagi, Batalkan unggahan, Bersihkan | none                             | –                           |
| Mulai ulang aplikasi situs                                | confirm                          | Mulai ulang                 |
| Kembalikan versi sebelumnya                               | confirm                          | Kembalikan versi sebelumnya |
| Hapus domain                                              | confirm                          | Hapus domain                |
| Simpan dan mulai ulang                                    | none (tombolnya sudah eksplisit) | –                           |
| Hapus situs dikelola                                      | typed                            | Hapus situs blog            |
| Hapus situs adopsi                                        | confirm                          | Hapus situs                 |
| Ulangi hapus situs                                        | confirm                          | Ulangi hapus situs          |

### 5.8 Kunci copy (file i18n)

- `id.site.ts` (list, persiapan, adopsi, wizard): `list.*`, `setup.{title, checks.<IntegrationCheckKey>.{ok,warning,error}, snippetLead, steps[], recheck, warningNaive, readyLine}`, `discovered.*`, `adopt.{…, blockers.<code>, warnings.<code>, runtimeLabel.<runtime>, portSource.<src>}`, `wizard.{…, issues.<SiteIssueCode>, notes.<SiteNoteCode>, plan.<JobStepKey>}`.
- `id.site-detail.ts` (baru): `header.*`, `anchors.*`, `banners.{running, interrupted, restartPending, integration}`, `info.*`, `domains.*`, `env.{…, paste.*}`, `settings.*`, `remove.*`.
- `id.job.ts` (baru, dipindah dari `id.site.ts` bagian `job`/`jobs`): `kinds.<JobKind>`, `statuses.<JobStatus>`, `statusHelp.<JobStatus>`, `steps.<JobStepKey>`, `outcomes.<JobOutcomeCode>(params)`, `next.<JobNextAction>`, `appLog.*`, `blip`.
- `id.deploy.ts`: `upload.{…, resume.*, paused, expired, retrying(n, sec)}`, `errorCodes.<code>`, `rollback.{…, carries[], notCarried[]}`, `history.*`.
- Semua map memakai `satisfies Record<UnionType, …>` sehingga kode baru tanpa teks = error compile.

### 5.9 Contoh teks (Indonesia, sesuai guide)

| Kunci                                            | Teks                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `steps.tunnel_restart`                           | Mulai ulang cloudflared                                                                                                |
| `steps.app_restart`                              | Mulai ulang aplikasi                                                                                                   |
| `steps.health`                                   | Cek kesehatan                                                                                                          |
| `steps.assemble` / `detect` / `swap`             | Menyatukan unggahan / Mengenali runtime / Menukar binary                                                               |
| `steps.apps_entry`                               | Mendaftarkan aplikasi di pm2                                                                                           |
| `outcomes.healthy`                               | `HTTP {status} dari {path} dalam {ms} ms, stabil.`                                                                     |
| `outcomes.health_timeout`                        | `Aplikasi tidak sehat setelah {seconds} dtk ({last}). Lihat log aplikasi di bawah.`                                    |
| `outcomes.app_unstable`                          | `Aplikasi sempat menjawab, lalu dimulai ulang {restarts}× oleh pm2. Biasanya karena crash saat start.`                 |
| `outcomes.dns_no_token`                          | `Dilewati: token API Cloudflare belum diisi. Buat record DNS sendiri.`                                                 |
| `outcomes.dns_conflict`                          | `Sudah ada record DNS untuk {hostname} yang tidak dibuat panel. Hapus atau ubah di dasbor Cloudflare, lalu coba lagi.` |
| `outcomes.runtime_mismatch`                      | `Binary ini untuk {got}, tetapi pm2 menjalankan situs ini sebagai {expected}.`                                         |
| `outcomes.domain_not_yet`                        | `{hostname} belum bisa dibuka. DNS kadang butuh beberapa menit.`                                                       |
| `outcomes.folder_not_empty`                      | `Folder {path} dibiarkan karena berisi file lain. Hapus sendiri bila tidak dipakai.`                                   |
| `statusHelp.rolled_back`                         | Perubahan gagal, dan semua langkah sudah dikembalikan. Tidak ada yang perlu kamu bersihkan.                            |
| `statusHelp.failed`                              | Perubahan gagal dan sebagian langkah tidak bisa dikembalikan. Bersihkan agar situs kembali konsisten.                  |
| `statusHelp.interrupted`                         | Perubahan terputus karena panel dimulai ulang. Periksa dan bersihkan sisa langkahnya.                                  |
| `errorCodes.busy`                                | Ada perubahan lain yang sedang berjalan: {kind} · {target}. Tunggu sampai selesai, lalu coba lagi.                     |
| `errorCodes.integration_required`                | pm2 belum siap menjalankan situs buatan panel. Selesaikan persiapan di halaman Situs.                                  |
| `errorCodes.no_space`                            | Penyimpanan HP tidak cukup: butuh {need}, tersisa {free}. Kosongkan ruang, lalu coba lagi.                             |
| `errorCodes.upload_expired`                      | Unggahan ini sudah tidak ada di server. Unggah ulang file-nya.                                                         |
| `upload.paused`                                  | Unggahan terhenti karena koneksi terputus. Potongan yang sudah terkirim aman.                                          |
| `upload.retrying`                                | Koneksi terputus. Mencoba lagi dalam {sec} dtk (percobaan {n} dari 7)…                                                 |
| `setup.checks.ecosystem_spreads_apps_json.error` | ecosystem.config.js belum memuat apps.json, jadi situs buatan panel tidak akan dijalankan pm2.                         |
| `adopt.blockers.outside_sites_dir`               | Aplikasi ini berjalan dari folder di luar ~/sites, jadi tidak bisa dikelola panel.                                     |
| `adopt.blockers.no_binary`                       | Tidak ada file `app` di folder aplikasi ini. Panel hanya bisa mengelola aplikasi berupa binary.                        |

Semua toast bentuk lampau ("Situs makuro-solusi diadopsi.", "Variabel lingkungan disimpan.").

---

## 6. Kriteria penerimaan

**Unit/integration (bun test, harness `tests/site.harness.ts` mode fake + temp dir):**

- [ ] `tests/ecosystem.snippet.test.ts`: snippet §3.6 dimuat `node` (skip bila `node` tidak ada) untuk 8 kondisi (7 tabel + `[null,{"name":"blog"}]`) → nama tulisan tangan selalu ada; probe mengembalikan `loadedAppsJson` true/false benar.
- [ ] Integrasi: `apps.json` dibuat saat start bila hilang dan tidak pernah ditimpa bila ada (isi byte sama); `GET
      /integration` tidak menulis file; `ready` false bila entri `apps.json` menunjuk script yang tidak ada.
- [ ] `POST /sites` dan deploy pertama situs dikelola → 409 `integration_required` bila `!ready`.
- [ ] `site.create` tidak menulis `apps.json`; deploy pertama menulis entri setelah swap; undo deploy pertama menghapus
      entri dan `app`; `site.delete` menghapus entri sebelum `app_remove`/`folder_remove` (urutan langkah diuji).
- [ ] Adopsi: cwd di luar `sites.dir` → `adopt_blocked`; tanpa `app` → `adopt_blocked`; hostname panel → `self_hostname`;
      app modul tidak tampil; runtime dari ELF fixture (`tests/deploy.fixture.ts`); `readEnvPort` pada `.env` berisi
      rahasia hanya mengembalikan angka dan tidak ada nilai lain di return/log (assert log buffer).
- [ ] `suggestPort` tidak pernah mengembalikan `PORT` panel walau port itu tidak mendengar.
- [ ] Runner: setiap langkah punya `code` dari union; tidak ada `label` di baris baru; `save()` melempar → job selesai di
      memori dan `GET /jobs/:id` mengembalikan status akhir (tidak menggantung); boot menandai `running` → `interrupted`.
- [ ] Cleanup per jenis (create, hostname.add, deploy swapped/not swapped, rollback, env): keadaan file setelah cleanup
      sesuai tabel §4.11; menjalankan cleanup dua kali tidak mengubah apa pun pada run kedua (`inspect_nothing`).
- [ ] Retry `site.delete` setelah terputus di tengah (DB sudah dijatuhkan) menyelesaikan sisanya tanpa error.
- [ ] `job.input` tidak pernah berisi password/nilai env (scan JSON semua job dalam test create ber-database + env).
- [ ] Unggah: meta bertahan saat `createUploadStore` dibuat ulang (simulasi restart); `GET /uploads/:id` mengembalikan
      sha per potongan; header sha salah → 400 `chunk_sha_mismatch`; potongan 0 non-ELF → 400 `invalid_binary` dan
      unggahan dihapus; situs adopsi `scriptRuntime=grun` + potongan 0 native → 409 `runtime_mismatch`; preflight ruang
      (fake statfs) → 507 `no_space`; sha akhir server tercatat di baris `deploy`.
- [ ] PUT chunk dengan header sha tetap tidak terkena rate limit mutasi (70 PUT dalam satu menit sukses; test yang
      sudah ada di `tests/server.http.test.ts` diperluas bila belum mencakupnya).
- [ ] Health: lolos hanya setelah 2 jawaban berturut; `restarts` naik dalam 5 dtk → `app_unstable`; `expectStatus=200`
      dengan jawaban 302 → gagal; `healthTimeoutSec` dihormati (fake clock); path dikirim ke `httpStatus`.
- [ ] Ekor stderr: diredaksi (nilai `.env` ≥ 6 char, `://u:p@`), tidak masuk DB, 404 `log_expired` setelah TTL.
- [ ] Env: `restart:false` hanya menulis file; `restart:true` membuat job `site.env`; health gagal → `.env` byte lama
      kembali; `PORT` pada situs dikelola → 400 `env_locked`; pada situs adopsi diterima; regex kunci klien = server
      (impor dari shared).
- [ ] `restartPending` true setelah `.env` lebih baru dari `pm_uptime` fake.
- [ ] DNS: CNAME tak dimiliki ke tunnel sama → `dns_same_tunnel`, `dnsManaged=false`, bukan konflik; `/sites/check`
      melaporkan `hostname_dns_conflict` sebelum job.
- [ ] 409 `busy` membawa `job {id, kind, target}`; `jobs.isLocked({kind:"service",name:"cloudflared"})` true selama job.
- [ ] `DELETE /sites/:name` tanpa `confirm` cocok → 400 `confirm_mismatch`.
- [ ] Migration 00NN: DB v0.2.x dengan baris `site`/`job`/`deploy` → kolom baru terisi default; `legacyStep` memetakan
      baris job lama tanpa error; `tests/db.migrate.test.ts` lulus.
- [ ] Shutdown menunggu ≤ 120 dtk (`tests/server.shutdown.test.ts` dengan timeout injeksi).
- [ ] i18n: compile gagal bila satu `JobStepKey`/`JobOutcomeCode`/`SiteIssueCode`/`IntegrationCheckKey`/kode error tanpa
      teks (`satisfies`); test memastikan tidak ada string Inggris server yang dirender (snapshot `job.steps.tsx` dengan
      job fixture hanya berisi kode).
- [ ] `tests/web.deploy.test.ts`: rencana resume melewati potongan dengan sha sama; jadwal retry total ≥ 90 dtk; status
      offline menjeda.
- [ ] `tests/web.site.test.ts`: parser Tempel `.env` (export, kutip, komentar, duplikat, multi-baris ditolak, kunci
      terkunci).
- [ ] `bun run typecheck`, `bun run lint`, `bun test` hijau.

**UI-QA di browser (mode fake, 390×844 dan 1440 px, tema terang dan gelap):**

- [ ] `/panel/sites`: kartu Persiapan (tidak siap → siap setelah Periksa lagi di fake), Belum dikelola dengan baris
      "Panel Termux (domain ini)", list kosong, list dengan situs bermasalah di atas.
- [ ] Dialog Adopsi di HP sebagai sheet; opsi ber-blocker terbaca alasannya; fokus kembali ke tombol pemicu saat tutup.
- [ ] Wizard: error per field terbaca pembaca layar (`aria-describedby`), tombol bawah lengket tidak menutupi input
      saat keyboard terbuka (390 px).
- [ ] Progres job: running, succeeded (create → CTA unggah), rolled_back, failed + kotak stderr, interrupted + Bersihkan;
      blip simulasi (fake menolak request 5 dtk) tidak memunculkan error.
- [ ] Deploy: unggah → putus jaringan (DevTools offline) → jeda → online → lanjut; reload halaman → kartu "Unggahan belum
      selesai" → pilih file sama → lanjut dari potongan yang hilang; file lain → dialog mulai baru.
- [ ] Dialog rollback "dari → ke" + tabel ikut/tidak ikut; hapus situs typed (tombol disabled sampai cocok).
- [ ] Env: tempel `.env` 12 kunci → pratinjau masked → terapkan → Simpan → banner perlu mulai ulang.
- [ ] Kontras token di kedua tema untuk banner warning/danger (tanpa kelas amber mentah); target sentuh ≥ 44 px di HP.

**Di HP (POCO, setelah izin pemilik):** E1–E7 §8.1 dijalankan dan hasilnya dicatat di PLAN ini sebelum gelombang 2
dikunci; first-run §4.3 langkah 1–7 (tanpa deploy) dijalankan pemilik/agent; deploy ke makuro-solusi hanya pada jendela
waktu yang disetujui pemilik.

---

## 7. Rencana kerja

Nomor migration, urutan gelombang lintas PLAN, dan file bersama ditetapkan orkestrator. Tidak ada dua worker pada satu
file di gelombang yang sama.

**Gelombang 0 — eksperimen POCO (bukan kode; butuh izin pemilik)**: `wkr-sites-lab-00` menjalankan §8.1 dan menulis hasil
ke §8.1 dokumen ini. Gelombang 2 boleh dimulai setelah ini, atau dengan asumsi hasil lab lokal bila pemilik menunda.

**Gelombang 1 — kontrak & runner (paralel)**

| Worker                  | File (kepemilikan eksklusif)                                                                                                                                                                                                                                                                                      | Ukuran |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-sites-contract-01` | `src/shared/site.types.ts`, `src/shared/deploy.types.ts`, `src/server/db/schema/site.schema.ts`, `src/server/db/schema/deploy.schema.ts`, `drizzle/00NN_sites_lifecycle.sql` + `drizzle/meta/*` + `drizzle/migrations.js`, `src/server/routes/http.error.ts`, `tests/db.migrate.test.ts`                          | ±350   |
| `wkr-sites-runner-01`   | `src/server/sites/job.runner.ts` (kode/params/log/durasi, `interrupted`, `save()` aman, `isLocked`, `active()`, busy extra, step list dinamis untuk cleanup), `src/server/sites/job.legacy.ts` (baru, `legacyStep`), `src/server/shutdown.ts`, `tests/job.runner.test.ts` (baru), `tests/server.shutdown.test.ts` | ±450   |

Runner bergantung pada tipe dari contract worker: urutkan contract dulu dalam gelombang (selesai ±1 jam), atau berikan
tipe final §3.1 di spec runner (tipe ditulis persis dari PLAN ini, jadi paralel aman).

**Gelombang 2 — fitur server (paralel; setelah G1 dan setelah adapter PLAN/02 §3.7)**

| Worker                | File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Ukuran |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-sites-setup-02`  | `src/server/sites/integration.service.ts` (baru), `src/server/sites/ecosystem.probe.ts` (baru), `src/server/sites/adopt.candidates.ts` (baru, termasuk `readEnvPort`), `src/server/sites/site.adopt.ts` (baru, server), `src/server/dev/setup.service.ts` (hanya baris `apps_json`), `tests/site.integration.test.ts`, `tests/ecosystem.snippet.test.ts`, `tests/site.adopt.test.ts` (baru)                                                                                                                                                                                                                                                        | ±650   |
| `wkr-sites-jobs-02`   | `src/server/sites/site.service.ts` (list/detail/create/delete/hostnames/settings/restart; dipangkas ≤ 300 baris), `src/server/sites/site.env.service.ts` (baru), `src/server/sites/site.jobs.ts`, `src/server/sites/site.steps.ts`, `src/server/sites/site.checks.ts`, `src/server/sites/job.recovery.ts` (baru; cleanup create/hostname/env/restart, retry delete/remove), `src/server/sites/env.file.ts`, `src/server/cloudflare/dns.provider.ts` (`inspect` + same-tunnel), `src/server/routes/sites.routes.ts`, `tests/site.create.test.ts`, `tests/site.manage.test.ts`, `tests/site.recovery.test.ts` (baru), `tests/cloudflare.dns.test.ts` | ±1.100 |
| `wkr-sites-deploy-02` | `src/server/deploy/deploy.service.ts`, `src/server/deploy/deploy.steps.ts`, `src/server/deploy/health.check.ts` (baru), `src/server/deploy/upload.store.ts`, `src/server/deploy/binary.hash.ts` (baru, cache sha), `src/server/deploy/app-log.tail.ts` (baru, redaksi + TTL), `src/server/deploy/deploy.recovery.ts` (baru), `src/server/routes/deploy.routes.ts`, `tests/deploy.api.test.ts`, `tests/deploy.health.test.ts` (baru), `tests/deploy.upload.test.ts` (baru)                                                                                                                                                                          | ±1.000 |

Antarmuka antar worker G2 (ditulis di spec): `job.recovery.ts` memanggil `deployRecoverySteps(ctx, job)` dari
`deploy.recovery.ts`; `site.service.detail()` memanggil `binaryInfo(site)` dari `binary.hash.ts` dan
`integration.service.ready()`; `site.service` mengimpor `adoptSite` dari `site.adopt.ts`. Rute adopsi/integrasi didaftarkan
di `sites.routes.ts` (milik jobs-02) dengan handler yang diekspor setup-02. `src/server/index.ts` (wiring `apps.json` saat
start + `PANEL_PORT` untuk `self`) = satu baris dari jobs-02, dikoordinasikan dengan PLAN/02/04 yang juga menyentuh file
ini.

**Gelombang 3 — web (paralel; setelah G2 dan setelah gelombang komponen PLAN/01: `ConfirmAction` tier, `PageHeader`
status/actions, `DataTable` rowActions + list, `status.vocab`, `LogViewer`, toaster tunggal)**

| Worker                    | File                                                                                                                                                                                                                                                                                                                                                                                                                                         | Ukuran |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-sites-web-list-03`   | `src/web/site/sites.page.tsx`, `site.setup.tsx` (baru; hapus `integration.banner.tsx`), `site.discovered.tsx` (baru), `adopt.dialog.tsx`, `site.adopt.ts`, `site-new.page.tsx`, `wizard.target.tsx`, `wizard.options.tsx`, `wizard.summary.tsx`, `form.field.tsx`, `site.api.ts`, `site.check.ts`, `site.card.tsx` (hapus), `src/web/i18n/id.site.ts`, `src/web/i18n/id.ts` (daftarkan `id.site-detail`, `id.job`), `tests/web.site.test.ts` | ±900   |
| `wkr-sites-web-detail-03` | `src/web/site/site-detail.page.tsx`, `site.header.tsx` (baru), `site.anchors.tsx` (baru), `site.hostnames.tsx`, `site.env-editor.tsx`, `env.editor.tsx`, `env.rows.ts`, `env.paste.ts` (baru), `site.settings.tsx` (baru), `site.delete.tsx`, `src/web/i18n/id.site-detail.ts` (baru), `tests/web.site-detail.test.ts` (baru)                                                                                                                | ±850   |
| `wkr-sites-web-deploy-03` | `src/web/deploy/deploy.card.tsx`, `deploy.upload.ts`, `upload.resume.ts` (baru), `deploy.api.ts`, `deploy.state.ts`, `deploy.history.tsx`, `deploy.rollback.tsx` (baru), `src/web/site/job.page.tsx`, `job.steps.tsx`, `job.state.ts`, `jobs.page.tsx`, `job.failure.tsx` (baru), `src/web/i18n/id.deploy.ts`, `src/web/i18n/id.job.ts` (baru), `tests/web.deploy.test.ts`                                                                   | ±950   |

`deploy.card.tsx` dipakai di detail: detail-03 hanya me-render `<DeployCard site=… detail=… />` dengan props yang
disepakati di spec (`detail: SiteDetail`).

**Gelombang 4 — QA & docs**: UI-QA browser §6 (orkestrator/QA worker, ego-browser diizinkan untuk QA). Dokumentasi
sekali di akhir oleh satu worker (Rule 23): README bagian "Integrasi pm2" (snippet baru + peringatan snippet lama),
"Situs" (adopsi, deploy yang bisa dilanjutkan, cek kesehatan, perubahan terputus, rollback tidak mengembalikan env/DB),
catatan risiko admin = pemilik HP; CHANGELOG `Added/Changed/Fixed`.

Perkiraan total PLAN/03: ±6.200 baris diff termasuk test.

### Dependensi lintas PLAN (minta dihormati)

| Kepada      | Yang dibutuhkan PLAN/03                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN/01     | `ConfirmAction` tier `typed` (input + label tombol kata kerja + objek); `PageHeader` dengan `status` dan `actions` + varian lengket; `DataTable` `rowActions` + tampilan list < md + baris-link; `status.vocab` dengan jenis `job` (5 status termasuk `interrupted` "Terputus" tone danger, `rolled_back` tone warning "Dikembalikan") dan `deploy`; `LogViewer` mode statis (tanpa follow) untuk ekor stderr dan log langkah; bar aksi lengket bawah HP; toaster tunggal                                                                                                                                                                                                                                                                                                                                                                   |
| PLAN/02     | Adapter §3.7 (`cwd`, `execPath`, `args`, `startedAtMs`, `module`; `httpStatus(port, path, timeoutMs)`; fake data) di gelombang adapter mereka. Kontrol app/layanan memanggil `jobs.isLocked(resource: { kind: "service" \| "app"; name: string }): boolean` (sudah direncanakan dengan nama ini). `site_job_failed` dievaluasi dari: job terbaru per target berstatus `interrupted` atau `failed` dengan `resolvedBy = null` → severity danger, `params {jobId, kind, status}`, `href /panel/jobs/:id`. `site_crash_loop` **tidak dipakai** (cukup `app_crash_loop` dengan `params.site`); boleh dihapus dari union. Snapshot pm2 dipakai `toSites`/discovered/check (G28) — fungsi yang diekspos snapshot: `pm2Procs(): Promise<Pm2Proc[]>` (stale ≤ 15 dtk boleh untuk list, **tidak** untuk langkah job: job memanggil adapter langsung) |
| PLAN/04     | Cakupan cadangan per situs: `.env` dan `data/` disertakan; `app`, `app.prev`, `app.new`, `.app.prev.drop`, `.app.swap` dikecualikan (binary bisa diunggah ulang; 89 MB × 2 per situs). Fungsi `lastSuccessfulBackupOf(database: string): { at: string; runId: string } \| null` untuk dialog hapus situs. Peringatan bahwa cadangan berisi rahasia `.env`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PLAN/05     | `integration()` tetap memberi `ecosystemIncludesAppsJson` (dipertahankan, §3.6). Installer HP baru: ecosystem template **harus** memuat snippet §3.6 dan minimal satu aplikasi atau pm2-runtime yang tidak keluar saat 0 aplikasi (lab lokal: `--no-auto-exit` tidak cukup saat ecosystem kosong di pm2 5.4.3; tunggu E4 POCO); `sv -w 130 restart panel` saat upgrade. Teks onboarding `apps_json` menautkan ke kartu Persiapan `/panel/sites`. Gelombang `dns.provider.ts` PLAN/05 (`wkr-adm-cfverify-01`) setelah `wkr-sites-jobs-02`                                                                                                                                                                                                                                                                                                    |
| Hotfix CSRF | Semua endpoint baru memakai klien `apiFetch` (header `X-Requested-With`); PUT chunk juga (klien unggah memakai `apiFetch` atau menambah header yang sama)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 8. Risiko, asumsi, pertanyaan terbuka

### 8.1 Dua perilaku pm2 yang harus diuji sebelum PLAN dikunci

**Pra-uji lokal (sudah dijalankan, 2026-11-26)** — pm2 5.4.3 di macOS, `PM2_HOME` terisolasi di path pendek
(socket Unix > 104 karakter gagal `EINVAL`), lab dibongkar sesudahnya; log disalin ke scratchpad sesi:

| Eksperimen                                                                                        | Hasil lokal                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| E1 pm2-runtime start, ecosystem = 1 app sehat + 1 entri `apps.json` dengan `./app` yang tidak ada | `PM2 error: Script not found …` → **menghentikan app sehat dan keluar** (exit 0). Sama dengan `--no-auto-exit`                         |
| E2 `pm2 start ecosystem.config.js --only blog` dari CLI saat pm2-runtime jalan (PM2_HOME sama)    | `blog` masuk daemon yang sama (jlist berisi hand + blog); restart pm2-runtime → `blog` dimuat lagi dari `apps.json`                    |
| E2b CLI `--only ghost` (script tidak ada) saat runtime jalan                                      | Error untuk ghost saja; runtime dan app lain tetap jalan                                                                               |
| E3 `pm2 start eco --only blog` saat `blog` sudah ada dan `script` di `apps.json` diganti          | `blog` di-restart tetapi **tetap memakai script lama**; script baru baru terpakai setelah delete+start atau restart runtime            |
| E4 hapus app terakhir saat runtime jalan; ecosystem 0 app saat start                              | 0 app online → runtime keluar ±8 dtk kemudian (exit 2). Ecosystem 0 app saat start → keluar seketika, **juga dengan `--no-auto-exit`** |
| E7 nama file                                                                                      | pm2 hanya memperlakukan file sebagai ecosystem bila namanya cocok pola (`*.config.js`); `eco2.js` dijalankan sebagai skrip aplikasi    |

Catatan insiden kecil: perintah `pm2 -v` pertama (sebelum lab terisolasi) menyalakan daemon pm2 di `~/.pm2` laptop
(tanpa aplikasi, `dump.pm2` = `[]`); daemon itu sudah dimatikan (`pm2 kill`), keadaan kembali seperti semula.

**Eksperimen di POCO (gelombang 0)** — tanpa menyentuh aplikasi produksi:

Isolasi:

- `PM2_HOME=$HOME/pm2lab/h` (bukan `~/.pm2`), sites di `$HOME/pm2lab/sites` (di **luar** `~/sites`, supaya run script
  pm2 produksi yang membunuh proses yatim ber-cwd `~/sites` tidak terlibat, dan sebaliknya).
- Layanan runit sementara `pm2lab`: `$PREFIX/var/service/pm2lab/run`:

  ```sh
  #!/data/data/com.termux/files/usr/bin/sh
  export PM2_HOME=$HOME/pm2lab/h
  exec 2>&1
  exec pm2-runtime $HOME/pm2lab/sites/ecosystem.config.js
  ```

  (varian `run` kedua dengan `--no-auto-exit` untuk E4). Tanpa `log/` (output ke `$PREFIX/var/log/sv/pm2lab` bila
  `svlogd` default ada; else `sv status` + `pm2 logs` lab).
- Semua perintah pm2 lewat fungsi `lab() { PM2_HOME=$HOME/pm2lab/h pm2 "$@"; }`; **dilarang** `pm2` tanpa `PM2_HOME`,
  `pm2 kill` global, `pkill -f`/`pgrep -f` (memory proyek: bisa membunuh shell ssh), restart `pm2`/`cloudflared`/`panel`.
- Aplikasi uji: (a) `app` = skrip node HTTP (shebang `#!/data/data/com.termux/files/usr/bin/node`, `interpreter: none`)
  di port 3991/3992/3993 (cek dulu tidak dipakai: `curl -s 127.0.0.1:399x` gagal); (b) satu binary Bun hello
  `--target=bun-linux-arm64-android` untuk E6.
- Sebelum dan sesudah: catat `pm2 jlist` produksi (nama, status, `restart_time`), `sv status pm2 cloudflared panel`,
  `curl -s -o /dev/null -w '%{http_code}' https://solusi.malikkurosaki.com` — harus identik (restart_time
  makuro-solusi tidak berubah).
- Bongkar: `sv down pm2lab`, hapus `$PREFIX/var/service/pm2lab`, `lab kill`, `rm -rf ~/pm2lab`.

Langkah dan pengukuran:

| #   | Langkah                                                                                                                                                                                                          | Yang dicatat                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| E1  | ecosystem (snippet) + app `hand`; `apps.json` berisi `ghost` dengan `./app` hilang (a: cwd ada, b: cwd tidak ada); `sv up pm2lab`                                                                                | runtime keluar? runsv me-restart berapa kali/menit? `hand` sempat online?              |
| E2  | `apps.json` = `[]` → runtime jalan → tambah entri `blog` + binary → `lab start sites/ecosystem.config.js --only blog`, juga lewat `runTermux` panel (`$PREFIX/bin/node $PREFIX/bin/pm2` dengan env PM2_HOME lab) | `blog` di daemon runtime yang sama? `sv restart pm2lab` → `blog` kembali? tidak ganda? |
| E3  | ubah `script` `blog` (native → grun) di `apps.json`, `lab start … --only blog`                                                                                                                                   | script lama atau baru yang jalan                                                       |
| E4  | `lab delete` semua app (dengan/tanpa `--no-auto-exit`); start dengan ecosystem 0 app (dengan/tanpa flag)                                                                                                         | runtime keluar? setelah berapa detik?                                                  |
| E5  | snippet §3.6 dengan `apps.json` hilang / kosong / rusak / objek → `sv restart pm2lab`                                                                                                                            | `hand` selalu online; pesan stderr `[ecosystem] apps.json dilewati`                    |
| E6  | binary Bun hello membaca `FOO` dari `.env`; ubah `.env`, `lab restart hello` vs tanpa restart                                                                                                                    | `restartPending` semantik benar (env baru hanya setelah restart)                       |
| E7  | `lab start sites/eco2.js --only x` (nama tanpa `.config.js`)                                                                                                                                                     | konfirmasi pola nama                                                                   |

Bagaimana PLAN berubah menurut hasil:

| Hasil POCO                                                 | Perubahan PLAN                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 = sama dengan lokal (runtime keluar)                    | D5 tetap **wajib** + check `apps_entries_runnable` = error dan ditampilkan di Ringkasan sebagai masalah danger; README memperingatkan jangan menghapus `app` lewat ssh tanpa menghapus entri. Dipertimbangkan: snippet memfilter entri yang `cwd/script`-nya tidak ada (`fs.existsSync(path.join(a.cwd, a.script))`) — **direkomendasikan** sebagai pengaman kedua bila E1 terkonfirmasi                              |
| E1 = hanya app itu `errored`                               | D5 tetap (lebih bersih), check `apps_entries_runnable` turun ke warning                                                                                                                                                                                                                                                                                                                                               |
| E2 = masuk daemon yang sama dan kembali setelah restart    | Desain sekarang (`pm2 start eco --only`) dipertahankan                                                                                                                                                                                                                                                                                                                                                                |
| E2 = CLI membuat daemon kedua / app hilang setelah restart | Adapter pm2 harus memakai `PM2_HOME` yang sama dengan run script (setting/env eksplisit) dan deploy pertama menandai "akan berjalan penuh setelah pm2 dimulai ulang"; integrasi menambah check `pm2_home_match` (bandingkan `rpc.sock` yang dipakai)                                                                                                                                                                  |
| E3 = script lama dipertahankan (seperti lokal)             | Pertahankan delete+start saat runtime berubah (sekarang, `deploy.steps.ts:197-201`), hanya bila entri berubah; restart biasa untuk deploy runtime sama                                                                                                                                                                                                                                                                |
| E3 = script baru dipakai                                   | Ganti delete+start dengan `start --only` (tanpa jeda 0-app)                                                                                                                                                                                                                                                                                                                                                           |
| E4 = runtime keluar saat 0 app online                      | Delete+start tetap berurutan langsung (jeda < 2 dtk, di bawah ±8 dtk lokal). Integrasi menambah check warning `pm2_single_app` bila ecosystem hanya berisi app panel: "Bila aplikasi ini satu-satunya, pm2 bisa berhenti saat deploy. Tambahkan `--no-auto-exit` di run script pm2" (hanya bila E4 membuktikan flag itu bekerja di 7.1.2; bila tidak, sarankan satu app penjaga ringan). Dependensi installer PLAN/05 |
| E5 gagal (runtime tetap keluar)                            | Snippet direvisi sampai lulus E5; panel tidak dirilis dengan snippet itu                                                                                                                                                                                                                                                                                                                                              |
| E6 = env baru terbaca tanpa restart                        | Tidak mungkin untuk binary Bun (dibaca saat start); bila terjadi, `restartPending` dihapus                                                                                                                                                                                                                                                                                                                            |

### 8.2 Risiko

- **Uji end-to-end di POCO menyentuh produksi** (deploy makuro-solusi = situs berbayar; perubahan domain memutus panel).
  Hanya dengan izin pemilik per sesi; eksperimen §8.1 dirancang tanpa menyentuh produksi.
- **Probe mengeksekusi ecosystem pemilik** dengan `node`. Bila file itu membaca rahasia atau punya efek samping, probe
  ikut menjalankannya (sama seperti pm2). Output dibatasi ke nama; stderr dipotong 300 karakter dan bisa berisi path.
- **Redaksi stderr tidak sempurna**: rahasia yang tidak ada di `.env` (mis. token dari API lain) tetap tampil ke admin.
  Admin dianggap setara pemilik (keputusan 1), jadi ini dicatat, bukan diblokir.
- **Shutdown 120 dtk** memperpanjang jeda upgrade bila ada perubahan berjalan.
- **sha cache** memakai `ino/size/mtimeMs`; binary yang diganti lewat ssh dengan mtime dipertahankan (`cp -p`) akan
  dilaporkan dengan sha lama sampai panel restart. Diterima (kasus langka).
- **`ingress.editor.ts`** hanya memahami bentuk YAML tertentu; config tulisan tangan lain → `ingress_unsupported` (aman,
  pesan menjelaskan).
- **Cleanup folder** sengaja konservatif (`folder_not_empty` dibiarkan) — pengguna mungkin harus `rm` manual.
- File besar yang mendekati batas Rule 8: `site.service.ts` (285 baris) harus dipecah sebelum ditambah (`site.adopt.ts`,
  `site.env.service.ts`, `integration.service.ts`); `id.site.ts` dipecah ke `id.job.ts` dan `id.site-detail.ts`.

### 8.3 Asumsi

- pm2 di POCO = 7.1.2 (memory proyek), `PM2_HOME` panel = `~/.pm2` = milik run script runit `pm2`.
- `node` tersedia di `$PREFIX/bin/node` (dibutuhkan pm2 juga).
- Header ELF + program header + PT_INTERP berada di 8 MB pertama untuk binary Bun (asumsi yang sudah dipakai kode sekarang).
- Cloudflare body cap 100 MB per request (alasan potongan 8 MB) tetap.
- Hotfix CSRF masuk sebelum gelombang 3.
- LICENSE MIT (asumsi brief) tidak memengaruhi PLAN ini.

### 8.4 Pertanyaan terbuka (keputusan pemilik)

1. **Q1** — Setelah E1 terkonfirmasi, boleh snippet ikut memfilter entri yang binary-nya tidak ada (pengaman kedua, 1
   baris lebih panjang)? Rekomendasi: ya.
2. **Q2** — makuro-solusi tetap glibc (`grun`) atau pindah ke build Android? Bila pindah, pemilik sendiri yang mengubah
   `site()` di ecosystem dan me-restart pm2 (panel tidak melakukannya). Rekomendasi: pindah ke Android native setelah
   deploy glibc pertama lewat panel terbukti lancar.
3. **Q3** — Cleanup deploy yang terputus: selalu kembali ke versi sebelumnya (D25), atau tambahkan pilihan "Pertahankan
   versi baru" (jalankan cek kesehatan saja)? Rekomendasi: D25 dulu; tambah pilihan bila pemilik pernah membutuhkannya.
4. **Q4** — TTL unggahan 1 jam sejak potongan terakhir cukup? (89 MB lewat 4G lambat ±15–30 mnt; jeda Access login
   beberapa menit.) Rekomendasi: tetap 1 jam.
5. **Q5** — Health check default untuk situs **adopsi** yang sudah ada: `/` dengan "apa pun < 500" (perilaku sekarang) —
   atau pemilik menetapkan path khusus makuro-solusi saat adopsi? Rekomendasi: default, ubah di Pengaturan bila perlu.
