# PLAN 07 — hasil lab CLI (L5, L6)

Ditulis `wkr-cli-core-01`, 2026-11-27, gerbang G0. Mac lokal (macOS 24.5, arm64), Bun 1.4.2, SQLite bawaan Bun 3.43.2.
Tanpa Docker (C16). Lab L1–L4, L7, L8 butuh Termux (§14) dan belum dijalankan.

## L5 — isolasi `import()` dengan build nyata (D13): **LULUS**

**Cara.** Salinan working tree (tanpa `.git`, `node_modules` di-symlink) di scratchpad. Dua modul penanda ditambahkan
hanya di salinan: baris pertama `src/server/boot.ts` menulis `BOOT_EVAL` ke stderr, baris pertama
`src/server/log.service.ts` menulis `LOG_EVAL` (log.service = modul server dengan efek samping ring buffer yang dimuat
hampir semua modul server). Build dengan `bun scripts/build.ts local <out>` (konfigurasi repo apa adanya: entry
`src/server/main.ts`, `splitting: true`, plugin tailwind, `minify`, loader `.sql`, `compile`). Binary 65,5 MB, build
0,9 dtk. Setiap perintah dijalankan dari folder berisi `.env` lengkap (nilai palsu, `PORT=39999`), HOME kosong,
stdin `</dev/null`.

| Perintah             | Exit | Waktu   | `BOOT_EVAL` | `LOG_EVAL` | Catatan                                         |
| -------------------- | ---- | ------- | ----------- | ---------- | ----------------------------------------------- |
| `-v`                 | 0    | 0,022 s | tidak       | tidak      | `panel-termux 0.4.0 (darwin-arm64, bun 1.4.2)`  |
| `--help`             | 0    | 0,022 s | tidak       | tidak      |                                                 |
| `doctor --help`      | 0    | 0,021 s | tidak       | tidak      |                                                 |
| `env`                | 1    | 0,021 s | tidak       | tidak      | placeholder G1a (perintah belum disambung)      |
| `docs`, `docs paket` | 1    | 0,021 s | tidak       | tidak      | placeholder G1a                                 |
| `rollback`           | 1    | 0,021 s | tidak       | tidak      | placeholder G1a                                 |
| `--bogus`            | 2    | 0,021 s | tidak       | tidak      |                                                 |
| `serve`              | –    | –       | **ya**      | **ya**     | server jalan (dihentikan `timeout 3`, kode 124) |
| tanpa argumen        | –    | –       | **ya**      | **ya**     | stdin bukan TTY → serve (runit, K2)             |

- Run pertama `-v` 0,81 dtk (eksekusi pertama binary baru di macOS); run berikutnya 0,021–0,026 dtk.
- Tidak ada file baru di HOME untuk perintah CLI. `data/` dibuat oleh `serve` saja.
- Jadi splitting tidak menarik chunk server ke entry: jalur CLI hanya mengevaluasi `main.ts`, `env.schema.ts`,
  `env.codec.ts`, dan `src/cli/cli.{main,help,output}.ts` + `package.json`.
- Perintah yang memakai `CliHost` (doctor, rollback) memuat `cli.host.ts` → adapter Termux → `log.service` secara
  dinamis; itu memang jalur server (tanpa `log.info` ke stdout karena CLI tidak memanggil pemilih mode server). L5
  untuk `env`/`docs` setelah G1a: dibuktikan ulang oleh `scripts/cli.test.sh` (W2) dan `tests/cli.imports.test.ts`
  (penelusuran impor statis dari `main.ts`).
- Penjaga yang sama di `bun test`: `tests/cli.args.test.ts` menjalankan `runCli` di proses anak dengan plugin
  `--preload` yang menyisipkan penanda ke `boot.ts` (kontrol positif: impor `boot.ts` mencetak penanda).

## L6 — `new Database(f, { readonly: true })` pada `panel.db` WAL (m14): **dicatat, fallback `:memory:` tetap wajib**

**Cara.** Penulis `bun:sqlite` membuat `panel.db` dengan `journal_mode=WAL` dan baris yang masih di `-wal`
(`wal_autocheckpoint=0`). Pembaca membuka dengan `{ readonly: true }`, `SELECT count(*)`, menutup; isi folder dicatat
sebelum/sesudah.

| Kasus                                                  | Hasil                        | File baru?                    |
| ------------------------------------------------------ | ---------------------------- | ----------------------------- |
| (a) panel hidup (koneksi terbuka, `-wal` + `-shm` ada) | terbaca, baris dari WAL ikut | tidak                         |
| (b) panel di-`kill -9`, `-wal` + `-shm` tersisa        | terbaca                      | tidak                         |
| (b) panel mati, `-wal` ada, **`-shm` tidak ada**       | terbaca                      | **ya: `panel.db-shm` dibuat** |
| (b) panel mati bersih, hanya `panel.db` (header WAL)   | **`SQLITE_CANTOPEN`**        | tidak                         |
| sama, folder read-only                                 | `SQLITE_CANTOPEN`            | tidak                         |
| URI `file:…?mode=ro` (kasus `-shm` tidak ada)          | terbaca                      | ya: `-shm` dibuat             |
| URI `file:…?immutable=1` (semua kasus di atas)         | terbaca                      | tidak                         |

Catatan:

- `Database.close()` Bun 1.4.2 tidak menghapus `-wal`/`-shm` di percobaan ini, jadi kondisi "hanya `panel.db`"
  dibuat dengan checkpoint `TRUNCATE` lalu menghapus kedua file (sama dengan penutupan bersih SQLite biasa). Kondisi
  nyata di POCO setelah `sv down panel` belum dilihat (QA §9.3).
- Akibat untuk K12: `readonly` saja **bisa membuat `panel.db-shm`** (file sampingan, bukan `panel.db`) saat panel mati
  dengan `-wal` tanpa `-shm`, dan **gagal** saat hanya ada `panel.db`. Fallback `:memory:` (PLAN K12) menutup kasus
  gagal. Untuk "doctor tidak menulis file apa pun" ada dua pilihan bagi `wkr-cli-doctor-01`/koordinator:
  1. Terima `-shm` sebagai pengecualian yang dicatat (SQLite membuatnya, isinya indeks WAL, aman).
  2. Buka hanya bila `-shm` ada atau `-wal` tidak ada; selain itu langsung `:memory:`. Rekomendasi: **pilihan 2**,
     karena satu `existsSync` dan janji read-only tetap utuh.
     `immutable=1` tidak direkomendasikan: tanpa locking, sehingga bisa membaca halaman yang sedang ditulis panel hidup.

---

# Fase A di POCO (L4, L8, L2)

Ditulis `wkr-poco-lab-a`, 2026-11-27 ±15:40–15:50 WITA. POCO (`ssh poco`, aarch64, Termux, `LANG=en_US.UTF-8`),
binary `~/panel/panel` = `panel-termux 0.5.0 (android-arm64, bun 1.4.5)`, cloudflared 2026.11.2, postgresql 18.7.
Backup penuh sebelum lab: `/Users/bip/panel-termux-backups/poco-20261127-1529/`. Tanpa Docker. Tidak ada nilai rahasia
yang dicetak (token tunnel hanya dicek ukuran/izin, UUID tunnel disamarkan `<uuid>`).

Catatan ssh: sesi `ssh poco '...'` non-login **tidak** punya `SVDIR`/`LOGDIR` (`echo SVDIR=$SVDIR` → kosong; `sv
status cloudflared` → `fail: cloudflared: unable to change to service directory`). Keduanya diset oleh
`$PREFIX/etc/profile.d/start-services.sh`. Semua perintah `sv`/`apt` di bawah dijalankan dengan
`export SVDIR=$PREFIX/var/service LOGDIR=$PREFIX/var/log`, supaya `prerm` berperilaku sama dengan sesi Termux biasa.
Akibat untuk `init`/doctor: jangan mengandalkan `SVDIR` dari env; pakai path absolut atau set sendiri.

Kondisi awal (semua sehat): `sv status` cloudflared/panel/pm2/postgres/sshd `run`, ssh-agent `down`;
`http://localhost:3200/api/health` 200, `https://solusi.malikkurosaki.com/` 200,
`https://panel.malikkurosaki.com/api/health` 200; `apt-mark showhold` = `cloudflared`, `postgresql`.

## Ringkasan

| Lab | Hasil              | Inti                                                                                                                                                                                                                                                              |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L4  | **LULUS**          | `-v`/`env`/`docs` median 55–61 ms, `doctor` median 1,3–1,4 s; dari `~` dan `$PREFIX/tmp` sama                                                                                                                                                                     |
| L8  | **LULUS sebagian** | hold tercatat di dpkg; format `apt-get -s` stabil dan bisa di-parse; `dpkg --audit` bersih = stdout kosong, rc 0. Hold vs versi baru **belum terbukti** (repo tidak punya versi lebih baru cloudflared/postgresql hari ini). Hold **tidak** menahan `--reinstall` |
| L2  | **LULUS**          | reinstall → tunnel mati (solusi 530), yang tersisa persis `down` (0 byte) + template `--token-file`; template + token file memakai ingress `config.yml` lokal (dua hostname 200). Rekomendasi: **opsi A (run script kita + hold)**                                |

## L4 — waktu perintah di HP: **LULUS**

```sh
# di HP, P=~/panel/panel; t() = date +%s%N sebelum/sesudah, stdout+stderr ke /dev/null
for dir in ~ $PREFIX/tmp; do cd $dir; for c in -v doctor env docs; do 5x t $P $c; done; done
```

| Perintah | dir `~` (ms, 5 run)      | median | dir `$PREFIX/tmp` (ms)   | median | exit |
| -------- | ------------------------ | ------ | ------------------------ | ------ | ---- |
| `-v`     | 51 55 60 58 52           | 55     | 63 58 61 64 60           | 61     | 0    |
| `doctor` | 1406 1290 1750 1242 1515 | 1406   | 1324 1330 1293 2003 1299 | 1324   | 1    |
| `env`    | 57 56 52 52 55           | 55     | 51 63 59 61 58           | 59     | 0    |
| `docs`   | 63 59 52 66 57           | 59     | 53 63 54 55 60           | 55     | 0    |

- `doctor` exit 1 karena satu ❌ nyata di POCO: "Sebelum situs pertama dibuat, panel perlu menghubungkannya ke pm2"
  (plus ⚠️ pm2 bisa berhenti sendiri, ⚠️ token API Cloudflare kosong). Bukan masalah CLI.
- Overhead start binary di HP ±50 ms (Mac 21 ms). `doctor` didominasi pemeriksaan sistem (pm2/curl/subproses), bukan
  start. Tidak ada beda bermakna antara `~` dan folder lain.

## L8 — hold, simulasi apt, `dpkg --audit`: **LULUS sebagian**

```text
$ apt-mark showhold
cloudflared
postgresql
$ dpkg --get-selections cloudflared postgresql
cloudflared					hold
postgresql					hold
$ dpkg --audit; echo rc=$?
rc=0                                   # bersih = stdout kosong, rc 0
```

`apt-get update` lalu (baris 1–4 "NOTE: This is only a simulation! …" dipotong di sini, selalu dicetak `-s` karena
bukan root):

```text
$ apt list --upgradable
runit/stable 2.3.1-1 aarch64 [upgradable from: 2.3.1]
$ apt-get -s upgrade
Calculating upgrade...
The following packages will be upgraded:
  runit
1 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Inst runit [2.3.1] (2.3.1-1 termux-main stable:stable [aarch64])
Conf runit (2.3.1-1 termux-main stable:stable [aarch64])
$ apt-get -s full-upgrade          # = pkg upgrade
The following NEW packages will be installed:
  bzip2-glibc curl-glibc findutils-glibc grep-glibc less-glibc pcre2-glibc
  sed-glibc tar-glibc xz-utils-glibc
The following packages will be upgraded:
  runit
1 upgraded, 9 newly installed, 0 to remove and 0 not upgraded.
Inst bzip2-glibc (1.0.8-3 termux-glibc glibc:glibc [aarch64])
…
Inst runit [2.3.1] (2.3.1-1 termux-main stable:stable [aarch64])
$ apt-cache policy cloudflared postgresql
cloudflared: Installed: 2026.11.2  Candidate: 2026.11.2
postgresql:  Installed: 18.7       Candidate: 18.7
```

Simulasi install:

```text
$ apt-get -s install termux-api
termux-api is already the newest version (0.60.0).
0 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.
$ apt-get -s install jq termux-services
termux-services is already the newest version (0.13-1).
The following NEW packages will be installed:
  jq
0 upgraded, 1 newly installed, 0 to remove and 1 not upgraded.
Inst jq (1.8.2 termux-main stable:stable [aarch64])
Conf jq (1.8.2 termux-main stable:stable [aarch64])
$ apt-get -s install runit                 # paket terpasang yang punya versi baru
Inst runit [2.3.1] (2.3.1-1 termux-main stable:stable [aarch64])
$ apt-get -s install --reinstall cloudflared   # cloudflared sedang di-hold
0 upgraded, 0 newly installed, 1 reinstalled, 0 to remove and 1 not upgraded.
Inst cloudflared [2026.11.2] (2026.11.2 termux-main stable:stable [aarch64])
```

Format untuk parser D9 (jalankan dengan `LC_ALL=C`; POCO memakai `en_US.UTF-8`, jadi teks Inggris, tapi locale lain bisa
menerjemahkan kalimat ringkasan, sedangkan baris `Inst` tidak diterjemahkan):

- Hanya baris `^Inst ` yang dipakai. `Inst <pkg> [<versi terpasang>] (<versi baru> <repo> …)` = paket **terpasang**
  yang akan diganti (upgrade atau reinstall); tanpa `[...]` = paket baru. Regex:
  `^Inst (\S+)(?: \[([^\]]+)\])? \((\S+) `.
- Tidak ada baris `Inst` = tidak ada yang dipasang (mis. `already the newest version`).
- Paket terpasang yang ikut naik = baris `Inst` dengan `[...]`. Daftar tolak D9 (`cloudflared`, `postgresql`,
  `nodejs*`) dicek terhadap nama di baris itu.

Temuan:

1. **Hold versus versi baru tidak bisa dibuktikan hari ini**: candidate = installed untuk keduanya, jadi `upgrade`/
   `full-upgrade` memang tidak menyentuh keduanya karena alasan apa pun. Bukti yang ada: status dpkg `hold`. Ulangi
   L8 saat repo punya versi cloudflared/postgresql yang lebih baru (yang diharapkan: baris
   `The following packages have been kept back:` memuat keduanya, tanpa baris `Inst`).
2. **Hold tidak menahan `--reinstall`** (versi sama): `apt-get -s install --reinstall cloudflared` dengan hold aktif
   tetap merencanakan reinstall, dan reinstall menjalankan `prerm` (lihat L2). `panel docs paket` harus menyebut bahwa
   hold hanya melindungi dari `pkg upgrade`, bukan dari `pkg reinstall`/`pkg install --reinstall`.
3. `pkg upgrade` hari ini akan memasang 9 paket `*-glibc` baru (dari repo glibc) + runit. Tidak berbahaya untuk tunnel,
   tetapi runit = paket runsv/runsvdir; tidak dijalankan di lab ini.

## L2 — reinstall cloudflared dan template paket: **LULUS**, pilih **opsi A**

Penamaan: di laporan ini (sesuai tugas) **A = run script milik kita + hold**, **B = template paket
(`--token-file`)**. PLAN §4.4 langkah 5 saat ini memakai label terbalik (A = token, B = run script kita); koordinator
perlu menyamakan labelnya.

### Isi paket (read-only)

```text
$ grep var/service $PREFIX/var/lib/dpkg/info/cloudflared.list
…/var/service
…/var/service/cloudflared
…/var/service/cloudflared/down
…/var/service/cloudflared/log
…/var/service/cloudflared/run
…/var/service/cloudflared/log/run
$ cat $PREFIX/var/lib/dpkg/info/cloudflared.prerm
#!/data/data/com.termux/files/usr/bin/sh
cd /data/data/com.termux/files/usr
if [ -x "/data/data/com.termux/files/usr/bin/sv" ]; then
sv-disable cloudflared || :
sv down cloudflared || :
fi
rm -rf /data/data/com.termux/files/usr/var/service/cloudflared
$ ls $PREFIX/var/lib/dpkg/info/cloudflared.*
cloudflared.list  cloudflared.md5sums  cloudflared.prerm      # tanpa postinst, tanpa conffiles
```

(`sv-disable` memeriksa `[ -u "$SVDIR" ]`, yaitu bit setuid, bukan "kosong"; tanpa `SVDIR` ia gagal `touch
/cloudflared/down` dan `|| :` menelannya. Hasil akhirnya sama karena `rm -rf`.)

### Backup

```sh
S=$PREFIX/var/service/cloudflared
mkdir -p ~/lab-l2 && chmod 700 ~/lab-l2 && cp -a $S ~/lab-l2/service-orig
```

```text
af96b84c4a0e7537a816061f99d14d0be296b8c38b51ded7569f9f38bb980bf9  ./run   (140 byte, 700, Nov 25 11:59)
log/run -> /data/data/com.termux/files/usr/share/termux-services/svlogger   (symlink)
(tidak ada down)
$ cat run
#!/data/data/com.termux/files/usr/bin/sh
export HOME=/data/data/com.termux/files/home
exec cloudflared tunnel --no-autoupdate run poco 2>&1
```

### Reinstall

```text
before: run: cloudflared: (pid 22971) 67629s; run: log: (pid 10580) 185357s
$ apt-mark unhold cloudflared
Canceled hold on cloudflared.
$ DEBIAN_FRONTEND=noninteractive apt-get install --reinstall -y cloudflared
0 upgraded, 0 newly installed, 1 reinstalled, 0 to remove and 1 not upgraded.
Preparing to unpack .../cloudflared_2026.11.2_aarch64.deb ...
Unpacking cloudflared (2026.11.2) over (2026.11.2) ...
Setting up cloudflared (2026.11.2) ...
rc=0
after: down: cloudflared: 3s; run: log: (pid 9593) 3s
```

Yang ditinggalkan paket di `$PREFIX/var/service/cloudflared`:

```text
-rw-------  0 byte  Nov 24 02:21  down     e3b0c442…b855 (sha256 file kosong)
-rwx------  112 byte Nov 24 02:21 run      500b919fbb464437ebd9ed06b93fc4396e95166fa853275c1f8387267869efce
log/run -> …/share/termux-services/svlogger
supervise/, log/supervise/  (dibuat runsv baru)
$ cat run
#!/data/data/com.termux/files/usr/bin/sh
exec cloudflared tunnel run --token-file $HOME/.cloudflared/token 2>&1
```

- Persis `down` + template + `log/run` (symlink sama). `run` kita diganti template.
- Layanan **mati dan dinonaktifkan**: `sv status` = `down`, file `down` ada, tidak ada proses `cloudflared` (hanya
  `svlogd`). runsvdir memasang runsv baru sendiri (pid log berganti 10580 → 9593).
- `https://solusi.malikkurosaki.com/` → **530** (Cloudflare: origin tunnel tidak terhubung).
- Hold hilang (`apt-mark showhold` = `postgresql` saja) karena di-unhold untuk lab; reinstall sendiri tidak mengubah
  status hold.
- Template **tanpa `--no-autoupdate`**: log menulis `Autoupdate frequency is set autoupdateFreq=86400000`. Binary dari
  paket Termux yang memperbarui diri sendiri = binary di luar dpkg (md5sums tidak cocok, bisa build non-Android).
- Template **tanpa `export HOME`**; jalan di POCO karena runsvdir mewarisi HOME dari sesi Termux.

### Uji opsi B (template paket + token file)

```sh
T=~/.cloudflared/token; [ -e $T ] && exit 1
( umask 077; cloudflared tunnel token poco > $T )   # token tidak pernah dicetak
stat -c '%a %s' $T; grep -c . $T                     # → 600 181 ; 1 baris
rm $SVDIR/cloudflared/down; sv up cloudflared; sleep 12
```

```text
run: cloudflared: (pid 9816) 12s; run: log: (pid 9593) 32s
solusi.malikkurosaki.com 200          # ingress → http://localhost:3005
panel.malikkurosaki.com 200           # ingress → http://localhost:3200
panel /api/health 200
INF Starting tunnel tunnelID=<uuid>
INF Settings: map[cred-file:…/.cloudflared/<uuid>.json credentials-file:…/.cloudflared/<uuid>.json token-file:…/.cloudflared/token]
INF Registered tunnel connection connIndex=0..3 … protocol=quic
$ grep -c "new configuration" $LOGDIR/sv/cloudflared/current
0
```

- `config.yml` lokal **dibaca otomatis** walau run script tidak menyebut `--config` (`credentials-file` dari
  config.yml muncul di `Settings`). Dua hostname dengan port berbeda sama-sama 200, dan tidak ada log `Updated to new
  configuration` (konfigurasi remote) → **ingress lokal dipakai**. Tunnel `poco` dikelola lokal, jadi edge tidak
  mengirim ingress.
- Doctor 0.5.0 dengan template: `⚠️ Run script cloudflared masih template paket` dan `⚠️ cloudflared tidak ditahan
  (apt-mark hold)`. Pemeriksaannya bekerja.

### Pemulihan (dijalankan)

```sh
export SVDIR=$PREFIX/var/service LOGDIR=$PREFIX/var/log; S=$SVDIR/cloudflared
sv down cloudflared
cp -p ~/lab-l2/service-orig/run $S/run      # sha256 af96b84c…0bf9 (sama dengan backup)
rm -f $S/down ~/.cloudflared/token
sv up cloudflared
apt-mark hold cloudflared                    # → cloudflared set on hold.
```

```text
run: …/cloudflared: (pid 10249) 12s; run: log: (pid 9593) 69s
run: panel, pm2, postgres, sshd; down: ssh-agent (sama dengan awal)
cloudflared tunnel --no-autoupdate run poco          # cmdline pid 10249
apt-mark showhold → cloudflared, postgresql ; dpkg --audit → kosong, rc 0
solusi 200 · panel 200 · panel pub /api/health 200 · panel local /api/health 200
doctor: ✅ ditahan · ✅ berjalan · ✅ menyala otomatis · ✅ Run script memakai tunnel lokal
~/.cloudflared: <uuid>.json cert.pem config.yml config.yml.bak-panel-20261126210016 (token sudah dihapus)
```

Downtime tunnel ±1–2 menit total (reinstall ±15:47, template tersambung 15:47:52, pulih ±15:48 setelah ±12 dtk). `~/lab-l2/service-orig`
dibiarkan di HP sebagai cadangan (tanpa rahasia; hapus kapan saja).

### Kesimpulan L2 / Q4: **opsi A (run script kita + hold)**

|                           | A: run script kita + hold                   | B: template paket + `~/.cloudflared/token`                                  |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Ingress lokal             | ya (sekarang)                               | ya (terbukti)                                                               |
| Setelah upgrade/reinstall | pulihkan `run` + hapus `down`               | hapus `down` saja (template = isi yang sama)                                |
| Autoupdate                | `--no-autoupdate`                           | **aktif** (template tanpa flag; bisa mengganti binary dpkg)                 |
| Rahasia di disk           | kredensial `<uuid>.json` saja               | kredensial + **token kedua** (cukup untuk menjalankan tunnel dari mana pun) |
| Kode/doctor yang ada      | cocok (`Run script … memakai tunnel lokal`) | doctor menganggapnya ⚠️                                                     |

B hanya menang satu langkah pemulihan, tetapi menambah satu rahasia dan menyalakan autoupdate. A sudah teruji di
POCO dan sesuai doctor. Maka `init` memakai A: tulis run script server-termux (`export HOME=…`, `exec cloudflared
tunnel --no-autoupdate run <nama> 2>&1`), `apt-mark hold cloudflared postgresql`, hapus `down`, `sv up`. Tidak membuat
token file. PLAN §4.4 langkah 5 dan Q4: ganti ke A dengan label di atas.

### Resep untuk `docs/cli/paket.md`

Hold hanya menahan `pkg upgrade`. `pkg reinstall cloudflared`, `pkg install --reinstall cloudflared`, dan upgrade
setelah `unhold` menjalankan `prerm` paket: layanan dihentikan, folder `$PREFIX/var/service/cloudflared` dihapus, lalu
dipasang lagi dengan file `down` (layanan nonaktif) dan run script template. Semua situs mati sampai dipulihkan.

Upgrade aman (di sesi Termux; lewat ssh tambahkan `export SVDIR=$PREFIX/var/service` dulu):

```sh
cp $PREFIX/var/service/cloudflared/run ~/cloudflared.run.bak   # simpan run script kita
sv down cloudflared
apt-mark unhold cloudflared
pkg install cloudflared                                         # atau pkg upgrade
cp ~/cloudflared.run.bak $PREFIX/var/service/cloudflared/run    # pulihkan run (template paket memakai --token-file)
chmod 700 $PREFIX/var/service/cloudflared/run
rm -f $PREFIX/var/service/cloudflared/down                      # paket memasang down = layanan nonaktif
sv up cloudflared
apt-mark hold cloudflared
sv status cloudflared                                           # harus "run:"
```

Bila cadangan run hilang, tulis ulang isinya (ganti `<nama>` dengan nama tunnel di `~/.cloudflared/config.yml`):

```sh
#!/data/data/com.termux/files/usr/bin/sh
export HOME=/data/data/com.termux/files/home
exec cloudflared tunnel --no-autoupdate run <nama> 2>&1
```

Doctor menandai ketiga gejalanya: `cloudflared tidak ditahan`, `Run script cloudflared masih template paket`, dan file
`down` (D5: error bila `config.yml` ada).

## Catatan G1a — `sshd_config` POCO (langkah 3a, K22, E12)

Dibaca koordinator di POCO (2026-11-27, read-only): `$PREFIX/etc/ssh/sshd_config` di POCO adalah bawaan paket
yang tidak diubah. md5-nya sama dengan conffile openssh 10.6p2, file memuat
`Include /data/data/com.termux/files/usr/etc/ssh/sshd_config.d/*.conf`, dan tidak ada baris `PasswordAuthentication`.
Artinya aturan drop-in langkah ssh (`sshd_config.d/10-key-only.conf` ditulis hanya bila `Include` ada dan tidak ada yang
mengatur `PasswordAuthentication`) berlaku di Termux bersih. Host fake (`cli.host.fake.install.ts`) memasang
`sshd_config` dengan bentuk yang sama saat `pkg install openssh`.
