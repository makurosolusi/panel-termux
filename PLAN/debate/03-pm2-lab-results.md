# PLAN 03 §8.1: hasil lab pm2 di POCO (gelombang 0)

Tanggal: 2026-11-26, pukul 22:40 sampai 22:55 WITA. Worker: `wkr-pm2lab-01`. Rancangan eksperimen ada di
`PLAN/03-sites-lifecycle.md` §8.1.

**Versi yang dipakai:** pm2 **7.1.2** (`$PREFIX/lib/node_modules/pm2/package.json`), node **v24.22.3** (Termux).
pm2-runtime dijalankan sama persis seperti run script produksi, yaitu
`node $PREFIX/lib/node_modules/pm2/bin/pm2-runtime <ecosystem>`. Binary uji dibuat dengan Bun 1.4.2
`--compile`, dua target: `bun-linux-arm64-android` (native, linker `/system/bin/linker64`) dan `bun-linux-arm64`
(glibc, dijalankan lewat `grun`).

## Isolasi & bukti produksi tidak tersentuh

- `PM2_HOME=$HOME/pm2lab/home`. Semua panggilan pm2 lewat wrapper `~/pm2lab/lab.sh`. Wrapper itu mengekspor
  `PM2_HOME` lab, mencetak `[lab PM2_HOME=…]`, lalu `exit 99` bila nilainya tidak cocok. Panggilan gaya `runTermux`
  (E2) memakai `env PM2_HOME=… sh -c '[ "$PM2_HOME" = … ] && node $PREFIX/bin/pm2 …'`. Selama lab **tidak ada satu
  pun** perintah pm2 ke `~/.pm2` produksi.
- Folder lab ada di `~/pm2lab/sites`, di luar `~/sites`, sehingga loop "bunuh app yatim" di run script `pm2` produksi
  tidak ikut terlibat. Layanan runit sekali pakai `$PREFIX/var/service/pm2lab` dibuat dengan file `down` lebih dulu
  agar runsvdir tidak menyalakannya otomatis. Log layanan ditulis `svlogd -tt` ke `~/pm2lab/svlog`. Run script:

  ```sh
  export PM2_HOME=$HOME/pm2lab/home
  FLAGS=$(cat $HOME/pm2lab/flags 2>/dev/null)     # "" atau "--no-auto-exit"
  echo "pm2lab-start epoch=$(date +%s) flags=[$FLAGS]"
  exec 2>&1
  exec node $PREFIX/lib/node_modules/pm2/bin/pm2-runtime $FLAGS $HOME/pm2lab/sites/ecosystem.config.js
  ```

- `ecosystem.config.js` lab berisi snippet §3.6 apa adanya, ditambah satu app tulisan tangan `hand` (skrip node HTTP
  dengan shebang, `interpreter: none`, port 19001). Port uji yang dipakai: 19001–19099.
- Hanya `sv status` yang dipakai untuk produksi:

  | Waktu   | pm2                    | cloudflared         | postgres               | panel              | `https://solusi.malikkurosaki.com/` |
  | ------- | ---------------------- | ------------------- | ---------------------- | ------------------ | ----------------------------------- |
  | sebelum | pid 10596, 123.732 dtk | pid 22971, 6004 dtk | pid 10595, 123.732 dtk | pid 4561, 1726 dtk | 200                                 |
  | sesudah | pid 10596, 124.576 dtk | pid 22971, 6848 dtk | pid 10595, 124.576 dtk | pid 4561, 2570 dtk | 200                                 |

  PID tidak berubah dan uptime bertambah 844 dtk secara kontinu, jadi tidak ada layanan produksi yang restart.
- Bongkar: `sv down pm2lab`, `lab.sh kill` ("PM2 Daemon Stopped", daemon lab), `sv exit pm2lab/log`,
  `sv exit pm2lab`, `rm -rf $PREFIX/var/service/pm2lab ~/pm2lab`. Port 19001–19099 bebas. Scan `/proc/*/cmdline`
  tidak menemukan proses `pm2lab` (selain shell ssh pemeriksa itu sendiri).

Catatan sampingan: setiap start, pm2 7.1.2 di Termux mencetak `PM2 error: Error while calling "getconf CLK_TCK"`
dan `getconf PAGESIZE` (`getconf: not found`), plus `[pidusage] couldn't find uptime`. Pesan ini tidak fatal, tetapi
membuat log pm2 penuh "error" palsu. Parser log panel atau ringkasan kesehatan yang menghitung baris `PM2 error`
**harus mengabaikan** baris ini.

---

## E1: entri `apps.json` dengan script yang tidak ada

**Hipotesis:** sama dengan lab lokal, yaitu pm2-runtime menghentikan semua app lalu keluar.

**Perintah:** `apps.json = [{"name":"ghost","cwd":"…/sites/ghost","script":"./app","interpreter":"none"}]`,
kemudian `sv up pm2lab`. Selama 30 dtk diambil sampel `sv status` dan `curl 127.0.0.1:19001` tiap 5 dtk, dan jumlah
`pm2lab-start` dihitung selama 60 dtk. Varian:
(a) cwd ada; (b) cwd tidak ada; (c) cwd tidak ada + `--no-auto-exit`; (d) cwd ada + `--no-auto-exit`.

**Hasil (dipangkas):**

```
14:44:21.62 PM2 log: App [hand:0] starting in -fork mode-
14:44:21.65 PM2 log: App [hand:0] online
14:44:21.66 PM2 error: Error: Script not found: …/pm2lab/sites/ghost/app
14:44:21.70 PM2 log: Stopping app:hand id:0
14:44:21.74 PM2 log: App [hand:0] exited with code [0] via signal [SIGINT]
14:44:21.94 PM2 log: PM2 successfully stopped
14:44:22.01 pm2lab-start …            ← runsv langsung menyalakan lagi
```

| Varian                              | Start pm2-runtime | `hand` dari luar (curl, 6 sampel) |
| ----------------------------------- | ----------------- | --------------------------------- |
| (a) cwd ada                         | **54 per 60 dtk** | DOWN 6/6                          |
| (b) cwd tidak ada                   | 18 per 20 dtk     | –                                 |
| (c) cwd tidak ada, `--no-auto-exit` | 17 per 20 dtk     | –                                 |
| (d) cwd ada, `--no-auto-exit`       | 17 per 20 dtk     | –                                 |

`hand` sempat berstatus "online" selama ±50 ms di setiap siklus, tetapi tidak pernah melayani request.

**Tambahan E1e (pengaman kedua):** filter pada snippet ditambah
`&& require("fs").existsSync(require("path").resolve(a.cwd || __dirname, a.script || ""))`. Dengan
`apps.json = [ghost(native, hilang), blog2(ada)]`, hasilnya 1 start, `hand online`, `blog2 online`, dan ghost dilewati.

**Tambahan E1f (penting, bentuk entri produksi):** entri `ghostgrun` dengan `script: $PREFIX/bin/grun`,
`args: "./app"`, dan `./app` tidak ada. Selama 30 dtk tercatat **1 start**, `hand online`, `blog2 online`, dan
`ghostgrun waiting restart` (crash loop app itu saja). pm2 hanya memeriksa keberadaan `script`. Karena `grun` ada,
entri itu tidak merobohkan runtime. Yang merobohkan runtime hanya entri **native** (`script: ./app`).

**Kesimpulan:** perilakunya **sama dengan lokal**, bahkan lebih parah: runtime keluar lalu runsv me-restart terus
sekitar 54 kali per menit, sehingga semua situs di daemon itu mati total. `--no-auto-exit` tidak menolong, dan ada
atau tidaknya cwd tidak berpengaruh.

**Keputusan PLAN-03:** baris tabel "E1 = sama dengan lokal" berlaku.

- **D5 tetap wajib.**
- Check `apps_entries_runnable` = **error/danger**.
- README memberi peringatan.
- Filter `existsSync` di snippet **dinaikkan dari "direkomendasikan" menjadi wajib** (sudah terbukti bekerja di
  pm2-runtime nyata, E1e).
- Revisi detail: filter cukup memeriksa `script`. Untuk entri `grun` filter itu tidak menyaring apa-apa (karena
  `grun` ada), tetapi entri grun memang tidak merobohkan runtime (E1f). Karena itu `apps_entries_runnable` tetap
  perlu memeriksa `cwd/args[0]` untuk entri grun dan melaporkannya sebagai "app ini akan crash loop" (cukup
  warning, tidak perlu danger).
- Teks snippet §3.6 dan tabel uji §3.6 perlu diperbarui.

## E2: `pm2 start eco --only blog` dari CLI saat pm2-runtime berjalan

**Hipotesis:** app masuk ke daemon runtime yang sama dan dimuat lagi setelah restart.

**Perintah:** `apps.json=[]` → `sv up` → (hanya `hand`) → tulis `apps.json` berisi `blog` (19010) dan `blog2`
(19011), keduanya binary Bun native → `lab.sh start $S/ecosystem.config.js --only blog` → gaya `runTermux`:
`env PM2_HOME=… $PREFIX/bin/node $PREFIX/bin/pm2 start … --only blog2` → `sv restart pm2lab`.

**Hasil:**

```
[PM2][WARN] Applications blog not running, starting...   [PM2] App [blog] launched
[PM2][WARN] Applications blog2 not running, starting...  [PM2] App [blog2] launched
hand online pid=26286 | blog online pid=26346 | blog2 online pid=26366
proses dengan PM2_HOME lab: hanya pid 26270 (pm2-runtime); tidak ada God Daemon kedua
-- sv restart pm2lab --
hand online pid=26517 | blog online pid=26518 | blog2 online pid=26524   (tidak ganda, ketiganya curl OK)
```

**Kesimpulan:** app **masuk ke daemon yang sama** (CLI tersambung ke `rpc.sock` milik runtime) dan **kembali**
setelah runtime restart tanpa duplikat. Jalur `$PREFIX/bin/node $PREFIX/bin/pm2` berperilaku identik.

**Keputusan PLAN-03:** baris "E2 = masuk daemon yang sama dan kembali setelah restart" berlaku, sehingga desain
`pm2 start eco --only` **dipertahankan**. Check `pm2_home_match` tidak diperlukan sebagai mitigasi E2, walaupun
adapter tetap harus memakai `PM2_HOME` yang sama dengan run script.

## E3: `start --only blog` setelah `script` di `apps.json` diganti (native → grun)

**Hipotesis:** script lama tetap dipakai.

**Perintah:** `blog/app` diganti binary glibc. Entri `blog` diubah menjadi
`script: $PREFIX/bin/grun, args: "./app"`, lalu `lab.sh start … --only blog`. Setelah itu `lab.sh delete blog` +
`start --only blog`.

**Hasil:**

```
[PM2] Applying action restartProcessId on app [blog](ids: [ 1 ])  ✓
blog online restarts=1 pid=undefined script=…/sites/blog/app   args=["./app"]   curl: DOWN
-- delete + start --
blog online restarts=0 pid=26710 script=$PREFIX/bin/grun        curl: hello … pid=26710
```

**Kesimpulan:** perilakunya **sama dengan lokal**. `start --only` pada app yang sudah ada hanya menjalankan
`restartProcessId`. Field `args` ikut diperbarui, tetapi `script`/`pm_exec_path` **tetap yang lama**. Akibatnya
lebih buruk dari sekadar "masih versi lama": binary glibc di-exec sebagai native, gagal, dan pm2 melaporkan
`online` dengan `pid=undefined` sementara port mati. Delete + start memakai script baru.

**Keputusan PLAN-03:** baris "E3 = script lama dipertahankan" berlaku, sehingga **delete+start saat runtime/entri
berubah dipertahankan**, dan restart biasa dipakai bila runtime sama.

- Tambahan: cek kesehatan setelah deploy tidak boleh percaya pada status `online` pm2 saja. Status itu harus
  digabung dengan `pid` yang valid dan probe port/HTTP, karena E3 menunjukkan `online` bisa muncul dengan
  `pid=undefined`.

## E4: 0 app online / ecosystem 0 app

**Hipotesis:** runtime keluar sekitar 8 dtk setelah app terakhir dihapus. `--no-auto-exit` menahan kasus "hapus
semua", tetapi tidak menahan kasus "start dengan 0 app".

**Perintah:** runtime berisi `hand`, `blog`, `blog2` → `lab.sh delete all`, lalu PID runtime dipantau tiap detik
selama 40 dtk, dengan dan tanpa flag. Kemudian ecosystem dibuat tanpa `hand`, `apps.json=[]`, dan `sv up` dijalankan
selama 20 dtk, dengan dan tanpa flag.

**Hasil:**

| Kasus                         | Tanpa flag                                                                               | `--no-auto-exit`                           |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| delete all saat runtime jalan | `0 application online, retry = 3` → runtime **keluar ±8 dtk**, runsv start ulang         | runtime **tetap hidup** ≥ 40 dtk           |
| ecosystem 0 app saat start    | `PM2 error: 0 application started (no apps to run …)` → keluar seketika, 13 start/20 dtk | **sama**: keluar seketika, 13 start/20 dtk |

Catatan: setelah runtime keluar dan di-restart runsv, semua app ecosystem (`hand`, `blog`, `blog2`) dimuat lagi.
Artinya `delete` lewat CLI tidak permanen bagi app yang masih ada di ecosystem/`apps.json`. Pada E3b (hapus `blog`
saja sementara app lain online) runtime tidak keluar.

**Kesimpulan:** perilakunya sama dengan lokal. `--no-auto-exit` **bekerja di 7.1.2** untuk kasus "app terakhir
dihapus/berhenti", tetapi **tidak** untuk kasus ecosystem kosong saat start.

**Keputusan PLAN-03:** baris "E4 = runtime keluar saat 0 app online" berlaku.

- Delete+start dilakukan berurutan langsung (jeda < 2 dtk, di bawah ambang ±8 dtk).
- Check warning `pm2_single_app` beserta saran "Tambahkan `--no-auto-exit` di run script pm2" **sah**, karena flag
  terbukti bekerja di 7.1.2. Ini menjadi dependensi installer PLAN/05.
- Untuk ecosystem tanpa app sama sekali, flag tidak menolong. Installer/README perlu satu app penjaga, atau panel
  tidak boleh membiarkan ecosystem kosong. Ini hanya relevan untuk HP baru tanpa situs.

## E5: snippet §3.6 pada pm2-runtime nyata

**Hipotesis:** `hand` selalu online dan stderr berisi `[ecosystem] apps.json dilewati`.

**Perintah:** untuk setiap kondisi `apps.json` dijalankan `sv up pm2lab`, tunggu 7 dtk, `ls`, cek svlog, lalu
`sv down`.

| `apps.json`             | start | app online  | stderr (muncul sebagai `PM2 error:` di log runtime)                         |
| ----------------------- | ----- | ----------- | --------------------------------------------------------------------------- |
| tidak ada               | 1     | hand        | `[ecosystem] apps.json dilewati: Cannot find module './apps.json'`          |
| file kosong             | 1     | hand        | `[ecosystem] apps.json dilewati: …/apps.json: Unexpected end of JSON input` |
| JSON rusak `[{"name":`  | 1     | hand        | `… Unexpected end of JSON input`                                            |
| objek `{"name":"x"}`    | 1     | hand        | (tidak ada, sesuai desain: bukan array → `[]`)                              |
| `[null, blog2]`         | 1     | hand, blog2 | (tidak ada)                                                                 |
| `apps.json` = direktori | 1     | hand        | `[ecosystem] apps.json dilewati: Cannot find module './apps.json'`          |

**Kesimpulan:** **lulus** di pm2-runtime 7.1.2. Snippet layak dirilis. Pesan stderr ecosystem tercatat di log
runit pm2 dengan prefiks `PM2 error:`.

**Keputusan PLAN-03:** baris E5 tidak berlaku (snippet tidak gagal). Hanya revisi E1 yang perlu diterapkan
(filter `existsSync`). E1e membuktikan varian snippet dengan filter juga lulus di runtime nyata.

## E6: binary Bun membaca `.env`, dengan restart vs tanpa restart

**Hipotesis:** env baru hanya terbaca setelah restart.

**Perintah:** `.env` `FOO=one` ditulis untuk `blog` (glibc/grun) dan `blog2` (native) setelah app sudah jalan →
curl → `lab.sh restart` → curl → `.env` diubah menjadi `FOO=two` → curl → `restart` → curl. Tambahan E6b: `.env`
`PORT=19099`, sementara env pm2 berisi `PORT=19010`.

**Hasil:**

```
.env ditulis setelah start:   glibc FOO=unset | native FOO=unset
setelah restart:              glibc FOO=one   | native FOO=one
.env diubah, tanpa restart:   glibc FOO=one   | native FOO=one
setelah restart:              glibc FOO=two   | native FOO=two
E6b: 19010 = hello (jalan), 19099 = DOWN  → env pm2 mengalahkan .env
```

**Kesimpulan:** binary Bun hasil `--compile` (kedua target) memuat `.env` dari cwd **hanya saat start**. Semantik
`restartPending` sudah benar.

**Keputusan PLAN-03:** baris E6 tidak berlaku, jadi `restartPending` **dipertahankan**.

- Temuan tambahan E6b: variabel yang juga diset di `env` pm2 (`apps.json`) **mengalahkan** `.env`. Bila panel
  menaruh `PORT` di entri `apps.json`, mengubah `PORT` di editor `.env` tidak berpengaruh, dan editor harus
  menandainya (misalnya "diatur oleh panel"). Ini juga relevan untuk adopsi `makuro-solusi`, yang PORT-nya hanya ada
  di `.env` (R&D-03 §2.11).

## E7: nama file ecosystem tanpa `.config.js`

**Hipotesis:** `eco2.js` dijalankan sebagai skrip aplikasi.

**Perintah:** `lab.sh start $S/eco2.js --only x` vs `lab.sh start $S/eco2.config.js --only x` (isi kedua file sama,
yaitu app `x` di port 19020).

**Hasil:**

```
eco2.js:        [PM2] Starting …/sites/eco2.js in fork_mode → app "eco2" online, script=eco2.js; 19020 DOWN
eco2.config.js: Applications x not running, starting… → app "x" online; 19020 = "x pid=29910"
```

**Kesimpulan:** perilakunya sama dengan lokal. Untuk `eco2.js`, `--only x` diabaikan dan file dijalankan sebagai
skrip. Hasilnya app "eco2" yang selalu "online" (node hanya mengevaluasi `module.exports` lalu keluar).

**Keputusan PLAN-03:** dikonfirmasi. Adapter wajib memakai nama file yang cocok dengan pola `*.config.js` (atau
`.json`/`.yml`). Bila path ecosystem dari setting tidak cocok pola, integrasi harus menolaknya dengan error, karena
kalau tidak pm2 diam-diam membuat app sampah.

---

## Ringkasan perubahan PLAN yang disarankan

1. §3.6 snippet: tambah filter `existsSync(path.resolve(a.cwd || __dirname, a.script || ""))` (wajib, E1/E1e) dan
   perbarui tabel uji. D5 tetap berlaku.
2. `apps_entries_runnable`: entri native yang script-nya hilang = danger (merobohkan semua situs). Entri grun dengan
   `args[0]` hilang = warning (crash loop app itu saja, E1f).
3. Cek kesehatan deploy: jangan percaya status `online` saja. Wajib ada `pid` valid + probe port (E3).
4. `pm2_single_app` + saran `--no-auto-exit` sah untuk 7.1.2. Untuk ecosystem kosong saat start tetap perlu app
   penjaga, atau ecosystem tidak boleh kosong (E4).
5. Editor variabel lingkungan: kunci yang juga ada di `env` entri pm2 menang atas `.env`, jadi perlu ditandai (E6b).
6. Parser log/kesehatan: abaikan `getconf CLK_TCK/PAGESIZE` dan `[pidusage]` yang dicetak pm2 7.1.2 di Termux.

---

## Eksperimen lanjutan E9, E10, E4b

Tanggal: 2026-11-26, pukul 23:00 sampai 23:27 WITA. Isolasinya sama dengan gelombang 0: wrapper `lab.sh`
(`PM2_HOME=$HOME/pm2lab/home`, abort bila tidak cocok), layanan `pm2lab` dibuat dengan `down` lebih dulu, semua file di
`~/pm2lab`, dan tidak ada perintah pm2 ke `~/.pm2`. Versinya juga sama: pm2 7.1.2 dan node v24.22.3.

| Waktu   | pm2                    | cloudflared         | postgres               | panel              | solusi |
| ------- | ---------------------- | ------------------- | ---------------------- | ------------------ | ------ |
| sebelum | pid 10596, 126.017 dtk | pid 22971, 8289 dtk | pid 10595, 126.017 dtk | pid 4561, 4011 dtk | 200    |
| sesudah | pid 10596, 126.510 dtk | pid 22971, 8782 dtk | pid 10595, 126.510 dtk | pid 4561, 4504 dtk | 200    |

Bongkar: `sv down`, `lab.sh kill` ("PM2 Daemon Stopped"), `sv exit pm2lab/log`, `sv exit pm2lab`, lalu
`rm -rf $PREFIX/var/service/pm2lab ~/pm2lab`. Port 19000–19099 bebas. Scan `/proc` hanya menemukan satu proses
`pm2-logrotate` dengan path `~/.pm2/modules/…`, yaitu pid 11669 dengan ppid 10596 (pm2-runtime **produksi**) dan
umur 35 jam. Itu modul milik produksi, bukan sisa lab, dan tidak disentuh.

### E9: hardlink di data aplikasi Termux

**Hipotesis:** Android menolak `link(2)` di `/data/data/com.termux`.

**Perintah dan hasil** (semuanya di `~/pm2lab`, filesystem yang sama dengan `~/sites`, yaitu `stat %d` = 65091 dan
`/dev/block/dm-67`):

```
ln a b                          → ln: failed to create hard link 'b' => 'a': Permission denied (rc=1)
ln site/app site/app.prev       → Permission denied
ln site/app other/app.x         → Permission denied (antar subfolder)
node fs.linkSync(...)           → EACCES, errno -13
tar xf arsip berisi hardlink    → ln: … Permission denied (rc=1)
cp --reflink=always big big.r   → cp: failed to clone … Permission denied
cp 89 MB + sync                 → 314 ms
mv (rename) 89 MB               → 36 ms; rename menimpa app → OK, inode baru
```

**Kesimpulan:** hardlink **tidak bisa** dibuat sama sekali, baik di satu folder maupun antar subfolder, dengan
errno **`EACCES` (-13)**. Penyebabnya kemungkinan kebijakan SELinux Android untuk `app_data_file`; `getenforce` tidak
tersedia sehingga tidak bisa dipastikan. Reflink juga ditolak. `rename` berjalan normal.

**Keputusan PLAN-03 (tabel §8.1, baris E9):** `link` ditolak, sehingga fallback `copyFile` **menjadi jalur utama**.
Biayanya sekitar 0,3 dtk dan 89 MB tulis per deploy di POCO, cukup murah. Desain urutan swap tetap. Kode harus
menganggap `EACCES` dari `link` sebagai normal (bukan error) dan `params.linked` akan selalu `false` di Termux.
Saran: langsung `copyFile` tanpa mencoba `link` dulu, atau tetap mencoba lalu menangkap `EACCES`/`EPERM`.

### E10: app penjaga `pm2-guard` (`sleep infinity`)

**Hipotesis:** penjaga menahan pm2-runtime tetap hidup ketika hanya penjaga yang ada.

`sleep` di Termux adalah **GNU coreutils 9.12** (`$PREFIX/bin/sleep -> coreutils`), jadi `sleep infinity` didukung.
Ecosystem: snippet dengan filter `existsSync`, ditambah
`{ name: "pm2-guard", script: "$PREFIX/bin/sleep", args: "infinity", interpreter: "none", autorestart: true }`.
Setiap kasus diamati 60 dtk.

| flag             | `apps.json` | PID runtime 3 dtk → 60 dtk | start | pm2-guard                       |
| ---------------- | ----------- | -------------------------- | ----- | ------------------------------- |
| –                | `[]`        | 4972 → 4972                | 1     | online, restarts=0, RSS ±6,3 MB |
| –                | hilang      | 5224 → 5224                | 1     | online, restarts=0, RSS ±6,0 MB |
| `--no-auto-exit` | `[]`        | 5404 → 5404                | 1     | online, restarts=0, RSS ±6,1 MB |
| `--no-auto-exit` | hilang      | 5629 → 5629                | 1     | online, restarts=0, RSS ±6,0 MB |

Tambahan:

- E10b: `kill -9` pid penjaga → pm2 langsung menyalakannya lagi (`restarts=1`), dan runtime tetap hidup.
- E10c: `lab.sh stop pm2-guard` tanpa flag (penjaga adalah satu-satunya app) → runtime **keluar** (pid 6024 → 6200).
  runsv menyalakannya lagi dan penjaga kembali online dari ecosystem.

**Kesimpulan:** penjaga bekerja di keempat kombinasi, dengan biaya sekitar 6 MB RSS. Satu catatan: penjaga yang
di-`stop`/`delete` secara manual tetap memicu auto-exit, kecuali run script memakai `--no-auto-exit`.

**Keputusan PLAN-03 (baris E10):** desain D31 dipertahankan. `args: "infinity"` tidak perlu diganti dengan angka,
dan penjaga skrip node tidak diperlukan. `--no-auto-exit` tetap dipasang bersama penjaga, karena flag itu yang
menutup kasus E10c.

### E4b: ecosystem 0 app dengan modul `pm2-logrotate` terpasang

**Perintah:** runtime lab berjalan dengan penjaga → `lab.sh install pm2-logrotate`. Hasilnya rc=0 dalam 8 dtk
("Module successfully installed and launched", modul di `~/pm2lab/home/modules`, RSS ±66 MB). Setelah itu
ecosystem diganti menjadi 0 app, `apps.json=[]`, lalu `sv up` selama 25 dtk, dengan dan tanpa flag.

```
PM2 log: Launching in no daemon mode
PM2 log: App [pm2-logrotate:0] starting in -fork mode-
PM2 log: App [pm2-logrotate:0] online
PM2 error: 0 application started (no apps to run on …/ecosystem.config.js)
```

| Kasus                                                            | Hasil                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| ecosystem 0 app + modul, tanpa flag                              | modul sempat online, runtime tetap keluar, **15 start/25 dtk** |
| ecosystem 0 app + modul, `--no-auto-exit`                        | sama, **15 start/25 dtk**                                      |
| E4b2: ecosystem penjaga + modul, `delete pm2-guard` (tanpa flag) | runtime **keluar** (7786 → 7925) walaupun logrotate online     |

**Kesimpulan:** modul **tidak** menahan pm2-runtime. Modul tidak dihitung sebagai app untuk kasus "0 application
started" maupun untuk auto-exit "0 application online".

**Keputusan PLAN-03 (baris E4b):** cukup dicatat. Penjaga tetap wajib, dan check `pm2_guard` tidak boleh menganggap
modul sebagai "app selain milik panel". Ini sudah sesuai dengan §3.7, yang menggolongkan `pmx_module` sebagai
`module`.

---

## E11: blok bertanda PLAN/06 §3.1 pada pm2-runtime nyata (gerbang C4)

Tanggal: 2026-11-27, pukul 07:34 sampai 07:52 WITA. Worker: `wkr-pm2lab-e11`. Tujuan: membuktikan bahwa blok v1 yang
ditempel di **akhir** `ecosystem.config.js` (memodifikasi `module.exports` setelah file dievaluasi) dimuat dengan benar
oleh pm2-runtime 7.1.2, sesuai gerbang C4 di `PLAN/debate/06-auto-fix-debate.md`.

**Lingkungan POCO:** node **v24.22.3**, pm2 **7.1.2**. `/data` = **f2fs** (`/dev/block/dm-67`, opsi termasuk
`fsync_mode=nobarrier`, `lazytime`, `inline_data`; `mount` tidak ada di PATH Termux, dibaca dari `/proc/mounts` dan
`/system/bin/mount`).

### Metode

- **Isolasi:** semua file di `~/pm2lab-e11`, `PM2_HOME=~/pm2lab-e11/home`. Semua panggilan pm2 lewat wrapper
  `lab.sh` yang mengekspor `PM2_HOME` lab sebelum `exec node …/pm2/bin/pm2`. Layanan runit sekali pakai
  `$PREFIX/var/service/pm2lab-e11` dibuat di folder sementara dengan file `down` lebih dulu, lalu di-`mv` masuk, jadi
  runsvdir tidak menyalakannya otomatis. Run script lab sama dengan run script `pm2` produksi (tanpa loop app yatim):
  `exec node $PREFIX/lib/node_modules/pm2/bin/pm2-runtime $FLAGS ~/pm2lab-e11/sites/ecosystem.config.js`, dengan
  `FLAGS` = `""` atau `--no-auto-exit`. Log `svlogd -tt`. Tidak ada satu pun perintah pm2 ke `~/.pm2`.
- **Bentuk ecosystem POCO** dibaca dengan skrip node yang hanya mencetak bentuk: 28 baris, 0 `require`, 0 sebutan
  `apps.json`, 1 factory (fungsi/arrow), 3 komentar, `module.exports = { apps: [...] }` dengan 2 app (`makuro-solusi`,
  `adminneo`), kunci app `args, cwd, exp_backoff_restart_delay, interpreter, name, script`, `script` absolut,
  `interpreter: none`, tanpa `env`. `~/sites/apps.json` = `[]`. Isi file dan nilai tidak dicetak.
- **Ecosystem lab** meniru bentuk itu: factory `site(name, port)` → `{ name, cwd, script: "$PREFIX/bin/node",
  args: "./server.js <port>", interpreter: "none", exp_backoff_restart_delay: 1000 }`, `module.exports = { apps: [
  site("e11-hand-a", 19101), site("e11-hand-b", 19102) ] }` dengan komentar, lalu blok di akhir file. Varian E11d:
  `module.exports = { apps: [] }` + blok.
- **Entri `apps.json`** berbentuk `panelAppEntry` (`script: "./run"`, `interpreter: "none"`): `e11-blog` (`./run` ada,
  skrip sh yang `exec node ./server.js 19110`), `e11-blog2` (sama, port 19111), `e11-ghost` (cwd ada, `./run` tidak
  ada = binary belum ter-deploy).
- **Pengamatan per kasus:** `sv up`, sampel pada 6 dtk dan 60 dtk (45 dtk untuk dua kasus tambahan E11d): `jlist`
  difilter node (hanya `name:status:restart_time:pid`), `curl` tiap port, pid pm2-runtime lab, dan jumlah baris
  `e11-start` di log runit (= berapa kali runsv menyalakan runtime).

**Blok yang dipakai** (teks §3.1 apa adanya, `<PREFIX>` diganti `/data/data/com.termux/files/usr`):

```js
// >>> panel-termux:apps v1 (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)
// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan
// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar.
{
  const fs = require("fs");
  const path = require("path");
  const cfg = module.exports;
  const list = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.apps) ? cfg.apps : null;
  if (list) {
    let panel = [];
    try {
      const raw = require("./apps.json");
      panel = Array.isArray(raw)
        ? raw.filter(
            (a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")),
          )
        : [];
    } catch (e) {
      console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
    }
    const names = new Set(list.map((a) => a && a.name));
    const handWritten = list.length > 0;
    for (const a of panel) if (!names.has(a.name)) list.push(a);
    if (!handWritten && !names.has("pm2-guard"))
      list.push({
        name: "pm2-guard",
        script: "/data/data/com.termux/files/usr/bin/sleep",
        args: "infinity",
        interpreter: "none",
        autorestart: true,
      });
  }
  globalThis.__panelTermuxApps = { v: 1, listed: list !== null };
}
// <<< panel-termux:apps
```

### Hasil

| Kasus | App tangan | `apps.json`                          | flag             | start/60 dtk | PID runtime 6 → 60 dtk | App online (restart)                      | Catatan log                                                                 |
| ----- | ---------- | ------------------------------------ | ---------------- | ------------ | ---------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| E11a  | 2          | `[]`                                 | –                | 1            | 28599 → 28599          | hand-a, hand-b (r0); tanpa pm2-guard      | bersih                                                                      |
| E11a  | 2          | `[]`                                 | `--no-auto-exit` | 1            | 29414 → 29414          | hand-a, hand-b (r0); tanpa pm2-guard      | bersih                                                                      |
| E11b  | 2          | `[blog (ada), ghost (./run hilang)]` | –                | 1            | 30125 → 30125          | hand-a, hand-b, blog (r0); ghost dilewati | tidak ada `Script not found`; ghost tidak pernah dicoba                     |
| E11b  | 2          | sama                                 | `--no-auto-exit` | 1            | 30668 → 30668          | hand-a, hand-b, blog (r0); ghost dilewati | sama                                                                        |
| E11c  | 2          | `[{"name":` (rusak)                  | –                | 1            | 31191 → 31191          | hand-a, hand-b (r0)                       | `PM2 error: [ecosystem] apps.json dilewati: … Unexpected end of JSON input` |
| E11c  | 2          | sama                                 | `--no-auto-exit` | 1            | 31824 → 31824          | hand-a, hand-b (r0)                       | sama                                                                        |
| E11d  | 0          | `[]`                                 | –                | 1            | 32499 → 32499          | pm2-guard (r0)                            | bersih                                                                      |
| E11d  | 0          | `[]`                                 | `--no-auto-exit` | 1            | 1228 → 1228            | pm2-guard (r0)                            | bersih                                                                      |
| E11d2 | 0          | `[blog, ghost]`                      | –                | 1 (45 dtk)   | 3027 → 3027            | blog, pm2-guard (r0); ghost dilewati      | penjaga tetap ditambahkan karena tidak ada app **tangan**                   |
| E11d3 | 0          | tidak ada                            | –                | 1 (45 dtk)   | 4040 → 4040            | pm2-guard (r0)                            | `apps.json dilewati: Cannot find module './apps.json'`                      |

Semua app yang online juga menjawab `curl` di port masing-masing dengan pid yang sama dengan `jlist`.
`e11-ghost` tidak pernah muncul di daftar pm2. Bandingkan dengan E1: entri native yang hilang tanpa filter membuat
runtime keluar sekitar 54 kali per menit.

**E11e: tulis file terpatch saat runtime berjalan.** Runtime dinyalakan dengan ecosystem tangan **tanpa** blok (keadaan
POCO sebelum fix) dan `apps.json = [blog, blog2]`. Lalu skrip node menulis `teks lama + "\n" + blok` ke
`.ecosystem.panel-candidate.config.js` di folder yang sama (`openSync(tmp,"w",mode)` → `writeSync` → `fsyncSync(fd)` →
`close` → `renameSync` ke `ecosystem.config.js` → `fsyncSync(dirfd)`; pola C1). sha 4cf283855880 → 5baa4a578414, mode
600 tetap, inode baru.

| flag             | Sebelum tulis                 | 30 dtk setelah `rename`                                                  | Setelah `sv restart pm2lab-e11`                                 |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| –                | hand-a 4979, hand-b 4980 (r0) | **identik**: 4979, 4980 (r0), runtime 4947 tetap, blog/blog2 belum start | hand-a, hand-b, blog, blog2 online (r0, pid baru), runtime 5505 |
| `--no-auto-exit` | hand-a 5974, hand-b 5975 (r0) | **identik**: 5974, 5975 (r0), runtime 5933 tetap                         | hand-a, hand-b, blog, blog2 online (r0), runtime 6534           |

pm2-runtime tidak mengawasi file ecosystem. Menulis file (dengan `rename` atomik) tidak me-restart apa pun. Isi baru
baru berlaku saat runtime dinyalakan ulang, dan saat itu blok bekerja (situs panel ikut dimuat).

**E11f (C4 varian d): `pm2 start eco --only <situs>` lewat CLI saat runtime dengan blok berjalan.** Awal: hand-a,
hand-b, blog online (`apps.json = [blog, ghost]`). `apps.json` diubah menjadi `[blog, blog2]`, lalu
`lab.sh start ~/pm2lab-e11/sites/ecosystem.config.js --only e11-blog2`:

```
[PM2][WARN] Applications e11-blog2 not running, starting...
[PM2] App [e11-blog2] launched (1 instances)
tanpa flag:       hand-a 6848, hand-b 6849, blog 6851 (r0, tetap) + blog2 7145 online; runtime 6827 tetap; 1 start
--no-auto-exit:   hand-a 7489, hand-b 7491, blog 7508 (r0, tetap) + blog2 7803 online; runtime 7451 tetap; 1 start
```

Blok juga dievaluasi di proses CLI. `--only` hanya menyalakan situs yang diminta, dan pid app lain tidak berubah.

### Bongkar & bukti produksi tidak tersentuh

`sv down pm2lab-e11`, `lab.sh kill` ("PM2 Daemon Stopped"), `sv exit pm2lab-e11/log`, `sv exit pm2lab-e11`, lalu
`rm -rf $PREFIX/var/service/pm2lab-e11 ~/pm2lab-e11`. runsvdir sempat menyalakan ulang `runsv`/`svlogd` lab sesaat
sebelum folder layanan dihapus, lalu keduanya keluar sendiri. Scan `/proc/*/cmdline` sesudahnya hanya menemukan shell
ssh pemeriksa. Port 19101, 19102, 19110, dan 19111 bebas.

Restart count produksi **tidak** dibaca lewat `pm2 jlist`, supaya pm2 tidak pernah dipanggil tanpa `PM2_HOME` lab.
Sebagai gantinya dipakai pid + `starttime` (`/proc/<pid>/stat` kolom 22) proses yang cwd-nya di `~/sites/*`. Setiap
restart pm2 pasti mengganti pid.

| Waktu   | pm2 (runsv)            | panel                 | makuro-solusi (anak pm2)          | adminneo                    | `https://solusi.malikkurosaki.com/` |
| ------- | ---------------------- | --------------------- | --------------------------------- | --------------------------- | ----------------------------------- |
| sebelum | pid 10596, 155.677 dtk | pid 26688, 13.426 dtk | pid 28124 `ld.so`, start 10019821 | pid 11762 `php`, start 4754 | 200                                 |
| sesudah | pid 10596, 156.767 dtk | pid 26688, 14.516 dtk | pid 28124, start 10019821         | pid 11762, start 4754       | 200                                 |

Temuan sampingan, tidak disentuh: ada proses `fresh` pid 27794 dengan **ppid 1** dan cwd `~/sites/makuro-solusi`.
Proses itu sudah ada sebelum lab dimulai (start 10005714), jadi itu yatim dari restart makuro-solusi sebelumnya.
Loop "bunuh app yatim" di run script hanya berjalan saat pm2-runtime start. Ini perlu dicek pemilik: apakah proses
itu memegang port, dan apakah check `orphan_process` perlu ditambahkan.

### Kesimpulan: gerbang C4 **LULUS**

Blok v1 §3.1, ditempel di akhir file dengan bentuk ecosystem POCO, bekerja di pm2-runtime 7.1.2 dengan maupun tanpa
`--no-auto-exit`. Hasilnya: 1 start per kasus, tanpa crash loop, dan tanpa app tangan yang di-restart.

1. `apps.json = []` → hanya dua app tangan yang online, tanpa penjaga (sesuai Q5: POCO tidak mendapat penjaga).
2. Entri yang binary-nya hilang dilewati, dan app lain tetap hidup (filter E1e bekerja dari dalam blok).
3. `apps.json` rusak/hilang → app tangan tetap online, pesan `[ecosystem] apps.json dilewati` tercatat sebagai
   `PM2 error:`.
4. Tanpa app tangan → `pm2-guard` online dan runtime tetap hidup (juga saat ada situs panel, E11d2).
5. Menulis file dengan tmp + fsync + rename saat runtime berjalan tidak me-restart apa pun. Efeknya baru muncul pada
   restart runtime berikutnya. Ini mendukung copy "pm2 tidak perlu dimulai ulang" dan C5 ("restart = pemuatan pertama
   blok").
6. `start --only <situs>` lewat CLI tetap berfungsi dengan blok (C4 varian d).

Fix `ecosystem_block` boleh diaktifkan di build termux. Catatan untuk PLAN/06:

- **Belum diuji di E11:** blok versi C11 (seluruh badan di dalam `try`, awalan `;`, `JSON.stringify(prefix)`). Teks
  yang diuji adalah §3.1 apa adanya. Perubahan C11 hanya menambah pembungkus, tetapi bila teks final berbeda dari §3.1,
  kasus E11a dan E11d sebaiknya diulang dengan teks final (sekitar 3 menit, skripnya sama).
- **f2fs `fsync_mode=nobarrier`:** `fsync` di partisi ini tidak mengirim perintah flush ke cache perangkat. Pola C1
  tetap wajib karena menjamin urutan tulis-sebelum-rename di f2fs, tetapi tidak menjamin data selamat bila listrik
  benar-benar putus. Backup bertanggal + "Batalkan" tetap jadi jaring pengaman. Risiko ini perlu dicatat di PLAN/06
  §13 (C1).
- **Celah kecil di filter:** entri tanpa `script` lolos filter, karena `path.resolve(cwd, "")` = folder cwd, yang
  memang ada. Entri seperti itu tidak dibuat oleh `panelAppEntry`, jadi cukup dicatat. Bila ingin ditutup, tambahkan
  `typeof a.script === "string" && a.script &&` di filter.

## E11 (teks final): ulangan E11a dan E11d dengan teks persis dari `ecosystemBlock()`

Tanggal: 2026-11-27, pukul 07:55 sampai 08:01 WITA. Worker: `wkr-pm2lab-e11b`. Tujuan: menutup catatan "Belum diuji di
E11" di atas. Yang diuji adalah teks versi C11 (seluruh badan di dalam `try`, awalan `;`, guard lewat
`JSON.stringify`) ditambah filter yang kini juga mewajibkan `script` berupa string tidak kosong. Sebelumnya entri tanpa
`script` lolos filter karena `path.resolve(cwd, "")` = folder cwd.

**Teks blok:** dihasilkan di laptop dengan
`bun -e 'process.stdout.write(ecosystemBlock("/data/data/com.termux/files/usr"))'` (LF, ASCII, sha256
`e3803d52001e…9a00`). Hash di POCO sama. Baris filter di teks final:

```js
? raw.filter((a) => a && typeof a.name === "string" && typeof a.script === "string" && a.script !== "" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script)))
```

**Metode:** sama dengan E11 (lab `~/pm2lab-e11`, `PM2_HOME` lab lewat `lab.sh`, layanan runit sekali pakai dengan
`down` lebih dulu, `case.sh`/`st.sh` yang sama). Ada satu perbedaan: ecosystem lab = kepala + **satu baris kosong** +
blok, sama dengan keluaran `planEcosystemFix` (`separator`). Tidak ada perintah pm2 ke `~/.pm2`.

| Kasus | App tangan | `apps.json`                                                | flag             | start | PID runtime 6 → akhir  | App online (restart)                                       |
| ----- | ---------- | ---------------------------------------------------------- | ---------------- | ----- | ---------------------- | ---------------------------------------------------------- |
| E11a  | 2          | `[]`                                                       | –                | 1     | 12642 → 12642 (60 dtk) | hand-a, hand-b (r0); tanpa pm2-guard                       |
| E11a  | 2          | `[]`                                                       | `--no-auto-exit` | 1     | 13593 → 13593 (60 dtk) | hand-a, hand-b (r0); tanpa pm2-guard                       |
| E11d  | 0          | `[]`                                                       | –                | 1     | 14995 → 14995 (60 dtk) | pm2-guard (r0)                                             |
| E11d  | 0          | `[]`                                                       | `--no-auto-exit` | 1     | 15748 → 15748 (60 dtk) | pm2-guard (r0)                                             |
| E11b' | 2          | `[blog, noscript (tanpa script), emptyscript (script "")]` | –                | 1     | 16531 → 16531 (45 dtk) | hand-a, hand-b, blog (r0); dua entri tanpa script dilewati |

`curl` tiap port menjawab dengan pid yang sama dengan `jlist`. Log runit: tepat 5 baris `e11-start` untuk 5 kasus.
`exited … via signal [SIGINT]` hanya muncul saat `sv down` di akhir kasus. Tidak ada `Script not found`, tidak ada
`blok panel dilewati`, tidak ada `apps.json dilewati`. Satu-satunya noise adalah `getconf: not found` dari pidusage
pm2, yang sudah dikenal. Tambahan tanpa pm2: `node -e 'require(eco)'` dengan blok final memberi `hand/[]` → hand-a,
hand-b; `none/[]` → pm2-guard; `hand/noscript` → hand-a, hand-b, blog; `none/noscript` → blog, pm2-guard. Semuanya
dengan `__panelTermuxApps = {"v":1,"listed":true}`.

Catatan metode: `sv exit pm2lab-e11/log` di `case.sh` tidak menghentikan svlogd (pid sama sepanjang lab), dan
`rm -f svlog/*` menghapus `current` yang masih terbuka. Log tetap dibaca utuh lewat `/proc/<svlogd>/fd`.

**Bongkar:** `sv down`, `lab.sh kill` ("PM2 Daemon Stopped"), `sv exit` log + layanan, `rm -rf
$PREFIX/var/service/pm2lab-e11 ~/pm2lab-e11`. Scan `/proc/*/cmdline` setelahnya hanya menemukan shell pemeriksa,
dan port 19101, 19102, 19110, 19111 bebas.

**Produksi tidak tersentuh** (pid + `starttime` `/proc/<pid>/stat` kolom 22, tanpa memanggil pm2). Keluaran
sebelum dan sesudah **identik** (`diff` kosong):

| Proses                  | pid   | starttime |
| ----------------------- | ----- | --------- |
| pm2-runtime (runsv pm2) | 10596 | 4406      |
| panel                   | 26688 | 14229536  |
| makuro-solusi (`ld.so`) | 28124 | 10019821  |
| adminneo (`php`)        | 11762 | 4754      |

`https://solusi.malikkurosaki.com/` → 200 sebelum dan sesudah. Proses yatim `fresh` pid 27794 (lihat E11) masih ada
dan tidak disentuh.

### Kesimpulan: E11 teks final **LULUS**

Teks final `ecosystemBlock()` berperilaku sama dengan teks §3.1 yang diuji di E11, dengan maupun tanpa
`--no-auto-exit`: 1 start per kasus, tanpa crash loop, dan penjaga hanya muncul bila tidak ada app tangan. Entri
tanpa `script` atau dengan `script: ""` kini dilewati. Catatan "Belum diuji di E11" sudah tertutup. Celah filter
juga sudah ditutup di blok (BLOCK_VERSION tetap 1 karena v1 belum dirilis). Risiko f2fs `nobarrier` sudah dicatat di
PLAN/06 §12.
