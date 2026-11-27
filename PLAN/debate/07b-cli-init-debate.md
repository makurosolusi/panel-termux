# Debat 07b — `panel init` (PLAN/07 revisi 4, C18)

Reviewer adversarial `wkr-init-debate-01`, 2026-11-27, branch `feature/cli-init`. Yang direview: `PLAN/07-cli-bootstrap.md`
revisi 4 (§0, K14–K25, §4, §5.2, §8.2, §12–§17), dicocokkan dengan kode (`src/cli/*`, `src/server/boot.ts`,
`src/server/system/cloudflared.termux.ts`, `scripts/build.ts`, `scripts/package-release.sh`,
`scripts/install-release.sh`, `scripts/install-phone.sh`, `.github/workflows/release.yml`, `deploy/sv/panel/run`) dan
dengan temuan debat sebelumnya (`PLAN/debate/07-cli-bootstrap-debate.md`, D1–D15, m1–m18). Tidak ada kode produksi
yang diubah. Tidak ada Docker.

POCO hanya dibaca (`ssh poco`: `ls`, `stat`, `dpkg -s`, `apt-mark showhold`, `sv status`, `readlink`, `grep` pada
`sshd_config`, `~/panel/panel -v`). Tidak ada isi rahasia yang dicetak. Backup Mac hanya di-`ls` dan di-`tar -t`
(nama entri), `MANIFEST.txt`/`RESTORE.md` hanya dibaca judul dan baris non-rahasia.

## 1. Ringkasan

| Severity | Jumlah | Nomor  |
| -------- | ------ | ------ |
| BLOCKER  | 2      | E1, E2 |
| MAJOR    | 6      | E3–E8  |
| MINOR    | 10     | E9–E18 |

Inti: penggantian `install.sh` oleh `init` masuk akal dan lebih sederhana. Penukaran binary yang sedang dipakai runit
aman (lihat §4 "lolos"). Dua hal menggagalkan rencana apa adanya. **E1:** setiap pasang ulang (termasuk wipe fase B/D
di POCO) gagal di `route dns`, karena hostname panel masih CNAME ke tunnel lama dan kode sengaja tidak pernah
`--overwrite-dns`. **E2:** definisi "HP baru" (yang menentukan boleh `pkg upgrade`) dibaca dari `~/panel`. Akibatnya
Termux yang sudah punya data PostgreSQL bisa di-`pkg upgrade` sampai lompat mayor, dan sebaliknya instalasi baru yang
terputus dilanjutkan dengan aturan HP lama yang lebih ketat sehingga butuh perintah manual. D12 (`panel.prev`) dan m9
(`--yes`) hanya terpenuhi sebagian, dan teksnya saling bertentangan.

## 2. Temuan

### E1. Pasang ulang gagal di `route dns`: hostname panel masih milik tunnel lama — BLOCKER

- **Area:** tunnel, §4.4, lab fase B/D/E, kriteria §17.
- **Bukti:**
  - `src/server/system/cloudflared.termux.ts:110`: `// No --overwrite-dns: an existing record of someone else must fail,
    not be replaced.`; `system.types.ts:102-103`: `routeDns` "never --overwrite-dns", gagal → `SystemError`.
  - PLAN §4.4 langkah 4 memakai `routeDns` "tanpa `--overwrite-dns`" dan hanya menangani `DnsWrongZoneError`.
  - §14 fase B langkah 5 sengaja memakai **hostname panel yang sama** (supaya OAuth client cocok). Hostname itu sekarang
    CNAME ke tunnel `poco` (backup `cloudflared.tar.gz`: `a97bf566-….json` + `config.yml`). Tunnel baru
    `panel-<domain>` → `route dns` ditolak Cloudflare ("record with that host already exists"), jadi `init` gagal
    dan kriteria §17 ("tanpa perintah manual") tidak bisa lulus.
  - Wipe kedua (fase D): tunnel `panel-<domain>` dari fase B masih ada tanpa kredensial (dihapus bersama Termux), jadi
    §4.4 langkah 2 "ada tanpa kredensial → minta nama lain" memunculkan prompt tambahan, dan DNS kini milik tunnel
    fase B.
  - `RESTORE.md` §6 (backup `poco-20261127-1529`, baris 159) memakai `route dns poco <hostname>` tanpa
    `--overwrite-dns`. Setelah fase B/D, pemulihan ke tunnel `poco` gagal dengan cara yang sama.
  - `cloudflared tunnel route dns --help` di POCO: `--overwrite-dns, -f … (default: false)`. Flag ada, tetapi belum
    dipakai di mana pun.
- **Perubahan wajib:**
  1. §4.4 langkah 4: bila `route dns` gagal karena record sudah ada → di TTY tanya `Alamat <host> sudah diarahkan ke
     tunnel lain. Pindahkan ke tunnel ini? Yang dilayani alamat itu sekarang akan putus. [y/N]`, lalu `routeDns(id,
     host, { overwrite: true })` (parameter baru, bawaan `false`; job situs tetap tanpa overwrite). Tanpa TTY → exit 3
     dengan perintah persis `cloudflared tunnel route dns --overwrite-dns <tunnel> <host>`. `--yes` **tidak**
     menjawab pertanyaan ini.
  2. §4.4 langkah 2: "tunnel ada tanpa kredensial" → bila L2 memilih opsi A, pakai tunnel itu lewat `cloudflared tunnel
     token <nama>` (cukup `cert.pem`, tanpa JSON kredensial); opsi B → prompt nama lain (perilaku sekarang).
  3. §14: sebelum fase D, koordinator menghapus tunnel lab fase B (`cloudflared tunnel delete`, dengan izin pemilik),
     atau §17 menerima satu jawaban `y` pada prompt overwrite sebagai "ketukan". Fase E dan `RESTORE.md` §6 memakai
     `--overwrite-dns` untuk mengembalikan hostname ke tunnel yang dipilih.
  4. Test unit: `routeDns` palsu melempar "already exists" → TTY: satu pertanyaan, lalu panggilan dengan overwrite;
     tanpa TTY: exit 3 dan nol panggilan overwrite.

### E2. "HP baru" dibaca dari `~/panel`, padahal itulah gerbang `pkg upgrade` — BLOCKER

- **Area:** K7, §4 (tabel mode), langkah 0–2, D9/D11.
- **Bukti:**
  - §4 baris 281: HP baru = "`~/panel` belum ada dan tidak ada layanan pm2/panel". K7: HP baru →
    `pkg upgrade -y` (dengan `--yes` tanpa pertanyaan tambahan).
  - Arah berbahaya: Termux yang sudah berisi PostgreSQL (`$PREFIX/var/lib/postgresql/PG_VERSION`), app pm2 yang
    dijalankan manual (bukan layanan runit), atau `~/.cloudflared`, tetapi tanpa `~/panel`, dianggap HP baru. Akibatnya
    `pkg upgrade` bisa menaikkan `postgresql` mayor, dan menurut D11 Termux tidak membawa binary lama untuk
    `pg_dumpall`/`pg_upgrade`. Data cluster praktis terkunci. Hold baru dipasang **setelah** upgrade.
  - Arah sebaliknya: langkah 0 membuat `~/panel/.init.lock`, dan langkah 1 memasang `~/panel/panel`. Run yang
    terputus (Ctrl-C saat dpkg, exit 3 karena `.env`/login) lalu di-rerun masuk mode cek/perbaiki dengan aturan HP
    lama: `dpkg --audit` tidak kosong → exit 3 + perintah manual (§4.1 langkah 2), tanpa `pkg upgrade`, hold butuh
    konfirmasi. Ini bertentangan dengan fase C ("SIGINT ke `dpkg` … lalu `panel init` → `dpkg --audit` → pulih") dan
    §17.
  - Langkah 1 juga menjanjikan "cek diri gagal → tidak ada yang diubah", padahal lock di langkah 0 sudah membuat
    `~/panel`.
- **Perubahan wajib:**
  1. "HP baru" = tidak ada **data pengguna**: tidak ada `PG_VERSION`, `~/.cloudflared`, `~/.pm2`, `~/sites`, dan
     `~/panel/data/panel.db`. Keberadaan `~/panel/panel`, layanan `panel`, atau lock **tidak** dihitung, sehingga
     resume instalasi baru tetap HP baru.
  2. `pkg upgrade` hanya bila definisi di atas berlaku **saat langkah 2 dijalankan**, dan `postgresql` belum
     terpasang. Selain itu ikuti aturan HP lama (simulasi `apt-get -s`, D9).
  3. Lock pindah ke `$PREFIX/tmp/panel-init.lock` (TMPDIR di POCO = `$PREFIX/tmp`), supaya cek diri yang gagal
     benar-benar tidak menyentuh `$HOME`.
  4. Test: fixture `fresh` + `PG_VERSION` → rencana tanpa `pkg upgrade`. Fixture "fresh yang terputus" (binary +
     layanan `panel` ada, tanpa `panel.db`) + `dpkg --audit` tidak kosong → `dpkg --configure -a`, bukan exit 3.

### E3. D12 hanya terpenuhi sebagian: `panel.prev` ditimpa binary yang belum pernah jalan — MAJOR

- **Area:** langkah 1, K21, §4.5.
- **Bukti:** D12 mewajibkan `panel` disalin ke `panel.prev` hanya bila sehat **"(`/api/health` versi = binary
  terpasang)"**. Revisi 4 (§4.1 langkah 1, §4.5) hanya mensyaratkan "`/api/health` menjawab". Health membuktikan bahwa
  **proses** yang berjalan sehat, bukan file `~/panel/panel`. Contohnya upgrade yang terputus setelah langkah 1 dan
  sebelum langkah 10 (§4.2 baris 357), lalu rerun dengan build lain (deploy dev berulang, atau rc lalu final). Proses
  lama masih menjawab health, jadi file baru yang belum pernah boot disalin ke `panel.prev`, dan versi terakhir yang
  benar-benar sehat hilang. Kode yang dipindahkan punya celah yang sama (`install-phone.sh:108-112`), plus `cp -p`
  118 MB yang tidak atomik (crash di tengah = `panel.prev` terpotong).
- **Perubahan wajib:** `panel` → `panel.prev` hanya bila `panel.prev` belum ada, **atau** health ok **dan**
  `stat(/proc/<$SVDIR/panel/supervise/pid>/exe)` (dev+ino) = `stat(~/panel/panel)`. Inode yang sama berarti file itulah
  yang sedang melayani. Bukti bahwa ini bisa dipakai: di POCO `readlink /proc/<pid panel>/exe` =
  `/data/data/com.termux/files/home/panel/panel` dengan termux-exec 2.5.0 (bukan `linker64`). Penulisan:
  `link(panel, panel.prev.new)` → `rename(panel.prev.new, panel.prev)` (atomik, tanpa salinan 118 MB). `panel.new`
  di-`fsync` sebelum `rename`. Test: health ok + inode beda → `panel.prev` tidak berubah.

### E4. `--yes` me-restart panel tanpa TTY: K21 bertentangan dengan tiga tempat lain — MAJOR

- **Area:** m9, K21, §4.1, §4.5.
- **Bukti:** K21 (baris 78) dan langkah 10 (baris 304): `--yes` = ya untuk restart panel. Tiga tempat lain masih
  memakai aturan m9 lama:
  - §4.1 baris 310–311: "restart layanan yang sedang melayani (panel/cloudflared) di HP lama tetap butuh TTY (m9)".
  - §4.5 baris 429: "restart panel/cloudflared hanya dengan konfirmasi TTY".
  - §4.5 baris 448: test "`--yes` tanpa TTY di HP lama → exit 3 tanpa restart (m9)". Test ini bertentangan langsung
    dengan test baris 454: "upgrade `--yes` tanpa TTY → restart panel (K21)".

  Worker W1-svc dan W0 akan membangun dua perilaku berbeda.
- **Perubahan wajib:** satu aturan, ditulis di K9 dan dirujuk dari tempat lain:
  - **Restart panel** hanya di mode upgrade (binary berubah atau inode proses ≠ file, E3), dengan konfirmasi TTY atau
    `--yes`, juga tanpa TTY.
  - **Mode cek/perbaiki** tidak pernah me-restart panel yang `run` (`sv up` bila mati bukan restart).
  - **Restart cloudflared** hanya dengan TTY. `--yes` tanpa TTY → dilewati, exit 3 + perintahnya.

  Ganti test baris 448 menjadi "ingress berubah + cloudflared `run` + `--yes` tanpa TTY → exit 3, nol `sv restart
  cloudflared`".

### E5. Mode upgrade tanpa TTY tetap memasang komponen baru; kriteria "hanya `~/panel/panel*`" mustahil — MAJOR

- **Area:** §4 tabel mode (baris 282), §4.5 uji `poco`, L10, §17.
- **Bukti:**
  - Upgrade = "langkah lain hanya mengisi yang **belum ada**". Di instalasi 0.4.0/0.5.0 lain (dipasang `install.sh`:
    tanpa PostgreSQL, tanpa skrip boot, tanpa Termux:API), `init --yes` lewat ssh tanpa TTY akan `pkg install
    postgresql` + `initdb` + `apt-mark hold`, menulis skrip boot, lalu memanggil `termux-wake-lock`. Panggilan
    terakhir itu memunculkan dialog baterai (m11) di HP yang tidak dipegang siapa pun.
  - Kriteria L10/§17/§4.5 baris 441: "tidak mengubah satu byte pun di luar `~/panel/panel*`". Di POCO,
    `ls $PREFIX/bin/panel` → `No such file or directory`, jadi langkah 1 **pasti** membuat symlink. Langkah 1 juga
    memangkas `~/panel-src` (m12) dan menghapus file unduhan (K24). Kriteria itu gagal oleh rencana sendiri.
- **Perubahan wajib:**
  - Mode upgrade/cek: langkah 2, 4, 9, 11 hanya **melaporkan** yang kurang (baris doctor + perintah). Langkah itu baru
    dijalankan dengan konfirmasi TTY. `--yes` tanpa TTY di instalasi yang ada = binary + symlink + restart panel saja.
  - Kriteria diganti dengan daftar persis yang boleh berubah: `~/panel/panel`, `~/panel/panel.prev`,
    `$PREFIX/bin/panel` (dibuat bila belum ada), file unduhan dihapus, `~/panel-src/v*` dipangkas (E11). Selain itu
    `find -newer` kosong (kecuali log).

### E6. Cek diri: melingkar, menolak saat offline, dan ada celah TOCTOU — MAJOR

- **Area:** K19, langkah 1, §8.2.
- **Bukti:**
  - Binary memeriksa dirinya sendiri. Binary yang dimodifikasi cukup melewati pemeriksaan dan mencetak ✅. PLAN sudah
    jujur bahwa ini "bukan asal". Kerusakan unduhan yang paling mungkin adalah terpotong (curl putus), dan kasus itu
    sudah dihentikan `curl -f … &&`. Binary standalone Bun yang kehilangan trailer-nya kemungkinan berjalan sebagai
    `bun` biasa (di macOS terbukti dibunuh codesign: `Killed: 9`, rc 137; perilakunya di Android **belum
    diverifikasi**), sehingga cek diri tidak pernah jalan. Yang tersisa hanya korupsi berukuran sama, yang jarang.
  - Biayanya justru di ketersediaan. K19 menetapkan gagal jaringan/404 → exit 1. Akibatnya **setiap** `init`
    (termasuk perbaikan HP yang panelnya mati) butuh GitHub. Bila rilis atau repo dihapus/dijadikan privat, semua
    `init` di semua HP gagal selamanya.
  - TOCTOU: hash dihitung atas `process.execPath`, lalu file yang sama disalin ke `panel.new`. Byte yang dipasang
    tidak pernah di-hash.
  - `PANEL_RELEASE_TAG` "di-`define` dari env": bila kodenya membaca `process.env.PANEL_RELEASE_TAG`, jalan dev (`bun
    src/server/main.ts`) memakai nilai runtime. Bun memuat `.env` dari cwd (K11a), jadi isi `.env` ikut menentukan.
  - `gh attestation verify` di HP: `command -v gh` di POCO kosong, dan `gh attestation` butuh `gh auth`. Di HP
    hasilnya hampir selalu peringatan palsu.
- **Perubahan wajib:**
  1. Cek diri hanya bila binary ini **akan dipasang** (SHA `~/panel/panel` ≠ diri), bukan di setiap run perbaikan.
  2. Tidak cocok / baris `panel` tidak ada → exit 1 (tetap). Gagal jaringan, timeout, 5xx, atau 404 → HP baru: exit 1
     (paket butuh internet juga). Instalasi yang ada: `⚠️ tidak bisa dicek terhadap rilis <tag> (<sebab>)`, lalu
     lanjut.
  3. Urutan: salin ke `panel.new` → hash `panel.new` → bandingkan → `rename` (tidak cocok → hapus `panel.new`, exit 1).
  4. Tag = identifier khusus (`define: { __PANEL_RELEASE_TAG__: … }` + `declare const`), bukan `process.env.*`.
  5. Hapus panggilan `gh attestation verify` dari `init`. Pesan sukses cukup menyebut "untuk membuktikan asal: `gh
     attestation verify panel --repo …` di komputer".

### E7. Lab fase A: urutan destruktif dulu, dan hold cloudflared di POCO sekarang hilang — MAJOR

- **Area:** §14 fase A, C15, Q9.
- **Bukti (POCO, 2026-11-27 15:48 WITA):**
  - `apt-mark showhold` → hanya `postgresql`. Inventaris backup `inventory/apt-holds.txt` berukuran 23 byte
    (= `cloudflared\npostgresql\n`).
  - `$PREFIX/var/log/apt/history.log`: `apt-get install --reinstall -y cloudflared`.
  - `sv status cloudflared` → `run … 29s`.
  - `~/lab-l2/t0` dibuat 15:47. L2 sedang berjalan, dan hold cloudflared (C15, §13 Q9 "Selesai") saat ini tidak ada.
  - Fase A menjalankan L8 (`pkg upgrade` nyata) dan L2 (`apt reinstall cloudflared`), padahal kriteria L10 adalah "pid
    pm2-runtime + makuro-solusi + cloudflared **tidak berubah**". Urutan di tabel tidak mengikat, sehingga L9/L10 bisa
    diukur setelah layanan di-restart oleh L8/L2.
- **Perubahan wajib:**
  - Fase A berurutan: L4 → L9 → L10 → L8 → L2.
  - Syarat keluar fase A: `apt-mark showhold` memuat `cloudflared` dan `postgresql`, doctor `pkg_held` ok, dan layanan
    `cloudflared` sama dengan backup (`lab-l2/service-orig`).
  - Q9 diberi catatan: hold harus dipulihkan setelah L2.
  - Koordinator memeriksa hold sekarang. Reviewer ini tidak mengubah apa pun di POCO.

### E8. Lab B/D tanpa jalur batal, dan ssh baru tersedia di langkah terakhir — MAJOR

- **Area:** §14 fase B–E, langkah 11, risiko §12 baris "Wipe Termux".
- **Bukti:**
  - `--ssh-key` dijalankan di langkah **11**, setelah paket, PostgreSQL, `.env`, tunnel (E1 pasti gagal di sini),
    boot, dan start. Bila `init` gagal di langkah 2–10, koordinator tidak punya akses. Pemilik harus mengetik
    `RESTORE.md` §1 (`pkg install -y openssh rsync`, kunci, `sshd`) di layar HP.
  - §14 tidak merujuk `RESTORE.md` yang sudah ada di backup dan tidak punya kriteria batal.
  - Backup ada dan lengkap: 16 entri, `MANIFEST.txt` dengan sha256 per arsip, `pg_dumpall.sql`, `panel.tar.gz`
    berisi `.env`/`secret`/`panel.db`(+wal/shm)/`panel.prev`, `cloudflared.tar.gz` berisi cert + kredensial `poco`.
- **Perubahan wajib:**
  1. Bila `--ssh-key` diberikan, langkah SSH dijalankan tepat setelah langkah 3 (runit; `openssh` ikut dipasang di
     langkah 2), sebelum langkah yang berisiko.
  2. §14 ditambah "Batal": pemilik bilang berhenti, atau fase B/D tidak hijau dalam satu sesi kerja → pulihkan
     menurut `RESTORE.md` backup fase 0 (DNS kembali ke `poco` dengan `--overwrite-dns`, E1). Downtime makuro-solusi
     dihitung dari langkah 2 fase B.
  3. Q15 dan Q16 (menunggu pemilik) menjadi gerbang fase B, ditulis eksplisit di §16 G-lab.

### E9. YAGNI — MINOR

- **Bukti dan perubahan:**
  - **Tarball + `install-phone.sh` hasil generate (K15, §8.2):** hanya melayani `PANEL_VERSION=v0.5.1 sh install.sh`
    yang dijalankan dari salinan `install.sh` ≤ 0.5.0. Salinan lama yang dijalankan tanpa variabel itu memasang versi
    yang tertanam di dalamnya, sedangkan URL `latest/download/install.sh` sudah dilayani shim. Satu-satunya instalasi
    (POCO) akan di-wipe. Kombinasi ini menambah `package-release` + test untuk nol pengguna. C18(a) mengikatnya, jadi
    **diusulkan ke pemilik**: hapus tarball di 0.5.1, pertahankan shim.
  - **`--downgrade`:** `panel rollback` sudah menutup kasus nyata. Downgrade ke versi apa pun di atas DB yang sudah
    dimigrasi maju tidak punya cerita DB (berbeda dengan m13/`--db`). Hapus flag ini. Exit 3 cukup menyarankan
    `panel rollback [--db]`.
  - **`--port`, `--tunnel`:** tidak ada konsumen. PORT ada di `.env`, nama tunnel punya default Q7 + prompt. Hapus.
  - **`gh attestation verify`:** lihat E6 butir 5.
  - **Drop-in `sshd_config.d`:** lihat E12.

### E10. K24 menghapus `process.execPath` terlalu luas — MINOR

- **Bukti:** aturannya "hapus bila bukan `~/panel/panel`". `~/panel/panel.prev init --downgrade` (bila flag itu tetap
  ada) akan menghapus `panel.prev`. Penghapusan di langkah 1 terjadi saat proses masih memuat chunk lazy (K1). Di
  macOS terbukti aman: binary uji dengan `splitting: true` meng-`unlink` dirinya sendiri lalu `await import()` chunk
  tetap `ok`. Di Android belum diverifikasi.
- **Perubahan:** hapus hanya bila `execPath` di luar `~/panel/`. Tambahkan ke L9/L10: file unduhan dihapus dan
  langkah setelahnya tetap jalan (build dev).

### E11. Pemangkasan `~/panel-src` (m12) vs tata letak POCO — MINOR

- **Bukti:** `ls -la ~/panel-src` di POCO → `.env.example deploy dist scripts` (113 MB). Itu tata letak deploy dev
  `README.md:191` (`rsync -avR …`), bukan `~/panel-src/v<ver>/` milik `install-release.sh:15`. Aturan "selain versi
  sekarang + sebelumnya" bisa menghapus `deploy`/`dist`/`scripts` sebagai "versi".
- **Perubahan:** pangkas hanya folder `v[0-9]*`. Folder lain disebut di ringkasan ("~/panel-src/dist tidak dipakai
  lagi; hapus bila tidak perlu"), tidak dihapus otomatis.

### E12. `--ssh-key`: kepercayaan URL dan `authorized_keys` — MINOR

- **Bukti:**
  - K22 menerima URL `https://` dari host mana pun. Kunci yang diunduh langsung menjadi pintu masuk.
  - `authorized_keys` di POCO 600, `~/.ssh` dan HOME 700, dan diakhiri `\n`. File tanpa newline akhir akan
    menggabungkan kunci baru ke baris terakhir sehingga kedua kunci rusak.
  - `sshd_config` POCO baris 13 memuat `Include …/sshd_config.d/*.conf`, dan `10-key-only.conf` sudah ada.
    `RESTORE.md:105` menyebut `sshd_config` POCO "punya baris Include", sehingga baris itu mungkin tambahan pemilik.
    Belum terbukti bahwa Termux bersih memilikinya. Termux bersih juga belum punya password (`passwd` belum
    dijalankan), jadi password auth memang tidak bisa dipakai.
- **Perubahan:**
  - Tambahkan newline bila file tidak diakhiri `\n`. Tulis lewat tmp + `rename` dan pertahankan baris lama.
  - Baris dengan opsi (`command=…`) ditolak (validasi tipe di awal baris sudah menolaknya).
  - Cetak sidik jari setiap kunci, lalu di TTY minta konfirmasi `Tambahkan N kunci ini? [Y/n]`.
  - L3 mencatat apakah `sshd_config` bawaan memuat `Include`. Bila tidak, **hapus fitur drop-in** dari K22 (YAGNI),
    jangan hanya memberi peringatan.
  - Jangan menebak IP (`ip` tidak ada di POCO, hanya `ifconfig`). Cetak `whoami`, port 8022, dan "IP HP: lihat
    Tailscale/Wi-Fi".

### E13. Ketahanan baris satu perintah — MINOR

- **Bukti:**
  - L3 sebagian terjawab di POCO: `curl` adalah `Depends` dari `termux-tools` (paket bootstrap, `dpkg -s
    termux-tools`), `sha256sum`/`tar` dari `coreutils`/`tar` yang juga bootstrap, dan `TMPDIR=$PREFIX/tmp`.
  - Dua kegagalan yang belum ditangani:
    - Baris dijalankan dari `~/storage/shared` (FUSE, noexec): `chmod +x` tidak berefek dan `./panel-termux` →
      `Permission denied`, sebelum `init` bisa menjelaskan apa pun.
    - Folder `~/panel-termux` hasil `git clone` repo ini membuat `curl -o panel-termux` gagal "Is a directory".
  - Setelah curl putus, pengguna cenderung menjalankan ulang `./panel-termux init` saja, padahal file itu terpotong
    (E6).
- **Perubahan:**
  - Baris K24: `cd && curl -fL --retry 3 -o panel-termux … && chmod +x panel-termux && ./panel-termux init`.
  - README: "bila unduhan gagal, ulangi seluruh baris".
  - Q14 tetap terbuka soal nama. Bila nama dipertahankan, tambahkan catatan bentrok dengan folder clone.

### E14. README/landing: cakupan grep dan waktu terbit — MINOR

- **Bukti:**
  - `README.md:427` `sh ~/server-termux/install.sh poco2` (proyek lain) = positif palsu untuk grep §17.
  - `README.md:112-113` (daftar test) dan `:463` (troubleshooting "jalankan ulang `install.sh`") ada di luar daftar
    bagian W3 (§16).
  - Sampai `v0.5.1` terbit, `releases/latest` = v0.5.0, yang tidak punya aset `panel` → baris baru 404.
  - Prarilis memang tidak dipilih `latest` (semantik GitHub: latest = rilis terbaru yang bukan draft/prerelease), jadi
    K25 lolos.
- **Perubahan:**
  - W3 mencakup semua kemunculan, bukan hanya bagian "pasang/upgrade/rollback/rilis/deploy dev".
  - Grep §17 mengecualikan `server-termux`.
  - README dengan baris baru di-merge ke `main` bersama tag `v0.5.1`, tidak lebih awal.

### E15. `release.yml` untuk K25 — MINOR

- **Bukti:**
  - Version gate (`release.yml` langkah "Version gate"): `[ "$REF_NAME" != "v$VERSION" ]` → tag `v0.5.1-rc.1` ditolak.
  - `gh release create … --verify-tag` tanpa `--prerelease`.
  - `PANEL_RELEASE_TAG` belum diteruskan ke langkah `bun run build`. `TAG` sudah dihitung sebelumnya di `GITHUB_ENV`,
    jadi tinggal dipakai.
  - Dry run menanam `v0.0.0-dryrun`.
  - Regex tag `package-release.sh` (`v[0-9]*`, karakter `.-`) sudah menerima `-rc.1`.
- **Perubahan:**
  - Gate menerima `v$VERSION` atau `v$VERSION-rc.[0-9]+`. Tag rc → `--prerelease`.
  - `env: PANEL_RELEASE_TAG: ${{ env.TAG }}` pada langkah build.
  - Catat bahwa binary dry run tidak boleh dipakai untuk lab (cek dirinya pasti 404).

### E16. Rumus ruang langkah 1 — MINOR

- **Bukti:** rumus = 2 × `panel.db` + 256 MB + ukuran binary **sekali**. Dengan `cp` ke `panel.prev` (pola
  `install-phone.sh:111`) yang dibutuhkan 2 × 118 MB.
- **Perubahan:** pakai `link()` (E3). Dengan itu rumus menjadi benar apa adanya.

### E17. Deploy dev lewat `scp` — MINOR

- **Bukti:**
  - K23 `scp dist/panel-android-arm64 poco:` mengirim 118 MB tanpa resume lewat VPN. Fase 0 sendiri butuh
    `rsync --partial` dalam loop karena VPN bisa putus.
  - `scp` ke `~/panel-android-arm64` yang masih dieksekusi run sebelumnya → `Text file busy` (ETXTBSY). Ini satu-satunya
    tempat ETXTBSY bisa muncul di alur ini.
- **Perubahan:** `rsync --partial dist/panel-android-arm64 poco: && ssh poco ./panel-android-arm64 init --yes`.

### E18. Rencana bilang `install-phone.sh` menimpa run script; `init` tidak — MINOR (catatan)

- **Bukti:** `install-phone.sh:132-134` selalu menimpa `$SVDIR/panel/run`. Langkah 6 `init`: "run script beda →
  peringatan saja". Di POCO run script = template (md5 `17778486…` sama dengan `deploy/sv/panel/run`), jadi tidak ada
  masalah hari ini. Namun bila template berubah di rilis berikutnya, instalasi lama tidak akan pernah menerimanya.
- **Perubahan:** langkah 6 menimpa run script bila isinya sama dengan template versi lama yang dikenal (daftar hash
  ter-embed). Selain itu cukup peringatan. Bila YAGNI dipilih, catat di §15 bahwa perubahan template butuh migrasi.

## 3. Status temuan debat sebelumnya

| #       | Status di revisi 4                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------- |
| D1      | Dipenuhi (K13).                                                                                         |
| D2      | Dipenuhi dan terbangun (`boot.ts:78-87` `assertNoRunningPanel`).                                        |
| D3      | Dipenuhi (K11b). Bukti HP tinggal L7.                                                                   |
| D4      | Dipenuhi (§4.4 tanpa `-o`, token lewat fd).                                                             |
| D5      | **Sebagian:** desain benar, tetapi POCO saat ini tanpa hold cloudflared (E7).                           |
| D6      | Dipenuhi (snippet di shim §8.2).                                                                        |
| D7      | Dipenuhi (K17 `placeholders`).                                                                          |
| D8      | Dipenuhi (doctor `env_extra_files`).                                                                    |
| D9      | **Sebagian:** aturannya ada, tetapi gerbang "HP baru" salah (E2).                                       |
| D10     | Dipenuhi (`config.yml` hanya bila panel tidak `run`).                                                   |
| D11     | **Sebagian:** `pkg upgrade` di Termux berisi PostgreSQL yang dianggap HP baru (E2).                     |
| D12     | **Sebagian:** syarat "versi health = binary terpasang" hilang (E3). `upgrade` tetap ditunda (dipenuhi). |
| D13     | Dipenuhi (L5 lulus).                                                                                    |
| D14     | Dipenuhi (§4.4 langkah 1 stdout di-pipe).                                                               |
| D15     | Dipenuhi.                                                                                               |
| m1–m8   | Dipenuhi. m7: lock basi benar, tetapi lokasi lock bermasalah (E2).                                      |
| m9      | Diubah C18 untuk panel. **Teks tidak konsisten** (E4).                                                  |
| m10     | Dipenuhi.                                                                                               |
| m11     | Dipenuhi untuk HP baru. Upgrade tanpa TTY bisa memicu dialog (E5).                                      |
| m12     | **Sebagian:** pola folder harus `v*` (E11).                                                             |
| m13–m18 | Dipenuhi.                                                                                               |

## 4. Yang diserang dan lolos

- **Mengganti binary yang sedang dipakai runit:** `init` berjalan dari `./panel-termux` (bukan `~/panel/panel`), menulis
  ke inode baru `panel.new`, lalu `rename()`. Tidak ada `open(O_WRONLY)` pada file yang dieksekusi, jadi tidak ada
  ETXTBSY. runsv terus menjalankan inode lama sampai langkah 10. Run perbaikan dari `~/panel/panel init`: SHA sama,
  jadi tidak ada penulisan.
- **`process.execPath`:** di macOS ia mengikuti symlink (uji: `./link` → path file asli). Di POCO,
  `/proc/<pid>/exe` = path asli dengan termux-exec 2.5.0. `$PREFIX/bin/panel init` dikenali sebagai `~/panel/panel`.
- **Versi terpasang tanpa mengeksekusi binary lama:** `/api/health` mengembalikan `version` (`boot.ts:29-33`, juga
  v0.4.0 `boot.ts:31`), dan `app_meta.panel_version` ditulis saat boot (`boot.ts:106`). Pembacaan read-only
  (`rollback.command.ts:113-119`) bisa dipakai ulang.
- **Binary di Termux bersih:** NEEDED hanya bionic sistem (debat 07 §2 "lolos"). `curl`/`sha256sum` ada di bootstrap
  (E13). `fetch` Bun membawa root CA sendiri dan sudah dipakai panel di POCO (monitor), jadi tidak bergantung pada
  `ca-certificates`.
- **Prarilis vs `releases/latest`:** prarilis dikecualikan. rc → final dengan versi sama dan SHA beda ditangani K20.
- **Shim `install.sh`:** `exec` + snippet D6. `install.sh` ≤ 0.5.0 tidak di-pipe (`curl -o … && sh install.sh`), jadi
  stdin = terminal.
- **Backup fase 0:** ada, sha256 per arsip di `MANIFEST.txt`, `RESTORE.md` lengkap sampai verifikasi. Hold saat
  backup tercatat.

## 5. Edit wajib pada PLAN/07

1. **§4.4 langkah 2 dan 4, §12, §16 (W1-tunnel, kontrak `routeDns`):** penanganan "record sudah ada" dengan konfirmasi
   TTY + `--overwrite-dns`, exit 3 tanpa TTY, dan tunnel tanpa kredensial lewat token (opsi A) (E1).
2. **§4 tabel mode, K7, langkah 0, langkah 2:** definisi "HP baru" dari data pengguna, `pkg upgrade` hanya tanpa
   `postgresql`/`PG_VERSION`, lock di `$PREFIX/tmp` (E2).
3. **Langkah 1, §4.5, §5.1 butir 8:** syarat `panel.prev` = inode proses runit = inode file, `link`+`rename`, `fsync`
   `panel.new` (E3, E16).
4. **K9, K21, §4.1 baris 310–311, §4.5 baris 429 dan 448:** satu aturan restart (E4).
5. **§4 tabel mode, §4.5 uji `poco`, L10, §17:** upgrade tanpa TTY hanya binary + symlink + restart. Langkah 2/4/9/11
   hanya lapor. Daftar persis perubahan yang diizinkan (E5).
6. **K19, langkah 1, §4.5 test, §17:** cek diri hanya saat memasang, offline = peringatan di instalasi yang ada, hash
   `panel.new`, tag lewat identifier `define`, tanpa `gh` (E6).
7. **§14 fase A:** urutan L4 → L9 → L10 → L8 → L2, syarat keluar = kedua hold kembali. Catatan pada Q9 (E7).
8. **§14 fase B–E, §4.1 urutan langkah, §16 G-lab:** SSH setelah runit bila `--ssh-key` diberikan, jalur "Batal"
   merujuk `RESTORE.md`, pembersihan tunnel lab sebelum fase D, Q15/Q16 sebagai gerbang (E8).
9. **§2.1, K20, K22:** hapus `--downgrade`, `--port`, `--tunnel`. Drop-in sshd bergantung hasil L3. Usulan ke pemilik:
   tarball keluar dari 0.5.1 (E9, E12).
10. **K24, §8.2, §13 Q14:** aturan hapus hanya di luar `~/panel/`, baris pasang `cd && curl -fL --retry 3 …`, dan
    L3 sebagian terjawab (`curl` lewat `termux-tools`, `TMPDIR`) (E10, E13).
11. **m12 di langkah 1:** pangkas hanya `~/panel-src/v[0-9]*` (E11).
12. **§16 W3, §17:** cakupan README penuh, pengecualian grep `server-termux`, README di-merge bersama tag (E14).
13. **§16 W1-dist / K25:** gate tag rc, `--prerelease`, `PANEL_RELEASE_TAG` di langkah build (E15).
14. **K23:** `rsync --partial` sebagai pengganti `scp` (E17).
15. **Langkah 6 atau §15:** kebijakan run script panel saat template berubah (E18).
