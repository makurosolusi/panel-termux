# R&D 02 — Monitoring: Ringkasan, Layanan, Aplikasi, Domain, Database, Log, Polling, Notifikasi, Histori metrik

Penulis: wkr-rnd-monitor-01 · Tanggal: 2026-11-26 · Basis: branch `feature/production-polish` @ 2a55c8b.
Data nyata diambil read-only dari HP produksi (`ssh poco`, 2026-11-26 ±21.54 WITA). Halaman berjalan tidak dibuka di
browser; audit UI berdasar kode (wave A shell + halaman panel lama).

---

## 1. Ruang lingkup

| Area                | Route SPA                                      | API (`/api/panel`, peran `admin`)                                              | Kode utama                                                                                                         |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Ringkasan           | `/panel`                                       | `GET /overview`                                                                | `src/server/panel/panel.service.ts`, `overview.problems.ts`, `src/web/panel/overview.page.tsx`, `device.cards.tsx` |
| Layanan (runit)     | `/panel/services`, `/panel/services/:name/log` | `GET /services`, `POST /services/:name/:action`, `GET /services/:name/log`     | `src/server/system/runit.termux.ts`, `src/web/panel/services.page.tsx`, `control.buttons.tsx`, `log.page.tsx`      |
| Aplikasi (pm2)      | `/panel/apps`, `/panel/apps/:name/log?stream=` | `GET /apps`, `POST /apps/:name/:action`, `GET /apps/:name/log?stream=out\|err` | `src/server/system/pm2.termux.ts`, `src/web/panel/apps.page.tsx`                                                   |
| Domain              | `/panel/domains`                               | `GET /domains`                                                                 | `src/server/system/cloudflared.termux.ts`, `src/server/panel/domain.health.ts`, `src/web/panel/domains.page.tsx`   |
| Database            | `/panel/databases`                             | `GET /databases`                                                               | `src/server/system/postgres.termux.ts`, `src/web/panel/databases.page.tsx`                                         |
| Log viewer          | log layanan/aplikasi; `/dev/logs` (log panel)  | lihat di atas; `GET /api/dev/logs`                                             | `src/server/system/file.tail.ts`, `src/server/log.service.ts`, `src/web/dev/logs.page.tsx`                         |
| Polling             | semua halaman di atas                          | –                                                                              | `src/web/shared/use-api-query.ts`, `PANEL_REFRESH_MS` di `src/web/panel/panel.api.ts:24`                           |
| Notifikasi, histori | belum ada                                      | belum ada                                                                      | –                                                                                                                  |

Di luar domain ini (dibahas worker lain): Situs, deploy, backup (selain ringkasnya di Ringkasan), Administrasi.

---

## 2. Kondisi sekarang (audit)

### 2.0 Fakta lapangan dari HP produksi (POCO, Termux)

| Hal                                                                     | Nilai nyata                                                                                                                              | Implikasi                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Core                                                                    | `nproc` = 8                                                                                                                              |                                                                                               |
| Load average                                                            | `20.87, 20.73, 20.01` dalam keadaan normal (panel nyaris idle)                                                                           | Ambang per-core ala Linux (0,7/1,0) selalu merah di Android                                   |
| `/proc/stat`, `/proc/loadavg`, `/proc/pressure/*`, `/sys/class/thermal` | `Permission denied`                                                                                                                      | Tidak ada CPU%, PSI, suhu CPU. `os.loadavg()` tetap jalan (syscall `sysinfo`)                 |
| Memori                                                                  | total 11.268 MB, available 4.172 MB, swap terpakai 3.196 / 12.287 MB                                                                     | "Memori 63%" wajar; swap tidak ditampilkan                                                    |
| Disk `$HOME`                                                            | 232 GB, terpakai 27%                                                                                                                     |                                                                                               |
| Baterai                                                                 | 88%, `status: DISCHARGING`, `plugged: UNPLUGGED`, 38,0 °C, `health: GOOD`                                                                | HP server **tidak dicas** saat riset — kondisi berisiko yang hari ini tidak dianggap masalah  |
| `termux-battery-status`                                                 | 0,7–1,25 dtk wall (lewat Termux:API)                                                                                                     | Wajar di-cache (sudah 30 dtk)                                                                 |
| `pm2 jlist`                                                             | 0,34–0,61 dtk wall, ~0,5 dtk CPU (boot node)                                                                                             | Operasi termahal per poll                                                                     |
| `sv status` semua                                                       | 0,02 dtk                                                                                                                                 | Murah                                                                                         |
| `psql` list DB                                                          | 0,08 dtk                                                                                                                                 | Murah                                                                                         |
| HTTPS probe `solusi.…`                                                  | 200 dalam 0,88 dtk (lewat Cloudflare)                                                                                                    |                                                                                               |
| Layanan runit                                                           | `cloudflared, panel, pm2, postgres, ssh-agent, sshd`; `ssh-agent` = `down` tanpa "want up" (sengaja)                                     |                                                                                               |
| Aplikasi pm2                                                            | `pm2-logrotate` (online, `pmx_module=true`), `makuro-solusi` (online, restart 1), `adminneo` (online)                                    | Modul pm2 tampil sebagai "aplikasi"; `cpu` = 0 untuk semua (pidusage tak bisa baca `/proc`)   |
| Ingress                                                                 | `solusi.malikkurosaki.com → localhost:3005`, `panel.malikkurosaki.com → localhost:3200`, catch-all 404                                   | `makuro-solusi` tidak punya `PORT` di env pm2 maupun di args → domain tampil "tanpa aplikasi" |
| Format log runit                                                        | `svlogd -tt`: prefix `2026-11-26_13:54:24.23463` (**UTC**), lalu isi baris (sering berisi timestamp lokal WITA sendiri)                  | Perlu parsing prefix → jam lokal; kalau tidak, user melihat dua jam berbeda per baris         |
| Ukuran log runit                                                        | `pm2/` 9,0 MB (10 file rotasi @1 MB + `current`); isinya `PM2 warn: [pidusage] We couldn't find uptime from /proc/uptime` **tiap 2 dtk** | Log layanan `pm2` nyaris 100% noise → perlu cari/filter; `current` berganti tiap ±3,6 jam     |
| Log pm2 aplikasi                                                        | `~/.pm2/logs/*-out.log` kecil; `pm2-logrotate` rotasi harian 00.00 ke `*__YYYY-MM-DD_HH-mm-ss.log.gz`                                    | Setelah tengah malam tail bisa kosong padahal ada log kemarin (di `.gz`)                      |
| Log panel (runit)                                                       | v0.2.1 di HP belum punya logger request (`[http] …`) — itu masuk di commit 6e34376                                                       | Setelah rilis berikutnya, **tiap poll 10 dtk menulis 1 baris info** (lihat §2.7)              |
| Jangkauan keluar dari HP                                                | `api.telegram.org` 302 (0,79 dtk), `ntfy.sh` 200 (2,1 dtk), `fcm.googleapis.com` 404 (0,42 dtk)                                          | Telegram/ntfy/Web Push secara jaringan bisa dipakai                                           |

### 2.1 Ringkasan (`/panel`)

**Data.** `PanelOverview` (`src/shared/panel.types.ts:88-99`): `mode`, `device` (`battery {percent, charging,
temperatureC} | null`, `cpuCores`, `memory {totalMb, availableMb}`, `disk {freeBytes,totalBytes}`, `load [1,5,15]`,
`uptimeSec`), `services[]`, `apps[]`, `domains[]`, `problems[] {kind, target, severity, message}`,
`recentActivity` (8 audit terakhir), `backup {configured,lastRunAt,lastStatus,nextRunAt}`, `sites {total,deployed}`,
`generatedAt`. Sumber: adapter Termux (`device.termux.ts:59-81`), problems dihitung server (`overview.problems.ts:50-93`).

**Alur.** `OverviewPage` → `useApiQuery(/overview, 10_000)` (`overview.page.tsx:66-67`). Server: `pm2.list()` dulu
(serial), lalu paralel device + services + domains (`panel.service.ts:87-93`); domains menunggu probe HTTPS bila cache

> 60 dtk (`domain.health.ts:22-27`, timeout 8 dtk `cloudflared.termux.ts:9`). Kegagalan services/apps/domains → `[]` +
> `log.warn` (`panel.service.ts:75-79`); kegagalan **device** (mis. `/proc/meminfo`) menggagalkan seluruh overview (tidak
> dibungkus `orEmpty`). `backup.status`, `listAudit`, query `site` sinkron SQLite.

**Masalah UI/UX.**

- Server sudah menghitung `problems`, `recentActivity`, `backup`, `sites` — **UI tidak menampilkan satu pun**
  (`overview.page.tsx:27-62` hanya hitungan + kartu device). Keunggulan terbesar backend tidak terlihat.
- UI menghitung ulang masalah sendiri (`countProblems`, `panel.status.ts:49-55`) dengan aturan **berbeda** dari server:
  domain 4xx = "bad" di klien, "warning" di server (`overview.problems.ts:32-33`); app `stopped` dihitung masalah di
  klien dan server (warning) — padahal stop sengaja oleh admin bukan masalah (berbeda dengan layanan, yang memakai
  `wantUp`). Dua sumber kebenaran.
- 8 kartu `StatCard` tinggi `h-28` ditumpuk satu kolom di HP (`GRID` `sm:grid-cols-2`, `overview.page.tsx:15`) → ±1.000px
  scroll sebelum melihat apa pun; benchmark menyarankan grid 2×2 ≤ 200px (`docs/research/ui-benchmark.md` §2).
- Load ditampilkan mentah "20,87 · 20,73 · 20,01" dengan label "Beban CPU (1/5/15 mnt)" (`device.cards.tsx:27`,
  `id.panel.ts:35`) — orang awam membaca "CPU 20%" atau panik. `formatLoadPerCore` wave A (`format.ts:92-106`, ambang
  0,7/1,0 per core) bila dipakai akan **selalu merah** di HP ini (20,9/8 = 2,6).
- Baterai: hanya `charging` boolean; `plugged`/`health` dibuang (`device.termux.ts:25-29`). "Tidak diisi" berwarna
  netral padahal server HP yang tidak dicas adalah risiko nomor satu (mati total saat baterai habis).
- Suhu: `temperatureC` = 0 bila field hilang (`device.termux.ts:28`) → tampil "0 °C" alih-alih "tidak tersedia".
- Mode demo: banner amber hardcoded warna Tailwind (`overview.page.tsx:45`), bukan token tone.
- Tidak ada `PageHeader` di halaman panel (hanya `profile.page.tsx` yang memakai) → tidak ada judul, tidak ada "Diperbarui
  12 dtk lalu".

**Masalah konten.**

- `t.refreshing` = "Diperbarui otomatis tiap 10 detik" (`id.panel.ts:24`, dipakai `overview.page.tsx:70`) melanggar
  content guide ("Jangan menulis interval teknis yang statis"). Dikomentari "lama" tapi masih dipakai.
- `problem.message` dari server berbahasa Inggris ("service sshd is down", `overview.problems.ts:54`) dan tidak punya
  kode/param → UI tidak bisa menerjemahkan tanpa mem-parse string.
- "Waktu aktif HP" berisi `os.uptime()` — benar, tapi tidak dibedakan dari waktu aktif panel (`/dev`).

**Masalah kode/arsitektur.**

- `pm2.list()` serial sebelum yang lain (`panel.service.ts:88`) menambah ±0,5 dtk latensi; bisa paralel lalu domains
  di-map setelahnya.
- Overview memblok pada probe HTTPS bila cache kedaluwarsa: tiap ±6 poll satu respons menunggu probe (0,9 dtk normal,
  sampai 8 dtk bila domain mati).
- `fake` device: load `[1.2, 0.9, 0.7]` (`system.fake.ts:214`) tidak mewakili Android (~20) → desain diuji pada data
  yang tak pernah terjadi di produksi.

### 2.2 Layanan (`/panel/services`)

**Data.** `Service {name, state: run|down|finish|unknown, pid, uptimeSec, wantUp, protected}` (`panel.types.ts:18-25`).
`sv status` diparse (`runit.termux.ts:17-41`); `fail:/warning:` → `unknown`. `protected` dari setting
`panel.protected_services` (default `sshd,cloudflared,panel`).

**Alur kontrol.** Tombol → `ConfirmAction` (semua aksi, termasuk Mulai) → `POST` → server: tolak `stop` bila protected
(409, `panel.service.ts:117-119`), lock per resource (409 `busy`, `action.lock.ts`), `sv <action>` (timeout 15 dtk),
audit, kembalikan state baru → klien toast + `reload()` (`use-panel-control.ts:14-19`).

**Masalah.**

- **Restart `panel` dari panel** diizinkan (protected hanya memblok stop, `panel.status.ts:71-72`): proses mati di tengah
  request, klien mendapat galat jaringan, toast "gagal" padahal berhasil. Perlu perlakuan khusus (jawab 202 dulu, lalu
  restart; UI menunggu `/api/health` kembali).
- `postgres` dan `pm2` tidak protected secara default: stop `pm2` = semua aplikasi mati; stop `postgres` = semua situs
  ber-DB rusak. Dialog tidak menyebut akibat ini (hanya cloudflared punya peringatan khusus, `panel.status.ts:77-78`).
- `ControlButtons` memakai `confirmBody` "lama" (`control.buttons.tsx:59`) bukan `confirmBodies` (akibat dulu) yang sudah
  ada di i18n (`id.panel.ts:68-73`); toast memakai `done` "lama" ("sshd: mulai ulang berhasil.") bukan `doneBy`
  (`panel.api.ts:18`).
- Konfirmasi juga untuk **Mulai** — benchmark §9: aksi aman tanpa konfirmasi (melatih user klik tanpa membaca).
- 3 tombol + Log berjajar per kartu (`unit.card.tsx:30-37`); di 390px membungkus jadi 2 baris; tidak ada aksi utama.
- Label status: `down` = "Mati" untuk layanan yang **sengaja** dimatikan (`ssh-agent`) — glosarium benchmark: sengaja =
  "Dihentikan" (netral), tak disengaja = "Mati/Gagal". Tone sudah benar (`serviceTone`), label tidak.
- `finish` = "Berhenti" (warning) — sebenarnya transisi (run script sedang keluar/akan di-restart oleh runsv).
- Tidak ada info "sejak kapan mati": `sv status` memberi detik untuk `down` juga ("down: …ssh-agent: 120971s") tapi
  parser hanya menyimpan uptime untuk `run` (`runit.termux.ts:36`). "Mati 3 mnt" vs "mati 33 jam" sangat berbeda.
- Tidak ada indikasi restart-loop runit (`run` dengan uptime selalu < 5 dtk). Hanya histori yang bisa mendeteksinya.

### 2.3 Aplikasi (`/panel/apps`)

**Data.** `App {name, status, pid, memoryMb, cpu, restarts, uptimeSec, port}` (`panel.types.ts:31-40`), whitelist dari
`pm2 jlist` (aman: env tidak pernah keluar, `pm2.termux.ts:50-94`).

**Masalah.**

- `cpu` selalu 0 di Android (terverifikasi: ketiga app `cpu=0`), tapi UI menampilkan "CPU 0%" (`apps.page.tsx:20`) —
  data palsu yang terlihat benar. Harus disembunyikan di mode termux (README sudah menyebut keterbatasan ini).
- `pm2-logrotate` (modul, `pmx_module=true`) tampil sebagai aplikasi biasa; field tidak diambil parser.
- `restarts` total sejak `pm2 save`/start, tanpa konteks waktu; `unstable_restarts` (crash loop pm2) tidak diambil.
- Tidak ada tautan app ↔ situs ↔ domain. `port` null untuk app yang membaca `PORT` dari `.env` sendiri (kasus
  `makuro-solusi`) padahal tabel `site` tahu `port` + `app` (`site.schema.ts:11-12`).
- Tiap `control`/`readLog` memanggil `pm2 jlist` 1–2× (`pm2.termux.ts:111-128`) → log aplikasi yang di-refresh mahal.
- Stop aplikasi = warning di Ringkasan (`overview.problems.ts:57-63`) — stop sengaja ikut dianggap masalah.

### 2.4 Domain (`/panel/domains`)

**Data.** `Domain {hostname, service, port, app, health {status, ms, checkedAt}}`. Ingress dari `~/.cloudflared/config.yml`
(YAML Bun, catch-all dibuang). Health = `GET https://<host>/` tanpa redirect, timeout 8 dtk, cache 60 dtk, single-flight
per host, wildcard tidak dicek (`domain.health.ts`).

**Masalah.**

- Status hanya badge "200 · 85 ms"; tidak ada penjelasan arti (3xx = sehat, 401/403 = mungkin Cloudflare Access, 502 =
  app mati, 530/1033 = tunnel putus). Klien menganggap 4xx "bad" (`panel.status.ts:35`), server "warning".
- Satu probe gagal langsung "Tidak sehat" (tanpa retry) → flapping karena jaringan seluler/Wi-Fi HP.
- Probe hanya berjalan saat ada yang membuka halaman (lazy di request) → tidak ada pemantauan saat tidak ada yang melihat.
- `title` absolut di `span` (`domains.page.tsx:30`) tidak terjangkau sentuhan di HP; tidak ada "dicek 40 dtk lalu".
- Domain → layanan non-pm2 (`panel` → 3200 adalah layanan runit) tampil "tanpa aplikasi" — membingungkan.
- Tidak membedakan "app lokal hidup tapi tunnel mati" vs "app mati": panel punya `net.httpStatus(port)`
  (`system.types.ts:66-71`) yang bisa dipakai sebagai cek kedua lokal (murah, tanpa internet).
- Tidak ada aksi cek ulang manual.

### 2.5 Database (`/panel/databases`)

**Data.** `DatabaseInfo {name, owner, sizeBytes}`, SQL `pg_database` tanpa template & `postgres` (`postgres.termux.ts:14-16`).
Tidak di-poll (benar — ukuran berubah lambat).

**Masalah.** Tabel shadcn mentah tanpa `DataTable` wave A (mobile = tabel geser); tidak ada tautan ke situs pemilik,
tidak ada "cadangan terakhir" per DB (data ada di backup runs), status layanan `postgres` tidak terlihat di halaman
ini (bila postgres mati → error 502 generik "system_error" dengan pesan psql mentah). `listDatabases` memakai timeout
default 10 dtk (`termux.exec.ts:6`) — cukup.

### 2.6 Log viewer

**Data.** `LogLines {lines: string[]}`; default 200, maks 2000; tail 1 MiB terakhir file (`file.tail.ts:4-33`).
Runit: `$PREFIX/var/log/sv/<name>/current`; pm2: `pm_out_log_path`/`pm_err_log_path`. `/dev/logs`: ring buffer
2.000 entri di memori (`log.service.ts:4`), level + cari server-side, refresh 5 dtk opsional.

**Masalah (`log.page.tsx`).**

- Tanpa follow/live: hanya tombol "Muat ulang" (`log.page.tsx:93-96`); setiap render baru **memaksa scroll ke bawah**
  (`log.page.tsx:29-32`) — kebalikan pola benchmark ("auto-scroll yang merebut posisi" = hindari).
- Tanpa cari/filter (kritis untuk log `pm2` runit yang 99% berisi warning pidusage), tanpa salin, unduh, toggle wrap
  (wrap selalu `break-all`), tanpa fullscreen di HP, tanpa penanda stderr.
- Timestamp svlogd UTC mentah di awal tiap baris; tidak diparse/diterjemahkan ke jam lokal.
- `<pre>` dengan 2.000 baris × `break-all` di HP murah masih OK (≤1 MiB teks), tapi tanpa batas DOM saat follow nanti.
- stdout/stderr pakai `Select` (2 opsi) — segmented control lebih cepat di HP.
- Log rotasi: runit (`@…​.s`) dan pm2 (`.gz`) tidak terjangkau; `current` kosong setelah rotasi → "Belum ada log".
- Dua implementasi log berbeda (`log.page.tsx` `<pre>`, `/dev/logs` `<ol>` dengan level) — benchmark §6 minta satu
  komponen `LogViewer`.
- Keamanan: log aplikasi bisa berisi secret yang dicetak aplikasi (mis. `DATABASE_URL`). Hari ini ditampilkan apa adanya
  ke semua `admin`. Tidak ada redaksi.

### 2.7 Polling & biaya di HP

- `useApiQuery` (`use-api-query.ts:34-38`): `setInterval(reload, refreshMs)` **tanpa** jeda saat tab tersembunyi
  (`document.visibilityState`), tanpa backoff saat error, dan `reload` meng-**abort** request yang masih jalan
  (`use-api-query.ts:31`). Bila overview > 10 dtk (pm2 lambat + probe timeout 8 dtk), klien terus membatalkan dan tidak
  pernah menerima data; server tetap mengerjakan setiap request yang dibatalkan.
- Interval: overview/services/apps/domains 10 dtk; `/dev` 15 dtk; `/dev/logs` 5 dtk. Tab yang lupa ditutup di laptop
  = polling 24 jam.
- Biaya per poll overview (terukur): `pm2 jlist` ~0,5 dtk CPU + `sv status` 0,02 + baca `/proc/meminfo` + `statfs` +
  SQLite; baterai di-cache 30 dtk (0,7–1,25 dtk per baca); probe HTTPS tiap 60 dtk per domain. ≈ **5% satu core terus
  menerus per tab** yang terbuka di Ringkasan atau Aplikasi; 2 tab + 1 HP = ~15%. Tidak ada dedup antar-tab/klien
  di server.
- Setelah logger request (commit 6e34376, `request.log.ts:27-36`) di-deploy: tiap poll = 1 baris `info` ke ring buffer
  dan ke svlogd (flash). 1 tab → 8.640 baris/hari; ring 2.000 entri `/dev/logs` tergusur poll dalam ±5,5 jam, menenggelamkan
  log bermakna.

### 2.8 Notifikasi / alert

Tidak ada sama sekali. Masalah hanya terlihat bila admin membuka `/panel` — dan saat ini pun tidak ditampilkan (§2.1).
Tidak ada proses latar yang mengevaluasi kondisi; scheduler satu-satunya adalah backup (`backup.service.ts:210-227`, tick
interval) dan sweeper upload.

### 2.9 Histori metrik

Tidak ada. Semua nilai adalah snapshot saat request. Konsekuensi: tidak bisa menjawab "kapan app mati?", "domain
sering putus?", "baterai turun sejak jam berapa?", "memori naik terus (leak)?".

### 2.10 Test yang ada

`tests/panel.problems.test.ts` (aturan problems), `tests/panel.api.test.ts` (shape overview, kontrol, protected, busy,
log clamp), `tests/panel.parsers.test.ts` (parser sv/jlist/ingress/psql/meminfo/battery), `tests/web.panel.test.ts`
(tone, countProblems, actionBlocks, log params). Tidak ada test untuk polling (visibility/abort), format load, atau
parsing timestamp log.

---

## 3. Standar industri

Mengulang dan memperluas `docs/research/ui-benchmark.md`.

| Topik              | Produk & di mana                                                                                                                                                                                                                                                            | Pola                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Problem-first      | Uptime Kuma dashboard (README screenshot, benchmark §2); Coolify status pill di tiap baris (benchmark §1)                                                                                                                                                                   | Status/masalah di atas, metrik sesudahnya                                          |
| Heartbeat strip    | Uptime Kuma: 30 bar terakhir, "Check every 60 seconds", Uptime 24h/30d                                                                                                                                                                                                      | Histori sederhana tanpa grafik; butuh penyimpanan cek                              |
| Retry sebelum down | Uptime Kuma: pengaturan _Retries_ + _Heartbeat Retry Interval_ per monitor (form "Add New Monitor")                                                                                                                                                                         | Debounce: down hanya setelah N gagal berturut-turut                                |
| Metrik             | Dokploy: CPU/memori/disk/network + notifikasi ambang (benchmark §2); Fly.io metrics (Grafana, benchmark sumber); Railway tab Metrics per service                                                                                                                            | Grafik rentang waktu (1 jam/6 jam/24 jam/7 hari)                                   |
| Log                | Coolify: follow, scroll-ke-bawah, fullscreen, copy, download, find; Render: live tail + rentang waktu; Vercel: filter level; Railway: sintaks filter (benchmark §6)                                                                                                         | Satu viewer, follow yang berhenti saat scroll ke atas                              |
| Notifikasi         | Coolify docs `knowledge-base/notifications` (diakses 2026-11-26): Email (SMTP/Resend), Discord, **Telegram (bot token + chat ID)**, Slack/Mattermost, Pushover, Webhook; event dikelompokkan deployment, backup, scheduled task, container, server; pilih event per channel | Channel per tujuan, event dapat dipilih                                            |
| Push tanpa akun    | ntfy (`docs.ntfy.sh/publish`, diakses 2026-11-26): `POST ntfy.sh/<topic>` dengan header `Title`, `Priority` 1–5, `Tags`, `Click`; tanpa sign-up, nama topik = "password"                                                                                                    | Paling sederhana; aplikasi Android ntfy                                            |
| Telegram           | Bot API `https://api.telegram.org/bot<token>/sendMessage` (`chat_id`, `text`, `parse_mode` HTML/MarkdownV2). Halaman docs tidak bisa diambil saat riset (ECONNREFUSED dari mesin riset); dari HP `api.telegram.org` terjangkau                                              | Populer di kalangan dev Indonesia; perlu buat bot via @BotFather                   |
| Web Push           | Standar W3C Push API + VAPID (RFC 8292) + enkripsi payload `aes128gcm` (RFC 8291); iOS hanya untuk web app yang di-"Add to Home Screen" (iOS 16.4+)                                                                                                                         | Tanpa pihak ketiga selain push service browser; butuh service worker + kunci VAPID |

Catatan jujur: Uptime Kuma, Coolify, Dokploy berjalan di server Linux yang menyediakan `/proc/stat`; tidak ada produk
pembanding yang menghadapi load Android. Rujukan "load per core" mereka tidak berlaku di sini.

---

## 4. Kebutuhan produksi

**Keamanan**

- Semua API monitoring tetap `admin` + Cloudflare Access (sudah). Kontrol tetap teraudit (sudah).
- Kredensial notifikasi (token bot Telegram, topik ntfy, kunci VAPID privat) = setting rahasia terenkripsi
  (`settings.service.ts` + `data/secret`, pola sama dengan `cloudflare.api_token`), tidak pernah dikirim balik.
- Isi notifikasi tidak boleh memuat isi log/env; cukup jenis + nama resource + tautan ke panel (tautan masih terlindungi
  Access + login).
- Log aplikasi bisa berisi secret yang dicetak aplikasi: minimal redaksi pola umum (`postgres://user:pass@`,
  `*_TOKEN=`, `*_SECRET=`) di server sebelum dikirim. Tidak sempurna — beri tahu di UI ("log ditampilkan apa adanya").
- Unduh log = audit `log.download` (konsisten dengan `backup.download`).

**Keandalan / failure modes**

| Kegagalan                                | Perilaku yang diharapkan                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pm2 daemon mati / `rpc.sock` hilang      | Hari ini daftar kosong diam-diam (`pm2.termux.ts:107`). Harus jadi masalah "pm2 tidak berjalan".                                                                                                         |
| `termux-battery-status` hang             | Sudah: timeout 5 dtk → `null` → "Info baterai tidak tersedia". Pertahankan.                                                                                                                              |
| `/proc/meminfo` gagal                    | Sekarang menggagalkan seluruh overview; seharusnya degradasi per bagian seperti services.                                                                                                                |
| Probe HTTPS gagal sekali                 | Jangan langsung merah; 2–3 gagal berturut-turut.                                                                                                                                                         |
| Internet HP putus                        | Semua probe gagal serentak → satu masalah "HP tidak bisa menjangkau internet", bukan N domain merah; notifikasi keluar juga tidak bisa terkirim (antre, kirim saat pulih, atau buang — PLAN memutuskan). |
| Restart `panel`/`cloudflared` dari panel | UI tahu koneksi akan putus; menunggu pulih, bukan toast gagal.                                                                                                                                           |
| Panel sendiri mati                       | Panel tidak bisa memberi tahu dirinya mati. Hanya pemantau luar (heartbeat ke ntfy/healthchecks, atau Uptime Kuma di tempat lain) yang bisa. Nyatakan batas ini.                                         |

**Integritas data.** Histori metrik bukan data kritis: boleh hilang, tidak boleh membesar tanpa batas (retensi +
VACUUM/`DELETE` terjadwal), tidak ikut ke cadangan harian (atau ikut — PLAN putuskan; ukuran kecil).

**Performa di HP.** Target: panel idle (tanpa tab terbuka) < 1% CPU rata-rata; satu tab Ringkasan terbuka < 3%.
Prinsip: satu sampler server-side, snapshot di-cache dan dibagi semua klien; klien berhenti polling saat tab tersembunyi.

**Aksesibilitas (WCAG AA).** Status = titik + teks (sudah di `StatusBadge`); daftar masalah `role="status"`/`aria-live="polite"`
hanya untuk perubahan, bukan tiap poll (agar pembaca layar tidak membaca ulang tiap 10 dtk); progressbar punya
`aria-valuenow` (sudah di `StatTile`); log viewer: tombol ikon ber-`aria-label`, area log `role="log"` dan bisa difokus
untuk scroll keyboard; target sentuh ≥ 44px untuk aksi kontrol; jangan andalkan `title` (tak terjangkau sentuhan).

**Mobile.** 390px: Ringkasan tanpa scroll untuk "ada yang rusak?"; log fullscreen; aksi layanan lewat menu ⋯ +
satu aksi utama kontekstual (Mulai bila mati, Mulai ulang bila jalan).

**Observability panel sendiri.** Request log jangan mencatat poll sukses di level `info` (turunkan GET polling 2xx ke
`debug`, atau sampel). Sampler mencatat durasi tiap siklus di `debug` dan `warn` bila > ambang.

---

## 5. Kesenjangan (gap list)

| #   | Gap                                                                                              | Sev | Kenapa                                                                              | Bukti                                                      |
| --- | ------------------------------------------------------------------------------------------------ | --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Ringkasan tidak menampilkan `problems`, `backup`, `recentActivity`, `sites`                      | P0  | Pertanyaan utama "ada yang rusak?" tak terjawab padahal datanya sudah ada           | `overview.page.tsx:27-62` vs `panel.service.ts:103-111`    |
| 2   | Aturan masalah ganda klien/server, tidak konsisten (4xx, app stopped)                            | P0  | Angka "2 perlu dicek" beda dengan daftar masalah                                    | `panel.status.ts:49-55`, `overview.problems.ts:32,57`      |
| 3   | `Problem` tanpa kode + param; message Inggris                                                    | P0  | Tak bisa diterjemahkan/ditaut ke resource dengan benar                              | `panel.types.ts:77`, `overview.problems.ts:54`             |
| 4   | Polling tanpa pause saat tersembunyi, abort request lambat, tanpa backoff                        | P0  | Baterai/CPU HP-server; overview lambat tak pernah selesai                           | `use-api-query.ts:31,34-38`                                |
| 5   | Tak ada dedup/cache snapshot server-side; tiap tab = `pm2 jlist` per 10 dtk                      | P0  | ~5% core per tab                                                                    | §2.0 pengukuran, `panel.service.ts:83,88`                  |
| 6   | Load ditampilkan tanpa konteks; ambang per-core Linux selalu merah di Android                    | P0  | Menyesatkan/menakutkan; "angka jujur" adalah prasyarat kepercayaan                  | `device.cards.tsx:27`, `format.ts:92-106`, load nyata 20,9 |
| 7   | "CPU 0%" palsu untuk aplikasi                                                                    | P0  | Data salah yang terlihat benar                                                      | `apps.page.tsx:20`, jlist `cpu=0` ketiga app               |
| 8   | Restart `panel` dari panel = toast gagal; stop `pm2`/`postgres` tanpa peringatan akibat          | P0  | Aksi berbahaya tanpa penjelasan; hasil palsu                                        | `panel.status.ts:61-78`, `id.panel.ts:74`                  |
| 9   | Log viewer: tanpa cari, follow, salin, unduh, wrap; paksa scroll ke bawah tiap render            | P0  | Log `pm2` 99% noise; tidak bisa dipakai di HP                                       | `log.page.tsx:27-41,93`, §2.0 log pm2                      |
| 10  | Request log `info` tiap poll (setelah rilis berikutnya)                                          | P0  | Menenggelamkan `/dev/logs`, menulis flash terus                                     | `request.log.ts:27-36`                                     |
| 11  | Baterai tidak dicas/`plugged` tidak dianggap masalah; suhu 0 °C palsu                            | P1  | Risiko mati total server; saat riset HP DISCHARGING 88%                             | `device.termux.ts:25-29`, `overview.problems.ts:83`        |
| 12  | pm2 daemon mati = daftar kosong diam-diam                                                        | P1  | Kondisi terburuk terlihat seperti "belum ada aplikasi"                              | `pm2.termux.ts:107`                                        |
| 13  | Probe domain tanpa retry; tanpa cek lokal port; tanpa penjelasan kode HTTP; tanpa "dicek X lalu" | P1  | Flapping, diagnosis lambat                                                          | `domain.health.ts`, `domains.page.tsx:30`                  |
| 14  | Tidak ada notifikasi apa pun                                                                     | P1  | Server di HP tanpa layar: tanpa notifikasi, masalah ditemukan oleh pengunjung situs | §2.8                                                       |
| 15  | Tidak ada sampler latar (prasyarat 14 dan 16)                                                    | P1  | Pemantauan hanya terjadi bila ada yang melihat                                      | §2.8                                                       |
| 16  | Tidak ada histori (heartbeat domain, status, baterai/memori)                                     | P1  | "Sejak kapan?" tak terjawab; crash loop tak terdeteksi                              | §2.9                                                       |
| 17  | Timestamp svlogd UTC mentah                                                                      | P1  | Dua jam berbeda per baris, membingungkan                                            | §2.0 format log                                            |
| 18  | Kartu Ringkasan 1 kolom ±1.000px di HP                                                           | P1  | Benchmark ≤200px untuk vitals                                                       | `overview.page.tsx:15,21`                                  |
| 19  | Label `down` sengaja = "Mati"; durasi down tidak diparse                                         | P1  | Glosarium status benchmark                                                          | `id.panel.ts:46`, `runit.termux.ts:36`                     |
| 20  | Tautan app ↔ situs ↔ domain via tabel `site` belum dipakai                                       | P1  | Domain "tanpa aplikasi" untuk app nyata                                             | `panel.service.ts:69`, kasus `makuro-solusi`               |
| 21  | String "lama" masih dipakai (`refreshing`, `confirmBody`, `done`); konfirmasi untuk Mulai        | P1  | Content guide                                                                       | `id.panel.ts:23-24,65-66,75-76`, `control.buttons.tsx:59`  |
| 22  | Overview gagal total bila device gagal; `pm2.list` serial                                        | P1  | Degradasi per bagian                                                                | `panel.service.ts:87-93`                                   |
| 23  | Redaksi secret di log aplikasi                                                                   | P1  | Log bisa berisi `DATABASE_URL` dsb.                                                 | §4                                                         |
| 24  | Modul pm2 (`pm2-logrotate`) tampil sebagai aplikasi                                              | P2  | Noise; bisa dikelompokkan "Modul pm2"                                               | jlist `pmx_module=true`                                    |
| 25  | Log rotasi (`.s`, `.gz`) tak terjangkau                                                          | P2  | Log kosong setelah rotasi                                                           | §2.0                                                       |
| 26  | Database: tanpa `DataTable`, tanpa tautan situs/cadangan terakhir                                | P2  | Konsistensi pola daftar                                                             | `databases.page.tsx`                                       |
| 27  | Fake adapter tidak mewakili Android (load 1,2, cpu ada)                                          | P2  | Desain diuji pada data mustahil                                                     | `system.fake.ts:214`                                       |
| 28  | Heartbeat panel ke luar ("dead man's switch")                                                    | P2  | Panel mati tak bisa memberi tahu dirinya mati                                       | §4                                                         |

---

## 6. Opsi & trade-off

### 6.1 Menyajikan load average secara jujur (gap 6)

Fakta: di Android load mencakup ratusan thread sistem (termasuk tugas D-state/I/O dan proses semua aplikasi Android),
bukan hanya Termux. Pada HP ini baseline idle ±20 di 8 core. CPU% tidak tersedia (`/proc/stat` EACCES).

| Opsi                                          | Isi                                                                                                                                          | +                                       | −                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| A. Sembunyikan load                           | Tidak tampil                                                                                                                                 | Tidak menyesatkan                       | Membuang satu-satunya sinyal CPU                          |
| B. Angka mentah + ambang per-core Linux       | "20,9 / 8 inti" merah                                                                                                                        | Familiar bagi admin Linux               | Selalu merah; salah                                       |
| C. **Angka relatif terhadap baseline HP ini** | "Beban sistem 20,9 · normal untuk HP ini (biasanya 18–22)"; tone dari deviasi vs median 24 jam (mis. > 1,5× median = warning, > 2× = danger) | Jujur dan berguna (mendeteksi lonjakan) | Butuh histori (gap 16); minggu pertama belum ada baseline |
| D. Netral selalu + penjelasan                 | "20,9 · 20,7 · 20,0" tone netral + info "Di Android angka ini mencakup proses sistem; bandingkan dengan nilai biasanya"                      | Tanpa histori, jujur                    | Tidak memberi verdict                                     |

**Rekomendasi:** D sekarang (label "Beban sistem (1/5/15 mnt)", bukan "Beban CPU"; netral; teks bantuan satu kalimat;
jangan pakai `formatLoadPerCore` di mode termux), lalu C setelah histori ada. Jangan pernah membuat masalah/notifikasi
dari load absolut.

### 6.2 Strategi refresh (gap 4, 5)

| Opsi                                  | Cara                                                                                                                                                            | +                                                | −                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A. Perbaiki polling klien saja        | pause saat `visibilityState=hidden`, refresh segera saat kembali terlihat, jangan abort request yang masih jalan (lewati tick), backoff 10→20→60 dtk saat error | Kecil, tanpa server                              | Tiap tab tetap memicu `pm2 jlist`                                                             |
| B. **A + cache snapshot server-side** | Satu `snapshot()` single-flight, TTL ±5 dtk (pola sama `domain.health.ts`); services/apps/domains/overview membaca snapshot                                     | Biaya tetap berapa pun jumlah tab; murah ditulis | Data maks 5 dtk basi (tak masalah)                                                            |
| C. SSE/WebSocket push dari sampler    | Server mendorong perubahan                                                                                                                                      | Real-time, satu sumber                           | Lebih banyak kode; Cloudflare Tunnel + HP tidur: koneksi panjang rawan putus; reconnect logic |

**Rekomendasi:** B. Interval tetap 10 dtk saat terlihat untuk Ringkasan/Layanan/Aplikasi, 30 dtk untuk Domain
(health cache 60 dtk), Database tanpa polling. Tampilkan "Diperbarui 12 dtk lalu" (`PageHeader.meta.updatedAt` dari
`generatedAt`) dan tombol muat ulang. C hanya bila follow log butuh (lihat 6.4).

### 6.3 Sampler latar + histori metrik (gap 15, 16)

| Opsi                     | Cara                                                                                                                                                                                                                                                                                                          | +                                                                                     | −                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A. Tanpa histori         | Snapshot saja                                                                                                                                                                                                                                                                                                 | Nol biaya                                                                             | Tak ada "sejak kapan", tak ada notifikasi andal, tak ada baseline load |
| B. Ring buffer di memori | Sampler 60 dtk, simpan 24 jam di RAM                                                                                                                                                                                                                                                                          | Tanpa tulis flash                                                                     | Hilang tiap restart/upgrade panel (sering: tiap deploy panel)          |
| C. **SQLite ringan**     | Sampler 60 dtk menulis 1 baris `metric_sample` (ts, battery%, plugged, temp, memAvailMb, diskFree, load1, svcDown, appBad) + `check_result` per domain (ts, host, status, ms) + `status_change` (resource, dari→ke, ts) hanya saat berubah. Retensi: mentah 7 hari, lalu hapus (atau agregat per jam 30 hari) | Bertahan restart; dasar notifikasi, heartbeat strip, baseline load; drizzle sudah ada | Migration + job retensi; tulis flash                                   |

Ukuran C: 1.440 baris/hari × ~60 B ≈ 86 KB/hari sampel + 2 domain × 1.440 cek ≈ 2.880 baris/hari → 7 hari < 2 MB. Tulis
1 transaksi/menit ≈ beberapa MB/hari tulis WAL — dapat diabaikan untuk flash modern. Biaya CPU sampler: `pm2 jlist`
0,5 dtk/menit (≈0,8% core), baterai dibaca tiap 5 mnt (Termux:API mahal), probe domain 60 dtk.

**Rekomendasi:** C dengan cakupan kecil: `status_change` (paling bernilai: riwayat "mati sejak", crash loop) +
`check_result` domain (heartbeat strip 30 cek ala Uptime Kuma) + `metric_sample` per menit. Tanpa grafik interaktif di
fase pertama: sparkline SVG kecil (24 jam) untuk baterai/memori/load cukup; library chart baru tidak perlu. Sampler
sama dipakai snapshot cache (6.2) dan evaluator alert (6.5) — satu loop, bukan tiga.

### 6.4 LogViewer (gap 9, 17, 23, 25)

| Opsi                                                                                                                                                          | Follow                            | +                                                                            | −   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- | --- |
| A. **Poll tail 3 dtk saat follow aktif** dengan `?after=<byteOffset>` (server kirim baris baru sejak offset + offset baru; deteksi rotasi bila size < offset) | Tail hemat, tanpa koneksi panjang | Latensi ±3 dtk; `pm2 jlist` per poll → cache path log dari snapshot          |
| B. SSE `fs.watch`                                                                                                                                             | Real-time                         | Koneksi panjang via tunnel; `fs.watch` di Android/SELinux perlu diverifikasi |
| C. Tanpa follow, hanya muat ulang                                                                                                                             | Sederhana                         | Di bawah standar                                                             |

**Rekomendasi:** A. Satu komponen `LogViewer` (dipakai layanan, aplikasi, `/dev/logs`, log deploy/job) dengan: follow
(mati otomatis saat scroll ke atas, tombol "Baris baru (n)"), cari klien (highlight + "hanya baris cocok"), wrap toggle
(default on di HP), salin (semua/tersaring), unduh `.log` (dari server, audit), fullscreen sheet di HP, segmented
stdout/stderr/semua, batas 2.000 baris di DOM dengan teks "Menampilkan 2.000 baris terakhir". Server: parse prefix
`svlogd -tt` (UTC) → kirim `{at, text}` agar UI menampilkan `HH.mm.ss` lokal; redaksi pola secret umum. Rotasi:
P2 — opsi "termasuk file sebelumnya" membaca satu file rotasi terakhir (`.s` teks biasa; `.gz` via `Bun.gunzipSync`).

### 6.5 Notifikasi (gap 14, 28)

Event kandidat (dari `problems` + `status_change`, dengan debounce): layanan `wantUp` tidak jalan > 2 sampel; app
errored/crash loop (restarts bertambah ≥ 3 dalam 10 mnt); domain gagal 3 cek berturut-turut (dan pulih); cadangan
gagal/terlambat; baterai < 20% tidak dicas, HP dicabut dari charger (plugged → UNPLUGGED), suhu ≥ 45 °C; disk < 10%;
deploy/rollback otomatis (domain worker lain). Kirim saat masuk masalah **dan** saat pulih; satu pesan per transisi;
batas laju (mis. maks 1 pesan/resource/15 mnt, ringkas bila banyak serentak, mis. internet pulih).

| Opsi                                                         | Setup bagi user                                                                                                              | Kode                                                                                                       | Andal di HP              | Catatan                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| A. In-app saja (daftar masalah + badge di sidebar/judul tab) | Nol                                                                                                                          | Kecil                                                                                                      | Ya                       | Hanya terlihat bila panel dibuka — tidak menyelesaikan masalah inti                                                         |
| B. **Telegram bot**                                          | Buat bot di @BotFather, tempel token + chat ID (panel bisa bantu: "kirim /start ke bot, lalu klik Deteksi" via `getUpdates`) | 1 `fetch` POST; ~40 baris                                                                                  | Ya (terjangkau, 0,8 dtk) | Paling lazim di dev Indonesia; Coolify mendukung channel yang sama                                                          |
| C. ntfy                                                      | Pasang app ntfy, isi nama topik acak (atau server ntfy sendiri)                                                              | 1 `fetch` POST; ~20 baris                                                                                  | Ya (2,1 dtk)             | Tanpa akun; topik publik = rahasia lemah (topik harus acak panjang, simpan sebagai setting rahasia)                         |
| D. Email                                                     | SMTP/Resend API key                                                                                                          | SMTP butuh library atau protokol manual; Resend = HTTP tapi vendor lain                                    | Ya                       | Lambat dibaca di HP, setup paling berat                                                                                     |
| E. Web Push                                                  | Izinkan notifikasi di browser; iOS harus "Add to Home Screen"                                                                | Service worker + VAPID (ES256) + enkripsi RFC 8291 tanpa dependency ≈ 150–200 baris, atau paket `web-push` | Ya                       | Tanpa pihak ketiga; tetapi ini web app tanpa manifest/PWA hari ini, dan Cloudflare Access bisa memblok fetch service worker |
| F. Webhook generik (POST JSON)                               | Isi URL                                                                                                                      | ~20 baris                                                                                                  | Ya                       | Menutup Discord/Slack/ntfy/Uptime Kuma push sekaligus untuk power user                                                      |

**Rekomendasi:** fase 1 = A (wajib, gratis dari gap 1) + B Telegram sebagai satu-satunya channel eksternal, dengan
tombol "Kirim notifikasi uji". Fase 2 = F webhook generik (menutup ntfy/Discord). Tunda D dan E (biaya setup/kode
tidak sebanding untuk 1–3 admin). Untuk gap 28 (panel sendiri mati): dokumentasikan saja — sarankan monitor luar
(Uptime Kuma di tempat lain / healthchecks) yang memantau `https://panel.<domain>/api/health`; heartbeat keluar
dari panel bersifat P2.

### 6.6 Aksi berbahaya pada layanan inti (gap 8)

| Opsi                                                                                                                                                                                                           | +                      | −                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| A. Perluas default `panel.protected_services` dengan `pm2,postgres`                                                                                                                                            | Satu baris             | Admin tidak bisa stop postgres untuk maintenance dari panel |
| B. **Peringatan akibat per layanan** (pm2: "Semua aplikasi ikut berhenti", postgres: "Situs yang memakai database tidak bisa diakses", cloudflared: sudah ada) + konfirmasi ketik nama untuk stop layanan inti | Tetap fleksibel, jujur | Tabel akibat dipelihara                                     |
| C. Restart `panel` khusus: server jawab `202` lalu `sv restart` tertunda ±500 ms; UI tampil "Panel dimulai ulang…" dan poll `/api/health` sampai versi kembali                                                 | Hasil benar            | Kode khusus satu kasus                                      |

**Rekomendasi:** B + C. A tidak.

---

## 7. Risiko & pertanyaan terbuka

**Keputusan untuk PLAN**

1. Bentuk `Problem` baru: `{ code, kind, target, severity, params, since? , href }` — kode stabil (mis. `service_down`,
   `app_errored`, `domain_unreachable`, `battery_unplugged`) dipakai i18n, notifikasi, dan dedup. Ini mengubah kontrak
   `src/shared/panel.types.ts` (internal, klien sama-sama di repo; tidak ada konsumen luar).
2. Hapus `countProblems` klien; hitungan per kartu diturunkan dari `problems` server (satu sumber).
3. App `stopped` (sengaja) bukan masalah, seperti layanan `wantUp=false`. pm2 tidak menyimpan "want"; pembeda praktis:
   stop lewat panel dicatat di audit → dianggap sengaja. Perlu diputuskan.
4. Lingkup histori: hanya `status_change` + `check_result` (cukup untuk heartbeat dan "sejak kapan"), atau juga
   `metric_sample` per menit (baseline load, sparkline baterai). Rekomendasi: ketiganya, retensi 7 hari.
5. Interval sampler 60 dtk dan baca baterai 5 mnt — terima atau ubah? (Dampak: ≈1% core rata-rata, terus-menerus.)
6. Request log: turunkan GET 2xx berulang (`/api/panel/*` polling) ke `debug` — perlu koordinasi dengan worker
   Administrasi/log.
7. Ambang notifikasi baterai: kirim saat dicabut dari charger (instan) atau hanya < 20%? Untuk server HP, saya
   rekomendasikan keduanya, dengan "dicabut" sebagai warning.

**Risiko**

- Sampler latar menambah beban permanen; bila `pm2 jlist` hang (timeout 20 dtk), loop harus single-flight dan
  tidak menumpuk.
- `fs.watch`/offset tail pada file yang dirotasi svlogd: deteksi rotasi wajib (size < offset → mulai dari awal file baru).
- Notifikasi bisa "badai" saat internet HP pulih (semua domain pulih serentak) → ringkas jadi satu pesan.
- Redaksi log tidak akan sempurna; jangan menjanjikan "aman".
- Cloudflare Access: tautan di notifikasi membuka halaman Access dulu (benar, tapi jelaskan).
- Mode demo harus bisa menghasilkan problems, histori palsu, dan load ±20 agar UI diuji pada bentuk data nyata.

**Pertanyaan untuk owner (sedikit, keputusan nyata)**

1. Channel notifikasi eksternal pertama: **Telegram** (rekomendasi), ntfy, atau belum perlu sama sekali di rilis ini?
2. Boleh panel menyimpan histori metrik 7 hari di `panel.db` (≈2 MB, tulis 1×/menit)?
3. Apakah admin boleh menghentikan `pm2`/`postgres` dari panel (dengan konfirmasi ketik nama), atau jadikan protected
   default?

---

### Lampiran A — Perintah verifikasi yang dipakai (read-only)

`nproc; uptime` · `sv status $SVDIR/*` · `ls/du $PREFIX/var/log/sv/*`, `tail -n 3 …/current | cut -c1-160` ·
`pm2 jlist` diparse lokal di HP, hanya nama/status/cpu/mem/restarts/pmx_module dicetak (env tidak pernah dicetak) ·
`termux-battery-status` · `psql -At … pg_database` · `grep hostname/service ~/.cloudflared/config.yml` · `free -m`,
`df -h $HOME` · `cat /proc/loadavg /proc/stat /proc/pressure/cpu` (semua EACCES) · `time` untuk jlist/battery/sv/curl ·
`curl -m 8` ke api.telegram.org, ntfy.sh, fcm.googleapis.com. Tidak ada restart/stop, `.env` tidak dibaca.
