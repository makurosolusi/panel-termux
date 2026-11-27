# Changelog

## [0.5.1] - 2026-11-27

### Added

- `panel init`: satu perintah untuk memasang panel di HP baru, memperbarui, dan memperbaiki. Pasang dengan satu baris dari README: `cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init`. Init memasang binary, paket, runit, PostgreSQL, `.env`, layanan panel, pm2, tunnel cloudflared, Termux:Boot, lalu menyalakan panel, setelah mencetak rencana dan meminta persetujuan.
- Mode dipilih dari keadaan HP: HP baru (semua langkah), upgrade (jalankan baris yang sama lagi: hanya binary ditukar dan panel di-restart), atau perbaiki (hanya melengkapi yang belum ada). Binary yang lebih lama dari yang terpasang ditolak dengan petunjuk `panel rollback`.
- Init hanya menanyakan yang masih kosong: alamat panel, email admin, Google Client ID dan secret (dengan redirect URI yang dicetak), dan login Cloudflare sekali klik. Nilai `.env` tidak pernah dicetak.
- Opsi `--yes`, `--dry-run` (hanya rencana, tidak mengubah apa pun), `--hostname`, `--admin-email`, `--skip postgres|tunnel|boot`, `--ssh-key <https-url|file|->` (SSH hanya dengan kunci), dan `--skip-verify`.
- Cek diri: sebelum memasang, init mencocokkan binary-nya dengan `SHA256SUMS` rilisnya. Asal rilis tetap dibuktikan dengan `gh attestation verify panel --repo makurosolusi/panel-termux` di komputer.
- Tunnel: tunnel yang kredensialnya sudah ada dipakai ulang; record DNS yang mengarah ke tunnel lain hanya dipindah setelah konfirmasi di terminal.
- Rilis kini punya aset `panel` (binary mentah). Tag `v<versi>-rc.<n>` dirilis sebagai prerelease.

### Changed

- Instal, upgrade, dan perbaikan kini lewat `panel init`. Init tidak pernah menjalankan `pkg upgrade` bila data PostgreSQL ada, menahan `cloudflared` dan `postgresql`, tidak menyentuh `ecosystem.config.js` tulisan tangan (pakai **Situs → Persiapan → Perbaiki**), tidak pernah me-restart pm2, dan hanya me-restart panel saat upgrade.
- `install.sh` rilis kini shim untuk satu rilis: mengunduh `panel`, memeriksa `SHA256SUMS`, lalu menjalankan `panel init`. Shim ini dihapus di 0.6.0.
- Petunjuk di `panel doctor`, `panel docs`, bantuan CLI, dan landing page kini menunjuk ke `panel init`.

### Removed

- `scripts/install-phone.sh`. Untuk menguji build sendiri: `rsync --partial dist/panel-android-arm64 poco: && ssh poco ./panel-android-arm64 init --yes`.

## [0.5.0] - 2026-11-27

### Added

- Perintah terminal di binary panel (jalankan dari `~/panel`): `panel -h`/`--help`/`--h` untuk bantuan (juga `panel <perintah> --help`) dan `panel -v`/`--version`/`--v` yang mencetak versi, mis. `panel-termux 0.5.0 (android-arm64, bun 1.x)`.
- `panel doctor [--json]`: memeriksa HP tanpa mengubah apa pun (paket dan hold, Termux:Boot/API, runit, `.env`, panel ganda, file `down` cloudflared, versi PostgreSQL, dan pemeriksaan kartu Persiapan dengan pesan yang sama). Kode keluar 1 hanya bila ada error; peringatan tetap 0. `--json` mencetak laporan lengkap ke stdout.
- `panel env [--full]`: mencetak template `.env` kosong ke stdout. Disarankan `panel env > .env.new`; menambah ke `.env` yang sudah berisi (`>>`) ditolak. `--full` menambah variabel opsional yang dikomentari dengan nilai bawaannya.
- `panel docs [google|cloudflare|android|paket]`: panduan offline. Topik `paket` menjelaskan kenapa `cloudflared` dan `postgresql` ditahan dari `pkg upgrade` (upgrade cloudflared dapat mematikan tunnel; PostgreSQL versi mayor baru tidak bisa memakai data lama tanpa dump dan restore) beserta cara upgrade-nya dengan aman.
- `panel rollback [--db] [--yes]`: kembali ke binary sebelumnya (`panel.prev`) lalu me-restart layanan panel. Penukaran tidak pernah membuat `~/panel/panel` hilang walau HP mati di tengah jalan. Bila database sudah dimigrasi versi baru, rollback memperingatkannya; `--db` memulihkan snapshot terbaru setelah menyimpan database sekarang sebagai `panel.db.before-rollback.<waktu>` (tidak dihapus rotasi snapshot).

### Changed

- `panel` tanpa argumen di terminal kini mencetak bantuan, bukan menyalakan server. Untuk menjalankan server secara manual, pakai `panel serve`. Layanan runit tidak berubah dan tetap menyalakan server.
- `.env.example` kini dibuat dari daftar variabel yang sama dengan `panel env --full`: `APP_BASE_URL` dan `SUPER_ADMIN_EMAILS` kosong (bukan contoh isian), `PORT` dan `PANEL_DATA_DIR` dikomentari.
- Installer hanya mengganti `panel.prev` bila panel yang terpasang sehat (atau `panel.prev` belum ada), sehingga versi terakhir yang sehat tetap tersedia untuk rollback. Petunjuk rollback dari installer kini `panel rollback [--db]`.
- Build dan CI kini menguji runtime Bun yang sama dengan yang dikirim di binary (1.4.5); build memeriksa versi runtime yang di-embed dan gagal bila berbeda.
- Installer dan `panel doctor` menghitung contoh isian lama dari `.env.example` (mis. `https://panel.example.com`) sebagai kosong.

### Fixed

- Panel kedua yang dinyalakan saat panel lain sudah menjawab di port yang sama kini keluar dengan kode 1 sebelum menyentuh kunci data atau database.
- Program yang dijalankan perintah CLI tidak lagi menerima nilai rahasia dari `.env` panel.

## [0.4.0] - 2026-11-27

### Added

- Tombol **Perbaiki** dan **Perbaiki semua** di kartu Persiapan (Situs): panel menyesuaikan `ecosystem.config.js` dan run script pm2 sendiri, tanpa membuka Termux. Sebelum menerapkan, panel menjelaskan artinya dalam bahasa awam (aplikasi tulisan tangan tetap, situs panel ditambahkan) dengan diff yang bisa dibuka, lalu memvalidasi hasilnya dengan `node`. Bila validasi gagal, file lama tetap dipakai.
- Di `ecosystem.config.js` panel hanya menambahkan blok bertanda `panel-termux:apps v1` di akhir file. Aplikasi tulisan tangan tidak diubah dan tidak di-restart; penjaga `pm2-guard` hanya ditambahkan bila tidak ada aplikasi tulisan tangan.
- **Batalkan perubahan** per file setelah perbaikan. Salinan file sebelum perbaikan disimpan di `<PANEL_DATA_DIR>/fix-backups/` (10 terakhir per file, hanya di HP, tidak ikut cadangan R2/S3).
- **Mulai ulang pm2 sekarang** (opsional) yang memeriksa semua aplikasi kembali berjalan, dan menawarkan **Kembalikan file ecosystem dan mulai ulang pm2** bila ada yang tidak kembali.
- Bila restart pm2 akan menghentikan aplikasi yang tidak tercantum di `ecosystem.config.js`, panel memperingatkan dengan menyebut nama aplikasinya dan meminta kamu mengetik `pm2` untuk melanjutkan.
- Tombol **Jalankan pm2** juga tersedia di dalam dialog restart pm2.
- Tombol **Jalankan pm2** dan **Jalankan postgres** di semua tempat yang melaporkan layanan itu mati: Persiapan, daftar dan detail situs, Riwayat perubahan, Ringkasan, halaman Aplikasi dan Database. Layanan juga menyala lagi setelah HP dinyalakan ulang.
- **Jalankan lagi** untuk situs yang tidak ada di pm2, termasuk situs adopsi (dimuat dari `ecosystem.config.js`).
- Folder situs yang belum ada bisa dibuat dari kartu Persiapan.
- **Perbaiki** juga bisa menyusun ulang `apps.json` yang rusak dari daftar situs panel, dan membuat `ecosystem.config.js` yang belum ada dari template. Keduanya bisa dibatalkan dengan **Batalkan perubahan**.
- Setelah perbaikan yang baru berlaku saat pm2 dimulai berikutnya, kartu Persiapan langsung menawarkan **Mulai ulang pm2 sekarang**.
- Rute domain yang ditulis manual di config cloudflared kini bisa dihapus dari detail situs dengan mengetik nama domainnya, tanpa ssh.
- Deploy ke situs buatan panel tanpa database yang foldernya hilang membuat ulang folder itu. Situs dengan database atau situs adopsi mendapat panduan yang jelas dengan tombol **Hapus situs** dan **Buka Cadangan**.
- DNS situs baru dibuat lewat login cloudflared HP (`cert.pem`) bila token API Cloudflare belum diisi. Menghapus record itu nanti tetap butuh token.
- Kartu record DNS siap salin (tipe, nama, isi, proxy) dengan **Periksa lagi** saat panel tidak bisa membuat DNS sendiri.
- Langkah manual untuk pengguna teknis kini ada di bagian **Cara manual (untuk pengguna teknis)** yang bisa dibuka, bukan di pesan utama.
- Data demo: `scripts/demo-seed.ts --integration <skenario>` (`ready`, `poco`, `old_spread`, `exotic`, `broken`) untuk mencoba kartu Persiapan.

### Changed

- Kartu Persiapan menampilkan satu baris per masalah, dengan alasan yang jelas bila panel tidak bisa memperbaikinya sendiri.
- Bila cloudflared membuat record DNS di zona lain, langkah DNS dilewati dan situs tetap dibuat; panel menyebut record yang perlu dihapus di dasbor Cloudflare.
- `--no-auto-exit` yang ditambahkan panel berlaku saat pm2 start berikutnya; pm2 tidak di-restart tanpa persetujuanmu.
- Ringkasan wizard Buat situs menyebut cara DNS yang benar-benar dipakai: token API, login cloudflared di HP, atau kartu record siap salin.
- Fokus pindah ke kartu Persiapan setelah perbaikan, undo, atau restart, sehingga hasilnya langsung terbaca.
- Pemberitahuan (toast) dimuat belakangan, sehingga halaman panel sekitar 9 KB lebih ringan saat pertama dibuka.

### Fixed

- `apps.json`, `.env` situs, dan `config.yml` ditulis dengan fsync (file dan folder) sebelum rename, agar tidak kosong bila HP mati tepat setelah menyimpan.
- Persiapan di HP dengan `ecosystem.config.js` tulisan tangan yang tidak menyebut `apps.json` kini menampilkan masalah yang sebenarnya, bukan baris yang tidak relevan.
- Persiapan mendeteksi ecosystem yang lupa menyebar `...panelApps`, juga saat `apps.json` masih kosong.
- Menekan **Mulai ulang pm2 sekarang** berulang kali (atau permintaan yang dikirim ulang browser) kini ikut menunggu restart yang sedang berjalan, bukan galat "sedang berjalan". Batas diam koneksi HTTP dinaikkan ke 120 detik.
- Pemeriksaan setelah restart pm2 mencakup semua aplikasi yang seharusnya berjalan, bukan hanya yang berjalan sebelum restart.
- **Batalkan perubahan** pada file yang sudah diubah di luar panel langsung menawarkan **Tetap kembalikan**.
- **Kembalikan file ecosystem dan mulai ulang pm2** tetap ditawarkan setelah restart pm2 gagal berulang kali.
- Me-restart situs yang foldernya hilang langsung gagal dengan pesan yang jelas, bukan menunggu.
- Jumlah masalah tersisa di kartu Persiapan tetap akurat setelah **Perbaiki semua**.
- Tombol salin dan tautan di HP kini punya area sentuh 44 px.
- Kartu record DNS terbaca di semua lebar layar.

## [0.3.0] - 2026-11-27

### Added

- Pasang dan upgrade dari rilis GitHub dengan satu perintah di Termux (`curl -fsSLo install.sh …/releases/latest/download/install.sh && sh install.sh`). Installer memeriksa HP, ruang kosong, dan SHA-256 unduhan sebelum memasang; rilis disertai attestation asal build. Di HP yang belum punya pm2, template pm2 ikut dipasang.
- Ringkasan yang menampilkan masalah lebih dulu (atau "Semua sehat"), dengan aktivitas terbaru sebagai kalimat, grafik baterai dan memori 24 jam/7 hari, 30 cek terakhir per domain, halaman Riwayat masalah, dan penanda jumlah masalah di menu.
- Pemantauan di latar belakang: panel memeriksa HP, layanan, aplikasi, domain, dan cadangan secara berkala, dan memberi tahu saat HP baru menyala ulang atau panel sempat berhenti tak terduga.
- Notifikasi Telegram: pesan saat masalah muncul, makin gawat, masih terbuka setelah 24 jam, dan pulih, dengan jeda agar tidak berulang. Tombol "Cari chat" dan "Kirim pesan uji" di Pengaturan.
- Situs: halaman Persiapan yang memeriksa integrasi pm2, adopsi aplikasi pm2 yang sudah berjalan, wizard dengan beberapa domain sekaligus dan pemeriksaan langsung, editor variabel lingkungan dengan tempel `.env`, "Simpan dan mulai ulang" yang mengembalikan nilai lama bila aplikasi gagal, tombol mulai ulang, dan pengaturan cek kesehatan per situs.
- Deploy yang bisa dilanjutkan: upload terputus atau halaman yang dimuat ulang bisa diteruskan dengan "Lanjutkan unggahan" selama 1 jam. File yang bukan binary yang didukung ditolak sebelum diunggah penuh.
- Dialog rollback yang menyebut versi asal dan tujuan serta apa yang tidak ikut dikembalikan; riwayat deploy per situs.
- Riwayat perubahan menampilkan tiap langkah dengan durasi dan log. Perubahan yang terputus karena panel di-restart tampil "Terputus" dan bisa dipulihkan.
- Cadangan lengkap: role Postgres, setiap database, folder situs (tanpa binary), konfigurasi tunnel, `panel.db`, dan opsional kunci rahasia, beserta `SHA256SUMS` dan `manifest.json`. Halaman Cadangan menampilkan cadangan valid terakhir tiap item, riwayat, dan perintah pulih per item.
- "Pulihkan ke database baru" untuk menguji cadangan tanpa menyentuh database asli, dan panduan "Pulihkan ke HP baru" di README.
- Kunci data: status cocok/tidak cocok, unduh salinan kunci, dan "Hapus pengaturan rahasia lama" bila kunci hilang. Panel tidak pernah menghapus pengaturan rahasia sendiri.
- Snapshot `panel.db` otomatis sebelum migrasi database saat upgrade (3 terakhir disimpan di `data/snapshots/`), dan petunjuk rollback di installer.
- Kesehatan sistem dengan vonis keseluruhan, status proses latar belakang, galat terakhir, dan panduan penyiapan 7 langkah untuk super admin.
- Pengguna: cari, filter peran, terakhir aktif, cabut sesi pengguna lain, dan "Keluarkan semua pengguna". Audit sebagai kalimat yang bisa dibaca, dengan filter aksi/pelaku/tanggal dan ekspor CSV.
- Profil: daftar sesi aktif yang bisa dicabut, pilihan tema, dan hapus akun sendiri untuk peran `user`.
- Navigasi HP: bar atas dengan judul halaman dan bar bawah dengan menu Lainnya. Semua tombol dan kontrol minimal 44 px di layar sentuh.
- Halaman perkenalan dengan panduan pasang lengkap, keterbatasan, FAQ, tangkapan layar asli panel (terang dan gelap), gambar pratinjau tautan (OG) dan ikon layar utama iOS; `robots.txt` dan `sitemap.xml`.
- Variabel env opsional `PANEL_CONNECTIVITY_URL` (alamat cek internet) dan `PANEL_SKIP_SNAPSHOT` (migrasi tanpa snapshot bila penyimpanan penuh).
- Lisensi MIT.

### Changed

- Super admin kini mendarat di `/panel`; Administrasi ada di menu samping.
- Pengaturan dibagi enam grup (Cloudflare, Cadangan, Notifikasi Telegram, Situs, Pemantauan, Keamanan), disimpan per grup, dengan uji koneksi Cloudflare, S3, dan Telegram. Token Cloudflare bisa diuji sebelum disimpan.
- Snippet `ecosystem.config.js` baru (`panelApps`) yang aman bila `apps.json` hilang atau rusak dan melewati entri yang binary-nya belum ada. Snippet lama `...require("./apps.json")` ditandai error di Persiapan; ganti dengan yang baru (README "Integrasi pm2"). `apps.json` dibuat panel saat start.
- Deploy dianggap sehat hanya bila port menjawab dan pm2 menunjukkan proses yang sama tanpa restart baru; batas waktu cek kesehatan bisa diatur per situs (10-300 detik, default 60).
- Retensi cadangan selalu menyimpan run berhasil terbaru (`backup.keep_min_runs`) dan cadangan valid terakhir tiap item. Token penyimpanan tanpa izin hapus didukung; retensi lalu diserahkan ke lifecycle rule bucket.
- Aksi sensitif (unduh atau reset kunci data, unduh item rahasia, mengubah tujuan cadangan) meminta "Masuk ulang" bila login lebih dari 15 menit. Sesi berlaku paling lama 30 hari.
- Audit mencatat pelaku, IP yang disamarkan, dan perangkat untuk setiap perubahan, termasuk akun baru, keluar, dan pencabutan sesi (dengan nama targetnya). Entri lebih tua dari `audit.retention_days` (default 365 hari) dihapus otomatis.
- Layanan `panel` dan `cloudflared` tidak bisa dihentikan dari panel; layanan inti lain hanya dengan mengetik namanya. Restart panel ditolak selama perubahan situs atau cadangan berjalan.
- `sv restart panel` menunggu perubahan situs yang sedang berjalan sampai 2 menit sebelum panel berhenti.
- Waktu relatif tanpa detik ("3 mnt lalu", "dalam 5 mnt"), label perangkat dalam bahasa Indonesia, dan halaman log yang menyamarkan nilai rahasia yang dikenal.
- Resep Cloudflare Access tidak lagi melindungi `/profile`.
- Aplikasi penjaga `pm2-guard` disembunyikan dari daftar Aplikasi. Jangan hapus dari `ecosystem.config.js` (README "Integrasi pm2").
- Mode fake menjadi HP demo yang sehat dan sepenuhnya offline, dengan file demo di `<PANEL_DATA_DIR>/fake-home`; `scripts/demo-seed.ts` mengisi data dir demo untuk QA dan screenshot.

### Fixed

- Kartu Domain di Ringkasan ikut menghitung domain yang tertahan oleh masalah lain.
- Situs panel kini terhubung ke domain dan port-nya di daftar Aplikasi, juga setelah "Cek ulang".
- Fokus kembali ke tombol pemicu setelah dialog konfirmasi, adopsi, dan tempel `.env` ditutup.
- Pilihan di menu dan dropdown setinggi minimal 44 px di layar sentuh.
- Dialog tambah domain merapikan alamat yang ditempel lengkap dengan `https://` atau path.
- "Deploy terakhir" di daftar dan detail situs menandai deploy yang tidak berhasil, dan alasan gagal di halaman perubahan tidak lagi tampil dua kali.
- Halaman tetap menampilkan data terakhir tanpa dimuat ulang dari awal bila penyegaran gagal.
- Halaman yang gagal memuat bagiannya saat server tidak terjangkau kini menampilkan "Server panel tidak terjangkau" di dalam aplikasi, bukan halaman kosong.
- Suhu baterai yang tidak terbaca tampil "tidak ada data", bukan 0 °C.
- Menghapus situs yang punya database ditolak selama cadangan berjalan, dan upload deploy yang belum selesai ikut dihapus bersama situsnya.
- Cadangan dan pemulihan yang terputus karena panel di-restart ditandai terputus, bukan berjalan selamanya.
- Situs yang tercatat di panel tetapi tidak ada di pm2 ditandai "Tidak berjalan di pm2".
- Panel tidak lagi menyalakan daemon pm2 kedua saat layanan pm2 mati; halaman menampilkan "pm2 tidak berjalan".
- Uji pemulihan selesai tanpa perlu memuat ulang halaman, dan tabel domain muat di layar desktop.
- Hapus akun menjelaskan bahwa catatan audit tetap disimpan, lalu kembali ke halaman awal dengan pemberitahuan.
- Daftar situs dan pengaturan tidak lagi menjalankan satu query database per item.

### Breaking (API admin)

Hanya berpengaruh pada skrip yang memanggil API panel langsung:

- `PUT /api/dev/settings/:key` dihapus; pakai `PATCH /api/dev/settings` per grup.
- Log layanan/aplikasi dikembalikan sebagai `LogChunk` (`{ lines: [{ at, text, stream? }], cursor, reset, truncated, redacted }`), menggantikan `LogLines`.
- `Problem.message` dihapus; teks masalah dibentuk dari `code` dan `params`.

## [0.2.2] - 2026-11-26

### Security

- Permintaan yang mengubah data (menjalankan/menghentikan layanan, membuat/menghapus site, deploy, mengubah pengguna dan pengaturan, dll.) kini hanya diterima dari halaman panel sendiri. Halaman lain, termasuk site yang di-host di subdomain yang sama, tidak bisa lagi memicu aksi atas nama kamu saat kamu sedang login.

## [0.2.1] - 2026-11-26

### Fixed

- Panel di belakang Cloudflare Access langsung menampilkan login Access saat sesi belum ada/habis, bukan galat jaringan.

## [0.2.0] - 2026-11-26

### Added

- Halaman perkenalan publik di `/` yang bisa dibuka tanpa login: kenapa HP bekas, fitur, langkah pemasangan, diagram tunnel, dan FAQ. Tombolnya "Masuk dengan Google" untuk tamu atau "Buka panel" ke halaman awal peran bila sudah login. Setelah login Google kamu tetap langsung masuk ke halaman awal peranmu, dan alamat yang tidak dikenal kini menampilkan halaman perkenalan.

### Fixed

- `scripts/install-phone.sh` kini berhasil menjalankan `sv restart panel` saat dipanggil lewat ssh (sebelumnya `sv` tidak menemukan service karena `SVDIR` tidak di-set).

## [0.1.0] - 2026-11-26

### Added

- Login Google untuk semua akun Google dengan tiga peran: `user` (/profile), `admin` (/panel) dan `super_admin` (/dev). Akun baru masuk sebagai `user`; super admin menjadikannya `admin` di /dev → Pengguna. Super admin diambil dari `SUPER_ADMIN_EMAILS` dan disinkronkan ulang setiap login dan setiap panel menyala.
- Membuka panel lewat alamat lain otomatis diarahkan ke `APP_BASE_URL`, sehingga login Google selalu berjalan di alamat yang terdaftar.
- Dev console (/dev): kesehatan panel, kelola pengguna dan peran, audit log, log panel, dan pengaturan runtime (Cloudflare, folder dan port site, layanan yang dilindungi, backup). Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.
- Panel (/panel): ringkasan perangkat (baterai, suhu, memori, penyimpanan, beban), layanan runit dan aplikasi pm2 beserta tombol start/stop/restart dan log-nya, daftar domain tunnel dengan cek kesehatan, dan daftar database Postgres.
- Site: buat site baru (folder, database Postgres opsional, `.env`, entri pm2 di `apps.json`, ingress cloudflared, DNS CNAME Cloudflare) sebagai job bertahap yang otomatis di-rollback bila gagal; adopsi site lama yang ditulis tangan; tambah/hapus hostname; ubah `.env`; hapus site.
- Deploy binary site lewat browser dengan upload bertahap (aman di balik batas 100 MB Cloudflare), deteksi otomatis binary Android (jalan langsung) atau glibc (lewat `grun`), cek kesehatan setelah restart, rollback otomatis bila gagal, dan tombol kembali ke versi sebelumnya.
- Backup harian ke S3/Cloudflare R2: dump setiap database Postgres dan `panel.db`, retensi otomatis, jalankan manual, link unduh sementara, dan petunjuk restore per item.
- Satu binary untuk Termux (`dist/panel-android-arm64`) yang jalan langsung tanpa `grun`, plus run script runit dan `scripts/install-phone.sh` untuk instal/upgrade di HP.
