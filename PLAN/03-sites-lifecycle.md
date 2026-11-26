# PLAN 03 — Siklus hidup Situs (integrasi pm2, adopsi, wizard, perubahan, deploy, rollback, variabel lingkungan, domain, hapus)

> Worker: wkr-plan-sites-01 · 2026-11-26 · branch `feature/production-polish`.
> Sumber: `R&D/03-sites-lifecycle.md` (selanjutnya "R3-Gn"), silang dengan R&D-01/02/04/05, PLAN/01/02/04/05,
> `PLAN/DECISIONS.md` (mengikat), `PLAN/debate/03-critique.md` + `03-response.md`, lab pm2 POCO
> `PLAN/debate/03-pm2-lab-results.md` (pm2 7.1.2), `docs/content-guide.md`, `docs/research/ui-benchmark.md`, kode di
> HEAD (dikutip `file:baris`), repo `server-termux` (dibaca). Tidak ada kode yang diubah. Istilah UI mengikuti
> glosarium (Situs, Domain, Aplikasi, Perubahan, Deploy, Rollback / Kembalikan versi sebelumnya, Variabel lingkungan,
> Unggah).

## Riwayat revisi

| Rev | Tanggal    | Ringkasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 2026-11-26 | Versi awal (lab pm2 lokal 5.4.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1   | 2026-11-26 | Setelah debat dan lab POCO. **Unggah**: `pwrite` ke satu `upload.bin`, sha dihitung di `complete` dan disimpan sebelum job (C1). **Swap**: urutan yang menjaga `app` selalu ada (hardlink) + tabel cleanup berbasis keadaan file (C2). **Entri pm2**: `script: "./run"` tetap, `run` diturunkan dari ELF, deploy = `pm2 restart` (C6, E3). **Snippet**: filter `existsSync(path.resolve(cwd, script))` wajib (E1/E1e, C3), cek `snippet_current`. **pm2 mati**: `Pm2UnavailableError`, cek `pm2_runtime`/`pm2_auto_exit`/`pm2_guard`, app penjaga `pm2-guard`, spec `server-termux` + `install-phone.sh` (C4, E4). **Cek kesehatan**: pid valid + stabil, `expect lt500/2xx3xx`, header `Host`, pm2 dibaca jarang (C9, E3). **Env**: aturan `$` Bun, `.env.panel-prev`, kunci yang ditimpa `env` pm2 ditandai (C7, C8, E6b). **DNS hapus** non-fatal setelah restart, domain bisa ditambah beberapa sekaligus (C10, A-blip). Stderr lewat endpoint log PLAN/02 (C20). `POST /jobs/:id/recover` tunggal. Lencana "Aktif" dari `(ino, mtimeMs)`. Kunci global sederhana (C21). Status `rolled_back`/`interrupted` = warning (A10, B12). Kepemilikan file selaras jadwal integrasi (C13). |

---

## 1. Tujuan & ruang lingkup

**Tujuan.** Pemilik HP bisa (a) menghubungkan pm2 dengan aman tanpa risiko mematikan aplikasi produksi saat reboot,
(b) mengadopsi `makuro-solusi` dengan data yang benar dari pm2, (c) men-deploy binary 89 MB lewat VPN/4G yang
putus-putus tanpa mengulang dari nol, (d) tahu kenapa deploy gagal dan apa langkah berikutnya, (e) memulihkan perubahan
yang terputus oleh restart panel, (f) memasang Panel Termux di HP **baru** tanpa pm2 masuk loop restart. Semua dalam
bahasa Indonesia.

### Masuk (menutup gap R&D-03)

| Bagian                                                                                                                       | Gap R&D-03                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Integrasi pm2 aman: `apps.json` = `[]` dibuat panel, snippet aman dengan filter binary, verifikasi `node`, cek pm2 hidup     | **G1** (P0), G14                           |
| Adopsi dari aplikasi pm2 nyata (cwd, script, runtime ELF, port), host panel dikecualikan                                     | **G2**, **G3** (P0), G11, G23, G31         |
| Journal + "Bersihkan"/"Ulangi" (`/recover`) untuk perubahan terputus; swap yang tahan crash; timeout shutdown; `save()` aman | **G4** (P0), G21                           |
| Unggah yang bisa dilanjutkan (meta dipersist, klien memakai `received`), retry ≥ 120 dtk, sha per potongan                   | **G5** (P0), G22, G24                      |
| Kode langkah + parameter (tanpa string Inggris ke UI), error berkode                                                         | **G6** (P0)                                |
| Ekor stderr aplikasi + aksi lanjutan saat deploy gagal                                                                       | **G7** (P0)                                |
| Cek kesehatan: path, status yang diharapkan, timeout per situs, syarat pid + stabil                                          | G8                                         |
| Simpan variabel lingkungan = file saja, atau perubahan `site.env` (tulis → mulai ulang → cek); tempel `.env`                 | G9, G25                                    |
| Kunci perubahan dihormati kontrol `/panel/apps` & `/panel/services`                                                          | G10                                        |
| Entri `apps.json` baru dibuat saat deploy pertama                                                                            | G12                                        |
| Cek DNS di wizard; CNAME manual ke tunnel yang sama diterima                                                                 | G13                                        |
| Versi aktif/sebelumnya dari file nyata, dialog rollback "dari → ke" + yang tidak ikut kembali                                | G15, G16                                   |
| Hapus situs dengan ketik nama + info cadangan + default aman                                                                 | G17                                        |
| Header detail dengan status + aksi utama, Mulai ulang, Cek kesehatan, Log                                                    | G18                                        |
| Aktor, durasi, filter per situs di riwayat perubahan; 409 `busy` membawa job                                                 | G19                                        |
| Makna `rolled_back` vs `failed` vs `interrupted` di UI                                                                       | G20                                        |
| Probe HTTPS domain baru setelah restart cloudflared (non-fatal); blip digabung dan dijelaskan                                | G27 (tanpa `/ready`)                       |
| Cache `pm2 jlist` (snapshot PLAN/02)                                                                                         | G28                                        |
| Template ecosystem + penjaga untuk HP baru (`server-termux`, `install-phone.sh`)                                             | R3 §4.3 baris "pm2-runtime … tanpa binary" |

### Keluar (tidak pernah menjadi fitur PLAN ini sejak rev 0; bukan pemangkasan A8)

- Nilai env multi-line (G26): tetap ditolak dengan pesan jelas.
- Deploy dari URL (G29) dan dari CI (G32); build dari Git.
- Tambah database ke situs yang sudah ada (G30).
- N versi binary (`releases/`): tetap 1 versi sebelumnya (`app.prev`, default brief).
- Panel mengedit `ecosystem.config.js`, mengubah situs adopsi jadi "dikelola", me-restart pm2-runtime.
- Tunnel remote-managed, `/ready` metrics cloudflared, dua replika cloudflared (zero-downtime).
- Antrian perubahan (tetap tolak 409 `busy`).

Bila arbitrase menilai salah satu di atas termasuk A8, butir itu perlu PLAN tersendiri.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                                                           | Alternatif                                                         | Alasan                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Panel tidak pernah mengedit `ecosystem.config.js`.** Panel membuat `apps.json` = `[]` (bila belum ada, tidak pernah menimpa), menampilkan snippet, dan memverifikasi dengan `node`.                                                                                                                                               | Panel menyisipkan baris sendiri; panel mengambil alih              | Parser teks JS rapuh. Satu kesalahan berarti semua app mati saat reboot                                                                                                                          |
| D2  | Snippet: `try/catch` + `Array.isArray` + filter `name` + **filter `existsSync(path.resolve(a.cwd ‖ __dirname, a.script ‖ ""))` (wajib)**                                                                                                                                                                                            | Tanpa filter binary (rev 0)                                        | Lab E1 (pm2 7.1.2): satu entri native dengan script hilang → runtime menghentikan semua app, ±54 restart/mnt. E1e: filter lulus di runtime nyata. `path.resolve` benar untuk script absolut (C3) |
| D3  | `apps.json` dibuat saat panel start (termux, bila `sites.dir` ada) dan di `POST /integration/verify`; tidak di `GET`                                                                                                                                                                                                                | Saat situs pertama                                                 | `GET` bebas efek samping, snippet tidak bergantung urutan                                                                                                                                        |
| D4  | Integrasi wajib `ready` sebelum Buat situs dan sebelum deploy pertama situs dikelola. Adopsi dan deploy situs adopsi tidak butuh integrasi, tetapi butuh `pm2_runtime` ok                                                                                                                                                           | Peringatan saja                                                    | Situs yang "berhasil" tetapi tidak jalan setelah reboot = kegagalan senyap                                                                                                                       |
| D5  | **Entri `apps.json` hanya ada bila `app` dan `run` ada.** Entri ditulis di deploy pertama setelah swap; dihapus sebelum binary dihapus                                                                                                                                                                                              | Tulis saat buat situs                                              | E1 POCO. Filter D2 = pengaman kedua                                                                                                                                                              |
| D6  | **Entri panel tetap**: `{ name, cwd, script: "./run", interpreter: "none", exp_backoff_restart_delay: 1000 }` tanpa `env`. `run` = skrip sh 3 baris yang ditulis panel (`exec ./app` atau `exec $PREFIX/bin/grun ./app`), diturunkan dari ELF `app` di setiap deploy/rollback/cleanup                                               | `script: ./app`/`grun` + delete+start saat runtime berubah (rev 0) | E3: `start --only` memakai script lama dan bisa `online` dengan `pid=undefined`. Entri tetap → selalu `pm2 restart`, tanpa jeda 0-app. Tanpa `env` → `.env` satu-satunya sumber (E6b)            |
| D7  | **Adopsi berbasis aplikasi pm2** (dropdown). `dir` = `realpath(pm_cwd)` di dalam `sites.dir`; runtime dari ELF `<cwd>/app`; `scriptRuntime` dari `pm_exec_path` (`grun`/`glibc-runner` → grun); port dari ingress, dicocokkan via env pm2 → args → `.env PORT`                                                                      | Form bebas + validasi                                              | Data POCO membuktikan form bebas menghasilkan situs yang tak bisa di-deploy. Kritik mencocokkan alur ini dengan POCO: sesuai                                                                     |
| D8  | `PORT` dari `<cwd>/.env` dibaca lewat `decodeEnvValue` hanya untuk baris `PORT`; hasil hanya integer; tidak dilog                                                                                                                                                                                                                   | Tidak membaca `.env`                                               | `makuro-solusi` hanya punya port di `.env`                                                                                                                                                       |
| D9  | Host panel (`APP_BASE_URL`) dan rule ingress ke `PORT` panel ditandai `self` ("Panel Termux (domain ini)") tanpa tombol Adopsi; server 409 `self_hostname`. `PORT` panel tidak pernah ditawarkan `suggestPort`. Nama `pm2-guard` dicadangkan                                                                                        | Disembunyikan                                                      | Pemilik melihat semua rule tetapi tidak bisa memutus akses panel                                                                                                                                 |
| D10 | Langkah dan hasil berkode: `JobStep.key` (union) + `code` + `params` + `detail` teknis. Klien menerjemahkan                                                                                                                                                                                                                         | Server menulis Indonesia                                           | Satu sumber teks; `satisfies Record<…>` memaksa terjemahan lengkap                                                                                                                               |
| D11 | **Perubahan terputus = `interrupted`** + journal (`job.input` + status langkah). Pemulihan manual lewat satu endpoint `POST /jobs/:id/recover`: server memilih **cleanup** (create, hostname.add, deploy, rollback, env, restart) atau **retry** (delete, hostname.remove). Tanpa undo otomatis saat boot                           | Undo otomatis saat boot; dua endpoint (rev 0)                      | Pemeriksaan idempoten berbasis file nyata lebih kuat daripada closure memori; satu endpoint = satu tombol (C20.3)                                                                                |
| D12 | **sha akhir disimpan permanen sebelum langkah `swap`**: dihitung di `POST complete` (streaming `upload.bin`), ditulis ke `job.input` dan baris `deploy` sebelum `jobs.start`                                                                                                                                                        | Dihitung di `assemble` (rev 0)                                     | Baris `deploy` disisipkan sebelum langkah pertama dan `sha256` NOT NULL (`deploy.service.ts:97-109`, `deploy.schema.ts:17`) (C1)                                                                 |
| D13 | **Unggahan**: potongan di-`pwrite` ke `<data>/uploads/<id>/upload.bin` pada offset; `meta.json` (sha per potongan, state) dipersist **setelah** potongan di-`fsync`; panel restart tidak menghapus unggahan; TTL 1 jam sejak potongan terakhir. Langkah `stage` = `rename(upload.bin → app.new)` (fallback salin bila `EXDEV`)      | File per potongan + assemble (rev 0)                               | Satu salinan 89 MB per deploy hilang; preflight ruang 1× bukan 2× (C11, C20)                                                                                                                     |
| D14 | Runtime dibaca dari potongan 0 saat diterima: non-ELF → 400 `invalid_binary`; situs adopsi dengan runtime ≠ `scriptRuntime` → 409 `runtime_mismatch`, sebelum sisa file terkirim. Rollback situs adopsi memeriksa hal yang sama pada `app.prev`                                                                                     | Tolak setelah swap                                                 | Header ELF ada di 8 MB pertama (`deploy.service.ts:143`). C12                                                                                                                                    |
| D15 | Retry potongan: 1, 2, 4, 8, 16, 30, 30, 30 dtk (±121 dtk) untuk galat jaringan, 408, 429, 5xx, 52x; lalu "Unggahan terhenti" + **Lanjutkan unggahan**. Tanpa cabang `navigator.onLine`                                                                                                                                              | 1/2/4 dtk; cabang offline                                          | Lebih lama dari blip cloudflared ≤ 30 dtk + reconnect (keputusan pemilik); `onLine` tidak andal di Android (C22)                                                                                 |
| D16 | Cek kesehatan per situs: `path` (default `/`), `expect: "lt500" \| "2xx3xx"` (default `lt500`), `timeoutSec` 10–300 (default 60), probe dengan `Host: <domain utama>`. Sehat = 2 probe lolos berturut (jarak 1 dtk) **dan** pid pm2 angka > 0 yang sama sejak baseline **dan** `restarts` tidak naik, diperiksa lagi 5 dtk kemudian | Satu jawaban < 500, 30 dtk; status `online`                        | E3: `online` bisa tanpa pid dan port mati. Baseline diambil segera setelah restart (C9)                                                                                                          |
| D17 | Stderr saat gagal: halaman progres memanggil endpoint log app PLAN/02 (`LogChunk`, 50 baris `err`), diredaksi redaktor PLAN/02 ditambah nilai `.env` situs (`siteSecretsFor(app)`). Tidak disimpan di job                                                                                                                           | Map memori + endpoint sendiri (rev 0)                              | Satu kebijakan redaksi; tetap tersedia setelah panel restart (C20.2)                                                                                                                             |
| D18 | Simpan env: **Simpan** = tulis file saja (di bawah kunci, audit kunci) → banner `restartPending`; **Simpan dan mulai ulang** = job `site.env` (`env_write` dengan salinan `.env.panel-prev` → `app_restart` → `health`; gagal → `.env` lama dipulihkan + restart)                                                                   | Restart langsung (sekarang)                                        | Nilai salah tidak lagi membuat situs mati tanpa jejak; juga bisa dipulihkan setelah crash (C8)                                                                                                   |
| D19 | `restartPending` dihitung: `mtime(.env) > pm2 pm_uptime`                                                                                                                                                                                                                                                                            | Kolom flag                                                         | E6: Bun membaca `.env` hanya saat start                                                                                                                                                          |
| D20 | Kunci terkunci: situs dikelola `PORT` (+ `DATABASE_URL` bila ber-database), ditegakkan server. Situs adopsi: bebas, tetapi kunci yang ada di `env` entri pm2 (probe, nama saja) ditandai "Diatur oleh pm2; nilai di `.env` diabaikan". Regex kunci + codec di `src/shared`                                                          | Aturan klien ≠ server                                              | E6b: `env` pm2 mengalahkan `.env`                                                                                                                                                                |
| D21 | Codec `.env` mengikuti Bun 1.4.2: `$NAME` diekspansi di semua kutip, `\$` literal; tulis nilai ber-`'` dalam kutip ganda bila tanpa `"`/`\`; tolak hanya bila keduanya. Tempel `.env` menandai `$` tanpa `\`                                                                                                                        | Tolak semua `'`                                                    | Uji Bun kritik (C7)                                                                                                                                                                              |
| D22 | Versi: `app` + `app.prev`. "Aktif" = `stat(app)` cocok dengan `(ino, mtimeMs, size)` baris deploy terakhir yang sukses; `previous` dikenali lewat `stat(app.prev)`. Binary yang diganti lewat ssh = "Versi tanpa catatan"                                                                                                           | sha cache (rev 0); `releases/` N=3                                 | Tanpa hashing 89 MB per request; jujur bila diganti di luar panel (C20.4)                                                                                                                        |
| D23 | **Swap tahan crash**: deploy `app.prev → .app.prev.drop` → `link(app, app.prev)` (fallback `copyFile`) → `rename(app.new, app)`; rollback `link(app, .app.swap)` → `rename(app.prev, app)` → `rename(.app.swap, app.prev)`. `app` selalu ada di setiap titik                                                                        | 3 rename (sekarang)                                                | Crash di antara rename sekarang membuat `app` hilang (C2)                                                                                                                                        |
| D24 | Konfirmasi: hapus situs dikelola = `typed` (+ server `?confirm=<nama>`); rollback, mulai ulang, hapus domain, hapus situs adopsi = `confirm`; Cek kesehatan, Periksa lagi, Pulihkan = `Button` biasa                                                                                                                                | Satu tingkat                                                       | Tier PLAN/01 (`confirm \| typed`)                                                                                                                                                                |
| D25 | Detail situs = satu halaman dengan bagian + navigasi jangkar                                                                                                                                                                                                                                                                        | Tab                                                                | Konten tidak tersembunyi, deep link `#deploy`                                                                                                                                                    |
| D26 | Buat situs tanpa unggah di wizard; halaman hasil memberi CTA **Unggah binary pertama**                                                                                                                                                                                                                                              | Wizard 4 langkah                                                   | Dua job dalam satu alur sulit dijelaskan saat gagal                                                                                                                                              |
| D27 | Cleanup deploy/rollback terputus = kembali ke keadaan sebelum perubahan (tabel keadaan §4.11)                                                                                                                                                                                                                                       | Pilihan "pertahankan versi baru"                                   | Kesehatan versi baru tidak diketahui; unggahan bisa diulang cepat                                                                                                                                |
| D28 | Kunci: selama ada job, `cloudflared`, `pm2`, `postgres`, dan app pm2 target terkunci (`jobs.isLocked`). `database_drop` menolak `busy` saat cadangan/pemulihan berjalan                                                                                                                                                             | Kunci per sumber daya (rev 0)                                      | Satu job global; granularitas per sumber daya tidak sebanding biayanya (C21, X23)                                                                                                                |
| D29 | **Blip cloudflared diperkecil dan dijelaskan**: restart hanya bila teks ingress berubah; beberapa domain per job (`hostnames[]` 1–5, `extraHostnames` di wizard maks 4); hapus DNS dilakukan setelah restart dan non-fatal (tanpa restart kedua); UI menyebut domain lain yang ikut terputus                                        | Satu domain per job; DNS hapus fatal                               | Keputusan pemilik; C10                                                                                                                                                                           |
| D30 | Panel tidak pernah menyalakan daemon pm2: adapter melempar `Pm2UnavailableError` bila layanan runit `pm2` tidak `run`; langkah → `pm2_not_running`                                                                                                                                                                                  | Cek `rpc.sock` saja                                                | `startFromEcosystem` tanpa cek bisa menyalakan daemon di luar runit (C4, B14)                                                                                                                    |
| D31 | **HP baru**: template ecosystem (snippet + app penjaga `pm2-guard` = `sleep infinity`) + `apps.json` `[]` + run script `--no-auto-exit` dipasang installer bila belum ada (spec §7.2)                                                                                                                                               | "Minimal satu aplikasi" tanpa pemilik                              | E4: ecosystem 0 app saat start keluar seketika, juga dengan `--no-auto-exit`; flag menahan kasus "app terakhir dihapus"                                                                          |
| D32 | `SHUTDOWN_TIMEOUT_MS` 20 → **120 dtk** (§4.12)                                                                                                                                                                                                                                                                                      | 90/360 dtk                                                         | Menutup perubahan tipikal; sisanya lewat D11                                                                                                                                                     |

---

## 3. Model data & kontrak API

Tipe shared ditulis `wkr-contracts-00` (W0) persis seperti di bawah. `ApiError` memakai status kanonik W0
(`400|401|403|404|409|410|421|429|502|503|507`) + `extra`.

### 3.1 `src/shared/site.types.ts` (diganti)

```ts
// Contract of the site management API under /api/panel (role ≥ admin). Errors: { error, message, ...extra }.
import type { AppStatus } from "./panel.types";

/** How the site's binary runs: directly (Android linker / static) or through grun (glibc). */
export type SiteRuntime = "native" | "grun";
/** What a hand-written pm2 entry runs (pm_exec_path basename): grun/glibc-runner, the binary, or anything else. */
export type ScriptRuntime = SiteRuntime | "other";
export type SiteAppStatus = AppStatus | "not_deployed";

/** Allowed env key (one source for client and server). */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const HEALTH_TIMEOUT_MIN_SEC = 10;
export const HEALTH_TIMEOUT_MAX_SEC = 300;
export const HEALTH_TIMEOUT_DEFAULT_SEC = 60;
/** pm2 app name reserved for the keep-alive guard of fresh phones (never a site, hidden from Aplikasi). */
export const PM2_GUARD_APP = "pm2-guard";

export type HealthExpect = "lt500" | "2xx3xx";
export type SiteHealthConfig = { path: string; expect: HealthExpect; timeoutSec: number };

type DeployKindRef = "deploy" | "rollback";
type DeployStatusRef = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";

/** Item of GET /sites. */
export type Site = {
  name: string;
  port: number;
  hostnames: string[];
  database: string | null;
  runtime: SiteRuntime;
  managed: boolean;
  /** pm2 process name (site.app ?? site.name). */
  app: string;
  /** "unknown" when pm2 is unavailable (never "not_deployed" in that case). */
  appStatus: SiteAppStatus;
  restarts: number | null;
  lastDeploy: { at: string; kind: DeployKindRef; status: DeployStatusRef; actorName: string | null } | null;
  createdAt: string;
};

/** A binary file of a site, matched against deploy rows by (ino, mtimeMs, size). */
export type BinaryInfo = {
  sizeBytes: number;
  modifiedAt: string;
  /** Deploy row that put exactly this file in place; null = "Versi tanpa catatan". */
  deployId: string | null;
  sha256: string | null;
  fileName: string | null;
  runtime: SiteRuntime | null;
};

export type ActiveJob = { id: string; kind: JobKind; target: string; startedAt: string };

/** GET /sites/:name. Env values are never returned. */
export type SiteDetail = Site & {
  dir: string;
  envKeys: string[];
  /** Managed: PORT (+ DATABASE_URL when database). Adopted: []. */
  lockedEnvKeys: string[];
  /** Adopted: keys set in the pm2 entry's env (they override .env; names only). Managed: []. */
  pm2EnvKeys: string[];
  restartPending: boolean;
  dns: { hostname: string; managed: boolean }[];
  health: SiteHealthConfig;
  binary: { live: BinaryInfo | null; previous: BinaryInfo | null };
  scriptRuntime: ScriptRuntime | null;
  deployBlocker: "integration" | "no_folder" | "pm2_not_running" | null;
  activeJob: ActiveJob | null;
};

/** GET /sites/discovered. */
export type Discovered = { ingress: DiscoveredIngress[]; apps: AdoptCandidateApp[] };

export type DiscoveredIngress = {
  hostname: string;
  port: number | null;
  self: boolean;
  match: string | null;
  blockers: ("self" | "no_port" | "wildcard")[];
};

export type AdoptCandidateApp = {
  name: string;
  status: AppStatus;
  cwd: string | null;
  port: number | null;
  portSource: "pm2_env" | "pm2_args" | "dotenv" | null;
  runtime: SiteRuntime | null;
  scriptRuntime: ScriptRuntime;
  blockers: ("outside_sites_dir" | "no_binary" | "invalid_binary" | "pm2_module" | "name_invalid")[];
  warnings: ("runtime_script_mismatch" | "script_other" | "port_unknown" | "port_mismatch")[];
};

export type SiteAdoptRequest = { hostname: string; app: string; name?: string };

export type SiteCheckRequest = {
  name?: string;
  hostname: string;
  extraHostnames?: string[];
  port?: number;
  database?: boolean;
  scope?: "site" | "hostname";
};

export type SiteIssueCode =
  | "name_invalid"
  | "name_taken"
  | "name_reserved"
  | "name_folder_exists"
  | "name_database_exists"
  | "name_leftover"
  | "hostname_invalid"
  | "hostname_in_use"
  | "hostname_self"
  | "hostname_duplicate"
  | "hostname_zone_missing"
  | "hostname_dns_conflict"
  | "port_invalid"
  | "port_out_of_range"
  | "port_in_use"
  | "port_panel";
export type SiteNoteCode = "dns_same_tunnel" | "dns_owned" | "dns_token_missing" | "dns_check_failed";

export type SiteIssue = {
  field: "name" | "hostname" | "port";
  hostname?: string;
  code: SiteIssueCode;
  params: JobParams;
};
export type SiteNote = { field: "hostname"; hostname: string; code: SiteNoteCode; params: JobParams };
export type SiteCheckResult = { ok: boolean; issues: SiteIssue[]; notes: SiteNote[] };

export type SiteCreateRequest = {
  name: string;
  hostname: string;
  /** Extra domains added in the same job (one cloudflared restart). Max 4. */
  extraHostnames?: string[];
  port?: number;
  database: boolean;
  env?: Record<string, string>;
};

export type SiteEnvUpdate = { set: Record<string, string>; unset: string[]; restart: boolean };
export type SiteEnvSaved = { envKeys: string[]; restartPending: boolean };
export type SiteSettingsUpdate = { health?: Partial<SiteHealthConfig> };
/** POST /sites/:name/hostnames body: 1–5 domains, one job, one cloudflared restart. */
export type HostnamesAddRequest = { hostnames: string[] };

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
  | "stage"
  | "detect"
  | "chmod"
  | "swap"
  | "run_script"
  | "apps_entry"
  | "app_restart"
  | "health";

/** Full literal union in the implementation; values listed in PLAN 03 §3.4. */
export type JobOutcomeCode = string;
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
  /** Rows written before migration 0007 only. */
  legacyLabel?: string;
};

export type JobError = { code: JobOutcomeCode; params: JobParams; detail: string | null };
export type JobNextAction = "recover" | "rollback" | "app_log" | "open_site" | "first_deploy" | "redeploy";

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
  /** What POST /jobs/:id/recover will do; null = not recoverable (or already resolved). */
  recoverMode: "cleanup" | "retry" | null;
  resolvedBy: string | null;
  /** job.cleanup only. */
  cleans: string | null;
  /** pm2 app whose stderr the failure box shows (null = none). */
  appLogApp: string | null;
};

export type IntegrationCheckKey =
  | "sites_dir"
  | "apps_json"
  | "ecosystem_file"
  | "ecosystem_loads"
  | "ecosystem_spreads_apps_json"
  | "snippet_current"
  | "apps_entries_runnable"
  | "pm2_runtime"
  | "pm2_auto_exit"
  | "pm2_guard"
  | "tunnel"
  | "cloudflare_token";
export type IntegrationCheck = {
  key: IntegrationCheckKey;
  state: "ok" | "warning" | "error";
  params: JobParams;
  detail: string | null;
};
export type Integration = {
  /** sites_dir, apps_json, ecosystem_loads, ecosystem_spreads_apps_json, snippet_current, pm2_runtime, tunnel ok. */
  ready: boolean;
  checks: IntegrationCheck[];
  snippet: string;
  ecosystemPath: string;
  appsJsonPath: string;
  appNames: string[];
  checkedAt: string;
};
```

### 3.2 `src/shared/deploy.types.ts` (diganti)

```ts
export const DEPLOY_CHUNK_SIZE = 8 * 1024 * 1024;
export const DEPLOY_MAX_BYTES = 300 * 1000 * 1000;
/** Header carrying the lowercase hex sha256 of a chunk body. */
export const CHUNK_SHA_HEADER = "X-Chunk-Sha256";

/** POST /sites/:name/uploads (→ 201 UploadState). Replaces that site's previous unfinished upload. */
export type UploadStartRequest = { sizeBytes: number; fileName: string };

/** 201 of POST uploads, GET /uploads/:id, GET /sites/:name/uploads/active (200 null when none). */
export type UploadState = {
  uploadId: string;
  site: string;
  fileName: string;
  sizeBytes: number;
  chunkSize: number;
  chunks: number;
  received: { index: number; sha256: string }[];
  runtime: "native" | "grun" | null;
  expiresAt: string;
};

export type ChunkReceived = { received: number[]; runtime: "native" | "grun" | null };

export type DeployStatus = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";
export type DeployKind = "deploy" | "rollback";

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
  /** This row's file is the live `app` now (stat match). At most one per site. */
  active: boolean;
};
```

`src/shared/env.codec.ts` (baru, `wkr-contracts-00`): `decodeEnvValue(raw: string): string` (aturan Bun D21),
`encodeEnvLine(key, value): string` (pindahan `envLine`, `env.file.ts:27-33`, dengan aturan kutip ganda D21),
`envValueProblem(value): "multiline" | "quote" | "too_long" | null`, `findEnvLine(text, key): string | null`.

**Protokol unggahan (server):**

1. `POST uploads`: validasi; buang unggahan lama situs itu; preflight `freeBytes(dataDir fs) ≥ Σ unggahan aktif +
   sizeBytes + 200 MB` → 507 `no_space`; buat dir, `upload.bin` kosong (0600, `ftruncate(size)` tidak dipakai agar tidak
   mengalokasikan blok), `meta.json` `{v:1, site, fileName, sizeBytes, chunks, chunkSha:{}, state:"receiving",
   createdAt, touchedAt}`.
2. `PUT chunk i`: cek ukuran + header sha + sha body → `pwrite(fd, body, i × chunkSize)` → `fsync` → meta baru
   (tmp + rename). Potongan 0: `detectRuntime` dari buffer (bukan file) → `invalid_binary` / `runtime_mismatch`
   (unggahan dihapus).
3. `POST complete`: semua index ada → `state:"assembling"` → streaming baca `upload.bin`: sha per potongan
   dibandingkan dengan meta (beda → 400 `chunk_corrupt {index}`, index itu dihapus dari meta, state kembali
   `receiving`) + sha total → `assertIdle` → integrasi (deploy pertama dikelola) → ruang ≥ sizeBytes + 100 MB di fs
   situs bila beda fs → `jobs.start` (sha di `job.input` + baris `deploy`).
4. Boot: pindai `uploads/*`; buang dir tanpa meta, meta rusak, kedaluwarsa, `state:"assembling"`, dan file `.tmp`.
5. `site.delete` (langkah `validate`) membuang unggahan aktif situs itu.

### 3.3 Basis data — `drizzle/0007_sites_lifecycle.sql` (`wkr-db-01`)

```sql
-- Health check per site (D16). Existing rows keep the pre-0007 rule ("any status < 500" at /) with a longer timeout.
ALTER TABLE `site` ADD `health_path` text DEFAULT '/' NOT NULL;
--> statement-breakpoint
ALTER TABLE `site` ADD `health_expect` text DEFAULT 'lt500' NOT NULL;
--> statement-breakpoint
ALTER TABLE `site` ADD `health_timeout_sec` integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
-- Journal for recovering interrupted jobs (D11): non-secret request input (names, hostnames, port, sha256, flags).
ALTER TABLE `job` ADD `input` text;
--> statement-breakpoint
-- Id of the cleanup/retry job that resolved this one; null = still needs attention when interrupted/failed.
ALTER TABLE `job` ADD `resolved_by` text;
--> statement-breakpoint
-- Per-site change history (GET /jobs?target=) and "latest job of a site".
CREATE INDEX IF NOT EXISTS `job_target_started_idx` ON `job` (`target`,`started_at`);
--> statement-breakpoint
-- Original upload file name for the deploy history (sanitized, ≤ 255 chars).
ALTER TABLE `deploy` ADD `file_name` text;
--> statement-breakpoint
ALTER TABLE `deploy` ADD `finished_at` integer;
--> statement-breakpoint
-- Identity of the file this deploy put in place (D22): "Aktif" = stat(app) matches; null on rows before 0007.
ALTER TABLE `deploy` ADD `bin_ino` integer;
--> statement-breakpoint
ALTER TABLE `deploy` ADD `bin_mtime_ms` integer;
```

- SQLite tidak punya `ADD COLUMN IF NOT EXISTS`; satu kali eksekusi dijamin journal drizzle, dan `CREATE INDEX` memakai
  `IF NOT EXISTS` (B15). Kolom baru `NOT NULL` punya default, jadi aman untuk tabel berisi data.
- Baris `job.steps` lama dibaca `legacyStep()` (`job.legacy.ts`): `restart` → `tunnel_restart` (site._/hostname._) atau
  `app_restart` (deploy/rollback); `env` → `env_write`; `apps` → `apps_entry`/`apps_remove`; `assemble` → `stage`;
  `pm2` → `app_remove`; `database`/`folder` pada `site.delete` → `database_drop`/`folder_remove`; `code` null,
  `detail` = message lama, `legacyLabel` = label lama.
- Boot: `running` → `interrupted` (job dan deploy). Baris lama `failed` "interrupted by panel restart" tidak dikonversi.
- `job.input` per jenis (tanpa rahasia):
  `site.create {name, hostnames[], port, database}` · `site.delete {name, keepData, keepDatabase}` ·
  `hostname.add {site, hostnames[]}` · `hostname.remove {site, hostname}` ·
  `site.deploy {site, sha256, fromSha256, sizeBytes, fileName, runtime, firstDeploy}` ·
  `site.rollback {site, toSha256, fromSha256}` · `site.env {site, set: string[], unset: string[]}` (kunci saja) ·
  `site.restart {site}` · `job.cleanup {jobId}`. `fromSha256` = sha baris deploy aktif atau null bila tidak dikenal;
  `firstDeploy` = `app` tidak ada sebelum job.
- Tidak ada setting baru.

### 3.4 Langkah, kode hasil, kode error

| Jenis             | Langkah (`!` = irreversible)                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `site.create`     | validate → folder → database → env_write → ingress → dns → tunnel_restart → domain_probe                            |
| `site.delete`     | validate → apps_remove → ingress → tunnel_restart → dns (non-fatal) → app_remove! → database_drop! → folder_remove! |
| `hostname.add`    | validate → ingress → dns → tunnel_restart → domain_probe                                                            |
| `hostname.remove` | ingress → tunnel_restart → dns (non-fatal)                                                                          |
| `site.deploy`     | stage → detect → chmod → swap → run_script → apps_entry → app_restart → health                                      |
| `site.rollback`   | swap → run_script → app_restart → health                                                                            |
| `site.restart`    | app_restart → health                                                                                                |
| `site.env`        | env_write → app_restart → health                                                                                    |
| `job.cleanup`     | inspect → langkah perbaikan dari daftar yang sama (§4.11)                                                           |

`apps_remove` pada `site.delete` dipindah ke awal (setelah validate) agar entri hilang sebelum apa pun yang bisa
membuat binary hilang (D5; E4: runtime yang restart memuat lagi app dari ecosystem). `run_script` dan `apps_entry`
dilewati untuk situs adopsi. `apps_entry` = `apps_registered` (deploy pertama) / `apps_unchanged` / `apps_migrated`
(entri lama `script ≠ ./run` → ditulis ulang + delete+start sekali, D6).

Kode hasil (`JobOutcomeCode`, teks di `id.job.outcomes`, contoh §5.9):

| Langkah        | Sukses / dilewati                                                                                                                                                  | Gagal                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| validate       | `validated`                                                                                                                                                        | `invalid_site {issues}`, `busy_backup`                                                                  |
| inspect        | `inspect_found {count}`, `inspect_nothing`                                                                                                                         | `unexpected`                                                                                            |
| folder         | `folder_created {path}`                                                                                                                                            | `folder_failed`                                                                                         |
| database       | `database_created {name}`, `database_skipped`                                                                                                                      | `database_failed`                                                                                       |
| env_write      | `env_written {count}`, `env_updated {set, unset}`, `env_restored`                                                                                                  | `env_failed`                                                                                            |
| ingress        | `ingress_added {hostnames}`, `ingress_removed {hostnames}`, `ingress_unchanged`                                                                                    | `ingress_rejected`, `ingress_config_missing {path}`, `ingress_unsupported`                              |
| dns            | `dns_created {hostnames}`, `dns_owned_present`, `dns_same_tunnel {hostnames}`, `dns_deleted {hostnames}`, `dns_left {hostnames}`, `dns_no_token`, `dns_none_owned` | `dns_conflict {hostname}`, `dns_zone_missing {hostname}`, `dns_api_failed`, `dns_no_tunnel_id`          |
| tunnel_restart | `tunnel_restarted {seconds}`, `tunnel_unchanged`                                                                                                                   | `tunnel_not_running {seconds}`, `tunnel_service_missing`                                                |
| domain_probe   | `domain_reachable {hostname, status}`, `domain_not_yet {hostname, status}`                                                                                         | –                                                                                                       |
| apps_remove    | `apps_removed {name}`, `apps_absent`, `apps_adopted_skip`                                                                                                          | `apps_json_invalid`                                                                                     |
| app_remove     | `app_removed {name}`, `app_not_deployed`, `app_adopted_skip`                                                                                                       | `pm2_failed`, `pm2_not_running`                                                                         |
| database_drop  | `database_dropped {name}`, `database_kept`, `database_none`, `database_adopted_skip`                                                                               | `database_failed`, `busy_backup`                                                                        |
| folder_remove  | `folder_removed {path}`, `folder_kept`, `folder_gone`, `folder_adopted_skip`, `folder_not_empty {path, entries}`                                                   | `folder_failed`                                                                                         |
| stage          | `staged {sizeBytes}`                                                                                                                                               | `upload_missing`, `size_mismatch {got, expected}`, `sha_mismatch`, `folder_missing {path}`, `disk_full` |
| detect         | `runtime_native`, `runtime_grun`                                                                                                                                   | `invalid_binary`, `runtime_mismatch {expected, got}`                                                    |
| chmod          | `chmod_done`                                                                                                                                                       | `chmod_failed`                                                                                          |
| swap           | `swap_first`, `swap_kept_previous {linked}`, `swap_back`                                                                                                           | `swap_failed`                                                                                           |
| run_script     | `run_written {runtime}`, `run_unchanged`                                                                                                                           | `run_failed`                                                                                            |
| apps_entry     | `apps_registered`, `apps_unchanged`, `apps_migrated`, `apps_adopted_skip`                                                                                          | `apps_json_invalid`, `integration_not_ready`                                                            |
| app_restart    | `app_restarted {name}`, `app_started {name}`                                                                                                                       | `app_missing {name}`, `app_not_loaded {name}`, `pm2_failed`, `pm2_not_running`                          |
| health         | `healthy {status, ms, path, seconds}`                                                                                                                              | `health_timeout {seconds, last, path}`, `app_errored {name}`, `app_unstable {restarts}`, `app_no_pid`   |
| (semua)        | –                                                                                                                                                                  | `unexpected`, `interrupted`                                                                             |

`params.last`: `"refused"`, `"no_answer"`, atau kode HTTP. `params.linked`: `true` = hardlink, `false` = salinan.

Kode error API (`{ error, message, ...extra }`; UI memakai `error`):

| Kode                       | HTTP | Extra                                                                         | Endpoint                                             |
| -------------------------- | ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `busy`                     | 409  | `job: ActiveJob`                                                              | semua yang memulai perubahan, PUT env, adopt, verify |
| `busy_backup`              | 409  | –                                                                             | DELETE situs ber-database saat cadangan/pemulihan    |
| `integration_required`     | 409  | `failing: IntegrationCheckKey[]`                                              | POST /sites, complete (deploy pertama dikelola)      |
| `pm2_not_running`          | 409  | –                                                                             | restart, rollback, complete, adopt                   |
| `self_hostname`            | 409  | –                                                                             | adopt                                                |
| `app_not_found`            | 404  | –                                                                             | adopt                                                |
| `app_in_use`               | 409  | `site`                                                                        | adopt                                                |
| `adopt_blocked`            | 409  | `blockers: string[]`                                                          | adopt                                                |
| `hand_written`             | 409  | –                                                                             | DELETE hostnames                                     |
| `last_hostname`            | 400  | –                                                                             | DELETE hostnames                                     |
| `confirm_mismatch`         | 400  | –                                                                             | DELETE /sites/:name                                  |
| `env_locked`               | 400  | `keys`                                                                        | PUT env                                              |
| `invalid_env`              | 400  | `key`, `reason: "key" \| "multiline" \| "quote" \| "too_long"`                | PUT env, POST /sites                                 |
| `invalid_settings`         | 400  | `field`                                                                       | PATCH settings                                       |
| `no_folder`                | 409  | –                                                                             | PUT env, uploads                                     |
| `upload_expired`           | 404  | –                                                                             | `/uploads/:id*`                                      |
| `chunk_sha_mismatch`       | 400  | `index`                                                                       | PUT chunk                                            |
| `missing_chunk_sha`        | 400  | –                                                                             | PUT chunk                                            |
| `chunk_corrupt`            | 400  | `index`                                                                       | complete                                             |
| `invalid_binary`           | 400  | `reason: "not_elf" \| "not_64le" \| "not_aarch64" \| "interp" \| "truncated"` | PUT chunk 0, rollback                                |
| `runtime_mismatch`         | 409  | `expected`, `got`                                                             | PUT chunk 0, complete, rollback (adopsi)             |
| `no_space`                 | 507  | `needBytes`, `freeBytes`                                                      | POST uploads, complete                               |
| `incomplete`               | 400  | `missing`                                                                     | complete                                             |
| `no_previous`/`no_current` | 409  | –                                                                             | rollback                                             |
| `not_recoverable`          | 409  | `status`                                                                      | recover                                              |
| `already_resolved`         | 409  | `resolvedBy`                                                                  | recover                                              |

### 3.5 Endpoint (`/api/panel`, peran `admin`, mutasi lewat guard Origin + `X-Requested-With`)

| Metode | Path                                                | Request                  | Response                               | Error                                                                                                                                |
| ------ | --------------------------------------------------- | ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/sites`                                            | –                        | `Site[]` (bermasalah dulu, lalu nama)  | –                                                                                                                                    |
| GET    | `/sites/discovered`                                 | –                        | `Discovered`                           | 502 `system_error`, 503 `pm2_unavailable`                                                                                            |
| GET    | `/sites/suggest-port`                               | –                        | `{ port }`                             | 409 `no_free_port`                                                                                                                   |
| POST   | `/sites/check`                                      | `SiteCheckRequest`       | `SiteCheckResult`                      | –                                                                                                                                    |
| POST   | `/sites`                                            | `SiteCreateRequest`      | 202 `JobAccepted`                      | 400 `invalid_site`/`invalid_env`, 409 `busy`/`integration_required`                                                                  |
| POST   | `/sites/adopt`                                      | `SiteAdoptRequest`       | 201 `SiteDetail`                       | 400, 404 `app_not_found`, 409 `exists`/`self_hostname`/`app_in_use`/`adopt_blocked`/`busy`/`pm2_not_running`                         |
| GET    | `/sites/:name`                                      | –                        | `SiteDetail`                           | 404                                                                                                                                  |
| PATCH  | `/sites/:name/settings`                             | `SiteSettingsUpdate`     | `SiteDetail`                           | 400 `invalid_settings`, 409 `busy`                                                                                                   |
| GET    | `/sites/:name/health`                               | –                        | `HealthProbe`                          | 404                                                                                                                                  |
| POST   | `/sites/:name/restart`                              | –                        | 202 (`site.restart`)                   | 409 `busy`/`pm2_not_running`                                                                                                         |
| PUT    | `/sites/:name/env`                                  | `SiteEnvUpdate`          | 200 `SiteEnvSaved` / 202 `JobAccepted` | 400 `invalid_env`/`env_locked`, 409 `no_folder`/`busy`                                                                               |
| POST   | `/sites/:name/hostnames`                            | `HostnamesAddRequest`    | 202                                    | 400 `invalid_hostname`, 409 `busy`                                                                                                   |
| DELETE | `/sites/:name/hostnames/:hostname`                  | –                        | 202                                    | 400 `last_hostname`, 404, 409 `hand_written`/`busy`                                                                                  |
| DELETE | `/sites/:name?keepData&keepDatabase&confirm=<nama>` | –                        | 202                                    | 400 `confirm_mismatch`, 409 `busy`/`busy_backup`                                                                                     |
| GET    | `/jobs?page&pageSize&target&kind&status`            | –                        | `Page<Job>`                            | 400 `invalid_pagination`                                                                                                             |
| GET    | `/jobs/active`                                      | –                        | `{ job: ActiveJob \| null }`           | –                                                                                                                                    |
| GET    | `/jobs/:id`                                         | –                        | `Job`                                  | 404                                                                                                                                  |
| POST   | `/jobs/:id/recover`                                 | –                        | 202 (`job.cleanup` atau jenis asli)    | 409 `not_recoverable`/`already_resolved`/`busy`                                                                                      |
| GET    | `/integration`                                      | –                        | `Integration` (cache ≤ 30 dtk)         | –                                                                                                                                    |
| POST   | `/integration/verify`                               | –                        | `Integration`                          | 409 `busy`                                                                                                                           |
| POST   | `/sites/:name/uploads`                              | `UploadStartRequest`     | 201 `UploadState`                      | 400 `invalid_size`/`too_large`/`invalid_file_name`, 409 `no_folder`/`integration_required`, 507                                      |
| GET    | `/sites/:name/uploads/active`                       | –                        | 200 `UploadState \| null`              | 404 (situs tidak ada)                                                                                                                |
| GET    | `/uploads/:id`                                      | –                        | `UploadState`                          | 404 `upload_expired`                                                                                                                 |
| PUT    | `/uploads/:id/chunks/:index`                        | biner + `X-Chunk-Sha256` | `ChunkReceived`                        | 400 `invalid_index`/`invalid_chunk_size`/`chunk_sha_mismatch`/`missing_chunk_sha`/`invalid_binary`, 404, 409 `runtime_mismatch`, 507 |
| POST   | `/uploads/:id/complete`                             | –                        | 202                                    | 400 `incomplete`/`chunk_corrupt`, 404, 409 `busy`/`runtime_mismatch`/`integration_required`/`pm2_not_running`, 507                   |
| DELETE | `/uploads/:id`                                      | –                        | 204                                    | 404                                                                                                                                  |
| POST   | `/sites/:name/rollback`                             | –                        | 202                                    | 400 `invalid_binary`, 409 `no_previous`/`no_current`/`runtime_mismatch`/`busy`/`pm2_not_running`                                     |
| GET    | `/sites/:name/deploys?page&pageSize`                | –                        | `Page<Deploy>`                         | 404                                                                                                                                  |

Stderr untuk kotak "Kenapa gagal": `GET /api/panel/apps/:app/log?stream=err&lines=50` (PLAN/02, `LogChunk`).

Aturan:

- `/recover`: `retry` untuk `site.delete` (hanya bila langkah `validate` job asli `done`) dan `hostname.remove`,
  `interrupted`/`failed` dan belum `resolvedBy`. `cleanup` untuk jenis lain yang `interrupted`, dan jenis mana pun yang
  `failed` dengan undo tidak bersih. Pada `job.cleanup` yang terputus → cleanup baru atas job **asli**.
- Laju: limiter mutasi 60/mnt/sesi (`rate.limit.ts:6`); PUT chunk dikecualikan (`CHUNK_ROUTE`, `api.handler.ts:15-16,98`)
  dan regex itu tidak boleh berubah walau guard CSRF dipindah (B17). Retry `complete` tiap 5 dtk = 12/mnt.
- Body JSON maks 1 MiB (`api.handler.ts:8`).

### 3.6 Snippet ecosystem (wajib, lulus lab POCO E1e/E5)

`Integration.snippet`, teks persis:

```js
// Panel Termux: situs buatan panel tercatat di apps.json (dikelola panel, jangan diedit tangan).
// Aman bila apps.json belum ada, kosong, atau rusak; entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi.
const panelApps = (() => {
  try {
    const fs = require("fs");
    const path = require("path");
    const list = require("./apps.json");
    return Array.isArray(list)
      ? list.filter(
          (a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")),
        )
      : [];
  } catch (e) {
    console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
    return [];
  }
})();
```

lalu `...panelApps,` sebagai elemen terakhir `apps`.

Bukti:

| Kondisi `apps.json`                         | node v26 lokal (rev 0) | pm2-runtime 7.1.2 POCO        | Snippet lama `...require('./apps.json')` |
| ------------------------------------------- | ---------------------- | ----------------------------- | ---------------------------------------- |
| tidak ada / kosong / rusak / direktori      | app tangan saja        | 1 start, `hand` online (E5)   | melempar → runtime gagal                 |
| objek `{"name":"x"}`                        | app tangan saja        | 1 start, `hand` online (E5)   | melempar                                 |
| `[null, blog2]`                             | –                      | `hand`, `blog2` online (E5)   | –                                        |
| entri native dengan script hilang + `blog2` | –                      | 1 start, ghost dilewati (E1e) | runtime keluar, ±54 start/mnt (E1)       |
| entri `./run` dengan `run` ada              | dimuat                 | (pola sama E1e)               | dimuat                                   |

Filter hanya memeriksa `script`. Entri bentuk lain (grun dengan `./app` hilang) tidak difilter dan hanya
crash-loop dirinya (E1f). Entri panel selalu `./run`, jadi filter selalu efektif untuk entri panel.

**Probe** (`src/server/sites/ecosystem.probe.ts`): `runTermux("node", ["-e", PROBE, ecosystemPath], { cwd: sitesDir,
timeoutMs: 15_000, env: { PATH, HOME, PREFIX, PM2_HOME, LANG } })`. Env minimal, tanpa rahasia panel (C14). Probe
memuat ecosystem seperti pm2, mencatat `require` atas `apps.json`, dan mencetak satu baris JSON
`{ loadedAppsJson, names, envKeys: {<name>: string[]} }` (nama kunci `env` per app saja). Server menambahkan
`snippetCurrent` = teks ecosystem memuat `panelApps` **dan** `existsSync`. `detail` stderr melewati
`log.redact.ts` PLAN/02 dan dipotong 300 karakter. Mode fake: hasil kalengan dari sandbox, dengan flag untuk test.

| Check                         | ok bila                                                                                         | state bila tidak                              | `ready` |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `sites_dir`                   | folder `sites.dir` ada                                                                          | error                                         | ya      |
| `apps_json`                   | ada dan `parseApps` lolos                                                                       | error (`reason: missing/invalid`)             | ya      |
| `ecosystem_file`              | `ecosystem.config.js` ada (nama tetap, E7)                                                      | error                                         | –       |
| `ecosystem_loads`             | probe keluar 0 dan mencetak JSON                                                                | error (`reason: syntax/node_missing/timeout`) | ya      |
| `ecosystem_spreads_apps_json` | `loadedAppsJson` dan setiap nama `apps.json` yang binary-nya ada muncul di `names`              | error                                         | ya      |
| `snippet_current`             | teks memuat filter `existsSync`                                                                 | error "versi lama"                            | ya      |
| `apps_entries_runnable`       | setiap entri: `entryBinary(a)` ada (`./run` → `run` + `app`; grun → `args[0]`; lain → `script`) | warning (danger bila `snippet_current` error) | –       |
| `pm2_runtime`                 | layanan runit `pm2` `run` dan `rpc.sock` ada                                                    | error                                         | ya      |
| `pm2_auto_exit`               | `$SVDIR/pm2/run` memuat `--no-auto-exit`                                                        | warning                                       | –       |
| `pm2_guard`                   | ecosystem punya app selain milik panel (mis. `pm2-guard`)                                       | warning                                       | –       |
| `tunnel`                      | `config.yml` terbaca + UUID tunnel                                                              | error                                         | ya      |
| `cloudflare_token`            | token diisi                                                                                     | warning                                       | –       |

Untuk PLAN/05, server tetap mengekspor `integration().ecosystemIncludesAppsJson` (= `ecosystem_spreads_apps_json` ok).

### 3.7 Adapter (`wkr-adapters-01`, B14)

`Pm2Proc` (internal) += `cwd` (`pm_cwd`), `execPath` (`pm_exec_path`), `args`, `startedAtMs` (`pm_uptime`), `module`
(`pmx_module` **atau** nama = `pm2-guard`). `Pm2Adapter` dibangun dengan `isSupervisorUp()` dan melempar
`Pm2UnavailableError(reason)` di `list/control/remove/startFromEcosystem/readLog` bila layanan runit `pm2` ada dan
tidak `run`; tidak pernah memanggil CLI dalam keadaan itu. `NetAdapter.httpStatus(port, path = "/", timeoutMs = 5000,
host?)`. Bila Bun `fetch` mengabaikan header `Host` (diuji di kriteria), adapter memakai `node:http`. Fake: app
dengan cwd di sandbox, satu tanpa binary, satu glibc, satu modul, `pm2-guard`; opsi `supervisorDown`,
`onlineWithoutPid`, `runtimeExitsOnMissingNativeScript`, `exitsOnZeroAppsAtStart` (C18).

Kontrak balik dari PLAN 03 untuk PLAN/02: `jobs.isLocked({ kind: "service" | "app"; name }): boolean`,
`jobs.active(): ActiveJob | null`; runner memanggil `monitor.noteIntentionalRestart({ kind: "app", name })` di setiap
`app_restart` (termasuk revert) dan `{ kind: "service", name: "cloudflared" }` di `tunnel_restart`.

---

## 4. Flow

### 4.1 Persiapan integrasi

1. Panel start (termux): `ensureAppsJson()` (dipanggil `boot.ts`) menulis `[]\n` atomik (0644) bila `sites.dir` ada
   dan `apps.json` tidak ada.
2. `/panel/sites` → `GET /integration`. `ready` false → kartu **Persiapan** (§5.1).
3. Kartu: checklist, snippet + Salin, perintah `nano ~/sites/ecosystem.config.js` + Salin, **Periksa lagi** →
   `POST /integration/verify`.
4. Gagal:
   - `ecosystem_loads` error: "pm2 tidak bisa memuat ecosystem.config.js. Situs yang berjalan tidak terganggu sekarang,
     tetapi semua aplikasi tidak akan jalan setelah HP dinyalakan ulang. Perbaiki file, lalu periksa lagi." (danger)
   - `snippet_current` error: "Blok apps.json di ecosystem.config.js versi lama. Ganti dengan blok terbaru di bawah."
   - `pm2_runtime` error: "Layanan pm2 tidak berjalan. Jalankan `sv up pm2` di HP, lalu periksa lagi." Panel tidak
     menyalakannya sendiri.
   - `pm2_auto_exit`/`pm2_guard` warning: teks saran (§5.9).
5. `sites.dir` diubah (PLAN/05 dialog) → cache integrasi dibuang.
6. HP baru: template installer (§7.2) sudah memuat snippet + `pm2-guard` + `--no-auto-exit` → `ready` setelah tunnel
   diatur.

### 4.2 Adopsi

1. `GET /sites/discovered`: ingress tanpa situs + app pm2 tanpa situs, bukan modul/`pm2-guard`.
2. Per app: `cwd = realpath(pm_cwd)` harus di dalam `realpath(sitesDir) + "/"`; binary `<cwd>/app`; `runtime` =
   `detectRuntime` (error → `invalid_binary`); `scriptRuntime` = basename `realpath(execPath)` atau `execPath` ∈
   {`grun`, `glibc-runner`} → `grun`, `execPath === <cwd>/app` → `native`, lain → `other` (warning `script_other`);
   port: env pm2 → args → `.env PORT` (`findEnvLine` + `decodeEnvValue`, integer 1–65535).
3. Ingress: `self` (host `APP_BASE_URL` atau port = `PORT` panel), `match`, wildcard → blocker.
4. Dialog → `POST /sites/adopt {hostname, app, name}` → server mengulang semua cek → `site {managed: false, dir: cwd,
   runtime, port: ingress port, health default}` + `site_hostname`. Audit `site.adopt`.
5. Error: `app_not_found` (muat ulang daftar), `self_hostname`, `app_in_use`, `busy`, `pm2_not_running`.
6. Sukses → `/panel/sites/<nama>`, toast "Situs makuro-solusi diadopsi."
7. Kosong: tanpa ingress tak tercatat → bagian tidak tampil; semua app ber-blocker → "Tidak ada aplikasi pm2 yang
   cocok. Pastikan aplikasinya berjalan dari folder di ~/sites."

### 4.3 Jalur first-run di POCO

1. Upgrade panel. Saat start panel membuat `~/sites/apps.json` = `[]` (ecosystem belum menyebutnya, jadi tidak ada
   efek).
2. Persiapan: ✓ folder, ✓ `apps.json`, ✓ ecosystem dimuat (makuro-solusi, adminneo), ✗ belum memuat apps.json, ✗ snippet
   (belum ada), ✓ pm2 berjalan, ⚠ run script pm2 tanpa `--no-auto-exit` (POCO hari ini; aman karena ada app tangan),
   ✓ ada app selain panel, ✓ tunnel `poco`, ⚠ token (opsional).
3. Pemilik `nano ~/sites/ecosystem.config.js`: tempel snippet di atas `module.exports`, tambah `...panelApps,` di akhir
   `apps`:

   ```js
   module.exports = {
     apps: [
       site("makuro-solusi"),
       { name: "adminneo" /* …tetap… */ },
       ...panelApps,
     ],
   };
   ```

   Tidak perlu `sv restart pm2`.
4. **Periksa lagi** → `ready`.
5. Belum dikelola: `solusi.malikkurosaki.com · port 3005 → makuro-solusi` (dari `.env`); `panel.malikkurosaki.com ·
   Panel Termux (domain ini)`.
6. Adopsi → nama `makuro-solusi`, folder ✓, runtime glibc · lewat grun ✓, port 3005 dari `.env` ✓.
7. Detail: Cek kesehatan → 200. Editor env menandai kunci yang ditimpa `env` pm2 (makuro-solusi: tidak ada; PORT hanya
   di `.env`).
8. Deploy pertama makuro-solusi (build `bun-linux-arm64`): unggah yang bisa dilanjutkan → stage → detect (grun) → chmod
   → swap (`app.prev` = binary lama, hardlink) → run_script & apps_entry dilewati (adopsi) → `pm2 restart` → health
   (pid stabil + 2 probe + 5 dtk). Build Android → `runtime_mismatch` di potongan 0 + petunjuk mengubah `site()` di
   ecosystem.
9. Riwayat: 1 baris "Aktif"; rollback "dari app-v2 → versi tanpa catatan (89,2 MB, 25 Nov)" + daftar yang tidak ikut.
10. Situs kedua: wizard → `site.create` → CTA Unggah binary pertama → deploy pertama: swap → `run_written native` →
    `apps_registered` → `pm2 start ecosystem.config.js --only <nama>` (E2) → health.
11. Reboot: pm2-runtime memuat makuro-solusi, adminneo, dan situs kedua (snippet).

### 4.4 Wizard buat situs

1. `!ready` → kartu Persiapan ringkas di atas, **Buat situs** disabled + "Selesaikan persiapan pm2 dulu."
2. Langkah 1 **Alamat**: Nama, Domain, "Tambah domain lain" (maks 4), Port (prefill; port panel tidak pernah). Cek
   langsung debounce 400 ms; DNS per domain (zona, record, same-tunnel, token kosong, API gagal) tanpa cache tambahan.
   `name_leftover {jobId}` → tautan "Pulihkan".
3. Langkah 2 **Opsi**: database (penjelasan), variabel tambahan (editor §5.6 + Tempel `.env`).
4. Langkah 3 **Ringkasan**: rencana per langkah + "cloudflared dimulai ulang sekali. Semua domain di HP ini terputus
   3–10 dtk, termasuk solusi.malikkurosaki.com dan panel ini." (daftar dari ingress).
5. **Buat situs** → 202 → `/panel/jobs/:id`.
6. Sukses → "Situs blog siap. Unggah binary pertama untuk menjalankannya." CTA **Unggah binary pertama**.
7. `rolled_back` → "Semua langkah sudah dikembalikan." + **Coba lagi** (`/panel/sites/new?from=<jobId>`, isi dari
   `job.input`; variabel tambahan tidak ikut). `failed`/`interrupted` → **Bersihkan** (`/recover`).
8. 409 `busy` → banner "Perubahan _Buat situs · blog_ sedang berjalan · Lihat".

### 4.5 Halaman progres

1. Poll `GET /jobs/:id` dengan `usePoller` PLAN/01 (1 dtk) selama `running`.
2. Selama `tunnel_restart`/`domain_probe`: galat jaringan disembunyikan dengan catatan "Panel terputus sebentar karena
   cloudflared dimulai ulang. Halaman ini lanjut sendiri." (backoff milik poller PLAN/01, X19). Lebih dari 120 dtk →
   `ErrorState` + Coba lagi.
3. Langkah: ikon (sr-only), label, hasil singkat, durasi, Detail (log + detail + Salin).
4. Status akhir via `job.status-key.ts`: `succeeded`; `rolled_back` "Dikembalikan" (warning) + "aman, tidak ada yang
   perlu dibersihkan"; `failed` (danger) "butuh tindakan"; `interrupted` "Terputus" (warning) "panel dimulai ulang;
   periksa dan pulihkan".
5. Gagal di `app_restart`/`health` → kotak "Kenapa gagal" (§4.9).

### 4.6 Deploy

1. `#deploy`: `GET /sites/:name/uploads/active` → bila ada: "Unggahan belum selesai: app-v2 · 89,2 MB · 6 dari 11
   potongan · kedaluwarsa 21.40" + [Pilih file yang sama] [Batalkan unggahan].
2. Pilih file → ukuran (0 / > 300 MB ditolak) → resume bila `name + size` sama, else `POST uploads`.
3. Teks kartu: "Setelah unggahan selesai, aplikasi dimulai ulang dan situs terputus beberapa detik."
4. Potongan berurutan: `slice` → `crypto.subtle.digest` → lewati bila `received` punya sha sama → `PUT`.
5. Potongan 0 ditolak (`invalid_binary`/`runtime_mismatch`) → kartu menampilkan perbaikan.
6. Galat sementara → D15; habis → "Unggahan terhenti" + **Lanjutkan unggahan** (GET state, lanjut).
7. `upload_expired` → "Unggahan ini sudah tidak ada di server (lebih dari 1 jam tanpa potongan baru, atau admin lain
   memulai unggahan baru). Unggah ulang file-nya."
8. `complete` → `chunk_corrupt` → kirim ulang potongan itu otomatis lalu `complete` lagi; `busy` → "Menunggu perubahan
   lain selesai…" + retry tiap 5 dtk maks 10 mnt; `pm2_not_running` → teks Persiapan.
9. Sukses → halaman progres.
10. Tinggalkan halaman: fetch dibatalkan, unggahan server tetap; `localStorage` `panel.upload.<site>` (try/catch).
11. File berbeda saat resume → dialog "File ini berbeda dari unggahan sebelumnya. Mulai unggahan baru?".
12. **Batalkan unggahan** → `DELETE` → "Unggahan dibatalkan."
13. Restart panel di tengah unggahan → meta bertahan; retry menutupi ≤ 120 dtk.

### 4.7 Rollback

1. Aktif bila `binary.previous` dan `binary.live` ada.
2. Dialog confirm "Kembalikan blog ke versi sebelumnya?" + Dari → Ke + tabel ikut/tidak ikut (§5.4).
3. Situs adopsi: `detectRuntime(app.prev)` ≠ `scriptRuntime` → 409 `runtime_mismatch` sebelum dialog dikirim.
4. Job: swap (D23) → run_script → `pm2 restart` → health; gagal → swap balik + restart → `rolled_back`.

### 4.8 Cek kesehatan & mulai ulang

1. **Cek kesehatan**: `GET /sites/:name/health` → toast "Sehat: HTTP 200 dari /api/health dalam 85 ms" / "Tidak sehat:
   … menjawab 502" / "tidak menjawab".
2. **Mulai ulang** (confirm): job `site.restart`.
3. Algoritme `health`:
   1. Baseline segera setelah `app_restart`: `pid0`, `restarts0` (satu `jlist`).
   2. Tiap 1 dtk: `isListening(port)` → `httpStatus(port, path, 5 dtk, host)`; lolos sesuai `expect` → `streak++`, else
      0. Tiap 10 dtk: `jlist` → `errored` → `app_errored`; pid berubah/null → `app_no_pid`/`app_unstable`.
   3. `streak ≥ 2` → `jlist` → pid = angka > 0 (bila `pid0` null, `pid0` := pid ini) dan `restarts == restarts0`; lalu
      tunggu 5 dtk → `jlist` lagi, syarat sama + port masih menjawab → `healthy`.
   4. Deadline `timeoutSec` → `health_timeout {last}`.

### 4.9 Gagal: alasan + aksi

1. `Job.appLogApp` diisi saat `app_restart`/`health` gagal. Halaman progres memuat `GET /panel/apps/<app>/log?stream=err&lines=50`
   dan menampilkannya di `LogViewer` statis + "Disamarkan: n nilai rahasia" (bila redaktor melaporkan) + [Lihat log
aplikasi].
2. `next`: deploy `rolled_back` → `redeploy`, `app_log`; deploy `failed` → `recover`, `app_log`; restart gagal →
   `rollback` (bila ada `app.prev`), `app_log`.
3. Log tidak tersedia (app tidak ada di pm2) → "Log aplikasi tidak tersedia."

### 4.10 Variabel lingkungan

1. Daftar kunci (nilai tak pernah tampil). Lencana "Diatur panel" (dikelola, `lockedEnvKeys`) dan "Diatur oleh pm2"
   (adopsi, `pm2EnvKeys`: "Nilai di ecosystem.config.js menang; mengubahnya di sini tidak berpengaruh").
2. Aksi: Ganti nilai, Hapus, Tambah, **Tempel `.env`** (§5.6).
3. Footer: ringkasan + **Simpan** + **Simpan dan mulai ulang**.
4. **Simpan** → `PUT {restart:false}` → 200 → "Variabel lingkungan disimpan. Mulai ulang aplikasi agar berlaku." →
   banner `restartPending`.
5. **Simpan dan mulai ulang** → job `site.env`: `env_write` (salin `.env` → `.env.panel-prev` 0600, lalu tulis) →
   `app_restart` → `health`. Gagal → undo memulihkan `.env.panel-prev` + restart → `rolled_back` "Nilai lama dipulihkan
   dan aplikasi dimulai ulang." Selesai (apa pun) → `.env.panel-prev` dihapus. Terputus → cleanup memulihkan file itu
   bila ada.
6. Error: `invalid_env {key, reason}` di baris; `multiline` → "Nilai multi-baris belum didukung."; `quote` →
   "Nilai yang memuat `'` sekaligus `"` atau `\` tidak bisa disimpan."

### 4.11 Pulihkan perubahan terputus

1. Boot: `running` → `interrupted` (job + deploy); log warn.
2. Tampil di halaman progres, banner `/panel/sites` dan detail target, masalah Ringkasan `site_job_failed` (PLAN/02),
   catatan wizard `name_leftover`.
3. **Pulihkan** (teks tombol dari `recoverMode`: "Bersihkan" atau "Ulangi hapus situs"/"Ulangi hapus domain") →
   `POST /jobs/:id/recover`.
4. Cleanup per jenis (langkah dibangun setelah `inspect`, semua idempoten):

   | Jenis asli                     | Pemeriksaan & perbaikan                                                                                                                                                                                                                                                                                                                                                                                                                                               |
   | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `site.create`                  | Baris `site` ada → `inspect_nothing`. Else: `ingress` hapus rule `input.hostnames` yang ada dan bukan milik situs → `tunnel_restart` bila berubah → `dns` hapus record milik panel yang tidak dipakai situs (non-fatal) → `apps_remove` (entri sisa versi lama) → `database_drop` hanya bila `input.database` dan langkah `database` asli `running`/`done` dan tak dipakai situs → `folder_remove` hanya bila isi ⊆ {`data/` kosong, `.env`}, else `folder_not_empty` |
   | `hostname.add`                 | `ingress`/`tunnel_restart`/`dns` untuk `input.hostnames` yang tidak ada di `site_hostname`                                                                                                                                                                                                                                                                                                                                                                            |
   | `site.deploy`, `site.rollback` | Tabel keadaan di bawah → `run_script` (dikelola, `app` ada) → `apps_entry` (dikelola: entri dihapus **hanya** bila tidak ada `app` dan `input.firstDeploy`) → `app_restart` bila pm2 mengenal app atau `app` ada → `health`                                                                                                                                                                                                                                           |
   | `site.env`                     | `.env.panel-prev` ada → kembalikan ke `.env` (`env_restored`) → `app_restart` → `health`                                                                                                                                                                                                                                                                                                                                                                              |
   | `site.restart`                 | `app_restart` → `health`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | `job.cleanup`                  | Cleanup baru atas job asli                                                                                                                                                                                                                                                                                                                                                                                                                                            |

   **Tabel keadaan swap** (urutan D23; `=` berarti inode sama; `new` = `app.new`, `drop` = `.app.prev.drop`, `swp` =
   `.app.swap`). Baris pertama yang cocok menang:

   | #   | Keadaan                                                                          | Arti (titik crash)                                                      | Perbaikan                                                               |
   | --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
   | S1  | `app` tidak ada, `swp` ada                                                       | tidak terjadi dengan urutan D23 (pengaman untuk keadaan lama/eksternal) | `rename(swp, app)`                                                      |
   | S2  | `app` tidak ada, `prev` ada                                                      | keadaan lama/eksternal                                                  | `rename(prev, app)`; `drop` ada → `rename(drop, prev)`                  |
   | S3  | `app` tidak ada, tidak ada `prev`/`swp`                                          | deploy pertama sebelum rename `new→app`                                 | hapus `new`; selesai (entri dihapus bila `firstDeploy`)                 |
   | R1  | rollback, `swp` ada, `app = swp`                                                 | setelah link, sebelum `rename(prev, app)`                               | hapus `swp`                                                             |
   | R2  | rollback, `swp` ada, `app ≠ swp`, `prev` tidak ada                               | setelah `rename(prev, app)`                                             | `rename(swp, prev)` (rollback jadi lengkap), lalu perlakukan seperti R3 |
   | R3  | rollback, tanpa file sementara, sha(`app`) = `input.toSha256` ≠ `fromSha256`     | rollback selesai                                                        | jalankan pertukaran D23 sekali lagi → `app` = versi `fromSha256`        |
   | D1  | deploy, `drop` ada, `prev` tidak ada                                             | setelah `prev→drop`                                                     | `rename(drop, prev)`; hapus `new`                                       |
   | D2  | deploy, `drop` ada, `prev = app`                                                 | setelah link, sebelum `rename(new, app)`                                | hapus `prev` (link), `rename(drop, prev)`; hapus `new`                  |
   | D3  | deploy, `prev` ada, `prev ≠ app`, `new` tidak ada, sha(`app`) = `input.sha256`   | swap selesai                                                            | balik: `rename(prev, app)`; `drop` ada → `rename(drop, prev)`           |
   | D4  | deploy pertama, `app` ada, `prev` tidak ada, sha(`app`) = `input.sha256`         | swap selesai                                                            | hapus `app` (D27; entri dihapus karena `firstDeploy`)                   |
   | D5  | lainnya (tidak ada file sementara, sha(`app`) = `fromSha256` atau tidak dikenal) | swap belum mulai / sudah dibalik                                        | hapus `new`; tidak ada perubahan                                        |

   Rollback = pertukaran, jadi "kembali" = menjalankan pertukaran yang sama lagi setelah keadaan dirapikan menjadi
   `app`/`prev` lengkap (R2 → R3). Redeploy atau rollback dengan sha sama: baris "selesai" dan "belum mulai" identik
   isinya, jadi hasilnya aman apa pun yang dipilih. sha dihitung hanya saat inode tidak memutuskan (D3/D4/D5/R3), ±1 dtk
   per file.

5. Cleanup sukses → job asli `resolved_by`; gagal → `failed` + stderr bila ada + "Pulihkan lagi" + teks ssh dengan path.
6. Retry `site.delete`/`hostname.remove` dari `job.input` (validate asli `done`), diaudit.
7. Target sudah tidak ada → `inspect_nothing`, resolved. Dua admin → `busy`/`already_resolved`.

### 4.12 Shutdown vs perubahan terpanjang

| Perubahan               | Tipikal di POCO                                    | Terburuk dengan default                                   |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| site.create             | ±15 dtk                                            | validate 20 + tunnel 30 + probe 30 + reapply 30 ≈ 110 dtk |
| hostname.add/remove     | ±10 dtk                                            | ≈ 90 dtk                                                  |
| site.delete             | ±15 dtk + `rm -rf data/`                           | ≈ 80 dtk + ukuran `data/`                                 |
| site.deploy (89 MB)     | ±15 dtk (stage rename ~0, restart 2–5, health 2–8) | restart 20 + health 60 + stabil 5 + revert 20 ≈ 105 dtk   |
| site.deploy, health 300 | –                                                  | ≈ 345 dtk                                                 |

`SHUTDOWN_TIMEOUT_MS = 120_000`. Lewat itu → keluar; job `interrupted` saat boot. `sv restart panel` saat ada perubahan
bisa membuat panel tak terjangkau hingga 2 menit, dan deploy dengan cek kesehatan panjang bisa terputus. Keduanya
disebut jujur di pesan installer (§7.2) dan di README. PLAN/02 menolak restart `panel` dari UI bila
`jobs.active() || backup.running || backup.restoring`.

### 4.13 Domain

1. `#domains`: daftar, lencana DNS otomatis/manual, status HTTPS dari snapshot PLAN/02, Hapus.
2. **Tambah domain** → dialog: satu atau lebih input (maks 5) + cek langsung (`scope:"hostname"`, DNS) + teks blip
   bernama → **Tambah domain** → satu job, satu restart.
3. **Hapus domain** (confirm): akibat + blip bernama. Domain terakhir disabled; domain tulisan tangan situs adopsi
   disabled + "Rute ini ditulis manual di config.yml. Hapus lewat ssh bila perlu."
4. `ensureTunnelCname`: CNAME tak dimiliki yang menunjuk `<tunnel>.cfargotunnel.com` → `dns_same_tunnel`, `managed:false`.
5. Hapus: `ingress → tunnel_restart → dns`; DNS gagal → `dns_left` (selesai, warning, tautan dasbor). Tidak ada
   restart kedua.

### 4.14 Hapus situs

1. Menu ⋯ → **Hapus situs** → `ConfirmAction tier="typed"` (dikelola) / `"confirm"` (adopsi).
2. Isi: domain yang berhenti, folder `~/sites/blog` (+ `data/`), database + role, app pm2, teks blip bernama, info
   cadangan (`lastGoodItem` PLAN/04: "Cadangan terakhir database blog: 26 Nov 2026, 03.00" / "belum pernah
   dicadangkan" + tautan Cadangkan sekarang).
3. Checkbox default: "Simpan database" dicentang bila database belum pernah dicadangkan atau cadangan > 24 jam; "Simpan
   folder dan file situs" dicentang bila `data/` tidak kosong dan tidak ada cadangan folder situs < 24 jam. Teks
   menjelaskan alasan centang otomatis.
4. "Ketik `blog` untuk konfirmasi"; tombol **Hapus situs blog**.
5. `DELETE …&confirm=blog` → job `site.delete` (entri `apps.json` lebih dulu, D5).

### 4.15 Izin, kosong, konkurensi

- Peran `user` → SessionGate (403 → `/login`, B20); API 403.
- Kosong + `ready` → `EmptyState` "Belum ada situs. Buat situs pertama untuk menghubungkan domain ke aplikasi di HP ini."
  [Buat situs] (+ "atau adopsi situs yang sudah berjalan di bawah").
- 409 `busy{job}` → banner + tombol disabled sampai `GET /jobs/active` kosong (poll 5 dtk saat banner tampil).
- pm2 tidak tersedia → `appStatus` "unknown" + catatan "Status aplikasi tidak bisa dibaca dari pm2."; aksi yang butuh
  pm2 disabled dengan alasan.
- Beranda super_admin = Ringkasan (A11); banner perubahan terputus juga muncul di Ringkasan lewat masalah
  `site_job_failed`.

---

## 5. Spesifikasi UI per halaman

Komponen PLAN/01: `PageHeader` (judul, meta, status, actions, lengket), `DataTable` (`actions` per baris + list < md),
`StatusBadge` dengan `StatusKey` kanonik (mapping di `job.status-key.ts` / `deploy.status-key.ts`), `EmptyState`,
`ErrorState`, `QueryView`, skeleton, `Section`, `KeyValue`, `InlineCode`, `CopyButton`, `RelativeTime`,
`ConfirmAction` (`tier: "confirm" | "typed"`), `LogViewer` (statis, `LogLine[]`), bar aksi lengket bawah HP, toaster
tunggal. Primitive `ui/*`. Tanpa kelas warna mentah. Target sentuh ≥ 44 px di < md.

### 5.1 `/panel/sites`

- `PageHeader` "Situs" + meta diperbarui + **Buat situs** (disabled + alasan bila `!ready`) + "Riwayat perubahan".
- Banner perubahan berjalan/terputus.
- **Kartu Persiapan** (`site.setup.tsx`) bila `!ready` atau ada warning pm2: checklist (§3.6), snippet + Salin, langkah
  "1. Buka `ecosystem.config.js`: `nano ~/sites/ecosystem.config.js` [Salin] · 2. Tempel blok ini di atas
  `module.exports` · 3. Tambahkan `...panelApps,` di akhir daftar `apps` · 4. Simpan, lalu periksa lagi.",
  **Periksa lagi**. Peringatan: "Jangan menulis `...require('./apps.json')` tanpa blok ini: bila file itu rusak atau
  binary situs hilang, semua aplikasi tidak akan jalan setelah HP dinyalakan ulang." Saat siap: satu baris sukses
  "pm2 siap: 3 aplikasi terbaca, termasuk dari apps.json".
- **Daftar**: `DataTable` Nama (+ "Diadopsi"), Status, Domain utama (+n), Deploy terakhir, Port, aksi ⋯ (Buka ↗, Deploy,
  Mulai ulang, Log aplikasi). Bermasalah dulu. HP: list 2 baris.
- **Belum dikelola** (`site.discovered.tsx`): baris hostname · port → app; **Adopsi**; baris `self` tanpa tombol.
- States: skeleton; error list → `ErrorState`; pm2 tidak tersedia → status "Tidak diketahui".
- a11y: checklist `<ul>` dengan teks status; hasil Periksa lagi `aria-live="polite"`.

### 5.2 Dialog Adopsi

`Dialog` / `Sheet` bawah (HP). Select app (opsi ber-blocker disabled + alasan), Nama situs, `KeyValue` Folder,
Runtime ("glibc · dijalankan lewat grun"), Port ("3005 · dari `.env`"), peringatan non-blokir. "Panel hanya mencatat
situs ini. File, aplikasi pm2, dan domainnya tidak diubah sampai kamu deploy."

### 5.3 Wizard

`PageHeader` "Buat situs baru" + "Langkah 1 dari 3: Alamat" (`aria-current="step"`). Field dengan `aria-describedby` +
`aria-invalid`. Status cek per field. "Tambah domain lain" (maks 4). HP: Kembali/Lanjut di bar lengket. Ringkasan
rencana + teks blip bernama. Hasil: CTA **Unggah binary pertama**.

### 5.4 `/panel/sites/:name`

- Header: nama, `StatusBadge`, meta (domain ↗, "Deploy terakhir 3 mnt lalu oleh Malik"), **Deploy** (utama),
  **Mulai ulang** (confirm), ⋯ Cek kesehatan, Log aplikasi, Riwayat perubahan situs, Hapus situs.
- Jangkar: Ringkasan · Deploy · Domain · Variabel lingkungan · Pengaturan (chip lengket di HP).
- Banner: berjalan, terputus (Pulihkan), `restartPending` (Mulai ulang), `deployBlocker` (integrasi / pm2 tidak
  berjalan / folder tidak ada).
- `#ringkasan`: `KeyValue` Aplikasi pm2, Port, Runtime ("Android native"/"glibc lewat grun"), Database, Folder,
  Dikelola, Dibuat.
- `#deploy`: **Versi berjalan** (sha12 · nama file · ukuran · runtime · waktu · oleh; "Versi tanpa catatan" bila tidak
  cocok), kartu unggah, **Kembalikan versi sebelumnya**, **Riwayat deploy** (`DataTable` Waktu, Jenis, Versi, Ukuran,
  Runtime, Oleh, Durasi, Status + lencana "Aktif", aksi Lihat perubahan; paginasi 10; kosong "Belum ada deploy. Unggah
  binary pertama untuk menjalankan situs ini.").
- **Dialog rollback** (confirm): "Dari: `3f9a2c1b7e0d` · app-v2 · 26 Nov 22.40 · Malik" → "Ke: `a17c…` · app-v1 · 25 Nov
  19.02" (atau "versi tanpa catatan · 89,2 MB · diubah 25 Nov"). Ikut dikembalikan: binary aplikasi; cara menjalankannya
  (native/grun) untuk situs buatan panel. Tidak ikut: variabel lingkungan (`.env`), isi dan struktur database, file di
  `data/`, domain. Catatan: "Bila versi baru sudah mengubah struktur database, versi lama bisa gagal berjalan. Situs
  terputus beberapa detik." Tombol **Kembalikan versi sebelumnya**.
- `#domains`, `#env`, `#settings` (Path, Status yang diharapkan: Select "Apa pun di bawah 500" / "2xx atau 3xx", Batas
  waktu 10–300 dtk, **Simpan**; danger zone **Hapus situs**).
- States: skeleton; 404 → `ErrorState` + Ke daftar situs.

### 5.5 `/panel/jobs` dan `/panel/jobs/:id`

- Daftar: `PageHeader` "Riwayat perubahan" (+ "· blog"), filter Situs/Status, `DataTable` Perubahan, Status, Oleh, Mulai,
  Durasi, Lihat. Kosong: `jobs.empty`; dengan filter: "Tidak ada perubahan yang cocok dengan filter."
- Progres: `PageHeader` "Deploy · blog" + status + meta. Stepper vertikal (ikon sr-only, label, hasil, durasi, Detail
  `aria-expanded`). Satu region `aria-live`: "Langkah 4 dari 8: Menukar binary… selesai". Progress bar tone info.
- Panel akhir per status (§4.5) + kotak "Kenapa gagal" + tombol dari `next`.
- HP: durasi di bawah label; log di `Sheet` layar penuh.

### 5.6 Editor variabel lingkungan & Tempel `.env`

- Tabel kunci: Nama, lencana ("Diatur panel", "Diatur oleh pm2", "akan diganti", "baru", "akan dihapus"), aksi. Input
  `type=password` + Tampilkan (`aria-pressed`).
- **Tempel `.env`**: `textarea` mono (`autocomplete=off`, `spellcheck=false`), parser `env.paste.ts` memakai
  `decodeEnvValue` (D21) → pratinjau: Nama, Aksi (Baru/Ganti nilai), Nilai ("•••• (24 karakter)"), Masalah (kunci tidak
  valid, terkunci, diatur pm2, duplikat → baris terakhir menang, multi-baris, `$` tanpa `\`: "Bun membaca `$NAMA`
  sebagai variabel. Panel menyimpan nilainya apa adanya, jadi aplikasimu akan melihat `$` secara literal."). **Terapkan
  ke daftar**. "Nilai tidak dikirim sampai kamu menekan Simpan. Setelah disimpan, nilai tidak bisa dilihat lagi."
- Footer lengket: ringkasan + **Simpan** + **Simpan dan mulai ulang**.

### 5.7 Konfirmasi

| Aksi                                                     | Bentuk                                | Tombol                       |
| -------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Cek kesehatan, Periksa lagi, Batalkan unggahan, Pulihkan | `Button` biasa                        | –                            |
| Mulai ulang aplikasi situs                               | `confirm`                             | Mulai ulang                  |
| Kembalikan versi sebelumnya                              | `confirm`                             | Kembalikan versi sebelumnya  |
| Tambah / hapus domain                                    | tambah: dialog form; hapus: `confirm` | Tambah domain / Hapus domain |
| Simpan dan mulai ulang                                   | `Button` biasa (eksplisit)            | –                            |
| Hapus situs dikelola                                     | `typed`                               | Hapus situs blog             |
| Hapus situs adopsi                                       | `confirm`                             | Hapus situs                  |
| Ulangi hapus situs (Pulihkan mode retry)                 | `confirm`                             | Ulangi hapus situs           |

### 5.8 File i18n

- `id.site.ts` (list, persiapan, adopsi, wizard): `setup.checks.<IntegrationCheckKey>.{ok,warning,error}`, `issues.<SiteIssueCode>`, `notes.<SiteNoteCode>`, `plan.<JobStepKey>`, `adopt.blockers.<code>`, `adopt.warnings.<code>`, `blip(hosts)`.
- `id.site-detail.ts` (baru): header, jangkar, banner, info, domain, env (+ paste), pengaturan, hapus.
- `id.job.ts` (baru): `kinds`, `steps`, `outcomes(params)`, `next`, `recover.<mode>`, `appLog`, `blip`. Label status
  dari `id.status.ts` PLAN/01 (bukan di sini).
- `id.deploy.ts`: unggah (+ resume, paused, expired, retrying), `errorCodes`, rollback (carries/notCarried), history.
- Semua `satisfies Record<Union, …>`. File baru digabung ke `id.ts` oleh shell (X17), tidak oleh worker halaman PLAN 03.

### 5.9 Contoh teks

| Kunci                                            | Teks                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `steps.tunnel_restart` / `app_restart`           | Mulai ulang cloudflared / Mulai ulang aplikasi                                                                                     |
| `steps.stage` / `detect` / `swap` / `run_script` | Menyiapkan binary / Mengenali runtime / Menukar binary / Menulis skrip jalan                                                       |
| `steps.apps_entry` / `health`                    | Mendaftarkan aplikasi di pm2 / Cek kesehatan                                                                                       |
| `outcomes.healthy`                               | `HTTP {status} dari {path} dalam {ms} ms, stabil.`                                                                                 |
| `outcomes.health_timeout`                        | `Aplikasi tidak sehat setelah {seconds} dtk ({last}). Lihat log aplikasi di bawah.`                                                |
| `outcomes.app_unstable`                          | `Aplikasi sempat menjawab, lalu dimulai ulang {restarts}× oleh pm2. Biasanya karena crash saat start.`                             |
| `outcomes.app_no_pid`                            | `pm2 melaporkan aplikasi berjalan, tetapi tidak ada prosesnya. Biasanya binary tidak bisa dijalankan.`                             |
| `outcomes.pm2_not_running`                       | `Layanan pm2 tidak berjalan. Jalankan sv up pm2 di HP, lalu coba lagi.`                                                            |
| `outcomes.dns_left`                              | `Record DNS {hostnames} tidak bisa dihapus dan dibiarkan. Hapus di dasbor Cloudflare bila tidak dipakai.`                          |
| `outcomes.dns_conflict`                          | `Sudah ada record DNS untuk {hostname} yang tidak dibuat panel. Hapus atau ubah di dasbor Cloudflare, lalu coba lagi.`             |
| `outcomes.runtime_mismatch`                      | `Binary ini untuk {got}, tetapi pm2 menjalankan situs ini sebagai {expected}.`                                                     |
| `outcomes.folder_not_empty`                      | `Folder {path} dibiarkan karena berisi file lain. Hapus sendiri bila tidak dipakai.`                                               |
| `outcomes.env_restored`                          | `Nilai variabel lingkungan sebelumnya dipulihkan.`                                                                                 |
| `recover.cleanup` / `recover.retry`              | Bersihkan / Ulangi                                                                                                                 |
| `blip`                                           | `cloudflared dimulai ulang sekali. Semua domain di HP ini terputus 3–10 dtk, termasuk {hosts}.`                                    |
| `errorCodes.busy`                                | Ada perubahan lain yang sedang berjalan: {kind} · {target}. Tunggu sampai selesai, lalu coba lagi.                                 |
| `errorCodes.integration_required`                | pm2 belum siap menjalankan situs buatan panel. Selesaikan persiapan di halaman Situs.                                              |
| `errorCodes.no_space`                            | Penyimpanan HP tidak cukup: butuh {need}, tersisa {free}. Kosongkan ruang, lalu coba lagi.                                         |
| `errorCodes.busy_backup`                         | Cadangan sedang berjalan. Tunggu sampai selesai, lalu hapus situs ini.                                                             |
| `upload.paused`                                  | Unggahan terhenti karena koneksi terputus. Potongan yang sudah terkirim aman.                                                      |
| `upload.retrying`                                | Koneksi terputus. Mencoba lagi dalam {sec} dtk (percobaan {n} dari 8)…                                                             |
| `setup.checks.pm2_guard.warning`                 | Semua aplikasi pm2 di HP ini dibuat panel. Tambahkan aplikasi penjaga `pm2-guard` (lihat README) agar pm2 tetap hidup tanpa situs. |
| `setup.checks.pm2_auto_exit.warning`             | Run script pm2 tidak memakai `--no-auto-exit`. pm2 berhenti bila aplikasi terakhir dihapus.                                        |
| `setup.checks.snippet_current.error`             | Blok apps.json di ecosystem.config.js versi lama. Ganti dengan blok terbaru di bawah.                                              |
| `adopt.blockers.outside_sites_dir`               | Aplikasi ini berjalan dari folder di luar ~/sites, jadi tidak bisa dikelola panel.                                                 |
| `adopt.warnings.script_other`                    | Panel tidak tahu cara pm2 menjalankan binary ini. Cek kesehatan setelah deploy akan menunjukkan hasilnya.                          |

Toast bentuk lampau.

---

## 6. Kriteria penerimaan

**Unit/integration (bun test, `tests/site.harness.ts` fake + temp dir):**

- [ ] `tests/ecosystem.snippet.test.ts` (`node`, skip bila tidak ada): snippet §3.6 untuk tidak ada, kosong, rusak,
      direktori, objek, `[null, blog]`, entri native hilang, entri `./run` tanpa `run`, entri grun dengan `./app` hilang
      (tidak difilter) → nama app tangan selalu ada; filter benar untuk `script` absolut (`path.resolve`).
- [ ] Probe: env proses anak hanya `{PATH, HOME, PREFIX, PM2_HOME, LANG}` (fake ecosystem mencetak `Object.keys(process.env)`);
      `envKeys` tanpa nilai; `snippetCurrent` benar.
- [ ] `apps.json` dibuat saat start bila hilang, tidak ditimpa bila ada; `GET /integration` tanpa tulis.
- [ ] `ready` false bila `pm2_runtime`/`snippet_current` error; `apps_entries_runnable` hanya warning saat snippet terbaru.
- [ ] Fake `supervisorDown`: semua langkah pm2 → `pm2_not_running`, tidak ada panggilan CLI pm2 (spy).
- [ ] Deploy pertama menulis `run` (isi sesuai ELF) lalu entri `./run` tanpa `env`; deploy kedua tidak mengubah entri dan
      memakai `pm2 restart`; entri lama `script: ./app` → `apps_migrated` sekali.
- [ ] `site.delete`: `apps_remove` sebelum `app_remove`/`folder_remove`; DNS gagal → `dns_left`, job `succeeded`, tanpa
      restart cloudflared kedua.
- [ ] `hostname.add` dengan 3 domain → satu `tunnel_restart`.
- [ ] Adopsi: cwd luar, tanpa `app`, host panel, modul, `pm2-guard` (tak tampil); `glibc-runner` → grun; `other` → warning;
      `.env` berisi rahasia → hanya port yang keluar (assert return + buffer log).
- [ ] `suggestPort` tidak pernah `PORT` panel; nama situs `pm2-guard` → `name_reserved`.
- [ ] Runner: kode dari union; `save()` melempar → status akhir tetap tersedia; boot `running` → `interrupted`;
      `noteIntentionalRestart` dipanggil di `app_restart`/`tunnel_restart` (spy).
- [ ] **Swap crash**: inject throw di setiap titik antar operasi D23 (deploy pertama, deploy berikut, rollback) → cleanup →
      `app` ada dan isinya = sebelum perubahan; entri hanya dihapus pada deploy pertama; cleanup kedua = `inspect_nothing`.
- [ ] Fallback `copyFile` bila `link` melempar `EPERM`/`EXDEV`.
- [ ] Cleanup create/hostname.add/env (dengan `.env.panel-prev`)/restart sesuai tabel; retry delete setelah DB dijatuhkan.
- [ ] `job.input` tanpa password/nilai env (scan semua job dalam test ber-database + env).
- [ ] Unggah: meta bertahan saat store dibuat ulang; meta ditulis setelah `fsync` (urutan via spy); boot membuang dir tanpa
      meta, `.tmp`, `assembling`, kedaluwarsa; header sha salah → 400; potongan 0 non-ELF → 400 + unggahan dihapus;
      adopsi grun + native → 409; preflight dengan dua unggahan aktif → 507; `complete` mendeteksi potongan rusak
      (byte dibalik di `upload.bin`) → `chunk_corrupt`; sha tersimpan di `job.input` dan `deploy` sebelum langkah pertama;
      hapus situs membuang unggahan.
- [ ] PUT chunk tidak terkena limiter (70 PUT/menit sukses).
- [ ] Health: lolos hanya dengan 2 probe + pid stabil + restarts tetap; `onlineWithoutPid` → `app_no_pid`; restarts naik di
      jendela 5 dtk → `app_unstable`; `expect:"2xx3xx"` dengan 404 → gagal; header `Host` diterima server uji; jumlah
      `jlist` per deploy sehat ≤ 4 + 1 per 10 dtk.
- [ ] Rollback adopsi: `app.prev` glibc + script native → 409 `runtime_mismatch`.
- [ ] Env: codec kasus A–J kritik terhadap `bun` nyata; `'` tanpa `"`/`\` tersimpan dengan kutip ganda; `restart:true` gagal →
      `.env` byte lama kembali dan `.env.panel-prev` hilang; `PORT` dikelola → `env_locked`; `pm2EnvKeys` situs adopsi.
- [ ] `restartPending` dari mtime vs `startedAtMs`.
- [ ] DNS same-tunnel → bukan konflik; `/sites/check` melaporkan konflik per domain.
- [ ] 409 `busy` membawa `job`; `isLocked` true untuk cloudflared/pm2/postgres/app target selama job; `database_drop` saat
      backup berjalan → `busy_backup`.
- [ ] `DELETE` tanpa `confirm` cocok → 400; retry delete ditolak bila `validate` asli tidak `done`.
- [ ] Migration 0007 di DB v0.2.x berisi data → default terisi; `legacyStep` membaca baris lama; `db.migrate.test.ts` lulus.
- [ ] Shutdown ≤ 120 dtk (timeout injeksi).
- [ ] `job.status-key.ts`/`deploy.status-key.ts` `satisfies Record<…, StatusKey>`; `rolled_back` → `rolled_back` (warning),
      `interrupted` → `interrupted` (warning), `running` → `processing`.
- [ ] i18n lengkap (compile) dan tidak ada string Inggris server yang dirender (snapshot `job.steps.tsx` dari fixture berkode).
- [ ] Web: rencana resume melewati potongan sha sama; jadwal retry total ≥ 120 dtk; parser tempel (export, kutip, komentar
      inline, duplikat, multi-baris, `$`, kunci terkunci/pm2).
- [ ] `bun run typecheck`, `bun run lint`, `bun test` hijau.

**UI-QA (mode fake, 390×844 dan 1440 px, terang + gelap):** kartu Persiapan (tiap check gagal satu per satu), Belum
dikelola + baris panel, list kosong/bermasalah; dialog Adopsi sebagai sheet di HP dengan fokus kembali; wizard dengan 2
domain + teks blip bernama, error terbaca pembaca layar, bar bawah tidak menutupi input saat keyboard; progres running /
succeeded (CTA unggah) / Dikembalikan (warning) / failed + stderr / Terputus + Pulihkan, blip simulasi tanpa error;
deploy putus → terhenti → Lanjutkan, reload → resume, file lain → dialog; rollback dari → ke; hapus situs typed dengan
checkbox default tercentang saat tanpa cadangan; env tempel 12 kunci termasuk `$` → pratinjau → Simpan → banner;
kontras token kedua tema; target ≥ 44 px.

**Di HP (POCO, izin pemilik):** E9 (hardlink), E10 (penjaga `sleep infinity`), E4b (modul logrotate) sebelum W2
dikunci; first-run §4.3 langkah 1–7; deploy makuro-solusi hanya pada jendela yang disetujui.

---

## 7. Rencana kerja

Selaras dengan jadwal integrasi (`PLAN/debate/00-integration-critique.md` §5) dan `PLAN/DECISIONS.md`. Tidak ada dua
worker pada satu file di gelombang yang sama.

### 7.1 Gelombang

**W0 (prasyarat, orkestrator + kontrak):** merge `main` (hotfix CSRF) ke branch (B17); pecah `index.ts` → `boot.ts` +
`http/spa.serve.ts` (B16); `wkr-contracts-00` menulis `src/shared/site.types.ts`, `deploy.types.ts`, `env.codec.ts`★,
dan `ApiError` status kanonik + `extra` (`src/server/routes/http.error.ts`). Lab POCO tambahan E9/E10/E4b
(`wkr-sites-lab-00`, izin pemilik; tidak memblokir W1).

**W1:**

| Worker                | File (eksklusif)                                                                                                                                                                     | Ukuran           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `wkr-db-01`           | `src/server/db/schema/*` (bagian PLAN 03: `site`, `job`, `deploy`), `drizzle/0007_sites_lifecycle.sql`, `drizzle/meta/*`, `drizzle/migrations.js`, `tests/db.migrate.test.ts`        | ±120 (bagian 03) |
| `wkr-adapters-01`     | `src/server/system/*` (bagian PLAN 03 §3.7), `tests/panel.parsers.test.ts`, test adapter                                                                                             | ±200 (bagian 03) |
| `wkr-sites-runner-01` | `src/server/sites/job.runner.ts`, `src/server/sites/job.legacy.ts`★, `src/server/shutdown.ts`, `tests/site.harness.ts`, `tests/job.runner.test.ts`★, `tests/server.shutdown.test.ts` | ±500             |

**W2:**

| Worker                 | File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Ukuran |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-sites-server-02`  | `src/server/sites/*` kecuali runner/legacy: `site.service.ts` (≤ 300 baris), `site.adopt.ts`★, `adopt.candidates.ts`★, `site.env.service.ts`★, `integration.service.ts`★, `ecosystem.probe.ts`★, `job.recovery.ts`★, `site.jobs.ts`, `site.steps.ts`, `site.checks.ts`, `env.file.ts`, `apps.file.ts`, `site.secrets.ts`★ (`siteSecretsFor`); `src/server/cloudflare/dns.provider.ts`; `src/server/routes/sites.routes.ts`; `tests/site.*.test.ts`, `tests/ecosystem.snippet.test.ts`★, `tests/cloudflare.dns.test.ts`, `tests/site.files.test.ts` | ±1.200 |
| `wkr-deploy-server-02` | `src/server/deploy/*`: `deploy.service.ts`, `deploy.steps.ts`, `swap.ts`★ (D23), `run.script.ts`★, `health.check.ts`★, `upload.store.ts`, `binary.identity.ts`★, `deploy.recovery.ts`★, `elf.runtime.ts` (deteksi dari buffer); `src/server/routes/deploy.routes.ts`; `tests/deploy.*.test.ts`                                                                                                                                                                                                                                                     | ±1.000 |

Antarmuka W2 (di spec): `job.recovery.ts` memanggil `deployRecoverySteps(ctx, job)`; `site.service.detail()` memanggil
`binaryInfo(site)`; `ensureAppsJson()` diekspor untuk `boot.ts` (wiring oleh worker boot W3).

**W3 (web; setelah komponen PLAN/01 W1/W2):**

| Worker                    | File                                                                                                                                                                                                                                                                                                          | Ukuran |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-sites-web-list-03`   | `src/web/site/{sites.page,site.setup★,site.discovered★,adopt.dialog,site.adopt,site-new.page,wizard.target,wizard.options,wizard.summary,form.field,site.api,site.check,site.routes★}.tsx/ts` (hapus `site.card.tsx`, `integration.banner.tsx`), `src/web/i18n/id.site.ts`, `tests/web.site.test.ts`          | ±900   |
| `wkr-sites-web-detail-03` | `src/web/site/{site-detail.page,site.header★,site.anchors★,site.hostnames,site.env-editor,env.editor,env.rows,env.paste★,site.settings★,site.delete}.tsx/ts`, `src/web/i18n/id.site-detail.ts`★, `tests/web.site-detail.test.ts`★                                                                             | ±850   |
| `wkr-sites-web-deploy-03` | `src/web/deploy/{deploy.card,deploy.upload,upload.resume★,deploy.api,deploy.state,deploy.history,deploy.rollback★,deploy.status-key★}.tsx/ts`, `src/web/site/{job.page,job.steps,job.state,jobs.page,job.failure★,job.status-key★}.tsx/ts`, `src/web/i18n/{id.deploy,id.job★}.ts`, `tests/web.deploy.test.ts` | ±950   |

`site.routes.tsx` = array route domain yang dirangkai shell (`app.routes.tsx`, PLAN/01). `id.ts` digabung shell (X17).

**W4:** UI-QA browser; dokumentasi satu worker (README "Integrasi pm2" dengan snippet baru, peringatan snippet lama,
`pm2-guard`, situs/deploy/pemulihan/rollback, risiko admin = pemilik HP; CHANGELOG).

Perkiraan PLAN 03 setelah revisi: ±5.600 baris termasuk test (C20 mengurangi ±600 tanpa mengurangi fitur).

### 7.2 Spec installer

**`server-termux`** (`/Users/bip/test/server-termux`, repo kita; worker terpisah, izin pemilik; dirilis sebelum v0.3.0
panel diumumkan):

1. `files/sites/ecosystem.config.js` diganti template ini (`put_once`, tidak pernah menimpa milik pemilik):

   ```js
   // Daftar app yang dijalankan PM2 di HP ini. Tambah site('<nama>') untuk situs yang kamu tulis sendiri.
   // Situs buatan Panel Termux ada di apps.json dan dimuat otomatis oleh blok panelApps di bawah.
   const SITES = "/data/data/com.termux/files/home/sites";
   const PREFIX = "/data/data/com.termux/files/usr";

   // Binary Bun glibc dijalankan lewat grun; .env di folder situs dibaca binary saat start.
   const site = (name) => ({
     name,
     cwd: `${SITES}/${name}`,
     script: `${PREFIX}/bin/grun`,
     args: "./app",
     interpreter: "none",
     exp_backoff_restart_delay: 1000,
   });

   // <snippet §3.6 persis>

   // pm2-runtime keluar bila ecosystem tidak punya aplikasi saat start, juga dengan --no-auto-exit.
   // Penjaga ini (sleep, ±1 MB) menahannya hidup di HP yang belum punya situs. Jangan dihapus.
   const guard = { name: "pm2-guard", script: `${PREFIX}/bin/sleep`, args: "infinity", interpreter: "none", autorestart: true };

   module.exports = {
     apps: [
       guard,
       // site('blog'),
       ...panelApps,
     ],
   };
   ```

2. `files/sites/apps.json` = `[]`; `put_once` di blok `step pm2` (`install.sh:59-62`).
3. `files/sv/pm2/run`: tetap `--no-auto-exit`; tambah `export PM2_HOME=$HOME/.pm2` sebelum `exec`.
4. `files/home/sites/README.md`: bagian "Situs buatan panel" (`apps.json`, jangan hapus `pm2-guard`, jangan hapus `app`
   lewat ssh tanpa menghapus situs di panel).
5. `test/install.test.sh`: template memuat `panelApps`, `existsSync`, `pm2-guard`; `apps.json` tidak ditimpa; bila `node`
   ada: `require` template dengan `apps.json` hilang/rusak/berisi entri tanpa binary → nama tepat `pm2-guard`.
6. `CHANGELOG.md` `## [0.2.0]` Added. HP yang sudah berjalan (POCO) tidak tersentuh.

**`scripts/install-phone.sh`** (milik PLAN/05 `wkr-dist-01`):

1. `sv -w 130 restart panel` sekali (ganti loop `install-phone.sh:76-79`). Sebelum: "Memulai ulang panel. Bila ada
   perubahan situs yang sedang berjalan, panel menunggu sampai 2 menit." Sesudah: `sv status panel` harus `run:`; else
   exit 1 "Panel belum berjalan setelah 130 dtk. Lihat $PREFIX/var/log/sv/panel/current."
2. HP baru tanpa setup pm2 (`~/sites/ecosystem.config.js` dan `$SVDIR/pm2` sama-sama tidak ada): salin
   `deploy/pm2/{ecosystem.config.js,apps.json,run}` (salinan persis `server-termux` §1–3, sumber disebut di README) lalu
   `sv up pm2`. Bila salah satu ada: tidak menyentuh apa pun, cetak "pm2 sudah diatur; buka Situs → Persiapan di panel
   untuk memeriksa integrasi."
3. Tidak pernah memanggil CLI `pm2`.
4. `scripts/install-phone.test.sh`: dua cabang; template lulus uji `node` yang sama.

`deploy/pm2/*` ditulis `wkr-dist-01` dari teks §7.2 ini.

### 7.3 Dependensi lintas PLAN

| Kepada          | Yang dibutuhkan PLAN 03                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN/01         | `ConfirmAction` `confirm \| typed`; `PageHeader` status/actions/lengket; `DataTable` `actions` + list; `StatusKey` `processing`, `succeeded`, `failed`, `rolled_back` (warning, A10), `interrupted` (warning); `LogViewer` statis dengan `LogLine[]`; `usePoller` dengan backoff yang menahan error selama blip (X19); bar aksi lengket; shell menggabungkan `id.site-detail.ts`/`id.job.ts` ke `id.ts`; `app.routes.tsx` merangkai `site.routes.tsx`                                                                                                      |
| PLAN/02         | Adapter §3.7 (`wkr-adapters-01`), termasuk `pm2-guard` → `module`; `jobs.isLocked`/`jobs.active` dipakai kontrol; `monitor.noteIntentionalRestart`; aturan `site_job_failed` (job terbaru per target `interrupted`/`failed`, `resolvedBy` null; `site_crash_loop` tidak dipakai); snapshot `pm2Procs()`; endpoint log app (`LogChunk`) + `redactLines(lines, extraSecrets)` memakai `siteSecretsFor(app)`; abaikan baris `PM2 error: … getconf` dan `[pidusage]` (lab); tolak restart panel bila `jobs.active() \|\| backup.running \|\| backup.restoring` |
| PLAN/04         | Pengecualian cadangan: `*/app`, `*/app.prev`, `*/app.new`, `*/.app.prev.drop`, `*/.app.swap`, `*/run.panel-tmp`, `*/.env.panel-prev`, `<dataDir>/uploads/`; `lastGoodItem` untuk database dan folder situs; status `backup.running`/`backup.restoring` untuk `busy_backup`                                                                                                                                                                                                                                                                                 |
| PLAN/05         | `install-phone.sh` + `deploy/pm2/*` sesuai §7.2; item onboarding `apps_json` memakai `ecosystemIncludesAppsJson` dan menautkan ke kartu Persiapan; `dns.provider.ts` PLAN/05 setelah `wkr-sites-server-02`                                                                                                                                                                                                                                                                                                                                                 |
| `server-termux` | Perubahan §7.2 (repo terpisah, worker terpisah)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 8. Risiko, asumsi, pertanyaan terbuka

### 8.1 Hasil lab pm2 (POCO, pm2 7.1.2) dan penerapannya

Detail lengkap: `PLAN/debate/03-pm2-lab-results.md`. Pra-uji lokal (pm2 5.4.3) di rev 0 cocok dengan semua hasil POCO.

| Lab | Hasil                                                                                                        | Diterapkan di                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| E1  | Entri native dengan script hilang → semua app berhenti, runtime keluar, ±54 restart/mnt, flag tidak menolong | D2, D5, §3.6 (`snippet_current`, `apps_entries_runnable`) |
| E1e | Filter `existsSync` di snippet → entri dilewati, app lain online                                             | D2, §3.6                                                  |
| E1f | Entri grun dengan `./app` hilang → hanya app itu crash-loop                                                  | D6 (entri panel `./run`), §3.6                            |
| E2  | `start --only` dari CLI masuk daemon runtime; kembali setelah restart; tanpa duplikat                        | §4.3 langkah 10, D6                                       |
| E3  | `start --only` pada app lama: script lama dipakai; `online` dengan `pid=undefined`, port mati                | D6, D16                                                   |
| E4  | `--no-auto-exit` menahan "app terakhir dihapus"; ecosystem 0 app saat start tetap keluar                     | D31, §3.6 (`pm2_auto_exit`, `pm2_guard`), §7.2            |
| E5  | Snippet lulus 6 keadaan `apps.json`                                                                          | §3.6                                                      |
| E6  | Bun membaca `.env` hanya saat start                                                                          | D19                                                       |
| E6b | `env` entri pm2 mengalahkan `.env`                                                                           | D6 (entri tanpa `env`), D20 (`pm2EnvKeys`)                |
| E7  | File tanpa pola `*.config.js` dijalankan sebagai skrip                                                       | §8.3 (asumsi nama tetap)                                  |
| –   | `PM2 error: getconf …` / `[pidusage]` palsu                                                                  | §7.3 PLAN/02                                              |

Sisa (murah, gelombang 0, tidak memblokir W1):

| #   | Langkah (isolasi sama dengan lab POCO: `PM2_HOME` lab, folder di luar `~/sites`)                               | Bila hasil ≠ asumsi                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| E9  | `ln ~/pm2lab/a ~/pm2lab/b`, juga di folder di bawah `~/sites` uji; cek inode sama                              | `link` ditolak → fallback `copyFile` menjadi jalur utama (89 MB tulis per deploy); tidak ada perubahan desain       |
| E10 | app `pm2-guard` (`sleep infinity`) di ecosystem lab tanpa app lain: runtime tetap hidup 60 dtk, RSS, restart 0 | `sleep infinity` tidak didukung → `args: "2147483647"`; bila runtime tetap keluar → penjaga skrip node HTTP 1 baris |
| E4b | ecosystem 0 app + modul `pm2-logrotate` terpasang di lab                                                       | Hanya catatan; penjaga tetap dipakai (modul bisa dihapus)                                                           |

### 8.2 Risiko

- Uji end-to-end di POCO menyentuh produksi; hanya dengan izin per sesi.
- Probe mengeksekusi ecosystem pemilik (env minimal); efek samping file itu tanggung jawab pemilik (README).
- Redaksi stderr tidak sempurna untuk rahasia di luar `.env`; admin = pemilik (A1).
- Shutdown 120 dtk memperpanjang jeda upgrade saat ada perubahan.
- `(ino, mtimeMs)` palsu-cocok bila file diganti dengan inode dan mtime sama (praktis mustahil tanpa sengaja).
- `ingress.editor.ts` hanya memahami bentuk YAML tertentu → `ingress_unsupported`.
- Cleanup folder konservatif (`folder_not_empty`).
- Ukuran file: `site.service.ts` (285 baris) dipecah sebelum ditambah; `id.site.ts` dipecah.
- Template `server-termux` dan salinan `deploy/pm2/*` di repo panel bisa menyimpang; README menyebut sumbernya dan test
  kedua repo memakai uji `node` yang sama.

### 8.3 Asumsi

- pm2 7.1.2 di POCO; `PM2_HOME` = `~/.pm2` untuk runit dan panel.
- `node` di `$PREFIX/bin/node`.
- Header ELF di 8 MB pertama binary Bun.
- File ecosystem selalu bernama `ecosystem.config.js` di `sites.dir` (E7: nama lain dijalankan pm2 sebagai skrip).
- `uploads/` (di `~/panel/data`) dan `~/sites` biasanya di filesystem yang sama (`$HOME`); bila tidak, `stage` menyalin.
- Hotfix CSRF sudah di-merge sebelum W1 (B17).

### 8.4 Pertanyaan terbuka

1. **Q1** — makuro-solusi tetap glibc atau pindah ke Android native (pemilik mengubah `site()` dan me-restart pm2
   sendiri)? Rekomendasi: pindah setelah deploy glibc pertama lewat panel lancar.
2. **Q2** — Cleanup deploy terputus selalu kembali ke versi sebelumnya (D27), atau tambah "Pertahankan versi baru"?
   Rekomendasi: D27.
3. **Q3** — TTL unggahan 1 jam cukup? Rekomendasi: ya.
4. **Q4** — Butir "Keluar" §1 (deploy dari URL/CI, DB untuk situs lama, multi-line env, N versi) tetap di luar v0.3.0?
   Rekomendasi: ya; tidak pernah direncanakan di PLAN mana pun.
