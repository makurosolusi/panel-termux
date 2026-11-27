# panel-termux

Panel web untuk mengelola server HP Android (Termux): layanan runit, aplikasi pm2, domain Cloudflare Tunnel, database Postgres, site, deploy binary, dan backup. Akses lewat login Google.

## Layar dan peran

| Peran         | Halaman awal | Isi                                                                                                                                      |
| ------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `user`        | `/profile`   | Profil sendiri: sesi aktif, tema, hapus akun                                                                                             |
| `admin`       | `/panel`     | Ringkasan, Situs (buat/adopsi/deploy/hapus), Layanan runit, Aplikasi pm2, Domain, Database, Cadangan, Riwayat perubahan, Riwayat masalah |
| `super_admin` | `/panel`     | Semua isi `admin`, plus Administrasi di `/dev`: Kesehatan sistem, Pengguna, Audit, Log, Pengaturan                                       |

Peran lebih tinggi bisa membuka semua halaman peran di bawahnya. Super admin juga mendarat di `/panel`; Administrasi ada di menu samping (di HP: menu **Lainnya** di bar bawah).

`/` adalah halaman perkenalan publik (tanpa login); tombolnya "Masuk dengan Google" untuk tamu atau "Buka panel" ke halaman awal peran bila sudah login. Setelah login Google, pengguna kembali ke `/login` lalu diteruskan ke halaman awal perannya. Alamat yang tidak dikenal menjawab 404: tamu melihat halaman "tidak ditemukan" publik dengan tautan ke `/`, pengguna yang sudah login melihat 404 di dalam panel.

## Arsitektur singkat

- Satu binary hasil `bun build --compile`: server Elysia (`/api/*`) dan SPA React yang di-embed (`/*`).
- SQLite (`panel.db`) di `PANEL_DATA_DIR`; migrasi Drizzle ikut di-embed dan jalan otomatis saat boot. Sebelum migrasi baru dijalankan pada database yang sudah ada, panel menyimpan snapshot `panel.db` (lihat [Rollback](#rollback)).
- Auth: Better Auth + Google OAuth.
- Adapter sistem (runit, pm2, cloudflared, postgres, perangkat): mode `termux` dipilih otomatis bila `$PREFIX/bin/sv` ada, selain itu `fake` (HP demo yang sehat dan sepenuhnya offline, untuk development dan QA). Mode yang dipakai tercatat di log saat start.
- Satu sampler di latar belakang membaca HP, layanan, aplikasi, dan domain secara berkala; halaman panel membaca hasil terakhirnya (lihat [Pemantauan dan notifikasi](#pemantauan-dan-notifikasi)).
- Panel hanya listen di `127.0.0.1`. Akses dari luar lewat Cloudflare Tunnel.

## Kebutuhan

- Development: [Bun](https://bun.sh) (versi yang ada di `bun.lock`/`@types/bun`), macOS/Linux.
- HP: Android 64-bit (arm64), Termux dari F-Droid/GitHub dengan `termux-services` (runit) dan Termux:API (untuk baterai), `pm2` yang dijalankan runit dan membaca `~/sites/ecosystem.config.js` (lihat [Integrasi pm2](#integrasi-pm2-appsjson)), `cloudflared` sebagai service runit dengan `~/.cloudflared/config.yml`, PostgreSQL lokal (role `postgres`, atau set `PGUSER`), `curl`. `grun` hanya perlu untuk site dengan binary glibc. Repo [server-termux](https://github.com/makurosolusi/server-termux) memasang semua ini.
- Akun Google Cloud (OAuth client) dan domain di Cloudflare.

## Google OAuth client

1. console.cloud.google.com → APIs & Services → Credentials → Create credentials → OAuth client ID, tipe **Web application**.
2. Authorized redirect URIs:
   - `${APP_BASE_URL}/api/auth/callback/google`, mis. `https://panel.example.com/api/auth/callback/google`
   - untuk development lokal: `http://localhost:3200/api/auth/callback/google` (sesuaikan port)
3. Salin Client ID dan Client secret ke `.env`.

Google hanya menerima domain https publik atau `localhost`; IP Tailscale/LAN tidak bisa dipakai sebagai `APP_BASE_URL`.

## Konfigurasi (env)

Hanya empat variabel wajib (lihat `.env.example`):

| Variabel                                   | Keterangan                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`                             | URL publik panel (dipakai untuk redirect OAuth)                                                                                                                                                    |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client di atas                                                                                                                                                                               |
| `SUPER_ADMIN_EMAILS`                       | Email super admin, dipisah koma                                                                                                                                                                    |
| `PORT` (opsional)                          | Default `3200`                                                                                                                                                                                     |
| `PANEL_DATA_DIR` (opsional)                | Default `./data` (relatif ke working dir): berisi `panel.db`, `secret` (kunci data), `snapshots/`, `fix-backups/` (salinan file sebelum perbaikan Persiapan), dan upload deploy yang belum selesai |
| `PANEL_CONNECTIVITY_URL` (opsional)        | URL yang dicek sampler untuk tahu apakah HP punya internet. Default `https://www.gstatic.com/generate_204`. Ganti bila alamat itu diblokir di jaringanmu                                           |
| `PANEL_SKIP_SNAPSHOT` (opsional)           | `1` = tetap migrasi walau snapshot pra-migrasi gagal (mis. penyimpanan penuh). Hanya untuk satu kali start; hapus lagi setelahnya. Lihat [Rollback](#rollback)                                     |

Bun memuat `.env` otomatis dari working directory. Panel menolak start dan menyebut nama variabel (bukan nilainya) bila ada yang kosong atau tidak valid.

Semua pengaturan lain diisi di **Administrasi → Pengaturan** (`/dev/settings`), dalam enam grup. Tiap grup disimpan sekaligus; nilai rahasia disimpan terenkripsi dengan kunci data dan tidak pernah ditampilkan lagi. Grup Cloudflare, Cadangan, dan Notifikasi Telegram punya tombol uji koneksi.

| Grup                | Key                            | Label di panel                  | Default                               | Keterangan                                                                                                                                                                             |
| ------------------- | ------------------------------ | ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare          | `cloudflare.api_token`         | Token API Cloudflare            | –                                     | Rahasia. Izin **Zone:Read** dan **DNS:Edit** (mencari zone dan membuat CNAME site ke tunnel). Tanpa token, langkah DNS dilewati dan record dibuat manual. Bisa diuji sebelum disimpan. |
| Cloudflare          | `cloudflare.account_id`        | ID akun Cloudflare              | –                                     | 32 hex. Perlu untuk memverifikasi token milik akun (account-owned token).                                                                                                              |
| Cadangan            | `backup.s3_endpoint`           | Endpoint S3                     | –                                     | Path-style, mis. `https://<account>.r2.cloudflarestorage.com`.                                                                                                                         |
| Cadangan            | `backup.s3_bucket`             | Nama bucket                     | –                                     | Bucket tujuan.                                                                                                                                                                         |
| Cadangan            | `backup.s3_region`             | Region                          | `auto`                                | R2 memakai `auto`.                                                                                                                                                                     |
| Cadangan            | `backup.s3_access_key_id`      | Access key ID                   | –                                     | Rahasia.                                                                                                                                                                               |
| Cadangan            | `backup.s3_secret_access_key`  | Secret access key               | –                                     | Rahasia.                                                                                                                                                                               |
| Cadangan            | `backup.prefix`                | Awalan folder                   | `panel-termux/`                       | Retensi hanya menghapus di bawah awalan ini. Harus diakhiri `/`. Pakai awalan berbeda bila satu bucket dipakai beberapa HP.                                                            |
| Cadangan            | `backup.hour`                  | Jam cadangan harian             | `3`                                   | Jam lokal (0-23), atau `off` untuk manual saja.                                                                                                                                        |
| Cadangan            | `backup.retention_days`        | Simpan cadangan (hari)          | `14`                                  | 1-365. Lihat [Retensi](#cadangan-dan-pemulihan).                                                                                                                                       |
| Cadangan            | `backup.keep_min_runs`         | Cadangan berhasil minimal       | `3`                                   | 1-50. Jumlah run berhasil terbaru yang tidak pernah dihapus retensi.                                                                                                                   |
| Cadangan            | `backup.max_item_mb`           | Batas per file (MB)             | `2048`                                | File cadangan yang lebih besar tidak diunggah dan ditandai di riwayat.                                                                                                                 |
| Cadangan            | `backup.include_secrets`       | Ikut cadangkan kunci rahasia    | `off`                                 | `on` = kunci data, `.env` panel, dan kredensial tunnel ikut ke bucket. Siapa pun yang bisa membaca bucket bisa mengambil alih panel. Menyalakannya butuh sesi segar.                   |
| Notifikasi Telegram | `alerts.enabled`               | Notifikasi Telegram             | `on`                                  | Matikan sementara tanpa menghapus token.                                                                                                                                               |
| Notifikasi Telegram | `alerts.telegram_bot_token`    | Token bot Telegram              | –                                     | Rahasia. Dari @BotFather.                                                                                                                                                              |
| Notifikasi Telegram | `alerts.telegram_chat_id`      | ID chat Telegram                | –                                     | ID angka atau `@kanal`. Tombol "Cari chat" mengisinya setelah kamu mengirim pesan ke bot.                                                                                              |
| Notifikasi Telegram | `alerts.min_severity`          | Kirim mulai dari                | `warning`                             | `warning` (semua masalah, peringatan dikirim senyap) atau `danger` (hanya yang gawat).                                                                                                 |
| Situs               | `sites.dir`                    | Folder situs                    | `~/sites`                             | `apps.json` dan `ecosystem.config.js` ada di sini.                                                                                                                                     |
| Situs               | `sites.port_range`             | Rentang port situs              | `3001-3999`                           | Port lokal untuk site baru.                                                                                                                                                            |
| Pemantauan          | `monitor.sample_interval_sec`  | Interval pemantauan (detik)     | `60`                                  | 30-600. Lebih besar = lebih hemat baterai dan tulis flash.                                                                                                                             |
| Pemantauan          | `monitor.battery_warn_percent` | Peringatan baterai di bawah (%) | `25`                                  | 16-100 atau `off`. Hanya saat HP tidak mengisi; di bawah 15% selalu gawat.                                                                                                             |
| Keamanan            | `panel.protected_services`     | Layanan inti                    | `sshd,cloudflared,panel,pm2,postgres` | Hanya bisa dihentikan dengan mengetik namanya. `panel` dan `cloudflared` tidak pernah bisa dihentikan dari panel, walau dilepas dari daftar.                                           |
| Keamanan            | `audit.retention_days`         | Simpan log audit (hari)         | `365`                                 | 90-3650. Entri lebih tua dihapus otomatis (saat boot dan tiap hari).                                                                                                                   |

## Development lokal

```sh
bun install
cp .env.example .env   # isi: APP_BASE_URL=http://localhost:3200, client Google, email Anda
bun run dev            # hot reload, adapter mode fake (bukan Termux)
```

Buka `APP_BASE_URL` (alamat yang dicetak setelah `open` di log start, mis. `http://localhost:3200`); membuka lewat alamat lain (mis. `127.0.0.1`) otomatis diarahkan ke sana. Di mode fake, layanan/aplikasi/domain adalah data demo dari HP yang sehat, dan panel tidak menghubungi luar sama sekali (S3, Telegram, DNS Cloudflare, dan cek internet dijawab klien offline). File demo (folder situs, `ecosystem.config.js`, `config.yml`) ada di `<PANEL_DATA_DIR>/fake-home` dan bertahan antar-restart.

### Data demo untuk QA dan screenshot

```sh
bun scripts/demo-seed.ts --data-dir /tmp/panel-demo --base-url http://demo.localhost:3421
SUPER_ADMIN_EMAILS=demo@contoh.test PANEL_DATA_DIR=/tmp/panel-demo APP_BASE_URL=http://demo.localhost:3421 PORT=3421 bun run dev
```

Seed mengisi data dir **baru** dengan data fiktif (situs, perubahan, deploy, cadangan, audit, 7 hari metrik, satu domain bermasalah, satu aplikasi yang bisa diadopsi, satu situs yang bisa dikembalikan) dan menulis cookie sesi untuk `user`, `admin`, dan `super_admin` ke `demo-cookies.json` (mode 600) di data dir itu. Seed menolak `./data` dan `~/panel`, dan hanya mau mengisi ulang data dir yang dulu dibuatnya. `SUPER_ADMIN_EMAILS` harus memuat `demo@contoh.test`, karena boot menurunkan super admin yang tidak ada di env. `--integration <skenario>` memilih keadaan kartu Persiapan: `ready` (default), `poco` (ecosystem tulisan tangan tanpa blok panel dan run script tanpa `--no-auto-exit`), `old_spread` (snippet 0.2.x), `exotic` (file bukan UTF-8), atau `broken` (ecosystem tidak bisa dimuat). Jalankan tiap instance di host sendiri (`demo1.localhost`, `demo2.localhost`): cookie browser berlaku per host, bukan per port.

## Test, lint, typecheck

```sh
bun test
bun run lint        # biome check .
bun run typecheck   # tsc --noEmit
bun run bundle:check                  # anggaran ukuran bundle per halaman
sh scripts/install-phone.test.sh      # uji install-phone.sh dengan stub sv/curl
sh scripts/install-release.test.sh    # uji install.sh rilis
sh scripts/package-release.test.sh    # uji pembuatan aset rilis
```

## Build

```sh
bun run build         # dist/panel-android-arm64 (target bun-linux-arm64-android), untuk HP
bun run build:local   # dist/panel, untuk mesin saat ini
```

Binary Android jalan langsung di Termux tanpa `grun` (sekitar 65 MB RSS).

### Rilis

Rilis dibuat oleh `.github/workflows/release.yml` saat tag `v*` di-push: typecheck, lint, test, `bun audit`, test shell, cek bahwa tag = `v` + versi `package.json` dan `CHANGELOG.md` punya `## [<versi>]`, build Android, lalu `scripts/package-release.sh` membuat tiga aset: `panel-termux-android-arm64.tar.gz`, `install.sh`, dan `SHA256SUMS`, plus attestation asal build.

Sebelum membuat tag, jalankan workflow itu sekali lewat **Actions → release → Run workflow** dengan `dry_run` = `true` (default): semua langkah jalan dengan tag `v0.0.0-dryrun` tanpa membuat rilis.

## Instal di HP

1. Di Termux, unduh dan jalankan installer rilis terbaru:

   ```sh
   curl -fsSLo install.sh https://github.com/makurosolusi/panel-termux/releases/latest/download/install.sh && sh install.sh
   ```

   Installer memeriksa HP (arm64, `termux-services`, ruang kosong minimal 400 MB; tanpa `cloudflared` hanya peringatan), mengunduh `panel-termux-android-arm64.tar.gz`, memeriksanya terhadap `SHA256SUMS`, mengekstraknya ke `~/panel-src/<versi>`, lalu menjalankan `scripts/install-phone.sh`. Versi tertentu: `PANEL_VERSION=v0.3.0 sh install.sh`. Untuk memastikan asal rilis (opsional, di komputer): `gh attestation verify panel-termux-android-arm64.tar.gz --repo makurosolusi/panel-termux`.

   `install-phone.sh` idempotent: memasang binary ke `~/panel/panel` (binary lama disimpan sebagai `panel.prev`), membuat `~/panel/data` (700), membuat `~/panel/.env` dari `.env.example` bila belum ada (600), memasang service runit `$PREFIX/var/service/panel` (log lewat svlogger termux-services ke `$PREFIX/var/log/sv/panel/`). Di HP yang belum punya pm2 sama sekali (tidak ada `~/sites/ecosystem.config.js` dan tidak ada service runit `pm2`), skrip juga memasang template pm2 dari `deploy/pm2/` (lihat [Integrasi pm2](#integrasi-pm2-appsjson)); setup pm2 yang sudah ada tidak disentuh.

2. Buat OAuth client Google ([langkah di atas](#google-oauth-client)), isi `~/panel/.env`, lalu jalankan `sh install.sh` lagi. Selama `.env` belum lengkap, service ditahan dengan file `down` dan skrip keluar dengan kode 3 sambil menyebut variabel yang masih kosong. Setelah lengkap, skrip menjalankan `sv restart panel` dan menunggu `http://127.0.0.1:<PORT>/api/health`.

   Bila ada perubahan situs yang sedang berjalan (deploy, buat situs, dll.), `sv restart panel` menunggu perubahan itu selesai, **sampai 2 menit**. Selama itu panel tidak terjangkau. Perubahan yang belum selesai setelah 2 menit terputus dan tampil sebagai "Terputus" di Riwayat perubahan, dengan tombol **Pulihkan** untuk membereskannya.

   Upgrade = jalankan perintah langkah 1 lagi. Setelah upgrade, buka **Situs → Persiapan**: bila ada yang perlu disesuaikan (mis. snippet ecosystem lama), tekan **Perbaiki semua** di sana, tanpa membuka Termux. Rollback: lihat [Rollback](#rollback).

3. Tambahkan hostname panel ke tunnel cloudflared HP, mis. di `~/.cloudflared/config.yml` sebelum aturan catch-all:

   ```yaml
   - hostname: panel.<domain>
     service: http://localhost:3200
   ```

   buat DNS-nya (`cloudflared tunnel route dns <tunnel> panel.<domain>`) lalu `sv restart cloudflared`.

4. Set `APP_BASE_URL` = `https://panel.<domain>`, lalu lindungi **path privat** panel dengan **Cloudflare Access**. Landing page `/`, alur login Google, dan `/profile` sengaja tetap publik.

   Di Cloudflare dashboard: **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private**. Buat **satu** aplikasi, lalu **Add public hostname** sekali per path (domain `panel.<domain>` sama semua):

   | Path (kolom **Path**) | Melindungi                                    |
   | --------------------- | --------------------------------------------- |
   | `panel`               | halaman `/panel` dan `/panel/...`             |
   | `dev`                 | halaman `/dev` dan `/dev/...`                 |
   | `api/panel`           | API `/api/panel/...` (termasuk upload deploy) |
   | `api/dev`             | API `/api/dev/...`                            |

   Tulis path **tanpa** `/*`: menurut dokumentasi Access, `panel/*` hanya mencakup `/panel/<sesuatu>` dan **tidak** mencakup `/panel` itu sendiri, sedangkan `panel` mencakup path itu beserta sub-path-nya. Kosongkan kolom Path berarti seluruh hostname terlindungi, termasuk landing page, jadi jangan lakukan itu. Query string tidak didukung di path Access (tidak masalah, panel tidak memakainya untuk routing).

   Tambahkan satu policy **Allow** dengan selector **Emails** berisi email pemilik panel (boleh lebih dari satu), lalu **Create**. Saat menjadikan seseorang Admin, tambahkan juga emailnya ke policy Access.

   Yang sengaja **tidak** dilindungi Access, dan alasannya:
   - `/` (landing page) dan `/login`: harus bisa dibuka siapa pun.
   - `/profile`: hanya menampilkan akunmu sendiri dari `/api/me`, dan akun Google lain yang login perlu melihat penjelasan "belum punya akses" di sana.
   - `/api/auth/...`: sign-in Google dan callback Better Auth; bila dilindungi, login dari landing page tidak jalan untuk tamu.
   - `/api/me`: dipanggil landing page untuk tamu (jawab 401 bila belum login); bila dilindungi, fetch-nya dialihkan ke halaman login Access dan landing page gagal memuat.
   - `/api/health` dan aset bundle di root (`/chunk-*.js`, `/chunk-*.css`): tidak berisi data, dan landing page memerlukannya.

   Access hanya lapisan di depan. Di belakangnya login Google panel dan peran tetap berlaku, dan `/api/panel/*` serta `/api/dev/*` tetap dijaga peran di server walaupun Access salah konfigurasi. Kesehatan sistem menampilkan "Cloudflare Access belum terdeteksi" sampai panel melihat permintaan `/api/panel` atau `/api/dev` yang membawa token Access.

   Efek praktis karena panel adalah SPA: Access hanya bisa menampilkan halaman loginnya saat browser memuat halaman penuh di path yang dilindungi. Karena itu perpindahan dari halaman publik ke area privat (tombol "Buka panel" di `/`, dan pengalihan dari `/login` ke halaman awal peran setelah login Google) sengaja dilakukan dengan memuat halaman penuh, sehingga Access sempat meminta login; navigasi di dalam `/panel`, `/dev`, `/profile` tetap di sisi klien. Untuk sesi Access yang kedaluwarsa (bawaan 24 jam) ketika panel sedang terbuka, setiap panggilan API panel mengirim header `X-Requested-With: XMLHttpRequest`, sehingga Access menjawab `401` (bukan mengalihkan ke domain login-nya); panel lalu memuat ulang halaman sekali secara otomatis dan Access menampilkan login-nya. Bila setelah muat ulang Access masih menolak dalam 30 detik, panel berhenti memuat ulang dan menampilkan pesan: buka `https://panel.<domain>/panel` (atau `/dev`) langsung di address bar, dan periksa apakah email kamu diizinkan di kebijakan Access. Setelah login Access, cookie `CF_Authorization` berlaku untuk hostname itu dan navigasi di dalam panel berjalan normal sampai sesi Access habis.

### Instal dari source

Tanpa rilis (mis. untuk menguji build sendiri), salin binary dan file deploy dengan struktur folder tetap (`-R`), lalu jalankan `install-phone.sh` di HP:

```sh
bun run build
rsync -avR --partial dist/panel-android-arm64 scripts/install-phone.sh deploy/sv/panel/run deploy/pm2 .env.example <hp>:panel-src/
ssh <hp> 'cd ~/panel-src && sh scripts/install-phone.sh ./dist/panel-android-arm64'
```

### Rollback

`install-phone.sh` mencetak petunjuk ini bila panel baru gagal menyala. Manual:

```sh
sv down panel && cp ~/panel/panel.prev ~/panel/panel
ls -t ~/panel/data/snapshots | head -1     # snapshot database terbaru
# hanya bila versi baru sudah memigrasi database:
cp ~/panel/data/snapshots/<snapshot> ~/panel/data/panel.db && rm -f ~/panel/data/panel.db-wal ~/panel/data/panel.db-shm
sv up panel
```

Panel membuat snapshot `panel.db.<versi lama>.<waktu>` di `<PANEL_DATA_DIR>/snapshots/` (mode 600) setiap kali boot menemukan migrasi baru untuk database yang sudah ada, dan menyimpan 3 yang terbaru. Bila snapshot gagal (biasanya penyimpanan penuh), migrasi tidak dijalankan, log menyebut penyebabnya, dan panel keluar setelah 60 detik agar runit tidak berputar cepat. Kosongkan ruang, atau tambahkan `PANEL_SKIP_SNAPSHOT=1` ke `~/panel/.env` untuk satu kali start tanpa snapshot, lalu hapus lagi.

## Login dan peran

- Siapa pun yang punya akun Google bisa login. Akun baru masuk sebagai `user` (hanya `/profile`, dengan penjelasan "belum punya akses").
- Email di `SUPER_ADMIN_EMAILS` menjadi `super_admin` saat login.
- Jadikan admin di **Administrasi → Pengguna** (ubah peran ke `admin`). Peran `super_admin` hanya dari env. Bila panel memakai Cloudflare Access, tambahkan juga email itu ke policy Access.
- **Admin punya kendali penuh atas HP.** Admin bisa deploy program yang berjalan dengan akses yang sama seperti panel, sehingga bisa membaca semua file, database, dan kunci data, lalu menjadikan dirinya super admin. Berikan peran Admin hanya ke orang yang kamu percayai seperti pemilik HP.
- Sesi login berlaku paling lama 30 hari. Di **Profil** kamu bisa melihat dan mencabut sesi aktif; super admin bisa mencabut sesi pengguna lain dan "Keluarkan semua pengguna" di Kesehatan sistem.
- Pengguna dengan peran `user` bisa menghapus akunnya sendiri dari Profil. Catatan audit tentang akun itu tetap disimpan sampai melewati `audit.retention_days` (default 365 hari).

## Pemantauan dan notifikasi

- Satu sampler membaca HP (baterai, memori, penyimpanan, beban), layanan runit, aplikasi pm2, domain, dan cadangan setiap `monitor.sample_interval_sec` (default 60 detik). **Ringkasan** (`/panel`) menampilkan masalah lebih dulu, atau "Semua sehat". Biaya CPU saat diam sekitar 1% di HP uji.
- Histori metrik (grafik baterai/memori 24 jam dan 7 hari) dan 30 cek terakhir per domain disimpan 7 hari (±3 MB); riwayat masalah (`/panel/problems`) 30 hari. Tulis ke flash sekitar 70-100 MB per hari dengan interval default; interval yang lebih besar memotongnya.
- Level baterai hanya dianggap masalah saat **rendah dan tidak mengisi** (`monitor.battery_warn_percent`; di bawah 15% selalu gawat); mencabut charger sendiri bukan masalah. Baterai panas dilaporkan terpisah. Suhu yang tidak terbaca ditampilkan "tidak ada data", bukan 0 °C.
- Aplikasi yang crash berulang baru terdeteksi setelah panel berjalan beberapa menit, karena hitungannya disimpan di memori.
- **Telegram**: buat bot di @BotFather, isi **Token bot Telegram** di Pengaturan → Notifikasi Telegram, kirim pesan apa saja ke bot, lalu tekan **Cari chat** dan **Kirim pesan uji**. Panel mengirim satu pesan ringkasan per putaran sampler: saat masalah muncul, saat makin gawat, pengingat bila masih terbuka setelah 24 jam, dan saat pulih. Masalah yang sama tidak dikirim ulang dalam 15 menit, dan jumlah pesan per jam dibatasi. "Cadangan belum diatur" dan "Access belum terdeteksi" hanya informasi dan tidak dikirim.
- Panel **tidak bisa melaporkan dirinya sendiri mati**. Saat menyala lagi, panel melaporkan bila HP baru menyala ulang atau panel sebelumnya berhenti tidak wajar. Untuk tahu saat HP mati, pakai monitor luar (mis. cek HTTP berkala ke `https://panel.<domain>/api/health`).
- Halaman log menyamarkan nilai rahasia yang dikenal (isi `.env` situs, token) sebelum ditampilkan atau diunduh. Penyamaran ini tidak sempurna: jangan menulis rahasia ke log aplikasimu.

## Integrasi pm2 (`apps.json`)

Panel memiliki `~/sites/apps.json` (dibuat otomatis saat start bila belum ada). Agar pm2 menjalankan situs buatan panel, `~/sites/ecosystem.config.js` harus memuat entri dari `apps.json`. Halaman **Situs → Persiapan** memeriksa ini (memuat ecosystem dengan `node` seperti pm2) dan menampilkan satu baris per masalah.

**Perbaiki dari panel.** Bila panel bisa memperbaikinya sendiri, baris itu punya tombol **Perbaiki**, dan kartu punya **Perbaiki semua (n)**. Panel menampilkan dulu apa artinya dalam bahasa awam (aplikasi tulisan tangan yang tetap, situs panel yang ditambahkan), dengan **Lihat perubahan pada file** untuk diff-nya, lalu **Terapkan**:

- Di `ecosystem.config.js` panel hanya menambahkan blok bertanda `panel-termux:apps v1` di **akhir** file (dan menghapus `...require("./apps.json")` lama bila ada). Aplikasi tulisan tangan tidak diubah dan tidak di-restart. Penjaga `pm2-guard` hanya ditambahkan bila tidak ada aplikasi tulisan tangan.
- Di run script layanan pm2 panel hanya menambahkan `--no-auto-exit` setelah `pm2-runtime`. Ini berlaku saat pm2 start berikutnya (HP atau pm2 dinyalakan ulang). **Mulai ulang pm2 sekarang** (opsional, meminta konfirmasi yang menyebut aplikasi yang berjalan) memeriksa semua aplikasi kembali berjalan; bila tidak, panel menawarkan **Kembalikan file ecosystem dan mulai ulang pm2**.
- Folder situs yang belum ada bisa dibuat dari kartu yang sama.
- Sebelum menulis, panel memvalidasi hasilnya dengan `node`; bila gagal, file lama tetap dipakai ("Tidak diterapkan"). pm2 tidak pernah di-restart oleh perbaikan itu sendiri.
- **Batalkan perubahan** mengembalikan tiap file yang diubah ke versi sebelum perbaikan (satu undo per file). Salinan disimpan di `<PANEL_DATA_DIR>/fix-backups/`, 10 terakhir per file, hanya di HP (tidak ikut cadangan R2/S3 karena ecosystem bisa memuat `env` rahasia).
- File yang tidak bisa diubah dengan aman (bukan UTF-8, symlink, penanda blok rusak, `apps.json` dipakai dengan cara lain) tidak disentuh. Baris itu menyebut alasannya dan membuka **Cara manual (untuk pengguna teknis)**.

**Cara manual (untuk pengguna teknis).** HP baru memakai template [`deploy/pm2/ecosystem.config.js`](deploy/pm2/ecosystem.config.js) (salinan persis `files/sites/ecosystem.config.js` di [server-termux](https://github.com/makurosolusi/server-termux), sumbernya), yang memuat blok `panelApps` berikut dengan `...panelApps` sebagai elemen terakhir `apps`. Snippet ini tetap dianggap benar oleh Persiapan:

```js
// Panel Termux: situs buatan panel tercatat di apps.json (dikelola panel, jangan diedit tangan).
// Aman bila apps.json belum ada, kosong, atau rusak; entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi.
const panelApps = (() => {
  try {
    const fs = require("fs");
    const path = require("path");
    const list = require("./apps.json");
    return Array.isArray(list)
      ? list.filter(
          (a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")),
        )
      : [];
  } catch (e) {
    console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
    return [];
  }
})();

module.exports = {
  apps: [
    // entri tulisan tangan tetap seperti semula
    ...panelApps,
  ],
};
```

Untuk file tulisan tangan, bagian Cara manual di kartu Persiapan menampilkan blok `panel-termux:apps v1` siap salin untuk ditempel di akhir file.

- Snippet lama `...require("./apps.json")` dari versi 0.2.x ditandai error di Persiapan. Snippet itu melempar error bila `apps.json` hilang atau rusak, dan satu entri yang binary-nya hilang membuat pm2-runtime menghentikan **semua** aplikasi. **Perbaiki** menggantinya dengan blok panel.
- **Jangan hapus `pm2-guard`.** pm2-runtime keluar bila ecosystem tidak punya aplikasi saat start, juga dengan `--no-auto-exit`. Aplikasi penjaga `pm2-guard` (`sleep infinity`, ±1 MB) menahannya hidup di HP yang belum punya situs. Panel menyembunyikannya dari daftar Aplikasi.
- Service runit `pm2` sebaiknya menjalankan `pm2-runtime --no-auto-exit` (lihat [`deploy/pm2/run`](deploy/pm2/run)). Panel tidak pernah memanggil CLI `pm2` saat service itu mati, agar tidak menyalakan daemon pm2 kedua; halaman yang butuh pm2 menampilkan "pm2 tidak berjalan" dengan tombol **Jalankan pm2** (tombol **Jalankan postgres** untuk postgres). Tombol itu juga menghapus file `down` layanan sehingga layanan menyala lagi setelah HP dinyalakan ulang.
- Situs yang tercatat di panel tetapi tidak ada di pm2 ditandai "Tidak berjalan di pm2" dengan tombol **Jalankan lagi**. Situs adopsi dimuat dari `ecosystem.config.js`.

## Membuat situs

**Situs → Buat situs**: isi nama, satu atau beberapa hostname, port (disarankan otomatis dari `sites.port_range`), database opsional, dan variabel `.env` tambahan. Wizard memeriksa nama, port, dan hostname saat diketik. Panel menjalankan perubahan bertahap: folder `~/sites/<nama>` → database dan role Postgres (opsional, `DATABASE_URL` ditulis ke `.env`) → `.env` (`PORT` diisi panel) → entri `apps.json` → ingress `config.yml` (divalidasi cloudflared dulu, backup `config.yml.bak`) → CNAME DNS → satu kali restart cloudflared. Bila satu langkah gagal, langkah sebelumnya di-undo. Progres per langkah, durasinya, dan log-nya terlihat di **Riwayat perubahan** (`/panel/jobs`).

DNS dibuat lewat token API Cloudflare bila diisi. Tanpa token, panel memakai login cloudflared HP (`~/.cloudflared/cert.pem`, `cloudflared tunnel route dns`) dan hanya menerima hasilnya bila cloudflared membuat record dengan nama yang persis sama; menghapus record itu nanti tetap butuh token. Bila keduanya tidak tersedia, atau cloudflared membuat record di zona lain, langkah DNS dilewati (situs tetap dibuat) dan panel menampilkan kartu record siap salin (tipe, nama, isi, proxy) dengan **Periksa lagi**.

Di halaman detail situs: tambah/hapus domain, ubah variabel lingkungan (tempel `.env` dengan pratinjau; "Simpan" atau "Simpan dan mulai ulang" yang mengembalikan nilai lama bila aplikasi gagal sehat), mulai ulang, dan pengaturan cek kesehatan (path, status yang diharapkan, batas waktu 10-300 detik, default 60).

Perubahan yang terputus (panel di-restart di tengah jalan) tampil "Terputus" dengan tombol **Pulihkan**, yang membereskan sisa langkahnya; hapus situs atau domain yang terputus bisa diulang (**Ulangi hapus situs**, **Ulangi hapus domain**).

## Deploy binary

Di halaman detail situs, unggah binary. Dua target build didukung dan dideteksi dari header ELF (file lain langsung ditolak sebelum diunggah penuh):

```sh
bun build --compile --target=bun-linux-arm64-android src/index.ts --outfile app   # jalan langsung (native)
bun build --compile --target=bun-linux-arm64 src/index.ts --outfile app           # lewat grun (glibc)
```

- Upload dikirim per potongan 8 MB (Cloudflare membatasi body request 100 MB), maksimal 300 MB, dan tiap potongan diperiksa SHA-256-nya. Upload yang terputus (jaringan, muat ulang halaman) bisa dilanjutkan dengan **Lanjutkan unggahan** selama 1 jam; setelah itu dibuang. Upload butuh ruang kosong di data dir sebesar ukuran file + 200 MB.
- Panel menyimpan binary lama sebagai `app.prev` (di Termux berupa salinan, jadi tiap deploy menulis sekitar ukuran binary ke flash, ±89 MB untuk app Bun biasa), menukar `app`, menyesuaikan runtime di `apps.json`, me-restart app pm2, lalu menunggu sampai app **sehat**: port menjawab sesuai pengaturan cek kesehatan dua kali berturut-turut **dan** pm2 menunjukkan pid yang sama tanpa restart baru, masih benar setelah 5 detik. Bila tidak sehat dalam batas waktu, deploy dikembalikan otomatis.
- **Kembalikan versi sebelumnya** memakai `app.prev`. Yang tidak ikut dikembalikan: variabel lingkungan (`.env`), isi dan struktur database, file di `data/`, dan domain.

## Adopsi situs lama

Aplikasi pm2 yang sudah berjalan tetapi belum dikelola panel muncul di bagian **Belum dikelola** halaman Situs dan bisa diadopsi: panel mencatatnya (nama, hostname dari ingress, port, nama app pm2, runtime) tanpa mengubah file. Deploy ke situs adopsi menukar `~/sites/<nama>/app` dan me-restart app pm2-nya; `apps.json` tidak disentuh. Menghapus situs adopsi hanya menghapus ingress/DNS yang ditambahkan panel dan catatannya.

## Cadangan dan pemulihan

Isi grup **Cadangan** di Pengaturan, tekan **Uji koneksi**, lalu cadangan berjalan tiap hari pada `backup.hour` (atau **Cadangkan sekarang** di **Cadangan**). Satu run mengunggah, di bawah `<prefix><yyyy-mm-dd>/<HHMMSS>-`:

| File                 | Isi                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `globals.sql`        | Role Postgres (`pg_dumpall --globals-only`)                                                                                |
| `<db>.dump`          | `pg_dump -Fc` tiap database, diperiksa dengan `pg_restore --list`                                                          |
| `sites.tar.gz`       | Folder situs tanpa binary (`app`, `app.prev`, `app.new`), `node_modules` di level situs, dan file sementara deploy         |
| `cloudflared.tar.gz` | `~/.cloudflared` tanpa `cert.pem`                                                                                          |
| `secrets.tar.gz`     | Hanya bila `backup.include_secrets` = `on`: kunci data, `.env` panel, kredensial tunnel                                    |
| `panel.db`           | Salinan konsisten database panel                                                                                           |
| `SHA256SUMS`         | Checksum semua file run ini (`sha256sum -c`)                                                                               |
| `manifest.json`      | Indeks run: path, `APP_BASE_URL`, tunnel, situs, versi Postgres, langkah pulih. Tanpa nilai rahasia. Diunggah paling akhir |

Halaman Cadangan menampilkan cadangan valid terakhir tiap item, riwayat run, dan perintah pulih per item. Unduh lewat link sementara (15 menit); item `secrets` hanya untuk super admin dengan sesi segar.

**Retensi**: setelah run yang tidak gagal, objek lebih tua dari `backup.retention_days` dihapus, kecuali `backup.keep_min_runs` run berhasil terbaru dan cadangan valid terakhir tiap item, yang selalu disimpan. Akibatnya cadangan terakhir database situs yang sudah dihapus **disimpan selamanya**; hapus manual di bucket bila tidak perlu lagi. Retensi tidak menghapus objek yang tidak tercatat di panel.

**Token tanpa izin hapus** (pelindung terbaik bila HP dicuri, karena pencuri tidak bisa menghapus cadangan): beri token R2 izin baca/tulis saja. Saat retensi ditolak, panel berhenti mencoba di run itu dan menandai "retensi diserahkan ke lifecycle rule bucket". Atur lifecycle rule kedaluwarsa objek di bucket, minimal 30 hari. Lifecycle menghapus berdasarkan umur, jadi cadangan valid terakhir tiap item tidak dijamin tersimpan; perhatikan peringatan cadangan basi di Ringkasan.

**Uji pemulihan**: di halaman Cadangan, **Pulihkan ke database baru** memulihkan dump ke database baru `<db>_r<yyyymmddHHMM>` tanpa menyentuh yang asli. Hapus database uji itu setelah dicek.

Menghapus situs yang punya database ditolak selama cadangan sedang berjalan.

### Kunci data

`PANEL_DATA_DIR/secret` mengenkripsi pengaturan rahasia (token Cloudflare, kunci S3, token Telegram). File ini **tidak** ikut cadangan kecuali `backup.include_secrets` dinyalakan. Unduh salinannya di **Kesehatan sistem → Kunci data** (butuh sesi segar) dan simpan di tempat aman. Bila file ini hilang atau tertukar, panel tetap menyala dengan kunci baru, menandai "Kunci data tidak cocok", dan menolak menyimpan pengaturan rahasia sampai file lama dikembalikan atau kamu memilih "Hapus pengaturan rahasia lama" lalu mengisinya ulang.

Pulihkan `panel.db` di HP yang sama:

```sh
sv down panel
cp <file>-panel.db ~/panel/data/panel.db
rm -f ~/panel/data/panel.db-wal ~/panel/data/panel.db-shm
sv up panel
```

### Pulihkan ke HP baru

Asumsi: HP baru bersih, kamu punya akun Cloudflare (dashboard + R2), akun Google Cloud (OAuth client), satu laptop atau HP lain untuk login web, dan **tidak** punya file dari HP lama kecuali yang ada di bucket (`include_secrets=off`, tanpa file kunci data). Variabel contoh: bucket `BUCKET`, prefix `panel-termux/`, nama server `poco2`. Setiap blok dijalankan di Termux HP baru kecuali disebut lain.

0. **HP lama masih hidup** (pindah HP, bukan hilang). Matikan konektor tunnel di sana agar trafik tidak terbagi:

   ```sh
   export SVDIR=$PREFIX/var/service
   sv down cloudflared panel pm2
   touch $SVDIR/cloudflared/down $SVDIR/panel/down $SVDIR/pm2/down
   ```

   Bila HP lama hilang atau dicuri, jalankan [runbook HP dicuri](#hp-hilang-atau-dicuri) lebih dulu, lalu lanjut di sini dengan **kunci data baru** (langkah 10, jalan tanpa kunci).

1. **Aplikasi Android**: pasang Termux, Termux:Boot, dan Termux:API dari F-Droid/GitHub (README server-termux langkah 1). Buka Termux.
2. **Alat pulih**:

   ```sh
   pkg upgrade -y && pkg install -y git rclone cloudflared
   ```

3. **Token R2 baca-saja**: di dashboard Cloudflare → R2 → Manage API tokens → buat token **Object Read only** untuk bucket `BUCKET`. Catat Access Key ID, Secret Access Key, dan endpoint `https://<account>.r2.cloudflarestorage.com`. Di Termux, ketik nilainya sendiri; perintah ini tidak mencetak secret:

   ```sh
   export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
   export RCLONE_CONFIG_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   read -r RCLONE_CONFIG_R2_ACCESS_KEY_ID; read -rs RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
   export RCLONE_CONFIG_R2_ACCESS_KEY_ID RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
   ```

4. **Pilih run & unduh**. Folder = tanggal, dan satu run = satu awalan `HHMMSS-`. Pilih stem terbaru yang punya `manifest.json`:

   ```sh
   rclone lsf r2:BUCKET/panel-termux/ | tail -3              # mis. 2026-11-26/
   rclone lsf r2:BUCKET/panel-termux/2026-11-26/ | grep manifest   # mis. 030012-manifest.json
   mkdir -p ~/pulih && cd ~/pulih
   rclone copy r2:BUCKET/panel-termux/2026-11-26/ . --include '030012-*'
   sha256sum -c 030012-SHA256SUMS      # semua harus "OK"; bila tidak, pilih run lain
   cat 030012-manifest.json            # catat paths, appBaseUrl, tunnel, sites, postgresVersion
   ```

5. **File situs dan konfigurasi tunnel**. Ini harus dilakukan **sebelum** installer server, karena installer membuat `ecosystem.config.js` kosong bila belum ada dan memeriksa tunnel bila `config.yml` ada. Folder tujuan harus belum ada atau kosong:

   ```sh
   mkdir -p ~/sites && tar -xzf 030012-sites.tar.gz -C ~/sites          # paths.sitesDir dari manifest
   mkdir -p ~/.cloudflared && tar -xzf 030012-cloudflared.tar.gz -C ~/.cloudflared
   ```

6. **Kredensial tunnel**. Nama berkas diambil dari `tunnel.credentialsFile` di manifest. Bila run berisi item `secrets`, cukup `tar -xzf 030012-secrets.tar.gz -C ~/pulih/secrets` lalu salin `<credentialsFile>` ke `~/.cloudflared/`. Bila tidak:

   ```sh
   cloudflared tunnel login                                   # buka URL, pilih domain → ~/.cloudflared/cert.pem
   cloudflared tunnel token --cred-file ~/.cloudflared/<credentialsFile> <tunnel.ref>
   chmod 600 ~/.cloudflared/<credentialsFile>
   cloudflared tunnel cleanup <tunnel.ref>                    # buang koneksi lama HP sebelumnya
   ```

   `tunnel token --cred-file` hanya untuk tunnel yang dibuat dengan cloudflared ≥ 2022.3.0. Untuk tunnel yang lebih tua: buat tunnel baru dengan nama lain, arahkan ulang setiap hostname (`cloudflared tunnel route dns -f <tunnel> <host>`), lalu ganti `tunnel:` dan `credentials-file:` di `config.yml`. DNS CNAME di Cloudflare tidak perlu diubah bila tunnel yang sama dipakai.

7. **Installer server** (memasang sshd, postgres dengan role `postgres`, pm2, dan service cloudflared; membiarkan `ecosystem.config.js` yang sudah dipulihkan):

   ```sh
   git clone https://github.com/makurosolusi/server-termux ~/server-termux
   sh ~/server-termux/install.sh poco2
   ```

   Ikuti "Android settings" yang dicetak installer, lalu reboot dan buka kunci HP sekali. Cek dengan `SVDIR=$PREFIX/var/service sv status postgres cloudflared pm2`: semua harus `run:`. Aplikasi pm2 akan **errored** sampai langkah 13 karena binary situs tidak dicadangkan.

8. **Role dan database Postgres**. Cocokkan `postgresVersion` di manifest dengan `psql -V`: major HP baru harus ≥ major lama.

   ```sh
   cd ~/pulih
   psql -U postgres -d postgres -f 030012-globals.sql        # "role "postgres" already exists" wajar
   for f in 030012-*.dump; do pg_restore -U postgres --create --exit-on-error -d postgres "$f"; done
   ```

9. **Pasang panel**: jalankan perintah pasang di [Instal di HP](#instal-di-hp) langkah 1 (installer rilis yang memverifikasi checksum). Installer berhenti dengan service `down` karena `.env` belum lengkap. Jangan isi `.env` dulu.
10. **Data panel**:

    ```sh
    export SVDIR=$PREFIX/var/service
    sv down panel 2>/dev/null; touch $SVDIR/panel/down          # pastikan panel tidak sedang jalan
    cp ~/pulih/030012-panel.db ~/panel/data/panel.db && chmod 600 ~/panel/data/panel.db
    rm -f ~/panel/data/panel.db-wal ~/panel/data/panel.db-shm ~/panel/data/secret
    ```

    Kunci data, **salah satu** dari:
    - (a) item `secrets` → `cp ~/pulih/secrets/secret ~/panel/data/secret` dan `cp ~/pulih/secrets/.env ~/panel/.env`;
    - (b) file kunci data unduhan → perintah `printf` yang ada di file itu;
    - (c) tidak punya → biarkan `secret` tidak ada. Panel membuat kunci baru dan masuk mode tidak cocok (langkah 12).

    `chmod 600 ~/panel/data/secret ~/panel/.env`.

11. **`.env` panel** (bila bukan dari item `secrets`). Edit `~/panel/.env`:
    - `APP_BASE_URL` = `appBaseUrl` di manifest, persis sama (redirect OAuth);
    - `GOOGLE_CLIENT_ID` = client lama (Google Cloud → Credentials);
    - `GOOGLE_CLIENT_SECRET` = secret lama bila tersimpan, kalau tidak "Add secret" di client itu lalu hapus yang lama setelah selesai;
    - `SUPER_ADMIN_EMAILS` = email kamu.

    Lalu jalankan ulang `install.sh` panel. Ini menghapus file `down`, menyalakan panel, dan menunggu `/api/health`. Panel menyala lagi sendiri setelah reboot berikutnya.

12. **Login dan kunci**: buka `APP_BASE_URL`, login Google.
    - Bila langkah 10 (c): Administrasi → Kesehatan sistem → Kunci data → "Hapus pengaturan rahasia lama", lalu Pengaturan → isi ulang token API Cloudflare, kunci R2 baru dengan izin baca/tulis/hapus (bukan token baca-saja dari langkah 3), dan token bot Telegram. Lalu "Uji koneksi".
    - Hapus token baca-saja langkah 3 di dashboard R2.
13. **Binary situs**: untuk setiap `sites[].needsBinary` di manifest, buka situs di panel → Deploy → unggah binary dari build-mu (CI/laptop). Deploy me-restart aplikasinya, dan pm2-runtime membaca `~/sites/ecosystem.config.js` sehingga `pm2 save` tidak perlu.
14. **Cek akhir**:
    - setiap hostname situs menjawab;
    - Ringkasan tanpa masalah merah;
    - dashboard Zero Trust → tunnel menampilkan **satu** konektor;
    - `rm -rf ~/pulih`, cabut konfigurasi rclone (`unset RCLONE_CONFIG_R2_*`);
    - jalankan "Cadangkan sekarang".

### HP hilang atau dicuri

1. Zero Trust → hapus konektor/tunnel HP lama dan cabut sertifikat akun (`cert.pem`).
2. Putar token API Cloudflare.
3. R2 → buat token baru, cabut yang lama, lalu cek objek cadangan masih ada.
4. Google Cloud → tambah client secret baru, hapus yang lama.
5. [Pulihkan ke HP baru](#pulihkan-ke-hp-baru) dengan kunci data **baru** (langkah 10 c), lalu reset dan isi ulang token.
6. Putar `.env` situs yang berisi rahasia pihak ketiga.

## Keamanan

- Login terbuka untuk semua akun Google, tetapi akun baru hanya mendapat peran `user` (cuma `/profile`). Karena siapa pun bisa login, pasang **Cloudflare Access** di depan path privat (`/panel`, `/dev`, `/api/panel`, `/api/dev`) agar hanya email yang kamu izinkan yang sampai ke sana (resep di [Instal di HP](#instal-di-hp) langkah 4). Landing page `/`, `/login`, `/profile`, `/api/auth/*`, `/api/me`, `/api/health`, dan aset bundle sengaja tetap publik. `/api/panel/*` dan `/api/dev/*` tetap dijaga peran di server, jadi Access adalah lapisan tambahan, bukan satu-satunya penjaga.
- **Model kepercayaan**: super admin dan admin sama-sama setara pemilik HP (lihat [Login dan peran](#login-dan-peran)). Program situs yang kamu deploy juga berjalan dengan akses yang sama seperti panel.
- **Akun Google super admin adalah kunci utama.** Nyalakan 2-Step Verification atau passkey di akun itu. Bila memungkinkan, tambahkan faktor kedua di policy Access (mis. One-time PIN ke email lain).
- Permintaan API yang mengubah data (`POST`/`PUT`/`PATCH`/`DELETE` di `/api/*`, kecuali `/api/auth/*` yang dijaga Better Auth) hanya diterima dari halaman panel sendiri: header `Origin` harus sama dengan `APP_BASE_URL`, `Sec-Fetch-Site` (bila ada) harus `same-origin`, dan header `X-Requested-With: XMLHttpRequest` wajib ada; selain itu dijawab `403 { "error": "forbidden_origin" }`. Ini menutup serangan CSRF dari site lain di domain yang sama (mis. `solusi.<domain>`), yang tetap ikut membawa cookie sesi panel. Klien non-browser (curl/skrip) cukup mengirim `X-Requested-With: XMLHttpRequest`. Permintaan dengan header `Host` asing dijawab `421`.
- **Sesi segar**: unduh atau reset kunci data, unduh item `secrets`, menyalakan `backup.include_secrets`, dan mengubah endpoint/bucket/awalan cadangan butuh login yang berumur paling lama 15 menit; selain itu panel menawarkan "Masuk ulang". Ini melindungi dari cookie yang dicuri di perangkat lain, bukan dari akun Google yang diambil alih.
- Super admin dari env disinkronkan ulang setiap boot dan login (email yang dihapus dari env turun ke `user`).
- Nilai rahasia di pengaturan dienkripsi dengan kunci data (`PANEL_DATA_DIR/secret`, dibuat otomatis, mode 600). Simpan salinannya terpisah (lihat [Kunci data](#kunci-data)).
- Audit mencatat siapa (nama, email, IP disamarkan), kapan, dan dari perangkat apa untuk setiap perubahan; bisa difilter dan diekspor CSV di Administrasi → Audit.
- Panel hanya listen di `127.0.0.1`. Jangan pernah membuka port panel ke publik/LAN; akses lewat tunnel, dengan path privat di belakang Cloudflare Access.
- `.env` panel dan `.env` site disimpan mode 600.

## Keterbatasan

- CPU% per proses tidak tersedia di Android (`/proc/stat` diblokir SELinux); beberapa info `/proc` lain juga terbatas.
- Setiap perubahan ingress me-restart cloudflared, sehingga **semua** domain di tunnel putus beberapa detik.
- Panel tidak bisa memberi tahu saat dirinya atau HP mati (lihat [Pemantauan dan notifikasi](#pemantauan-dan-notifikasi)).
- Panel menulis `apps.json`, `.env`, `config.yml`, dan file yang diperbaiki dengan fsync (file dan folder) sebelum rename. Di POCO, `/data` memakai f2fs `fsync_mode=nobarrier`: urutan tulis terjaga, tetapi isi file tidak dijamin selamat bila HP mati mendadak tepat saat menulis. Salinan di `fix-backups/` dan validasi Persiapan membantu memulihkannya.
- Upload multipart S3 belum diuji dengan dump besar.
- Panggilan nyata ke R2 dan API Cloudflare belum diuji end-to-end (hanya dengan mock di test).

## Lisensi

[MIT](LICENSE).
