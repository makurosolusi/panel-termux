# Changelog

## [0.1.0] - 2026-11-26

### Added

- Login Google khusus undangan dengan tiga peran: `user` (/profile), `admin` (/panel) dan `super_admin` (/dev). Super admin diambil dari `SUPER_ADMIN_EMAILS` dan disinkronkan ulang setiap login dan setiap panel menyala.
- Dev console (/dev): kesehatan panel, kelola pengguna dan peran, undangan, audit log, log panel, dan pengaturan runtime (Cloudflare, folder dan port site, layanan yang dilindungi, backup). Nilai rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.
- Panel (/panel): ringkasan perangkat (baterai, suhu, memori, penyimpanan, beban), layanan runit dan aplikasi pm2 beserta tombol start/stop/restart dan log-nya, daftar domain tunnel dengan cek kesehatan, dan daftar database Postgres.
- Site: buat site baru (folder, database Postgres opsional, `.env`, entri pm2 di `apps.json`, ingress cloudflared, DNS CNAME Cloudflare) sebagai job bertahap yang otomatis di-rollback bila gagal; adopsi site lama yang ditulis tangan; tambah/hapus hostname; ubah `.env`; hapus site.
- Deploy binary site lewat browser dengan upload bertahap (aman di balik batas 100 MB Cloudflare), deteksi otomatis binary Android (jalan langsung) atau glibc (lewat `grun`), cek kesehatan setelah restart, rollback otomatis bila gagal, dan tombol kembali ke versi sebelumnya.
- Backup harian ke S3/Cloudflare R2: dump setiap database Postgres dan `panel.db`, retensi otomatis, jalankan manual, link unduh sementara, dan petunjuk restore per item.
- Satu binary untuk Termux (`dist/panel-android-arm64`) yang jalan langsung tanpa `grun`, plus run script runit dan `scripts/install-phone.sh` untuk instal/upgrade di HP.
