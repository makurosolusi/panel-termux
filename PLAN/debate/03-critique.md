# Kritik PLAN 03: Siklus hidup Situs

> Kritikus: wkr-critic-03 · 2026-11-26 · branch `feature/production-polish` @ caa4308.
> Bahan: `PLAN/03-sites-lifecycle.md` (seluruhnya), `R&D/03`, PLAN/02/04/05 (kontrak yang disebut), kode di HEAD
> (dikutip `file:baris`), commit hotfix CSRF `29fc9b8` di `main`, uji Bun 1.4.2 lokal (scratchpad `envlab/`), dan
> pemeriksaan **read-only** di POCO (`ssh poco`: layout `~/sites`, field ecosystem yang dimuat `node`, field terpilih
> `pm2 jlist`, ingress `config.yml`, run script runit `pm2`). Tidak ada nilai `.env` atau jlist mentah yang dicetak.
> Tidak ada yang di-restart.

## 1. Ringkasan penilaian

**Verdict: siap dengan revisi. Bagian berikut perlu ditulis ulang: §4.11 (tabel cleanup deploy/rollback), §3.6/§8.1
(cek `apps_entries_runnable` dan filter snippet untuk entri grun), kontrak sha unggahan (D12 ↔ §3.3 ↔ §4.11), dan
jalur "pm2-runtime tidak hidup" (HP baru / app terakhir dihapus).**

Arah besarnya benar. Panel tidak mengedit ecosystem, entri `apps.json` baru ditulis setelah binary ada, adopsi
memakai data pm2, unggahan bisa dilanjutkan, langkah job berkode, dan pemulihan dilakukan manual lewat pemeriksaan
idempoten. Adopsi `makuro-solusi` saya cocokkan dengan data POCO, dan hasilnya sesuai. Yang masih salah ada di
pemulihan setelah crash dan di asumsi pm2 untuk entri glibc. Dua masalah bisa membuat situs produksi mati sambil
UI melaporkan "bersih". Ukuran diff (±6.200 baris) terlalu besar untuk panel satu pemilik. Sekitar 1.000–1.500
baris bisa dipangkas tanpa mengurangi keamanan (§C20).

Jumlah temuan: **BLOCKER 4 · MAJOR 10 · MINOR 5 · OVER 4**.

---

## 2. Temuan

### C1. BLOCKER · kontrak/data: sha akhir unggahan tidak diketahui saat job dimulai

- **Klaim di PLAN**: D12 "sha akhir dihitung server saat assemble. `UploadStartRequest.sha256` dihapus". §3.3
  `job.input` `site.deploy {site, uploadId, sha256, …}`. §4.11 cleanup deploy: "`swapped` = sha(`app`) ==
  `input.sha256`". §6 "sha akhir server tercatat di baris `deploy`".
- **Masalah**: Sekarang baris `deploy` disisipkan di `runJob` **sebelum** langkah pertama dengan `sha256` dari unggahan
  (`deploy.service.ts:97-109`), dan kolomnya `notNull` (`deploy.schema.ts:17`). Kalau sha baru dihitung di langkah
  `assemble`, maka saat `complete` → `jobs.start` belum ada sha untuk baris `deploy` maupun untuk `job.input`.
  Akibatnya PLAN tidak bisa diimplementasikan seperti tertulis. Kalau implementer mengisi `''` atau null, cleanup
  §4.11 tidak pernah mendeteksi `swapped`, lalu "kembali ke keadaan sebelumnya" tidak terjadi.
- **Usulan**: Hitung sha di `POST complete` secara streaming atas file potongan (89 MB, ±1 dtk di HP; potongan sudah
  diverifikasi per-sha). Tulis hasilnya ke `job.input.sha256` dan baris `deploy` sebelum `jobs.start`. Langkah
  `assemble` membandingkan ulang sha saat menyalin. Alternatif: perbarui `job.input` dan baris `deploy` di akhir
  `assemble`, sebelum `swap`. Bagaimanapun, aturannya wajib tertulis: **sha tersimpan permanen sebelum langkah `swap`**.

### C2. BLOCKER · flow: cleanup deploy/rollback tidak memodelkan crash di tengah swap

- **Klaim di PLAN**: §4.11 `site.deploy`: "`app.new` ada → hapus. `swapped` = sha(`app`) == `input.sha256` … dikelola +
  `app` tidak ada → **hapus entri** (D5). `app_restart` bila pm2 mengenal app …". `site.rollback`: "swapped =
  sha(`app`) == `input.toSha256` → swap balik". Disebut "semua idempoten".
- **Masalah**: `swapStep` terdiri dari tiga `rename` (`deploy.steps.ts:118-120`): `prev→drop`, `app→prev`, `new→app`.
  Kalau panel mati (OOM/LMK Android, `kill -9`, HP mati) di antara rename ke-2 dan ke-3, keadaannya: `app` **tidak
  ada**, `app.prev` = binary yang tadinya live, `.app.prev.drop` ada, `app.new` ada. Kalau tabel diikuti apa adanya:
  `app.new` dihapus (binary baru hilang), lalu `swapped` false karena `app` tidak ada. `.app.prev.drop` ikut dihapus
  karena `app.prev` ada. Situs dikelola tanpa `app` kemudian **entri apps.json-nya dihapus**, dan `app_restart`
  menjalankan binary yang hilang. Hasil akhirnya situs live mati, entri pm2 hilang, versi sebelumnya ikut terbuang,
  sementara cleanup berstatus `succeeded`. Rollback punya masalah yang sama karena `swapBackStep` memakai
  `.app.swap` (`deploy.steps.ts:135-139`): crash setelah `app→tmp` membuat `app` hilang. Ada juga masalah kedua.
  Kalau binary yang di-deploy ulang sama persis (sha baru == sha lama), `swapped` selalu true, padahal swap mungkin
  belum terjadi. Cleanup lalu "membalik" swap dan menaruh versi lebih tua.
- **Usulan**: Ganti tabel deploy/rollback dengan tabel keadaan berdasarkan keberadaan file `(app, app.prev,
  .app.prev.drop, .app.swap, app.new)`, ditambah sha yang dicatat di `job.input` (`fromSha256` untuk deploy juga).
  Aturan pertama: **bila `app` hilang tetapi `app.prev`/`.app.swap` ada, pulihkan `app` dulu**. Entri apps.json hanya
  boleh dihapus bila tidak ada binary sama sekali **dan** `input` menyatakan ini deploy pertama (`fromSha256 =
  null`). Uji unit wajib mencakup kelima titik crash per swap (inject throw di antara rename). Opsional untuk
  memperkecil jendela: urutan `prev→drop`, `copy app→prev`, `rename new→app` (rename menimpa secara atomik) membuat
  `app` selalu ada. Biayanya satu salinan 89 MB. Hardlink lebih murah, tetapi perlu dicek di Android/Termux dulu.

### C3. BLOCKER · fitur/data: cek dan filter "binary ada" salah untuk entri grun

- **Klaim di PLAN**: §3.6 `apps_entries_runnable` "setiap entri `apps.json` punya file `cwd/script` yang ada" (bagian
  dari `ready`). §8.1/Q1: snippet memfilter `fs.existsSync(path.join(a.cwd, a.script))`, "**direkomendasikan**".
- **Masalah**: Entri glibc yang ditulis panel memakai `script: "${PREFIX}/bin/grun"` dan binary-nya ada di `args:
  ["./app"]` (`deploy.steps.ts:153-155`). Hal yang sama terlihat di POCO: `makuro-solusi` punya `script =
  /data/data/com.termux/files/usr/bin/grun`, `args = "./app"`, dan `grun` adalah symlink ke `glibc-runner`. Dampaknya
  dua:
  (a) Untuk entri grun, `apps_entries_runnable` selalu ok karena `grun` ada, walaupun `./app` hilang. Padahal itulah
  kondisi E1 yang mematikan semua aplikasi.
  (b) `path.join("/…/sites/blog", "/data/…/bin/grun")` menghasilkan `/…/sites/blog/data/…/bin/grun`, karena `join`
  tidak menganggap argumen absolut sebagai absolut. Akibatnya filter Q1 **membuang semua entri grun**, dan semua
  situs glibc buatan panel tidak jalan setelah reboot. Kesalahan ini muncul justru di pengaman G1 (P0).
- **Usulan**: Satu fungsi bersama `entryBinary(a) = path.resolve(a.cwd, basename(a.script) === "grun" ? a.args[0] :
  a.script)` dipakai di cek server dan disalin ke snippet, ditambah uji snippet untuk entri grun dengan `./app` ada
  dan tidak ada. Jadikan filter snippet **default sekarang**, jangan menunggu E1: biayanya satu baris dan berlaku
  untuk kedua kemungkinan hasil E1. Lihat juga C6, yang menghapus perbedaan script native/grun sama sekali.

### C4. BLOCKER · flow: pm2-runtime tidak hidup (HP baru, app terakhir dihapus), dan deploy pertama memunculkan daemon liar

- **Klaim di PLAN**: §4.1 langkah 7: "HP baru … pm2-runtime keluar karena 0 aplikasi … Lihat ketergantungan ke PLAN/05".
  §7 ke PLAN/05: "ecosystem template **harus** memuat snippet … dan minimal satu aplikasi". §4.3 langkah 10: deploy
  pertama → `pm2 start ecosystem.config.js --only <nama>` (lab E2).
- **Masalah**:
  1. Di HP baru (target rilis publik v0.3.0, CTA "Pasang di HP-mu"), ecosystem tanpa aplikasi tulisan tangan
     membuat pm2-runtime langsung keluar. runsv lalu menyalakannya lagi kira-kira tiap detik, dan run script POCO
     memindai `/proc` setiap kali (orphan killer). Siklus itu berlangsung terus sampai situs pertama di-deploy, dan
     artinya baterai dan CPU terkuras.
  2. Dalam keadaan itu `rpc.sock` tidak ada atau hanya sesaat. `startFromEcosystem` tidak memeriksa `rpc.sock`
     (`pm2.termux.ts:135-139`, berbeda dengan `procs()` di baris 107), sehingga `pm2 start` dari panel **menyalakan
     daemon pm2 biasa di `~/.pm2` di luar runit**. Apa yang terjadi ketika runit lalu menyalakan pm2-runtime di
     `PM2_HOME` yang sama tidak diuji (E2 hanya menguji runtime yang sedang hidup).
  3. Menghapus situs dikelola terakhir (`app_remove`) atau meng-undo deploy pertama (`revertApp` → `pm2.remove`,
     `deploy.steps.ts:215`) di HP yang hanya berisi aplikasi panel memicu E4: runtime keluar ±8 dtk kemudian.
  4. Tidak ada pemilik: `scripts/install-phone.sh` tidak menyentuh pm2 atau ecosystem sama sekali, dan PLAN/05 tidak
     menyebut template ecosystem, snippet, `--no-auto-exit`, atau aplikasi penjaga (grep `ecosystem|no-auto-exit|
     pm2-runtime` di PLAN/05 hanya menemukan item onboarding `apps_json`).
     POCO aman hari ini karena ada `makuro-solusi`, `adminneo`, dan modul `pm2-logrotate`, dan run script-nya tanpa
     `--no-auto-exit` (dicek). Tetapi rilis publik mewarisi jalur ini.
- **Usulan**: (a) Tambahkan cek integrasi `pm2_runtime` (ok bila `rpc.sock` ada **dan** `pm2 ping` sukses). Masukkan
  ke `ready`, dan tolak `app_restart`/`app_start` dengan kode `pm2_not_running` sebelum memanggil `pm2 start`.
  Jangan pernah menyalakan daemon dari panel. (b) Tambahkan **E8**: "`pm2 start --only` saat runtime mati, lalu runit
  menyalakan runtime", dan **E4b**: "apakah modul `pm2-logrotate` dihitung sebagai app online sehingga runtime tidak
  keluar". Kalau ya, itu penjaga gratis yang bisa dipasang installer. (c) Pindahkan ke PLAN/05 sebagai item bernama
  dengan pemilik worker: installer membuat `~/sites/ecosystem.config.js` (snippet + penjaga sesuai hasil E4/E4b) dan
  run script `pm2` bila belum ada, tanpa menimpa milik pemilik. (d) Sampai ini selesai, `site.delete` dan undo deploy
  pertama memberi peringatan `pm2_last_app` di dialog.

### C5. MAJOR · kontrak: janji ke PLAN/04 dan PLAN/05 tidak ada di PLAN tujuan

- **Klaim di PLAN**: §7 tabel dependensi. PLAN/04: `lastSuccessfulBackupOf(database)` dan pengecualian `app.new`,
  `.app.prev.drop`, `.app.swap`. PLAN/05: `sv -w 130 restart panel` dan template ecosystem.
- **Masalah**: PLAN/04 K4 dan §F (`PLAN/04:70,499`) hanya mengecualikan `./*/app` dan `./*/app.prev`. Deploy yang
  sedang berjalan atau terputus membuat file 89 MB lain ikut masuk tar harian, dan `lastSuccessfulBackupOf` tidak
  disebut di mana pun di PLAN/04. Di PLAN/05 tidak ada `sv -w`. Installer sekarang menjalankan `until sv restart
  panel` dengan batas default `sv` 7 dtk, diulang hingga `SV_WAIT_SEC=15` kali (`install-phone.sh:17,76-79`).
  Dengan shutdown 120 dtk (D11), upgrade saat ada job mengirim TERM berulang dan bisa berakhir dengan pesan menyesatkan
  "sv restart panel failed (is service-daemon running?)".
- **Usulan**: Orkestrator perlu memastikan PLAN/04 menambahkan pola `*/app.new`, `*/.app.prev.drop`, `*/.app.swap`,
  `*/.env.panel-prev` (C8) dan fungsi `lastSuccessfulBackupOf`, lalu PLAN/05 menambahkan `sv -w 130 restart panel`
  (satu kali, tanpa loop) beserta template ecosystem (C4). Kalau tidak disepakati, dialog hapus situs memakai teks
  tanpa info cadangan.

### C6. MAJOR (dan OVER) · flow: delete+start saat runtime berubah bergantung pada E3/E4. Script entri bisa dibuat tetap

- **Klaim di PLAN**: §8.1 baris E3/E4: "Pertahankan delete+start saat runtime berubah … jeda < 2 dtk, di bawah ±8 dtk
  lokal". `apps_entry` = `apps_runtime_set`.
- **Masalah**: Mengandalkan jeda lebih pendek dari periode cek auto-exit pm2-runtime adalah race, bukan jaminan. Di
  HP lambat, `pm2 delete` + `pm2 start` adalah dua proses node (masing-masing 1–3 dtk), dan `PM2_TIMEOUT_MS` sudah
  mengakui itu (`pm2.termux.ts:14`). Desain ini juga butuh `setAppRuntime`, langkah `apps_entry` per deploy/rollback,
  `appsChanged`, cabang reload di `restartApp`, dan dua eksperimen.
- **Usulan**: Buat entri `apps.json` **tidak pernah berubah** setelah didaftarkan: `script: "./run"`, `interpreter:
  "none"`. `run` adalah skrip sh dua baris yang ditulis panel secara atomik dan ikut di-swap bersama binary
  (`run`/`run.prev`), isinya `exec ./app` atau `exec $PREFIX/bin/grun ./app`. Deploy/rollback lalu cukup memakai
  `pm2 restart`, tanpa jeda 0-app, tanpa E3, tanpa `apps_runtime_set`, dan cek "binary ada" (C3) menjadi satu
  bentuk. Karena `exec`, sinyal dari pm2 tetap sampai ke app. Kalau ditolak, minimal tulis bahwa delete+start hanya
  terjadi saat runtime berubah, dan C4(a) menjaga agar runtime tidak mati.

### C7. MAJOR · fitur: editor env, `$` di Bun, kutip, dan semantik tempel `.env`

- **Klaim di PLAN**: §5.6 parser tempel "baris `KEY=VALUE`, `export`, kutip tunggal/ganda, komentar `#`". §3.4
  `invalid_env.reason: "quote" | "backslash"`. D17 redaksi "nilai `.env` situs ≥ 6 karakter".
- **Masalah** (diuji dengan Bun 1.4.2 lokal, file `.env` dibaca binary `bun`):
  - Bun mengekspansi `$NAMA` di **semua** bentuk kutip. `E='p$HOMEq'`, `C="p$HOMEq"`, dan `D=p$HOMEq` semuanya menjadi
    `"p"`. Hanya `\$` yang literal (`A='x\$y'` dan `I="x\$y"` → `x$y`), dan ini cocok dengan `envLine`
    (`env.file.ts:27-33`).
  - Akibatnya, menempelkan `.env` lama yang berisi `$` (hash bcrypt `$2b$10$…`, password) memberi nilai **berbeda**
    dari yang dilihat aplikasi sebelumnya. Panel menyimpan literal `$2b$10$…`, padahal Bun dulu membacanya sebagai
    string hampir kosong. Arah ini mungkin malah benar, tetapi pemilik tidak diberi tahu sama sekali.
  - `'` ditolak (`UNREPRESENTABLE`, `env.file.ts:9`), padahal Bun membaca `B="it's"` dengan benar. Password yang
    berisi `'` jadi tidak bisa disimpan tanpa alasan kuat. `\"` di dalam kutip ganda **tidak** di-unescape
    (`F="a\"b"` → `a\"b`), dan `\n` di kutip ganda menjadi baris baru (`G`). Jadi kutip ganda hanya aman untuk nilai
    tanpa `"` dan tanpa `\`.
  - Komentar inline tanpa kutip (`H=abc # comment` → `abc`) harus diperlakukan sama oleh parser tempel.
  - Redaksi D17 harus membandingkan nilai yang **sudah di-decode** sesuai aturan Bun. Kalau tidak, nilai di file
    tulisan tangan (situs adopsi) yang memakai ekspansi tidak cocok dengan yang dicetak aplikasi.
- **Usulan**: (a) Parser tempel memakai aturan Bun di atas dan **menandai** baris yang mengandung `$` tanpa `\`:
  "Bun membaca `$NAMA` sebagai variabel. Panel menyimpan nilainya apa adanya." (b) `envLine`: nilai yang punya `'`
  tetapi tidak punya `"` dan `\` ditulis dalam kutip ganda dengan `$`→`\$`. Tolak hanya bila keduanya ada. (c) Satu
  fungsi `decodeEnvValue` dipakai bersama untuk redaksi dan `readEnvPort`. (d) Tabel uji `tests/site.files.test.ts`
  ditambah kasus A–J di atas (dijalankan terhadap `bun` nyata, seperti test yang sudah ada).

### C8. MAJOR · flow/janji rollback: `site.env` yang terputus tidak bisa dipulihkan

- **Klaim di PLAN**: D18 dan §4.10 langkah 5: "`env_write` (simpan byte lama di memori job saja) … Panel terputus …
  nilai lama **tidak** bisa dipulihkan; disebut jujur".
- **Masalah**: Ini satu-satunya jenis job yang cleanup-nya tidak bisa mengembalikan keadaan, padahal biayanya kecil
  dan `writeAtomic` sudah punya opsi `backup` (`site.files.ts:21-24`). Kalau nilai yang salah menyebabkan crash lalu
  panel restart di tengah health 60 dtk, situs tetap mati dengan `.env` rusak.
- **Usulan**: `env_write` menyalin `.env` ke `.env.panel-prev` (0600, satu file) sebelum menulis. Undo dan cleanup
  `site.env` mengembalikannya, lalu file dihapus saat job sukses. Kecualikan dari backup (C5). Teks "tidak bisa
  dipulihkan" dihapus.

### C9. MAJOR · flow: semantik cek kesehatan dan biaya pm2 di HP

- **Klaim di PLAN**: D16 dan §4.8.3: "cek pm2 (maks tiap 3 dtk) … `streak ≥ 2` → catat `restarts` awal, tunggu 5 dtk".
- **Masalah**: (a) Baseline `restarts` baru diambil setelah dua jawaban sukses. Crash-loop yang sempat menjawab di
  sela restart, atau restart yang terjadi sebelum streak terkumpul, tidak terdeteksi. (b) Setiap `pm2 jlist` adalah
  proses node baru (1–3 dtk CPU di HP, `pm2.termux.ts:14`). Polling tiap 3 dtk selama 60–300 dtk berarti 20–100 spawn
  node per deploy. (c) `expectStatus` "harus sama persis" dengan input angka bebas lebih sempit daripada praktik
  umum: Railway/Coolify menerima 2xx, dan aplikasi yang mengalihkan `/api/health` → 301 gagal. (d) Probe ke
  `127.0.0.1` tanpa header `Host` domain. Aplikasi yang memeriksa host akan memberi 4xx atau redirect. Default
  `< 500` menutupi ini, tetapi saat path atau status khusus disetel, probe bisa gagal palsu. `httpStatus` sekarang
  `redirect: "manual"` dan path tetap `/` (`net.termux.ts:30-34`).
- **Usulan**: Ambil baseline `restarts` **segera setelah** `app_restart`, lalu baca pm2 hanya tiga kali: setelah
  restart, saat streak tercapai, dan setelah jendela stabil 5 dtk. `errored` dicek tiap 10 dtk saja. Gagal bila
  `restarts` naik di titik mana pun. Ganti `expectStatus: number | null` dengan `expect: "lt500" | "2xx3xx"`. Probe
  mengirim `Host: <domain utama>`.

### C10. MAJOR · flow: urutan DNS/ingress dan blip cloudflared ganda

- **Klaim di PLAN**: §3.4 `site.delete`: `ingress → tunnel_restart → dns → …`. `hostname.remove`: `ingress → dns →
  tunnel_restart`. D-teks "semua domain terputus beberapa detik".
- **Masalah**: Pada `site.delete`, kegagalan API Cloudflare di langkah `dns` (yang terjadi **setelah** restart) memicu
  undo ingress dan restart cloudflared **kedua**. Akibatnya situs berbayar `solusi` dan panel dua kali terputus
  hanya karena satu CNAME yang tersisa. CNAME yang tersisa itu tidak berbahaya: rule catch-all `http_status:404`
  ada di config POCO. Urutan `hostname.remove` (dns lalu restart) dan `site.delete` (restart lalu dns) juga tidak
  konsisten. Dampak blip pada situs berbayar tidak dihitung (tiap create/delete/hostname = 3–10 dtk downtime
  `solusi`, `site.steps.ts:13` memberi batas 30 dtk).
- **Usulan**: Saat menghapus, penghapusan DNS **non-fatal** (`dns_left {hostname}`, warning + tautan ke dasbor) dan
  dilakukan setelah restart di kedua jenis. Saat membuat, urutan sekarang (dns sebelum restart) sudah benar.
  Ringkasan wizard menyebut nama situs lain yang ikut terputus. Opsi zero-downtime (dua replika cloudflared yang
  di-restart bergantian) dicatat sebagai P2, jangan dikerjakan sekarang.

### C11. MAJOR · data/flow: protokol unggahan yang dipersist kurang detail

- **Klaim di PLAN**: D13 "Meta unggahan dipersist di `<data>/uploads/<id>/meta.json`". §4.6.
- **Masalah**: (a) Sekarang store menghapus seluruh `uploads/` saat dibuat (`upload.store.ts:41`). Aturan baru
  untuk boot tidak ditulis: dir tanpa `meta.json`, `.tmp` sisa, potongan yang ada di meta tetapi filenya hilang.
  (b) Urutan tulis tidak ditetapkan. Meta harus ditulis **setelah** `rename` potongan, kalau tidak meta bisa
  mengklaim potongan yang tidak ada. (c) `complete` memanggil `detach` (`deploy.service.ts:159`), tetapi `meta.json`
  tetap di disk. Setelah restart panel di tengah `assemble`, unggahan itu "hidup lagi" sebagai unggahan aktif,
  padahal job yang terputus juga merujuknya (`input.uploadId`). (d) Potongan tidak diverifikasi ulang saat
  `assemble` (flash bisa rusak, dan potongan bisa diganti setelah meta ditulis). (e) Hapus situs saat unggahan
  aktif tidak membuang unggahannya. (f) Preflight ruang dihitung per unggahan. Dua situs sekaligus bisa melebihi
  ruang yang tersedia (POCO sekarang 171 GB bebas, jadi ini relevan untuk HP lain).
- **Usulan**: Tulis aturannya: boot = pindai `uploads/*`, buang yang tanpa meta, kedaluwarsa, atau `state !=
  "receiving"`. `complete` menulis `state: "assembling"` dulu. `assemble` membandingkan sha per potongan dengan meta.
  `site.delete` membuang unggahan situs itu. Preflight memakai total ukuran semua unggahan aktif. Uji untuk
  masing-masing.

### C12. MAJOR · fitur: rollback situs adopsi tidak memeriksa runtime

- **Klaim di PLAN**: §3.5 rollback error hanya `invalid_binary`, `no_previous`, `no_current`, `busy`. D14 memeriksa
  `runtime_mismatch` hanya di unggahan.
- **Masalah**: Q2 merekomendasikan `makuro-solusi` pindah ke build Android nanti, dengan pemilik mengganti `site()`
  menjadi `./app`. Setelah itu `app.prev` masih glibc. Rollback lalu menjalankan binary glibc lewat script native,
  gagal di cek kesehatan, dan swap dibalik. Situs terputus dua kali tanpa pesan yang benar.
- **Usulan**: `POST rollback` situs adopsi memanggil `detectRuntime(app.prev)` dan membandingkannya dengan
  `scriptRuntime`. Bila beda → 409 `runtime_mismatch` dengan teks yang sama seperti di unggahan.

### C13. MAJOR · rencana kerja: kepemilikan file bentrok lintas PLAN

- **Klaim di PLAN**: §7 "Tidak ada dua worker pada satu file di gelombang yang sama".
- **Masalah**: `src/server/shutdown.ts` dimiliki `wkr-sites-runner-01` (G1) dan juga `wkr-mon-sampler-02` (PLAN/02
  §7, "bila perlu idle tambahan"). `src/server/index.ts` disentuh jobs-02, PLAN/02 sampler, PLAN/04 `wkr-safety-http`,
  dan PLAN/05 seo. `src/server/routes/http.error.ts` (contract-01: status 507 + `extra`) dipakai semua PLAN.
  `tests/site.harness.ts` (data fake §3.7) tidak punya pemilik. `origin.guard.ts` belum ada di branch ini (hanya di
  `main`, `29fc9b8`), padahal §3.5 menganggapnya sudah ada.
- **Usulan**: Tetapkan di §7: `http.error.ts` dikerjakan di gelombang 0 bersama oleh orkestrator. `shutdown.ts` dan
  `index.ts` diubah oleh satu worker integrasi per gelombang dengan daftar hook. `site.harness.ts` dimiliki
  `wkr-sites-contract-01`. Merge `main` (hotfix CSRF) ke branch sebelum G1 masuk prasyarat gelombang, bukan asumsi
  §8.3.

### C14. MAJOR · keamanan: probe ecosystem mewarisi env panel

- **Klaim di PLAN**: §3.6 probe `runTermux("node", ["-e", PROBE, ecosystemPath], {cwd, timeoutMs})`. Detail stderr
  300 karakter ditampilkan.
- **Masalah**: Ecosystem pemilik dieksekusi dengan env proses panel (rahasia OAuth/Better Auth, `DATABASE_URL`
  panel bila ada). Ecosystem yang mencetak `process.env` atau melempar error berisi env akan menaruhnya di `detail`,
  lalu ke UI dan cache. Admin memang dipercaya, tetapi `GET /integration` juga dipakai item onboarding dan bisa
  terekam di log. Rahasia panel tidak ada urusannya dengan ecosystem.
- **Usulan**: Jalankan probe dengan env minimal `{PATH, HOME, PREFIX, PM2_HOME}`, sama seperti yang dilihat pm2 dari
  run script (`HOME`, `PATH`). Redaksi `detail` lewat redaktor PLAN/02 (`log.parse.ts`).

### C15. MINOR · data: deteksi `scriptRuntime` grun

- **Klaim di PLAN**: §4.2 "`basename(execPath) === "grun"` → `grun`".
- **Masalah**: Di POCO `pm_exec_path = …/usr/bin/grun` (cocok). Tetapi `grun` adalah symlink ke `glibc-runner`, dan
  entri yang ditulis tangan memakai `glibc-runner` atau yang lewat `realpath` akan jatuh ke `other` dan diblokir
  `runtime_mismatch` selamanya. Entri `other` yang sah (skrip sh yang meng-`exec ./app`) juga tidak pernah bisa
  di-deploy.
- **Usulan**: `{grun, glibc-runner}` → `grun`. `other` hanya memberi peringatan (bukan 409) dengan teks "panel tidak
  tahu cara pm2 menjalankan binary ini".

### C16. MINOR · data: `job.input` dan journal

- **Klaim di PLAN**: §3.3 `site.deploy {site, uploadId, sha256, sizeBytes, fileName, runtime}`.
- **Masalah**: `uploadId` tidak berguna setelah `assemble` (dir sudah dihapus, `deploy.steps.ts:74`), sedangkan
  `fromSha256` (sha `app` sebelum swap) yang dibutuhkan C2 tidak ada. Retry `site.delete` dari `job.input` tanpa
  `?confirm` diterima, tetapi `/retry` harus memeriksa bahwa job asli memang lolos validasi `confirm`.
- **Usulan**: Ganti `uploadId` dengan `fromSha256` (null = deploy pertama). Retry delete hanya boleh dari job yang
  langkah `validate`-nya `done`.

### C17. MINOR · UI: default hapus situs

- **Klaim di PLAN**: §4.14 checkbox "Simpan folder dan file situs" dan "Simpan database".
- **Masalah**: Default kedua checkbox tidak disebut. Kalau tidak dicentang, data hilang permanen meskipun dialog
  menampilkan "belum pernah dicadangkan". Konfirmasi typed melindungi dari salah klik, bukan dari default yang
  merusak.
- **Usulan**: "Simpan database" dicentang otomatis bila database belum pernah dicadangkan, atau bila cadangan
  terakhir lebih tua dari 24 jam. Hapus database butuh mencentang ulang secara sadar.

### C18. MINOR · test: perilaku pm2 tidak terwakili di fake

- **Klaim di PLAN**: §6 kriteria berbasis fake. E1–E7 hanya di HP.
- **Masalah**: Pengaman yang lahir dari E1/E4 (urutan D5, `pm2_not_running` C4, delete app terakhir) tidak bisa diuji
  bila fake pm2 tidak meniru "runtime mati saat entri rusak atau 0 app".
- **Usulan**: Fake pm2 diberi mode `runtimeExitsOnMissingScript` / `exitsOnZeroApps` sesuai hasil lab, lalu ada test
  bahwa panel menolak `pm2 start` saat runtime mati.

### C19. MINOR · klarifikasi

- §7 menyebut `PANEL_PORT` untuk `self`, padahal env panel bernama `PORT` (`env.ts:46-47`). Tulis nama yang benar.
- §4.12 tabel deploy terburuk ≈150 dtk > shutdown 120 dtk. Pernyataan "120 dtk menutup perubahan tipikal" benar,
  tetapi teks UI upgrade harus jujur bahwa deploy bisa terputus.
- E7 (pola nama `*.config.js`) tidak memengaruhi keputusan apa pun, karena panel tidak membuat file ecosystem. Buang.
- `/sites/:name/uploads/active` mengembalikan `null` atau 404. Tetapkan 404 hanya untuk situs yang tidak ada.

### C20. OVER · ukuran rencana (±6.200 baris diff) dibanding YAGNI

Panel ini untuk satu pemilik dan satu HP. Usulan pemangkasan, perkiraan baris yang hemat dalam kurung:

1. **Script entri tetap `./run`** (C6): `setAppRuntime`, `apps_runtime_set`, cabang reload, E3, dan sebagian test
   hilang (≈200).
2. **Ekor stderr tanpa Map/TTL/endpoint** (D17, `app-log.tail.ts`, `GET /jobs/:id/app-log`, `log_expired`,
   `hasAppLog`): panel "Kenapa gagal" langsung memanggil log aplikasi PLAN/02 (`/panel/apps/<app>/log?stream=err`,
   N baris terakhir) dengan redaktor PLAN/02 ditambah nilai `.env`. Ini tetap ada setelah restart panel dan tidak
   menduplikasi redaktor. Redaksi khusus di job sementara tautan "Lihat log aplikasi" menampilkan baris yang sama
   dengan redaktor lain sama saja dengan dua kebijakan redaksi (≈250).
3. **Satu endpoint pemulihan** `POST /jobs/:id/recover` (server memutuskan cleanup atau retry dari `kind`),
   menggantikan `/cleanup` + `/retry` + dua kode error. UI hanya punya satu tombol, "Pulihkan" (≈120).
4. **`binary.hash.ts` + cache `ino/size/mtimeMs`**: catat `(ino, size, mtimeMs)` di baris `deploy` saat swap. Lencana
   "Aktif" = stat `app` cocok. Sha cukup dari baris deploy. Binary yang diganti lewat ssh tampil "tidak dikenal"
   (lebih jujur daripada sha basi, §8.2) (≈120).
5. **`expectStatus` angka bebas + Select "Lainnya…"** → dua pilihan (C9). **Cache DNS 30 dtk** di wizard tidak perlu
   untuk satu pengguna yang mengetik dengan debounce 400 ms (≈100).

Opsional (hemat flash): tulis potongan langsung ke satu file `upload.bin` di offset (`pwrite`). Dengan begitu
`assemble` = verifikasi sha + `rename` ke `app.new`. Satu salinan 89 MB per deploy dan separuh kebutuhan ruang
preflight hilang.

### C21. OVER · D26 kunci per sumber daya

- **Klaim**: "`postgres` terkunci selama create/delete ber-database; aplikasi pm2 milik situs target terkunci".
- **Masalah**: Dengan satu job global (`job.runner.ts:50-53`), granularitas per sumber daya hanya membedakan
  apakah `postgres` dikunci atau tidak. Itu tidak sebanding dengan kontrak `isLocked({kind,name})` yang harus diuji
  di dua PLAN.
- **Usulan**: Selama ada job, `cloudflared`, `pm2`, `postgres`, dan app target terkunci. `isLocked(resource)` tetap
  dengan signature yang sama (PLAN/02 sudah memakainya), tetapi implementasinya cukup `busy() && resource ∈ set`.

### C22. OVER · `D15` jadwal retry 7 langkah + status `offline` terpisah

- **Masalah**: Jadwal 1-2-4-8-15-30-30 dengan pengecualian `navigator.onLine` tidak salah, tetapi tombol "Lanjutkan
  unggahan" sudah menutup semua kasus panjang. `navigator.onLine` di Android sering true walau VPN putus.
- **Usulan**: Backoff eksponensial dengan batas 30 dtk sampai 120 dtk total, lalu "Unggahan terhenti". Buang cabang
  `offline` (≈40 baris + test).

### C23. OVER · `apps_entries_runnable` sebagai cek terpisah dari snippet filter

- **Masalah**: Kalau filter snippet (C3) menjadi default, entri tanpa binary tidak lagi mematikan pm2. Cek server
  cukup menjadi warning, bukan syarat `ready`.
- **Usulan**: Setelah C3, `apps_entries_runnable` → warning. `ready` tidak bergantung padanya.

---

## 3. Hal yang sudah baik (pertahankan)

- D1/D2: panel tidak pernah mengedit ecosystem. Snippet `try/catch` + `Array.isArray` + filter `name` sudah diuji
  di 7 kondisi, dan probe `Module._load` hanya mencetak nama. Ini pendekatan paling aman untuk file tulisan tangan.
- D5: entri `apps.json` baru ada setelah binary ada, dan dihapus sebelum binary dihapus. Urutan `site.delete` sudah
  sesuai.
- Adopsi berbasis data pm2 **cocok dengan POCO**: `pm_cwd = ~/sites/makuro-solusi` (di dalam `sites.dir`), `app`
  89.180.456 byte ada, `pm_exec_path` = `…/bin/grun` dengan `args ["./app"]` → `scriptRuntime grun`. Env pm2 tidak
  punya `PORT`, dan `.env` punya tepat satu baris `PORT=3005` → `portSource: dotenv`. Ingress `solusi → 3005`,
  `panel → 3200` (= `PORT` panel) → `self`. `pm2-logrotate` ber-`pmx_module: true` → dikecualikan. `adminneo` (php,
  tanpa `app`) → `no_binary`. pm2 7.1.2, `rpc.sock` ada di `~/.pm2` (sama dengan run script runit).
- Pemulihan manual + journal, bukan undo otomatis saat boot. `interrupted` dibedakan dari `failed`/`rolled_back`.
- Kode langkah + `satisfies Record<…>` untuk i18n. 409 `busy` membawa `job`.
- Runtime diperiksa di potongan 0 sebelum 81 MB dikirim. sha per potongan menghapus kebutuhan membaca seluruh file
  ke memori browser. Unggahan bertahan saat panel restart.
- Dialog rollback "dari → ke" + "tidak ikut dikembalikan" (env, DB, `data/`) itu jujur. Typed confirm + `?confirm`
  di server.
- Eksperimen POCO dirancang terisolasi (`PM2_HOME` lab, folder di luar `~/sites`, larangan `pkill -f`) dan
  memetakan hasil ke perubahan PLAN.

## 4. Pertanyaan yang hanya bisa dijawab pemilik

1. Setiap tambah/hapus domain atau buat/hapus situs memutus `solusi.malikkurosaki.com` (berbayar) dan panel selama
   3–10 dtk. Apakah ini dapat diterima tanpa jendela waktu, atau aksi-aksi itu perlu peringatan "situs berbayar ikut
   terputus" + konfirmasi?
2. Untuk HP baru (rilis publik): installer boleh membuat `~/sites/ecosystem.config.js` dan run script runit `pm2`
   (hanya bila belum ada), termasuk aplikasi penjaga ringan bila E4/E4b membuktikannya perlu? (C4)

## Ketergantungan ke eksperimen POCO yang belum jalan (E1–E7)

| Eksperimen | Bagian PLAN yang menunggu                                                                                      | Catatan kritik                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| E1         | D5 (wajib atau tidak), severity `apps_entries_runnable`, Q1 filter snippet                                     | Filter dijadikan default sekarang, dengan `entryBinary` yang benar (C3) |
| E2         | `pm2 start eco --only` untuk deploy pertama                                                                    | Tambah E8: runtime **mati** saat `pm2 start` (C4)                       |
| E3         | delete+start vs `start --only` saat runtime berubah                                                            | Tidak relevan lagi bila C6 (`./run` tetap) diterima                     |
| E4         | jeda delete+start, cek `pm2_single_app`, template installer PLAN/05, hapus situs terakhir, undo deploy pertama | Tambah E4b: modul `pm2-logrotate` sebagai penjaga                       |
| E5         | validitas snippet di pm2-runtime 7.1.2 (gerbang rilis)                                                         | Tambahkan kasus entri grun dengan `./app` hilang                        |
| E6         | `restartPending` (D19)                                                                                         | Juga cek autoload `.env` binary `--compile` di Android                  |
| E7         | tidak ada keputusan                                                                                            | Buang (C19)                                                             |
