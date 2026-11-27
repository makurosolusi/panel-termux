# Kritik PLAN/07: CLI di binary dan bootstrap dari Termux kosong

> wkr-cli-debate-01 · 2026-11-27 · HEAD `main` (5e3211f, v0.4.0). Yang dibaca: `PLAN/07-cli-bootstrap.md`,
> `R&D/08-cli-bootstrap.md`, `PLAN/DECISIONS.md`, `PLAN/debate/06-auto-fix-debate.md` (format), `src/server/index.ts`,
> `boot.ts`, `env.ts`, `db/client.ts`, `db/snapshot.ts`, `log.service.ts`, `exec/termux.exec.ts`,
> `system/system.select.ts`, `system/pm2.termux.ts`, `sites/integration.service.ts`, `sites/ecosystem.probe.ts`,
> `sites/fix.planners.ts`, `shared/env.codec.ts`, `scripts/{build.ts,install-release.sh,install-phone.sh,package-release.sh}`,
> `deploy/*`, `.github/workflows/release.yml`, `/Users/bip/test/server-termux/install.sh` + `files/*`.
> Alat: eksperimen `bun build --compile` lokal (Bun 1.4.2, Mac arm64), `objdump` pada `dist/panel-android-arm64`,
> `gh api` (sumber `cloudflare/cloudflared@2026.11.2`), `curl -sI` halaman rilis, dan `ssh poco` **read-only** (hanya
> `cat`/`ls`/`dpkg -s`/`sv status`/`curl /api/health`/`cmd package list`). Binary panel tidak dijalankan di POCO, POCO
> tidak diubah, dan tidak ada nilai rahasia yang dibaca. Docker tidak dipakai dan tidak diusulkan (aturan pemilik).

## 1. Ringkasan penilaian

**Verdict: arah benar, tetapi belum siap diimplementasikan.** Entry tipis, satu skema env, doctor yang memanggil
pemeriksaan UI, dan aturan "hanya isi yang belum ada" sudah tepat. Masalahnya ada lima, dan semuanya bisa merusak HP
produksi atau membocorkan rahasia:

1. **Di HP baru, doctor dan init berjalan dengan adapter fake** (D1). `selectSystem` memilih fake bila `sv` tidak ada,
   padahal di Termux kosong `sv` memang belum ada.
2. **`panel` tanpa argumen tetap menyalakan server**, dan symlink `$PREFIX/bin/panel` membuat perintah itu mudah
   terketik. Panel kedua sempat memigrasi `panel.db` yang sedang dipakai sebelum gagal bind port (D2).
3. **Rahasia `.env` diwariskan ke proses anak.** Termasuk runsvdir yang dinyalakan `init`, sehingga semua layanan dan
   semua app pm2 ikut menerimanya (D3).
4. **`cloudflared tunnel create -o json` mencetak token tunnel ke stdout** (D4). PLAN menangkap stdout itu.
5. **Kedua opsi cloudflared (A/B) tidak tahan upgrade paket**, karena file `down` termasuk isi paket (D5). Ini juga
   berlaku untuk POCO hari ini.

Lingkup terlalu lebar untuk satu rilis. `panel upgrade` menduplikasi `install.sh` → `init`, yang sudah menukar binary
dan me-restart panel. `init.json`, `-v --json`, dan delapan topik docs juga YAGNI.

Jumlah: **5 BLOCKER, 10 MAJOR, 18 MINOR**.

Klaim R&D yang **terverifikasi**: argv sampai utuh ke skrip, termasuk `--help`, `-v`, `--version`, dan `--smol` (Bun
tidak menelan flag apa pun). `.env` dari cwd dimuat. `$VAR` di `.env` diekspansi (sudah ditangani codec B23).
`prerm` cloudflared menghapus `$SVDIR/cloudflared`. `service-daemon` idempoten lewat pidfile. Location
`releases/latest` dipakai. Ada juga temuan baru yang menguntungkan: binary Android hanya bergantung pada bionic sistem
(`NEEDED libc.so libm.so libdl.so`, interp `/system/bin/linker64`), jadi `pkg upgrade` tidak bisa merusak binary panel
yang sedang jalan.

---

## 2. Temuan

### D1. HP baru = mode fake: doctor dan init membaca/mengubah sistem palsu

- **Severity:** BLOCKER · **Area:** kebenaran bootstrap
- **Bukti:** `src/server/system/system.select.ts:39-41`: `existsSync($PREFIX/bin/sv) ? createTermuxSystem() :
  createFakeSystem(...)`. `sv` berasal dari paket `termux-services`, yang belum terpasang di Termux kosong (R&D/08 #4).
  PLAN/07 K13 (baris 34) memakai aturan yang sama untuk CLI. Akibatnya, `panel doctor` di HP baru melaporkan layanan
  fake sebagai "ok", dan `init` langkah 4–8 (`routeDns`, `supervise`) memanggil adapter fake. Adapter dipilih sekali di
  awal, sehingga setelah langkah 2 memasang `termux-services`, sistemnya tetap fake.
- **Perubahan wajib:** Mode CLI = termux bila `$PREFIX/bin/pkg` atau `$PREFIX/bin/apt` ada (atau
  `TERMUX_VERSION` diset; diset di POCO walau lewat ssh). Fake **hanya** dengan `PANEL_CLI_FAKE` eksplisit. Adapter dibuat
  ulang setelah langkah paket. Test: host "Termux tanpa `sv`" → `doctor` melaporkan `pkg_termux_services` error, bukan
  layanan ok.

### D2. `panel` tanpa argumen menyalakan panel kedua yang memigrasi DB hidup sebelum gagal bind

- **Severity:** BLOCKER · **Area:** integritas data produksi
- **Bukti:** `boot.ts:58-115` menjalankan urutan secret → `openDb` → `snapshotOnBoot` → `runMigrations` → tulis
  `panel_version` → `syncSuperAdminsOnBoot` → `pruneAudit` → `recordAudit("panel.start")` → `ensureAppsJson` →
  `monitor.start()`/`backup.startScheduler()`, dan baru setelah itu `servePanel` (bind). Tidak ada penjaga instance
  (`grep` pidfile/EADDRINUSE: tidak ada). PLAN K2 mempertahankan "argumen kosong = serve", sedangkan Q3 menambah symlink
  `$PREFIX/bin/panel`. Hampir semua CLI mencetak bantuan bila dipanggil tanpa argumen, jadi pengguna akan mengetik
  `panel` di `~/panel` (cwd ber-`.env`). Kasus terburuk: binary **baru** (`~/panel-src/<v>/panel-android-arm64` atau
  `panel.new`) dijalankan tanpa argumen saat versi lama melayani. Migrasi maju berjalan di bawah proses lama yang
  skemanya berbeda, lalu snapshot dirotasi (`SNAPSHOT_KEEP = 3`, `snapshot.ts:10`).
- **Perubahan wajib:**
  1. Penjaga instance di awal `bootPanel`, **sebelum** `loadOrCreateSecret`/`openDb`: `GET
     http://127.0.0.1:<PORT>/api/health` (timeout 1 dtk). Bila menjawab → `log.error("panel sudah berjalan di port …")`,
     exit 1. `ponytail:` race dua start bersamaan masih terbuka; upgrade ke pidfile + cek `/proc/<pid>/exe` bila
     terjadi. Penjaga ini juga melindungi binary < 0.5.0 yang tidak bisa diubah, selama binary barunya yang start kedua.
  2. `panel` tanpa argumen **dan stdin TTY** → bantuan singkat + "untuk menjalankan server: `panel serve`", exit 2.
     runit tidak punya TTY (`run` = `exec ./panel`, stdin bukan terminal), jadi jalur produksi tidak berubah.
     `bun --hot src/server/index.ts` (dev) juga tidak tersentuh.
  3. Test shell: binary di folder ber-`.env` lengkap + server palsu yang menjawab `/api/health` di PORT → exit 1,
     `data/panel.db` tidak dibuat.

### D3. Rahasia `.env` bocor ke semua proses anak, termasuk runsvdir → semua layanan → semua app pm2

- **Severity:** BLOCKER · **Area:** rahasia (Rule 7)
- **Bukti:**
  - Eksperimen: binary di cwd ber-`.env` menerima variabelnya di `process.env` (variabel shell menang atas `.env`).
  - `exec/termux.exec.ts:70`: `env: opts.env ?? process.env`. Default ini juga dipakai `pm2.termux.ts:127` dan adapter
    lain. PLAN §7.2 memakai `runTermux` untuk semua exec CLI.
  - `$PREFIX/bin/service-daemon` (POCO): `start-stop-daemon -S -b -m -p $PIDFILE -x $DAEMON -d $PREFIX -- $SVDIR`. Env
    tidak dibersihkan, jadi runsvdir mewarisi env `init`. Semua `run` script lalu mewarisi env runsvdir, termasuk pm2
    (`deploy/pm2/run` hanya meng-export HOME/PATH/PM2_HOME) dan app situs.
  - `install.sh` di-`exec` dari cwd pengguna. Rerun yang umum adalah `cd ~/panel && ./panel init`, yang memuat
    `GOOGLE_CLIENT_SECRET`. `npm install -g pm2` menjalankan lifecycle script dari registry dengan env itu.
  - K11 hanya mengatur sisi _baca_ ("abaikan `process.env`"), bukan pewarisan.
- **Perubahan wajib:** Satu baris di awal cabang CLI `main.ts`, sebelum `import()` apa pun: `for (const v of ENV_VARS)
  delete process.env[v.name]`. Akar masalahnya satu tempat, jadi semua adapter ikut aman. Ini bukan allowlist, karena
  `am` (termux-open-url, termux-wake-lock) butuh `BOOTCLASSPATH`/`ANDROID_*` dan termux-exec butuh `LD_PRELOAD`.
  `service-daemon start` dipanggil dengan stdio `ignore`, serta `SVDIR`+`LOGDIR` eksplisit (lihat m4). Test: perekam
  exec fake menerima env tanpa satu pun kunci `ENV_VARS` padahal cwd berisi `.env` lengkap. Lab L7 di HP: cek
  `/proc/<pid runsvdir>/environ`.

### D4. `cloudflared tunnel create -o json` mencetak token tunnel

- **Severity:** BLOCKER · **Area:** rahasia
- **Bukti:** cloudflared 2026.11.2 `subcommand_context.go:149-190`: `tunnel, err := client.CreateTunnel(...)` lalu
  `renderOutput(outputFormat, &tunnel)`. `cfapi/tunnel.go:47-50`: ``type TunnelWithToken struct { Tunnel; Token string
  `json:"token"` }``, dan `CreateTunnel` mengembalikan `*TunnelWithToken`. Token itu cukup untuk menjalankan tunnel
  milik pengguna. PLAN §4.4 langkah 2 dan R&D #17 memakai `tunnel create -o json`, sedangkan `runTermux` menampung
  stdout sebagai string. Pola pesan error Rule 11 ("menyebut penyebab") cenderung menempelkan stdout/stderr.
  `tunnel token` (opsi A) juga mencetak token ke stdout (`subcommands.go:864-900`).
- **Perubahan wajib:** `tunnel create <nama>` **tanpa** `-o`. Id diambil dari `tunnel list -n <nama> -o json` (pola
  server-termux `install.sh:78-80`, tanpa rahasia), lalu cek `~/.cloudflared/<id>.json` ada. Bila opsi A dipakai:
  `tunnel token --cred-file` tidak cocok (menulis JSON, bukan token). Proses di-spawn dengan stdout = fd file 600 yang
  dibuka `O_CREAT|O_EXCL`, tidak pernah lewat pipe/string. Aturan di §4.5: "stdout/stderr cloudflared tidak pernah
  dicetak atau dimasukkan pesan error; hanya kode keluar + baris yang lolos `redactLines`".

### D5. cloudflared: opsi A dan B sama-sama mati setelah upgrade paket, dan POCO terpapar hari ini

- **Severity:** BLOCKER (desain langkah tunnel, Q4) · **Area:** ketersediaan makuro-solusi
- **Bukti (POCO, read-only):** `cloudflared.prerm` = `sv-disable; sv down; rm -rf $PREFIX/var/service/cloudflared`.
  `cloudflared.list:15,17` memuat `var/service/cloudflared/down` dan `.../run`. Paket tidak punya `conffiles` dan
  `postinst`. Setiap `pkg upgrade`/`pkg reinstall cloudflared` menghasilkan: tunnel berhenti, `down` terpasang lagi, dan
  `run` diganti template. R&D §5.3 menilai opsi A "tahan upgrade kecuali `down`", padahal `down` saja sudah berarti
  semua situs mati sampai ada orang yang menjalankan `sv-enable`. Watchdog `ensure-services` server-termux menghapus
  `sshd/down` untuk alasan yang sama, tetapi tidak menangani cloudflared. POCO: `run` = `exec cloudflared tunnel
  --no-autoupdate run poco`, versi 2026.11.2, tidak ada hold (`apt-mark showhold` kosong).
- **Perubahan wajib:**
  1. **Native dulu (rung 4):** `init` di HP baru menjalankan `apt-mark hold cloudflared postgresql` setelah memasang
     keduanya, dan mencetak satu baris alasan. `pkg upgrade` = `apt full-upgrade` (POCO `$PREFIX/bin/pkg:423`) yang
     menghormati hold. Doctor `pkg_held` = warning bila tidak di-hold. `panel docs paket` memuat resep upgrade aman:
     `sv down` → `apt-mark unhold` → `pkg install` → pulihkan `run` → hapus `down` → `sv up` → `hold`.
  2. Opsi A/B tetap ada setelah L2, tetapi Q4 harus menulis bahwa **keduanya** butuh langkah pemulihan setelah upgrade.
     Doctor `cloudflared_down_file` naik menjadi **error** bila `config.yml` ada.
  3. Opsi C (dicatat, bukan 0.5.0): layanan milik panel di folder yang tidak dikenal dpkg (mis. `$SVDIR/tunnel`).
     Biayanya mengganti nama `"cloudflared"` di `site.steps.ts:21`, `monitor.service.ts:27`, `panel.service.ts:235`,
     `job.runner.ts:20`, `overview.problems.ts:227`, plus migrasi POCO.
  4. Laporan ke pemilik (bukan aksi worker): untuk POCO, `apt-mark hold cloudflared postgresql` sekarang. Ini keputusan
     pemilik dan tidak dijalankan oleh debat ini.

### D6. Snippet `/dev/tty` di `install.sh` gagal di ssh/CI tanpa terminal

- **Severity:** MAJOR · **Area:** bootstrap
- **Bukti:** PLAN §8.1: `if [ -t 0 ] || [ ! -r /dev/tty ]; then exec "$BIN" init; else exec … </dev/tty; fi`. Di POCO
  lewat `ssh poco '…'`: `[ -r /dev/tty ]` → benar, `( : </dev/tty )` → `No such device or address`, rc 1. `-r` hanya
  memeriksa izin. Redirect gagal sebelum `exec`, jadi sh keluar dengan kode miliknya sendiri, bukan 3, dan kontrak exit
  rusak.
- **Perubahan wajib:** `if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$BIN" init "$@" </dev/tty; else exec
  "$BIN" init "$@"; fi`. Test `install-release.test.sh` dijalankan tanpa TTY.

### D7. Placeholder dari `.env.example` 0.3/0.4 dianggap "sudah diisi"

- **Severity:** MAJOR · **Area:** kebenaran init/doctor
- **Bukti:** `.env.example` sekarang berisi `APP_BASE_URL=https://panel.example.com` dan
  `SUPER_ADMIN_EMAILS=you@example.com`. `install-phone.sh:90-91` menyalinnya ke `.env`, dan pemeriksaan
  `install-phone.sh:106` menerima keduanya sebagai terisi. HP yang berhenti di exit 3 (Google belum diisi) punya `.env`
  dengan dua placeholder itu. PLAN §4.1 langkah 5: "nilai yang ada tidak pernah ditanya ulang". Akibatnya `init` hanya
  menanyakan Google, lalu panel menyala di `panel.example.com` dan login Google gagal dengan redirect yang salah.
- **Perubahan wajib:** `ENV_VARS[*].placeholders` berisi nilai contoh lama yang dihitung **kosong** oleh `env_complete`
  dan prompt `init`. Test: `.env` = `.env.example` 0.4.0 → `init` menanyakan keempatnya.

### D8. Bun juga memuat `.env.local`, `.env.development`, `.env.production` dari cwd

- **Severity:** MAJOR · **Area:** doctor ≠ yang dilihat server
- **Bukti (eksperimen binary):** dengan `.env` + `.env.local` + `.env.development` + `.env.production` di cwd, binary
  memuat `.env.local` (prioritas tertinggi) dan `.env.development`, karena `NODE_ENV` runtime = `development` bila tidak
  diset. `define` di `build.ts:23` hanya mengganti teks kode, tidak mengubah pemilihan file. Kunci duplikat: yang
  terakhir menang. `--no-compile-autoload-dotenv` + `execArgv: ["--env-file=.env"]` **tidak** memuat apa pun (diuji),
  jadi autoload tidak bisa diganti lewat build. Doctor (K11) hanya membaca `~/panel/.env`, sehingga `env_valid` bisa
  hijau sementara server membaca nilai lain.
- **Perubahan wajib:** doctor `env_extra_files` (warning): ada `~/panel/.env.{local,development,production,test}` atau
  `.env.*.local`, dengan saran "gabungkan ke .env". Dicatat di K11.

### D9. "Pasang hanya yang hilang" tetap bisa meng-upgrade paket terpasang, dan dpkg yang terputus tidak ditangani

- **Severity:** MAJOR · **Area:** HP yang sudah jalan
- **Bukti:** `apt install X` menaikkan dependensi yang sudah terpasang bila versi X menuntutnya (R&D §3.1 "diterima").
  Di POCO ini bisa berarti `libc++`/`openssl` di bawah postgres/cloudflared yang hidup, atau lebih buruk lagi paket
  dengan `prerm` seperti cloudflared. Ctrl-C (SIGINT ke seluruh foreground process group) membunuh apt/dpkg di tengah
  unpack, sehingga rerun mendapat "dpkg was interrupted, you must manually run 'dpkg --configure -a'". PLAN §2.2 kode 130
  menjanjikan "konsisten (tulis atomik)", yang tidak berlaku untuk dpkg. Flag untuk `pkg upgrade` di HP baru juga tidak
  ditulis (§4.1 langkah 2 hanya untuk `install`). Lock dpkg sudah ditunggu apt (`Binary::apt::DPkg::Lock::Timeout
  "120"`, POCO), jadi bagian itu bukan masalah.
- **Perubahan wajib:**
  1. HP yang sudah jalan: `apt-get -s install <hilang>` (simulasi, read-only) dulu. Bila ada paket **terpasang** yang
     akan di-upgrade → tampilkan daftar dan minta konfirmasi TTY. Tolak bila daftar itu memuat `cloudflared`,
     `postgresql`, `nodejs*` (exit 3 + perintah manual).
  2. Langkah paket diawali `dpkg --audit`. Bila tidak kosong: HP baru → `dpkg --configure -a` dengan
     `--force-confdef --force-confold`; HP lama → exit 3 dengan perintahnya.
  3. `pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold` dengan
     `DEBIAN_FRONTEND=noninteractive` (sama dengan install).
  4. Selama pkg/npm berjalan, CLI mengabaikan SIGINT pertama ("menunggu pkg selesai; Ctrl-C lagi untuk memaksa") dan
     tidak me-`kill` anak. §2.2 ditulis jujur.

### D10. `init` menyunting `config.yml` sementara job situs panel bisa menyuntingnya juga

- **Severity:** MAJOR · **Area:** lost update
- **Bukti:** R&D §5.2: lock job/fix (`withLock("integration")`, `jobs.assertIdle`) hanya ada di dalam proses panel.
  PLAN §4.1 langkah 8 "di HP yang sudah jalan: hanya menambah rute panel bila belum ada (dengan konfirmasi)" memakai
  `ingressStep` (tmp + rename) dari proses lain. Job situs yang berjalan bersamaan menimpa salah satu hasilnya. K6
  melarang fix integrasi saat panel `run`, tetapi `config.yml` tidak disebut.
- **Perubahan wajib:** CLI menulis `config.yml` hanya bila layanan `panel` **tidak** `run`. Bila `run` → tampilkan baris
  ingress persis + "tambahkan lewat Situs → Domain" atau `sv down panel` lalu rerun. Masuk tabel §4.5.

### D11. PostgreSQL mayor: di Termux, `pg_upgrade` tidak mungkin dan doctor buta

- **Severity:** MAJOR · **Area:** data situs
- **Bukti:** POCO `PG_VERSION` = 18, `postgres --version` = 18.7. Repo Termux hanya membawa satu `postgresql`, tanpa
  paket versi lama, sehingga `pg_upgrade` (yang butuh binary lama) tidak bisa dijalankan setelah upgrade mayor. Jalan
  satu-satunya adalah `pg_dumpall` **sebelum** upgrade. PLAN K7 hanya mencegah `init` meng-upgrade; `pkg upgrade` manual
  pengguna tetap mematikan postgres.
- **Perubahan wajib:** hold (D5.1). Doctor `postgres_major` (error): mayor `PG_VERSION` ≠ mayor `postgres --version`,
  dengan saran `panel docs paket` (resep dump → initdb baru → restore). Semua pemeriksaan read-only.

### D12. `upgrade` menduplikasi `install.sh`, tidak membuktikan asal, dan bisa menimpa versi baik terakhir

- **Severity:** MAJOR · **Area:** lingkup + rollback
- **Bukti:**
  - Setelah K14, `sh install.sh` = unduh + SHA + `exec panel init`, dan init langkah 1 + 10 sudah menukar binary
    (`panel.prev`) lalu me-restart. `panel upgrade` mengulang hal yang sama di TypeScript (`release.fetch.ts`,
    `upgrade.command.ts`).
  - `SHA256SUMS` diunduh dari asal yang sama dengan tarball, jadi hanya membuktikan integritas, bukan asal. Attestation
    Sigstore ada (`release.yml`, `actions/attest`), tetapi `gh` tidak ada di HP. Pesan `install-release.sh:56` menyuruh
    `gh attestation verify`.
  - §5.1 langkah 7: `panel` → `panel.prev` tanpa syarat. Upgrade kedua setelah upgrade yang gagal-sehat menimpa
    `panel.prev` dengan binary rusak.
  - Hitungan ruang "3 × tarball" (tarball 50 MB, rilis v0.4.0) mengabaikan ekstrak 118 MB + `panel.new` 118 MB + margin
    snapshot boot (`install-phone.sh:74`: 2 × `panel.db` + 256 MB).
  - §5.1 mengklaim Location → v0.3.0; sekarang v0.4.0 (basi, tidak berbahaya).
- **Perubahan wajib:** `upgrade` **ditunda** dari 0.5.0. README: upgrade = jalankan `install.sh` lagi (`PANEL_VERSION=vX`
  untuk versi tertentu). `rollback` (tanpa jaringan) tetap di 0.5.0. Aturan langkah 1 init/rollback: `panel` lama
  disalin ke `panel.prev` **hanya** bila panel sekarang sehat (`/api/health` versi = binary terpasang). Bila tidak, `prev`
  dibiarkan. Ruang memakai rumus `install-phone.sh` + ukuran binary. Saat `upgrade` dibangun nanti: tanda tangan Ed25519
  atas `SHA256SUMS` dengan kunci publik ter-embed (`node:crypto` `verify`, tanpa dependency), ditambah cek
  `detectRuntime` (`deploy/elf.runtime.ts`) sebelum binary baru dieksekusi.

### D13. Isolasi `import()` belum diuji dengan konfigurasi build yang sebenarnya

- **Severity:** MAJOR · **Area:** asumsi K1
- **Bukti:** R&D temuan 4 diuji dengan build sederhana. `scripts/build.ts:11-24` memakai `splitting: true`, plugin
  tailwind, `minify`, `loader .sql`. Dengan splitting, chunk server bisa ditarik ke entry, sehingga `-v` ikut
  mengevaluasi efek samping modul (`log.service` ring, `PROCESS_BOOT_ID`, monitor `WeakMap`). Klaim "< 0,5 dtk" dan
  "tidak bind" bergantung pada hal ini.
- **Perubahan wajib:** Lab L5 sebelum P0 dibekukan: `bun scripts/build.ts local` dengan `main.ts`, modul penanda
  (efek samping menulis ke stderr) di `boot.ts`. `panel -v` tidak boleh mencetak penanda. Test shell §9.2 memuat
  pemeriksaan ini.

### D14. `runTermux` tidak cocok untuk langkah init

- **Severity:** MAJOR · **Area:** desain `CliHost.exec`
- **Bukti:** `termux.exec.ts:6,71-74`: timeout bawaan 10 dtk, `stdin: "ignore"`, stdout/stderr ditampung. `pkg
  upgrade/install` butuh 10–20 menit dan progres terlihat. `cloudflared tunnel login` butuh stdio terlihat sekaligus URL
  yang diambil untuk `termux-open-url`. PLAN §7.1 `CliHost.exec (runTermux)` dan §4.4 "stdio diwariskan" saling
  bertentangan.
- **Perubahan wajib:** `CliHost` punya dua bentuk: `exec` (pakai `runTermux`, untuk probe pendek) dan `run` (stdio
  `inherit`, tanpa timeout, kode keluar saja). Untuk `tunnel login`: stdout di-pipe, setiap baris diteruskan ke terminal
  dan URL pertama diambil. Login tidak mencetak rahasia (URL login sekali pakai).

### D15. Log server mengotori stdout CLI

- **Severity:** MAJOR · **Area:** kontrak `--json`
- **Bukti:** `system.select.ts:42` `log.info("[panel] system adapters: …")` → `log.service.ts:17` `console.log`. Doctor
  memanggil `selectSystem` (K13), jadi `doctor --json | jq` gagal di baris pertama. Ini melanggar §2.3 "stdout hanya
  data".
- **Perubahan wajib:** CLI tidak memakai `selectSystem`. Ia memanggil `createTermuxSystem()`/`createFakeSystem()`
  langsung (D1 sudah menuntut deteksi sendiri). Test: `doctor --json` di-parse tanpa pemangkasan.

### Minor

| #   | Temuan                                                                                                                                                                                                                                                   | Perubahan                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| m1  | `TERMUX_APP_PACKAGE_MANAGER` **tidak diset** di POCO lewat ssh, padahal `pkg_manager_apt` (§3.1) membacanya                                                                                                                                              | apt = `$PREFIX/bin/apt` ada; pacman hanya bila env = `pacman` **dan** `$PREFIX/bin/pacman` ada                                    |
| m2  | Termux:Boot/Termux:API **bisa** dideteksi: `cmd package list packages` di POCO (Android 16) mencetak `com.termux.boot`, `com.termux.api`. R&D #1 menulis "tak terdeteksi"                                                                                | Doctor `app_termux_boot`/`app_termux_api` (timeout 5 dtk; gagal → info)                                                           |
| m3  | Termux dari Play Store (paket rusak) tidak dicek                                                                                                                                                                                                         | Doctor: `TERMUX_APK_RELEASE=GOOGLE_PLAY_STORE` → error dengan saran F-Droid/GitHub                                                |
| m4  | Skrip boot §4.1 langkah 9 hanya meng-export `SVDIR`. `svlogger` (POCO) = `mkdir -p "$LOGDIR/sv/$service"`, sehingga tanpa `LOGDIR` semua log mati                                                                                                        | Skrip boot dan panggilan init: `SVDIR` **dan** `LOGDIR`                                                                           |
| m5  | `service-daemon start` keluar 1 bila sudah jalan (`start-stop-daemon -S` tanpa `-o`, `set -e`)                                                                                                                                                           | Cek pidfile + `kill -0` dulu; exit 1 dengan runsvdir hidup = ok                                                                   |
| m6  | `init.json` YAGNI: nama tunnel bisa diturunkan dari host di `.env` (Q7) atau `--tunnel`; `waitingFor` = tidak ada `cert.pem`                                                                                                                             | Hapus `init.json`; §4.2 = "tanpa file state"                                                                                      |
| m7  | Lock basi "pid mati" rentan pid reuse Android                                                                                                                                                                                                            | Basi bila pid mati **atau** `/proc/<pid>/cmdline` tidak memuat `init`                                                             |
| m8  | Pesan "→ jalankan: panel init" sebelum symlink ada (install.sh menjalankan binary dari `~/panel-src`)                                                                                                                                                    | Cetak perintah yang benar-benar bisa dipakai: `panel` bila `$PREFIX/bin/panel` → kita, selain itu `~/panel/panel`                 |
| m9  | `--yes` tanpa TTY melewati restart lalu exit 0, sehingga skrip mengira panel sudah versi baru                                                                                                                                                            | Exit 3 + "panel masih versi lama; jalankan `sv restart panel`"                                                                    |
| m10 | `panel env >> .env` menambah kunci kosong di akhir; kunci terakhir menang (eksperimen + `findEnvLine` sama), jadi konfigurasi hidup dikosongkan                                                                                                          | `fstat(1)` = inode `.env` dan ukuran > 0 (mode append) → **jangan tulis**, exit 1 + saran `> .env.new`                            |
| m11 | `termux-wake-lock` pertama memunculkan dialog Android "abaikan optimasi baterai"                                                                                                                                                                         | Satu baris di rencana: "HP akan menanyakan izin baterai: pilih Izinkan"                                                           |
| m12 | `~/panel-src/<versi>` (≈ 50 MB tarball + 118 MB ekstrak) tidak pernah dipangkas                                                                                                                                                                          | `install.sh`/init: hapus selain versi sekarang + sebelumnya                                                                       |
| m13 | `rollback` tanpa `--db` menjalankan binary lama di atas skema yang sudah dimigrasi maju                                                                                                                                                                  | Bila nama snapshot terbaru menyebut versi = `panel.prev`, cetak "database sudah dimigrasi oleh vX; bila panel lama error: `--db`" |
| m14 | Doctor membuka `panel.db` read-only di WAL: saat panel mati, `-shm` belum ada dan perilaku SQLite (gagal/membuat file) belum dicek                                                                                                                       | Lab L6; fallback `:memory:` bila gagal, tanpa membuat file                                                                        |
| m15 | `--skip tunnel` tetap menanyakan "Alamat panel"                                                                                                                                                                                                          | Dengan `--skip tunnel`: `APP_BASE_URL=http://localhost:<PORT>` tanpa prompt                                                       |
| m16 | `-v --json` dan delapan topik docs tanpa konsumen                                                                                                                                                                                                        | Hapus `-v --json`; docs 4 topik: `google`, `cloudflare`, `android`, `paket` (+ `masalah` bila ada isinya)                         |
| m17 | Tabel pemakaian ulang §7.2 melewatkan `deploy/elf.runtime.ts` (`detectRuntime`: aarch64/bionic)                                                                                                                                                          | Tambahkan (init langkah 1, rollback, nanti upgrade)                                                                               |
| m18 | Catatan saja: `BUN_OPTIONS` di env menyuntik flag runtime (eksperimen: `execArgv` = isi variabel), dan `BUN_BE_BUN=1` membuat binary bertindak sebagai `bun`. Bukan batas keamanan (pengguna yang sama), tetapi menjelaskan perilaku aneh di laporan bug | Satu baris di `panel docs masalah`                                                                                                |

Hal yang diserang dan **lolos**: Bun tidak menelan `-h/-v/--help/--version` (eksperimen). `pkg upgrade` tidak bisa
merusak binary panel (NEEDED hanya bionic sistem). Kontrak exit 0/1/3 kompatibel. Prompt rahasia tanpa flag argv sudah
benar (K10). `panel env` tidak membaca isi `.env` (K18). Deteksi skrip boot POCO (`start-services` → `ensure-services`)
cocok dengan aturan langkah 9. Aktivasi termux-services tanpa membuka ulang Termux memakai jalur yang persis sama dengan
`start-services.sh` (`start-stop-daemon -b`), jadi risikonya setara dengan hari ini. L1 tetap diperlukan untuk
memastikannya, bukan karena ada risiko baru.

---

## 3. Lingkup akhir yang direkomendasikan

### P0 — 0.5.0 (tanpa mengubah HP)

- `main.ts` entry tipis + pembersihan env CLI (D3) + **penjaga instance di `bootPanel`** dan aturan TTY (D2).
  `panel serve` dipertahankan, karena dibutuhkan D2.
- `-h/--help/--h`, `-v/--version/--v` (tanpa `--json`).
- `doctor` + `--json`, deteksi mode sendiri (D1, D15), pemeriksaan baru: `pkg_held`, `postgres_major`,
  `env_extra_files`, `cloudflared_down_file` (error), `app_termux_boot/api`, placeholder (D7).
- `env` / `--env` (+ m10), skema `ENV_VARS` (K17).
- `docs` 4 topik.
- `rollback` (swap + `--db`), dengan aturan `panel.prev` dari D12.

### P1 — 0.5.0 hanya bila L1–L3, L7 lulus di HP kedua; selain itu 0.5.1

- `init` HP baru: penuh (paket + hold, runit, postgres, `.env`, tunnel tanpa `-o json`, boot, nyalakan).
- `init` HP yang sudah jalan: binary + folder layanan panel + mengisi `.env` yang kosong/placeholder + restart dengan
  konfirmasi. **Tidak** menyentuh `config.yml` saat panel `run` (D10). Paket hanya lewat simulasi (D9).
- `install.sh` tipis dengan snippet tty yang benar (D6).

### Ditunda

| Item                          | Alasan                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| `panel upgrade`               | `install.sh` → `init` sudah melakukannya; tunggu tanda tangan Ed25519 (D12) |
| Opsi C layanan tunnel sendiri | Ganti nama di 5 file + migrasi POCO; hold (D5) cukup untuk sekarang         |
| `init.json`, `-v --json`      | Tidak ada konsumen (m6, m16)                                                |
| Access lewat API, watchdog    | Sama dengan PLAN Q1                                                         |

---

## 4. Lab wajib sebelum implementasi

Tanpa Docker. "HP kedua" = HP atau emulator Android arm64 yang disediakan pemilik, berisi Termux F-Droid yang baru
dipasang. **POCO hanya read-only**, dan binary panel tidak pernah dijalankan dengan argumen di sana sebelum D2 terkirim.

| #   | Pertanyaan                                                                                                                                                                | Di mana                                                  | Fase     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------- |
| L1  | `service-daemon start` dari proses `init` (env bersih, stdio ignore): runsvdir hidup setelah sesi Termux ditutup/dibuka dan setelah layar mati 30 menit dengan wake-lock? | HP kedua                                                 | P1       |
| L2  | `tunnel run --token-file` (template paket) + `config.yml` lokal: ingress lokal dipakai? Plus `apt reinstall cloudflared` → yang tersisa persis `down` + template          | HP kedua (tunnel uji milik pemilik)                      | P1       |
| L3  | Termux baru: `curl`/`tar`/`sha256sum` ada? `pkg upgrade -y` + dpkg confold tanpa TTY lulus tanpa prompt? Ctrl-C di tengah → `dpkg --audit` → `--configure -a` pulih?      | HP kedua                                                 | P1       |
| L4  | Waktu `panel -v`/`doctor`/`env` di HP                                                                                                                                     | HP kedua; POCO setelah D2, dari folder lain, dengan izin | P0 akhir |
| L5  | Build nyata (`scripts/build.ts`, splitting + tailwind) dengan `main.ts`: modul penanda di `boot.ts` tidak dievaluasi untuk `-v`/`env`/`docs` (D13)                        | Mac lokal                                                | P0 awal  |
| L6  | `new Database(f, { readonly: true })` pada `panel.db` WAL: (a) panel hidup, (b) panel mati tanpa `-shm`. Tidak ada file baru yang dibuat? (m14)                           | Mac lokal                                                | P0       |
| L7  | `/proc/<pid>/environ` runsvdir dan pm2-runtime setelah `init` dari `~/panel` tidak memuat kunci `ENV_VARS` (D3)                                                           | HP kedua                                                 | P1       |
| L8  | `apt-mark hold cloudflared postgresql`: `pkg upgrade` mempertahankan keduanya; `apt-get -s install termux-api` mencetak daftar upgrade yang bisa di-parse (D5, D9)        | HP kedua (simulasi `-s` boleh di POCO, read-only)        | P1       |

Strategi test yang realistis: CI (ubuntu) menjalankan unit test + `cli.test.sh` dengan host fake (`PANEL_CLI_FAKE`). Itu
membuktikan argv, D2, D3 (perekam env), D4 (tidak ada `-o json` di perekam), m10, dan skenario `poco` byte demi byte.
Langkah yang benar-benar menyentuh Termux (`pkg`, runit, Termux:Boot, `am`) **tidak bisa** dibuktikan di CI, jadi
kriteria §9.3 tetap "HP kedua dari F-Droid". Bila pemilik tidak menyediakan HP kedua, P1 tidak dirilis di 0.5.0.

---

## 5. Edit wajib pada PLAN/07

1. **§1 K2:** tambah penjaga instance di `bootPanel` + aturan "tanpa argumen + TTY = bantuan, exit 2" (D2). Ubah
   §0, §2.1 (`panel` di TTY), §9.1 `cli.args.test.ts`, §11.
2. **§1 K11 → K11a/K11b:** baca `.env` secara eksplisit (tetap) **dan** hapus kunci `ENV_VARS` dari `process.env` di
   cabang CLI sebelum `import()` (D3). Catat `.env.local/.development` (D8).
3. **§1 K13:** deteksi termux = `$PREFIX/bin/pkg`|`apt`|`TERMUX_VERSION`; fake hanya `PANEL_CLI_FAKE`. CLI memakai
   `createTermuxSystem`/`createFakeSystem` langsung dan membuat ulang adapter setelah langkah paket (D1, D15).
4. **§1 K7 + §4.1 langkah 2:** simulasi `apt-get -s`, `dpkg --audit`, flag `pkg upgrade`, `apt-mark hold`, SIGINT saat
   pkg (D5, D9). Perbaiki janji kode 130 di §2.2.
5. **§3.1:** tambah `pkg_held`, `postgres_major`, `env_extra_files`, `app_termux_boot`, `app_termux_api`,
   `termux_source`. `cloudflared_down_file` → error bila `config.yml` ada. `pkg_manager_apt` dari file, bukan env (m1–m3).
6. **§4.1 langkah 5 + §4.3:** placeholder lama = kosong (D7). `--skip tunnel` tanpa prompt alamat (m15).
7. **§4.1 langkah 8 + §4.5:** tidak menulis `config.yml` saat panel `run` (D10). Output cloudflared tidak pernah
   dicetak (D4).
8. **§4.1 langkah 9:** `SVDIR` + `LOGDIR`, dialog baterai (m4, m11). Langkah 3: `service-daemon` exit 1 = ok bila hidup
   (m5).
9. **§4.2:** hapus `init.json`; lock basi via `/proc/<pid>/cmdline` (m6, m7).
10. **§4.4 langkah 2 & 5:** `tunnel create` tanpa `-o json`; id dari `tunnel list -n -o json`; token opsi A lewat fd
    file 600 (D4). Langkah 5: kedua opsi butuh pemulihan setelah upgrade + hold (D5).
11. **§5:** `upgrade` dipindah ke backlog. `rollback` tetap, dengan aturan `panel.prev` hanya dari binary sehat dan
    peringatan skema (D12, m13). Hapus klaim "Location → v0.3.0".
12. **§6.1:** 4 topik (+ `paket`). **§6.2:** aturan append (m10).
13. **§7.1:** `CliHost.exec` + `CliHost.run` (D14); hapus `release.fetch.ts`/`upgrade.command.ts` dari 0.5.0. **§7.2:**
    tambah `elf.runtime.ts` (m17).
14. **§8.1:** snippet `/dev/tty` diganti (D6); pangkas `~/panel-src` (m12).
15. **§9:** test baru untuk D1 (Termux tanpa `sv`), D2 (health palsu di PORT → exit 1), D3 (perekam env), D4 (argv
    perekam tanpa `-o`), D7, m10. §9.3 + §10 `wkr-lab-cli-01` memuat L1–L8 dengan lokasi dari §4 dokumen ini, tanpa
    Docker.
16. **§12 Risiko + §13:** Q4 ditulis ulang (D5); Q9 menjadi "pemilik memutuskan `apt-mark hold` di POCO sekarang". Tambah
    risiko "panel kedua memigrasi DB" (D2) dan "token di stdout cloudflared" (D4).
17. **R&D/08:** koreksi #1 (aplikasi Termux bisa dideteksi, m2), §5.3 (opsi A tidak tahan upgrade), §3.3 (`create -o
    json` = token). Tambah temuan NEEDED bionic.
