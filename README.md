# panel-termux

Panel web untuk mengelola server HP Android (Termux): layanan runit, aplikasi pm2, domain Cloudflare Tunnel, database Postgres, site, deploy binary, dan backup. Akses lewat login Google.

## Layar dan peran

| Peran         | Halaman awal | Isi                                                                                                                      |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `user`        | `/profile`   | Profil sendiri                                                                                                           |
| `admin`       | `/panel`     | Ringkasan perangkat, layanan runit, aplikasi pm2, domain, database, site (buat/adopsi/deploy/hapus), riwayat job, backup |
| `super_admin` | `/dev`       | Kesehatan panel, pengguna dan peran, audit log, log, pengaturan                                                          |

Peran lebih tinggi bisa membuka semua halaman peran di bawahnya.

`/` adalah halaman perkenalan publik (tanpa login); tombolnya "Masuk dengan Google" untuk tamu atau "Buka panel" ke halaman awal peran bila sudah login. Setelah login Google, pengguna kembali ke `/login` lalu diteruskan ke halaman awal perannya. Alamat yang tidak dikenal menampilkan halaman perkenalan.

## Arsitektur singkat

- Satu binary hasil `bun build --compile`: server Elysia (`/api/*`) dan SPA React yang di-embed (`/*`).
- SQLite (`panel.db`) di `PANEL_DATA_DIR`; migrasi Drizzle ikut di-embed dan jalan otomatis saat boot.
- Auth: Better Auth + Google OAuth.
- Adapter sistem (runit, pm2, cloudflared, postgres, perangkat): mode `termux` dipilih otomatis bila `$PREFIX/bin/sv` ada, selain itu `fake` (data demo di memori, untuk development). Mode yang dipakai tercatat di log saat start.
- Panel hanya listen di `127.0.0.1`. Akses dari luar lewat Cloudflare Tunnel.

## Kebutuhan

- Development: [Bun](https://bun.sh) (versi yang ada di `bun.lock`/`@types/bun`), macOS/Linux.
- HP: Termux dengan `termux-services` (runit), `pm2` yang membaca `~/sites/ecosystem.config.js`, `cloudflared` sebagai service runit dengan `~/.cloudflared/config.yml`, PostgreSQL lokal (role `postgres`, atau set `PGUSER`), `curl`. `grun` hanya perlu untuk site dengan binary glibc.
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

| Variabel                                   | Keterangan                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `APP_BASE_URL`                             | URL publik panel (dipakai untuk redirect OAuth)                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client di atas                                                      |
| `SUPER_ADMIN_EMAILS`                       | Email super admin, dipisah koma                                           |
| `PORT` (opsional)                          | Default `3200`                                                            |
| `PANEL_DATA_DIR` (opsional)                | Default `./data` (relatif ke working dir): berisi `panel.db` dan `secret` |

Bun memuat `.env` otomatis dari working directory. Panel menolak start dan menyebut nama variabel (bukan nilainya) bila ada yang kosong atau tidak valid.

Semua pengaturan lain diisi di **/dev → Pengaturan** (disimpan di database; nilai rahasia terenkripsi dan tidak pernah ditampilkan lagi):

| Key                           | Default                  | Keterangan                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare.api_token`        | –                        | Rahasia. API token dengan izin **Zone:DNS:Edit** dan **Zone:Read** (untuk mencari zone dan membuat CNAME site ke tunnel). Tanpa token, langkah DNS dilewati dan record dibuat manual. Tombol verifikasi ada di halaman yang sama. |
| `cloudflare.account_id`       | –                        | ID akun Cloudflare (32 hex). Perlu untuk memverifikasi token milik akun (account-owned token).                                                                                                                                    |
| `sites.dir`                   | `~/sites`                | Folder site; `apps.json` dan `ecosystem.config.js` ada di sini.                                                                                                                                                                   |
| `sites.port_range`            | `3001-3999`              | Rentang port lokal yang dibagikan ke site baru.                                                                                                                                                                                   |
| `panel.protected_services`    | `sshd,cloudflared,panel` | Layanan runit yang tidak boleh dihentikan dari panel.                                                                                                                                                                             |
| `backup.s3_endpoint`          | –                        | Endpoint S3 (path-style), mis. `https://<account>.r2.cloudflarestorage.com`.                                                                                                                                                      |
| `backup.s3_bucket`            | –                        | Bucket tujuan backup.                                                                                                                                                                                                             |
| `backup.s3_region`            | `auto`                   | Region S3; R2 memakai `auto`.                                                                                                                                                                                                     |
| `backup.s3_access_key_id`     | –                        | Rahasia. Access key dengan izin tulis ke bucket.                                                                                                                                                                                  |
| `backup.s3_secret_access_key` | –                        | Rahasia. Pasangan access key di atas.                                                                                                                                                                                             |
| `backup.prefix`               | `panel-termux/`          | Prefix key objek; retensi hanya menghapus di bawah prefix ini. Harus diakhiri `/`.                                                                                                                                                |
| `backup.hour`                 | `3`                      | Jam lokal (0-23) backup harian, atau `off`.                                                                                                                                                                                       |
| `backup.retention_days`       | `14`                     | Backup lebih tua dari ini dihapus setelah tiap run.                                                                                                                                                                               |

## Development lokal

```sh
bun install
cp .env.example .env   # isi: APP_BASE_URL=http://localhost:3200, client Google, email Anda
bun run dev            # hot reload, adapter mode fake (bukan Termux)
```

Buka `APP_BASE_URL` (alamat yang dicetak setelah `open` di log start, mis. `http://localhost:3200`); membuka lewat alamat lain (mis. `127.0.0.1`) otomatis diarahkan ke sana. Di mode fake, data layanan/aplikasi/domain adalah data demo.

## Test, lint, typecheck

```sh
bun test
bun run lint        # biome check .
bun run typecheck   # tsc --noEmit
sh scripts/install-phone.test.sh   # uji install-phone.sh dengan stub sv/curl
```

## Build

```sh
bun run build         # dist/panel-android-arm64 (target bun-linux-arm64-android), untuk HP
bun run build:local   # dist/panel, untuk mesin saat ini
```

Binary Android jalan langsung di Termux tanpa `grun` (sekitar 65 MB RSS).

## Instal di HP

1. Build lalu salin binary dan file deploy dengan struktur folder tetap (`-R`):

   ```sh
   bun run build
   rsync -avR --partial dist/panel-android-arm64 scripts/install-phone.sh deploy/sv/panel/run .env.example <hp>:panel-src/
   ```

2. Di HP:

   ```sh
   cd ~/panel-src && sh scripts/install-phone.sh ./dist/panel-android-arm64
   ```

   Script ini idempotent: memasang binary ke `~/panel/panel` (binary lama disimpan sebagai `panel.prev`), membuat `~/panel/data` (700), membuat `~/panel/.env` dari `.env.example` bila belum ada (600), memasang service runit `$PREFIX/var/service/panel` (log lewat svlogger termux-services ke `$PREFIX/var/log/sv/panel/`). Selama `.env` belum lengkap, service ditahan dengan file `down` dan script menyebut variabel yang masih kosong. Isi `~/panel/.env`, jalankan lagi; script lalu menjalankan `sv restart panel` dan menunggu `http://127.0.0.1:<PORT>/api/health`.

   Upgrade = ulangi langkah 1-2 dengan binary baru. Rollback manual: `sv down panel && mv ~/panel/panel.prev ~/panel/panel && sv up panel`.

3. Tambahkan hostname panel ke tunnel cloudflared HP, mis. di `~/.cloudflared/config.yml` sebelum aturan catch-all:

   ```yaml
   - hostname: panel.<domain>
     service: http://localhost:3200
   ```

   buat DNS-nya (`cloudflared tunnel route dns <tunnel> panel.<domain>`) lalu `sv restart cloudflared`.

4. Set `APP_BASE_URL` = `https://panel.<domain>`, lalu lindungi **path privat** panel dengan **Cloudflare Access**. Landing page `/` dan alur login Google sengaja tetap publik.

   Di Cloudflare dashboard: **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private**. Buat **satu** aplikasi, lalu **Add public hostname** sekali per path (domain `panel.<domain>` sama semua):

   | Path (kolom **Path**) | Melindungi                                    |
   | --------------------- | --------------------------------------------- |
   | `profile`             | halaman `/profile`                            |
   | `panel`               | halaman `/panel` dan `/panel/...`             |
   | `dev`                 | halaman `/dev` dan `/dev/...`                 |
   | `api/panel`           | API `/api/panel/...` (termasuk upload deploy) |
   | `api/dev`             | API `/api/dev/...`                            |

   Tulis path **tanpa** `/*`: menurut dokumentasi Access, `panel/*` hanya mencakup `/panel/<sesuatu>` dan **tidak** mencakup `/panel` itu sendiri, sedangkan `panel` mencakup path itu beserta sub-path-nya. Kosongkan kolom Path berarti seluruh hostname terlindungi, termasuk landing page, jadi jangan lakukan itu. Query string tidak didukung di path Access (tidak masalah, panel tidak memakainya untuk routing).

   Tambahkan satu policy **Allow** dengan selector **Emails** berisi email pemilik panel (boleh lebih dari satu), lalu **Create**.

   Yang sengaja **tidak** dilindungi Access, dan alasannya:
   - `/` (landing page) dan `/login`: harus bisa dibuka siapa pun.
   - `/api/auth/...`: sign-in Google dan callback Better Auth; bila dilindungi, login dari landing page tidak jalan untuk tamu.
   - `/api/me`: dipanggil landing page untuk tamu (jawab 401 bila belum login); bila dilindungi, fetch-nya dialihkan ke halaman login Access dan landing page gagal memuat.
   - `/api/health` dan aset bundle di root (`/chunk-*.js`, `/chunk-*.css`): tidak berisi data, dan landing page memerlukannya.

   Access hanya lapisan di depan. Di belakangnya login Google panel dan peran tetap berlaku, dan `/api/panel/*` serta `/api/dev/*` tetap dijaga peran di server walaupun Access salah konfigurasi.

   Efek praktis karena panel adalah SPA: Access hanya bisa menampilkan halaman loginnya saat browser memuat halaman penuh di path yang dilindungi. Pindah dari `/` atau `/login` ke `/panel` lewat tombol terjadi di sisi klien tanpa memuat halaman, jadi Access tidak sempat meminta login; panggilan `/api/panel/...` berikutnya lalu dialihkan ke halaman login Access dan muncul sebagai galat jaringan. Hal yang sama terjadi saat sesi Access kedaluwarsa (bawaan 24 jam) ketika panel sedang terbuka. Solusinya: buka `https://panel.<domain>/panel` (atau `/dev`, `/profile`) langsung di address bar, atau muat ulang halaman. Setelah login Access, cookie `CF_Authorization` berlaku untuk hostname itu dan navigasi di dalam panel berjalan normal sampai sesi Access habis.

## Login dan peran

- Siapa pun yang punya akun Google bisa login. Akun baru masuk sebagai `user` (hanya `/profile`).
- Email di `SUPER_ADMIN_EMAILS` menjadi `super_admin` saat login.
- Jadikan admin di **/dev → Pengguna** (ubah peran ke `admin`). Peran `super_admin` hanya dari env.

## Integrasi pm2 (`apps.json`)

Panel memiliki `~/sites/apps.json` (dibuat saat site pertama). Agar pm2 menjalankan site buatan panel, sebarkan file itu ke daftar `apps` di `~/sites/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    // entri tulisan tangan tetap seperti semula
    ...require("./apps.json"),
  ],
};
```

Halaman buat site menampilkan peringatan bila baris ini belum ada.

## Membuat site

**/panel → Site → Buat site**: isi nama, hostname, port (disarankan otomatis dari `sites.port_range`), database opsional, dan variabel `.env` tambahan. Panel menjalankan job bertahap: folder `~/sites/<nama>` → database dan role Postgres (opsional, `DATABASE_URL` ditulis ke `.env`) → `.env` (`PORT` diisi panel) → entri `apps.json` → ingress `config.yml` (divalidasi cloudflared dulu, backup `config.yml.bak`) → CNAME DNS (bila token Cloudflare diisi) → restart cloudflared. Bila satu langkah gagal, langkah sebelumnya di-undo. Progres terlihat di **Riwayat perubahan** (/panel/jobs).

## Deploy binary

Di halaman detail site, upload binary. Dua target build didukung dan dideteksi dari header ELF:

```sh
bun build --compile --target=bun-linux-arm64-android src/index.ts --outfile app   # jalan langsung (native)
bun build --compile --target=bun-linux-arm64 src/index.ts --outfile app           # lewat grun (glibc)
```

Upload dikirim per potongan 8 MB (Cloudflare membatasi body request 100 MB), maksimal 300 MB. Panel menukar `app` (versi lama jadi `app.prev`), menyesuaikan runtime di `apps.json`, me-restart app pm2, lalu menunggu `GET /` di port site menjawab di bawah 500 dalam 30 detik; bila tidak, deploy dibatalkan otomatis. Tombol **Kembalikan versi sebelumnya** memakai `app.prev`.

## Adopsi site lama

Site yang sudah ada (ingress di `config.yml` dan app di `ecosystem.config.js` tulisan tangan) muncul di bagian **Belum dikelola** halaman Site dan bisa diadopsi: panel hanya mencatatnya (nama, hostname, port, nama app pm2, runtime default `grun`) tanpa mengubah file. Deploy ke site adopsi menukar `~/sites/<nama>/app` dan me-restart app pm2-nya; `apps.json` tidak disentuh. Menghapus site adopsi hanya menghapus ingress/DNS yang ditambahkan panel dan catatannya.

## Backup dan restore

Isi pengaturan `backup.*`, lalu backup berjalan tiap hari pada `backup.hour` (atau tombol jalankan manual di **/panel → Backup**). Tiap run mengunggah `pg_dump -Fc` setiap database dan salinan `panel.db` ke `<prefix><yyyy-mm-dd>/<HHMMSS>-<nama>`. Unduh lewat link sementara (15 menit) di halaman Backup; tiap item juga menampilkan perintah restore-nya.

Restore database (di HP, database harus sudah ada; bila belum, buat dulu dengan `createdb`):

```sh
pg_restore -U postgres -d <db> --clean <db>.dump
```

Restore `panel.db`:

```sh
sv down panel
cp <file>-panel.db ~/panel/data/panel.db
rm -f ~/panel/data/panel.db-wal ~/panel/data/panel.db-shm
sv up panel
```

`data/secret` **tidak** ikut di-backup ke S3. Simpan salinannya sendiri di tempat aman: tanpa file itu, pengaturan rahasia di `panel.db` (token Cloudflare, kunci S3) tidak bisa didekripsi dan harus diisi ulang.

## Keamanan

- Login terbuka untuk semua akun Google, tetapi akun baru hanya mendapat peran `user` (cuma `/profile`). Karena siapa pun bisa login, pasang **Cloudflare Access** di depan path privat (`/profile`, `/panel`, `/dev`, `/api/panel`, `/api/dev`) agar hanya email yang kamu izinkan yang sampai ke sana (resep di **Instal di HP** langkah 4). Landing page `/`, `/login`, `/api/auth/*`, `/api/me`, `/api/health`, dan aset bundle sengaja tetap publik. `/api/panel/*` dan `/api/dev/*` tetap dijaga peran di server, jadi Access adalah lapisan tambahan, bukan satu-satunya penjaga.
- Super admin dari env disinkronkan ulang setiap boot dan login (email yang dihapus dari env turun ke `user`).
- Nilai rahasia di pengaturan dienkripsi dengan data secret (`PANEL_DATA_DIR/secret`, dibuat otomatis, mode 600). Backup file ini terpisah (lihat di atas).
- Panel hanya listen di `127.0.0.1`. Jangan pernah membuka port panel ke publik/LAN; akses lewat tunnel, dengan path privat di belakang Cloudflare Access.
- `.env` panel dan `.env` site disimpan mode 600.

## Keterbatasan

- CPU% per proses tidak tersedia di Android (`/proc/stat` diblokir SELinux); beberapa info `/proc` lain juga terbatas.
- Setiap perubahan ingress me-restart cloudflared, sehingga **semua** domain di tunnel putus beberapa detik.
- Upload multipart S3 belum diuji dengan dump besar.
- Panggilan nyata ke R2 dan API Cloudflare belum diuji end-to-end (hanya dengan mock di test).
