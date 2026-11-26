# Changelog

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
