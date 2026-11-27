# Panduan konten Panel Termux

Acuan menulis semua teks antarmuka (`src/web/i18n/*.ts`), landing page, dan pesan error. Bila ragu, pilih kata yang paling jelas untuk orang yang baru pertama kali membuka panel.

## Suara dan nada

- **Jelas, tenang, langsung.** Sebut apa yang terjadi dan apa yang bisa dilakukan. Tanpa basa-basi, tanpa tanda seru, tanpa menyalahkan pengguna.
- Sapa pengguna dengan **"kamu"**. Hindari "Anda", "user", dan "Silakan" berulang.
- Kalimat pendek, kata kerja aktif. "Simpan perubahan", bukan "Perubahan dapat disimpan".
- Istilah teknis dipakai bila memang itu yang dicari pengguna (pm2, runit, cloudflared, `.env`, port). Tulis dalam format kode bila berupa nama file, perintah, atau variabel.

## Nama produk

- Di teks yang dibaca pengguna: **Panel Termux**. Merujuk ke aplikasinya sendiri di dalam kalimat boleh "panel" (huruf kecil).
- `panel-termux` hanya di konteks teknis: nama repo, nama binary, URL GitHub, perintah.

## Glosarium

Satu istilah untuk satu konsep. Jangan bergantian.

| Konsep (kode)     | Pakai                                                                   | Jangan                 | Catatan                                                                                                           |
| ----------------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| site              | **Situs**                                                               | Site, web              | "Buat situs", "Hapus situs"                                                                                       |
| runit service     | **Layanan**                                                             | Service                | sshd, postgres, pm2, cloudflared                                                                                  |
| pm2 app           | **Aplikasi**                                                            | App                    |                                                                                                                   |
| hostname          | **Domain**                                                              | Hostname, host         |                                                                                                                   |
| database          | **Database**                                                            | Basis data, DB         | "DB" hanya di ruang sempit teknis                                                                                 |
| backup            | **Cadangan**                                                            | Backup                 | Tombol: "Cadangkan sekarang". Nama file/perintah teknis tetap                                                     |
| restore           | **Pulihkan**                                                            | Restore                | "Perintah pemulihan"                                                                                              |
| deploy            | **Deploy**                                                              | Rilis, Penyebaran      | Kata serapan yang lazim di kalangan developer; huruf kecil di tengah kalimat                                      |
| rollback          | **Rollback** (label riwayat) / **Kembalikan versi sebelumnya** (tombol) | Revert                 |                                                                                                                   |
| job               | **Perubahan**                                                           | Job, Tugas             | "Riwayat perubahan", "Progres perubahan"                                                                          |
| overview          | **Ringkasan**                                                           | Overview, Dashboard    |                                                                                                                   |
| health (`/dev`)   | **Kesehatan sistem**                                                    | Health                 |                                                                                                                   |
| `/dev` console    | **Administrasi**                                                        | Dev, Developer, Sistem | Label menu dan judul halaman; path URL tetap `/dev`. "Sistem" dipakai untuk aktor otomatis di audit dan opsi tema |
| user              | **Pengguna**                                                            | User                   | Nama peran: Pengguna, Admin, Super Admin                                                                          |
| role              | **Peran**                                                               | Role                   |                                                                                                                   |
| audit log         | **Audit** / **Log audit**                                               |                        |                                                                                                                   |
| log               | **Log**                                                                 | Catatan                |                                                                                                                   |
| settings          | **Pengaturan**                                                          | Setting, Konfigurasi   |                                                                                                                   |
| uptime            | **Waktu aktif**                                                         | Uptime                 | Di baris meta: "aktif 3 jam"                                                                                      |
| heap              | **Memori JS (heap)**                                                    | Heap                   |                                                                                                                   |
| RSS memory        | **Memori**                                                              | RAM terpakai           |                                                                                                                   |
| disk / data dir   | **Penyimpanan**                                                         | Disk                   |                                                                                                                   |
| session           | **Sesi**                                                                | Session                |                                                                                                                   |
| token             | **Token**                                                               |                        | "Token API Cloudflare"                                                                                            |
| tunnel            | **Tunnel**                                                              | Terowongan             | "Cloudflare Tunnel", "tunnel cloudflared"                                                                         |
| env vars          | **Variabel lingkungan**                                                 | Env, environment       | Nama file tetap `.env`                                                                                            |
| upload / download | **Unggah** / **Unduh**                                                  | Upload, Download       |                                                                                                                   |
| online (status)   | **Berjalan**                                                            | Online                 |                                                                                                                   |
| errored (status)  | **Bermasalah**                                                          | Error                  |                                                                                                                   |
| demo / fake mode  | **Mode demo**                                                           | Fake                   |                                                                                                                   |

## Kapitalisasi

- **Huruf kapital di awal saja** (sentence case) untuk judul, label, tombol, menu: "Riwayat perubahan", bukan "Riwayat Perubahan".
- Nama diri tetap: Panel Termux, Cloudflare, Google, PostgreSQL, Bun, Android, Termux, Super Admin.
- Nama perintah, file, dan layanan ditulis apa adanya: `pm2`, `cloudflared`, `sshd`.

## Angka, tanggal, waktu

Semua memakai locale `id-ID`.

| Jenis           | Format                                                                                                              | Contoh                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Tanggal dan jam | tanggal pendek + jam dengan titik                                                                                   | 26 Nov 2026, 21.26                                                |
| Jam saja        | HH.MM                                                                                                               | 03.00                                                             |
| Durasi          | dua satuan terbesar, satuan disingkat konsisten                                                                     | 7 mnt 17 dtk · 1 hari 9 jam · 42 dtk                              |
| Relatif         | tanpa detik: angka + satuan + "lalu", masa depan "dalam …"; di bawah 1 menit "baru saja"; hari sebelumnya "kemarin" | 3 mnt lalu · 1 jam 5 mnt lalu · dalam 5 mnt · baru saja · kemarin |
| Desimal         | koma                                                                                                                | 1,5 GB                                                            |
| Ribuan          | titik                                                                                                               | 12.480                                                            |

Singkatan satuan waktu hanya: **hari**, **jam**, **mnt**, **dtk**. Jangan "h", "j", "m", "d" (ambigu dengan hours/minutes/days).

## Satuan

- Ukuran: B, KB, MB, GB, TB. **GB dan TB dengan 1 desimal** ("12,4 GB"), MB tanpa desimal bila ≥ 100.
- Suhu: "36,5 °C" (spasi sebelum °C).
- Persen: "72%" (tanpa spasi).
- Sisa ruang: "12,4 GB bebas dari 64,0 GB".

## Kata kerja tombol

Tombol diawali kata kerja dan menyebut hasilnya. Pakai daftar ini:

| Aksi                       | Tombol                                           |
| -------------------------- | ------------------------------------------------ |
| Menyimpan                  | Simpan                                           |
| Membatalkan dialog         | Batal                                            |
| Menghapus                  | Hapus (di dialog: "Hapus situs", "Hapus domain") |
| Menjalankan                | Mulai                                            |
| Menghentikan               | Hentikan                                         |
| Restart                    | Mulai ulang                                      |
| Mengulang permintaan gagal | Coba lagi                                        |
| Membuat                    | Buat situs, Tambah domain                        |
| Menutup panel/dialog info  | Tutup                                            |
| Menyalin                   | Salin                                            |

Jangan memakai "OK", "Ya", atau "Submit" di dialog. Tombol konfirmasi mengulang kata kerja aksinya.

## Pola pesan

### Pesan error

**Apa yang terjadi + kenapa (bila tahu) + apa yang bisa dilakukan.**

- ✅ "Tidak bisa terhubung ke server. Periksa koneksi internet, lalu coba lagi."
- ✅ "Cadangan lain sedang berjalan. Tunggu sampai selesai, lalu coba lagi."
- ❌ "Permintaan gagal." (tidak memberi langkah berikutnya)
- ❌ "Error 500" (kode tanpa penjelasan)

Jangan menampilkan pesan teknis mentah sebagai satu-satunya isi. Detail server boleh ditampilkan di bawahnya.

### Pekerjaan teknis: panel yang mengerjakan

Jangan pernah menyuruh pengguna mengerjakan hal teknis dengan tangan (menjalankan perintah di Termux, membuka ssh, mengedit file) bila panel bisa mengerjakannya sendiri. Beri tombol yang melakukannya: "Perbaiki", "Jalankan pm2", "Jalankan lagi".

- Pesan utama menyebut apa yang terjadi dan tombolnya: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti. Tekan Jalankan pm2, lalu coba lagi."
- Langkah manual (perintah, path file, blok untuk ditempel) hanya di bagian lipat **"Cara manual (untuk pengguna teknis)"**, tertutup secara bawaan. Buka otomatis hanya bila panel tidak bisa memperbaikinya sendiri, dan sebut alasannya.
- ✅ "Panel tidak bisa memperbaiki ini otomatis. Ikuti Cara manual di kartu Persiapan."
- ❌ "Jalankan `sv up pm2` di HP." / "Perbaiki lewat ssh."

### Status kosong

**Apa isi bagian ini + aksi pertama.**

- ✅ "Belum ada situs. Buat situs pertama untuk menghubungkan domain ke aplikasi."
- ❌ "Tidak ada data."

### Dialog konfirmasi

- Judul: pertanyaan dengan kata kerja + objek: "Hapus situs blog?"
- Isi: **akibatnya dulu**, lalu apa yang tetap aman. Sebut bila tidak bisa dibatalkan.
- Tombol: kata kerja yang sama dengan judul. Aksi berbahaya memakai varian merah.

### Toast

- Kalimat pendek, **bentuk lampau**, satu hal: "Pengaturan disimpan.", "sshd dimulai ulang."
- Toast gagal mengikuti pola pesan error.

### Teks bantuan dan status data

- Jangan menulis interval teknis yang statis ("Diperbarui otomatis tiap 15 detik"). Tampilkan kapan data terakhir diperbarui: "Diperbarui 3 mnt lalu", di bawah 1 menit "Diperbarui baru saja" (`id.common.updatedAgo`; potongan waktu relatif ada di `id.shell.time`).
- Placeholder memberi contoh, diawali "mis.": "mis. blog.contoh.com".

## Landing page

- Hanya klaim yang bisa dibuktikan: satu binary native Android, sekitar 65 MB RAM (diukur di HP), tanpa root, tanpa Docker, Cloudflare Tunnel tanpa IP publik, wizard situs dengan rollback, deploy dari browser dengan rollback, cadangan harian ke R2/S3, login Google dengan peran.
- Tanpa angka karangan, testimoni, atau superlatif ("terbaik", "tercepat").
- Manfaat dulu, detail teknis sesudahnya.
