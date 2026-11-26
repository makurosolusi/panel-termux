# PLAN 02 — Monitoring: Ringkasan, Layanan, Aplikasi, Domain, Database, Log, Sampler, Histori, Notifikasi

Penulis: wkr-plan-monitor-01 · Tanggal: 2026-11-26 · Basis: `feature/production-polish` @ 74fe380.
Sumber: `R&D/02-monitoring.md` (angka terukur di HP POCO), silang dengan R&D-01 (shell, DataTable, LogViewer,
polling), R&D-03 (kunci job, restart cloudflared), R&D-04 (backup.status melempar → overview 500, notifikasi cadangan),
R&D-05 (Pengaturan, request log membanjiri ring buffer). Semua klaim kode di bawah dicek ulang ke file di HEAD.

Konvensi: "Rx-Gn" = gap n di `R&D/0x`. Angka biaya dari R&D-02 §2.0: `pm2 jlist` 0,34–0,61 dtk wall ≈ 0,5 dtk CPU,
`sv status` 0,02 dtk, `psql` 0,08 dtk, `termux-battery-status` 0,7–1,25 dtk, probe HTTPS ±0,9 dtk, load idle ±20 di 8 inti,
`/proc/stat` EACCES (tidak ada CPU%).

---

## 1. Tujuan & ruang lingkup

**Tujuan.** Dalam 3 detik di layar 390 px admin tahu "ada yang rusak atau tidak, dan apa langkahnya"; panel memantau
sendiri saat tidak ada yang membuka halaman, dan memberi tahu lewat Telegram; biaya CPU di HP terukur dan dibatasi.

**Masuk ruang lingkup (menutup gap):**

| Bagian                                                                                  | Menutup                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Ringkasan problem-first dari `problems` server, satu set aturan                         | R2-G1, G2, G3, G18, G21, G22; R4-G4 (bagian overview 500) |
| `Problem` dengan `code` + `params` + `since` + `href`; teks diterjemahkan               | R2-G3                                                     |
| Tile perangkat jujur: load relatif terhadap HP ini, tanpa CPU% palsu                    | R2-G6, G7, G27                                            |
| Baterai: dicabut/tidak dicas = masalah, suhu null bila tak ada                          | R2-G11                                                    |
| pm2 daemon mati = masalah, bukan daftar kosong                                          | R2-G12                                                    |
| Halaman Layanan/Aplikasi/Domain/Database dengan `DataTable`                             | R2-G19, G20, G24, G26; R1-G2                              |
| Layanan inti (pm2, postgres) + restart panel/cloudflared yang benar                     | R2-G8; R4 temuan `cloudflared/restart`                    |
| Domain: debounce 3 cek, cek lokal port, arti kode HTTP, cek ulang manual                | R2-G13                                                    |
| Satu sampler latar + cache snapshot + histori 7 hari                                    | R2-G5, G15, G16                                           |
| Mesin alert + kanal Telegram (kunci setting, API, uji kirim)                            | R2-G14; R4-G15                                            |
| Log: kontrak API follow/cursor, parse svlogd, redaksi, unduh; pakai `LogViewer` PLAN/01 | R2-G9, G17, G23                                           |
| Level request log untuk polling                                                         | R2-G10; R5-G12                                            |
| Interval polling per halaman                                                            | R2-G4 (bersama PLAN/01 `useApiQuery`)                     |

**Di luar ruang lingkup:**

- Komponen generik `DataTable`, `LogViewer`, `ConfirmAction` bertingkat, `useApiQuery` (pause/backoff), bottom bar,
  `RelativeTime` jam global — milik **PLAN/01**. Dokumen ini hanya menyebut props/perilaku yang dibutuhkan (§3.9).
- UI Pengaturan Telegram — milik **PLAN/05**. Dokumen ini mendefinisikan kunci, validator, dan API-nya (§3.6, §3.7).
- Aturan masalah Situs/Perubahan (job gagal, situs restart-loop) — kode dicadangkan (§3.1), aturannya ditulis PLAN/03.
- Isi/perbaikan data cadangan — PLAN/04; dokumen ini hanya membaca `backup.status()` dan `backup_run`.
- Log rotasi (`@….s`, `.gz`) (R2-G25), webhook generik, ntfy, email, Web Push, heartbeat keluar (R2-G28) — P2, tidak
  dikerjakan di rilis ini. R2-G28 didokumentasikan di README saja (§2 K15).
- Grafik interaktif, library chart. Sparkline SVG tangan saja (gelombang 3).

---

## 2. Keputusan

| #   | Keputusan (dipilih)                                                                                                                                                                                                                                                                                                                                                                                                                                       | Alternatif ditolak                                              | Alasan                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Satu sumber aturan**: `computeProblems` di server; klien tidak punya aturan. `countProblems` (`web/panel/panel.status.ts:49`) dihapus; hitungan per kartu = `problems.filter(p => p.kind === …)`.                                                                                                                                                                                                                                                       | Aturan ganda klien/server (hari ini)                            | R2-G2: angka "2 perlu dicek" tidak boleh beda dengan daftar.                                                                                                     |
| K2  | **`Problem` = `{ id, code, kind, target, severity, params, since, href }`**, `message` Inggris dihapus. Teks Indonesia dari `code`+`params` di `src/shared/problem.copy.ts` (dipakai web **dan** pesan Telegram).                                                                                                                                                                                                                                         | Teks Indonesia di server saja; mem-parse string Inggris         | Notifikasi butuh teks yang sama dengan UI; satu tempat. Pengecualian sadar dari content guide ("teks di `src/web/i18n`"): `id.panel` me-re-export dari file ini. |
| K3  | **App `stopped` bukan masalah** (netral "Dihentikan"). Masalah app hanya `errored` dan crash loop (restart naik ≥ 3 dalam 10 mnt). Domain yang app-nya `stopped` tidak dijadikan masalah (diberi `params.appStopped`).                                                                                                                                                                                                                                    | Lacak "niat" dari audit (stop lewat panel = sengaja)            | pm2 tak menyimpan "want"; stop lewat CLI juga sengaja. Situs yang mati tanpa disengaja tetap tertangkap lewat `errored`/crash loop dan probe domain.             |
| K4  | **Load: angka "Beban sistem" netral + baseline HP ini.** Setelah ≥ 24 jam sampel: "biasanya 18–22" (p10–p90 load5 7 hari) dan nada warning bila load5 > 1,5× p50, danger > 2× p50 — **hanya tampilan, tidak pernah jadi Problem/notifikasi**. `formatLoadPerCore` tidak dipakai di mode termux.                                                                                                                                                           | Ambang per-core Linux (selalu merah), sembunyikan load          | R2 §6.1 opsi D lalu C.                                                                                                                                           |
| K5  | **Tidak ada CPU%**: adapter termux selalu mengisi `App.cpu = null`; kolom CPU hanya tampil bila ada nilai non-null (mode demo diubah juga ke null supaya mewakili Android).                                                                                                                                                                                                                                                                               | Tampilkan "CPU 0%"                                              | Data palsu (R2-G7).                                                                                                                                              |
| K6  | **Baterai untuk HP server**: `plugged = unplugged` → `battery_unplugged` **warning** (alert ditunda 5 mnt agar kabel goyang tidak memicu); `< 20%` dan tidak dicas → `battery_low` **danger** (menggantikan unplugged); suhu ≥ 45 °C warning, ≥ 50 °C danger. Dicolok tapi `NOT_CHARGING` (batas cas 80% / proteksi) **bukan** masalah. Baterai tak terbaca (`null`) bukan masalah, tile "Tidak tersedia".                                                | Hanya < 20% (hari ini)                                          | Dicabut = risiko mati total nomor satu; danger hanya bila waktu tersisa pendek.                                                                                  |
| K7  | **Satu sampler latar** (rantai `setTimeout`, default 60 dtk, setting `monitor.sample_interval_sec` 30–600) yang: memperbarui snapshot, mem-probe domain, menulis histori, menghitung problems, menjalankan alert. Single-flight: tick yang jatuh saat tick sebelumnya masih jalan dilewati + `log.warn`.                                                                                                                                                  | Tiga loop terpisah; SSE push                                    | R2 §6.3; satu biaya tetap.                                                                                                                                       |
| K8  | **Cache snapshot per bagian, stale-while-revalidate**: TTL bagian murah (runit, device tanpa baterai, ingress) 5 dtk; pm2 15 dtk; baterai 120 dtk; domain health = hasil probe sampler terakhir (request UI **tidak pernah** menunggu probe). Bila ada nilai lama (≤ 120 dtk), request langsung dijawab dengan itu sementara refresh berjalan di belakang; hanya request pertama setelah boot yang menunggu. Aksi kontrol meng-invalidate bagian terkait. | TTL tunggal 5 dtk; tanpa cache                                  | Satu tab Ringkasan (poll 10 dtk) → `jlist` paling sering tiap ±20 dtk ≈ 2,5% satu inti (< target 3%); N tab = biaya sama.                                        |
| K9  | **Histori di `panel.db`, 7 hari mentah, tanpa downsampling tulis.** Downsampling hanya saat baca (bucket 15 mnt untuk 24 jam, 2 jam untuk 7 hari). Retensi: `DELETE` per jam; tanpa `VACUUM` (halaman bebas dipakai ulang, ukuran stabil). Ikut cadangan harian apa adanya (bagian dari `VACUUM INTO`, ±3 MB).                                                                                                                                            | Agregat per jam 30 hari; ring di RAM                            | Ukuran mentah 7 hari ±3 MB (§3.4) → kode downsampling tulis tidak sebanding.                                                                                     |
| K10 | **Debounce di aturan, tunda di alert.** Problem tampil di UI segera (kecuali domain: butuh 3 cek gagal berturut-turut = ±3 mnt, pulih setelah 1 cek sehat). Alert punya `delay` per kode (§3.1).                                                                                                                                                                                                                                                          | Debounce semua di UI                                            | UI harus jujur seketika; notifikasi harus tahan flapping.                                                                                                        |
| K11 | **Mesin alert = rekonsiliasi status** per kunci `code:target` yang disimpan di tabel `problem_event` (bertahan restart): kirim bila status yang diinginkan (buka/pulih) ≠ yang terakhir dikirim, dengan cooldown 15 mnt per kunci, pengingat tiap 24 jam selama masih terbuka, eskalasi warning→danger menembus cooldown, semua perubahan dalam satu tick digabung jadi **satu pesan**, batas 20 pesan/jam.                                               | Kirim per event; antre pesan                                    | Tahan badai (internet pulih = 1 pesan), restart panel tidak mengirim ulang, kegagalan kirim otomatis dicoba ulang tanpa antrean.                                 |
| K12 | **Tanpa jam tenang (quiet hours).** Pesan yang hanya berisi warning dikirim dengan `disable_notification: true` (senyap); pesan berisi danger berbunyi. Membisukan chat diserahkan ke Telegram.                                                                                                                                                                                                                                                           | Setting jam tenang                                              | Satu setting dan satu zona waktu lebih sedikit; TZ proses di runit Termux tidak terjamin (§8 R4).                                                                |
| K13 | **Layanan inti**: default `panel.protected_services` = `sshd,cloudflared,panel,pm2,postgres`. Protected: **Hentikan** butuh ketik nama (body `confirm`), **Mulai ulang** boleh dengan peringatan akibat. `panel` dan `cloudflared` **tidak bisa dihentikan sama sekali** dari panel (`lockout`, 409): menghentikannya memutus akses ke panel itu sendiri dan runit tidak akan menyalakannya lagi.                                                         | Refuse stop untuk semua protected (hari ini); tanpa proteksi    | Default brief + menghindari admin mengunci dirinya sendiri. Nilai setting yang sudah disimpan pengguna tidak diubah (hanya default).                             |
| K14 | **Restart `panel` dan `cloudflared` = "putus yang diharapkan"**: server membalas `202` dulu, lalu menjalankan `sv restart` 500 ms kemudian (untuk `panel` lewat proses `sv` terlepas/detached). UI menampilkan overlay "Menyambung ulang…", poll tiap 2 dtk (`/api/health` dengan `bootId` baru untuk panel; `/api/panel/ping` untuk cloudflared), batas 90 dtk.                                                                                          | Toast gagal palsu (hari ini)                                    | R2 §6.6 C.                                                                                                                                                       |
| K15 | **Panel sendiri mati tidak bisa memberi tahu.** README menyarankan monitor luar (Uptime Kuma/healthchecks) ke `https://panel.<domain>/api/health`; heartbeat keluar P2.                                                                                                                                                                                                                                                                                   | Implementasi heartbeat sekarang                                 | Jujur, murah (R2-G28).                                                                                                                                           |
| K16 | **Request log**: semua `GET`/`HEAD` dengan status < 400 dicatat `debug`; lainnya `info` (5xx tetap juga `error` dari `normalizeError`). Ring buffer `log.service` tidak menyimpan `debug` di produksi (sama dengan stdout).                                                                                                                                                                                                                               | Daftar path polling khusus                                      | Aturan satu baris tanpa daftar yang harus dipelihara; R2-G10/R5-G12.                                                                                             |
| K17 | **Log**: kontrak `LogChunk` dengan `cursor` (`<ino>:<offset>`) untuk follow (poll 3 dtk), parse prefix `svlogd -tt` (UTC) jadi `at`, redaksi pola rahasia umum di server, unduh = audit `log.download`. Tanpa opsi "semua" stdout+stderr (pm2 tidak memberi timestamp untuk menggabungkan urutan).                                                                                                                                                        | SSE/`fs.watch` (belum terbukti di Android); merge stdout/stderr | R2 §6.4 opsi A.                                                                                                                                                  |
| K18 | **Internet HP putus**: bila semua domain yang bisa diprobe gagal tanpa jawaban di tick yang sama, sampler mem-probe `CONNECTIVITY_PROBE_URL` (`https://www.gstatic.com/generate_204`, konstanta bernama + override env `PANEL_CONNECTIVITY_URL`). Gagal juga → satu problem `internet_down` menggantikan problem per-domain. Saat pulih, bila lamanya ≥ 5 mnt, kirim "HP sempat tidak terhubung internet selama X".                                       | N domain merah                                                  | R2 §4 tabel kegagalan.                                                                                                                                           |
| K19 | Notifikasi **tidak pernah** memuat isi log/env; hanya judul masalah + nama resource + tautan `APP_BASE_URL/panel`. Waktu ditulis relatif ("sejak 12 mnt") bukan jam, supaya tidak bergantung TZ proses.                                                                                                                                                                                                                                                   | Jam absolut                                                     | R2 §4 keamanan; R4 TZ.                                                                                                                                           |
| K20 | **Role**: semua API monitoring tetap `admin`; uji kirim dan deteksi chat Telegram `super_admin` (setara pengaturan). Admin melihat status kanal (aktif/gagal) tapi bukan isinya.                                                                                                                                                                                                                                                                          | Uji kirim untuk admin                                           | Keputusan owner 1: super_admin mengelola pengaturan.                                                                                                             |

---

## 3. Model data & kontrak API

### 3.1 Tipe bersama — `src/shared/monitor.types.ts` (baru, ±150 baris)

```ts
import type { DevAuditEntry } from "./dev.types";

/** What a problem is about. */
export type ProblemKind = "service" | "app" | "domain" | "network" | "backup" | "disk" | "battery" | "alerts" | "site";

export type ProblemSeverity = "warning" | "danger";

/** Stable problem codes: i18n key, alert dedupe key part, test fixture. Never rename; add new ones. */
export type ProblemCode =
  | "service_down"
  | "pm2_unavailable"
  | "app_errored"
  | "app_crash_loop"
  | "domain_unreachable"
  | "domain_http_error"
  | "internet_down"
  | "backup_not_configured"
  | "backup_failed"
  | "backup_partial"
  | "backup_stale"
  | "backup_status_error"
  | "disk_low"
  | "battery_unplugged"
  | "battery_low"
  | "battery_hot"
  | "alerts_failing"
  // reserved for PLAN/03 (rules written there, evaluated in the same computeProblems):
  | "site_job_failed"
  | "site_crash_loop";

/** Primitive params only, so they survive JSON + the problem_event table. */
export type ProblemParams = Record<string, string | number | boolean | null>;

/**
 * Something an admin should look at. `id` = `${code}:${target}` (dedupe key). `since` = first seen (ISO, from
 * problem_event; null until the sampler persisted it). `href` = SPA path to act on it.
 */
export type Problem = {
  id: string;
  code: ProblemCode;
  kind: ProblemKind;
  target: string;
  severity: ProblemSeverity;
  params: ProblemParams;
  since: string | null;
  href: string;
};

/** Typical load of this phone (load5 over the last 7 days); null until >= 24 h of samples exist. */
export type LoadBaseline = { p10: number; p50: number; p90: number; spanHours: number };

/** Overview parts that can fail on their own; listed in PanelOverview.unavailable when they did. */
export type OverviewSection = "device" | "services" | "apps" | "domains" | "backup" | "activity";

/** Outbound alert channel state shown on Ringkasan (admin) and Pengaturan (super_admin). */
export type AlertChannelState = "not_configured" | "disabled" | "ok" | "failing";

export type AlertErrorCode =
  | "telegram_token_invalid" // HTTP 401
  | "telegram_chat_not_found" // HTTP 400 "chat not found"
  | "telegram_forbidden" // HTTP 403 (bot blocked / not in group)
  | "telegram_rate_limited" // HTTP 429
  | "telegram_bad_request" // other 400
  | "telegram_unreachable"; // network error, timeout, 5xx

/** GET /api/panel/alerts/status */
export type AlertStatus = {
  channel: "telegram";
  state: AlertChannelState;
  lastSentAt: string | null;
  lastError: AlertErrorCode | null;
  lastErrorAt: string | null;
  /** Open problems that are due but not delivered yet (e.g. while offline). */
  pending: number;
};

/** POST /api/dev/alerts/test → 200 */
export type AlertTestResult = { ok: true; sentAt: string };

/** POST /api/dev/alerts/telegram/chats → chats that recently messaged the bot (getUpdates). */
export type TelegramChat = { id: string; title: string; type: "private" | "group" | "supergroup" | "channel" };
export type TelegramChats = { chats: TelegramChat[] };

/** One row of GET /api/panel/problems/history (newest first, paginated with Page<T>). */
export type ProblemEvent = {
  id: number;
  code: ProblemCode;
  kind: ProblemKind;
  target: string;
  severity: ProblemSeverity; // highest seen while open
  params: ProblemParams; // last seen
  openedAt: string;
  closedAt: string | null;
  notified: boolean;
};

/** GET /api/panel/metrics?range= — bucket averages, oldest first; at most 100 points. */
export type MetricRange = "24h" | "7d";
export type MetricPoint = {
  at: string;
  batteryPct: number | null;
  memAvailableMb: number | null;
  diskFreeMb: number | null;
  load5: number | null;
};
export type MetricSeries = { range: MetricRange; bucketSec: number; points: MetricPoint[] };

/** One domain check kept for the heartbeat strip; `status` null = no answer. */
export type DomainCheck = { at: string; status: number | null };

export type { DevAuditEntry };
```

Tabel aturan (diimplementasikan di `src/server/panel/overview.problems.ts`; `delay` dipakai mesin alert; "–" = tidak
pernah dikirim ke Telegram):

| code                    | kind    | severity                         | Kondisi (input snapshot + status sampler)                                                                                        | params                                                         | href                                | delay alert     |
| ----------------------- | ------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- | --------------- |
| `service_down`          | service | danger                           | `wantUp && state !== "run"` (bukan `pm2`, lihat baris berikut)                                                                   | `state`, `downSec`                                             | `/panel/services`                   | 2 mnt           |
| `pm2_unavailable`       | service | danger                           | `pm2.available() === false` (tidak ada `rpc.sock`) **atau** `jlist` gagal 2 tick berturut-turut; menggantikan `service_down:pm2` | `reason: "no_daemon" \| "jlist_failed"`                        | `/panel/services`                   | 2 mnt           |
| `app_errored`           | app     | danger                           | `status === "errored"`                                                                                                           | `restarts`, `site`                                             | `/panel/apps/<name>/log?stream=err` | 1 mnt           |
| `app_crash_loop`        | app     | danger                           | `status !== "errored"` dan `restarts` naik ≥ 3 dalam 10 mnt (ring di memori sampler)                                             | `restarts10m`, `site`                                          | `/panel/apps/<name>/log?stream=err` | 0               |
| `domain_unreachable`    | domain  | danger                           | 3 probe berturut-turut `status === null`; app tujuan bukan `stopped`; tidak sedang `internet_down`                               | `failures`, `local` (status HTTP lokal port atau null), `port` | `/panel/domains`                    | 0               |
| `domain_http_error`     | domain  | danger                           | 3 probe berturut-turut `status >= 500` (termasuk 502/530); syarat app sama                                                       | `status`, `local`, `port`                                      | `/panel/domains`                    | 0               |
| `internet_down`         | network | danger                           | Semua domain yang bisa diprobe `null` di tick ini **dan** probe konektivitas gagal                                               | `domains` (jumlah)                                             | `/panel/domains`                    | 0 (khusus, K18) |
| `backup_not_configured` | backup  | warning                          | `!configured`                                                                                                                    | –                                                              | `/panel/backups`                    | –               |
| `backup_failed`         | backup  | danger                           | run terakhir `failed`, tidak sedang berjalan                                                                                     | –                                                              | `/panel/backups`                    | 0               |
| `backup_partial`        | backup  | warning                          | run terakhir `partial`                                                                                                           | –                                                              | `/panel/backups`                    | 0               |
| `backup_stale`          | backup  | warning                          | tidak ada run selesai dalam `BACKUP_STALE_MS` (36 jam, sudah ada)                                                                | `hours`                                                        | `/panel/backups`                    | 0               |
| `backup_status_error`   | backup  | danger                           | `backup.status()` melempar (mis. kunci data tak cocok, R4-G4)                                                                    | –                                                              | `/dev/settings`                     | 0               |
| `disk_low`              | disk    | warning < 10% bebas, danger < 5% | konstanta yang sudah ada                                                                                                         | `freePct`, `freeBytes`                                         | `/panel`                            | 0               |
| `battery_unplugged`     | battery | warning                          | `plugged === "unplugged"` dan tidak `battery_low`                                                                                | `percent`                                                      | `/panel`                            | 5 mnt           |
| `battery_low`           | battery | danger                           | `percent < 20` dan `plugged === "unplugged"`                                                                                     | `percent`                                                      | `/panel`                            | 0               |
| `battery_hot`           | battery | warning ≥ 45 °C, danger ≥ 50 °C  | `temperatureC !== null`                                                                                                          | `temperatureC`                                                 | `/panel`                            | 2 mnt           |
| `alerts_failing`        | alerts  | warning                          | kanal terkonfigurasi + aktif dan pengiriman terakhir gagal ≥ 3× berturut-turut                                                   | `reason: AlertErrorCode`                                       | `/dev/settings`                     | –               |

Konstanta baru (nama tetap di `overview.problems.ts`): `BATTERY_DANGER_C = 50`, `DOMAIN_FAILS_TO_PROBLEM = 3`,
`CRASH_LOOP_RESTARTS = 3`, `CRASH_LOOP_WINDOW_MS = 600_000`. Yang lama tetap. Urutan hasil: danger dulu, lalu urutan
tabel di atas, lalu `target` alfabetis (deterministik untuk test dan aria-live). `memory` sengaja tidak punya aturan
(Android mengelola memori; 63% terpakai itu normal).

### 3.2 Perubahan `src/shared/panel.types.ts`

```ts
/** Item of GET /services. `downSec` = seconds in down state (parsed from `sv status`); `lockout` = stop always refused. */
export type Service = {
  name: string;
  state: ServiceState;
  pid: number | null;
  uptimeSec: number | null; // unchanged: only for state "run"
  downSec: number | null; // NEW: only for state "down"
  wantUp: boolean;
  protected: boolean; // stop needs typed confirmation
  lockout: boolean; // NEW: "panel" and "cloudflared"; stop refused (409 lockout)
};

/** `cpu` is always null on Android (pidusage cannot read /proc); `module` = pm2 module (pmx_module); `site` from table site.app. */
export type App = {
  name: string;
  status: AppStatus;
  pid: number | null;
  memoryMb: number | null;
  cpu: number | null;
  restarts: number;
  uptimeSec: number | null;
  port: number | null;
  module: boolean; // NEW
  site: string | null; // NEW
};

/** `local` = HTTP status of 127.0.0.1:<port> checked when the public probe failed; `failures` = consecutive failed probes. */
export type DomainHealth = {
  status: number | null;
  ms: number | null;
  checkedAt: string | null;
  failures: number; // NEW
  local: number | null; // NEW
};

/** `site` from site_hostname; `target` says what answers behind it. `recent` = up to 30 newest checks, oldest first. */
export type Domain = {
  hostname: string;
  service: string;
  port: number | null;
  app: string | null;
  site: string | null; // NEW
  target: "app" | "panel" | "other" | "none"; // NEW: panel = port equals the panel PORT
  health: DomainHealth;
  recent: DomainCheck[]; // NEW
};

/** Item of GET /databases. `site` = site using it; `lastBackupAt` = newest backup_run item ok for this DB. */
export type DatabaseInfo = {
  name: string;
  owner: string;
  sizeBytes: number;
  site: string | null;
  lastBackupAt: string | null;
};

export type BatteryPlug = "ac" | "usb" | "wireless" | "unplugged" | "unknown";

/** Battery reading; `temperatureC` null when the field is missing (never a fake 0). */
export type Battery = {
  percent: number;
  charging: boolean;
  plugged: BatteryPlug; // plugged NEW
  temperatureC: number | null; // was number (0 when missing)
  health: string | null; // NEW, raw Termux value e.g. "GOOD"
};

/** GET /overview. Sections that failed are empty/null AND listed in `unavailable`. */
export type PanelOverview = {
  mode: PanelMode;
  device: DeviceInfo | null; // was non-null
  loadBaseline: LoadBaseline | null; // NEW
  services: Service[];
  apps: App[];
  domains: Domain[];
  problems: Problem[]; // new Problem shape
  unavailable: OverviewSection[]; // NEW
  recentActivity: DevAuditEntry[]; // newest 5 (was 8)
  backup: OverviewBackup | null; // null when backup.status() threw
  sites: { total: number; deployed: number };
  alerts: Pick<AlertStatus, "state" | "lastError">; // NEW
  sampledAt: string | null; // NEW: last finished sampler tick
  generatedAt: string;
};

/** Thin status for the nav badge: GET /api/panel/status (no system calls; last sampler result). */
export type PanelStatus = { danger: number; warning: number; sampledAt: string | null };

/** 202 body of POST /services/panel|cloudflared/restart: the response is sent before the restart happens. */
export type DeferredRestart = { deferred: true; service: "panel" | "cloudflared"; bootId: string };

/** Body of POST /services/:name/stop for a protected service. */
export type ControlBody = { confirm?: string };
```

`Problem`, `ProblemKind`, `ProblemSeverity` dipindah dari `panel.types.ts` ke `monitor.types.ts` (re-export dari
`panel.types.ts` agar import lama tetap jalan). `LogLines` diganti `LogChunk` (§3.3).

### 3.3 Tipe log — `src/shared/log.types.ts` (baru; dipakai PLAN/01 `LogViewer` dan PLAN/05 `/dev/logs`)

```ts
import type { LogLevel } from "./dev.types";

/** One displayed log line. `at` = ISO time when the source has one (svlogd prefix, panel ring), else null. */
export type LogLine = { at: string | null; text: string; level?: LogLevel };

/**
 * GET …/log?lines=&after=. `cursor` = opaque position to pass as `after` next time. `reset` = the file was rotated
 * or the cursor is invalid: replace the buffer instead of appending. `truncated` = more new data existed than returned.
 */
export type LogChunk = { lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean };
```

### 3.4 Database — migration `drizzle/00NN_monitor.sql` + `src/server/db/schema/monitor.schema.ts`

Nomor `00NN` diambil saat merge (berikutnya setelah migration PLAN lain yang masuk lebih dulu; 0006 bila ini yang
pertama). SQL dibuat `drizzle-kit generate`, lalu diedit tangan menjadi `IF NOT EXISTS` (hash migration dihitung dari
isi file, jadi edit sebelum commit aman; `tests/db.migrate.test.ts` memverifikasi).

```sql
-- Monitoring history (PLAN/02). Non-critical data: may be lost, must stay bounded (7 days, pruned hourly).
-- One row per sampler tick (default 60 s). Columns nullable: a failed section must not block the row.
CREATE TABLE IF NOT EXISTS `metric_sample` (
  `at` integer PRIMARY KEY NOT NULL,          -- unix ms; rowid alias, so no extra index
  `battery_pct` integer,
  `battery_plugged` text,                     -- BatteryPlug
  `battery_temp_c` real,
  `mem_available_mb` integer,
  `mem_total_mb` integer,
  `disk_free_mb` integer,
  `load1` real,
  `load5` real,
  `problems_danger` integer NOT NULL,
  `problems_warning` integer NOT NULL
);
--> statement-breakpoint
-- One row per domain probe (sampler or manual check). `local_status` only filled when the public probe failed.
CREATE TABLE IF NOT EXISTS `check_result` (
  `hostname` text NOT NULL,
  `at` integer NOT NULL,
  `status` integer,
  `ms` integer,
  `local_status` integer,
  PRIMARY KEY (`hostname`, `at`)              -- serves "last 30 per host" and the prune by at per host
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `check_result_at_idx` ON `check_result` (`at`);  -- retention DELETE + 35-min window read
--> statement-breakpoint
-- Problem lifecycle = alert state. Open rows (closed_at NULL) survive panel restarts, so alerts are not re-sent.
CREATE TABLE IF NOT EXISTS `problem_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,                        -- code:target
  `code` text NOT NULL,
  `kind` text NOT NULL,
  `target` text NOT NULL,
  `severity` text NOT NULL,                   -- highest seen while open
  `params` text NOT NULL,                     -- JSON, last seen
  `opened_at` integer NOT NULL,
  `closed_at` integer,
  `notified_state` text,                      -- NULL | 'open' | 'closed': what Telegram last heard
  `notified_severity` text,
  `last_sent_at` integer
);
--> statement-breakpoint
-- At most one open event per key; the engine relies on it (INSERT fails loudly instead of duplicating).
CREATE UNIQUE INDEX IF NOT EXISTS `problem_event_open_key_idx` ON `problem_event` (`key`) WHERE `closed_at` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `problem_event_opened_idx` ON `problem_event` (`opened_at`);
```

Tidak ada tabel berisi data yang diubah → tidak perlu backfill. Rollback: tabel baru saja; versi lama mengabaikannya.

**Retensi** (dijalankan sampler, paling sering 1× per jam, satu transaksi): `metric_sample` dan `check_result`
`at < now − 7 hari`; `problem_event` tertutup `closed_at < now − 30 hari` (riwayat "kapan app mati?" lebih berguna
dan baris sangat sedikit). Baris terbuka tidak pernah dihapus.

**Estimasi ukuran** (SQLite, halaman 4 KiB, overhead record+cell ±20 B):

| Tabel           | Baris/hari       | Byte/baris (data + indeks)                | 7 hari                                   |
| --------------- | ---------------- | ----------------------------------------- | ---------------------------------------- |
| `metric_sample` | 1.440            | ±80                                       | 10.080 baris ≈ 0,8 MB                    |
| `check_result`  | 1.440 × D domain | ±45 tabel + ±45 PK index + ±15 `at` index | D=3: 30.240 baris ≈ 3,1 MB; D=10 ≈ 10 MB |
| `problem_event` | puluhan          | ±200                                      | < 0,1 MB (30 hari)                       |

Total HP sekarang (2 domain yang diprobe + catch-all) ≈ 3 MB. Tulis: 1 transaksi/menit menyentuh ±4–6 halaman → ±25 KB
WAL/menit ≈ 35 MB/hari tulis flash — dapat diabaikan terhadap ketahanan flash modern (ratusan TBW), tetapi dinyatakan
jujur di README. Interval 120 dtk memotong setengahnya bila owner ingin.

Repository: `src/server/monitor/monitor.history.ts` (≤ 250 baris): `insertTick(tx, sample, checks)`,
`recentChecks(sinceMs)` (satu query untuk semua host, dikelompokkan di JS — tanpa N+1), `lastChecksPerHost(n)` (untuk
seed counter gagal saat boot), `metricSeries(range)` (`GROUP BY at / bucketMs`, ≤ 100 baris), `loadBaseline()`
(load5 7 hari, ≤ 10.080 angka, persentil di JS, dihitung ulang paling sering 1×/jam), `openEvents()`,
`upsertEvents(...)`, `historyPage(page, pageSize)`, `prune(now)`.

### 3.5 Server: modul dan batas tanggung jawab

| File (baru/ubah)                                | Tanggung jawab                                                                                                                                                     | Batas baris |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `src/server/monitor/monitor.snapshot.ts` (baru) | Cache per bagian + stale-while-revalidate + single-flight; `get()`, `invalidate(section)`                                                                          | 200         |
| `src/server/monitor/monitor.sampler.ts` (baru)  | Loop tick: snapshot → probe domain (+ lokal + konektivitas) → problems → histori → alert → retensi; `start()`→`stop`, `idle()`                                     | 250         |
| `src/server/monitor/monitor.service.ts` (baru)  | `monitorFor(deps)` satu instance per `Db` (pola `backupServiceFor`); state sampler (counter gagal domain, ring restart app, baseline cache, `sampledAt`, `bootId`) | 200         |
| `src/server/monitor/monitor.history.ts` (baru)  | Repository §3.4                                                                                                                                                    | 250         |
| `src/server/panel/overview.problems.ts` (ubah)  | Aturan §3.1, fungsi murni `computeProblems(input, state)`                                                                                                          | 250         |
| `src/server/alerts/alert.engine.ts` (baru)      | Rekonsiliasi §4.6, fungsi murni + adapter repo                                                                                                                     | 250         |
| `src/server/alerts/telegram.client.ts` (baru)   | `sendMessage`, `getUpdates`, pemetaan error, redaksi token                                                                                                         | 150         |
| `src/server/alerts/alert.messages.ts` (baru)    | Susun pesan HTML dari `problem.copy.ts`, escape, batas panjang                                                                                                     | 150         |
| `src/shared/problem.copy.ts` (baru)             | Judul + detail Indonesia per `code` (§5.7)                                                                                                                         | 200         |
| `src/server/system/log.parse.ts` (baru)         | Parse prefix svlogd, redaksi, baca dari cursor                                                                                                                     | 150         |
| `src/server/panel/panel.service.ts` (ubah)      | Baca dari snapshot; kontrol dengan proteksi baru + deferred restart                                                                                                | 300         |
| `src/server/routes/panel.routes.ts` (ubah)      | Endpoint §3.7                                                                                                                                                      | 150         |
| `src/server/routes/alerts.routes.ts` (baru)     | `/api/dev/alerts/*`                                                                                                                                                | 100         |

Adapter (`system.types.ts`): `Pm2Adapter.available(): boolean` (cek `rpc.sock`, tanpa proses); `Pm2Adapter.logPaths(name)`
dihapus dari kebutuhan — path log diambil dari `Pm2Proc` di snapshot (internal, tidak dikirim ke klien), jadi follow log
tidak memanggil `jlist`. `RunitAdapter.restartDetached(name)` (spawn `sv restart <name>` detached, stdio diabaikan).
`parseSvStatus` mengisi `downSec` dari `down: …: 120971s`. `parseBattery` membaca `plugged`
(`PLUGGED_AC|PLUGGED_USB|PLUGGED_WIRELESS|UNPLUGGED` → `ac|usb|wireless|unplugged`, lain → `unknown`), `health`,
`temperature` hilang → `null`. Cache baterai `BATTERY_CACHE_MS` 30 → 120 dtk (dicabut terdeteksi ≤ 2 mnt + 1 tick).
`parsePm2Jlist` mengisi `module = pm2_env.pmx_module === true`; adapter termux memaksa `cpu: null`.
`system.fake.ts`: load `[20.87, 20.73, 20.01]`, `cpu: null`, baterai `unplugged` 88% (memicu problem di demo), satu
domain gagal, satu app `errored` — agar UI diuji pada bentuk data nyata (R2-G27).

### 3.6 Kunci pengaturan (registri `SETTINGS` di `settings.service.ts`; label/teks UI mengikuti keputusan PLAN/05 — bila PLAN/05 memindah label ke `src/web/i18n`, teks Indonesia di bawah dipakai di sana)

| Key                           | secret | default                                                  | Validator (setelah trim)                                                                                     | Label (id)                  | Deskripsi (id)                                                                                                                 |
| ----------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `alerts.telegram_bot_token`   | ya     | null                                                     | `/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/` → "harus berbentuk `123456:ABC…` dari @BotFather"                        | Token bot Telegram          | Token dari @BotFather. Disimpan terenkripsi dan tidak pernah ditampilkan lagi.                                                 |
| `alerts.telegram_chat_id`     | tidak  | null                                                     | `/^(-?\d{1,20}\|@[A-Za-z][A-Za-z0-9_]{4,31})$/` → "harus ID angka (mis. `-1001234567890`) atau `@namakanal`" | ID chat Telegram            | Chat, grup, atau kanal tujuan notifikasi. Pakai "Cari chat" setelah mengirim pesan ke bot.                                     |
| `alerts.enabled`              | tidak  | `on`                                                     | `on\|off`                                                                                                    | Notifikasi Telegram         | Matikan sementara tanpa menghapus token.                                                                                       |
| `alerts.min_severity`         | tidak  | `warning`                                                | `warning\|danger`                                                                                            | Kirim mulai dari            | `warning` = semua masalah (peringatan dikirim senyap); `danger` = hanya yang gawat.                                            |
| `monitor.sample_interval_sec` | tidak  | `60`                                                     | bilangan bulat 30–600                                                                                        | Interval pemantauan (detik) | Seberapa sering panel memeriksa HP saat tidak ada yang membuka halaman. Lebih kecil = lebih cepat tahu, lebih boros baterai.   |
| `panel.protected_services`    | tidak  | **`sshd,cloudflared,panel,pm2,postgres`** (ubah default) | sama seperti sekarang                                                                                        | Layanan inti                | Layanan yang hanya bisa dihentikan dengan mengetik namanya. `panel` dan `cloudflared` tidak pernah bisa dihentikan dari panel. |

Kanal dianggap **terkonfigurasi** bila token **dan** chat id terisi. `alerts.enabled=off` → state `disabled`.
Perubahan setting dibaca ulang tiap tick (tanpa restart). Mengubah token/chat → reset counter gagal + `lastError`.

### 3.7 Endpoint

Semua di bawah `/api`. Error = `{ error, message }` (pola sekarang). Semua mutasi wajib lolos cek origin hotfix
(Origin sama + `X-Requested-With`). Peran: `A` = admin, `S` = super_admin.

| Method + path                            | Peran | Request                               | 2xx                                                                                                                                                                                     | Error                                                                                                                                                                                                                              |
| ---------------------------------------- | ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health` (publik, ubah)             | –     | –                                     | `{ ok, version, bootId }` (`bootId` UUID acak per proses)                                                                                                                               | –                                                                                                                                                                                                                                  |
| `GET /panel/overview`                    | A     | –                                     | `PanelOverview` (tidak pernah 500 karena satu bagian; bagian gagal → `unavailable`)                                                                                                     | 401/403                                                                                                                                                                                                                            |
| `GET /panel/status`                      | A     | –                                     | `PanelStatus` (tanpa perintah sistem)                                                                                                                                                   | 401/403                                                                                                                                                                                                                            |
| `GET /panel/services`                    | A     | –                                     | `Service[]` dari snapshot                                                                                                                                                               | 502 `system_error` (runit tak bisa dibaca)                                                                                                                                                                                         |
| `POST /panel/services/:name/:action`     | A     | `ControlBody` (opsional)              | 200 `Service`; **202 `DeferredRestart`** untuk restart `panel`/`cloudflared`                                                                                                            | 400 `invalid_name`/`invalid_action`; 404 `not_found`; 409 `busy`, `lockout` (stop panel/cloudflared), `confirm_required` (stop protected tanpa `confirm === name`), `job_running` (kunci job PLAN/03 dipegang); 502 `system_error` |
| `GET /panel/services/:name/log`          | A     | `?lines=1..2000 (200)&after=<cursor>` | `LogChunk`                                                                                                                                                                              | 400 `invalid_lines`/`invalid_cursor`; 404                                                                                                                                                                                          |
| `GET /panel/services/:name/log/download` | A     | –                                     | `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<name>-<yyyymmdd-hhmm>.log"`, ≤ 10 MiB terakhir, sudah diredaksi; audit `log.download` target `service:<name>` | 404                                                                                                                                                                                                                                |
| `GET /panel/apps`                        | A     | –                                     | `App[]`                                                                                                                                                                                 | 502                                                                                                                                                                                                                                |
| `POST /panel/apps/:name/:action`         | A     | –                                     | 200 `App`                                                                                                                                                                               | 400; 404; 409 `busy`, `job_running`; 503 `pm2_unavailable`; 502                                                                                                                                                                    |
| `GET /panel/apps/:name/log`              | A     | `?stream=out\|err&lines&after`        | `LogChunk`                                                                                                                                                                              | 400 `invalid_stream`…; 404                                                                                                                                                                                                         |
| `GET /panel/apps/:name/log/download`     | A     | `?stream=`                            | seperti layanan; audit target `app:<name>:<stream>`                                                                                                                                     | 404                                                                                                                                                                                                                                |
| `GET /panel/domains`                     | A     | –                                     | `Domain[]` (+ `recent` dari 1 query `check_result` 35 mnt)                                                                                                                              | 502                                                                                                                                                                                                                                |
| `POST /panel/domains/:hostname/check`    | A     | –                                     | 200 `Domain` (probe sekarang + cek lokal bila gagal; ditulis ke `check_result`)                                                                                                         | 400 `invalid_hostname` (`/^[a-z0-9.-]{1,253}$/`, tanpa `*`); 404; 429 `too_soon` + `retryAfterSec` (10 dtk per host)                                                                                                               |
| `GET /panel/databases`                   | A     | –                                     | `DatabaseInfo[]` (tidak di-cache, tidak di-poll)                                                                                                                                        | 503 `postgres_down` (layanan `postgres` tidak `run`), 502                                                                                                                                                                          |
| `GET /panel/metrics`                     | A     | `?range=24h\|7d` (default 24h)        | `MetricSeries` (≤ 100 titik: daftar terbatas, tanpa paginasi)                                                                                                                           | 400 `invalid_range`                                                                                                                                                                                                                |
| `GET /panel/problems/history`            | A     | `?page&pageSize` (20, maks 100)       | `Page<ProblemEvent>`                                                                                                                                                                    | 400                                                                                                                                                                                                                                |
| `GET /panel/alerts/status`               | A     | –                                     | `AlertStatus`                                                                                                                                                                           | –                                                                                                                                                                                                                                  |
| `POST /dev/alerts/test`                  | S     | –                                     | `AlertTestResult`                                                                                                                                                                       | 409 `alerts_not_configured`; 429 `too_soon` (1 per 5 dtk); 502 `<AlertErrorCode>` dengan `message` tanpa token                                                                                                                     |
| `POST /dev/alerts/telegram/chats`        | S     | –                                     | `TelegramChats` (dari `getUpdates`, unik per id, maks 20)                                                                                                                               | 409 `alerts_token_missing`; 409 `telegram_webhook_set` (getUpdates tidak jalan bila webhook aktif); 502 `<AlertErrorCode>`                                                                                                         |

Catatan:

- Endpoint lama `GET …/log` mengembalikan `LogChunk`, bukan `LogLines` (kontrak internal; klien satu repo).
- `GET /panel/ping` tetap (dipakai overlay restart cloudflared).
- Cursor = `base64url("<ino>:<offset>")`. Server: bila `ino` beda atau `size < offset` → baca tail biasa, `reset: true`.
  Bila data baru > 256 KiB → kirim 256 KiB terakhir, `truncated: true`. `lines` tetap membatasi jumlah baris.
- Kunci job PLAN/03: kontrol app/layanan memanggil `jobs.isLocked(resource)` (nama fungsi final dari PLAN/03) sebelum
  `withLock`; bila terkunci → 409 `job_running`. Restart `panel` ditolak 409 `job_running` bila ada job/deploy/backup
  yang sedang berjalan (shutdown hanya menunggu 20 dtk).

### 3.8 Telegram (klien, format pesan, batas)

Diverifikasi sebagian ke `core.telegram.org/bots/api` (2026-11-26): format token `123456:ABC-DEF…`, URL
`https://api.telegram.org/bot<token>/METHOD`, `getUpdates` tidak bekerja bila webhook terpasang, `error_code` bisa
berubah (jadi kode dipetakan dari HTTP status + `description`). **Belum terverifikasi dari halaman** (asumsi dari
pengetahuan, dicek ulang implementer sebelum menulis kode — Rule 20): batas teks 4.096 karakter, `parse_mode: "HTML"`
dengan escape `&`, `<`, `>`, `parameters.retry_after` pada 429, `disable_notification`, `link_preview_options.is_disabled`.

- `sendMessage` body: `{ chat_id, text, parse_mode: "HTML", disable_notification, link_preview_options: { is_disabled: true } }`,
  timeout `TELEGRAM_TIMEOUT_MS = 10_000`.
- Pemetaan error: 401 → `telegram_token_invalid`; 400 + `description` mengandung "chat not found" → `telegram_chat_not_found`;
  403 → `telegram_forbidden`; 429 → `telegram_rate_limited` (tunggu `retry_after` detik, default 60); 400 lain →
  `telegram_bad_request`; jaringan/timeout/5xx → `telegram_unreachable`.
- **Token tidak boleh muncul di log/error.** URL berisi token; pesan error `fetch` bisa memuat URL → semua pesan error
  dari klien ini lewat `redactToken()` (`token` → `bot***`) sebelum `log.*`/response. Test wajib.
- Backoff kirim alert setelah gagal: 1, 2, 4, 8, 16, 30 mnt (maks), reset setelah sukses. 401/403/400-chat → berhenti
  mencoba sampai setting berubah (state `failing`, problem `alerts_failing`).
- Batas laju: ≤ 1 pesan per tick (≤ 1/menit dengan default) — jauh di bawah batas Telegram per chat; ditambah plafon
  `ALERT_MAX_PER_HOUR = 20`. Lewat plafon: kirim satu pesan "Terlalu banyak notifikasi. Buka Ringkasan untuk melihat
  semuanya." lalu diam sampai jam berikutnya; perubahan yang tertahan tetap direkonsiliasi di digest berikutnya.

Format pesan (HTML, teks Indonesia, tanpa emoji, maks 3.500 karakter; lebih dari 15 baris → "… dan N lainnya"):

```
<b>Panel Termux</b> · panel.malikkurosaki.com
GAWAT · Layanan postgres mati · sejak 3 mnt
PERINGATAN · HP tidak sedang dicas · baterai 88%
PULIH · solusi.malikkurosaki.com bisa dijangkau lagi · putus 12 mnt

Buka Ringkasan: https://panel.malikkurosaki.com/panel
```

Nama instance = host dari `APP_BASE_URL`. Pengingat 24 jam diawali "MASIH · ". Uji kirim: "Notifikasi uji dari Panel
Termux. Kalau pesan ini sampai, notifikasi sudah siap." Tautan menuju panel yang dilindungi Cloudflare Access/login —
benar, dan dijelaskan di README.

### 3.9 Kebutuhan ke PLAN/01 (komponen bersama; nama props yang saya pakai)

- `DataTable<T>` (tambahan): `rowActions?: (row: T) => ReactNode` (slot kanan: 1 tombol utama + menu ⋯; di HP tampil di
  bawah kartu), `rowHref?: (row: T) => string` (baris = tautan, aksi tidak ikut tertaut), `rowTone?: (row: T) =>
  StatusTone | undefined` (garis kiri berwarna untuk baris bermasalah), `columns[].hidden?: boolean`. `error` menerima
  `ApiError` atau node. Urutan baris ditentukan pemanggil (saya urutkan: bermasalah dulu).
- `LogViewer`: `lines: LogLine[]`, `label: string`, `loading`, `error?: ReactNode`, `following: boolean`,
  `onFollowChange(v)`, `newCount` (untuk "Baris baru (n)"), `toolbarStart?: ReactNode` (segmented stdout/stderr),
  `downloadHref?: string`, `maxLines` (default 2.000, teks "Menampilkan 2.000 baris terakhir"), `emptyText`,
  `notice?: ReactNode` ("Log ditampilkan apa adanya; pola rahasia umum disamarkan."). Cari, bungkus baris, salin,
  layar penuh (sheet) di HP, `role="log"` + fokus keyboard = milik komponen. Kolom waktu `HH.mm.ss` lokal dari `at`.
- Hook follow (`useLogFollow(url, { intervalMs: 3000, enabled })`) saya tulis di `src/web/panel/use-log-follow.ts`;
  bila PLAN/01 ingin memilikinya untuk `/dev/logs`, pindahkan ke `src/web/shared/` di gelombang 3.
- `ConfirmAction` tier `"none" | "confirm" | "typed"` dengan `typedValue` dan `confirmLabel` kata kerja + objek.
- `useApiQuery(url, { refreshMs, pauseHidden: true })`: lewati tick saat tersembunyi + reload saat terlihat; tick
  interval **tidak** meng-abort request yang masih jalan (tick dilewati); backoff error 10→20→40→60 dtk; mengembalikan
  `updatedAt` (waktu respons sukses terakhir).
- Pure formatter (`formatBytes`, `formatDuration`, `formatNumber`) dipindah ke `src/shared/format.id.ts` dan di-re-export
  dari `src/web/shared/format.ts`, supaya `problem.copy.ts` dan pesan Telegram server memakainya. Bila PLAN/01 menolak,
  `problem.copy.ts` mengimpor langsung dari `src/web/shared/format.ts` (modul murni; tercatat sebagai utang).
- Bottom bar/sheet: badge masalah di item "Ringkasan" memakai `GET /api/panel/status` (poll 60 dtk, jeda saat
  tersembunyi) — P2, hanya bila PLAN/01 menyediakan slot `badge` di `NavItem`.

---

## 4. Flow

### 4.1 Boot dan sampler

1. `start()` (`src/server/index.ts`): setelah migrations, `const monitor = monitorFor({ db, secret, dataDir, system, appBaseUrl, panelPort })`.
   Server HTTP mulai; `monitor.sampler.start()` menjadwalkan tick pertama **10 dtk** setelah boot (server tenang dulu).
2. Seed state dari DB: counter gagal per domain dari 3 `check_result` terakhir tiap host; problem terbuka dari
   `problem_event` (jadi `since` dan status notifikasi bertahan restart). Ring restart app kosong (crash loop baru bisa
   terdeteksi 10 mnt setelah boot — dicatat).
3. Tick: (a) `snapshot.refreshAll()` paralel: `pm2.list` ‖ `runit.list` ‖ `device.read` ‖ `cloudflared.listIngress` ‖
   `backup.status` (dibungkus try). (b) probe semua domain yang bisa diprobe paralel (timeout 8 dtk sudah ada); yang
   gagal → `net.httpStatus(port)` lokal (bila port ada). (c) bila semua gagal tanpa jawaban → probe konektivitas.
   (d) `computeProblems`. (e) satu transaksi: `metric_sample` + `check_result` + upsert `problem_event`. (f) alert
   engine (kirim di luar transaksi). (g) retensi bila ≥ 1 jam sejak terakhir. (h) `log.debug("[monitor] tick 1234ms")`,
   `log.warn` bila > 20 dtk. Tick berikutnya dijadwalkan `interval − durasi` (min 5 dtk).
4. Kegagalan per langkah: bagian snapshot gagal → bagian itu `unavailable`, tick lanjut. Tulis DB gagal (mis. disk
   penuh) → `log.error` dengan operasi + sebab, tick lanjut ke alert (supaya `disk_low` tetap bisa terkirim). Alert
   gagal → backoff §3.8. Exception tak terduga di tick → `log.error`, tick berikutnya tetap dijadwalkan.
5. Shutdown: `stopScheduler` memanggil `backup.stop()` dan `sampler.stop()` (batal timer); `idle` menunggu tick yang
   sedang berjalan selesai (≤ batas shutdown yang ada).
6. `pm2 jlist` hang 20 dtk: bagian pm2 single-flight, tick yang menumpuk dilewati; UI tetap mendapat nilai lama
   (stale-while-revalidate, `sampledAt` menunjukkan umur).

### 4.2 Membuka Ringkasan

1. `GET /panel/overview`: `snapshot.get()` → bila cache ada (≤ 120 dtk) jawab segera, refresh bagian kedaluwarsa di
   belakang. Problems dihitung dari snapshot + state sampler (counter domain, ring restart, `since` dari event terbuka).
2. Sebelum tick pertama (≤ 10 dtk setelah boot): domain `checkedAt: null` → "Belum dicek", `sampledAt: null` → meta
   "Pemantauan latar dimulai…". Tidak ada problem domain.
3. Poll 10 dtk saat tab terlihat; berhenti saat tersembunyi; saat kembali terlihat langsung muat ulang.
4. Jaringan klien putus: data terakhir tetap tampil, `ErrorState` ringkas di atas ("Tidak bisa terhubung ke server.
   Data di bawah dari 2 mnt lalu."), backoff sampai 60 dtk.
5. Bagian `unavailable`: tile/kartu bagian itu diganti teks "Tidak bisa dibaca saat ini" + tautan Coba lagi; bagian
   lain normal. `backup_status_error` muncul sebagai problem (R4-G4) — overview tidak lagi 500.

### 4.3 Kontrol layanan/aplikasi

1. Tombol utama kontekstual: layanan/app tidak berjalan → **Mulai** (tanpa konfirmasi); berjalan → **Mulai ulang**
   (konfirmasi akibat). Menu ⋯: Hentikan, Lihat log.
2. Hentikan layanan biasa / app → konfirmasi akibat. Layanan protected → ketik nama; body `{ confirm: name }`.
   `lockout` → item menu nonaktif dengan alasan (§5.3), server tetap menolak 409 bila dipanggil langsung.
3. Server: validasi nama/aksi → `lockout` → `confirm_required` → kunci job (`job_running`) → `withLock` (`busy`) →
   `sv`/`pm2` → audit `service.<action>`/`app.<action>` (+ `meta.confirmTyped: true` untuk stop protected) →
   `snapshot.invalidate(section)` → kembalikan item.
4. Klien: toast `doneBy` (bentuk lampau) + reload. Error → toast pola error dari `errorCodes`.
5. Dua admin bersamaan → yang kedua 409 `busy` ("Masih ada aksi lain yang berjalan…"). Aksi selama job situs → 409
   `job_running` ("Perubahan situs sedang berjalan…").
6. Jaringan putus saat request kontrol: toast "Tidak bisa memastikan hasilnya karena koneksi terputus. Muat ulang untuk
   melihat kondisi terbaru." dan query otomatis dimuat ulang saat online.
7. `pm2` tidak berjalan → aksi app 503 `pm2_unavailable` ("pm2 tidak berjalan. Mulai layanan pm2 dulu.").

### 4.4 Restart panel / cloudflared (putus yang diharapkan)

1. Admin memilih Mulai ulang `panel` → dialog konfirmasi: "Halaman ini terputus ±10–30 dtk lalu tersambung lagi.
   Perubahan dan cadangan yang sedang berjalan membuat permintaan ini ditolak."
2. Server: cek kunci job/deploy/backup (`job_running` bila ada) → audit `service.restart` (sebelum restart, supaya
   tercatat) → balas **202** `{ deferred: true, service: "panel", bootId }` → `setTimeout(500)` →
   `runit.restartDetached("panel")`.
3. Klien: overlay modal (fokus terkunci, `role="alertdialog"`, `aria-live`) "Panel dimulai ulang… Menyambung ulang."
   Poll `GET /api/health` tiap 2 dtk (fetch gagal, 502/530 HTML dari Cloudflare, dan halaman login Access = "belum
   kembali"). Kembali = JSON `ok` dengan `bootId` ≠ lama → tutup overlay, toast "panel dimulai ulang.", muat ulang
   semua query. Bila versi berubah → reload halaman penuh (bundle SPA baru).
4. 90 dtk tanpa kembali → overlay berubah jadi error: "Panel belum tersambung lagi. Cek lewat SSH: `sv status panel`
   dan `tail $PREFIX/var/log/sv/panel/current`." + tombol Coba lagi (lanjut poll) dan Tutup.
5. Cloudflared: sama, tetapi poll `GET /api/panel/ping`; teks "Semua domain terputus beberapa detik selama tunnel
   cloudflared dimulai ulang." Tanpa Cloudflare (akses lokal `127.0.0.1`) ping langsung sukses — overlay tertutup cepat.
6. Restart terjadi saat sesi Access kedaluwarsa → health mengembalikan HTML login → overlay tidak tertutup; teks error
   di langkah 4 menambah "Bila kamu memakai Cloudflare Access, muat ulang halaman untuk login lagi."

### 4.5 Log (follow)

1. Buka `/panel/services/:name/log` → `GET …/log?lines=500` → `LogChunk`, simpan `cursor`.
2. Follow aktif (default aktif di desktop, mati di HP untuk hemat) → poll 3 dtk `…/log?after=<cursor>`; baris baru
   ditambahkan; buffer DOM dipotong ke 2.000 baris.
3. Pengguna gulir ke atas → follow mati otomatis (milik `LogViewer`), baris baru dihitung → tombol "Baris baru (n)".
4. `reset: true` (rotasi svlogd ±3,6 jam untuk `pm2`; pm2-logrotate tengah malam) → buffer diganti, sisipkan penanda
   "— file log diputar —". File hilang → `lines: []` + teks kosong.
5. Tab tersembunyi → poll berhenti. Kembali → satu request `after` (maks 256 KiB, `truncated` → penanda "Sebagian
   baris dilewati").
6. Unduh → tautan biasa ke `…/log/download` (cookie sesi ikut; GET jadi tak terkena cek origin mutasi); audit dicatat.

### 4.6 Alert (per tick, setelah problems dihitung)

1. Masukan: `problems` dengan kode yang punya delay (bukan "–") dan `severity ≥ alerts.min_severity`.
2. Untuk tiap problem: tidak ada event terbuka untuk `key` → insert (`opened_at = now`); ada → update severity (maks)
   dan params.
3. Event terbuka yang `key`-nya tidak ada lagi → `closed_at = now`.
4. Tentukan item kirim untuk event terbuka, dan event tertutup ≤ 24 jam dengan `notified_state = 'open'`:
   - terbuka dan `now − opened_at < delay` → lewati;
   - terbuka dan (`notified_state ≠ 'open'` **atau** severity naik di atas `notified_severity` **atau**
     `now − last_sent_at ≥ 24 jam`) → item "buka"/"masih";
   - tertutup dan `notified_state = 'open'` → item "pulih" (dengan lama berlangsung);
   - tertutup dan `notified_state` null → senyap, **kecuali** `internet_down` yang berlangsung ≥ 5 mnt → item "pulih"
     ("HP sempat tidak terhubung internet selama 14 mnt");
   - `last_sent_at` < 15 mnt lalu → tunda (kecuali eskalasi ke danger).
5. Kanal tidak terkonfigurasi/dimatikan → tidak kirim, tidak menandai (item tetap "jatuh tempo" → `pending`).
   Mengaktifkan kanal nanti hanya mengirim yang **masih terbuka** (yang sudah pulih dan tak pernah diberitahukan tetap
   senyap).
6. Ada item → satu pesan (§3.8). Sukses → tandai `notified_state`, `notified_severity`, `last_sent_at`. Gagal → tanpa
   tanda; backoff; `AlertStatus.lastError`.
7. Internet putus: semua kirim gagal (`telegram_unreachable`) → backoff; saat pulih, rekonsiliasi hanya mengirim
   selisih **saat itu** (masalah yang buka-tutup selama offline tidak dikirim, kecuali `internet_down` di atas).
8. Panel restart: event terbuka ada di DB → tidak dikirim ulang. Masalah yang pulih selama panel mati → ditutup pada
   tick pertama, "pulih" terkirim bila sebelumnya diberitahukan.

### 4.7 Menyiapkan Telegram (UI di PLAN/05; API di sini)

1. Super admin membuat bot di @BotFather, menempel token di Pengaturan → `PUT /api/dev/settings/alerts.telegram_bot_token`.
2. Mengirim pesan apa saja ke bot (atau menambahkan bot ke grup) → klik "Cari chat" → `POST /api/dev/alerts/telegram/chats`
   → pilih chat → disimpan ke `alerts.telegram_chat_id`.
3. Klik "Kirim notifikasi uji" → `POST /api/dev/alerts/test` → toast "Notifikasi uji terkirim." atau pesan dari kode error
   (§5.7). Uji kirim tidak memakai cooldown alert dan tidak mengubah `problem_event`.
4. Token salah → `telegram_token_invalid`; bot belum di-chat → daftar chat kosong ("Belum ada chat. Kirim pesan ke bot
   kamu di Telegram, lalu cari lagi."); webhook aktif → `telegram_webhook_set`.

### 4.8 Database

1. Buka `/panel/databases` → `GET` sekali (tanpa polling), tombol muat ulang di `PageHeader`.
2. Layanan `postgres` tidak `run` → 503 `postgres_down` → `ErrorState` "Layanan postgres tidak berjalan. Situs yang
   memakai database tidak bisa diakses." + tautan ke Layanan.
3. Kosong → `EmptyState` "Belum ada database. Database dibuat otomatis saat kamu membuat situs dengan PostgreSQL."

---

## 5. Spesifikasi UI per halaman

Umum: setiap halaman memakai `PageHeader` (judul h1, `meta={{ updatedAt, onRefresh, refreshing, live }}`), status pakai
`StatusBadge` (titik + teks), kosong `EmptyState`, error `ErrorState`, loading skeleton dari `components/skeletons.tsx`.
`QueryView` lama dan `StatCard` lama tidak dipakai lagi di halaman panel. Target sentuh ≥ 44 px di < md untuk tombol aksi
dan baris (keputusan default brief). Kedua tema: hanya token (`text-warning`, `bg-danger-subtle`, …), tidak ada kelas
warna Tailwind mentah (banner demo yang `amber-*` diganti tone `warning`).

### 5.1 Ringkasan (`/panel`)

Urutan (desktop maks-lebar konten; HP satu kolom):

1. `PageHeader` "Ringkasan", meta "Diperbarui 12 dtk lalu" (`generatedAt`). Mode demo → `StatusBadge tone="warning"`
   "Mode demo" di `actions` + kalimat `fakeMode` di `description`.
2. **Strip masalah** (`Section` tanpa judul bila kosong):
   - Kosong → satu baris `StatusBadge tone="success"` "Semua sehat" + "dicek 40 dtk lalu" (`sampledAt`).
   - Ada → daftar `<ul>`; tiap baris: `StatusBadge` ("Gawat"/"Peringatan"), judul (`problem.copy` title), detail satu
     kalimat, "sejak 12 mnt" (`RelativeTime` dari `since`), tautan "Lihat" ke `href` (+ "Lihat log" untuk app/service).
     Danger dulu. Maks 5 baris di HP, sisanya "Tampilkan N lainnya" (disclosure).
   - Region `sr-only` `aria-live="polite"` hanya diperbarui bila himpunan `id` berubah: "1 masalah baru: Layanan
     postgres mati." / "Masalah selesai: …". Tidak diumumkan tiap poll.
3. **Tile perangkat** `grid grid-cols-2 lg:grid-cols-4 gap-2` dengan `StatTile` (tinggi ±76 px, 2×2 ≤ 170 px di 390 px):
   - Baterai: value "88%", hint "Tidak dicas" (nada warning bila `unplugged`; danger bila `battery_low`), "Sedang dicas",
     "Dicolok, tidak mengisi" (netral, `NOT_CHARGING`), "Penuh". `null` → value "–", hint "Tidak tersedia
     (pasang Termux:API)".
   - Suhu: "38,0 °C"; `null` → "Tidak tersedia". Nada dari ambang yang sama dengan server (45/50).
   - Memori: value "4,1 GB tersedia", progress = terpakai %, `thresholds={{ warn: 90, danger: 97 }}`, hint "dari 11,0 GB".
   - Penyimpanan: value "170,3 GB bebas", progress terpakai %, `thresholds={{ warn: 90, danger: 95 }}` (= aturan
     server 10%/5% bebas), hint "dari 232,0 GB".
   - Di bawah grid, satu baris teks kecil: "Beban sistem 20,9 · 20,7 · 20,0" + (baseline) "· biasanya 18–22" dengan
     nada dari K4, atau (tanpa baseline) "· nilai biasanya muncul setelah 1 hari pemantauan". Tombol ikon info
     (`aria-label="Tentang beban sistem"`, ≥ 44 px di HP) membuka `Popover`: "Di Android angka ini mencakup proses sistem
     dan semua aplikasi HP, jadi biasanya tinggi. Yang penting adalah perubahan dari nilai biasanya." Lalu "Waktu aktif
     HP 3 hari 4 jam".
4. **Hitungan resource** `grid grid-cols-2 lg:grid-cols-4`: Situs, Layanan, Aplikasi, Domain — tiap kartu tautan
   (`Link`, fokus terlihat) berisi jumlah + `StatusBadge`: "Semua berjalan" (success) / "1 mati" (danger) / "1 perlu
   dicek" (warning), dihitung dari `problems` per `kind`. Bagian `unavailable` → "Tidak bisa dibaca".
5. **Cadangan** (satu baris `KeyValue`): "Cadangan terakhir: berhasil · 6 jam lalu · berikutnya 03.00", atau badge
   danger/warning bila ada problem backup; `null` → "Status cadangan tidak bisa dibaca".
6. **Notifikasi** (satu baris): `ok` → "Notifikasi Telegram aktif"; `not_configured` → "Notifikasi belum diatur. Tanpa
   notifikasi, masalah baru terlihat saat kamu membuka panel." + tautan "Atur di Pengaturan" (super_admin) atau
   "Minta Super Admin mengaturnya" (admin); `failing` → ditangani problem `alerts_failing`.
7. **Aktivitas terbaru**: 5 entri audit (aktor, aksi, target, `RelativeTime`), tautan "Lihat semua" ke `/dev/audit`
   **hanya untuk super_admin** (halaman audit super_admin). Kosong → "Belum ada aktivitas."
8. **Riwayat masalah** (gelombang 3): 5 event tertutup terbaru + "Lihat riwayat" → `/panel/problems` (DataTable +
   `pagination`).

States: loading pertama = skeleton strip + 4 tile + 4 kartu; error total (401/network tanpa data) = `ErrorState` dengan
Coba lagi; partial = per bagian (§4.2 langkah 5).

### 5.2 Layanan (`/panel/services`)

`PageHeader` "Layanan", deskripsi "Layanan runit yang menjalankan panel, tunnel, database, dan aplikasi." Poll 10 dtk.
`DataTable` kolom: **Nama** (`primary`, font mono, badge "Inti" bila protected), **Status** (§5.6 kosakata), **Sejak**
("aktif 3 jam" / "mati 33 jam" dari `uptimeSec`/`downSec`), **PID** (`hideOnMobile`). `rowTone` danger untuk
`service_down`. `rowActions`: tombol utama (Mulai / Mulai ulang) + menu ⋯ (Hentikan, Lihat log). Urutan: bermasalah,
lalu alfabetis. Kosong: "Belum ada layanan runit. Panel membaca layanan dari `$PREFIX/var/service`." Error 502: "Daftar
layanan tidak bisa dibaca. Coba lagi; bila terus gagal, cek runit lewat SSH."

Tier konfirmasi:

| Aksi        | Biasa   | Protected (`sshd`, `pm2`, `postgres`) | `panel`, `cloudflared` |
| ----------- | ------- | ------------------------------------- | ---------------------- |
| Mulai       | none    | none                                  | none                   |
| Mulai ulang | confirm | confirm + akibat                      | confirm + overlay §4.4 |
| Hentikan    | confirm | typed (ketik nama)                    | nonaktif, alasan       |

Teks akibat per layanan (`id.panel.serviceImpact`): `pm2` "Semua aplikasi ikut berhenti; situs tidak bisa diakses
sampai pm2 dan aplikasinya berjalan lagi." · `postgres` "Situs yang memakai database tidak bisa diakses sampai
postgres berjalan lagi." · `sshd` "Sesi SSH yang terbuka terputus dan kamu tidak bisa masuk lewat SSH sampai sshd
dijalankan lagi." · `cloudflared` (sudah ada `tunnelWarning`) · `panel` "Halaman ini terputus ±10–30 dtk lalu tersambung
lagi." Alasan lockout: "Menghentikan {name} memutus akses ke panel ini, dan panel tidak bisa menyalakannya lagi. Hentikan
lewat SSH bila memang perlu."

### 5.3 Aplikasi (`/panel/apps`)

`PageHeader` "Aplikasi", deskripsi "Aplikasi yang dijalankan pm2." Poll 10 dtk. `DataTable` kolom: **Nama** (`primary`),
**Status**, **Situs** (tautan ke `/panel/sites/<site>` atau "–"), **Memori** ("62 MB", `align="right"`), **Waktu aktif**,
**Dimulai ulang** ("4×", nada warning bila `app_crash_loop`), **Port** (`hideOnMobile`), **CPU** (`hidden` bila semua
`cpu === null`). `rowActions` seperti Layanan; Hentikan app milik situs: confirm dengan "Situs {site} tidak bisa diakses
sampai aplikasinya dimulai lagi." Modul pm2 (`module: true`) tidak masuk tabel utama; di bawahnya `<details>` "Modul pm2
(1)" berisi daftar ringkas tanpa aksi. `pm2_unavailable` → `ErrorState` "pm2 tidak berjalan. Semua aplikasi ikut tidak
berjalan." + tombol tautan "Buka Layanan". Kosong (pm2 jalan, 0 app): "Belum ada aplikasi. Aplikasi muncul setelah kamu
membuat situs atau menambahkannya ke `ecosystem.config.js`."

### 5.4 Domain (`/panel/domains`)

`PageHeader` "Domain", deskripsi "Domain dari tunnel cloudflared dan hasil cek terakhirnya." Poll 30 dtk. `DataTable`
kolom: **Domain** (`primary`, tautan `target="_blank" rel="noopener"` dengan `aria-label` "Buka {host} di tab baru"),
**Tujuan** ("Situs blog · aplikasi blog-app" / "Panel Termux" / "Layanan lain (localhost:8080)" / "Tanpa tujuan"),
**Status** (badge + penjelasan satu kalimat, lihat tabel), **Respons** ("85 ms"), **24 cek terakhir** (strip 30 batang
2×12 px: hijau sehat, merah gagal, abu belum dicek; `role="img"` `aria-label` "28 dari 30 cek terakhir sehat";
`hideOnMobile` → di HP diganti teks "28/30 sehat"), **Dicek** (`RelativeTime`). `rowActions`: "Cek ulang" (spinner,
nonaktif 10 dtk setelah ditekan; 429 → toast "Tunggu sebentar sebelum mengecek lagi.").

Penjelasan status (fungsi murni `domainVerdict(health)` di `panel.status.ts`, menggantikan `healthTone`):

| Kondisi                 | Label / nada                  | Penjelasan                                                                                                                             |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `checkedAt null`        | Belum dicek / neutral         | "Cek pertama berjalan dalam 1 mnt."                                                                                                    |
| 2xx–3xx                 | Sehat / success               | –                                                                                                                                      |
| 401, 403                | Butuh login / info            | "Domain menjawab, tapi meminta login (mungkin Cloudflare Access)."                                                                     |
| 4xx lain                | Menjawab {status} / info      | "Aplikasi berjalan, tetapi halaman utama menjawab {status}."                                                                           |
| 5xx, `failures < 3`     | Tidak stabil / warning        | "Gagal {n}× berturut-turut. Ditandai bermasalah setelah 3×."                                                                           |
| 502/504, `failures ≥ 3` | Tidak sehat / danger          | `local` ada → "Aplikasi di HP menjawab {local}, jadi masalahnya di tunnel." · `local` null → "Aplikasi di port {port} tidak menjawab." |
| 530, `failures ≥ 3`     | Tunnel terputus / danger      | "Cloudflare tidak terhubung ke tunnel cloudflared di HP."                                                                              |
| `null`, `failures ≥ 3`  | Tidak bisa dijangkau / danger | sama dengan baris 502 untuk `local`                                                                                                    |
| app `stopped`           | Aplikasi dihentikan / neutral | "Aplikasi {app} sengaja dihentikan."                                                                                                   |
| wildcard                | Tidak dicek / neutral         | "Domain wildcard tidak dicek otomatis."                                                                                                |

Kosong: "Belum ada domain. Tambahkan domain dari halaman situs, atau tulis aturan di `~/.cloudflared/config.yml`."

### 5.5 Database (`/panel/databases`)

`PageHeader` "Database" + tombol muat ulang (tanpa `live`). `DataTable` kolom: **Nama** (`primary`, mono), **Situs**
(tautan / "–"), **Pemilik**, **Ukuran** (`align="right"`), **Cadangan terakhir** (`RelativeTime` / "Belum pernah",
nada warning bila > 36 jam). Error/kosong §4.8.

### 5.6 Kosakata status (`id.panel`)

| Kondisi                   | Label            | Nada         |
| ------------------------- | ---------------- | ------------ |
| service `run`             | Berjalan         | success      |
| service `down`, `!wantUp` | Dihentikan       | neutral      |
| service `down`, `wantUp`  | Mati tak terduga | danger       |
| service `finish`          | Sedang berhenti  | warning      |
| service `unknown`         | Tidak diketahui  | neutral      |
| app `online`              | Berjalan         | success      |
| app `stopped`             | Dihentikan       | neutral      |
| app `errored`             | Bermasalah       | danger       |
| app `launching`           | Memulai…         | info (pulse) |
| app `unknown`             | Tidak diketahui  | neutral      |

String "lama" `refreshing`, `confirmBody`, `done` dihapus dari `id.panel.ts` bersama pemakainya (R2-G21). `load` diganti
"Beban sistem (1/5/15 mnt)".

### 5.7 Copy masalah (`src/shared/problem.copy.ts`) — `title(p)` dan `detail(p)`

| code                    | title                                         | detail                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_down`          | Layanan {target} mati                         | Seharusnya berjalan. Mati sejak {downSec→durasi}.                                                                                                                                                                                                                             |
| `pm2_unavailable`       | pm2 tidak berjalan                            | Semua aplikasi ikut tidak berjalan. Mulai layanan pm2.                                                                                                                                                                                                                        |
| `app_errored`           | Aplikasi {target} bermasalah                  | pm2 berhenti mencoba setelah {restarts}× gagal. Lihat log stderr.                                                                                                                                                                                                             |
| `app_crash_loop`        | Aplikasi {target} terus dimulai ulang         | {restarts10m}× dalam 10 mnt terakhir. Lihat log stderr.                                                                                                                                                                                                                       |
| `domain_unreachable`    | {target} tidak bisa dijangkau                 | (lihat tabel §5.4 untuk `local`)                                                                                                                                                                                                                                              |
| `domain_http_error`     | {target} menjawab HTTP {status}               | (lihat tabel §5.4)                                                                                                                                                                                                                                                            |
| `internet_down`         | HP tidak terhubung ke internet                | Semua domain tidak bisa dijangkau dari HP. Notifikasi terkirim setelah koneksi pulih.                                                                                                                                                                                         |
| `backup_not_configured` | Cadangan belum diatur                         | Tanpa cadangan, data situs hilang bila HP rusak. Atur penyimpanan R2/S3.                                                                                                                                                                                                      |
| `backup_failed`         | Cadangan terakhir gagal                       | Lihat detailnya di halaman Cadangan.                                                                                                                                                                                                                                          |
| `backup_partial`        | Cadangan terakhir hanya sebagian berhasil     | Lihat item yang gagal di halaman Cadangan.                                                                                                                                                                                                                                    |
| `backup_stale`          | Tidak ada cadangan dalam {hours} jam terakhir | Cadangan harian mungkin tidak berjalan.                                                                                                                                                                                                                                       |
| `backup_status_error`   | Status cadangan tidak bisa dibaca             | Pengaturan cadangan tidak bisa dibuka, mungkin kunci data berubah. Isi ulang di Pengaturan.                                                                                                                                                                                   |
| `disk_low`              | Penyimpanan hampir penuh                      | Tinggal {freePct}% ({freeBytes→ukuran}) bebas.                                                                                                                                                                                                                                |
| `battery_unplugged`     | HP tidak sedang dicas                         | Baterai {percent}%. Server ikut mati bila baterai habis. Colokkan charger.                                                                                                                                                                                                    |
| `battery_low`           | Baterai tinggal {percent}% dan tidak dicas    | Colokkan charger sekarang agar server tidak mati.                                                                                                                                                                                                                             |
| `battery_hot`           | Baterai panas ({temperatureC} °C)             | Pindahkan HP ke tempat sejuk atau lepas casingnya.                                                                                                                                                                                                                            |
| `alerts_failing`        | Notifikasi Telegram gagal terkirim            | per `reason`: token → "Token bot ditolak Telegram. Periksa token di Pengaturan." · chat → "Chat tujuan tidak ditemukan. Kirim pesan ke bot, lalu pilih chat lagi." · forbidden → "Bot diblokir atau dikeluarkan dari grup." · lain → "Telegram tidak bisa dijangkau dari HP." |

Recovery Telegram generik: "PULIH · {title} · berlangsung {durasi}". `errorCodes` baru di `id.panel`: `lockout`,
`confirm_required` ("Ketik nama layanan untuk menghentikannya."), `job_running` ("Perubahan situs sedang berjalan.
Tunggu sampai selesai, lalu coba lagi."), `pm2_unavailable`, `postgres_down`, `too_soon`, `invalid_cursor` ("Posisi log
tidak valid. Muat ulang log.") dan semua `AlertErrorCode` + `alerts_not_configured`, `alerts_token_missing`,
`telegram_webhook_set` (untuk PLAN/05).

### 5.8 Log (`/panel/services/:name/log`, `/panel/apps/:name/log`)

`PageHeader` judul "Log {name}", breadcrumb Layanan/Aplikasi › {name} (menggantikan tombol "Kembali" manual).
`LogViewer` (PLAN/01) mengisi sisa tinggi viewport; `toolbarStart` = segmented stdout/stderr (hanya app); `notice` =
"Log ditampilkan apa adanya; pola rahasia umum (kata sandi di URL database, `*_TOKEN=`, `*_SECRET=`, `Bearer …`)
disamarkan." Selektor jumlah baris dihapus (tetap 500 awal, follow menambah). Kosong: teks `log.empty` yang ada.
Stderr: baris berlatar `danger-subtle` (stream `err` seluruhnya).

Redaksi server (`log.parse.ts`), diterapkan pada tail, follow, dan unduh:
`(postgres(?:ql)?|mysql|mariadb|redis|rediss|mongodb(?:\+srv)?|amqps?)://[^:/\s@]+:[^@\s]+@` → `$1://***:***@` ·
`\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+` → `$1=***` ·
`\bBearer\s+[A-Za-z0-9._~+/=-]{8,}` → `Bearer ***` · `\b\d{6,16}:[A-Za-z0-9_-]{30,}\b` → `***` (token bot).
Parse svlogd: `^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2}:\d{2})\.(\d+) ` → `at = "<tanggal>T<jam>.<ms>Z"`, `text` = sisa baris.

### 5.9 Interval polling

| Halaman / pemakai               | Interval saat terlihat  | Catatan                           |
| ------------------------------- | ----------------------- | --------------------------------- |
| Ringkasan                       | 10 dtk                  | cache server → `jlist` ≤ 1/15 dtk |
| Layanan, Aplikasi               | 10 dtk                  | sama                              |
| Domain                          | 30 dtk                  | probe 60 dtk oleh sampler         |
| Database                        | tidak                   | tombol muat ulang                 |
| Log follow                      | 3 dtk                   | baca file saja, tanpa `jlist`     |
| Riwayat masalah, metrik         | tidak                   |                                   |
| Badge nav (`/panel/status`, P2) | 60 dtk                  | tanpa perintah sistem             |
| Overlay restart                 | 2 dtk, maks 90 dtk      |                                   |
| Tersembunyi                     | berhenti semua          | `useApiQuery` PLAN/01             |
| Error                           | backoff 10→20→40→60 dtk |                                   |

**Biaya diharapkan (diukur ulang di kriteria penerimaan):** idle (tanpa tab) ≈ 0,5 dtk CPU `jlist` + ±0,05 dtk lain per
menit ≈ **0,9% satu inti**; satu tab Ringkasan ≈ +1,7% (jlist tiap ±20 dtk) ≈ **2,6%**; N tab ≈ sama. Request log
polling tidak lagi tertulis ke flash.

---

## 6. Kriteria penerimaan

**Unit (bun test)**

- [ ] `tests/panel.problems.test.ts`: tiap baris tabel §3.1 punya kasus positif dan negatif; app `stopped` → tidak ada
      problem; domain app `stopped` → tidak ada problem; domain 1–2 gagal → tidak ada problem, 3 gagal → ada; 4xx → tidak
      ada; semua null + konektivitas gagal → hanya `internet_down`; `battery_low` menggantikan `battery_unplugged`;
      `NOT_CHARGING` dicolok → tidak ada; `pm2_unavailable` menggantikan `service_down:pm2`; urutan deterministik.
- [ ] `tests/panel.parsers.test.ts`: `downSec` dari `down: …: 120971s`; `plugged`/`health`; suhu hilang → `null`;
      `pmx_module` → `module`; adapter termux `cpu === null`.
- [ ] `tests/log.parse.test.ts`: prefix svlogd → ISO UTC; baris tanpa prefix → `at: null`; tiap pola redaksi (dan
      kalimat biasa tidak tersentuh); cursor: append, `reset` saat ino beda / size < offset, `truncated` > 256 KiB.
- [ ] `tests/monitor.snapshot.test.ts`: dua `get()` bersamaan = satu panggilan adapter; nilai lama dijawab saat refresh
      berjalan; `invalidate` memaksa refresh; bagian gagal → `unavailable` tanpa melempar.
- [ ] `tests/monitor.sampler.test.ts` (jam palsu): tick menulis 1 `metric_sample` + N `check_result`; tick tumpang
      tindih dilewati; retensi menghapus > 7 hari; seed counter dari DB setelah "restart"; `loadBaseline` null < 24 jam.
- [ ] `tests/alert.engine.test.ts`: delay per kode; satu digest untuk banyak perubahan; cooldown 15 mnt; eskalasi
      menembus cooldown; pengingat 24 jam; pulih hanya bila pernah diberitahukan; `internet_down` ≥ 5 mnt kirim pulih;
      restart (state dari DB) tidak kirim ulang; plafon 20/jam; gagal kirim tidak menandai.
- [ ] `tests/telegram.client.test.ts` (fetch palsu): pemetaan 401/400/403/429/5xx/timeout; **token tidak muncul** di
      pesan error dan di `log` ring; escape HTML; potong > 3.500 karakter.
- [ ] `tests/web.panel.test.ts`: `domainVerdict` semua baris tabel §5.4; kosakata §5.6; `problem.copy` setiap `code`
      punya title+detail (test iterasi atas daftar kode); tier konfirmasi per layanan.
- [ ] `tests/db.migrate.test.ts` tetap hijau; migration bisa dijalankan dua kali (IF NOT EXISTS).

**Integrasi API (`tests/panel.api.test.ts`, mode fake, DB test)**

- [ ] `GET /panel/overview` saat `backup.status` melempar → 200, `backup: null`, `unavailable` berisi `backup`,
      problem `backup_status_error`.
- [ ] Stop `postgres` tanpa body → 409 `confirm_required`; dengan `{confirm:"postgres"}` → 200 + audit
      `meta.confirmTyped`; stop `panel`/`cloudflared` → 409 `lockout`; restart `panel` → 202 `DeferredRestart`,
      `restartDetached` dipanggil setelah respons (spy).
- [ ] Aksi saat kunci job PLAN/03 dipegang → 409 `job_running`.
- [ ] Mutasi tanpa header origin/`X-Requested-With` → ditolak (hotfix).
- [ ] `POST /dev/alerts/test` sebagai admin → 403; sebagai super_admin tanpa setting → 409; dengan fetch palsu → 200.
- [ ] `GET …/log/download` → `Content-Disposition`, isi diredaksi, audit `log.download`.
- [ ] `GET /panel/problems/history?pageSize=101` → 400 atau dibatasi 100 (pola `Page` yang ada).
- [ ] `request.log`: `GET /api/panel/overview 200` → level debug, tidak masuk ring di produksi; `POST … 409` → info.

**UI-QA di browser** (perlu izin owner untuk membuka browser, Rule 1; mode demo lokal + 390 px dan 1280 px, tema terang
dan gelap)

- [ ] Ringkasan 390 px: strip masalah + 4 tile terlihat tanpa scroll (≤ 1 layar 844 px tinggi); tile 2×2 ≤ 200 px.
- [ ] Mode demo memperlihatkan: battery unplugged, 1 app errored, 1 domain gagal, load ±20 dengan teks netral.
- [ ] Tidak ada "CPU 0%" di mana pun; tidak ada "0 °C".
- [ ] Layanan: Mulai tanpa dialog; Hentikan `postgres` meminta ketik nama; Hentikan `panel` nonaktif dengan alasan
      terbaca (bukan hanya `title`).
- [ ] Restart panel (mode demo: adapter fake mensimulasikan bootId baru setelah 5 dtk) → overlay → tersambung lagi →
      toast. Matikan jaringan DevTools → overlay error setelah 90 dtk.
- [ ] Log: follow berhenti saat gulir ke atas; "Baris baru (n)" muncul; layar penuh di HP; salin/unduh bekerja.
- [ ] Tab disembunyikan 1 mnt → tidak ada request `/api/panel/*` di Network panel.
- [ ] Pembaca layar (VoiceOver/TalkBack singkat): aria-live hanya bicara saat masalah berubah; strip heartbeat punya
      label; semua tombol ikon punya `aria-label`; fokus overlay terkunci dan kembali ke tombol semula.

**Di HP (POCO, izin owner, setelah deploy)**

- [ ] `top`/`ps -o time` proses panel: idle 10 mnt ≤ 1,2% satu inti rata-rata; satu tab Ringkasan ≤ 3%.
- [ ] `ls -l panel.db` setelah 24 jam: pertambahan ≤ 1 MB.
- [ ] Cabut charger → pesan Telegram "PERINGATAN · HP tidak sedang dicas" (senyap) dalam ≤ 8 mnt; colok → "PULIH".
- [ ] `sv stop` sebuah app uji → tidak ada problem/notifikasi; `pm2 stop` → tidak ada; app crash → notifikasi ≤ 2 mnt.

---

## 7. Rencana kerja

Gelombang berurutan; dalam satu gelombang tidak ada file yang dipegang dua worker. "Baris" = perkiraan kode+test.

**Gelombang 0 — kontrak (1 worker, kecil)**

| Worker             | File                                                                                                | Ukuran |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------ |
| `wkr-mon-types-00` | `src/shared/panel.types.ts`, `src/shared/monitor.types.ts` (baru), `src/shared/log.types.ts` (baru) | ±250   |

**Gelombang 1 — server inti (paralel; bergantung G0)**

| Worker                | File                                                                                                                                                                                                                                        | Ukuran |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-mon-adapters-01` | `src/server/system/{device.termux,pm2.termux,runit.termux,system.types,system.fake,file.tail}.ts`, `src/server/system/log.parse.ts` (baru), `tests/panel.parsers.test.ts`, `tests/log.parse.test.ts` (baru)                                 | ±500   |
| `wkr-mon-store-01`    | `src/server/db/schema/monitor.schema.ts` (baru), `src/server/db/schema/index.ts` (1 baris), `drizzle/00NN_monitor.sql`, `drizzle/meta/*`, `drizzle/migrations.js`, `src/server/monitor/monitor.history.ts`, `tests/monitor.history.test.ts` | ±450   |
| `wkr-mon-rules-01`    | `src/server/panel/overview.problems.ts`, `src/shared/problem.copy.ts` (baru), `tests/panel.problems.test.ts`                                                                                                                                | ±550   |
| `wkr-mon-alerts-01`   | `src/server/alerts/{alert.engine,telegram.client,alert.messages}.ts` (baru), `tests/alert.engine.test.ts`, `tests/telegram.client.test.ts` (baru)                                                                                           | ±700   |

Migration: orkestrator menetapkan nomor `00NN` sebelum gelombang ini agar tidak bentrok dengan migration PLAN/03/04/05.

**Gelombang 2 — wiring server + halaman (paralel; server bergantung G1; web bergantung G0 + PLAN/01 gelombang komponen)**

| Worker                    | File                                                                                                                                                                                                                                                                                                                                                                                                                        | Ukuran |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `wkr-mon-sampler-02`      | `src/server/monitor/{monitor.snapshot,monitor.sampler,monitor.service}.ts` (baru), `src/server/index.ts` (start/stop sampler, `bootId` di `/health`), `src/server/shutdown.ts` (bila perlu idle tambahan), `tests/monitor.snapshot.test.ts`, `tests/monitor.sampler.test.ts`, `tests/server.health.test.ts`                                                                                                                 | ±650   |
| `wkr-mon-api-02`          | `src/server/panel/panel.service.ts`, `src/server/panel/domain.health.ts` (dihapus/diserap snapshot), `src/server/routes/panel.routes.ts`, `src/server/routes/alerts.routes.ts` (baru), `src/server/routes/api.routes.ts` (1 baris mount), `src/server/http/request.log.ts`, `src/server/log.service.ts` (1 baris), `src/server/settings.service.ts` (6 kunci), `tests/panel.api.test.ts`, `tests/alerts.api.test.ts` (baru) | ±700   |
| `wkr-mon-web-overview-02` | `src/web/panel/overview.page.tsx`, `src/web/panel/overview.problems.tsx` (baru), `src/web/panel/device.tiles.tsx` (baru; hapus `device.cards.tsx`), `src/web/panel/overview.counts.tsx` (baru), `src/web/i18n/id.overview.ts` (baru), `src/web/i18n/id.ts` (1 baris)                                                                                                                                                        | ±550   |
| `wkr-mon-web-lists-02`    | `src/web/panel/{services,apps,domains,databases}.page.tsx`, `control.buttons.tsx`, `unit.card.tsx` (hapus), `use-panel-control.ts`, `panel.status.ts`, `panel.api.ts`, `restart.overlay.tsx` (baru), `status.badge.tsx` (hapus adapter lama bila PLAN/01 setuju), `src/web/i18n/id.panel.ts`, `tests/web.panel.test.ts`                                                                                                     | ±800   |

Konflik yang harus diatur orkestrator: `settings.service.ts` (PLAN/05 juga mengubahnya — saya hanya menambah 6 entri
registri dan mengganti satu default; urutkan setelah/sebelum perubahan struktur PLAN/05), `log.service.ts` dan
`request.log.ts` (R5-G12 juga menyentuh — saya ambil kepemilikan di gelombang ini), `index.ts` (PLAN/04 mungkin
menambah scheduler).

**Gelombang 3 — log, histori, polish (bergantung `LogViewer` PLAN/01 dan G2)**

| Worker               | File                                                                                                                                                                           | Ukuran |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `wkr-mon-logs-03`    | `src/web/panel/log.page.tsx`, `src/web/panel/use-log-follow.ts` (baru), `src/server/routes/panel.routes.ts` (download, bila belum di G2), test terkait                         | ±350   |
| `wkr-mon-history-03` | `src/web/panel/problems.page.tsx` (baru), `src/web/panel/sparkline.tsx` (baru), `src/web/panel/heartbeat.strip.tsx` (baru), `src/web/router.tsx` (1 route; koordinasi PLAN/01) | ±400   |

Dokumentasi (sekali di akhir, satu worker): README bagian "Pemantauan & notifikasi" (cara kerja sampler, biaya CPU/flash
jujur, setup Telegram, batas "panel tidak bisa melaporkan dirinya mati" + saran monitor luar, redaksi log tidak
sempurna), CHANGELOG `Added/Changed`.

Total ±6.000 baris termasuk test.

---

## 8. Risiko, asumsi, pertanyaan terbuka

**Risiko**

- **R1 Biaya sampler permanen** ±0,9% satu inti hanya untuk `jlist`. Bila pengukuran di HP > 1,2%, naikkan default
  interval ke 120 dtk (knob sudah ada) sebelum mengubah desain.
- **R2 Telegram API belum terverifikasi penuh** (§3.8): batas panjang, `retry_after`, `link_preview_options`. Implementer
  wajib membaca bagian `sendMessage`/`ResponseParameters` di docs resmi dulu; fallback aman: kirim tanpa
  `link_preview_options` bila 400.
- **R3 Redaksi log tidak sempurna**; UI dan README berkata begitu, tidak menjanjikan "aman".
- **R4 Zona waktu proses runit** bisa UTC di Termux bila `TZ` tidak diset; karena itu pesan memakai durasi relatif dan UI
  memformat waktu di browser. Fitur yang butuh jam lokal server (jam tenang) sengaja tidak dibuat.
- **R5 `restartDetached` panel**: bila `sv` detached ikut mati bersama proses panel di Android (kebijakan process group),
  panel tidak restart. Mitigasi: spawn dengan `detached: true` + `setsid` bila tersedia; test manual di HP wajib sebelum
  rilis. Fallback: tulis `t` lalu `u` ke `$SVDIR/panel/supervise/control` langsung (runsv yang me-restart, bukan anak panel).
- **R6 Tunnel**: overlay restart menganggap respons HTML 530 / halaman Access sebagai "belum kembali" — sesi Access
  habis bisa membuat overlay tidak pernah tertutup; ditangani teks error §4.4 langkah 6.
- **R7 Crash loop setelah restart panel** tidak terdeteksi 10 mnt pertama (ring di memori).
- **R8 Migration bentrok nomor** dengan PLAN lain — orkestrator menetapkan urutan.
- **R9 Kontrak internal berubah** (`Problem.message` hilang, `LogLines` → `LogChunk`, `device` nullable): semua konsumen
  ada di repo; test web/api diperbarui di gelombang yang sama.

**Asumsi**

- Hotfix CSRF (Origin sama + `X-Requested-With`) masuk; `apiFetch` sudah mengirim header itu.
- PLAN/03 menyediakan fungsi cek kunci job yang sinkron dan murah (dipanggil di setiap aksi kontrol).
- PLAN/01 menyediakan `DataTable`/`LogViewer`/`ConfirmAction`/`useApiQuery` dengan props §3.9 sebelum gelombang 2 web.
- PLAN/05 menampilkan grup "Notifikasi" di Pengaturan dengan tombol "Cari chat" dan "Kirim notifikasi uji" memakai API §3.7.
- Termux:API terpasang di HP produksi (terbukti saat riset); tanpa itu baterai `null` dan aturan baterai diam.

**Pertanyaan terbuka (untuk owner; default dipakai bila tidak dijawab)**

1. Peringatan (warning, mis. HP dicabut dari charger) ikut dikirim ke Telegram secara senyap? **Default: ya**
   (`alerts.min_severity = warning`).
2. Interval pemantauan 60 dtk (≈0,9% satu inti terus-menerus) atau 120 dtk (≈0,45%, deteksi lebih lambat)?
   **Default: 60 dtk**, bisa diubah di Pengaturan.
3. Masalah situs dari PLAN/03 (`site_job_failed`, `site_crash_loop`) ikut dikirim ke Telegram? **Default: ya**, delay 0.

**Ketergantungan lintas PLAN yang harus dihormati**

- PLAN/01: props §3.9; pindahkan formatter murni ke `src/shared/format.id.ts`; jangan menambah aturan masalah di klien;
  `StatusBadge`/`toneForStatus` tetap satu tabel (saya menambah label, bukan tone baru).
- PLAN/03: fungsi kunci job untuk kontrol; aturan dua kode `site_*` ditulis di `overview.problems.ts` (koordinasi lewat
  gelombang setelah G1), bukan file terpisah; restart cloudflared dari job situs tetap memakai jalur job, bukan 202.
- PLAN/04: `backup.status()` boleh melempar — saya yang menangkap; tolong jangan ubah bentuk `BackupStatus.lastRun`
  tanpa memberi tahu; isi `backup_run.items` (`kind: "database"`, `name`, `ok`) dipakai untuk "Cadangan terakhir" per DB.
  Notifikasi kegagalan cadangan (R4-G15) memakai mesin alert ini lewat kode `backup_*` — jangan buat kanal kedua.
- PLAN/05: kunci dan validator §3.6 apa adanya; teks label Indonesia §3.6; UI uji kirim/cari chat; `/dev/logs` memakai
  `LogLine` dari `src/shared/log.types.ts`; `request.log.ts`/`log.service.ts` dipegang PLAN/02 di gelombang 2.
