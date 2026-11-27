# Pengaturan Android supaya server tidak mati

Android suka menghentikan aplikasi di belakang layar. Pengaturan di bawah ini menjaga Termux,
panel, dan situs tetap berjalan saat layar mati dan setelah HP dinyalakan ulang.

## 1. Pasang Termux dari sumber yang benar

Pasang Termux (`com.termux`) dari F-Droid atau GitHub (github.com/termux/termux-app/releases).
Versi Play Store berbeda dan tidak cocok. Termux:Boot dan Termux:API harus dari sumber yang
sama dengan Termux, karena tanda tangannya harus cocok. Jangan campur F-Droid dengan GitHub.

## 2. Termux:Boot (menyalakan layanan saat HP hidup)

1. Pasang aplikasi Termux:Boot (`com.termux.boot`).
2. Buka Termux:Boot sekali dari laci aplikasi. Tanpa dibuka sekali, Android tidak
   menjalankannya saat HP menyala.
3. Skrip di `~/.termux/boot/` dijalankan setiap HP menyala. Skrip itu memanggil
   `termux-wake-lock` dan menyalakan layanan runit (paket `termux-services`).

## 3. Termux:API (baterai, wake-lock, membuka tautan)

1. Pasang aplikasi Termux:API (`com.termux.api`).
2. Di Termux: `pkg install termux-api`
3. Coba: `termux-battery-status`. Bila mencetak JSON, berarti sudah tersambung.

## 4. Baterai tanpa batasan

Pengaturan → Aplikasi → Termux → Baterai → pilih Tanpa batasan (nama menu beda per merek:
"Unrestricted", "Tidak dioptimalkan", "Tanpa batasan"). Ulangi untuk Termux:Boot dan
Termux:API. Di HP Xiaomi/POCO juga nyalakan Mulai otomatis (Autostart) untuk ketiganya.

## 5. Wake-lock

`termux-wake-lock` menjaga CPU tetap jalan saat layar mati. Saat pertama dipakai, HP bertanya
soal izin baterai: pilih Izinkan. Notifikasi Termux lalu menampilkan "wake lock held".
Melepas: `termux-wake-unlock`.

## 6. Pembatas proses anak (Android 12 ke atas)

Android 12+ menghentikan proses anak bila jumlahnya terlalu banyak, dan pm2 dengan beberapa
situs mudah melewati batas itu.

- Android 14 ke atas: Opsi pengembang → nyalakan "Disable child process restrictions"
  (Nonaktifkan pembatasan proses turunan).
- Android 12 dan 13: dari komputer dengan adb, jalankan:

```
adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
```

Periksa semuanya sekaligus: `panel doctor`.
