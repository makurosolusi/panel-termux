# PLAN 02 — Monitoring: Ringkasan, Layanan, Aplikasi, Domain, Database, Log, Sampler, Notifikasi

Penulis: wkr-plan-monitor-01 · Tanggal: 2026-11-26 · Basis: `feature/production-polish` @ 74fe380 · **Revisi 3**
(setelah debat: `PLAN/debate/02-critique.md`, `02-response.md`, `00-integration-critique.md`; diselaraskan dengan
`PLAN/DECISIONS.md` yang mengikat).

Sumber:

- `R&D/02-monitoring.md`: angka terukur di HP POCO.
- Silang dengan R&D-01 (shell, polling), R&D-03 (kunci job), R&D-04 (`backup.status` melempar → overview 500),
  R&D-05 (request log).
- Kontrak lintas PLAN mengikuti tabel `00-integration-critique.md` §2 dan jadwal global §5.

Angka biaya:

- `pm2 jlist`: 0,46–0,73 dtk wall, **0,54–0,66 dtk CPU** (diukur ulang oleh kritik).
- `sv status`: 0,01–0,02 dtk.
- `termux-battery-status`: 0,7–1,31 dtk wall.
- Probe HTTPS ±0,9 dtk; `gstatic generate_204` 0,32 dtk.
- Load idle ±20 di 8 inti; `/proc/stat` dan `/proc/loadavg` EACCES.

Konvensi: "Rx-Gn" = gap n di `R&D/0x`; "C-n" = temuan kritik; "X-n"/"K-n" = kritik integrasi.

---

## 1. Tujuan & ruang lingkup

**Tujuan.**

- Di layar 390 px, dalam 3 detik admin tahu ada yang rusak atau tidak, dan apa langkahnya.
- Panel memantau sendiri saat tidak ada yang membuka halaman, lalu memberi tahu lewat Telegram tanpa pesan palsu.
- Biaya CPU di HP terukur dan dibatasi.

**Masuk v0.3.0 (menutup gap):**

| Bagian                                                                                       | Menutup                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Ringkasan problem-first dari `problems` server, satu set aturan (termasuk kode PLAN/03, /04) | R2-G1, G2, G3, G18, G21, G22; R4-G4; X10 |
| `Problem` dengan `code` + `params` + `since` + `href`, penahanan akar masalah                | R2-G3; C2, C8                            |
| Tile perangkat jujur: load + baseline "biasanya …", tanpa CPU% palsu, suhu `null`            | R2-G6, G7, G27                           |
| Baterai rendah saja (charger sengaja dicabut-colok, A9/B3)                                   | R2-G11; C7                               |
| pm2 tidak berjalan = masalah, dan CLI pm2 tidak pernah meluncurkan daemon liar               | R2-G12; C6                               |
| Restart-loop runit dan pm2 (tanpa salah hitung restart manual)                               | R2 §2.2; C4, C5                          |
| Halaman Layanan/Aplikasi/Domain/Database dengan `DataTable` (01)                             | R2-G19, G20, G24, G26                    |
| Layanan inti + restart panel/cloudflared (putus yang diharapkan)                             | R2-G8; C9, C10                           |
| Domain: debounce 3 cek, cek lokal port, arti kode HTTP, cek ulang manual                     | R2-G13                                   |
| Satu sampler latar + cache snapshot                                                          | R2-G5, G15                               |
| Mesin alert (`problem_event`) + Telegram + notifikasi reboot                                 | R2-G14; R4-G15; C1–C3, C18, C19, C21     |
| Log: API cursor, redaksi; tampilan pakai `LogViewer` 01                                      | R2-G9, G17, G23                          |
| Request log polling ke `debug`                                                               | R2-G10; R5-G12                           |
| Histori 7 hari (`metric_sample`, `check_result`), sparkline, strip heartbeat domain          | R2-G16; A8                               |
| Riwayat masalah (`/problems/history` + halaman), badge nav `/panel/status`                   | R2-G16; R1-G26; A8                       |
| Unduh log dari server + audit `log.download`                                                 | R2 §4; A8                                |

Semua fitur masuk v0.3.0 (DECISIONS A8). Fitur histori dikerjakan di gelombang akhir (W4, §7).

**Bukan bagian PLAN ini** (tidak pernah direncanakan, bukan pemangkasan):

- Log rotasi `@….s`/`.gz` (R2-G25).
- Kanal selain Telegram (webhook/ntfy/email/Web Push) dan heartbeat keluar (R2-G28; README saja).

**Di luar PLAN ini:**

- Komponen `DataTable`, `LogViewer`, `ConfirmAction`, `usePoller`/`useApiQuery`, `useLogFollow`, `status.vocab`, `log.time.ts`, dan
  `format.id.ts` milik **PLAN/01**.
- UI Pengaturan dan `PATCH /api/dev/settings` milik **PLAN/05**.
- Data cadangan/keamanan milik **PLAN/04**. PLAN/04 hanya menyediakan input, aturannya ada di sini.
- Job situs milik **PLAN/03**.

---

## 2. Keputusan

| #   | Keputusan (dipilih)                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternatif ditolak                                    | Alasan                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| K1  | **Satu sumber aturan** di `src/server/panel/overview.problems.ts`, termasuk kode cadangan/keamanan PLAN/04 dan `site_job_failed` PLAN/03. Klien tidak punya aturan; `countProblems` dihapus. `/dev/health` (05) menurunkan cek `backup`/`storage` dari `problems` sampler terakhir.                                                                                                                                                                 | Aturan per domain (`backup.problems.ts`)              | Angka Ringkasan = angka notifikasi = angka Kesehatan sistem (X10). |
| K2  | **`Problem` = `{ id, code, kind, target, severity, params, since, href }`**; `message` dihapus. Teks dari `src/shared/problem.copy.ts` dipakai UI dan Telegram, dengan formatter dari `src/shared/format.id.ts` (01).                                                                                                                                                                                                                               | Teks di server; parse string Inggris                  | Satu teks; pengecualian sadar atas lokasi i18n.                    |
| K3  | **Penahanan akar masalah.** `computeProblems` → `{ problems, suppressed, unknownKinds }`. Problem yang ditahan tidak tampil di daftar, tidak menutup/membuka event, dan tidak dikirim (tabel §3.1 kolom "Menahan").                                                                                                                                                                                                                                 | N baris untuk satu sebab; "menggantikan" (tutup+buka) | C2, C8: penggantian menghasilkan "PULIH" palsu dan pesan berlipat. |
| K4  | **Kind yang tidak terbaca = tidak diketahui, bukan sehat.** Bagian snapshot yang gagal, atau baterai `null`, menandai kind-nya `unknown`. Event kind itu dibekukan.                                                                                                                                                                                                                                                                                 | Bagian gagal → `[]` → event tertutup                  | C1: `termux-battery-status` timeout itu sering.                    |
| K5  | **App `stopped` bukan masalah.** Masalah app hanya `errored` dan crash loop. Restart yang disengaja (`noteIntentionalRestart`: tombol panel, job PLAN/03) tidak dihitung; counter turun me-reset.                                                                                                                                                                                                                                                   | Lacak niat dari audit; hitung semua `restart_time`    | pm2 menambah `restart_time` juga untuk restart manual (C4).        |
| K6  | **Load + baseline HP ini.** "Beban sistem 20,9 · 20,7 · 20,0", netral sampai ada ≥ 24 jam sampel; lalu "· biasanya 18–22" (p10–p90 load5 7 hari) dan nada warning > 1,5× p50, danger > 2× p50 — **hanya tampilan**, tidak pernah Problem/notifikasi.                                                                                                                                                                                                | Ambang per-core (selalu merah)                        | R2 §6.1 opsi D lalu C; A8.                                         |
| K7  | **Tanpa CPU%.** Adapter termux selalu `cpu = null`; demo juga.                                                                                                                                                                                                                                                                                                                                                                                      | "CPU 0%"                                              | R2-G7.                                                             |
| K8  | **Baterai: hanya baterai rendah yang jadi masalah** (A9/B3; charger sengaja dicabut-colok). Satu kode `battery_low`: warning bila tidak mengisi (`status` bukan `charging`/`full`) dan `percent < monitor.battery_warn_percent` (default **25**, bisa `off`); danger bila tidak mengisi dan `percent < 15` (`BATTERY_DANGER_PERCENT`). "Tidak dicolok" bukan masalah (`battery_unplugged` dihapus). `battery_hot`: ≥ 45 °C warning, ≥ 50 °C danger. | Dua kode (unplugged/low); hanya `plugged`             | C2, C7; owner A9, B3.                                              |
| K9  | **Satu sampler latar** (rantai `setTimeout`, `monitor.sample_interval_sec` default 60) yang memperbarui snapshot, mem-probe domain, menghitung problems, dan menjalankan alert. Single-flight: tick yang tumpang tindih dilewati + `log.warn`. Tick pertama 10 dtk setelah boot.                                                                                                                                                                    | Tiga loop; SSE                                        | R2 §6.3.                                                           |
| K10 | **Cache snapshot per bagian, stale-while-revalidate, bagian membawa `at`.** TTL: runit/device/ingress 5 dtk; pm2 15 dtk; baterai 120 dtk. Domain = hasil probe sampler terakhir. Nilai ≤ 120 dtk langsung dijawab sementara refresh berjalan di latar. Aksi kontrol **mem-patch** item hasil aksi ke cache lalu menandai bagian basi. UI menampilkan umur data (`dataAt`), bukan waktu respons.                                                     | TTL tunggal; invalidasi tanpa patch                   | C16.                                                               |
| K11 | **Alert = rekonsiliasi** per kunci `code:target` di `problem_event`. Detail lengkap di §4.6: histeresis tutup 2 tick, buka-kembali baris yang ditutup < 15 mnt, cooldown 15 mnt hanya untuk "buka", "pulih" tanpa cooldown, eskalasi menembus cooldown, pengingat 24 jam, `min_severity` hanya saat memilih kirim, satu digest per tick, plafon 20/jam.                                                                                             | Kirim per event; antrean                              | C1, C3, C21.                                                       |
| K12 | **Tanpa jam tenang.** Pesan yang hanya berisi warning dikirim `disable_notification: true`.                                                                                                                                                                                                                                                                                                                                                         | Setting jam tenang                                    | TZ proses runit tidak terjamin.                                    |
| K13 | **Layanan inti**: default `panel.protected_services` = `sshd,cloudflared,panel,pm2,postgres`. Hentikan protected = ketik nama (`confirm` di body). Mulai ulang = peringatan. `panel`/`cloudflared` = **`lockout`** (stop selalu 409), apa pun isi setting.                                                                                                                                                                                          | Refuse semua stop                                     | Brief + hindari mengunci diri sendiri.                             |
| K14 | **Restart `panel` = keluar rapi.** 202, lalu `shutdown("restart")` (server stop → idle ≤ 120 dtk → tulis marker → tutup DB → `exit(0)`); runsv menjalankan ulang (`exec ./panel`). Hanya bila `$SVDIR/panel/supervise/pid` = `process.pid`, selain itu 409 `not_supervised`. Ditolak bila `jobs.active() \|\| backup.running \|\| backup.restoring`.                                                                                                | `sv` detached + `setsid`                              | C9: lebih sederhana, tanpa risiko proses anak mati.                |
| K15 | **Restart `cloudflared`**: 202 dengan `oldPid`, `sv restart` 500 ms kemudian. Overlay selesai bila `GET /panel/services` berhasil **dan** `cloudflared` `run` dengan `pid !== oldPid`.                                                                                                                                                                                                                                                              | Poll `/ping`                                          | C10.                                                               |
| K16 | **Request log**: `GET`/`HEAD` < 400 → `debug`; 401, dan 404 tanpa sesi → `debug`; lainnya `info`. Ring `log.service` tidak menyimpan `debug` di produksi. Mencakup `QUIET_PATHS` PLAN/05.                                                                                                                                                                                                                                                           | Daftar path                                           | R2-G10, C23.                                                       |
| K17 | **Log**: endpoint mengembalikan `LogChunk` (cursor `<ino>:<offset>`), waktu dari `splitLogTimestamp` (01), redaksi di server (`log.redact.ts`). Unduh dari server (`…/log/download`, ≤ 10 MiB, diredaksi, audit `log.download`). Tanpa "semua" stdout+stderr.                                                                                                                                                                                       | SSE; parser sendiri                                   | X9, C13.                                                           |
| K18 | **Internet HP putus**: semua probe domain `null` → probe `CONNECTIVITY_PROBE_URL` (`https://www.gstatic.com/generate_204`, override env `PANEL_CONNECTIVITY_URL`). Gagal → `internet_down` menahan problem domain. Pulih ≥ 5 mnt → "HP sempat tidak terhubung internet selama X".                                                                                                                                                                   | N domain merah                                        | R2 §4.                                                             |
| K19 | **pm2 hanya dipanggil bila layanan runit `pm2` `run`.** Dicek di adapter (`sv status pm2`, 0,01 dtk), sehingga semua pemanggil terlindungi. Tanpa layanan `pm2` di runit → cek `rpc.sock`.                                                                                                                                                                                                                                                          | `rpc.sock` saja                                       | C6: socket basi → CLI meluncurkan daemon liar.                     |
| K20 | **Notifikasi reboot/mati tak terduga** (`host_rebooted`, `panel_restarted_unexpectedly`) sekali kirim saat boot, dari `os.uptime()` dan marker `data/clean-shutdown`.                                                                                                                                                                                                                                                                               | Tidak ada                                             | C19.                                                               |
| K21 | Isi notifikasi tanpa log/env; hanya judul + resource + tautan `APP_BASE_URL/panel`; waktu relatif.                                                                                                                                                                                                                                                                                                                                                  | Jam absolut                                           | Keamanan; TZ.                                                      |
| K22 | **Role**: API monitoring `admin`; uji kirim/cari chat `super_admin`.                                                                                                                                                                                                                                                                                                                                                                                | –                                                     | Keputusan owner 1.                                                 |
| K23 | **Tanpa `heartbeat.ts`** (B5). `/dev/health` membaca `monitor.status()` (dan `backupScheduler.lastTickAt()` milik 04).                                                                                                                                                                                                                                                                                                                              | `heartbeat.ts` (05 K21)                               | X30: duplikat `sampledAt`.                                         |
| K24 | **Severity `info`** (B4): `backup_not_configured` dan `access_not_seen` tampil sebagai informasi (tone info) di Ringkasan; tidak dihitung di vonis/hitungan, tidak membuka event alert, tidak pernah ke Telegram.                                                                                                                                                                                                                                   | warning permanen                                      | Hindari alarm permanen di instance baru.                           |
| K25 | **Histori 7 hari di `panel.db`** (A8, B15): `metric_sample` per tick (7 hari), `check_result` per probe (7 hari, `WITHOUT ROWID`, tanpa indeks `at` tambahan), `problem_event` (30 hari). Downsampling hanya saat baca. Ikut cadangan apa adanya.                                                                                                                                                                                                   | Ring di RAM; agregat tulis                            | Baseline load, sparkline, strip heartbeat, riwayat masalah; ±4 MB. |

---

## 3. Model data & kontrak API

### 3.1 Tipe bersama — `src/shared/monitor.types.ts` (ditulis `wkr-contracts-00`, W0)

```ts
/** What a problem is about. */
export type ProblemKind =
  | "service"
  | "app"
  | "domain"
  | "network"
  | "backup"
  | "security"
  | "disk"
  | "battery"
  | "host"
  | "alerts"
  | "site";

/** `info` (B4) = shown with tone info; never counted in verdicts/counts, never opens an alert event. */
export type ProblemSeverity = "info" | "warning" | "danger";

/** Stable codes: i18n key, dedupe key part, test fixture. Never rename; only add. */
export type ProblemCode =
  | "service_down"
  | "service_crash_loop"
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
  | "backup_item_stale"
  | "backup_status_error"
  | "key_mismatch"
  | "access_not_seen"
  | "disk_low"
  | "battery_low"
  | "battery_hot"
  | "alerts_failing"
  | "site_job_failed"
  // one-shot notices (kind "host"): stored closed, sent once, never shown in the Ringkasan list
  | "host_rebooted"
  | "panel_restarted_unexpectedly";

export type ProblemParams = Record<string, string | number | boolean | null>;

/** `id` = `${code}:${target}`; `since` = first seen (problem_event.opened_at), null before persisted; `href` = SPA path. */
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

/** Overview parts that can fail on their own. */
export type OverviewSection = "device" | "services" | "apps" | "domains" | "backup" | "security" | "activity";

export type AlertChannelState = "not_configured" | "disabled" | "ok" | "failing";

export type AlertErrorCode =
  | "telegram_token_invalid" // 401
  | "telegram_chat_not_found" // 400 "chat not found"
  | "telegram_chat_migrated" // 400 + parameters.migrate_to_chat_id (auto-saved, see §3.8)
  | "telegram_forbidden" // 403 (bot blocked / removed)
  | "telegram_conflict" // 409 (webhook set or another getUpdates poller)
  | "telegram_rate_limited" // 429 (+ retry_after)
  | "telegram_bad_request" // other 400
  | "telegram_unreachable"; // network, timeout, 5xx

/** GET /api/panel/alerts/status */
export type AlertStatus = {
  channel: "telegram";
  state: AlertChannelState;
  lastSentAt: string | null;
  lastError: AlertErrorCode | null;
  lastErrorAt: string | null;
  /** Due but undelivered (e.g. while offline). */
  pending: number;
};

/** POST /api/dev/alerts/test → 200 */
export type AlertTestResult = { ok: true; sentAt: string };

/** POST /api/dev/alerts/telegram/chats → 200 */
export type TelegramChat = { id: string; title: string; type: "private" | "group" | "supergroup" | "channel" };
export type TelegramChats = { chats: TelegramChat[] };

/** Thin status for the nav badge: GET /api/panel/status (no system calls; last sampler result; info excluded). */
export type PanelStatus = { danger: number; warning: number; sampledAt: string | null };

/** Typical load of this phone (load5, last 7 days); null until >= 24 h of samples. */
export type LoadBaseline = { p10: number; p50: number; p90: number; spanHours: number };

/** One domain check for the heartbeat strip; `status` null = no answer. */
export type DomainCheck = { at: string; status: number | null };

/** GET /api/panel/metrics?range= — bucket averages, oldest first, at most 100 points (bounded, no pagination). */
export type MetricRange = "24h" | "7d";
export type MetricPoint = {
  at: string;
  batteryPct: number | null;
  memAvailableMb: number | null;
  diskFreeMb: number | null;
  load5: number | null;
};
export type MetricSeries = { range: MetricRange; bucketSec: number; points: MetricPoint[] };

/** Item of GET /api/panel/problems/history (newest first, `Page<ProblemEvent>`). */
export type ProblemEvent = {
  id: number;
  code: ProblemCode;
  kind: ProblemKind;
  target: string;
  severity: ProblemSeverity;
  params: ProblemParams;
  openedAt: string;
  closedAt: string | null;
  notified: boolean;
};
```

Kontrak internal server (W0, `src/server/monitor/monitor.contract.ts`, C15). Tujuannya agar rules, core, dan api tidak
saling menebak:

```ts
export type SnapshotSection<T> =
  | { ok: true; value: T; at: number }
  | { ok: false; error: string; at: number | null; stale: T | null };
export type MonitorSnapshot = {
  device: SnapshotSection<DeviceInfo>;
  services: SnapshotSection<Service[]>;
  apps: SnapshotSection<Pm2Proc[]>;
  ingress: SnapshotSection<IngressRule[]>;
  backup: SnapshotSection<BackupStatus>;
  security: SnapshotSection<SecurityStatus>;
};
/** Sampler memory (lost on restart, documented): domain fail/success streaks, restart rings, crash-loop streaks. */
export type MonitorState = {
  domains: Map<string, { failures: number; last: DomainHealth }>;
  appRestarts: Map<string, { at: number; restarts: number }[]>; // ring, 10 min
  serviceRuns: Map<string, { pid: number; at: number }[]>; // last 3 ticks
  intentional: Map<string, number>; // `${kind}:${name}` → until (ms)
  internetDown: boolean;
};
export type ProblemResult = { problems: Problem[]; suppressed: Problem[]; unknownKinds: Set<ProblemKind> };
export interface Monitor {
  snapshot(): Promise<MonitorSnapshot>; // SWR, never waits for probes
  pm2Procs(): Promise<Pm2Proc[]>; // for PLAN/03 lists (≤ 15 s stale)
  patch<K extends "services" | "apps">(section: K, item: Service | App): void;
  problems(): ProblemResult; // from the latest snapshot + state
  noteIntentionalRestart(r: { kind: "app" | "service"; name: string }): void; // PLAN/03 job runner calls this too
  probeDomain(hostname: string): Promise<Domain>; // manual check
  status(): { sampledAt: string | null; intervalSec: number; lastTickMs: number | null; running: boolean }; // B5
  loadBaseline(): LoadBaseline | null; // cached, recomputed at most hourly
  alertStatus(): AlertStatus;
  start(): () => void; // returns stop
  idle(): Promise<void>;
}
export declare function monitorFor(deps: MonitorDeps): Monitor; // one instance per Db (pattern backupServiceFor)
```

Tabel aturan (`overview.problems.ts`). Delay dipakai mesin alert; "–" = tidak pernah dikirim. "Menahan" = problem yang
masuk `suppressed` selama problem ini ada:

| code                           | kind     | severity                                                   | Kondisi                                                                                                                                         | params                      | href                                | delay   | Menahan                                                                                        |
| ------------------------------ | -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `service_down`                 | service  | danger                                                     | `wantUp && state !== "run"`                                                                                                                     | `state`, `downSec`          | `/panel/services`                   | 2 mnt   | target `cloudflared` → semua `domain_*`                                                        |
| `service_crash_loop`           | service  | danger                                                     | 3 tick berturut-turut: `state === "run"`, `uptimeSec < interval`, `pid` berubah; restart sengaja dikecualikan                                   | `ticks`                     | `/panel/services/<name>/log`        | 0       | target `cloudflared` → semua `domain_*`                                                        |
| `pm2_unavailable`              | service  | danger                                                     | adapter melempar `Pm2UnavailableError` (`service_down` \| `no_daemon`), atau `jlist` gagal 2 tick                                               | `reason`                    | `/panel/services`                   | 2 mnt   | `service_down:pm2`, `service_crash_loop:pm2`, semua `app_*`, `domain_*` yang tujuannya app pm2 |
| `app_errored`                  | app      | danger                                                     | `status === "errored"`                                                                                                                          | `restarts`, `site`          | `/panel/apps/<name>/log?stream=err` | 1 mnt   | `domain_*` yang `app` = target                                                                 |
| `app_crash_loop`               | app      | danger                                                     | bukan `errored`; `restarts` naik ≥ 3 dalam 10 mnt, tidak termasuk kenaikan ≤ 2 mnt setelah `noteIntentionalRestart`; counter turun → ring reset | `restarts10m`, `site`       | sama                                | 1 tick  | sama                                                                                           |
| `domain_unreachable`           | domain   | danger                                                     | 3 probe berturut-turut `null`; app tujuan bukan `stopped`                                                                                       | `failures`, `local`, `port` | `/panel/domains`                    | 0       | –                                                                                              |
| `domain_http_error`            | domain   | danger                                                     | 3 probe berturut-turut ≥ 500                                                                                                                    | `status`, `local`, `port`   | `/panel/domains`                    | 0       | –                                                                                              |
| `internet_down`                | network  | danger                                                     | semua domain yang bisa diprobe `null` di tick ini dan probe konektivitas gagal                                                                  | `domains`                   | `/panel/domains`                    | 0 (K18) | semua `domain_*`                                                                               |
| `backup_not_configured`        | backup   | **info** (B4)                                              | `!configured`                                                                                                                                   | –                           | `/panel/backups`                    | –       | –                                                                                              |
| `backup_failed`                | backup   | danger                                                     | run terakhir `failed`, tidak sedang berjalan                                                                                                    | –                           | `/panel/backups`                    | 0       | –                                                                                              |
| `backup_partial`               | backup   | warning                                                    | run terakhir `partial`                                                                                                                          | –                           | `/panel/backups`                    | 0       | –                                                                                              |
| `backup_stale`                 | backup   | warning                                                    | tidak ada run selesai dalam 36 jam                                                                                                              | `hours`                     | `/panel/backups`                    | 0       | `backup_item_stale`                                                                            |
| `backup_item_stale`            | backup   | warning                                                    | item yang dicoba di run terakhir dengan `lastGood` > 36 jam atau tidak ada (input 04); target `<itemKind>:<name>`                               | `itemKind`, `name`, `hours` | `/panel/backups`                    | 0       | –                                                                                              |
| `backup_status_error`          | backup   | danger                                                     | `backup.status()` melempar selain `KeyMismatchError`                                                                                            | –                           | `/dev/health`                       | 0       | –                                                                                              |
| `key_mismatch`                 | security | danger                                                     | `SecurityStatus.keyMismatch` atau `backup.status()` melempar `KeyMismatchError` (04)                                                            | –                           | `/dev/health`                       | 0       | `backup_status_error`, `backup_*`                                                              |
| `access_not_seen`              | security | **info** (B4)                                              | input 04: `https` dan `accessLastSeenAt` null/> 24 jam padahal `adminSeenSinceBoot`                                                             | –                           | `/dev/health`                       | –       | –                                                                                              |
| `disk_low`                     | disk     | warning < 10% bebas, danger < 5%                           | konstanta yang ada                                                                                                                              | `freePct`, `freeBytes`      | `/panel`                            | 0       | –                                                                                              |
| `battery_low`                  | battery  | warning < `monitor.battery_warn_percent` (25), danger < 15 | tidak mengisi (`status` ∉ `charging`, `full`); "tidak dicolok" sendiri bukan masalah (A9)                                                       | `percent`, `plugged`        | `/panel`                            | 2 mnt   | –                                                                                              |
| `battery_hot`                  | battery  | warning ≥ 45 °C, danger ≥ 50 °C                            | `temperatureC !== null`                                                                                                                         | `temperatureC`              | `/panel`                            | 2 mnt   | –                                                                                              |
| `alerts_failing`               | alerts   | warning                                                    | kanal aktif dan kirim terakhir gagal ≥ 3× berturut-turut                                                                                        | `reason`                    | `/dev/settings`                     | –       | –                                                                                              |
| `site_job_failed`              | site     | danger                                                     | job terbaru per target `interrupted`/`failed` dengan `resolvedBy = null` (input 03)                                                             | `jobId`, `kind`, `status`   | `/panel/jobs/<jobId>`               | 0       | –                                                                                              |
| `host_rebooted`                | host     | warning (notice)                                           | saat boot `os.uptime() < 15 mnt`                                                                                                                | `uptimeMin`                 | `/panel`                            | notice  | –                                                                                              |
| `panel_restarted_unexpectedly` | host     | warning (notice)                                           | saat boot tidak ada marker `data/clean-shutdown` dan bukan `host_rebooted`                                                                      | –                           | `/panel`                            | notice  | –                                                                                              |

Domain juga tidak dijadikan problem bila app tujuannya `stopped` (K5). Pemetaan bagian → kind untuk `unknownKinds`
(K4): `device` → `disk`, `battery`; `services` → `service`; `apps` → `app`; `ingress` → `domain`, `network`; `backup` →
`backup`; `security` → `security`; baterai `null` → `battery`.

Konstanta di `overview.problems.ts`:

- `BATTERY_DANGER_PERCENT = 15` (warning dari setting, default 25), `BATTERY_HOT_C = 45`, `BATTERY_DANGER_C = 50`.
- `DOMAIN_FAILS_TO_PROBLEM = 3`.
- `CRASH_LOOP_RESTARTS = 3`, `CRASH_LOOP_WINDOW_MS = 600_000`, `INTENTIONAL_RESTART_GRACE_MS = 120_000`.
- `SERVICE_LOOP_TICKS = 3`, `REBOOT_UPTIME_MS = 900_000`.

Urutan: danger, warning, info, lalu urutan tabel, lalu `target`. Problem `info` tidak masuk hitungan kartu, vonis
"Semua sehat", `PanelStatus`, maupun mesin alert. `memory` sengaja tidak punya aturan.

### 3.2 Perubahan `src/shared/panel.types.ts` (W0; field baru aditif agar konsumen lama tetap terkompilasi sampai W3)

```ts
export type Service = {
  name: string;
  state: ServiceState;
  pid: number | null;
  uptimeSec: number | null; // "run" only (unchanged)
  downSec: number | null; // NEW: "down" only, from `down: …: 120971s`
  wantUp: boolean;
  protected: boolean; // stop needs typed confirmation
  lockout: boolean; // NEW: panel, cloudflared — stop always refused
};

/** `cpu` always null on Android; `module` = pm2 module; `site` from table site.app. */
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

/** `failures` = consecutive failed probes; `local` = HTTP status of 127.0.0.1:<port> when the public probe failed. */
export type DomainHealth = {
  status: number | null;
  ms: number | null;
  checkedAt: string | null;
  failures: number;
  local: number | null;
};

/** `target` = what answers behind it (panel = port equals the panel PORT). */
export type Domain = {
  hostname: string;
  service: string;
  port: number | null;
  app: string | null;
  site: string | null;
  target: "app" | "panel" | "other" | "none";
  health: DomainHealth;
  recent: DomainCheck[]; // up to 30 newest checks, oldest first (one check_result query for all hosts)
};

/** `lastBackupAt` from PLAN/04 `lastGoodItem(db, "database", name)`. */
export type DatabaseInfo = {
  name: string;
  owner: string;
  sizeBytes: number;
  site: string | null;
  lastBackupAt: string | null;
};

export type BatteryPlug = "ac" | "usb" | "wireless" | "unplugged" | "unknown";
export type BatteryStatus = "charging" | "discharging" | "full" | "not_charging" | "unknown";

/** `charging` = status charging|full; `temperatureC` null when missing (never a fake 0). */
export type Battery = {
  percent: number;
  charging: boolean;
  status: BatteryStatus;
  plugged: BatteryPlug;
  temperatureC: number | null;
  health: string | null;
};

/** GET /overview. Failed sections are empty/null AND listed in `unavailable`. `dataAt` = oldest section time shown. */
export type PanelOverview = {
  mode: PanelMode;
  device: DeviceInfo | null;
  loadBaseline: LoadBaseline | null;
  services: Service[];
  apps: App[];
  domains: Domain[];
  problems: Problem[]; // suppressed ones excluded; notices excluded; includes `info`
  unavailable: OverviewSection[];
  recentActivity: DevAuditEntry[]; // 5 newest, `excludePrefixes: ["auth.", "session."]` (04)
  backup: OverviewBackup | null;
  sites: { total: number; deployed: number };
  alerts: Pick<AlertStatus, "state" | "lastError">;
  sampledAt: string | null;
  dataAt: string;
  generatedAt: string;
};

/** 202 body of POST /services/panel|cloudflared/restart (sent before the restart happens). */
export type DeferredRestart = {
  deferred: true;
  service: "panel" | "cloudflared";
  bootId: string;
  oldPid: number | null;
};

/** Body of POST /services/:name/stop for a protected service. */
export type ControlBody = { confirm?: string };
```

`Problem*` dipindah ke `monitor.types.ts` (di-re-export). `LogLines` diganti `LogChunk`.

### 3.3 Tipe log — `src/shared/log.types.ts` (W0 kontrak, X9; dipakai 01, 02, 03, 05)

```ts
export type LogLine = { at: string | null; text: string; stream?: "out" | "err"; level?: LogLevel };
/** `cursor` opaque (`base64url("<ino>:<offset>")`); `reset` = rotated/invalid cursor → replace buffer; `truncated` = > 256 KiB new. */
export type LogChunk = { lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean };
```

`at` diisi lewat `splitLogTimestamp` (01, `src/shared/log.time.ts`).

### 3.4 Database — `drizzle/0008_monitor.sql` (nomor dari jadwal integrasi X7, ditulis `wkr-db-01`)

```sql
-- Monitoring history (PLAN/02, A8). Non-critical: may be lost, must stay bounded (pruned hourly by the sampler).
-- One row per sampler tick (default 60 s); nullable columns so a failed section never blocks the row.
CREATE TABLE IF NOT EXISTS `metric_sample` (
  `at` integer PRIMARY KEY NOT NULL,   -- unix ms; rowid alias, no extra index
  `battery_pct` integer,
  `battery_status` text,               -- BatteryStatus
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
-- One row per domain probe (sampler or manual check); local_status only when the public probe failed.
-- WITHOUT ROWID: the composite PK is the table (no second B-tree); prune uses the PK per host (C20).
CREATE TABLE IF NOT EXISTS `check_result` (
  `hostname` text NOT NULL,
  `at` integer NOT NULL,
  `status` integer,
  `ms` integer,
  `local_status` integer,
  PRIMARY KEY (`hostname`, `at`)
) WITHOUT ROWID;
--> statement-breakpoint
-- Problem lifecycle = alert state (PLAN/02). Open rows (closed_at NULL) survive restarts so alerts are not re-sent.
-- Non-critical; bounded by retention (closed rows > 30 days pruned hourly by the sampler).
CREATE TABLE IF NOT EXISTS `problem_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,                 -- code:target
  `code` text NOT NULL,
  `kind` text NOT NULL,
  `target` text NOT NULL,
  `severity` text NOT NULL,            -- highest seen while open
  `params` text NOT NULL,              -- JSON, last seen
  `opened_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,     -- updated on change or at most every 10 min (bounds writes, detects gaps)
  `closed_at` integer,
  `notified_state` text,               -- NULL | 'open' | 'closed': what Telegram last heard
  `notified_severity` text,
  `last_sent_at` integer
);
--> statement-breakpoint
-- At most one open event per key; the engine relies on it.
CREATE UNIQUE INDEX IF NOT EXISTS `problem_event_open_key_idx` ON `problem_event` (`key`) WHERE `closed_at` IS NULL;
--> statement-breakpoint
-- Reopen lookup (key closed < 15 min ago) and retention.
CREATE INDEX IF NOT EXISTS `problem_event_key_closed_idx` ON `problem_event` (`key`, `closed_at`);
```

- Tidak ada tabel berisi data yang diubah, jadi tidak perlu backfill. Rollback: versi lama mengabaikan tabel ini.
- `WITHOUT ROWID` tidak bisa dinyatakan di drizzle schema: `wkr-db-01` menambahkannya di SQL hasil generate (komentar
  di file schema menyebutnya).
- Retensi (1×/jam, satu transaksi): `metric_sample` dan `check_result` > 7 hari; `problem_event` tertutup > 30 hari.
  Tanpa `VACUUM` (halaman bebas dipakai ulang, ukuran stabil).

| Tabel           | Baris 7 hari             | Ukuran                        |
| --------------- | ------------------------ | ----------------------------- |
| `metric_sample` | 10.080                   | ≈ 0,8 MB                      |
| `check_result`  | 10.080 × D (D=3: 30.240) | ≈ 1,6 MB (D=3); ≈ 5 MB (D=10) |
| `problem_event` | puluhan/hari (30 hari)   | < 0,1 MB                      |

- Tulis flash: 1 transaksi per tick, ±4–6 halaman → dengan checkpoint WAL (tiap halaman ditulis dua kali) ≈
  **70–100 MB/hari** (koreksi C20). Kecil terhadap ketahanan flash; dinyatakan di README. Interval 120 dtk memotong
  setengahnya.
- Repository `src/server/monitor/monitor.history.ts` (≤ 250 baris): `insertTick(tx, sample, checks)`,
  `recentChecks(sinceMs)` (satu query untuk semua host, tanpa N+1), `metricSeries(range)` (`GROUP BY at / bucketMs`,
  ≤ 100 baris), `loadBaseline()` (load5 7 hari, persentil di JS, di-cache 1 jam), `historyPage(page, pageSize)`,
  `openEvents()`, `reopenable(key, sinceMs)`, `insert`, `update`, `close`, `markSent`, `prune(now)`.

### 3.5 Server: modul dan batas tanggung jawab

| File                                                    | Tanggung jawab                                                                       | Batas     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------- |
| `src/server/monitor/monitor.contract.ts` (W0)           | Tipe internal §3.1                                                                   | 100       |
| `src/server/panel/overview.problems.ts`                 | `computeProblems(snapshot, state, settings, now): ProblemResult`, fungsi murni       | 300       |
| `src/shared/problem.copy.ts`                            | `title(p)`, `detail(p)`, `recovered(p, dur)` Indonesia                               | 200       |
| `src/server/alerts/alert.engine.ts`                     | Rekonsiliasi §4.6, fungsi murni + adapter repo                                       | 250       |
| `src/server/alerts/telegram.client.ts`                  | `sendMessage`, `getUpdates`, pemetaan error, `redactToken`                           | 150       |
| `src/server/alerts/alert.messages.ts`                   | Digest HTML, escape, batas panjang                                                   | 150       |
| `src/server/monitor/monitor.snapshot.ts`                | Cache per bagian, SWR, single-flight, `patch`                                        | 200       |
| `src/server/monitor/monitor.sampler.ts`                 | Tick §4.1                                                                            | 250       |
| `src/server/monitor/monitor.service.ts`                 | `monitorFor`, state, `status()`, `noteIntentionalRestart`, notice boot               | 200       |
| `src/server/monitor/monitor.history.ts`                 | Repository §3.4                                                                      | 250       |
| `src/web/panel/panel.status-key.ts` (B12)               | Pemetaan state mentah → `StatusKey` 01 (layanan, app, domain verdict + alasan)       | 150       |
| `src/server/system/log.redact.ts`                       | Redaksi + baca dari cursor                                                           | 150       |
| `src/server/panel/panel.service.ts`                     | Baca dari monitor; kontrol dengan proteksi, kunci job, `noteIntentionalRestart`, 202 | 300       |
| `src/server/routes/panel.routes.ts`, `alerts.routes.ts` | Endpoint §3.7                                                                        | 150 / 100 |

**Adapter** (`wkr-adapters-01`, X21; menggabungkan kebutuhan 02 dan PLAN/03 §3.7):

- `Pm2Proc` += `cwd`, `execPath`, `args`, `startedAtMs` (03), `module`.
- `createTermuxPm2({ pm2Home, isSupervisorUp })`: bila `isSupervisorUp()` = false, lempar
  `Pm2UnavailableError("service_down")` tanpa memanggil CLI. Bila null (layanan `pm2` tidak ada di runit), tanpa
  `rpc.sock` → `Pm2UnavailableError("no_daemon")`. Komentar `pm2.termux.ts:98` diperbaiki.
- Termux selalu `cpu: null`.
- `NetAdapter.httpStatus(port, path = "/", timeoutMs = 5000)` (03).
- `parseSvStatus` mengisi `downSec`.
- `parseBattery`:
  - `status` (`CHARGING|DISCHARGING|FULL|NOT_CHARGING` → enum, lain `unknown`);
  - `plugged` (`PLUGGED_AC|USB|WIRELESS|UNPLUGGED`);
  - `health`;
  - suhu hilang → `null`.
- Cache baterai 120 dtk.
- Fake mewakili Android:
  - load `[20.87, 20.73, 20.01]`, `cpu: null`, baterai `discharging/unplugged` 81%;
  - satu app `errored`, satu domain gagal;
  - data 03 (cwd di sandbox, app glibc `grun`, app tanpa binary, modul);
  - `supervise/pid` palsu untuk test restart.

### 3.6 Kunci pengaturan (`wkr-settings-01`, W1; label di `src/web/i18n/id.settings.ts` milik 05)

Disimpan lewat `PATCH /api/dev/settings` (05 K3).

| Key                            | secret | default                                   | Validator                                       | Label (id)                      | Deskripsi (id)                                                                                                                                                |
| ------------------------------ | ------ | ----------------------------------------- | ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alerts.telegram_bot_token`    | ya     | null                                      | `/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/`             | Token bot Telegram              | Token dari @BotFather. Disimpan terenkripsi dan tidak pernah ditampilkan lagi.                                                                                |
| `alerts.telegram_chat_id`      | tidak  | null                                      | `/^(-?\d{1,20}\|@[A-Za-z][A-Za-z0-9_]{4,31})$/` | ID chat Telegram                | Chat, grup, atau kanal tujuan. Pakai "Cari chat" setelah mengirim pesan baru ke bot.                                                                          |
| `alerts.enabled`               | tidak  | `on`                                      | `on\|off`                                       | Notifikasi Telegram             | Matikan sementara tanpa menghapus token.                                                                                                                      |
| `alerts.min_severity`          | tidak  | `warning`                                 | `warning\|danger`                               | Kirim mulai dari                | `warning` = semua masalah (peringatan dikirim senyap); `danger` = hanya yang gawat.                                                                           |
| `monitor.sample_interval_sec`  | tidak  | `60`                                      | bulat 30–600                                    | Interval pemantauan (detik)     | Seberapa sering panel memeriksa HP. Lebih kecil = lebih cepat tahu, lebih boros baterai.                                                                      |
| `monitor.battery_warn_percent` | tidak  | `25`                                      | `off` atau bulat 16–100                         | Peringatan baterai di bawah (%) | Beri peringatan bila HP tidak sedang mengisi dan baterai di bawah angka ini. Di bawah 15% selalu gawat. Mencabut charger sendiri bukan masalah.               |
| `panel.protected_services`     | tidak  | **`sshd,cloudflared,panel,pm2,postgres`** | seperti sekarang                                | Layanan inti                    | Layanan yang hanya bisa dihentikan dengan mengetik namanya. `panel` dan `cloudflared` tidak pernah bisa dihentikan dari panel, walau dilepas dari daftar ini. |

Ketentuan:

- Kanal **terkonfigurasi** bila token dan chat terisi. `alerts.enabled=off` → state `disabled`.
- Setting dibaca ulang setiap tick.
- Mengubah token/chat atau uji kirim yang sukses me-reset state `failing`.
- Mengubah `monitor.battery_warn_percent` tidak menutup event secara paksa. Event tertutup lewat histeresis biasa.

### 3.7 Endpoint

Semua di bawah `/api`. Error = `{ error, message }` + status. Semua mutasi lewat guard CSRF (hotfix, `apiFetch`).
`A` = admin, `S` = super_admin.

| Method + path                            | Peran | Request                               | 2xx                                                                                                                                                                               | Error                                                                                                                     |
| ---------------------------------------- | ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /health` (publik)                   | –     | –                                     | `{ ok, version, bootId }`                                                                                                                                                         | –                                                                                                                         |
| `GET /panel/overview`                    | A     | –                                     | `PanelOverview` (tidak pernah 500 karena satu bagian)                                                                                                                             | 401/403                                                                                                                   |
| `GET /panel/services`                    | A     | –                                     | `Service[]`                                                                                                                                                                       | 502 `system_error`                                                                                                        |
| `POST /panel/services/:name/:action`     | A     | `ControlBody?`                        | 200 `Service`; 202 `DeferredRestart` (restart `panel`/`cloudflared`)                                                                                                              | 400 `invalid_name`/`invalid_action`; 404; 409 `busy`, `lockout`, `confirm_required`, `job_running`, `not_supervised`; 502 |
| `GET /panel/services/:name/log`          | A     | `?lines=1..2000 (500)&after=<cursor>` | `LogChunk`                                                                                                                                                                        | 400 `invalid_lines`/`invalid_cursor`; 404                                                                                 |
| `GET /panel/apps`                        | A     | –                                     | `App[]`                                                                                                                                                                           | 503 `pm2_unavailable` (+`reason`); 502                                                                                    |
| `POST /panel/apps/:name/:action`         | A     | –                                     | 200 `App`                                                                                                                                                                         | 400; 404; 409 `busy`, `job_running`; 503 `pm2_unavailable`; 502                                                           |
| `GET /panel/apps/:name/log`              | A     | `?stream=out\|err&lines&after`        | `LogChunk`                                                                                                                                                                        | 400 `invalid_stream`…; 404                                                                                                |
| `GET /panel/domains`                     | A     | –                                     | `Domain[]`                                                                                                                                                                        | 502                                                                                                                       |
| `POST /panel/domains/:hostname/check`    | A     | –                                     | 200 `Domain`                                                                                                                                                                      | 400 `invalid_hostname`; 404; 429 `too_soon` + `extra.retryAfterSec` (10 dtk/host)                                         |
| `GET /panel/databases`                   | A     | –                                     | `DatabaseInfo[]`                                                                                                                                                                  | 503 `postgres_down`; 502                                                                                                  |
| `GET /panel/alerts/status`               | A     | –                                     | `AlertStatus`                                                                                                                                                                     | –                                                                                                                         |
| `GET /panel/status`                      | A     | –                                     | `PanelStatus` (tanpa perintah sistem; badge nav, poll 60 dtk)                                                                                                                     | –                                                                                                                         |
| `GET /panel/metrics`                     | A     | `?range=24h\|7d` (24h)                | `MetricSeries` (≤ 100 titik; daftar terbatas, tanpa paginasi)                                                                                                                     | 400 `invalid_range`                                                                                                       |
| `GET /panel/problems/history`            | A     | `?page&pageSize` (20, maks 100)       | `Page<ProblemEvent>` (tanpa notice dan `info`)                                                                                                                                    | 400                                                                                                                       |
| `GET /panel/services/:name/log/download` | A     | –                                     | `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<name>-<yyyymmdd-hhmm>.log"`, ≤ 10 MiB terakhir, diredaksi; audit `log.download` target `service:<name>` | 404                                                                                                                       |
| `GET /panel/apps/:name/log/download`     | A     | `?stream=`                            | sama; audit target `app:<name>:<stream>`                                                                                                                                          | 404                                                                                                                       |
| `POST /dev/alerts/test`                  | S     | –                                     | `AlertTestResult`                                                                                                                                                                 | 409 `alerts_not_configured`; 429 `too_soon` (1/5 dtk); 502 `<AlertErrorCode>`                                             |
| `POST /dev/alerts/telegram/chats`        | S     | –                                     | `TelegramChats` (maks 20, unik)                                                                                                                                                   | 409 `alerts_token_missing`; 502 `<AlertErrorCode>` (termasuk `telegram_conflict`)                                         |

Ketentuan kontrol:

- Urutan cek: nama/aksi → `lockout` → `confirm_required` → `jobs.isLocked({ kind, name })` (03) → `withLock` → aksi →
  `noteIntentionalRestart` (restart/start) → audit (`meta.confirmTyped`) → `monitor.patch`.
- Restart `panel` juga ditolak 409 `job_running` bila `jobs.active() || backup.running || backup.restoring`.

GET sensitif yang diaudit (C23): unduh item cadangan (04 `backup.download`) dan unduh log (`log.download`, aksi masuk
union `AuditAction` W0, X22). Melihat log tidak diaudit (admin dipercaya penuh, keputusan owner 1).

### 3.8 Telegram

Terverifikasi oleh kritik ke `core.telegram.org/bots/api` + FAQ (2026-11-26):

- `text` 1–4.096 karakter setelah parsing entitas;
- HTML wajib meng-escape `< > &` (entitas bernama hanya `&lt; &gt; &amp; &quot;`);
- `ResponseParameters` berisi `retry_after` dan `migrate_to_chat_id`;
- `link_preview_options` dan `disable_notification` ada;
- `getUpdates` tidak jalan saat ada webhook, dan update disimpan maksimal 24 jam;
- `error_code` "subject to change";
- batas: ±1 pesan/dtk per chat, 20/menit per grup.

Rincian implementasi:

- `sendMessage`: `{ chat_id, text, parse_mode: "HTML", disable_notification, link_preview_options: { is_disabled: true } }`,
  timeout 10 dtk.
- Pemetaan error (dari HTTP status + `description`/`parameters`):

  | Respons                    | Kode                                                       |
  | -------------------------- | ---------------------------------------------------------- |
  | 401                        | `telegram_token_invalid`                                   |
  | 400 "chat not found"       | `telegram_chat_not_found`                                  |
  | 400 + `migrate_to_chat_id` | `telegram_chat_migrated`                                   |
  | 403                        | `telegram_forbidden`                                       |
  | 409                        | `telegram_conflict`                                        |
  | 429                        | `telegram_rate_limited` (tunggu `retry_after`, default 60) |
  | 400 lain                   | `telegram_bad_request`                                     |
  | jaringan / timeout / 5xx   | `telegram_unreachable`                                     |

- **Chat dimigrasi**: ID baru disimpan ke `alerts.telegram_chat_id` (audit `settings.update`, aktor Sistem,
  `meta.reason: "chat_migrated"`), lalu langsung dicoba ulang sekali.
- **Backoff**: 1, 2, 4, 8, 16, 30 mnt. 401/403/chat-not-found dicoba ulang tiap 1 jam, dan di-reset oleh perubahan setting
  atau uji kirim sukses.
- **Token tidak pernah muncul** di log/error: semua pesan dari klien ini lewat `redactToken()`. Test wajib.
- **Cari chat**: `getUpdates` tanpa `offset` (update tidak dikonfirmasi). Chat diambil dari `message.chat`,
  `channel_post.chat`, dan `my_chat_member.chat`.
- **Laju**: ≤ 1 pesan per tick + plafon `ALERT_MAX_PER_HOUR = 20`. Lewat plafon → satu pesan "Terlalu banyak notifikasi.
  Buka Ringkasan untuk melihat semuanya.", lalu diam sampai jam berikutnya.

Format (HTML, tanpa emoji, ≤ 3.500 karakter, > 15 baris → "… dan N lainnya"):

```
<b>Panel Termux</b> · panel.malikkurosaki.com
GAWAT · Layanan postgres terus dimulai ulang · sejak 3 mnt
PERINGATAN · Baterai tinggal 22% dan tidak mengisi
PULIH · solusi.malikkurosaki.com bisa dijangkau lagi · putus 12 mnt
PULIH · Aplikasi blog bermasalah · pulih saat panel tidak berjalan (terakhir terlihat 3 jam lalu)
INFO · HP baru saja menyala ulang · aktif 4 mnt

Buka Ringkasan: https://panel.malikkurosaki.com/panel
```

- Pengingat 24 jam diawali "MASIH · ".
- Uji kirim: "Notifikasi uji dari Panel Termux. Kalau pesan ini sampai, notifikasi sudah siap."

### 3.9 Kontrak yang dipakai dari PLAN/01 (signature 01 berlaku harfiah; daftar lama "kebutuhan" digantikan, X20)

- `DataTable` prop `actions` (slot aksi baris), `rowHref`; kolom disaring dengan filter array (tanpa `hidden`).
- `ConfirmAction` `tier: "confirm" | "typed"`. Aksi tanpa konfirmasi = tanpa dialog. `onConfirm` resolve pada 202
  (restart panel/cloudflared), lalu overlay 02 mengambil alih (X18).
- `LogViewer` props versi 01 (`live`, `streams`, `empty`, `size`, …). `newCount` dihitung komponen.
- `usePoller` adalah primitif polling tunggal (B13); `useApiQuery(url, refreshMs?, { enabled })` di atasnya: jeda saat
  tersembunyi sudah bawaan, backoff error.
- `useLogFollow(url, { enabled })` di `src/web/shared/`.
- `status.vocab` (tabel kanonik 01, dibekukan setelah W1, B12): kunci yang diminta 02: `auth_required`, `unstable`,
  `tunnel_down` (X8). Pemetaan state mentah → kunci ada di **`src/web/panel/panel.status-key.ts`** (milik 02):
  `serviceKey(s)` (down + `wantUp` → `down`; `!wantUp` → `stopped`), `appKey(a)`, `domainVerdict(health, app)` →
  `{ key: StatusKey, reason: string }`. Tanpa label/tone sendiri; `panel.status.ts` lama dihapus.
- `format.id.ts` (`formatBytes`, `formatDuration`, `formatNumber`) untuk `problem.copy.ts`.
- Copy kesegaran "Diperbarui baru saja" / "Diperbarui 3 mnt lalu" (01 D16: tanpa detik).

---

## 4. Flow

### 4.1 Boot dan sampler

1. `boot.ts` (`wkr-boot-03`) setelah migrations:
   - baca lalu hapus marker `data/clean-shutdown`;
   - buat `monitor = monitorFor({ db, secret, dataDir, system, jobs, backup, security, appBaseUrl, panelPort,
     bootNotice: { cleanShutdown, uptimeSec: os.uptime() } })`;
   - `monitor.start()` (tick pertama 10 dtk kemudian).
2. Notice boot: `host_rebooted` bila uptime < 15 mnt, selain itu `panel_restarted_unexpectedly` bila marker tidak ada.
   Disimpan sebagai baris `problem_event` yang langsung tertutup dengan `notified_state = NULL` (§4.6 langkah 6).
3. Seed: event terbuka dari DB (untuk `since` dan status notifikasi); counter gagal domain dari 3 `check_result`
   terakhir per host. Ring restart dan streak layanan mulai kosong: crash loop app baru terdeteksi ≥ 10 mnt setelah boot.
4. Tick:
   - (a) `snapshot.refreshAll()` paralel: `runit.list` dulu (status `pm2` dipakai `isSupervisorUp`), lalu `pm2.list` ‖
     `device.read` ‖ `listIngress` ‖ `backup.status` ‖ `security.status` (masing-masing dibungkus).
   - (b) probe domain paralel (timeout 8 dtk); yang gagal → `net.httpStatus(port)` lokal.
   - (c) semua `null` → probe konektivitas.
   - (d) `computeProblems` → `ProblemResult`.
   - (e) satu transaksi: `metric_sample` + `check_result` (histori, A8) + perubahan `problem_event` (§4.6); kirim
     Telegram di luar transaksi.
   - (f) retensi ≥ 1×/jam; `loadBaseline` dihitung ulang ≥ 1×/jam.
   - (g) `log.debug("[monitor] tick 1234ms")`, dan `warn` bila > 20 dtk.
   - (h) jadwalkan tick berikut `interval − durasi` (min 5 dtk).
5. Kegagalan:
   - bagian gagal → `unavailable` + `unknownKinds` (K4);
   - tulis DB gagal → `log.error` (operasi + sebab), kirim tetap dicoba;
   - exception tick → `log.error`, tick berikut tetap dijadwalkan;
   - `jlist` hang 20 dtk → single-flight, UI dapat nilai lama dengan `dataAt` yang jujur.
6. Shutdown: `stopScheduler` menghentikan sampler. `idle` menunggu tick berjalan. `shutdown.ts` (03 W1) menulis marker
   `data/clean-shutdown` sebelum `exit` (3 baris, dititipkan di spec `wkr-sites-runner-01`).

### 4.2 Membuka Ringkasan

1. `GET /panel/overview` → `monitor.snapshot()` (SWR) + `monitor.problems()`. Respons segera bila cache ≤ 120 dtk.
2. Sebelum tick pertama: domain "Belum dicek", `sampledAt: null` → teks "Pemantauan latar dimulai…".
3. Poll 10 dtk saat terlihat (`useApiQuery`), jeda saat tersembunyi.
4. Jaringan klien putus: data terakhir tetap tampil + `StaleNotice` (01), backoff.
5. Bagian `unavailable` → teks "Tidak bisa dibaca saat ini" di tile/kartunya. Problem dari kind itu tetap tampil dari
   event terbuka (dibekukan, ditandai "data terakhir 3 mnt lalu").

### 4.3 Kontrol layanan/aplikasi

1. Tombol utama: tidak berjalan → **Mulai** (tanpa dialog); berjalan → **Mulai ulang** (`confirm`). Menu ⋯: Hentikan,
   Lihat log.
2. Hentikan: biasa/app → `confirm`; protected → `typed`; `lockout` → item nonaktif dengan alasan terbaca.
3. Server mengikuti urutan cek §3.7. `monitor.patch` membuat respons poll berikutnya langsung menampilkan status baru.
4. Klien: toast `doneBy` lalu reload. Error → `errorCodes`.
5. Konkurensi: aksi kedua → 409 `busy`. Saat job situs berjalan → 409 `job_running`.
6. Jaringan putus saat kontrol: toast "Tidak bisa memastikan hasilnya karena koneksi terputus. Muat ulang untuk melihat
   kondisi terbaru." lalu reload saat online.
7. pm2 tidak berjalan → 503 `pm2_unavailable` ("pm2 tidak berjalan. Mulai layanan pm2 dulu.").

### 4.4 Restart panel / cloudflared

1. Mulai ulang `panel` → `confirm`: "Halaman ini terputus ±10–30 dtk lalu tersambung lagi."
2. Server:
   - cek `not_supervised` (`supervise/pid` ≠ `process.pid` → 409, mode dev);
   - cek `job_running` (job/backup/restore);
   - audit `service.restart`;
   - balas 202 `{ deferred, service: "panel", bootId, oldPid }`;
   - `setTimeout(300)` → `shutdown("restart")` (marker ditulis, jadi tidak ada notice palsu setelah naik lagi).
3. Klien: `onConfirm` resolve. Overlay modal `role="alertdialog"` (fokus terkunci): "Panel dimulai ulang… Menyambung
   ulang." Poll `GET /api/health` tiap 2 dtk. Fetch gagal, HTML 502/530, atau halaman login Access dihitung "belum".
   Kembali = JSON dengan `bootId` baru → tutup overlay, toast "panel dimulai ulang.", reload query. Versi berubah →
   reload halaman penuh.
4. 130 dtk (≥ shutdown 120 dtk) tanpa kembali → overlay berubah jadi error: "Panel belum tersambung lagi. Cek lewat SSH:
   `sv status panel` dan `tail $PREFIX/var/log/sv/panel/current`. Bila kamu memakai Cloudflare Access, muat ulang
   halaman untuk login lagi." Tombol: Coba lagi dan Tutup.
5. `cloudflared`: 202 `{ service: "cloudflared", oldPid }`, `sv restart` 500 ms kemudian. Overlay ("Semua domain
   terputus beberapa detik…") mem-poll `GET /api/panel/services` tiap 2 dtk, dan selesai bila request berhasil **dan**
   `cloudflared.state === "run" && pid !== oldPid`. Batas 90 dtk. Tanpa Cloudflare (akses `127.0.0.1`), overlay selesai
   begitu pid baru terlihat.

### 4.5 Log

1. Buka log → `GET …/log?lines=500` → `LogChunk`.
2. Follow (`useLogFollow`, 01) poll 3 dtk `?after=<cursor>`. Perilaku gulir/pin, "Baris baru (n)", dan batas DOM 2.000
   baris milik `LogViewer` 01.
3. `reset: true` → ganti buffer + penanda "— file log diputar —". `truncated` → penanda "Sebagian baris dilewati".
4. Tersembunyi → berhenti; terlihat → satu request `after`.
5. Unduh → tautan biasa ke `…/log/download` (cookie sesi ikut; GET tidak terkena guard mutasi); file ≤ 10 MiB
   terakhir, diredaksi; audit `log.download`.

### 4.6 Mesin alert (per tick)

Input: `ProblemResult`, settings, dan waktu. Konstanta: `CLOSE_AFTER_ABSENT_TICKS = 2`, `REOPEN_WINDOW_MS = 15 mnt`,
`COOLDOWN_MS = 15 mnt`, `REMIND_MS = 24 jam`, `LAST_SEEN_STEP_MS = 10 mnt`.

1. **Hadir.** Untuk tiap problem di `problems` (bukan `suppressed`, bukan notice, bukan severity `info`):
   - ada event terbuka → UPDATE hanya bila severity naik, params berubah, atau `now − last_seen_at ≥ 10 mnt`;
   - tidak ada, tetapi ada baris `key` sama dengan `closed_at > now − 15 mnt` → **buka kembali** baris itu
     (`closed_at = NULL`, `opened_at`/`last_sent_at`/`notified_state` tetap);
   - selain itu → INSERT. Counter absen `key` = 0.
2. **Absen.** Untuk tiap event terbuka yang tidak hadir:
   - kind ∈ `unknownKinds` atau `key` ada di `suppressed` → tidak disentuh, counter absen = 0;
   - selain itu counter absen +1; bila ≥ 2 → `closed_at = now`.
3. **Pilih item kirim.** Kandidatnya: event terbuka, dan event tertutup ≤ 24 jam dengan `notified_state = 'open'`.
   - terbuka, `now − opened_at < delay(code)` → lewati;
   - terbuka dan severity ≥ `alerts.min_severity` dan (`notified_state ≠ 'open'`, **atau** severity naik di atas
     `notified_severity`, **atau** `now − last_sent_at ≥ 24 jam`) → item buka/masih, **kecuali** `last_sent_at` < 15 mnt
     lalu dan bukan eskalasi ke danger (tunda);
   - tertutup dan `notified_state = 'open'` → item pulih, **tanpa cooldown**. Teks durasinya:
     `closed_at − last_seen_at > 15 mnt` → "pulih saat panel tidak berjalan (terakhir terlihat X lalu)"; selain itu
     "berlangsung X";
   - tertutup dan `notified_state` NULL → senyap, kecuali `internet_down` yang berlangsung ≥ 5 mnt → item pulih.
4. Kanal tidak terkonfigurasi/dimatikan → tidak kirim, tidak menandai (`pending` dihitung). Kanal yang diaktifkan nanti
   hanya mengirim yang masih terbuka.
5. Ada item → satu digest.
   - Sukses → tandai `notified_state`, `notified_severity`, `last_sent_at`.
   - Gagal → tanpa tanda; backoff §3.8; ≥ 3 gagal berturut-turut → `alerts_failing`.
6. **Notice** (`host_*`): baris tertutup dengan `notified_state` NULL dan umur < 24 jam → baris "INFO" di digest. Sukses
   → `notified_state = 'closed'`. Notice tidak tampil di daftar Ringkasan.
7. Internet putus → kirim gagal dan backoff. Saat pulih, rekonsiliasi hanya mengirim selisih saat itu.
8. Restart panel → event terbuka dibaca dari DB, jadi tidak dikirim ulang. Masalah yang pulih saat panel mati ditutup
   setelah 2 tick dengan teks "pulih saat panel tidak berjalan".

### 4.7 Menyiapkan Telegram (UI 05, API 02)

1. Super admin membuat bot di @BotFather, menempel token di grup "Notifikasi", lalu Simpan → `PATCH /api/dev/settings`.
2. Mengirim **pesan baru** ke bot (atau menambahkan bot ke grup), lalu "Cari chat" → `POST /api/dev/alerts/telegram/chats`
   → memilih chat → `PATCH` `alerts.telegram_chat_id`.
3. "Kirim notifikasi uji" → `POST /api/dev/alerts/test`. Hasilnya toast sukses, atau teks dari `errorCodes` (§5.7).
   Uji kirim tidak menyentuh `problem_event`.
4. Edge cases:
   - daftar chat kosong → "Belum ada chat. Kirim pesan baru ke bot kamu (Telegram hanya menyimpan pesan 24 jam), lalu
     cari lagi.";
   - `telegram_conflict` → "Bot ini sedang dipakai aplikasi lain (webhook aktif). Matikan webhook-nya atau pakai bot
     lain.".

### 4.8 Database

1. `GET` sekali, dengan tombol muat ulang.
2. `postgres` tidak `run` → 503 `postgres_down` → `ErrorState` "Layanan postgres tidak berjalan. Situs yang memakai
   database tidak bisa diakses." + tautan ke Layanan.
3. Kosong → "Belum ada database. Database dibuat otomatis saat kamu membuat situs dengan PostgreSQL."

---

## 5. Spesifikasi UI per halaman

Umum:

- Komponen: `PageHeader` (h1, meta `updatedAt = dataAt`, `onRefresh`, `live`), `StatusBadge` dengan kunci `status.vocab`
  (01), `EmptyState`, `ErrorState`, skeleton dari `components/skeletons.tsx`.
- `QueryView` dan `StatCard` lama tidak dipakai lagi.
- Target sentuh ≥ 44 px di < md.
- Hanya token warna; banner demo memakai tone `warning`.
- File i18n baru di-import langsung; `id.ts` tidak disentuh (X17).

### 5.1 Ringkasan (`/panel`)

1. **`PageHeader`** "Ringkasan", meta "Diperbarui baru saja". Mode demo → badge `warning` "Mode demo" + `fakeMode`.
2. **Strip masalah.**
   - Tanpa warning/danger → `StatusBadge` `success` "Semua sehat" + "dicek 1 mnt lalu" (`sampledAt`).
   - Problem `info` (B4: cadangan belum diatur, Access belum terdeteksi) tampil sebagai baris tone `info` di bawah strip,
     dengan tautan aksi; tidak mengubah "Semua sehat" dan tidak masuk hitungan.
   - Ada → `<ul>`. Tiap baris: badge severity, judul, detail satu kalimat, "sejak 12 mnt", tautan "Lihat" (+ "Lihat log"
     untuk app/service). Problem dari kind `unknown` diberi catatan "data terakhir X lalu".
   - HP: maks 5 baris + "Tampilkan N lainnya".
   - `aria-live="polite"` `sr-only` hanya diperbarui bila himpunan `id` berubah.
3. **Tile** `grid-cols-2 lg:grid-cols-4` (`StatTile`, ≤ 170 px untuk 2×2 di 390 px):
   - Baterai: "81%", hint "Tidak mengisi" / "Sedang dicas" / "Dicolok, tidak mengisi" / "Penuh" — semuanya netral
     (A9: mencabut charger bukan masalah); nada warning/danger hanya dari `battery_low`. `null` → "Tidak tersedia
     (pasang Termux:API)". Sparkline 24 jam baterai % (`MetricSeries`, gelombang W4) di bawah nilai.
   - Suhu: "39,5 °C" atau "Tidak tersedia"; nada 45/50.
   - Memori: "4,1 GB tersedia", progress terpakai, `thresholds={{ warn: 90, danger: 97 }}`.
   - Penyimpanan: "170,3 GB bebas", progress, `{ warn: 90, danger: 95 }` (= aturan 10%/5%).
   - Memori juga mendapat sparkline 24 jam (memori tersedia).
   - Di bawah tile: "Beban sistem 20,9 · 20,7 · 20,0" + `loadBaseline` → "· biasanya 18–22" dengan nada K6, atau (tanpa
     baseline) "· nilai biasanya muncul setelah 1 hari pemantauan". Tombol info `Popover` ("Di Android angka ini mencakup
     proses sistem dan semua aplikasi HP, jadi biasanya tinggi. Yang penting adalah perubahan dari nilai biasanya."),
     lalu "Waktu aktif HP 3 hari 4 jam".
4. **Hitungan**: Situs, Layanan, Aplikasi, Domain. Tiap kartu adalah tautan berisi jumlah + badge ("Semua berjalan" /
   "1 mati" / "1 perlu dicek") dari `problems` per kind. Bagian `unavailable` → "Tidak bisa dibaca".
5. **Cadangan**: satu baris `KeyValue`, atau badge problem.
6. **Notifikasi**:
   - `ok` → "Notifikasi Telegram aktif";
   - `not_configured` → "Notifikasi belum diatur. Tanpa notifikasi, masalah baru terlihat saat kamu membuka panel." +
     "Atur di Pengaturan" (super_admin) / "Minta Super Admin mengaturnya" (admin);
   - `failing` → ditangani `alerts_failing`.
7. **Aktivitas terbaru**: 5 entri; "Lihat semua" hanya untuk super_admin.
8. **Riwayat masalah** (W4): 5 event tertutup terbaru ("postgres mati · 12 mnt · kemarin 21.40") + "Lihat riwayat" →
   `/panel/problems` (`DataTable` + paginasi dari `GET /panel/problems/history`; kosong: "Belum ada masalah dalam 30 hari
   terakhir.").

States: skeleton pertama; `ErrorState` bila gagal tanpa data; partial per bagian.

### 5.2 Layanan (`/panel/services`)

Poll 10 dtk. `DataTable`, kolom:

- **Nama** (mono, badge "Inti");
- **Status** (kunci vocab);
- **Sejak** ("aktif 3 jam" / "mati 33 jam" / "berulang kali dimulai ulang" bila `service_crash_loop`);
- **PID** (disembunyikan di HP).

`actions`: tombol utama + ⋯. Urutan: bermasalah dulu. Kosong: "Belum ada layanan runit. Panel membaca layanan dari
`$PREFIX/var/service`." Error 502: "Daftar layanan tidak bisa dibaca. Coba lagi; bila terus gagal, cek runit lewat SSH."

| Aksi        | Biasa   | Protected (`sshd`, `pm2`, `postgres`) | `panel`, `cloudflared` |
| ----------- | ------- | ------------------------------------- | ---------------------- |
| Mulai       | –       | –                                     | –                      |
| Mulai ulang | confirm | confirm + akibat                      | confirm + overlay §4.4 |
| Hentikan    | confirm | typed                                 | nonaktif + alasan      |

Teks akibat (`id.panel.serviceImpact`):

| Layanan       | Teks                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pm2`         | "Semua aplikasi ikut berhenti; situs tidak bisa diakses sampai pm2 dan aplikasinya berjalan lagi."                                          |
| `postgres`    | "Situs yang memakai database tidak bisa diakses sampai postgres berjalan lagi."                                                             |
| `sshd`        | "Kamu tidak bisa masuk lewat SSH sampai sshd dijalankan lagi (sesi yang sudah terbuka biasanya tetap jalan)." (C24; diverifikasi di HP uji) |
| `cloudflared` | `tunnelWarning`                                                                                                                             |
| `panel`       | "Halaman ini terputus ±10–30 dtk lalu tersambung lagi."                                                                                     |

Alasan lockout: "Menghentikan {name} memutus akses ke panel ini, dan panel tidak bisa menyalakannya lagi. Hentikan lewat
SSH bila memang perlu."

### 5.3 Aplikasi (`/panel/apps`)

Poll 10 dtk. Kolom:

- **Nama**;
- **Status**;
- **Situs** (tautan);
- **Memori**;
- **Waktu aktif**;
- **Dimulai ulang** (nada warning bila crash loop);
- **Port** (disembunyikan di HP);
- **CPU**: kolom ini tidak ikut dalam array bila semua `cpu === null`.

Hentikan app milik situs: confirm, dengan teks "Situs {site} tidak bisa diakses sampai aplikasinya dimulai lagi."
Modul pm2 tampil di `<details>` "Modul pm2 (n)" tanpa aksi. `pm2_unavailable` → `ErrorState` per `reason`
("pm2 tidak berjalan. Semua aplikasi ikut tidak berjalan." + "Buka Layanan"). Kosong: "Belum ada aplikasi. Aplikasi
muncul setelah kamu membuat situs atau menambahkannya ke `ecosystem.config.js`."

### 5.4 Domain (`/panel/domains`)

Poll 30 dtk. Kolom:

- **Domain** (tautan tab baru, `aria-label`);
- **Tujuan** ("Situs blog · aplikasi blog-app" / "Panel Termux" / "Layanan lain (localhost:8080)" / "Tanpa tujuan");
- **Status** (badge dari `domainVerdict` + alasan satu kalimat);
- **Respons**;
- **30 cek terakhir** (strip heartbeat dari `Domain.recent`, W4): batang 2×12 px hijau/merah/abu,
  `role="img"` `aria-label` "28 dari 30 cek terakhir sehat"; di HP diganti teks "28/30 sehat";
- **Dicek** (`RelativeTime`).

`actions`: "Cek ulang" (nonaktif 10 dtk; 429 → "Tunggu sebentar sebelum mengecek lagi.").

| Kondisi                                | Kunci vocab     | Alasan                                                                                                                              |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `checkedAt null`                       | `unchecked`     | "Cek pertama berjalan dalam 1 mnt."                                                                                                 |
| 2xx–3xx                                | `healthy`       | –                                                                                                                                   |
| 401, 403                               | `auth_required` | "Domain menjawab, tapi meminta login (mungkin Cloudflare Access)."                                                                  |
| 4xx lain                               | `healthy`       | "Aplikasi berjalan, tetapi halaman utama menjawab {status}."                                                                        |
| gagal, `failures < 3`                  | `unstable`      | "Gagal {n}× berturut-turut. Ditandai bermasalah setelah 3×."                                                                        |
| 502/504/`null`, `failures ≥ 3`         | `unhealthy`     | `local` ada → "Aplikasi di HP menjawab {local}, jadi masalahnya di tunnel." · tidak ada → "Aplikasi di port {port} tidak menjawab." |
| 530, `failures ≥ 3`                    | `tunnel_down`   | "Cloudflare tidak terhubung ke tunnel cloudflared di HP."                                                                           |
| ditahan (cloudflared/app/pm2/internet) | sesuai kondisi  | "Penyebabnya: {judul problem penahan}."                                                                                             |
| app `stopped`                          | `stopped`       | "Aplikasi {app} sengaja dihentikan."                                                                                                |
| wildcard                               | `unchecked`     | "Domain wildcard tidak dicek otomatis."                                                                                             |

Kosong: "Belum ada domain. Tambahkan domain dari halaman situs, atau tulis aturan di `~/.cloudflared/config.yml`."

### 5.5 Database (`/panel/databases`)

Kolom: **Nama**, **Situs**, **Pemilik**, **Ukuran**, **Cadangan terakhir** (warning bila > 36 jam). Error dan kosong
mengikuti §4.8.

### 5.6 Kosakata status

Memakai `status.vocab` 01. Tidak ada tabel sendiri (X8). Kunci tambahan yang diminta ada di §3.9. String lama
`refreshing`, `confirmBody`, `done`, `serviceStates`, dan `appStatuses` dihapus dari `id.panel.ts`.

### 5.7 Copy masalah (`problem.copy.ts`)

| code                           | title                                            | detail                                                                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `service_down`                 | Layanan {target} mati                            | Seharusnya berjalan. Mati sejak {durasi}.                                             |
| `service_crash_loop`           | Layanan {target} terus dimulai ulang             | runit menyalakannya lagi tapi langsung berhenti. Lihat log {target}.                  |
| `pm2_unavailable`              | pm2 tidak berjalan                               | Semua aplikasi ikut tidak berjalan. Mulai layanan pm2.                                |
| `app_errored`                  | Aplikasi {target} bermasalah                     | pm2 berhenti mencoba setelah {restarts}× gagal. Lihat log stderr.                     |
| `app_crash_loop`               | Aplikasi {target} terus dimulai ulang            | {restarts10m}× dalam 10 mnt terakhir. Lihat log stderr.                               |
| `domain_unreachable`           | {target} tidak bisa dijangkau                    | (alasan §5.4)                                                                         |
| `domain_http_error`            | {target} menjawab HTTP {status}                  | (alasan §5.4)                                                                         |
| `internet_down`                | HP tidak terhubung ke internet                   | Semua domain tidak bisa dijangkau dari HP. Notifikasi terkirim setelah koneksi pulih. |
| `backup_not_configured`        | Cadangan belum diatur (info)                     | Tanpa cadangan, data situs hilang bila HP rusak. Atur penyimpanan R2/S3.              |
| `backup_failed`                | Cadangan terakhir gagal                          | Lihat detailnya di halaman Cadangan.                                                  |
| `backup_partial`               | Cadangan terakhir hanya sebagian berhasil        | Lihat item yang gagal di halaman Cadangan.                                            |
| `backup_stale`                 | Tidak ada cadangan dalam {hours} jam terakhir    | Cadangan harian mungkin tidak berjalan.                                               |
| `backup_item_stale`            | Cadangan {name} sudah {hours} jam tidak berhasil | Item ini gagal di cadangan terakhir. Lihat halaman Cadangan.                          |
| `backup_status_error`          | Status cadangan tidak bisa dibaca                | Buka Kesehatan sistem untuk melihat penyebabnya.                                      |
| `key_mismatch`                 | Kunci data tidak cocok                           | Pengaturan rahasia tidak bisa dibuka. Buka Kesehatan sistem → Kunci data.             |
| `access_not_seen`              | Cloudflare Access tidak terlihat                 | Panel dibuka tanpa melewati Cloudflare Access. Periksa aturan Access.                 |
| `disk_low`                     | Penyimpanan hampir penuh                         | Tinggal {freePct}% ({freeBytes}) bebas.                                               |
| `battery_low`                  | Baterai tinggal {percent}% dan tidak mengisi     | Server ikut mati bila baterai habis. Colokkan charger.                                |
| `battery_hot`                  | Baterai panas ({temperatureC} °C)                | Pindahkan HP ke tempat sejuk atau lepas casingnya.                                    |
| `alerts_failing`               | Notifikasi Telegram gagal terkirim               | per `reason` (tabel di bawah)                                                         |
| `site_job_failed`              | Perubahan situs {target} belum selesai           | Buka perubahan ini untuk membersihkan atau mengulang.                                 |
| `host_rebooted`                | HP baru saja menyala ulang                       | Aktif {uptimeMin} mnt. Periksa apakah semua layanan sudah berjalan.                   |
| `panel_restarted_unexpectedly` | Panel sempat berhenti tak terduga                | Panel tidak dimatikan dengan rapi (mungkin dihentikan Android).                       |

Teks `alerts_failing` per `reason`:

| reason                    | Teks                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `telegram_token_invalid`  | "Token bot ditolak Telegram. Periksa token di Pengaturan."               |
| `telegram_chat_not_found` | "Chat tujuan tidak ditemukan. Kirim pesan ke bot, lalu pilih chat lagi." |
| `telegram_forbidden`      | "Bot diblokir atau dikeluarkan dari grup."                               |
| `telegram_conflict`       | "Bot sedang dipakai aplikasi lain (webhook)."                            |
| lainnya                   | "Telegram tidak bisa dijangkau dari HP."                                 |

Teks pulih generik: "PULIH · {title} · berlangsung {durasi}".

`errorCodes` baru: `lockout`, `confirm_required`, `job_running` ("Perubahan situs, cadangan, atau pemulihan sedang
berjalan. Tunggu sampai selesai, lalu coba lagi."), `not_supervised` ("Panel tidak berjalan di bawah runit, jadi tidak
bisa memulai ulang dirinya sendiri."), `pm2_unavailable`, `postgres_down`, `too_soon`, `invalid_cursor`, semua
`AlertErrorCode`, `alerts_not_configured`, dan `alerts_token_missing` (dipakai 05).

### 5.8 Log

`PageHeader` "Log {name}" + breadcrumb. `LogViewer` (01): `streams` stdout/stderr untuk app. Catatan: "Log ditampilkan
apa adanya; pola rahasia umum disamarkan."

Redaksi server (`log.redact.ts`), diuji di scratchpad:

| Pola                                                                                                                                         | Ganti             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `(postgres(?:ql)?\|mysql\|mariadb\|rediss?\|mongodb(?:\+srv)?\|amqps?)://[^:/\s@]+:[^@\s]+@`                                                 | `$1://***:***@`   |
| `/(["']?)([a-z0-9_]*(?:token\|secret\|password\|passwd\|api_?key\|private_?key\|access_?key)[a-z0-9_]*)\1(\s*[=:]\s*)(["']?)[^"'\s,}]+\4/gi` | `$1$2$1$3$4***$4` |
| `\bBearer\s+[A-Za-z0-9._~+/=-]{8,}`                                                                                                          | `Bearer ***`      |
| `\b\d{6,16}:[A-Za-z0-9_-]{30,}\b`                                                                                                            | `***`             |

Hasil uji yang dicatat: `{"password":"x1"}` → `***`; `"apiKey": "abc-123"` → `***`; `token=abc` → `***`;
`tokenizer ready` tetap.

### 5.9 Interval polling dan biaya

| Pemakai                      | Interval saat terlihat  | Catatan                             |
| ---------------------------- | ----------------------- | ----------------------------------- |
| Ringkasan, Layanan, Aplikasi | 10 dtk                  | `jlist` ≤ 1 per 15 dtk berkat cache |
| Domain                       | 30 dtk                  | probe 60 dtk oleh sampler           |
| Database                     | –                       | tombol muat ulang                   |
| Log follow                   | 3 dtk                   | baca file saja                      |
| Overlay restart              | 2 dtk                   | panel 130 dtk, cloudflared 90 dtk   |
| Tersembunyi / error          | berhenti / backoff (01) |                                     |

**Biaya diharapkan** (dengan jlist 0,54–0,66 dtk):

- idle ≈ **1,1%** satu inti (jlist/menit + sv + probe TLS + SQLite);
- satu tab Ringkasan ≈ **3%**; N tab ≈ sama;
- biaya JVM Termux:API untuk baterai (1× per 2 mnt) **tidak terukur dari panel**.

---

## 6. Kriteria penerimaan

**Unit (bun test)**

- [ ] `panel.problems.test.ts`, kasus per baris tabel §3.1:
  - kolom "Menahan": cloudflared mati + 3 domain 530 → 1 problem; app errored + domainnya 502 → 1 problem;
    `pm2_unavailable` menahan semua `app_*`;
  - app `stopped` → tidak ada problem;
  - `battery_low`: warning < 25% tidak mengisi (`not_charging` dan `discharging` sama-sama "tidak mengisi"), danger
    < 15% walau `plugged: usb`; dicabut di 80% → tidak ada problem (A9); setting `off`; problem `info` tidak masuk
    hitungan/`PanelStatus`/alert;
    ambang `off`;
  - `service_crash_loop` butuh 3 tick dengan pid berubah;
  - `app_crash_loop` mengabaikan restart sengaja; counter turun → reset;
  - kode 04 dan 03 dari input fixture;
  - urutan deterministik.
- [ ] `alert.engine.test.ts`:
  - pm2 gagal 1 tick → tidak ada pulih/event baru;
  - baterai `null` → event tetap terbuka;
  - penahanan tidak menutup;
  - histeresis 2 tick;
  - buka-kembali < 15 mnt memakai baris yang sama;
  - flapping 4 mnt selama 1 jam → ≤ 4 pesan;
  - pulih tanpa cooldown; eskalasi menembus cooldown; pengingat 24 jam;
  - `min_severity=danger` + 51→47 °C → tanpa pesan;
  - teks "pulih saat panel tidak berjalan";
  - notice sekali kirim dan tetap terkirim setelah gagal pertama;
  - plafon 20/jam; gagal kirim tidak menandai;
  - restart (state dari DB) tidak kirim ulang.
- [ ] `telegram.client.test.ts` (fetch palsu): pemetaan 401/400/400-migrate/403/409/429/5xx/timeout; chat dimigrasi →
      setting + audit Sistem; **token tidak muncul** di error/ring; escape HTML; potong > 3.500.
- [ ] `panel.parsers.test.ts`: `downSec`, `status`/`plugged`/`health`, suhu `null`, `module`, `cpu === null`, field 03;
      `Pm2UnavailableError("service_down")` tanpa memanggil CLI (spy `runTermux`).
- [ ] `log.redact.test.ts`: semua pola + kasus JSON; cursor append/reset/truncated.
- [ ] `monitor.snapshot.test.ts`: single-flight, SWR, `patch` langsung terlihat, `at` per bagian.
- [ ] `monitor.sampler.test.ts` (jam palsu): tumpang tindih dilewati; notice boot dari marker/uptime; retensi
      `problem_event` 30 hari.
- [ ] `web.panel.test.ts`: `panel.status-key.ts` (`serviceKey`, `appKey`, `domainVerdict` per baris §5.4); setiap `ProblemCode` punya title+detail (iterasi union);
      tier per layanan.
- [ ] `db.migrate.test.ts` (`wkr-db-01`): `0008` idempotent, DB v0.2.x berisi data → 0008.

**Integrasi API (mode fake, DB test)**

- [ ] `backup.status` melempar `Error` → `backup_status_error`. Melempar `KeyMismatchError` → `key_mismatch`.
      Keduanya 200.
- [ ] Stop `postgres` tanpa body → 409 `confirm_required`; dengan `confirm` → 200 + audit.
- [ ] Stop `panel` → 409 `lockout`.
- [ ] Restart `panel` saat tidak di bawah runit → 409 `not_supervised`. Dengan `supervise/pid` palsu → 202 lalu
      `shutdown` dipanggil (spy).
- [ ] Restart cloudflared → 202 dengan `oldPid`.
- [ ] Kunci job/backup → 409 `job_running`.
- [ ] Mutasi tanpa header CSRF → ditolak.
- [ ] `POST /dev/alerts/test`: admin → 403; tanpa setting → 409; dengan fetch palsu → 200.
- [ ] Request log: `GET /api/panel/overview 200` → debug, tidak masuk ring produksi; 401 tanpa sesi → debug;
      `POST … 409` → info.

**UI-QA di browser** (izin owner, Rule 1; mode demo, 390 px dan 1280 px, terang dan gelap)

- [ ] Ringkasan 390 px: strip + 4 tile terlihat tanpa scroll; 2×2 ≤ 200 px.
- [ ] Demo memperlihatkan baterai 22% tidak mengisi, app errored, domain gagal yang ditahan dengan alasan, load ±20 netral.
- [ ] Tidak ada "CPU 0%", tidak ada "0 °C".
- [ ] Mulai tanpa dialog; stop `postgres` typed; stop `panel` nonaktif dengan alasan terbaca.
- [ ] Overlay restart panel (fake `bootId` baru setelah 5 dtk) dan cloudflared (pid baru). Jaringan dimatikan → overlay
      error.
- [ ] Log follow + unduh dari server (audit tercatat).
- [ ] Sparkline, baseline load (fixture histori 2 hari), strip heartbeat, riwayat masalah, badge nav.
- [ ] Tab tersembunyi 1 mnt → tidak ada request `/api/panel/*`.
- [ ] aria-live hanya berbunyi saat masalah berubah; fokus overlay terkunci.

**Di HP (POCO, izin owner, setelah deploy)**

- [ ] CPU = selisih `utime+stime+cutime+cstime` dari `/proc/<pid panel>/stat` selama 10 mnt: idle ≤ 1,5%, satu tab
      ≤ 3,5%. Bila lewat, default interval naik ke 120 dtk.
- [ ] Nilai `panel.protected_services` yang tersimpan dicek. Bila tersimpan eksplisit tanpa `pm2,postgres`, catatan
      rilis menyebutkannya (K42).
- [ ] Cabut charger di 80% → tidak ada notifikasi (A9). Turun ke < 25% tanpa mengisi → "PERINGATAN · Baterai tinggal …"
      (senyap); colok → "PULIH".
- [ ] `ls -l panel.db` setelah 24 jam: pertambahan ≤ 1 MB.
- [ ] `pm2 restart` manual 3× → tidak ada notifikasi; app crash → ≤ 2 mnt.
- [ ] `sv restart panel` dari UI → overlay kembali, tanpa notice "berhenti tak terduga".
- [ ] Reboot HP (bila owner mengizinkan) → "INFO · HP baru saja menyala ulang".

---

## 7. Rencana kerja (mengikuti jadwal global integrasi §5)

| Gelombang | Worker                              | File PLAN/02 (eksklusif di gelombang itu)                                                                                                                                                                                                                                                                           | Ukuran       |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| W0        | `wkr-contracts-00` (bersama)        | `src/shared/monitor.types.ts`, `src/shared/log.types.ts`, `src/shared/panel.types.ts` (aditif), `src/server/monitor/monitor.contract.ts`, union `ApiError` (409 `not_supervised`, 429, 503)                                                                                                                         | ±250         |
| W1        | `wkr-adapters-01` (bersama, X21)    | `src/server/system/*` sesuai §3.5 (+ kebutuhan 03/04), `tests/panel.parsers.test.ts`                                                                                                                                                                                                                                | ±450 (02+03) |
| W1        | `wkr-db-01` (bersama, X7, B15)      | `drizzle/0008_monitor.sql` (`metric_sample`, `check_result` `WITHOUT ROWID`, `problem_event`), `src/server/db/schema/monitor.schema.ts`                                                                                                                                                                             | ±120         |
| W1        | `wkr-settings-01` (bersama, X3, B8) | 7 kunci §3.6 di `SETTING_KEYS`/`settings.service.ts`                                                                                                                                                                                                                                                                | ±50          |
| W1        | `wkr-mon-rules-01`                  | `src/server/panel/overview.problems.ts`, `src/shared/problem.copy.ts`, `src/server/alerts/{alert.engine,telegram.client,alert.messages}.ts`, `tests/{panel.problems,alert.engine,telegram.client}.test.ts`                                                                                                          | ±1.200       |
| W1        | `wkr-sites-runner-01` (03)          | titipan: marker `data/clean-shutdown` di `shutdown.ts` (3 baris + test)                                                                                                                                                                                                                                             | ±15          |
| W2        | `wkr-mon-core-02`                   | `src/server/monitor/{monitor.snapshot,monitor.sampler,monitor.service,monitor.history}.ts` (termasuk tulis + retensi histori, `loadBaseline`), `src/server/system/log.redact.ts`, `tests/{monitor.snapshot,monitor.sampler,monitor.history,log.redact}.test.ts`                                                     | ±950         |
| W3        | `wkr-mon-api-03`                    | `src/server/panel/panel.service.ts`, `domain.health.ts` (hapus), `src/server/routes/{panel,alerts}.routes.ts` (termasuk `/status`, `/metrics`, `/problems/history`, `…/log/download`), `src/server/http/request.log.ts`, `src/server/log.service.ts`, `tests/{panel.api,alerts.api}.test.ts`                        | ±700         |
| W3        | `wkr-boot-03` (bersama, X6)         | `boot.ts`: marker + `monitorFor` + start/stop + `bootId`; `api.routes.ts` mount `alerts`                                                                                                                                                                                                                            | ±40          |
| W3        | `wkr-mon-web-03`                    | `src/web/panel/*` (overview + tiles + problems list, services, apps, domains, databases, log, `restart.overlay.tsx`, control, `panel.status-key.ts`), `src/web/i18n/{id.panel,id.overview}.ts`, `tests/web.panel.test.ts`                                                                                           | ±900         |
| W4        | `wkr-mon-history-04`                | `src/web/panel/{sparkline,heartbeat.strip,problems.page}.tsx` (baru), integrasi ke overview/domains (file `src/web/panel/*` yang disebut, setelah W3 selesai), route `/panel/problems` lewat `src/web/panel/panel.pages.ts` (01), badge nav (slot `NavItem.badge` 01, poll `/panel/status` 60 dtk), test UI histori | ±550         |

Dokumentasi oleh worker docs tunggal di akhir:

- README "Pemantauan & notifikasi": cara kerja sampler; biaya CPU jujur (≈1,1% idle); setup Telegram; panel tidak bisa
  melaporkan dirinya mati (saran monitor luar), tetapi melaporkan reboot/mati tak terduga saat hidup lagi; redaksi log
  tidak sempurna; ambang baterai (hanya baterai rendah, A9); histori 7 hari ±3 MB dan tulis flash ±70–100 MB/hari.
- CHANGELOG `[0.3.0]`.

Total PLAN/02 ±4.200 baris (tanpa bagian bersama milik worker lain). Semua di v0.3.0 (A8); histori UI di W4.

---

## 8. Risiko, asumsi, pertanyaan terbuka

**Risiko**

- R1 Biaya ≈ 1,1% idle sudah di tepi batas. Knob interval sudah ada; jangan mengubah desain sebelum diukur.
- R2 Redaksi log tidak sempurna. README dan UI berkata begitu.
- R3 TZ proses runit. Karena itu pesan memakai durasi relatif.
- R4 Overlay dan sesi Access yang kedaluwarsa ditangani teks error §4.4.4.
- R5 Crash loop app tidak terdeteksi 10 mnt pertama setelah boot (ring di memori). Counter domain di-seed dari
  `check_result`.
- R6 `--grace-period` cloudflared belum diverifikasi. Desain §4.4.5 benar dengan atau tanpanya.
- R7 Kontrak internal berubah (`Problem.message`, `LogLines` → `LogChunk`, `device` nullable). W0 membuatnya aditif;
  konsumen diperbarui di W3.
- R8 Tulis flash histori ±70–100 MB/hari (C20). Knob interval memotongnya; dinyatakan di README.

**Asumsi**

- Hotfix CSRF masuk (merge `main`, X15).
- PLAN/03: `jobs.isLocked({ kind, name })`, `jobs.active()`, input `site_job_failed`, dan job runner memanggil
  `monitor.noteIntentionalRestart`.
- PLAN/04: `BackupStatus.lastGood`, `SecurityStatus` (`keyMismatch`, `https`, `accessLastSeenAt`,
  `adminSeenSinceBoot`), `KeyMismatchError`, `lastGoodItem`, `backup.running/restoring`. 04 tidak membuat
  `backup.problems.ts`/`backup.events.ts`/`notify()`.
- PLAN/05: grup "Notifikasi" + "Cari chat" + "Kirim notifikasi uji" lewat API §3.7. `/dev/health` memakai
  `monitor.status()` dan `problems` (filter kind). Catatan lockout di Pengaturan (C24).
- runsv menulis `supervise/pid` (standar runit). Diverifikasi di HP sebelum rilis.

**Pertanyaan terbuka untuk owner** (default dipakai bila tidak dijawab)

1. ~~Q1 charger~~ — **dijawab owner (A9)**: sengaja dicabut-colok; hanya baterai rendah (25% warning / 15% danger).
2. Notice reboot / mati tak terduga berbunyi (danger) atau senyap (warning)? **Default: senyap.**
3. Warning ikut ke Telegram? **Default: ya** (senyap).
4. Interval 60 dtk atau 120 dtk? **Default: 60**, dinaikkan bila pengukuran > 1,5%.

**Di luar v0.3.0** (tidak direncanakan): webhook generik/ntfy/email, log rotasi, heartbeat keluar.

---

## Riwayat revisi

**Revisi 3 (2026-11-26, penyelarasan dengan `PLAN/DECISIONS.md`)**

- A8: semua fitur yang ditunda di Revisi 2 kembali ke v0.3.0. Yang kembali: `metric_sample` + `check_result` (7 hari,
  `WITHOUT ROWID`), `loadBaseline` "biasanya …", sparkline baterai/memori, strip heartbeat domain (`Domain.recent`),
  riwayat masalah (`/panel/problems/history` + halaman), `/panel/status` + badge nav, unduh log server + audit
  `log.download`. Endpoint, tipe, dan UI dipulihkan; worker baru `wkr-mon-history-04` di W4; total ±4.200 baris.
- A9/B3: `battery_unplugged` dihapus. Kode `battery_power` diganti `battery_low` (warning < `monitor.battery_warn_percent`
  default **25**, danger < **15**, hanya saat tidak mengisi). `monitor.battery_unplugged_grace_min` dan
  `notChargingSince` dihapus. Suhu ≥ 45 °C tetap warning. Q1 ditutup.
- B4: severity baru `info`. `backup_not_configured` dan `access_not_seen` menjadi info: tidak masuk vonis/hitungan,
  tidak ke Telegram.
- B5: `monitor.status()` (+ `backupScheduler.lastTickAt()` 04) untuk `/dev/health`, tanpa `heartbeat.ts`.
- B12: pemetaan status di `src/web/panel/panel.status-key.ts` (`serviceKey`, `appKey`, `domainVerdict`);
  `panel.status.ts` lama dihapus.
- B13: `log.types.ts` W0, `splitLogTimestamp` 01, `usePoller` primitif, `useLogFollow` 01.
- B14: adapter oleh `wkr-adapters-01` dengan `Pm2UnavailableError`.
- B15: `0008_monitor` memuat tabel histori. Estimasi ukuran/tulis flash dikoreksi.

**Revisi 2 (2026-11-26, setelah debat; detail di `PLAN/debate/02-response.md`)**

- §4.6 mesin alert ditulis ulang:
  - kind tidak terbaca membekukan event (C1);
  - penahanan menggantikan "menggantikan" (C2, C8);
  - histeresis 2 tick + buka-kembali baris < 15 mnt, pulih tanpa cooldown (C3);
  - `last_seen_at` + teks "pulih saat panel tidak berjalan" (C18);
  - `min_severity` hanya saat memilih kirim (C21);
  - notice boot (C19).
- Tabel aturan:
  - `battery_unplugged`/`battery_low` → `battery_power` dengan dua ambang setting (C7, owner Q1);
  - `service_crash_loop` baru (C5);
  - `app_crash_loop` mengabaikan restart sengaja (C4);
  - `pm2_unavailable` dari layanan runit dan dicek di adapter (C6);
  - kode 04 (`backup_item_stale`, `key_mismatch`, `access_not_seen`, kind `security`) dan `site_job_failed` 03 masuk;
    `site_crash_loop` dihapus (C14, X10);
  - `host_rebooted`, `panel_restarted_unexpectedly` (C19).
- Restart panel = 202 + `shutdown()` + cek `supervise/pid`; `restartDetached` dan risiko R5 lama dihapus (C9).
  Cloudflared memakai `oldPid` (C10). Overlay panel 130 dtk; penolakan memuat backup/restore (C14, X23).
- Biaya diperbarui ke 1,1% / 3%; pengukuran memakai `cutime/cstime`; batas 1,5% / 3,5% (C11).
- Kontrak:
  - `alerts.*` + `/api/dev/alerts/*` dengan `{error, message}` dipertahankan (X3, X14);
  - `PATCH /api/dev/settings` dan label di `id.settings.ts` diterima;
  - tanpa `beat()`, diganti `monitor.status()` (C12, X30);
  - `log.types.ts` di W0, parser `log.time.ts` 01, `log.parse.ts` → `log.redact.ts` (C13, X9);
  - signature 01 untuk `DataTable`/`ConfirmAction`/`useApiQuery`/`LogViewer`, dan tabel kosakata sendiri dihapus
    (X8, X20);
  - adapter 03 §3.7 masuk (C14, X21);
  - `monitor.contract.ts` di W0 (C15).
- Snapshot: `at` per bagian, `dataAt`, patch setelah aksi; copy tanpa detik (C16, X19).
- Telegram: `telegram_conflict`, `telegram_chat_migrated` (simpan otomatis + audit), cari chat dari
  `my_chat_member`/`channel_post` tanpa `offset`, coba ulang 1 jam, fakta API terverifikasi (C17).
- Regex redaksi JSON (diuji) (C22). Request log 401/404 tanpa sesi → debug; daftar GET sensitif yang diaudit (C23).
  Teks sshd dan catatan lockout untuk 05 (C24).
- **Ruang lingkup dipangkas** untuk v0.3.0 (C20, integrasi §4):
  - tabel `metric_sample`/`check_result`, `/metrics`, baseline load, sparkline, strip heartbeat, riwayat masalah,
    unduh log server, dan `/panel/status` ditunda;
  - migration jadi `0008_monitor` (hanya `problem_event`);
  - rencana kerja mengikuti jadwal global W0–W3 (±3.200 baris, sebelumnya ±6.000).

**Revisi 1 (2026-11-26):** versi awal.
