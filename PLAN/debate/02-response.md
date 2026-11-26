# Tanggapan penulis PLAN/02 atas kritik `02-critique.md`

Penulis: wkr-plan-monitor-01 · 2026-11-26. Dibaca: `PLAN/debate/02-critique.md` (utuh), `PLAN/debate/00-integration-critique.md`
(kontrak K01–K42, X3, X6–X10, X14, X17–X23, X27, X29, X30, §4 ruang lingkup v0.3.0, §5 jadwal), PLAN/03 §3.7 + tabel
dependensi, PLAN/04 §3.7, PLAN/05 K3/K21 + §3.3. Revisi ada di `PLAN/02-monitoring.md` (lihat "Riwayat revisi" di akhir file).

Ringkasan verdict: **TERIMA 20 · TERIMA SEBAGIAN 4 · TOLAK 0.**

---

## Tanggapan per temuan

### C1 — Bagian gagal menutup event → "PULIH" palsu · **TERIMA**

Bukti: `device.termux.ts:44-55` mengubah kegagalan `termux-battery-status` menjadi `null`, dan `panel.service.ts:75-79`
mengubah kegagalan bagian menjadi `[]`. Dengan langkah §4.6.3 lama, keduanya menutup event yang masih terjadi.
Perubahan:

- `computeProblems` sekarang mengembalikan `{ problems, suppressed, unknownKinds }` (§3.1 dan §3.5 PLAN).
- `unknownKinds` diturunkan dari `unavailable` lewat peta bagian → kind (`device` → `disk`, `battery`; `services` →
  `service`; `apps` → `app`; `domains` → `domain`, `network`; `backup` → `backup`; `security` → `security`), ditambah
  `battery` bila baterai `null`.
- §4.6 langkah 2: event dari kind yang tidak terbaca tidak diubah sama sekali. Tidak ditutup, counter absennya di-reset.
- Test baru di `alert.engine.test.ts`: "pm2 gagal 1 tick → tidak ada pulih, tidak ada event baru" dan "baterai null 1
  tick → `battery_power` tetap terbuka".

### C2 — Penggantian problem → "PULIH" palsu · **TERIMA**

Perubahan:

- (a) `battery_unplugged` dan `battery_low` digabung menjadi satu kode `battery_power`. Severity-nya naik dari warning
  ke danger, dan eskalasi sudah ditangani mesin alert.
- (b) Kolom baru **"Menahan"** di tabel §3.1. Kode penahan: `pm2_unavailable`, `internet_down`,
  `service_down:cloudflared`, `service_crash_loop:cloudflared`, `app_errored`/`app_crash_loop`, dan `key_mismatch`.
  Problem yang ditahan masuk `suppressed`: tidak tampil di daftar utama, eventnya tidak ditutup, tidak dikirim, dan baru
  dievaluasi lagi setelah penahannya selesai.
- UI tetap menampilkan penjelasan per domain di halaman Domain (§5.4).

### C3 — Cooldown per baris, flapping tidak teredam · **TERIMA**

Perubahan di §4.6:

1. **Histeresis penutupan.** Event ditutup hanya bila problem absen **2 tick berturut-turut** (counter di memori
   sampler). Untuk domain, aturan ini otomatis berarti 2 cek sehat, karena problem domain hilang begitu `failures` di-reset
   oleh cek sehat.
2. **Buka-kembali, bukan baris baru.** Problem yang muncul lagi dengan `key` yang ditutup < 15 mnt lalu membuka baris yang
   sama (`closed_at = NULL`). Dengan begitu `opened_at`, `since`, `last_sent_at`, dan `notified_state` tetap, dan cooldown
   berlaku antar-kejadian.
3. **Pulih tidak ditunda cooldown.** Histeresis sudah meredamnya. Buka-kembali dalam cooldown menunggu sampai
   `last_sent_at + 15 mnt`.
4. Plafon flapping per kunci: ±4 pesan/jam, dibuktikan oleh test "pola gagal-gagal-gagal-sehat 4 mnt selama 1 jam →
   ≤ 4 pesan".

### C4 — Crash loop ikut menghitung restart manual dan deploy · **TERIMA**

Bukti dari kritik (`Unitech/pm2 lib/God/ActionMethods.js:415`) masuk akal dan sejalan dengan perilaku `restart_time` yang
kami lihat. Perubahan:

- `monitor.noteIntentionalRestart({ kind: "app" | "service", name })` dipanggil oleh `controlApp`/`controlService` dan
  oleh job runner PLAN/03 (kontrak baru di §8). Kenaikan `restarts` dalam 2 mnt setelah panggilan itu diabaikan.
- Counter yang turun (`pm2 reset`, resurrect) me-reset ring.
- Delay alert `app_crash_loop` jadi 1 tick.
- Test baru: "3× restart manual dalam 10 mnt → tidak ada problem" dan "counter turun → ring kosong".

### C5 — Restart-loop layanan runit tidak terdeteksi · **TERIMA**

Kode baru `service_crash_loop` (danger). Syaratnya: di 3 tick berturut-turut `state === "run"`, `uptimeSec < interval`,
dan `pid` berbeda dari tick sebelumnya. Restart yang dicatat `noteIntentionalRestart` tidak dihitung. Delay alert saya
set **0**, bukan 2 mnt seperti usulan kritik, karena syarat 3 tick sudah memberi ±3 mnt debounce. Biayanya nol: data
sudah ada di `sv status`.

### C6 — `rpc.sock` basi membuat `pm2 jlist` meluncurkan daemon liar · **TERIMA**

Perbaikannya di akar, yaitu di adapter, supaya semua pemanggil (snapshot, kontrol, job PLAN/03) terlindungi:

- `createTermuxPm2` menerima `isSupervisorUp(): Promise<boolean | null>`, yang menjalankan `sv status pm2` (0,01 dtk).
  Bila layanan runit `pm2` ada dan tidak `run`, `procs()` melempar `Pm2UnavailableError("service_down")` **tanpa**
  memanggil CLI pm2.
- Bila layanan `pm2` tidak ada di runit (null), hanya cek `rpc.sock` yang dipakai.
- `pm2_unavailable.params.reason` ∈ `service_down | no_daemon | jlist_failed`.
- Komentar `pm2.termux.ts:98` diperbaiki ("never starts a daemon while the pm2 service is down").

### C7 — Semantik baterai · **TERIMA SEBAGIAN** (aturan diterima; ambang dibuat setting karena pertanyaan ke owner masih terbuka)

Diterima:

- `battery_power` **danger** bila `percent < 20 && !charging`, apa pun nilai plug-nya. Kasus "dicolok USB tapi terkuras"
  sekarang tertangkap (memulihkan perilaku `overview.problems.ts:84`).
- `NOT_CHARGING` tetap netral.
- `Battery.status` mentah ditambahkan, dan `charging` diturunkan darinya.

Sebagian: warning memakai dua setting baru, bukan konstanta:

| Setting                               | Default | Arti                                                                    |
| ------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `monitor.battery_warn_percent`        | `50`    | Warning bila tidak dicas dan baterai di bawah ini (`off` = mati)        |
| `monitor.battery_unplugged_grace_min` | `30`    | Warning bila sudah tidak dicas selama ini, berapa pun persennya (`off`) |

Owner yang sengaja melakukan siklus cas cukup mengatur `off` + `25` tanpa rilis baru. Pertanyaan ke owner dicatat di §8
PLAN. Fakta di lapangan: POCO sekarang `UNPLUGGED` 81%. Dengan default ini, warning senyap pertama keluar 30 mnt setelah
rilis. Ini disebut eksplisit di catatan rilis.

### C8 — Tanpa penekanan akar masalah · **TERIMA**

Mekanismenya memakai ulang `suppressed` dari C2. Domain tidak dijadikan problem bila salah satu berlaku:

- `cloudflared` tidak `run` atau sedang crash loop;
- app tujuannya punya problem `app_*`;
- terjadi `pm2_unavailable`;
- terjadi `internet_down`;
- app tujuannya `stopped`.

Tabel §3.1 kolom "Menahan" mencantumkan semuanya. Test: "cloudflared mati + 3 domain 530 → 1 problem".

### C9 — Restart panel lewat `sv` detached tidak perlu · **TERIMA** (OVER)

Run script panel `exec ./panel` (terukur oleh kritik) menjadikan panel anak langsung runsv, sehingga `exit` sudah cukup.
Perubahan:

- 202 lalu `shutdown("restart")`, yang sudah ada di `shutdown.ts` (server stop → idle → close DB → `exit(0)`), dan menulis
  marker shutdown rapi (C19).
- Syaratnya: `$SVDIR/panel/supervise/pid` berisi `process.pid`. Bila tidak, server menjawab 409 `not_supervised`
  (mode dev).
- `RunitAdapter.restartDetached` dihapus. Risiko R5 lama dihapus.

### C10 — Overlay cloudflared bisa tertutup sebelum restart terjadi · **TERIMA**

`DeferredRestart` membawa `oldPid`. Overlay cloudflared mem-poll `GET /api/panel/services` dan baru selesai bila
`cloudflared` berstatus `run` dengan `pid !== oldPid` **dan** request itu sendiri berhasil (berarti tunnel baru melayani).
Klaim `--grace-period` 30 dtk belum diverifikasi, jadi ditandai sebagai asumsi. Desain baru benar dengan atau tanpa grace
period.

### C11 — Estimasi biaya terlalu rendah, pengukuran tidak menghitung proses anak · **TERIMA**

Perubahan:

- Estimasi diperbarui memakai 0,54–0,66 dtk per jlist (ukuran kritik): idle ≈ **1,1%**, satu tab ≈ **3%**.
- Kriteria penerimaan sekarang mengukur `utime+stime+cutime+cstime` dari `/proc/<pid panel>/stat` di awal dan akhir
  10 mnt. `cutime` mencakup `pm2 jlist`, yang memang di-`wait`.
- Batas: idle ≤ 1,5%, satu tab ≤ 3,5%. Bila terlewati, default interval naik ke 120 dtk (knob sudah ada) sebelum desain
  diubah.
- Cache baterai tetap 120 dtk. Alasannya: deteksi tidak dicas ≤ ±3 mnt. Biaya JVM Termux:API ditulis "tidak terukur dari
  panel".

### C12 — Kontrak dengan PLAN/05 tidak cocok · **TERIMA SEBAGIAN**

Saya mengikuti arbitrase kritik integrasi X3/X14/X30 dan tidak mengikuti usulan C12 soal nama dan bentuk:

- **Kunci tetap `alerts.*`**, sesuai X3 (mesinnya milik 02).
- **Path tetap `POST /api/dev/alerts/test`** dan `POST /api/dev/alerts/telegram/chats`, dengan error `{error, message}` +
  status (502 untuk kegagalan Telegram), sesuai X14 dan pola API yang ada.
- **Diterima dari C12:** `PATCH /api/dev/settings` batch (05 K3), label di `id.settings.ts` (05 K1). §4.7 dan §3.6 PLAN
  diperbarui.
- **`beat()` ditolak untuk v0.3.0** mengikuti X30: duplikat `sampledAt`. Sebagai gantinya saya sediakan
  `monitor.status(): { sampledAt, intervalSec, lastTickMs, running }` untuk `/dev/health`. Bila koordinator tetap memilih
  `heartbeat.ts`, sampler memanggil `beat("sampler", intervalSec)` di awal tick (1 baris, nama dikunci).
- K16 sudah mencakup `QUIET_PATHS` PLAN/05. Konsekuensinya dicatat: filter level `debug` di `/dev/logs` kosong di
  produksi.

### C13 — `log.types.ts` dan parser svlogd dimiliki dua PLAN · **TERIMA**

Mengikuti X9:

- `src/shared/log.types.ts` ditulis worker kontrak W0, berisi `LogLine {at, text, stream?, level?}` + `LogChunk`.
- Parser waktu tunggal: `splitLogTimestamp` di `src/shared/log.time.ts` (01).
- `log.parse.ts` diganti nama menjadi `src/server/system/log.redact.ts` (redaksi + baca cursor saja).
- `useApiQuery(url, refreshMs?, { enabled })` dan `useLogFollow(url, { enabled })` milik 01 di `src/web/shared/`.
- Props `LogViewer` versi 01. `newCount` dihitung komponen.
- §3.9 PLAN ditulis ulang menjadi "kontrak yang dipakai (signature 01)".

### C14 — Kontrak PLAN/03 dan PLAN/04 belum diserap · **TERIMA**

Perubahan:

- **Adapter PLAN/03 §3.7** masuk ke daftar adapter (dikerjakan `wkr-adapters-01`, X21):
  - `Pm2Proc` ditambah `cwd`, `execPath`, `args`, `startedAtMs`, `module`;
  - `NetAdapter.httpStatus(port, path = "/", timeoutMs?)`;
  - data fake (app glibc `grun`, app tanpa binary, modul);
  - snapshot mengekspos `pm2Procs()` (stale ≤ 15 dtk).
- `jobs.isLocked({ kind, name })` sekarang ditulis dengan bentuk objek.
- `site_crash_loop` dihapus. `site_job_failed {jobId, kind, status}` dengan href `/panel/jobs/:id` sesuai PLAN/03.
- Shutdown 120 dtk (03 D11). Overlay panel 130 dtk.
- Restart `panel` ditolak bila `jobs.active() || backup.running || backup.restoring` (X23; `restoring` hanya bila 04
  memasukkannya di v0.3.0).
- **Kode PLAN/04** `backup_item_stale`, `key_mismatch`, `access_not_seen` + kind `security` masuk union dan tabel aturan
  di `overview.problems.ts` (X10). Rinciannya ada di "Usulan kontrak" di bawah.

### C15 — `wkr-mon-api-02` bergantung pada API yang ditulis paralel · **TERIMA**

Tipe server-internal `MonitorSnapshot`, `SnapshotSection<T>`, `MonitorState`, `ProblemResult`, dan signature
`monitorFor()` dipindah ke `src/server/monitor/monitor.contract.ts`, ditulis `wkr-contracts-00` di W0. Jadwalnya
mengikuti §5 integrasi: `wkr-mon-rules-01` (W1), `wkr-mon-core-02` (W2), `wkr-mon-api-03` + `wkr-boot-03` +
`wkr-mon-web-03` (W3). API dikerjakan setelah core, tidak paralel dengannya.

### C16 — Kesegaran data dan invalidasi cache tidak jelas · **TERIMA**

Perubahan:

- Setiap `SnapshotSection` membawa `at`. `PanelOverview.dataAt` = `at` tertua dari bagian yang tampil. Meta halaman
  memakai `dataAt`, bukan `generatedAt`.
- Pilihan invalidasi: **patch**. Item yang dikembalikan aksi kontrol ditulis ke cache bagian itu, lalu bagian ditandai
  basi untuk refresh latar. Respons berikutnya langsung menampilkan status baru.
- Copy memakai "Diperbarui baru saja", karena 01 D16 menetapkan detik tidak pernah ditampilkan (X19).

### C17 — Detail Telegram · **TERIMA**

Fakta yang diverifikasi kritik dicatat di §3.8 PLAN; asumsi lama sudah terkonfirmasi. Celah yang ditutup:

- (a) HTTP 409 → kode baru `telegram_conflict` (webhook aktif atau ada poller lain). Endpoint chats memakai kode itu.
  `telegram_webhook_set` dihapus.
- (b) 400 dengan `parameters.migrate_to_chat_id` → `telegram_chat_migrated`. Panel menyimpan ID baru ke
  `alerts.telegram_chat_id` dengan audit `settings.update` beraktor Sistem dan `meta.reason: "chat_migrated"`, lalu
  langsung mencoba ulang sekali.
- (c) "Cari chat" tanpa `offset`, mengambil chat dari `message`, `channel_post`, dan `my_chat_member`. Teks kosongnya
  "Kirim pesan baru ke bot (Telegram hanya menyimpan pesan 24 jam), lalu cari lagi."
- (d) 401/403/chat-not-found dicoba ulang tiap 1 jam. Uji kirim yang sukses me-reset state `failing`.

### C18 — `problem_event` ditulis tiap tick; durasi setelah panel mati salah · **TERIMA**

Perubahan:

- UPDATE hanya bila severity atau params berubah, atau `last_seen_at` sudah > 10 mnt (kolom baru `last_seen_at`).
- Saat menutup: bila `closed_at − last_seen_at > 15 mnt`, pesan pulih berbunyi "pulih saat panel tidak berjalan
  (terakhir terlihat 3 jam lalu)", bukan durasi palsu.

### C19 — HP reboot dan panel mati tak terduga tidak dilaporkan · **TERIMA**

Dua kode notice sekali-kirim (kind `host`):

- `host_rebooted`: saat boot, `os.uptime() < 15 mnt`.
- `panel_restarted_unexpectedly`: saat boot, marker `data/clean-shutdown` tidak ada dan bukan `host_rebooted`.

Detail:

- Marker ditulis `shutdown.ts` sebelum `exit` dan dihapus saat boot. `shutdown.ts` milik `wkr-sites-runner-01` (03) di
  W1, jadi penambahan 3 baris ini dititipkan ke spec worker itu. Di `boot.ts` (W3) hanya ada pembacaan marker.
- Notice disimpan sebagai baris `problem_event` yang langsung tertutup dengan `notified_state = NULL`. Mesin mengirimnya
  sekali (umur < 24 jam), sehingga tetap terkirim walau internet baru tersedia beberapa menit setelah boot.
- Severity default warning (senyap). Pertanyaan ke owner (bunyi atau senyap) dicatat di §8.

### C20 — Retensi `check_result` 7 hari tidak dipakai; angka flash salah · **TERIMA** (OVER, digabung dengan X7/§4 integrasi)

Untuk v0.3.0 `metric_sample` dan `check_result` **ditunda seluruhnya**, begitu pula `/metrics`, `loadBaseline`,
sparkline, dan strip heartbeat. Migration `0008_monitor` hanya berisi `problem_event`. Counter gagal domain ada di memori,
jadi setelah restart panel perlu 3 cek lagi (±3 mnt). Load tampil netral tanpa baseline (R2 §6.1 opsi D). Tulis flash
sekarang ≤ beberapa halaman per perubahan problem, dapat diabaikan. Catatan untuk 0.3.x di §8: `check_result` 24 jam
`WITHOUT ROWID` tanpa indeks `at`, dan estimasi flash dikoreksi ke 70–100 MB/hari bila tabel metrik kembali.

### C21 — `min_severity` disaring di input mesin · **TERIMA**

Mesin melacak semua problem yang bisa di-alert. `min_severity` hanya dipakai saat memilih item "buka". "Pulih" dikirim
bila event pernah diberitahukan. Mengubah setting tidak menutup event apa pun. Test: "51→47 °C dengan min=danger → tidak
ada pesan".

### C22 — Regex redaksi terlalu sempit untuk log JSON · **TERIMA**

Pola baru diuji lokal dengan `bun` (scratchpad):

```
/(["']?)([a-z0-9_]*(?:token|secret|password|passwd|api_?key|private_?key|access_?key)[a-z0-9_]*)\1(\s*[=:]\s*)(["']?)[^"'\s,}]+\4/gi
→ "$1$2$1$3$4***$4"
```

Hasil uji:

| Input                          | Output                          |
| ------------------------------ | ------------------------------- |
| `{"password":"x1","user":"a"}` | `{"password":"***","user":"a"}` |
| `"apiKey": "abc-123"`          | `"apiKey": "***"`               |
| `token=abc def`                | `token=*** def`                 |
| `DB_PASSWORD=hunter2`          | `DB_PASSWORD=***`               |
| `tokenizer ready`              | tidak berubah                   |
| `API_KEY: zz,next`             | `API_KEY: ***,next`             |

Kasus-kasus ini masuk `log.redact.test.ts`.

### C23 — K16 menghapus jejak GET sukses · **TERIMA SEBAGIAN**

Diterima:

- 401, serta 404 tanpa sesi, dicatat `debug` (tetap dihitung `requestStats`).
- Daftar GET sensitif yang diaudit ditulis di PLAN §3.7. Isinya: unduh item cadangan (04, `backup.download`). Unduh kunci
  data memakai POST (04).

Tidak ditambah: audit untuk _melihat_ log layanan/aplikasi. Admin dipercaya penuh (keputusan owner 1). Unduh log server
juga ditunda ke 0.3.x (integrasi §4): unduh dilakukan sebagai Blob di klien dari baris yang sudah tampil, jadi tidak ada
akses data baru yang perlu diaudit. Aksi audit `log.download` ditarik dari union v0.3.0.

### C24 — Teks sshd dan interaksi lockout dengan PLAN/05 · **TERIMA**

Perubahan:

- Teks sshd: "Kamu tidak bisa masuk lewat SSH sampai sshd dijalankan lagi (sesi yang sudah terbuka biasanya tetap
  jalan)." Perilakunya diverifikasi sekali di HP uji, bukan di POCO.
- Catatan untuk PLAN/05 §Keamanan: melepas centang `panel`/`cloudflared` dari `panel.protected_services` tidak membuat
  keduanya bisa dihentikan (`lockout`). UI Pengaturan harus mengatakannya.

---

## Temuan dari kritik integrasi yang ikut diserap (bukan C-n, dicatat agar terlacak)

| Ref     | Perubahan di PLAN/02                                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X8/K10  | Tabel kosakata §5.6 dihapus. Label dan tone memakai `status.vocab` milik 01. `domainVerdict` mengembalikan `{ key: StatusKey, reason }` dengan kunci `auth_required`, `unstable`, `tunnel_down`, `stopped`, `unchecked`, yang diminta ke 01 W1. Service down + `wantUp` → kunci 01 `down` ("Mati", danger); `!wantUp` → `stopped`. |
| K07/K08 | Prop `DataTable` memakai nama 01 `actions`. `columns[].hidden` dihapus (cukup filter array). `ConfirmAction` `tier: "confirm" \| "typed"`; "tanpa konfirmasi" = tanpa dialog.                                                                                                                                                      |
| X17     | Tidak ada edit `id.ts` di gelombang halaman.                                                                                                                                                                                                                                                                                       |
| X18     | `onConfirm` resolve pada 202. Overlay adalah komponen 02 (`restart.overlay.tsx`).                                                                                                                                                                                                                                                  |
| X19     | "Diperbarui baru saja", tanpa detik.                                                                                                                                                                                                                                                                                               |
| X24     | `problem.copy.ts` mengimpor dari `src/shared/format.id.ts` (01 W1).                                                                                                                                                                                                                                                                |
| X25     | 503 (`postgres_down`, `pm2_unavailable`), 429 + `extra.retryAfterSec`, 409 `not_supervised` masuk union `ApiError` W0.                                                                                                                                                                                                             |
| X27     | `DatabaseInfo.lastBackupAt` dari `lastGoodItem(db, "database", name)` milik 04.                                                                                                                                                                                                                                                    |
| X29/§4  | Ruang lingkup v0.3.0 dipangkas ke ±3.200 baris. Daftar tunda ada di PLAN §1.                                                                                                                                                                                                                                                       |
| K42     | Kriteria penerimaan baru: cek nilai `panel.protected_services` yang tersimpan di POCO. Bila tersimpan eksplisit, default baru tidak berlaku, dan catatan rilis menyebutkannya.                                                                                                                                                     |

---

## Usulan kontrak kanonik (untuk arbitrase koordinator)

1. **Kunci setting Telegram/pemantauan:** `alerts.telegram_bot_token` (secret), `alerts.telegram_chat_id`,
   `alerts.enabled` (`on|off`), `alerts.min_severity` (`warning|danger`), `monitor.sample_interval_sec` (30–600, default
   60), `monitor.battery_warn_percent` (`off` atau 21–100, default 50), `monitor.battery_unplugged_grace_min` (`off` atau
   1–1440, default 30); default baru `panel.protected_services` = `sshd,cloudflared,panel,pm2,postgres`. Ditulis
   `wkr-settings-01` (W1). Label Indonesia ada di `id.settings.ts` (05), dengan teks dari PLAN/02 §3.6. **Bukan
   `notify.*`.**
2. **Endpoint Telegram:**
   - `POST /api/dev/alerts/test` (super_admin) → 200 `{ ok: true, sentAt }`. Gagal → 409 `alerts_not_configured`,
     429 `too_soon` (+`retryAfterSec`), atau 502 `{ error: AlertErrorCode, message }`.
   - `POST /api/dev/alerts/telegram/chats` → 200 `{ chats: TelegramChat[] }`. Gagal → 409 `alerts_token_missing`,
     409 `telegram_conflict`, atau 502.
   - `AlertErrorCode` = `telegram_token_invalid | telegram_chat_not_found | telegram_chat_migrated | telegram_forbidden |
     telegram_conflict | telegram_rate_limited | telegram_bad_request | telegram_unreachable`.
   - 05 memetakan `error` lewat `errorCodes`. **Bukan** `/api/dev/notify/telegram/test` dan bukan 200 `{ok, code, detail}`.
   - Menyimpan setting lewat `PATCH /api/dev/settings` (05).
3. **Heartbeat:** tidak ada `beat()` di v0.3.0. `/dev/health` membaca
   `monitor.status(): { sampledAt: string | null; intervalSec: number; lastTickMs: number | null; running: boolean }`
   dan menganggap sampler macet bila `now − sampledAt > 3 × intervalSec`. Bila koordinator memilih `heartbeat.ts`, nama
   yang dikunci adalah `beat("sampler", intervalSec)`, dipanggil di awal tick.
4. **Log:**
   - `src/shared/log.types.ts` (W0 kontrak): `LogLine = { at: string | null; text: string; stream?: "out" | "err";
     level?: LogLevel }`, `LogChunk = { lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean }`.
   - Endpoint log layanan/aplikasi mengembalikan `LogChunk`.
   - Parser waktu satu: `splitLogTimestamp` di `src/shared/log.time.ts` (01).
   - Redaksi + cursor di `src/server/system/log.redact.ts` (02, `wkr-mon-core-02`).
   - `useLogFollow` milik 01.
   - `AppLogTail.lines` (03) = `LogLine[]`.
5. **Adapter untuk PLAN/03** (satu `wkr-adapters-01`, W1):
   - `Pm2Proc` += `cwd: string | null`, `execPath: string | null`, `args: string[]`, `startedAtMs: number | null`,
     `module: boolean`, `outLog`, `errLog` (sudah ada);
   - `App` += `module`, `site`; `cpu` selalu `null` di termux;
   - `Pm2Adapter` dibangun dengan `isSupervisorUp` dan melempar `Pm2UnavailableError(reason)`;
   - `NetAdapter.httpStatus(port, path = "/", timeoutMs = 5000)`;
   - `Service` += `downSec`, `lockout`;
   - `Battery` += `status`, `plugged`, `health`, `temperatureC: number | null`;
   - `RunitAdapter` tanpa `restartDetached`;
   - snapshot mengekspos `pm2Procs(): Promise<Pm2Proc[]>` (≤ 15 dtk basi; job memanggil adapter langsung).
   - Kontrak balik dari 03: `jobs.isLocked({ kind: "service" | "app"; name }): boolean`, `jobs.active(): ActiveJob | null`,
     dan job runner memanggil `monitor.noteIntentionalRestart({ kind, name })` setiap kali me-restart app/layanan.
6. **Kode masalah untuk PLAN/04** (aturan di `overview.problems.ts`, milik 02; 04 **tidak** membuat
   `backup.problems.ts`/`backup.events.ts`/`notify()`):

   | Kode                    | Severity | Input dari 04                                                                                                                    |
   | ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `backup_not_configured` | warning  | `BackupStatus.configured`                                                                                                        |
   | `backup_failed`         | danger   | `BackupStatus.lastRun`                                                                                                           |
   | `backup_partial`        | warning  | `BackupStatus.lastRun`                                                                                                           |
   | `backup_stale`          | warning  | `BackupStatus.lastRun`                                                                                                           |
   | `backup_item_stale`     | warning  | `BackupStatus.lastGood[]`, target `database:<nama>`/`site:<nama>`/…, params `{ itemKind, name, hours }`                          |
   | `key_mismatch`          | danger   | kind `security`; `SecurityStatus.keyMismatch`, atau `backup.status()` melempar `KeyMismatchError`; menahan `backup_status_error` |
   | `access_not_seen`       | warning  | kind `security`; input `{ https, accessLastSeenAt, adminSeenSinceBoot }` dari `SecurityStatus`                                   |
   | `backup_status_error`   | danger   | non-kunci (throw lain)                                                                                                           |

   "Recovered" otomatis menjadi "PULIH" saat event ditutup. Delay: `backup_*` 0, `key_mismatch` 0, `access_not_seen` 0,
   `backup_not_configured` tidak dikirim. Nama field final `lastGood`/`SecurityStatus` mengikuti W0 kontrak 04.
7. **`ProblemKind`** = `service | app | domain | network | backup | security | disk | battery | host | alerts | site`.
