# Kritik PLAN/06: Perbaikan otomatis dari UI

> wkr-autofix-debate-01 · 2026-11-27 · HEAD `feature/auto-fix` (2e295ff). Kode yang dibaca: `integration.service.ts`,
> `ecosystem.probe.ts`, `site.files.ts`, `site.steps.ts`, `job.runner.ts`, `deploy.restart.ts`, `apps.file.ts`,
> `run.script.ts`, `pm2.termux.ts`, `runit.termux.ts`, `panel.service.ts`, `data-key.service.ts`, `secret.ts`,
> `settings.service.ts`, `site.schema.ts`, `dns-record.schema.ts`, `site.setup.tsx`, `site.adopt.ts`, `deploy/pm2/*`,
> PLAN/DECISIONS.md, `PLAN/debate/03-pm2-lab-results.md`. Tidak ada web search. Klaim tentang cloudflared ditandai
> **(perlu verifikasi)**.

## 1. Ringkasan penilaian

**Verdict: inti P0 benar, tetapi belum siap diimplementasikan. Lingkupnya juga terlalu lebar.**

Blok bertanda di akhir file, validasi dengan node, dan pemisahan "ubah file ≠ restart" sudah tepat. Cara ini memang
tidak perlu mengurai kode pengguna. Ada tiga jalur yang bisa membuat makuro-solusi mati **saat reboot berikutnya**
tanpa ada yang menyadarinya, karena momen itulah file hasil patch pertama kali dipakai pm2:

1. `writeAtomic` tidak memanggil fsync (C1). HP yang mati karena baterai habis (A9: charger memang dicabut-colok) bisa
   meninggalkan ecosystem kosong.
2. Validasi tidak pernah diuji dengan pm2-runtime nyata (C4), dan restart pm2 yang disetujui pengguna tidak dicek
   sesudahnya (C5).
3. Pembacaan teks bersifat lossy (C2), sehingga janji "byte-identik" tidak berlaku pada file non-UTF-8.

Di sisi lingkup, P2 berisi 24 item, termasuk fitur produk utuh: self-update panel, pemulihan cadangan, API Access, dan
nonaktifkan HP. Semua itu tidak punya tempat di PLAN "perbaiki otomatis". Di P1, `site.repair` (#13), migrasi 0009, dan
batch endpoint juga YAGNI.

Jumlah: **2 BLOCKER, 7 MAJOR, 14 MINOR**, plus pemangkasan lingkup (§3).

---

## 2. Temuan

### C1. `writeAtomic` tanpa fsync: rename bisa selamat sementara isinya hilang setelah HP mati mendadak

- **Severity:** BLOCKER · **Area:** kehilangan data
- **Bukti:** `site.files.ts:21-32`: `writeFileSync(tmp)` → `chmodSync` → `renameSync`, tanpa `fsyncSync` pada file
  maupun direktori. PLAN/06 §3.4 langkah 9 dan §3.6 memakai fungsi ini untuk ecosystem dan run script pm2. Partisi
  data Android umumnya f2fs atau ext4. Heuristik `auto_da_alloc` di ext4 menutup kasus rename-replace, tetapi f2fs
  tidak punya padanan yang bisa diandalkan **(perlu verifikasi pada POCO: `mount | grep /data`)**.
- **Masalah:** skenarionya begini. Fix diterapkan, lalu baterai habis dalam beberapa detik sampai menit, lalu HP
  boot. `ecosystem.config.js` bisa berukuran 0 byte atau berisi sampah. pm2-runtime lalu melaporkan "0 application
  started" dan keluar seketika, sekitar 13 kali per 20 detik (lab E4). **makuro-solusi dan adminneo mati**, dan backup
  di `fix-backups` pun bisa ikut belum ter-flush. Inilah jalur "makuro-solusi terputus tanpa persetujuan", dan
  terjadinya tepat di momen reboot yang dijanjikan aman.
- **Perubahan wajib:** perbaiki di akar, yaitu `writeAtomic`. Dengan begitu semua pemanggil ikut terlindungi:
  `config.yml` (`site.steps.ts:64-70` memakai pola manual yang sama, jadi sisir juga), `apps.json`, `.env`. Urutannya:
  `openSync(tmp,"w",mode)` → `writeSync` → `fsyncSync(fd)` → `close` → `rename` → `fsyncSync(dirfd)`. Backup juga
  di-fsync sebelum rename file hidup. Tambahkan satu test yang memastikan `fsyncSync` dipanggil (spy) sebelum
  `renameSync`. Tambahkan juga ke F2: "kandidat dan backup di-fsync sebelum rename".

### C2. Pembacaan lossy: `readTextOrNull` mengganti byte non-UTF-8 dengan U+FFFD, jadi "byte-identik" tidak terjamin

- **Severity:** MAJOR · **Area:** kehilangan data
- **Bukti:** `site.files.ts:7` memakai `readFileSync(path, "utf8")`. PLAN §3.3 langkah 3 menyebut "bukan UTF-8 valid
  → manual" tanpa menjelaskan cara mendeteksinya. Kriteria penerimaan 2 dan 4 menuntut byte-identik. Kalau patcher
  memakai `readTextOrNull`, komentar Latin-1 (`é` sebagai 0xE9) akan tertulis ulang sebagai `EF BF BD`. Sha yang
  dihitung dari string juga akan berbeda dengan sha byte.
- **Perubahan wajib:** baca sebagai `Buffer`. Sha dihitung dari byte mentah, decode memakai
  `new TextDecoder("utf-8", { fatal: true })`, dan bila gagal hasilnya `manual: not_utf8`. Backup memakai
  `copyFileSync` (byte), bukan teks. BOM dibiarkan apa adanya (node membuang BOM saat `require`). Baris akhir blok
  memakai gaya EOL file: bila ada `\r\n`, blok ditulis dengan `\r\n`. Fixture test: `bom.config.js`, `crlf.config.js`,
  `latin1.config.js` (yang terakhir harus menghasilkan manual).

### C3. Predikat validasi §3.4 langkah 6 tidak sama dengan predikat blok, jadi ada penolakan palsu dan "ready" palsu

- **Severity:** MAJOR · **Area:** validasi
- **Bukti:** blok memfilter dengan `fs.existsSync(path.resolve(a.cwd || __dirname, a.script))`, yang hanya memeriksa
  `script` (`./run`, atau `grun` yang selalu ada). Sebaliknya, "entri yang binary-nya ada" di sisi panel memakai
  `entryBinary` (`apps.file.ts:42-51`): `run` **dan** `app`, atau `args[0]` untuk grun. Entri grun lama (masih ada,
  karena `ensureAppsEntry` punya kode `apps_migrated`, `run.script.ts:65-72`) atau entri `./run` tanpa `app` lolos di
  blok tetapi tidak dihitung panel. Akibatnya `probeAfter.names − hand ≠ expected` → `validation_failed` palsu.
  Masalah kedua ada di kode sekarang: `spreads` (`integration.service.ts:91`) bernilai **true** bila `apps.json = []`,
  walaupun `...panelApps` tidak pernah disebar ke `apps`. Pengguna yang menempel blok tetapi lupa baris spread melihat
  "ok", lalu situs panel pertamanya tidak hidup lagi setelah reboot.
- **Perubahan wajib:** pakai **entri sentinel** di probe. Sebelum `require(eco)`, probe mengisi
  `require.cache[<dir>/apps.json]` dengan
  `[{ name: "__panel_probe__", script: process.execPath, interpreter: "none" }]`. Entri ini selalu ada dan selalu lolos
  filter. `spreads` = sentinel muncul di `names`. Validasi kandidat cukup: sentinel ada, digest app tangan tidak
  berubah, tidak ada nama ganda, dan `__panelTermuxApps.listed`. Tidak perlu lagi menghitung "expected" dengan
  predikat kedua. Sentinel dibuang dari `names`, `envKeys`, dan digest sebelum dikembalikan. Satu mekanisme ini
  menutup C3, bug "lupa spread", dan pengecekan legacy.

### C4. Blok v1 belum pernah dimuat oleh pm2-runtime nyata, dan validasi node bukan pm2

- **Severity:** BLOCKER · **Area:** validasi / risiko produksi
- **Bukti:** PLAN §13 baris 1 mengakui "tidak teruji live". Lab E1e/E5/E10 menguji snippet `panelApps` lama, bukan
  blok yang memodifikasi `module.exports` setelah file selesai dievaluasi, bukan penjaga dinamis, dan bukan bentuk
  ecosystem POCO (factory `site()`, objek literal, komentar). Probe memang menjalankan `require` seperti pm2, tetapi
  perilaku pm2-runtime terhadap hasilnya (urutan start, nama ganda, entri yang dilewati) hanya bisa dibuktikan oleh
  pm2-runtime sendiri.
- **Perubahan wajib:** tambahkan gerbang sebelum F2 di-merge. Jalankan **lab E11** di runtime lab terisolasi (A12,
  PM2_HOME terpisah, pola `03-pm2-lab-results.md`) dengan salinan struktur ecosystem POCO, nama app berbeda, dan
  script stub. Varian yang diuji: (a) blok + `apps.json=[]` → kedua app tangan online, 1 start dalam 60 dtk;
  (b) blok + entri `./run` tanpa file → dilewati, runtime tidak keluar; (c) file tanpa app tangan → `pm2-guard` online;
  (d) `pm2 start eco --only <situs>` saat runtime berjalan → hanya situs itu yang start, pid app tangan tetap.
  Hasilnya dicatat di PLAN/debate. Tanpa E11, fix ecosystem tidak diaktifkan di build termux (flag di kode atau
  `available: false`).

### C5. "Mulai ulang pm2 sekarang" adalah pemuatan pertama blok, tetapi setelahnya tidak dicek dan tidak ada jalan pulang

- **Severity:** MAJOR · **Area:** pm2 / UX keselamatan
- **Bukti:** §3.6 tombol `restartPm2` memakai `controlService` yang sudah ada (`panel.service.ts:241-250`):
  `sv restart`, lalu status runit dikembalikan. Tidak ada pemeriksaan app setelahnya. §3.4 "App berjalan" menyebut
  file baru dibaca pm2 saat runtime start berikutnya. Artinya, menekan tombol ini sekaligus menjalankan ecosystem hasil
  patch untuk pertama kalinya. Copy `restartPm2Body` hanya bilang "berhenti beberapa detik lalu berjalan lagi".
- **Perubahan wajib:**
  1. Restart pm2 dari kartu Persiapan dibungkus aksi `pm2_restart_checked`. Sebelum restart, catat nama app yang
     `online`. Sesudahnya, tunggu sampai 30 dtk sampai semua nama itu online dengan pid valid (B18: jangan percaya
     `online` saja).
  2. Bila ada yang tidak kembali dan ecosystem diubah panel sejak pm2 terakhir start, tampilkan hasil warning: "{app}
     tidak berjalan lagi. **Kembalikan file ecosystem dan mulai ulang pm2**". Aksi ini satu tombol: restore + restart,
     tier `confirm`.
  3. Copy dialog menyebut bahwa perubahan file yang baru dibuat ikut berlaku sekarang.

  Rollback otomatis tanpa klik tidak perlu. Yang wajib adalah deteksinya.

### C6. Status `pending` berbentuk warning dan menyodorkan restart, sehingga pengguna awam terdorong me-restart makuro-solusi

- **Severity:** MAJOR · **Area:** UX / keselamatan
- **Bukti:** tabel `pm2_auto_exit` di §3.6 menetapkan flag di file tanpa flag di proses sebagai `warning {pending:1}`
  dengan tombol "Mulai ulang pm2 sekarang". Pengguna non-teknis menekan tombol apa pun yang membuat ikon kuning hilang.
  Risiko tanpa flag aktif hanya muncul saat semua app dihentikan (E4). Di POCO itu tidak terjadi dalam kerja normal.
  Ada juga kontradiksi: kriteria penerimaan 1 meminta kartu menjadi satu baris "pm2 siap", padahal `pending` tetap
  warning.
- **Perubahan wajib:** `pending` = `state: "ok"` dengan `params.pending` dan teks info ("Aktif setelah HP atau pm2
  dimulai ulang"). Tombol restart pindah ke tautan sekunder di dalam `<details>`. Kriteria 1 tetap berlaku.

### C7. Kunci data: endpoint harus terkunci pada mode `mismatch`, menerima file unduhan, dan mengakui bahwa semua sesi keluar

- **Severity:** MAJOR · **Area:** keamanan / data
- **Bukti:** pemeriksaan dekripsi sudah tersedia di `unreadableSecretSettings({db, secret})`
  (`settings.service.ts:67-79`), jadi tidak perlu ditulis ulang. Ada tiga celah di §6.7:
  1. Bila tidak ada pengaturan rahasia tersimpan, "setiap pengaturan rahasia berhasil didekripsi" bernilai benar
     secara kosong. File apa pun (≥ 64 hex) akan diterima, kunci aktif tertukar, dan semua sesi gugur tanpa manfaat.
  2. File yang dimiliki pengguna adalah **unduhan** `panel-termux-kunci-data-*.txt` (`data-key.service.ts:60-73`):
     teks multi-baris dengan kunci di satu baris dan juga di dalam perintah `printf`. Isi itu bukan `data/secret`
     mentah, jadi "parse kunci" harus menerima kedua bentuk.
  3. Kunci yang sama juga menandatangani sesi (teks ekspor: "memalsukan sesi"). Setelah restart, semua admin keluar.
     Copy "Panel dimulai ulang…" tidak menyebutnya.
- **Perubahan wajib:** endpoint mengembalikan 409 `not_mismatch` bila `dataKeyState` = ok. Parser menerima isi
  mentah atau baris tunggal `^[0-9a-f]{64,}$` dari file unduhan, dan menolak bila ada lebih dari satu kandidat yang
  berbeda. Kunci kandidat valid bila `unreadableSecretSettings({db, secret: kandidat}).length === 0`. Pada keadaan
  campuran (sebagian rahasia sudah disimpan ulang dengan kunci baru), hasilnya 422 `key_partial` dengan tautan ke reset
  yang sudah ada. Kunci tidak pernah dicatat di log atau audit. Audit cukup memuat `sha256(kunci).slice(0,8)` lama dan
  baru. Copy menyatakan "Semua orang perlu masuk lagi". Ini juga mengubah PLAN/04 K8 ("never replaces data/secret"),
  jadi catat sebagai keputusan baru.

### C8. DNS lewat `cert.pem`: zona sertifikat bisa salah, dan migrasi 0009 tidak diperlukan

- **Severity:** MAJOR · **Area:** DNS / skema
- **Bukti:**
  1. `cert.pem` terikat pada **satu zona**, yaitu zona yang dipilih saat `tunnel login`. Isinya blok
     `ARGO TUNNEL TOKEN` berisi `zoneID`, `accountID`, dan `apiToken` **(perlu verifikasi)**. Untuk hostname di luar zona
     itu, `cloudflared tunnel route dns` yang dikenal membuat record `<host>.<zona-cert>`, bukan gagal **(perlu
     verifikasi pada versi terpasang)**. Hasilnya record sampah yang tidak bisa dihapus panel tanpa token.
  2. Kepemilikan record sudah ditentukan oleh tabel `dns_record` (`dns-record.schema.ts:4`, "presence here =
     panel-owned") dan `site_hostname.dns_managed` (`site.schema.ts:36`). Record buatan cloudflared tidak punya
     `recordId`, jadi `dnsManaged: false`. Penghapusan pun sudah melewatinya dengan benar (`site.jobs.ts:210`,
     `site.delete.job.ts:51` → `dns_none_owned`). Kolom `dns_source` dan `0009_auto_fix.sql` tidak menambah perilaku apa
     pun.
  3. PLAN menyebut langkah `dns_ensure`, padahal kuncinya `dns` (`site.steps.ts:136`).
- **Perubahan wajib:** hapus migrasi 0009 dan `dnsSource`. Dalam langkah `dns` yang sudah ada, bila `DnsNotConfiguredError`
  muncul dan `cert.pem` ada, jalankan `routeDns` tanpa overwrite. Hasilnya hanya diterima bila output cloudflared menyebut
  FQDN yang **persis sama** dengan hostname yang diminta. Bila berbeda, kembalikan `dns_wrong_zone` dengan record siap
  salin dan nama record keliru yang perlu dihapus di dasbor. `dnsManaged` tetap false. `cert.pem` tidak pernah dibaca
  panel, cukup `existsSync`. Gerbang Rule 20: verifikasi format output `route dns` di POCO sebelum implementasi. Kartu
  record siap salin (`dns.manual.tsx`) dikerjakan lebih dulu karena aman dan tidak menunggu verifikasi.

### C9. Backup yang dipulihkan bisa basi terhadap situs yang dibuat setelahnya

- **Severity:** MAJOR · **Area:** undo
- **Bukti:** §3.5 hanya membandingkan sha file. Misalnya: fix diterapkan, lalu situs `blog` dideploy (`start --only`
  baru berhasil karena blok ada, `deploy.restart.ts:40`), lalu pengguna menekan "Batalkan perubahan" berhari-hari
  kemudian. Sha masih cocok, sehingga restore berjalan tanpa konfirmasi kedua. `blog` masih jalan sekarang, tetapi
  **tidak hidup lagi setelah reboot**, dan deploy situs baru gagal `app_not_loaded`. `undoBody.ecosystem` menyatakannya
  secara umum, tetapi tidak menyebut nama situs.
- **Perubahan wajib:** dialog restore mencantumkan situs dikelola yang ada di `apps.json` ("blog dan shop tidak berjalan
  lagi setelah HP dinyalakan ulang"). Bila daftar itu tidak kosong, tier naik ke `confirm`. Undo tetap tersedia, karena
  justru dibutuhkan bila reboot memperlihatkan masalah. Panel tetap hidup walaupun pm2 mati (runit terpisah).

### C10. Probe ganda dan klaim "< 20 dtk": tiga eksekusi kode pengguna per apply

- **Severity:** MINOR · **Area:** validasi / performa
- **Bukti:** §3.4 menjalankan `probeBefore`, `probeAfter`, lalu probe file hidup di langkah 10. Masing-masing punya
  timeout 15 dtk (`ecosystem.probe.ts:14`), jadi kasus terburuk 45 dtk, bertentangan dengan F5. Langkah 10 memuat ulang
  isi yang byte-identik dengan kandidat yang sudah lolos, sehingga kegagalannya hanya bisa karena flakiness (timeout di
  HP sibuk), dan kemudian memicu rollback yang tidak perlu.
- **Perubahan:** hapus langkah 10, ganti dengan membaca ulang sha file hidup dan mencocokkannya dengan sha kandidat.
  `probeBefore` diambil dari cache integrasi bila sha-nya sama. Sesuaikan klaim F5.

### C11. Blok tidak boleh pernah melempar, karena kegagalan blok = semua app tangan mati saat boot

- **Severity:** MINOR · **Area:** ketahanan blok
- **Bukti:** di blok §3.1, hanya `require("./apps.json")` dan filter yang ada di dalam `try`. `new Set(list.map(...))`
  dan `list.push(...)` ada di luar `try`. `push` pada array yang dibekukan atau dijadikan proxy oleh kode pengguna
  melempar `TypeError` dan menggagalkan seluruh ecosystem. Validasi saat apply menangkapnya hanya untuk isi file saat
  itu.
- **Perubahan:** seluruh badan blok di dalam `try { … } catch (e) { console.error("[ecosystem] blok panel dilewati: " + e.message) }`.
  `<PREFIX>` disisipkan dengan `JSON.stringify(prefix)`, bukan interpolasi mentah. Blok diawali `;` untuk berjaga dari
  ASI.

### C12. Symlink, hardlink, dan file di luar `sites.dir`

- **Severity:** MINOR · **Area:** penulisan file
- **Bukti:** §3.4 langkah 2 menulis ke `realpath`. `require` di node juga me-resolve symlink, jadi `./apps.json` di blok
  mengarah ke **folder target symlink**, bukan `~/sites`. Probe pun memakai `realpathSync` (`ecosystem.probe.ts:23-24`).
  Bila ecosystem adalah symlink ke checkout git (misalnya repo `server-termux`), blok membaca `apps.json` yang salah dan
  mengotori working tree git. `rename` juga memutus hardlink.
- **Perubahan:** `manual: ecosystem_linked` bila `dirname(realpath) ≠ realpath(sites.dir)` atau `stat.nlink > 1`.
  Penolakan itu lebih murah daripada menangani kasusnya.

### C13. `jobs.exclusive()` adalah API baru untuk race yang sudah aman

- **Severity:** MINOR · **Area:** YAGNI / konkurensi
- **Bukti:** satu-satunya penulis ecosystem adalah fix ini sendiri. Deploy hanya membaca ecosystem (`start --only`)
  dan menulis `apps.json`. Rename itu atomik, sehingga pm2 membaca file lama atau baru, dan keduanya aman. `apps.json`
  yang berubah di tengah validasi tidak memengaruhi validasi sentinel (C3). `assertIdle()` sudah ada
  (`job.runner.ts:160`).
- **Perubahan:** cukup `jobs.assertIdle()` + `backup.busy()`, sehingga kandidat sementara di `~/sites` tidak ikut
  ter-tar cadangan, ditambah kunci aksi `integration`. Hapus `exclusive()` dan test-nya. Saat boot, hapus kandidat yatim
  `.ecosystem.panel-candidate.config.js`, karena isinya bisa memuat rahasia dari `env` ecosystem.

### C14. Deteksi `pending` lewat `/proc/<pid>/cmdline` dan adapter fake baru lebih berat dari perlunya

- **Severity:** MINOR · **Area:** YAGNI
- **Bukti:** §3.6 dan §9 menambah `RunitAdapter.cmdline()` dan fake yang menyimpan teks `run`. Padahal
  `supervise()` (`runit.termux.ts:97-104`) dan `sv status` sudah memberi pid dan uptime. Selama orphan-killer di run
  script berjalan (`sleep 2`), cmdline pid itu masih `sh ./run`, jadi pembacaan bisa salah.
- **Perubahan:** `pending = flag ada di file && mtime(run) > waktu start layanan pm2 (now − uptimeSec)`. Batas atasnya
  (`ponytail:`): suntingan komentar juga dihitung pending, dan itu bisa diterima. Tidak perlu method adapter baru. Fake
  cukup menyetel `mtime` dan uptime.

### C15. Bug serupa di `integration.service.ts:117-119`: `pm2_guard` disembunyikan karena flag di file, bertentangan dengan E4/E10c

- **Severity:** MINOR · **Area:** sisir yang serupa
- **Bukti:** komentarnya berbunyi "With `--no-auto-exit` pm2 survives zero apps, so the guard is moot". Lab E4 (baris
  "ecosystem 0 app saat start") membuktikan flag **tidak** menolong saat start dengan 0 app, dan keputusan E10 berbunyi
  "flag tetap dipasang **bersama** penjaga". Ditambah F4, flag yang baru ditulis ke file langsung menyembunyikan
  `pm2_guard` padahal proses belum memakainya.
- **Perubahan:** hapus aturan moot itu. Blok v1 sudah menambahkan penjaga dinamis, sehingga `pm2_guard` hanya gagal di
  file legacy tanpa penjaga dan tanpa app tangan.

### C16. Copy dan istilah

- **Severity:** MINOR · **Area:** UX
- **Bukti dan perubahan:**
  - `validation_failed` diberi toast "Dikembalikan" (A10). Padahal tidak ada yang diubah, jadi pakai "Tidak diterapkan"
    dengan tone warning. A10 hanya untuk perubahan yang sudah diterapkan lalu dipulihkan.
  - `dialog.pm2_auto_exit.body` memakai "run script layanan pm2" dan `--no-auto-exit` di kalimat pertama. Ganti dengan
    "Panel mengubah pengaturan layanan pm2 agar tidak berhenti sendiri saat semua aplikasi dihentikan." Nama flag cukup
    di diff.
  - `checks.ecosystem_spreads_apps_json.error` di POCO (0 situs panel) berbunyi "Situs buatan panel belum ikut
    dijalankan pm2, jadi tidak berjalan lagi…". Pengguna tanpa situs panel akan bingung. Bila `apps.json` kosong,
    gunakan "Sebelum situs pertama dibuat, panel perlu menghubungkannya ke pm2."
  - "Perbaiki semua yang **aman**" menyiratkan ada perbaikan yang tidak aman. Cukup "Perbaiki semua (n)".
  - F8 "start juga menghapus file `down`": menghapus `down` mengubah perilaku saat boot secara permanen. Copy tombol
    perlu menyebutnya ("…dan menyala otomatis saat HP dinyalakan ulang"). Sudah ada di toast, pindahkan ke tombol atau
    judul.

### C17. Keamanan endpoint: path traversal pada restore dan cakupan peran

- **Severity:** MINOR · **Area:** keamanan
- **Bukti:** §3.5 `POST /integration/backups/:id/restore` belum menetapkan format id. Peran admin (A1) dan guard CSRF
  yang ada (B17) sudah cukup. Re-auth tidak perlu untuk fix yang teksnya ditentukan panel.
- **Perubahan:** id = `^(ecosystem|pm2_run)/\d{8}-\d{6}-[0-9a-f]{8}$`, di-resolve lalu dicek tetap berada di
  `fix-backups/<file>/`. Path tujuan restore tidak pernah diambil dari body, hanya dari `FixFile` → path server. Test:
  `../`, encoded slash, id yang tidak ada → 404.

### C18. Kontrak API dan UI lebih banyak dari kebutuhan

- **Severity:** MINOR · **Area:** YAGNI
- **Bukti:** §5.1 dan §5.2 mendefinisikan `FixRisk` dengan satu nilai (`"safe"`), batch `POST /integration/fixes`
  (paling banyak 2 fix di POCO), `GET /integration/backups` (UI hanya butuh backup terbaru), tombol per baris plus label
  "Ikut diperbaiki", toast **Batalkan** 10 dtk, dan baris "Perubahan terakhir" (dua UI undo).
- **Perubahan:** hapus `FixRisk` dan batch endpoint. Tombol "Perbaiki semua" di klien memanggil fix satu per satu.
  `GET /integration/backups` diganti `Integration.lastFix: FixBackup | null`. Satu UI undo saja, yaitu baris "Perubahan
  terakhir", yang ditampilkan di `<details>` kartu agar tidak menggoda. Toast cukup sukses tanpa undo. `FixFile` hanya
  `ecosystem | pm2_run` di gelombang ini.

### C19. Disk penuh dan error yang tidak dipetakan

- **Severity:** MINOR · **Area:** error handling (Rule 11)
- **Bukti:** §3.4 tidak memetakan `ENOSPC`/`EACCES` saat menulis kandidat atau backup, sehingga hasilnya 500 generik.
- **Perubahan:** `ENOSPC` → 507 `disk_full` ("Memori HP penuh, jadi file tidak diubah."). `EACCES` → 422 `not_writable`.
  File asli tetap utuh karena backup dan kandidat ditulis sebelum rename.

### C20. Run script: `sh -n` dan bentuk perintah

- **Severity:** MINOR · **Area:** validasi
- **Bukti:** §3.6 memakai `sh -n`. Run script dengan shebang bash akan divalidasi oleh dash. Pola
  `pm2-runtime start eco` (subcommand) juga belum diuji.
- **Perubahan:** validasi memakai interpreter dari shebang bila ada di `$PREFIX/bin`, dan jatuh ke `sh -n` bila tidak.
  Bila baris memuat `pm2-runtime start`, hasilnya `run_script_unknown`. Di POCO dan template bentuknya
  `pm2-runtime <eco>`, jadi tidak ada kerugian.

### C21. Retensi backup dan kebersihan

- **Severity:** MINOR · **Area:** data
- **Bukti:** F6 menetapkan 10 per file di `<dataDir>/fix-backups`. Cadangan `panel` hanya memuat `panel.db`
  (`backup.manifest.ts:47`), jadi isi ecosystem yang mungkin berisi `env` rahasia tidak terunggah ke R2. Itu benar dan
  perlu dinyatakan eksplisit di Q7 ("tidak ikut cadangan").
- **Perubahan:** Q7 ditulis tegas. Tidak ada perubahan kode.

### C22. Rencana worker terlalu besar untuk lingkup yang dipangkas

- **Severity:** MINOR · **Area:** proses
- **Bukti:** §12 menjadwalkan 11 worker di 5 gelombang, termasuk F4 "per item P2".
- **Perubahan:** lihat §4. Cukup 4 worker dalam 2 gelombang, ditambah dokumen di akhir.

### C23. Item P1 yang sudah tertangani atau jarang terjadi

- **Severity:** MINOR · **Area:** lingkup
- **Bukti:** #14 (situs dikelola tidak ada di pm2) sudah dimuat ulang oleh `restartApp` (`deploy.restart.ts:38-42`).
  Yang kurang hanya tombol dan copy. #13 `site.repair` adalah job baru dengan `ALTER ROLE` irreversible, untuk folder
  situs yang dihapus di luar panel. #7 `apps.json` rusak hanya terjadi bila disunting tangan, karena panel selalu
  menulisnya atomik.
- **Perubahan:** lihat §3.

---

## 3. Lingkup akhir yang direkomendasikan

Target: **"tidak ada langkah teknis manual di alur umum"**. Alur umum di sini adalah memasang panel di HP yang sudah
punya pm2 tulisan tangan (POCO), membuat situs, menambah domain, dan pulih dari pm2 atau postgres yang mati.

### P0 (gelombang ini, wajib)

| Item                                                                 | Catatan                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `writeAtomic` dengan fsync (C1), baca byte (C2)                      | Akar, dipakai semua penulis file                                 |
| Probe sentinel (C3) + `block`/`digests`                              | Menggantikan predikat ganda                                      |
| Fix `ecosystem_block` (#1, #2, #3, #5) dengan C11, C12, C13, C19     | Satu tombol kartu, satu dialog, diff sederhana                   |
| Fix `pm2_auto_exit` (#4), `pending` = ok + info (C6, C14)            | Tanpa restart                                                    |
| Restart pm2 yang dicek + "Kembalikan dan mulai ulang" (C5)           | Satu-satunya jalur yang me-restart makuro-solusi, selalu `confirm` |
| Restore backup terbaru (C9, C17) + `Integration.lastFix`             | Satu UI undo                                                     |
| Bug copy `snippet_current`, copy C16, hapus aturan moot C15          |                                                                  |
| Lab E11 (C4) sebagai gerbang aktivasi                                | Di runtime lab terisolasi                                        |
| Skenario fake `poco` + `old_spread` + `exotic`                       | QA wajib                                                         |

### P1 (gelombang ini, setelah P0)

| Item                                                                             | Alasan dikerjakan sekarang                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| #10/#16/#26 `ServiceStartButton` di semua lokasi "jalankan `sv up`"               | Sering terjadi, murah, endpoint sudah ada                          |
| #14/#15 tombol **Jalankan lagi** (copy + job `site.restart` yang ada)             | Kode inti sudah ada; #15 hanya untuk app yang tidak dikenal pm2    |
| #12 bagian A: kartu record DNS siap salin + **Periksa lagi**                      | Aman, tanpa verifikasi eksternal                                   |
| #12 bagian B: `route dns` lewat cert.pem dengan guard FQDN (C8), **tanpa migrasi** | Hanya setelah output cloudflared diverifikasi di POCO; bila belum, tunda |
| #6 buat folder situs                                                             | Sekitar 10 baris; masuk mekanisme fix yang sama                    |

### Ditunda (dengan alasan)

| Item                                                             | Alasan                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #7 bangun ulang `apps.json`                                      | Hanya rusak bila disunting tangan; blok sudah tahan file rusak (E5). Tambahkan bila muncul di produksi                         |
| #13 `site.repair`                                                | Job baru + `ALTER ROLE` irreversible untuk kasus langka (folder dihapus di luar panel). "Hapus situs + buat ulang" sudah ada    |
| #37 unggah kunci data                                            | Hanya terjadi setelah pindah HP atau kunci hilang. Bila pemilik tetap mau, wajib C7. Kandidat terdepan bila ada waktu           |
| Semua P2 (#8, #9, #11, #17–#20, #27, #28, #31–#33, #38–#41, #43, #45–#48, #51–#54) | Keluarkan dari PLAN/06 ke `PLAN/backlog.md`. Item seperti #9 (pulihkan versi berfungsi) memakai endpoint restore P0, jadi cukup UI kecil nanti. #45/#46/#47/#48/#39 adalah fitur produk, masing-masing butuh PLAN dan debat sendiri. Teks-saja (#27, #28, #31, #32, #38) boleh disapu di gelombang copy P1 bila worker web sedang memegang file itu |

Konsekuensi untuk tipe: `FixKey = "ecosystem_block" | "pm2_auto_exit" | "sites_dir_create"`. `FixFile = "ecosystem" | "pm2_run"`.

## 4. Rencana worker yang diringkas

| Gelombang | Worker                 | File                                                                                                                                                 |
| --------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1        | `wkr-fix-core-01`      | `site.files.ts` (fsync, baca byte), `ecosystem.patch.ts`, `runscript.patch.ts`, `fix.backup.ts`, `ecosystem.probe.ts` (sentinel), fixture + test      |
| G1        | `wkr-fix-adapters-01`  | `system.fake.ts` skenario, `scripts/demo-seed*.ts`                                                                                                   |
| G1        | `wkr-fix-lab-01`       | Lab E11 di POCO (read-only terhadap produksi, PM2_HOME lab), laporan `PLAN/debate/06-pm2-lab-e11.md`                                                  |
| G2        | `wkr-fix-service-01`   | `integration.fix.ts`, `integration.service.ts` (C15, `lastFix`, pending), rute, restart yang dicek (C5), test API                                     |
| G2        | `wkr-fix-web-01`       | `site.setup.tsx`, `fix.dialog.tsx`, `setup.manual.tsx`, `service-start.tsx`, `id.*` yang disentuh, kartu DNS manual                                   |
| Akhir     | `wkr-fix-docs-05`      | README (bagian terkait), CHANGELOG 0.4.0, DECISIONS F1–F9 revisi                                                                                      |

`route dns` (#12B) baru dikerjakan bila verifikasi cloudflared ada. Worker-nya satu orang, pemilik `cloudflared.termux.ts` dan `site.steps.ts`.

## 5. Edit wajib pada PLAN/06

1. **§1 F2:** tambah "kandidat dan backup di-fsync; `writeAtomic` fsync file + direktori" (C1). **F5:** ganti
   `jobs.exclusive()` dengan `assertIdle()` + `backup.busy()` + kunci aksi (C13), dan koreksi klaim waktu (C10).
   **F4:** deteksi pending lewat mtime vs uptime (C14). Tambah **F10:** "Restart pm2 dari panel selalu `confirm`, selalu
   dicek, dan menawarkan kembalikan + mulai ulang" (C5). Tambah **F11:** penggantian `data/secret` oleh pengguna mengubah
   PLAN/04 K8 (C7), bila #37 tetap masuk.
2. **§3.1:** seluruh badan blok di dalam `try`, awalan `;`, `JSON.stringify(prefix)` (C11).
3. **§3.3:** langkah 3 dipecah menjadi `too_large` dan `not_utf8` (decode fatal dari Buffer). Tambah langkah
   `ecosystem_linked` (C12). Blok ditulis dengan EOL file (C2).
4. **§3.4:** sha dari byte. Langkah 6 diganti validasi sentinel (C3). Langkah 10 dihapus, diganti cek sha (C10).
   Tambah pemetaan `ENOSPC`/`EACCES` (C19) dan pembersihan kandidat yatim saat boot (C13).
5. **§3.5:** format id dan resolusi path (C17). Dialog menyebut situs di `apps.json` dan tier `confirm` bila ada (C9).
6. **§3.6:** tabel `pm2_auto_exit`: baris pending → `ok` + `params.pending` (C6). Tombol restart → aksi yang dicek (C5).
   `sh -n` → interpreter shebang, dan `pm2-runtime start` → manual (C20).
7. **§3.7:** probe menambah sentinel `apps.json` lewat `require.cache`. `spreads` = sentinel ada (C3).
8. **§4.2:** revisi copy sesuai C16. Hapus `rolledBack` untuk validasi gagal, ganti `notApplied`. Tambah `disk_full`,
   `not_utf8`, `ecosystem_linked`, `restartCheckFailed(apps)`, `restoreAndRestart`.
9. **§5:** hapus `FixRisk`, batch endpoint, dan `GET /integration/backups`. Tambah `Integration.lastFix`. Persempit
   `FixKey`/`FixFile` (C18).
10. **§6:** hapus 6.3 dan 6.5 (pindah ke backlog). 6.6 tanpa migrasi 0009 dan `dnsSource`, langkah `dns` (bukan
    `dns_ensure`), guard FQDN, verifikasi output terlebih dahulu (C8). 6.7 ditunda, atau bila tetap masuk, ditulis ulang
    sesuai C7.
11. **§7:** pindahkan seluruh tabel P2 ke `PLAN/backlog.md`, sisakan satu kalimat rujukan.
12. **§9:** hapus `RunitAdapter.cmdline`. Fake cukup mtime dan uptime (C14).
13. **§10:** tambah fixture `bom`, `crlf`, `latin1`, `symlink-outside`, `hardlink`, `frozen-apps`. Test spy fsync. Test
    "lupa `...panelApps`" → `spreads` false. Test kunci data `not_mismatch`, file unduhan, `key_partial` (bila #37
    masuk). Hapus test `exclusive`, `apps-json.rebuild`, `site.repair`, `db.migrate 0009`.
14. **§11:** kriteria 1 dipertahankan (pending = ok). Tambah kriteria: "E11 lulus sebelum fix aktif di build termux"
    dan "restart pm2 dari kartu melaporkan app yang tidak kembali".
15. **§12:** ganti dengan tabel §4 di dokumen ini.
16. **§13:** tambah risiko "HP mati sebelum flush" (C1, mitigasi fsync) dan "restart pm2 = pemuatan pertama blok" (C5).
