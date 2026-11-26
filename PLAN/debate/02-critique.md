# Kritik PLAN/02 — Monitoring

Kritikus: wkr-critic-02 · Tanggal: 2026-11-26 · Basis: `feature/production-polish` @ caa4308.
Dibaca: `PLAN/02-monitoring.md` (utuh), `R&D/02-monitoring.md`, PLAN/01, /03, /04, /05 (bagian kontrak), kode yang
diubah. Diukur read-only di POCO (`ssh poco`, tanpa restart, tanpa mencetak secret). Fakta Telegram dicek ke
`core.telegram.org/bots/api` dan `/bots/faq` lewat ego-browser. Semantik pm2 dicek ke source `Unitech/pm2` (`gh api`).

## 1. Ringkasan penilaian

**Verdict: siap dengan revisi. Dua bagian perlu ditulis ulang: §4.6 (mesin alert: penutupan event, cooldown,
penggantian) dan baris baterai/crash-loop di tabel aturan §3.1.**
Arsitekturnya benar dan hemat: satu sampler, aturan hanya di server, histori di SQLite, rekonsiliasi status yang
bertahan restart. Masalahnya ada di detail state machine. Event ditutup setiap kali sebuah problem "tidak muncul",
termasuk saat datanya gagal dibaca atau problemnya sedang digantikan problem lain. Akibatnya Telegram akan sering
mengirim "PULIH" palsu. Selain itu, aturan crash loop dan baterai akan berbunyi pada operasi normal di HP ini, karena
restart manual menambah `restart_time` dan HP produksi saat ini memang sedang tidak dicolok. Kontrak dengan PLAN/01,
/03, dan /05 belum cocok di lima titik. Restart panel lewat `sv` detached bisa diganti dengan `process.exit` yang jauh
lebih sederhana.

Jumlah temuan: BLOCKER 2 · MAJOR 13 · MINOR 7 · OVER 2.

### Ukuran yang diambil di POCO (2026-11-26, read-only)

| Perintah                         | Hasil                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pm2 jlist` ×3                   | real 0,73 / 0,47 / 0,46 dtk; **user+sys 0,66 / 0,58 / 0,54 dtk** (PLAN memakai 0,5)                      |
| `termux-battery-status` ×3       | real 1,31 / 0,93 / 0,93 dtk; user+sys klien ≤ 0,02 dtk (CPU di sisi aplikasi Termux:API tidak terhitung) |
| `sv status` semua layanan        | real 0,01 dtk                                                                                            |
| `curl https://api.telegram.org/` | 302, 1,0 dtk · `gstatic generate_204` 204, 0,32 dtk                                                      |
| Isi baterai saat ini             | `plugged: "UNPLUGGED"`, `status: "DISCHARGING"`, 81%, 39,5 °C, `health: "GOOD"`                          |
| Run script runit                 | `panel`: `exec ./panel`; `pm2`: `exec node …/pm2-runtime ~/sites/ecosystem.config.js`; log `svlogd -tt`  |
| `~/.pm2/rpc.sock`                | ada (dibuat 25 Nov 12:18), pm2-runtime jalan 123.864 dtk                                                 |
| `/proc/loadavg`                  | EACCES (cocok dengan R&D; `os.loadavg()` tetap dipakai)                                                  |

---

## 2. Temuan

### C1 — Bagian yang gagal dibaca menutup event dan mengirim "PULIH" palsu

- **Severity:** BLOCKER · **Area:** flow
- **Klaim di PLAN:** §4.6 langkah 3: "Event terbuka yang `key`-nya tidak ada lagi → `closed_at = now`." §4.1 langkah 4:
  "bagian snapshot gagal → bagian itu `unavailable`, tick lanjut."
- **Masalah:** Ada bagian yang gagal di sebuah tick (jlist timeout 20 dtk, `termux-battery-status` hang sehingga
  baterai jadi `null`, `backup.status()` melempar, `listIngress` gagal). Problem dari bagian itu otomatis lenyap dari
  `computeProblems`. Mesin alert lalu menutup event yang sudah diberitahukan dan mengirim "PULIH". Tick berikutnya
  datanya terbaca lagi, event baru dibuka dengan `opened_at` baru, dan setelah delay terkirim "GAWAT" lagi.
  Contohnya: `app_errored:blog` sudah dikirim, lalu jlist gagal satu kali, dan pemilik menerima "PULIH · Aplikasi
  blog…" padahal aplikasinya masih mati. Baterai lebih buruk lagi. K6 menyebut "Baterai tak terbaca (`null`) bukan
  masalah", jadi satu kali Termux:API timeout (sudah ditangani `device.termux.ts:44-55` → `null`) menutup
  `battery_unplugged`. Kejadian ini sering, bukan kasus pinggiran. R&D mencatat `termux-battery-status` 0,7–1,25 dtk,
  dan di POCO hari ini terukur 1,31 dtk.
- **Usulan:** `computeProblems` mengembalikan `{ problems, unknown: Set<ProblemKind | "battery"> }`, diturunkan dari
  `unavailable` dan dari baterai `null`. Langkah 3 menjadi: tutup event hanya bila kind-nya **terbaca** di tick ini.
  Event dari kind yang tidak terbaca dibiarkan terbuka tanpa diubah. Tambahkan test di `alert.engine.test.ts`:
  "pm2 gagal 1 tick → tidak ada pulih, tidak ada event baru".

### C2 — Penggantian problem ("menggantikan") menghasilkan "PULIH" palsu

- **Severity:** BLOCKER · **Area:** data/flow
- **Klaim di PLAN:** §3.1: `battery_low` "menggantikan unplugged"; `pm2_unavailable` "menggantikan `service_down:pm2`";
  K18 `internet_down` "menggantikan problem per-domain".
- **Masalah:** Kunci dedupe adalah `code:target`, jadi penggantian berarti satu kunci ditutup dan kunci lain dibuka.
  Saat baterai turun dari 21% ke 19% tanpa dicas, satu digest berisi "PULIH · HP tidak sedang dicas" dan "GAWAT ·
  Baterai tinggal 19%". Isi PULIH itu salah. Saat internet putus padahal `domain_unreachable:x` sudah diberitahukan,
  event domain ditutup dan "PULIH x bisa dijangkau lagi" menunggu terkirim begitu internet kembali, padahal domainnya
  mungkin masih mati.
- **Usulan:** (a) Baterai: satu kode `battery_power` dengan severity naik (warning bila tidak dicas, danger bila < 20%).
  Eskalasi sudah ditangani §4.6, dan ini menghapus satu kode. (b) Untuk `pm2_unavailable` dan `internet_down`, gunakan
  daftar `suppressed` di keluaran `computeProblems`. Event yang di-suppress tidak ditutup dan tidak dikirim. Event itu
  baru dievaluasi lagi setelah problem penggantinya selesai. Sebutkan ini di tabel §3.1 kolom baru "menahan".

### C3 — Cooldown disimpan per baris event, jadi flapping tidak teredam

- **Severity:** MAJOR · **Area:** data/flow
- **Klaim di PLAN:** K11 "cooldown 15 mnt per kunci", tetapi `last_sent_at` ada di baris `problem_event` (§3.4).
  K10: domain "pulih setelah 1 cek sehat".
- **Masalah:** Setiap kali problem buka lagi, baris baru dibuat dengan `last_sent_at = NULL`, sehingga cooldown tidak
  berlaku antar-event. Ambil contoh domain yang pola ceknya gagal-gagal-gagal-sehat setiap 4 menit (app yang OOM lalu
  di-restart pm2, atau tunnel yang goyah). Delay `domain_*` adalah 0, jadi hasilnya buka → pulih → buka sekitar 15 pesan
  per jam, dan hanya plafon 20/jam yang menahannya. Kabel charger goyang juga membuat `battery_unplugged` buka-tutup.
  Pulih setelah 1 sampel sehat juga tidak sesuai praktik umum. Prometheus/Alertmanager memakai `for` + `resolve_timeout`,
  dan Uptime Kuma memakai retries.
- **Usulan:** (1) Histeresis penutupan: event ditutup setelah problem absen **2 tick berturut-turut**, dan untuk domain
  setelah 2 cek sehat. Simpan counter di state sampler. (2) Cooldown dihitung per `key`, misalnya
  `SELECT max(last_sent_at) FROM problem_event WHERE key=?`, atau buka kembali baris yang ditutup kurang dari 15 menit
  lalu (`closed_at = NULL`) alih-alih membuat baris baru. Opsi kedua lebih sederhana dan sekaligus menjaga `since`.
  (3) Perjelas apakah cooldown juga menunda "pulih". Usul: pulih tidak ditunda, tetapi histeresis sudah meredamnya.

### C4 — Crash loop dari `restart_time` ikut menghitung restart manual dan deploy

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** §3.1 `app_crash_loop`: "`restarts` naik ≥ 3 dalam 10 mnt", delay alert **0**.
- **Masalah:** Di pm2, `restart_time` juga bertambah pada restart manual. Lihat `lib/God/ActionMethods.js:415`
  (`restartProcessId` → `proc.pm2_env.restart_time += 1`), selain restart otomatis di `lib/God.js:538`. Pemilik yang
  men-deploy tiga kali dalam 10 menit akan menerima "GAWAT · Aplikasi blog terus dimulai ulang". Sumber restart-nya
  bisa tombol Mulai ulang di panel atau langkah deploy PLAN/03 (restart + revert restart). Alert ini berbunyi seketika
  karena delay 0. Kebalikannya juga perlu ditangani: `pm2 reset` atau resurrect setelah HP reboot membuat counter
  **turun**, dan PLAN tidak menyebut apa yang terjadi bila counter turun.
- **Usulan:** Ring restart di `monitor.service` menerima `noteIntentionalRestart(app)`. Fungsi ini dipanggil
  `controlApp` dan job runner PLAN/03. Kenaikan dalam 2 menit setelah panggilan itu diabaikan. Counter yang turun
  me-reset ring. Delay alert minimal 1 tick, agar satu restart tidak langsung memicu pesan. Tambahkan test "3× restart
  manual → tidak ada problem".

### C5 — Restart-loop layanan runit tidak terdeteksi (kasus postgres paling umum di Termux)

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** `service_down` = `wantUp && state !== "run"`. R&D-02 §2.2 sendiri mencatat "Tidak ada indikasi
  restart-loop runit (`run` dengan uptime selalu < 5 dtk)".
- **Masalah:** runsv menyalakan ulang layanan yang keluar dalam ±1 dtk. Postgres yang gagal start, misalnya karena
  `postmaster.pid` basi setelah HP mati mendadak (kegagalan klasik di Termux), hampir selalu terbaca `run: postgres:
  (pid N) 0s` saat disampel. Aturan `service_down` tidak pernah berbunyi, padahal semua situs ber-database mati.
- **Usulan:** Tambah kode `service_crash_loop` (danger, delay 2 mnt). Syaratnya: di 3 tick berturut-turut
  `state === "run"`, `uptimeSec < interval`, dan `pid` berubah. Semua data ini sudah ada di `sv status`, tanpa biaya
  tambahan. Satu baris state per layanan di sampler.

### C6 — "pm2 tersedia" = file `rpc.sock` ada; socket basi membuat `pm2 jlist` memunculkan daemon liar

- **Severity:** MAJOR · **Area:** fitur/flow
- **Klaim di PLAN:** §3.5 `Pm2Adapter.available(): boolean` "(cek `rpc.sock`, tanpa proses)"; `pm2_unavailable` =
  tidak ada `rpc.sock` atau jlist gagal 2 tick.
- **Masalah:** Di POCO, pm2 berjalan sebagai `pm2-runtime` di bawah runit (terukur). Bila proses itu mati tanpa
  membersihkan socket (SIGKILL, OOM, phantom-process killer), `rpc.sock` tetap ada. CLI pm2 lalu gagal ping dan
  **meluncurkan daemon baru** (`lib/Client.js:104` `launchDaemon`, log "Spawning PM2 daemon"). Daemon itu berjalan di
  luar runit dan berebut socket dengan `pm2-runtime` yang di-restart runsv. Komentar `pm2.termux.ts:98` ("Never starts a
  pm2 daemon") hanya benar selama socket tidak basi.
- **Usulan:** Turunkan ketersediaan pm2 dari layanan runit `pm2`, yang sudah dibaca di tick yang sama dengan biaya
  0,01 dtk. Bila `pm2` tidak `run`, jangan panggil `jlist`; problem-nya `pm2_unavailable{reason:"service_down"}`.
  Cek `rpc.sock` tetap dipakai sebagai syarat kedua. Perbaiki komentar di `pm2.termux.ts:98`.

### C7 — Semantik baterai: alert langsung berbunyi di produksi, dan "dicolok tapi terkuras" lolos

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** K6: unplugged → warning (delay 5 mnt); `battery_low` = `percent < 20` **dan**
  `plugged === "unplugged"`.
- **Masalah:**
  1. Saat diukur hari ini, HP produksi **tidak dicolok** (`UNPLUGGED`, `DISCHARGING`, 81%). Begitu fitur ini dirilis,
     warning langsung terkirim. Bila pemilik sengaja melakukan siklus cas (praktik umum pada HP-server agar baterai
     tidak menggembung: cabut di 80%, colok di 30–40%, atau memakai smart plug), setiap siklus menghasilkan satu pesan,
     dan pesan seperti ini cepat diabaikan.
  2. Charger lemah, port USB laptop, atau beban CPU tinggi bisa membuat HP `plugged: PLUGGED_USB` tetapi
     `status: DISCHARGING`, sehingga baterai tetap turun. Aturan PLAN tidak pernah berbunyi di kondisi ini, bahkan di
     5%. Ini mundur dari kode sekarang, yang memakai `!bat.charging` (`overview.problems.ts:84`). `plugged: "unknown"`
     juga tidak pernah berbunyi.
- **Usulan:** `battery_power` (lihat C2): **danger** bila `percent < 20 && !charging`, apa pun nilai plug-nya.
  **Warning** bila `!charging && status !== "NOT_CHARGING"` **dan** (`percent < BATTERY_WARN_PERCENT`, default 50,
  **atau** sudah tidak dicas ≥ 30 mnt). `NOT_CHARGING` tetap netral. Ambang dibuat konstanta bernama. Tanyakan ke
  pemilik apakah cabut-colok itu disengaja (§4).

### C8 — Tidak ada penekanan akar masalah: satu kegagalan menjadi N pesan

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** Domain hanya disaring bila app-nya `stopped` (K3) atau saat `internet_down` (K18).
- **Masalah:** Bila layanan `cloudflared` mati, setiap domain menjawab 530, dan dalam satu digest muncul N+1 baris
  `domain_http_error` ditambah `service_down:cloudflared`. Bila app `errored` atau pm2 mati, domain situsnya menjawab
  502 lalu menjadi masalah kedua untuk satu sebab yang sama. Di HP dengan 3–10 domain, laporan jadi bising, dan "PULIH"
  juga datang N kali.
- **Usulan:** `domainProblem` menerima `cause` dari aturan lain. Domain tidak menjadi problem bila (a) `cloudflared`
  tidak `run` atau sedang crash loop, (b) app tujuannya punya problem `app_*`, atau (c) `pm2_unavailable`. Mekanisme
  `suppressed` dari C2 dipakai ulang. Tabel §5.4 tetap menampilkan penjelasan per domain di UI.

### C9 — Restart panel lewat `sv` detached tidak perlu: cukup keluar dengan rapi

- **Severity:** OVER · **Area:** flow
- **Klaim di PLAN:** K14 / §4.4: `setTimeout(500)` → `runit.restartDetached("panel")`; R5 menyebut risiko `sv` ikut
  mati, mitigasi `setsid`, dan fallback menulis ke `supervise/control`.
- **Masalah:** Run script panel adalah `exec ./panel` (terukur), jadi proses panel adalah anak langsung runsv. Bila
  panel keluar dengan kode apa pun sementara layanannya `want up`, runsv langsung menjalankannya lagi. Proses `sv`
  terlepas, `setsid`, risiko R5, dan test manual khusus semuanya tidak diperlukan.
- **Usulan:** Setelah balasan 202 terkirim, panggil `shutdown("restart")` yang sudah ada di `shutdown.ts` (menghentikan
  server, menunggu idle, menutup DB, lalu `exit(0)`). Lakukan ini hanya bila panel memang di bawah runit, yaitu bila
  `$SVDIR/panel/supervise/pid` berisi `process.pid`. Bila tidak, kembalikan 409 `not_supervised` (mode dev). Hapus
  `restartDetached` dari adapter dan R5 dari daftar risiko. Untuk `cloudflared`, `sv restart` biasa dari panel sudah
  benar karena panel tidak ikut mati.

### C10 — Overlay restart cloudflared bisa menyatakan "tersambung" sebelum tunnel benar-benar dimulai ulang

- **Severity:** MAJOR · **Area:** flow/UI
- **Klaim di PLAN:** §4.4 langkah 5: poll `GET /api/panel/ping` sampai sukses.
- **Masalah:** Ping yang sukses tidak membuktikan restart sudah terjadi. `sv restart` dijalankan 500 ms setelah
  balasan. Setahu saya, cloudflared yang menerima SIGTERM masih melayani koneksi lama selama `--grace-period` (default
  30 dtk). Fakta ini belum saya verifikasi ke docs, jadi implementer perlu mengeceknya. Akibatnya ping pertama pada
  detik ke-2 bisa sukses lewat koneksi lama: overlay tertutup, toast "berhasil" muncul, lalu tunnel putus beberapa detik
  kemudian.
- **Usulan:** Body 202 membawa `oldPid` dari `sv status cloudflared`. Overlay mem-poll `GET /panel/services` dan baru
  selesai bila `cloudflared` berstatus `run` dengan `pid !== oldPid` **dan** request itu sendiri berhasil lewat tunnel.
  Untuk panel, `bootId` sudah benar.

### C11 — Estimasi biaya terlalu rendah, dan cara mengukurnya tidak menghitung proses anak

- **Severity:** MAJOR · **Area:** test
- **Klaim di PLAN:** §5.9: idle ≈ 0,9% satu inti. §6 di HP: "`top`/`ps -o time` proses panel: idle 10 mnt ≤ 1,2%".
- **Masalah:** (1) Terukur hari ini: `pm2 jlist` memakan **0,54–0,66 dtk** user+sys, bukan 0,5. Biaya jlist saja sudah
  ≈ 1,0–1,1% satu inti, ditambah kerja Bun sendiri (probe TLS, SQLite, `sv`, spawn Termux:API). Batas ≤ 1,2% hampir
  pasti terlewati atau berada di tepi. (2) `ps -o time` hanya menghitung CPU proses panel. CPU `pm2 jlist` (proses
  node anak) tidak ikut dihitung, sehingga kriteria ini bisa lolos padahal biaya sebenarnya dua kali lipat. Biaya
  aplikasi Termux:API (JVM) juga tidak terhitung. (3) R&D-02 §6.3 menyarankan baterai dibaca tiap 5 mnt, sedangkan
  PLAN mengubah cache ke 120 dtk tanpa menyebut alasannya selain latensi deteksi.
- **Usulan:** Ukur `utime+stime+cutime+cstime` dari `/proc/<pid panel>/stat` (proses sendiri, bisa dibaca) di awal dan
  akhir 10 menit. Ubah estimasi menjadi ≈ 1,1% (idle) dan ≈ 3% (satu tab). Tetapkan batas penerimaan ≤ 1,5% idle,
  atau jadikan default interval 120 dtk sejak awal (R1 sudah menyiapkan knob-nya). Pertahankan cache baterai 120 dtk,
  tetapi tulis biaya sisi aplikasinya sebagai "tidak terukur".

### C12 — Kontrak dengan PLAN/05 tidak cocok (nama kunci, endpoint, bentuk respons, heartbeat, quiet paths)

- **Severity:** MAJOR · **Area:** kontrak
- **Klaim di PLAN:** §3.6 kunci `alerts.*`; §3.7 `POST /dev/alerts/test` → `AlertTestResult {ok:true, sentAt}` atau
  502; §4.7 `PUT /api/dev/settings/<key>`; K16 menolak daftar path.
- **Masalah:** PLAN/05 menulis hal yang berbeda: kunci `notify.*` (`PLAN/05:160,366,866`); `POST
  /api/dev/notify/telegram/test` harus mengembalikan `{ ok: boolean; code: string; detail: string | null }`
  (`PLAN/05:295`); `PATCH /api/dev/settings` untuk banyak kunci sekaligus (`PLAN/05:291`); label pindah ke
  `src/web/i18n/id.settings.ts` (`PLAN/05` K1); `beat("sampler", intervalSec)` di setiap siklus (`PLAN/05:344`, K21);
  dan `QUIET_PATHS` yang memuat `/api/me`, `/api/dev/logs`, `/api/dev/health` (`PLAN/05:866`). PLAN/02 tidak memasang
  `beat` sama sekali. Bila keduanya dikerjakan apa adanya, UI Pengaturan memanggil endpoint yang tidak ada.
- **Usulan:** Tetapkan satu pilihan sebelum gelombang 0: kunci `alerts.*` (lebih spesifik) **atau** `notify.*`, dan
  satu path test. Rekomendasi saya: `notify.telegram_*` dan `POST /api/dev/notify/telegram/test`, dengan respons 200
  `{ok, code, detail}` agar web cukup memetakan satu bentuk. Panggil `beat("sampler", interval)` di awal tick.
  Simpan aturan K16 (lebih sederhana daripada daftar path) dan beri tahu PLAN/05 bahwa aturan ini sudah mencakup
  `QUIET_PATHS`-nya, serta bahwa filter level `debug` di `/dev/logs` akan kosong di produksi.

### C13 — `log.types.ts` dan parser svlogd dimiliki dua PLAN

- **Severity:** MAJOR · **Area:** kontrak/rencana kerja
- **Klaim di PLAN:** G0 `wkr-mon-types-00` membuat `src/shared/log.types.ts`; G1 membuat `log.parse.ts` (parse prefix
  svlogd + redaksi); endpoint mengembalikan `LogChunk`; `useApiQuery(url, { refreshMs, pauseHidden })`.
- **Masalah:** PLAN/01 §3.4 juga membuat `src/shared/log.types.ts` (gelombang 1a, dengan `LogLine.stream?`) dan
  `src/shared/log.time.ts` `splitLogTimestamp` (svlogd `-tt`, TAI64N, ISO). PLAN/01 juga menyatakan endpoint log
  mengembalikan `LogLine[]`, bukan `LogChunk`. Signature `useApiQuery` di PLAN/01 adalah `(url, refreshMs?, opts?)`
  dengan `opts.enabled`, bukan objek `{refreshMs, pauseHidden}`. Akibatnya ada dua parser timestamp, satu file yang
  ditulis dua worker di gelombang berbeda, dan hook yang dipanggil dengan bentuk yang salah.
- **Usulan:** PLAN/01 tetap memiliki `log.types.ts` dan menambahkan `LogChunk` di sana. PLAN/02 memakai
  `splitLogTimestamp` dan mengganti nama `log.parse.ts` menjadi `log.redact.ts` (hanya redaksi + cursor). Ikuti
  signature `useApiQuery` milik PLAN/01. PLAN/01 harus mengubah kalimat "mengembalikan `LogLine[]`".

### C14 — Kontrak dengan PLAN/03 dan PLAN/04 belum diserap

- **Severity:** MAJOR · **Area:** kontrak
- **Masalah:**
  - PLAN/03 §3.7 meminta worker adapter PLAN/02 menambah `Pm2Proc.cwd/execPath/args/startedAtMs`,
    `NetAdapter.httpStatus(port, path, timeoutMs)`, data fake, dan `snapshot.pm2Procs()`. `wkr-mon-adapters-01` tidak
    memuat satu pun dari ini.
  - `jobs.isLocked(resource: { kind: "service" | "app"; name: string })` (PLAN/03:1277) berbentuk objek, sedangkan
    PLAN/02 §3.7 menulis `jobs.isLocked(resource)` tanpa bentuk.
  - PLAN/03 menyatakan `site_crash_loop` **tidak dipakai**, sementara PLAN/02 mencadangkannya.
  - PLAN/03 menetapkan `SHUTDOWN_TIMEOUT_MS = 120_000`, sedangkan PLAN/02 §3.7 menulis "shutdown hanya menunggu
    20 dtk". Batas overlay 90 dtk juga lebih pendek daripada 120 dtk.
  - PLAN/04:475 memakai kode `backup_item_stale`, `key_mismatch`, `access_not_seen`, yang tidak ada di `ProblemCode`.
- **Usulan:** Tambahkan permintaan PLAN/03 ke `wkr-mon-adapters-01` (sekitar 60 baris). Pakai signature objek. Hapus
  `site_crash_loop`. Samakan teks shutdown dan naikkan batas overlay menjadi 130 dtk (sesuai `sv -w 130` di PLAN/03).
  Sepakati dengan PLAN/04: `backup_status_error` diganti `backup_key_mismatch`, atau semua kode PLAN/04 dimasukkan ke
  union beserta aturannya, lengkap dengan kolom tabel §3.1.

### C15 — Di gelombang 2, `wkr-mon-api-02` bergantung pada API snapshot yang ditulis worker lain di gelombang yang sama

- **Severity:** MAJOR · **Area:** rencana kerja
- **Klaim di PLAN:** G2 paralel: `wkr-mon-sampler-02` membuat `monitor.snapshot.ts`/`monitor.service.ts`;
  `wkr-mon-api-02` mengubah `panel.service.ts` agar "Baca dari snapshot".
- **Masalah:** File-nya memang tidak bertabrakan, tetapi interface-nya ditulis bersamaan. `wkr-mon-api-02` harus
  menebak bentuk `get()/invalidate()/state`, padahal `computeProblems(input, state)` juga butuh bentuk state sampler
  (G1 rules). Kemungkinan besar hasilnya tidak bisa dikompilasi saat digabung.
- **Usulan:** Masukkan tipe `MonitorSnapshot`, `SnapshotSection`, `MonitorState`, dan signature `monitorFor()` ke G0
  (`monitor.types.ts`, internal server, atau `src/server/monitor/monitor.contract.ts`). Atau jalankan sampler sebagai
  G2a dan API sebagai G2b.

### C16 — Kesegaran data dan invalidasi cache tidak jelas

- **Severity:** MINOR · **Area:** UI/flow
- **Klaim di PLAN:** K8 SWR ≤ 120 dtk; §5.1 meta "Diperbarui 12 dtk lalu (`generatedAt`)"; "Aksi kontrol
  meng-invalidate bagian terkait".
- **Masalah:** `generatedAt` adalah waktu respons dibuat, bukan umur data. Dengan SWR, data pm2 bisa berumur 100 dtk
  sementara meta menulis "12 dtk lalu". Bila `invalidate` hanya menandai data basi, request pertama setelah klik
  "Mulai" masih menjawab nilai lama, dan baris tetap tertulis "Dihentikan" setelah toast "dimulai".
- **Usulan:** Setiap bagian snapshot membawa `at`. Meta menampilkan umur bagian yang paling tua (atau `sampledAt`).
  `invalidate` menulis item yang dikembalikan aksi ke cache (patch), atau menghapus nilainya sehingga request berikutnya
  menunggu. Pilih salah satu dan tulis di §3.5.

### C17 — Detail Telegram: fakta terverifikasi dan celah penanganan error

- **Severity:** MINOR · **Area:** fitur
- **Terverifikasi (core.telegram.org, 2026-11-26):** `text` "1-4096 characters after entities parsing"; HTML: `<`, `>`,
  `&` wajib di-escape, dan entitas bernama yang didukung hanya `&lt; &gt; &amp; &quot;`; `ResponseParameters` memuat
  `retry_after` dan `migrate_to_chat_id` ("at most 52 significant bits"); `link_preview_options` dan
  `disable_notification` ada di `sendMessage`; `getUpdates` tidak bekerja bila webhook terpasang, dan update disimpan
  **maksimal 24 jam**; `error_code` "subject to change". FAQ: di satu chat, hindari lebih dari 1 pesan/detik; di grup,
  maksimal 20 pesan/menit. Jadi asumsi §3.8 benar, dan batas 3.500 karakter aman.
- **Celah:** (a) HTTP 409 (webhook aktif, atau ada poller `getUpdates` lain) tidak ada di pemetaan §3.8, padahal
  endpoint chats memakai `telegram_webhook_set`. (b) Grup yang di-upgrade ke supergroup menghasilkan 400 dengan
  `migrate_to_chat_id`. PLAN menganggapnya `telegram_bad_request` dan berhenti. Lebih baik petakan ke
  `telegram_chat_migrated` dan tampilkan ID barunya, atau simpan ID baru dengan audit. (c) "Cari chat": karena update
  hanya disimpan 24 jam, teks kosong sebaiknya "Kirim pesan **baru** ke bot". Ambil chat dari `message`,
  `channel_post`, dan `my_chat_member` (bot yang ditambahkan ke grup dengan privacy mode tidak menerima `message`
  biasa). Panggil tanpa `offset` agar update tidak dikonfirmasi. (d) 403 "berhenti mencoba sampai setting berubah":
  bila pemilik membuka blokir bot tanpa mengubah setting, pengiriman tidak pernah pulih. Coba ulang tiap 1 jam, dan
  jadikan uji kirim yang sukses sebagai reset state `failing`.

### C18 — `problem_event` ditulis setiap tick, dan durasi setelah panel mati menjadi salah

- **Severity:** MINOR · **Area:** data
- **Klaim di PLAN:** §4.6 langkah 2: "ada → update severity (maks) dan params" di setiap tick; `closed_at = now`.
- **Masalah:** Setiap problem terbuka menulis satu halaman per menit walaupun tidak ada perubahan. Bila panel atau HP
  mati 3 jam, problem yang sebenarnya sudah pulih sejak jam pertama ditutup di tick pertama setelah boot, sehingga
  "putus 3 jam" yang dilaporkan terlalu besar.
- **Usulan:** UPDATE hanya bila severity atau params berubah. Tambahkan kolom `last_seen_at` (diperbarui paling sering
  sekali per 10 mnt, atau saat berubah). Bila ada jeda > 2× interval sejak `last_seen_at`, pesan pulih menulis "pulih
  saat panel tidak berjalan" alih-alih durasi.

### C19 — HP reboot dan panel mati tak terduga tidak pernah dilaporkan

- **Severity:** MAJOR · **Area:** fitur
- **Klaim di PLAN:** K15: "Panel sendiri mati tidak bisa memberi tahu", jadi disarankan monitor luar.
- **Masalah:** Benar, saat mati panel tidak bisa memberi tahu. Tetapi saat **hidup lagi**, panel bisa. Di HP-server,
  kejadian terpenting adalah reboot (baterai habis, update OS, panas) dan kill oleh Android (phantom process killer,
  LMK). Tanpa laporan ini, satu-satunya jejak reboot adalah deretan "PULIH" (yang menurut C18 durasinya salah).
  Ini fitur standar di Coolify, Netdata, dan Uptime Kuma (notifikasi "server restarted").
- **Usulan:** Saat boot, kirim problem sekali-jalan (kode `host_rebooted` bila `os.uptime() < 15 mnt`, atau
  `panel_restarted_unexpectedly` bila marker shutdown rapi tidak ada). Marker cukup berupa satu baris file
  `data/clean-shutdown` yang ditulis `shutdown.ts` dan dihapus saat boot. Biayanya kecil (sekitar 30 baris) dan
  dikirim lewat digest pertama.

### C20 — Retensi `check_result` 7 hari tidak dipakai, dan estimasi tulis flash kurang dari setengah

- **Severity:** OVER · **Area:** data
- **Klaim di PLAN:** §3.4: `check_result` disimpan 7 hari (sekitar 3 MB, 10 MB untuk D=10); ±25 KB WAL/menit ≈
  35 MB/hari.
- **Masalah:** Semua pembaca `check_result` hanya melihat 35 menit terakhir (strip 30 batang dan seed 3 cek terakhir).
  Tidak ada fitur "uptime 7 hari". Dalam WAL, setiap halaman ditulis dua kali (ke WAL, lalu ke DB saat checkpoint),
  ditambah tulis per tick dari C18. Total sebenarnya sekitar 70–100 MB/hari. Angka ini tetap kecil, tetapi README
  sebaiknya memuat angka yang benar. Tabel ini juga tidak memakai `WITHOUT ROWID`, sehingga PK komposit menambah satu
  B-tree indeks.
- **Usulan:** Retensi `check_result` cukup 24 jam (atau 1 jam), atau simpan hanya saat status berubah. Kalau tetap
  disimpan, pakai `WITHOUT ROWID` dan hapus `check_result_at_idx` (prune per host memakai PK). Perbaiki angka flash di
  README.

### C21 — `alerts.min_severity` disaring di input mesin, sehingga penurunan severity menjadi "PULIH"

- **Severity:** MINOR · **Area:** flow
- **Klaim di PLAN:** §4.6 langkah 1: masukan = problem dengan `severity ≥ alerts.min_severity`.
- **Masalah:** Dengan `min_severity=danger`, `battery_hot` yang turun dari 51 °C ke 47 °C dibuang dari input, lalu event
  ditutup dan "PULIH · Baterai panas" terkirim, padahal suhunya masih 47 °C. Selain itu, mengubah setting ini dari
  `warning` ke `danger` menutup semua event warning.
- **Usulan:** Lacak semua problem yang punya delay. `min_severity` hanya dipakai saat memilih item kirim, dan "pulih"
  dikirim bila event tertutup pernah diberitahukan.

### C22 — Regex redaksi log terlalu sempit untuk log JSON

- **Severity:** MINOR · **Area:** fitur/keamanan
- **Klaim di PLAN:** §5.8 pola `\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD…)[A-Z0-9_]*)\s*[=:]\s*\S+`.
- **Masalah:** Pola ini peka huruf besar-kecil dan tidak menangani tanda kutip. Log JSON yang umum dari aplikasi Node
  (`{"password":"x"}`, `"apiKey": "..."`, `token=abc` huruf kecil) lolos tanpa disamarkan. PLAN sudah jujur bahwa
  redaksi tidak sempurna, tetapi celah ini adalah format log yang paling sering muncul.
- **Usulan:** Pakai flag `i` dan izinkan kutip opsional: `(["']?)([a-z0-9_]*(?:token|secret|password|passwd|api_?key|private_?key|access_?key)[a-z0-9_]*)\1\s*[=:]\s*(["']?)[^"'\s,}]+\3`.
  Tambahkan kasus JSON ke `log.parse.test.ts`.

### C23 — K16 menghapus semua jejak GET sukses dari log stdout

- **Severity:** MINOR · **Area:** fitur
- **Klaim di PLAN:** K16 GET/HEAD < 400 → `debug`; ring juga tidak menyimpan `debug` di produksi
  (`log.service.ts:12` hari ini masih menyimpan debug ke ring sebelum filter level, jadi ini memang perubahan perilaku).
- **Masalah:** Aturannya baik untuk flash dan ring. Konsekuensinya, unduhan sensitif yang memakai GET (cadangan, log)
  hanya tercatat di audit. Respons 401/404 dari pemindai internet ke `/api/*` tetap berlevel `info` dan masih bisa
  membanjiri ring.
- **Usulan:** Pastikan semua GET sensitif diaudit, dan tulis daftarnya di PLAN. Opsional: 401/404 tanpa sesi →
  `debug`, karena sudah dihitung oleh `requestStats`.

### C24 — UX layanan inti: teks akibat sshd dan interaksi dengan PLAN/05

- **Severity:** MINOR · **Area:** UI
- **Masalah:** (a) Teks "Sesi SSH yang terbuka terputus" untuk menghentikan `sshd` kemungkinan salah. runsv hanya
  mengirim TERM ke PID master. Sesi yang sudah terbuka adalah proses anak sshd yang tetap hidup, dan yang hilang
  hanyalah kemampuan untuk login baru. Ini perlu diverifikasi sekali di HP uji, bukan di POCO. (b) PLAN/05:503
  mengizinkan centang `panel`/`cloudflared` dilepas dari `protected_services` dengan peringatan inline, sementara
  `lockout` PLAN/02 tetap menolak stop. UI PLAN/05 perlu mengatakan bahwa keduanya tetap tidak bisa dihentikan, agar
  setting tidak tampak berefek padahal tidak.
- **Usulan:** Ubah teksnya menjadi "Kamu tidak bisa masuk lewat SSH sampai sshd dijalankan lagi (sesi yang sudah
  terbuka biasanya tetap jalan)." Tambahkan catatan lockout ke PLAN/05 §Keamanan.

---

## 3. Hal yang sudah baik (pertahankan)

- Satu sumber aturan di server, plus `code` + `params` dan teks bersama untuk UI dan Telegram (K1, K2). Ini
  menghilangkan "2 perlu dicek" yang berbeda dengan isi daftar.
- Kejujuran data di Android: tidak ada CPU%, suhu `null` bukan 0, load hanya untuk tampilan dengan baseline per HP (K4,
  K5). Tidak ada ambang per-core yang akan selalu merah.
- Satu sampler single-flight dengan rantai `setTimeout`, cache SWR, dan probe yang tidak pernah memblok request UI.
  Ini sesuai dengan pengukuran jlist.
- Rekonsiliasi status di tabel yang bertahan restart, digest satu pesan per tick, dan tanpa antrean pesan. Desain ini
  benar. Yang perlu diperbaiki hanya aturan buka/tutupnya (C1–C3).
- Deteksi `internet_down` dengan probe konektivitas (gstatic terukur 0,32 dtk dari HP), sehingga tidak muncul N domain
  merah.
- `lockout` untuk panel/cloudflared, konfirmasi ketik nama di server (`confirm` di body), dan 409 `job_running`.
- Cursor log `<ino>:<offset>` dengan `reset`/`truncated`, dan redaksi di server untuk tail, follow, dan unduh.
- Redaksi token di semua error klien Telegram, ditambah test wajib.
- Pengakuan jujur bahwa panel tidak bisa melaporkan dirinya mati, dan tanpa jam tenang (masalah TZ di runit).

## 4. Pertanyaan yang hanya bisa dijawab pemilik

1. Saat diperiksa hari ini (2026-11-26), HP produksi **tidak dicolok** (81%, `DISCHARGING`). Apakah pemilik sengaja
   melakukan siklus cas (cabut di ±80%, colok di ±30%)? Jawabannya menentukan C7: bila ya, "tidak dicas" baru menjadi
   warning di bawah 50% atau setelah 30 menit. Bila tidak, aturan PLAN cukup dengan tambahan "dicolok tapi terkuras".
2. Apakah HP reboot dan panel mati tak terduga (C19) perlu dikirim ke Telegram sebagai pesan berbunyi (danger) atau
   senyap (warning)?
