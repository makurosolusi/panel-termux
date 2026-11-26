# R&D 03 — Siklus hidup Situs (situs, perubahan, domain, variabel lingkungan, database, deploy)

> Worker: wkr-rnd-sites-01 · 2026-11-26 · branch `feature/production-polish` (HEAD 2a55c8b).
> Sumber: kode di repo (dikutip `file:baris`), `docs/research/ui-benchmark.md` (selanjutnya "benchmark §n"),
> docs publik Railway/Render (dicek lewat ego-browser hari ini), dan pembacaan **read-only** POCO (`ssh poco`).
> Dokumen ini hanya R&D; tidak ada kode yang diubah. Istilah UI mengikuti `docs/content-guide.md`
> (Situs, Domain, Aplikasi, Perubahan, Variabel lingkungan, Deploy, Rollback/Kembalikan versi sebelumnya).

---

## 1. Ruang lingkup

| Area                                     | Halaman (SPA)                              | API (`/api/panel`, peran ≥ admin)                                                                                                                                        | Kode server                                                                        |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Daftar situs + "Belum dikelola" + adopsi | `/panel/sites`                             | `GET /sites`, `GET /sites/discovered`, `POST /sites/adopt`, `GET /integration`                                                                                           | `sites/site.service.ts`                                                            |
| Wizard buat situs                        | `/panel/sites/new`                         | `GET /sites/suggest-port`, `POST /sites/check`, `POST /sites` → 202 `{jobId}`                                                                                            | `site.service.ts`, `site.checks.ts`, `site.jobs.ts`                                |
| Detail situs                             | `/panel/sites/:name`                       | `GET /sites/:name`, `DELETE /sites/:name?keepData&keepDatabase`                                                                                                          | `site.service.ts`                                                                  |
| Perubahan (job)                          | `/panel/jobs`, `/panel/jobs/:id`           | `GET /jobs?page&pageSize`, `GET /jobs/:id`                                                                                                                               | `sites/job.runner.ts`                                                              |
| Domain situs                             | bagian "Domain" di detail                  | `POST /sites/:name/hostnames`, `DELETE /sites/:name/hostnames/:hostname`                                                                                                 | `site.jobs.ts`, `site.steps.ts`, `ingress.editor.ts`, `cloudflare/dns.provider.ts` |
| Variabel lingkungan                      | bagian di detail + langkah 2 wizard        | `PUT /sites/:name/env`                                                                                                                                                   | `sites/env.file.ts`                                                                |
| Database per situs                       | toggle di wizard                           | (bagian dari job `site.create`/`site.delete`)                                                                                                                            | `system/postgres.termux.ts`                                                        |
| Deploy binary + rollback + riwayat       | bagian "Deploy"/"Riwayat deploy" di detail | `POST /sites/:name/uploads`, `PUT /uploads/:id/chunks/:i`, `POST /uploads/:id/complete`, `DELETE /uploads/:id`, `POST /sites/:name/rollback`, `GET /sites/:name/deploys` | `deploy/*.ts`                                                                      |
| Integrasi file HP                        | banner di `/panel/sites`                   | `GET /integration`                                                                                                                                                       | `site.service.ts:256-280`                                                          |

Di luar domain ini (dirujuk saja): log Aplikasi (`/panel/apps`), cek kesehatan domain (`panel/domain.health.ts`), cadangan.

---

## 2. Kondisi sekarang — audit

### 2.1 Model data

- `site` (`db/schema/site.schema.ts:9-18`): `name` PK, `port` unique, `app` (nama proses pm2, null = pakai `name`), `database`, `runtime` (`native|grun`), `managed` (false = diadopsi), `dir`, `createdAt`. **Tidak ada**: health path/timeout, jumlah versi yang disimpan, siapa pembuat, `updatedAt`, status "deploy aktif".
- `site_hostname` (`:24-36`): `ingressManaged`, `dnsManaged`. `dns_record` (`dns-record.schema.ts:5-10`) = bukti kepemilikan record Cloudflare.
- `job` (`:39-53`): `steps` JSON `{key,label,status,message}`; `actorId` disimpan tetapi **tidak** dikirim di kontrak `Job` (`shared/site.types.ts:73-82`). Tidak ada waktu mulai/selesai per langkah, tidak ada log per langkah.
- `deploy` (`deploy.schema.ts:8-27`): sha256, ukuran, runtime, status, kind, jobId, actor. Tidak ada nama file asli, durasi, atau penanda "aktif".
- Upload: hanya di memori (`deploy/upload.store.ts:35-42`), chunk di `<data>/uploads/<id>/<i>.part`, dihapus total saat panel start (`:41`).

### 2.2 Daftar situs, "Belum dikelola", adopsi

**Flow.** `SitesPage` (`web/site/sites.page.tsx:60-91`) = banner integrasi → tombol "Buat situs" / "Riwayat perubahan" → grid kartu (`site.card.tsx:35-62`) → bagian "Belum dikelola" (`:19-57`) dari `GET /sites/discovered` = ingress `config.yml` yang hostname-nya belum tercatat (`site.service.ts:100-116`), `app` ditebak dari **port pm2** (`:114`).

Adopsi: dialog (`adopt.dialog.tsx:39-86`) dengan nama (kosong), domain, port, aplikasi pm2 (opsional). Server (`site.service.ts:154-195`) hanya menyisipkan baris DB; `dir` **selalu** `~/sites/<nama>` (`:177`), `runtime` default `grun` (`:159`), tanpa cek folder, tanpa cek app pm2 ada, tanpa deteksi runtime binary yang ada.

**Masalah (dibuktikan dengan data POCO, §2.11):**

1. pm2 di POCO tidak tahu port `makuro-solusi` (port dibaca binary dari `.env`, bukan dari env pm2) → `app` = null → kolom Aplikasi kosong. Kalau pemilik mengetik nama situs `solusi` (wajar, sesuai domain), `dir` = `~/sites/solusi` yang tidak ada dan `appName` = `solusi` yang tidak ada di pm2 (`deploy.steps.ts:42`). Deploy pertama gagal di "Assemble upload" (`deploy.steps.ts:61`); kalau foldernya kebetulan ada, gagal di restart setelah binary ditukar. Adopsi yang "berhasil" bisa jadi situs yang tidak pernah bisa di-deploy.
2. Hostname panel sendiri (`panel.malikkurosaki.com → :3200`) muncul di "Belum dikelola" dan bisa diadopsi. Tidak ada pengecualian host `APP_BASE_URL`.
3. Runtime tidak ditanyakan dan tidak dideteksi dari `<dir>/app` (padahal `detectRuntime` sudah ada, `deploy/elf.runtime.ts:25`).
4. Kartu: grid kartu (`sites.page.tsx:81`), padahal benchmark §3 menyarankan tabel di desktop + list padat di mobile, urutan "bermasalah dulu". Belum memakai komponen wave A (`PageHeader`, `DataTable`, `EmptyState`, `StatusBadge` di `web/components/`); masih `web/panel/status.badge`.
5. Kartu tidak menampilkan deploy terakhir (kapan, oleh siapa, status), restart pm2, atau kesehatan domain.
6. Empty state memakai teks `t.list.empty` lewat `QueryView` tanpa CTA tombol.

### 2.3 Wizard buat situs

**Flow** (`site-new.page.tsx:19-83`): 3 langkah Alamat → Opsi → Ringkasan. Langkah 1 memanggil `/sites/check` setiap 400 ms setelah ketikan terakhir (`site.api.ts:37-77`). Port diisi otomatis dari `/sites/suggest-port`. Langkah 3 menampilkan rencana (`wizard.summary.tsx:8-20`) + peringatan bahwa semua domain terputus sebentar. Submit → `POST /sites` → navigasi ke `/panel/jobs/:id`.

Job `site.create` (`site.jobs.ts:66-165`): Validate → folder (700) → database (opsional) → `.env` (600) → entri `apps.json` → ingress → DNS → restart cloudflared. DB record ditulis di `onSuccess` (`:145-162`).

**Masalah:**

1. **Situs baru tidak bisa langsung jalan.** Entri `apps.json` dibuat dengan `script: ./app` (`:73-79`), tetapi belum ada binary. Wizard berakhir di halaman progres, lalu "Buka detail situs"; tidak ada langkah "Unggah binary pertama". Status kartu "Belum ada aplikasi" tanpa petunjuk. Coolify/Railway menganggap deploy pertama sebagai bagian dari pembuatan (benchmark §5, §9).
2. Konflik DNS baru ketahuan di langkah 7 (`site.steps.ts:98-113`, `dns.provider.ts:98-102`). Akibatnya rollback dijalankan, dan pada kasus gagal setelah restart cloudflared ikut di-restart dua kali (`site.steps.ts:84-88`). `/sites/check` tidak memeriksa zone/record Cloudflare (`site.checks.ts:103-109`).
3. Domain yang CNAME-nya sudah dibuat manual ke tunnel yang sama (resep README: `cloudflared tunnel route dns …`) ditolak sebagai konflik (`dns.provider.ts:99-101`), padahal tujuannya sudah benar.
4. Pesan issue dari server dalam bahasa Inggris dan tampil apa adanya di bawah field (`site.checks.ts:88,104,108`; `wizard.target.tsx:20`), melanggar panduan konten.
5. Error field tidak terhubung ke input (`aria-describedby` tidak di-set; `form.field.tsx:24` hanya memberi `id` ke `<ul>`).
6. Integrasi belum lengkap tidak menghentikan wizard: job tetap sukses dengan catatan "WARNING: ecosystem.config.js does not include apps.json" di pesan langkah (`site.jobs.ts:51-54`). Situs terlihat "berhasil" tetapi tidak akan pernah dijalankan pm2 saat HP reboot.
7. Toggle database tanpa penjelasan sumber daya (role + DB di Postgres lokal, `DATABASE_URL` via TCP 127.0.0.1).

### 2.4 Detail situs

`SiteDetailPage` (`site-detail.page.tsx:54-89`) menumpuk 6 kartu: Informasi, Domain, Deploy, Riwayat deploy, Variabel lingkungan, lalu tombol Hapus situs.

**Masalah:**

1. Tidak ada header status + aksi utama (benchmark §4: nama + status + domain utama + tombol "Deploy" + menu). Tidak ada Mulai ulang/Hentikan/Log untuk aplikasi situs; pengguna harus pindah ke `/panel/apps`.
2. Info "Runtime" menampilkan `native`/`grun` mentah. "Dikelola: Diadopsi" membingungkan.
3. Tidak ada "deploy aktif" (versi berjalan, kapan, oleh siapa) seperti tile Production Deployment di Vercel (benchmark §4).
4. Hapus situs pakai `AlertDialog` biasa (`site.delete.tsx:39-74`). Benchmark §7/§9 meminta pengguna mengetik nama situs dulu, karena aksi ini menghapus database dan folder secara permanen.
5. Halaman mobile = scroll panjang 6 kartu tanpa tab/anchor.

### 2.5 Perubahan (job): step runner, rollback, riwayat, progres

**Runner** (`job.runner.ts:54-188`): satu kunci global (`:55`, `assertIdle :132-134`). Setiap perubahan langkah disimpan ke DB. Bila gagal, langkah yang selesai di-undo terbalik. Langkah `irreversible` membuat hasil akhir "failed" (`:104-107`). Status akhir `rolled_back` hanya bila semua undo bersih (`:124`). Saat boot, job `running` ditandai `failed: "interrupted by panel restart"` (`:57-61`).

**UI**: `JobPage` polling 1 dtk (`job.page.tsx:67-89`, `job.state.ts:5`), progress bar = langkah selesai/total (`job.state.ts:13-18`), daftar langkah dengan ikon (`job.steps.tsx:25-52`). `JobsPage` = daftar sederhana jenis · target · waktu · status (`jobs.page.tsx:19-54`).

**Masalah:**

1. **Label dan pesan langkah dari server berbahasa Inggris** ("Validate", "Create site folder", "Assemble upload", "sha256 ok", `site.jobs.ts:83,91`, `deploy.steps.ts:59,79`) dan tampil langsung (`job.steps.tsx:42-45`). Pesan error job juga mentah (`job.page.tsx:45`).
2. Tidak ada durasi per langkah atau total. Tidak ada log per langkah; hanya satu `message`. Saat health check gagal, alasan sebenarnya (stderr aplikasi) tidak ikut, hanya "not healthy on port … (GET / returned 502)" (`deploy.steps.ts:241-243`).
3. Tidak ada aktor di kontrak `Job` dan tidak ada filter per situs. Riwayat perubahan global tidak bisa dibuka dari detail situs.
4. Tidak ada aksi lanjutan setelah gagal ("Coba lagi", "Lihat log aplikasi", "Kembalikan versi sebelumnya"), padahal benchmark §5 P1 memintanya.
5. 409 `busy` hanya toast "Ada perubahan lain…" (`id.site.ts:8`) tanpa tautan ke perubahan yang sedang berjalan.
6. `rolled_back` dan `failed` sama-sama merah (`job.state.ts:32`). Tidak ada pembeda "aman, semua dikembalikan" dan "butuh tindakan manual". Untuk `failed` dengan undo gagal, pesan "undo failed: …" hanya terselip di pesan langkah (`job.runner.ts:113`), tanpa petunjuk perbaikan.
7. Bila `save()` ke SQLite melempar (mis. disk penuh), `execute` crash (`job.runner.ts:157-158`), job tetap `running` di DB, dan halaman progres polling selamanya. Status itu baru diperbaiki setelah panel restart.
8. **Panel restart di tengah job**: hanya status yang ditandai gagal. Langkah yang sudah jalan tidak di-undo (detail di §4.3).

### 2.6 Domain (ingress + DNS Cloudflare)

- Ingress diedit sebagai teks, lalu di-parse ulang dan diverifikasi bahwa hanya daftar ingress yang berubah (`ingress.editor.ts:53-59, 82-113`). Kandidat divalidasi `cloudflared tunnel ingress validate` sebelum rename atomik, dengan backup `config.yml.bak` (`site.steps.ts:26-57`). Desainnya bagus.
- Restart cloudflared ditunggu hanya sampai runit `run` (`site.steps.ts:59-70`), belum sampai tunnel benar-benar tersambung (koneksi edge terdaftar). Setelah itu tidak ada pengecekan HTTPS ke domain baru.
- DNS: zone dicari dari suffix terpanjang (`dns.provider.ts:54-60`). Record dibuat dengan komentar "managed by panel-termux" dan dicatat di `dns_record`. Panel hanya menghapus record miliknya (`:132-146`). Kepemilikan sudah benar.
- Hapus domain terakhir ditolak (`site.service.ts:233`). Domain tulisan tangan di situs adopsi ditolak 409 `hand_written` (`:234-236`), tetapi kode itu tidak dipetakan di i18n, jadi yang tampil pesan Inggris.
- **Setiap perubahan domain memutus semua domain di tunnel**, termasuk panel sendiri: progres yang sedang di-poll dan unggahan admin lain ikut gagal sejenak (`README.md` Keterbatasan; `id.site.ts:75`).

### 2.7 Variabel lingkungan

- Write-only: hanya kunci yang dikirim ke klien (`site.service.ts:95`, `env.file.ts:36-38`). Nilai tidak pernah dibaca balik, dan audit hanya mencatat kunci (`site.service.ts:209-210`). Sesuai pola Vercel "Secret" (benchmark §7).
- Batas penulisan (`env.file.ts:14-25`): satu baris, tanpa `'`, tidak boleh berakhir `\`, maks 16.384 karakter. `$` di-escape. Multi-line (mis. private key PEM) **tidak didukung**, dan pesan errornya Inggris.
- `updateEnv` membuang baris kunci yang disentuh lalu menambahkannya di akhir (`env.file.ts:44-50`), jadi urutan dan komentar di dekat kunci bisa bergeser. File `.env` tulisan tangan dengan nilai multi-line bisa rusak (sudah dicatat di komentar `:42`).
- **Semantik restart**: simpan = `pm2 restart` langsung (`site.service.ts:211`), sinkron, di luar kunci job, tanpa health check, tanpa catatan di riwayat perubahan. Jika gagal (aplikasi crash karena nilai salah), pengguna hanya melihat toast "disimpan dan aplikasi dimulai ulang" (`id.site.ts:135`).
- Tidak ada "Tempel .env" (benchmark §7 P1), tidak ada "diubah kapan", dan tidak bisa menyimpan tanpa restart (untuk mengubah beberapa kunci lalu restart sekali).
- `PORT`/`DATABASE_URL` dikunci sebagai "Diisi otomatis oleh panel" juga di situs **adopsi** (`env.rows.ts:5`, `site.env-editor.tsx:57-63`), padahal di POCO kedua kunci itu ditulis tangan oleh pemilik (`makuro-solusi/.env` berisi `PORT` dan `DATABASE_URL`). Server justru mengizinkan `set` untuk kunci itu di `updateEnv`; `RESERVED_ENV` hanya berlaku saat create (`site.service.ts:31,136`). Aturan klien dan server tidak sama.
- Regex kunci berbeda: server menerima huruf kecil (`env.file.ts:4`), klien hanya huruf besar (`env.rows.ts:2`).

### 2.8 Database per situs

- `CREATE ROLE … LOGIN PASSWORD` + `CREATE DATABASE … OWNER` lewat stdin psql. Password 24 byte hex tidak pernah muncul di argv dan disamarkan di stderr (`postgres.termux.ts:40-61`). `DATABASE_URL` memakai TCP `127.0.0.1:5432` (`site.jobs.ts:23-24,126`), dan di HP TCP memakai scram (`postgres.termux.ts:5-8`). Sudah baik.
- Celah: hanya ada saat create. Tidak ada "tambah database ke situs yang sudah ada", tidak ada tampilan database situs di detail selain nama, tidak ada rotasi password, dan tidak ada tautan ke cadangan terakhir database itu. Hapus situs menjatuhkan DB `WITH (FORCE)` (`postgres.termux.ts:47-49`) tanpa memeriksa apakah sudah ada cadangan.

### 2.9 Deploy

**Klien** (`deploy.card.tsx:45-162`, `deploy.api.ts:64-83`): pilih file → SHA-256 seluruh file di memori (`deploy.upload.ts:35-42`) → `POST uploads` → PUT chunk 8 MB berurutan, retry 1/2/4 dtk untuk error jaringan/5xx (`deploy.upload.ts:17-22`) → `complete` → halaman progres.

**Server** (`deploy.service.ts:135-168`, `deploy.steps.ts`): Assemble (+cek ukuran & sha) → Detect runtime (ELF `PT_INTERP`) → chmod 755 → Swap (`app→app.prev`, `app.new→app`, `app.prev` lama disisihkan ke `.app.prev.drop`) → update runtime di `apps.json` (situs terkelola saja) → restart pm2 (start dari ecosystem bila entri berubah atau belum dikenal pm2) → tunggu `GET /` < 500 maksimal 30 dtk (`deploy.service.ts:31`, `deploy.steps.ts:230-246`). Bila gagal: undo swap + restart lagi (`revertApp`, `:212-217`). Rollback manual = tukar `app ↔ app.prev` (`:133-150`).

**Masalah:**

1. **Unggahan tidak bisa dilanjutkan.** Server mendukung ulang per chunk dan mengembalikan `received` (`deploy.types.ts:18-24`), tetapi klien yang gagal kembali ke "ready" dan memulai unggahan **baru dari chunk 0** (`deploy.card.tsx:85-89`, `upload.store.ts:76` membuang unggahan lama). Dengan binary 89 MB lewat VPN/4G (POCO: VPN pernah putus di tengah 89 MB, lihat memory proyek), ini paling sering mengganggu. Retry total hanya sekitar 7 dtk, padahal restart cloudflared bisa memakan waktu hingga 30 dtk (`site.steps.ts:13`).
2. Meninggalkan halaman membatalkan unggahan (`deploy.card.tsx:52`) tanpa DELETE, sehingga sisa chunk menempati disk sampai 1 jam (`upload.store.ts:9`). Panel restart = unggahan hilang (`:35-42`), lalu klien mendapat 404 dan pesan generik "Periksa koneksi internet" (`id.deploy.ts:24`), padahal penyebabnya bukan koneksi.
3. Hash di browser membaca seluruh file ke memori (hingga 300 MB, `deploy.types.ts:7`). Di HP kelas bawah ini bisa crash tab. Tidak ada progres hashing.
4. **Health check terlalu sederhana**: satu jawaban < 500 dianggap sehat. Aplikasi yang hidup 2 detik lalu crash (migrasi gagal, env salah) lolos, lalu pm2 restart-loop di belakang (`exp_backoff_restart_delay` di ecosystem). Timeout 30 dtk tidak bisa diatur per situs. Bun binary besar di HP + migrasi DB bisa lebih lambat dari itu. Path `/` tidak bisa diganti.
5. **Hanya satu versi sebelumnya** (`app.prev`). Riwayat menampilkan banyak baris, tetapi "Rollback ke sini" tidak mungkin. `canRollback` di klien ditebak dari riwayat, bukan dari keberadaan `app.prev` (`deploy.state.ts:14-17`). Tidak ada penanda deploy "Aktif".
6. Dialog rollback tidak menjelaskan apa yang ikut dan tidak ikut (variabel lingkungan, database, `data/` tetap) dan tidak menampilkan "versi X → versi Y" (benchmark §5 P1).
7. Situs adopsi + binary dengan runtime berbeda (mis. `makuro-solusi` saat ini glibc/`grun`, pemilik ganti ke target Android): langkah apps.json dilewati dengan catatan (`deploy.steps.ts:175-177`), lalu pm2 menjalankan `grun ./app` pada binary Android. Restart atau health check gagal, swap dibalik. Kondisi ini bisa ditolak **sebelum** unggahan selesai, karena runtime sudah terbaca dari chunk 0 (`deploy.service.ts:143`).
8. Tidak ada log deploy per langkah dan tidak ada potongan log aplikasi saat gagal. Tidak ada nama file asli di riwayat (hanya sha 12 karakter, `deploy.history.tsx:69-71`). Tidak ada durasi.
9. Tidak ada "Mulai ulang" tanpa deploy, tidak ada "Cek kesehatan sekarang".
10. Restart pm2 untuk situs terkelola = `pm2 delete` + `pm2 start ecosystem --only` (`deploy.steps.ts:197-201`). Ada jeda downtime (diakui di komentar `:192`), dan **tidak ada zero-downtime** (port tunggal). Ini wajar untuk satu HP, tetapi harus dijelaskan di UI ("situs terputus beberapa detik").

### 2.10 Integrasi pm2 (`apps.json`)

- `GET /integration` (`site.service.ts:256-280`) memeriksa `ecosystem.config.js` dengan regex `/apps\.json/` (`:268`). Komentar yang menyebut apps.json pun dianggap cukup.
- **Urutan saran berbahaya.** Banner meminta pemilik menambahkan `...require('./apps.json')` (`id.site.ts:45-46`) dan sekaligus menyatakan "apps.json belum ada, dibuat saat situs pertama" (`:47`, `site.service.ts:274`). `require` pada file yang tidak ada akan melempar error, jadi `pm2-runtime` gagal memuat ecosystem pada restart runit berikutnya (reboot HP), dan **semua aplikasi mati**, termasuk `makuro-solusi`. Snippet di README (`README.md` "Integrasi pm2") juga tanpa pengaman.
- Tidak ada tombol "Periksa lagi". Banner hanya dimuat sekali per kunjungan (`integration.banner.tsx:15`).
- pm2-runtime hanya membaca ecosystem saat start. Panel memakai `pm2 start <ecosystem> --only <nama>` (`pm2.termux.ts:135-139`), jadi entri baru tetap berjalan tanpa restart pm2 dan tersimpan untuk reboot. Ini sudah benar, tetapi bergantung pada integrasi di atas. Entri situs yang belum pernah di-deploy (`./app` tidak ada) ikut dimuat saat reboot dan akan berstatus _errored_ atau restart-loop. Perilaku pm2-runtime untuk entri dengan script hilang **belum diverifikasi** di HP (lihat §7).

### 2.11 Kondisi nyata POCO (read-only, 2026-11-26)

- `~/sites/`: `README.md`, `ecosystem.config.js` (27 baris, tulisan tangan), `makuro-solusi/` (`app` 89.180.456 B ELF aarch64, `.env` 600, `data/`), `adminneo/` (PHP). **Tidak ada `apps.json`**, dan ecosystem **tidak** menyebarnya.
- `ecosystem.config.js`: helper `site(name)` → `{cwd: ~/sites/<name>, script: $PREFIX/bin/grun, args: './app', interpreter: 'none', exp_backoff_restart_delay: 1000}`; apps = `site('makuro-solusi')` + `adminneo` (php `-S 127.0.0.1:8080`, sengaja tanpa domain).
- pm2 jlist (hanya nama/status/ada-tidaknya PORT yang dicetak): `pm2-logrotate` (modul), `makuro-solusi` online restarts=1 **tanpa PORT di env pm2**, `adminneo` online (port dari args 8080).
- `config.yml`: `tunnel: poco` (nama, UUID dari nama file kredensial) → ingress `solusi.malikkurosaki.com → :3005`, `panel.malikkurosaki.com → :3200`, catch-all 404. Ada backup manual `config.yml.bak-panel-20261126210016`.
- Kunci `.env` makuro-solusi (nama saja): APP_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MAKURO_KEY, MCP_ADMIN_TOKEN, NODE_ENV, PORT, SUPER_ADMIN_EMAILS, TRUSTED_PROXIES, DATABASE_URL.
- Panel: `~/panel/panel` + `panel.prev`, `~/panel/data` 359 KB (`uploads/` kosong). Penyimpanan 171 GB bebas dari 232 GB.
- Artinya "Belum dikelola" di produksi saat ini berisi **dua** entri: `solusi.malikkurosaki.com` (port 3005, aplikasi tidak diketahui) dan **panel itu sendiri**. Port 3200 (panel) ada di dalam `sites.port_range` 3001-3999. Port itu hanya aman karena `suggestPort` mengecek listener (`site.checks.ts:72`). Bila panel sedang mati saat wizard dibuka, 3200 bisa ditawarkan ke situs baru.

---

## 3. Standar industri

| Topik                               | Produk & sumber                                                                                                                                                                                 | Pola                                                                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stepper deploy + log per tahap      | Coolify deployment logs (benchmark §5, `img/coolify-deploy-logs.png`)                                                                                                                           | Penanda tahap, timestamp per baris, pill status, durasi, "Find in logs", unduh                                                                                                                                            |
| Health check sebelum dianggap aktif | Railway docs Healthchecks (dicek hari ini)                                                                                                                                                      | Query endpoint sampai 2xx. **Default timeout 300 dtk**, bisa diatur per service (`RAILWAY_HEALTHCHECK_TIMEOUT_SEC`). Path diatur pengguna. Tidak dimonitor setelah live. Service dengan volume tetap ada downtime singkat |
| Zero-downtime vs disk               | Render docs Deploys (dicek hari ini)                                                                                                                                                            | Zero-downtime kecuali ada persistent disk. Gagal/timeout mana pun → service tetap di deploy sukses terakhir                                                                                                               |
| Rollback                            | Render/Vercel/CapRover (benchmark §5)                                                                                                                                                           | Rollback dari daftar deploy, dialog "dari → ke", tabel yang ikut/tidak ikut (env ✓, disk ✗, domain ✗), satu rollback sekaligus, artefak lama dipakai ulang (cepat)                                                        |
| Banyak versi                        | Vercel Instant Rollback, Render (benchmark §5)                                                                                                                                                  | Rollback ke deploy mana pun yang masih ada artefaknya, bukan hanya satu sebelumnya                                                                                                                                        |
| Variabel lingkungan                 | Vercel Secret/Config, Railway raw editor (benchmark §7)                                                                                                                                         | Write-only "provide new value to rotate", tempel `.env`, banner "perlu restart/deploy agar berlaku"                                                                                                                       |
| Staged changes                      | Railway (benchmark §5)                                                                                                                                                                          | Perubahan ditinjau dulu, lalu di-deploy sekali                                                                                                                                                                            |
| Konfirmasi destruktif               | Vercel (benchmark §7, §9)                                                                                                                                                                       | Ketik nama proyek untuk hapus                                                                                                                                                                                             |
| Satu aksi berjalan per resource     | Vercel, Railway "multiple deployments … prevent"                                                                                                                                                | Antrian/penolakan dengan tautan ke yang berjalan                                                                                                                                                                          |
| Sumber deploy                       | Coolify/Dokploy/Railway/Render = build dari Git (Nixpacks/Dockerfile/buildpack); Railway `railway up` & Vercel CLI = unggah direktori/`--prebuilt`; Render "deploy image" = tarik dari registry | Upload artefak jadi (prebuilt) adalah jalur sah. Git-build butuh builder yang kuat                                                                                                                                        |
| Onboarding                          | Coolify "Choose a resource", checklist (benchmark §9)                                                                                                                                           | Langkah pertama = katalog/wizard. Checklist yang tercentang otomatis dari data nyata                                                                                                                                      |

Catatan: halaman docs Coolify "rollbacks" 404 dan Dokploy docs memberi SSL 525 saat dicek. Klaim tentang rollback Coolify/Dokploy (tag image Docker lama, butuh image masih ada lokal/registry) berasal dari pengetahuan umum dan tidak dipakai sebagai dasar keputusan.

**Evaluasi git-based / URL-based deploy (diminta brief):**

- _Build dari Git di HP_: tidak realistis untuk sekarang. Bun tidak punya runtime Android native di Termux (pakai `grun`/glibc). `bun install` + `bun build --compile` binary 89 MB di HP memakan RAM/CPU dan baterai, waktunya tidak bisa diprediksi, dan butuh kredensial Git (deploy key) tersimpan di HP. Coolify/Dokploy bisa melakukannya karena berjalan di VPS dengan Docker. Keputusan: **di luar scope**.
- _Deploy dari URL_ (mis. aset GitHub Release + sha256 wajib): murah. HP mengunduh langsung dengan koneksinya sendiri, tanpa VPN atau batas 100 MB Cloudflare, dan memakai ulang langkah assemble/detect/swap/health. Risiko SSRF bisa dibatasi dengan hanya https, tanpa IP privat/loopback, dan batas ukuran. Rekomendasi: **P2, setelah P0/P1**.
- _Deploy dari CI_ (GitHub Actions memanggil API dengan token deploy): butuh auth non-Google, token per situs, dan service token Cloudflare Access. Permukaan keamanannya besar. **P3 / keputusan pemilik.**
- _Preview deployment_ (Render/Vercel): butuh port + domain + DB terpisah per preview. Di satu HP biayanya tidak sebanding. **Di luar scope.**

---

## 4. Kebutuhan produksi

### 4.1 Keamanan

- Rahasia tetap write-only end-to-end: nilai env tidak pernah masuk audit, log, pesan job, atau toast. Saat ini aman (`site.service.ts:209`, `postgres.termux.ts:58-59`). Fitur baru (tempel `.env`, potongan log aplikasi di job) harus menjaga ini. Log stderr aplikasi bisa memuat rahasia, jadi potongan log hanya ditampilkan ke admin dan **tidak** disimpan permanen di `job.steps`.
- Adopsi tidak boleh bisa menunjuk panel sendiri, `sshd`, atau folder di luar `sites.dir`. Saat ini `dir` selalu di bawah `sites.dir` (aman), tetapi host panel tidak dikecualikan.
- Deploy dari URL (bila dibuat): hanya https, tolak host privat/loopback/link-local, sha256 wajib, ukuran maks sama.
- Kunci global job juga harus dihormati oleh aksi kontrol dari `/panel/apps` dan `/panel/services` (restart `cloudflared`/aplikasi situs saat job berjalan). Sekarang lock-nya terpisah (`panel/action.lock.ts:7-18`).

### 4.2 Reliabilitas & integritas data

- Setiap file bersama (`config.yml`, `apps.json`, `ecosystem.config.js`) diubah dengan cara yang sama: tulis atomik, backup, validasi. Untuk ecosystem, validasi = `node -e "require(path)"` lewat `$PREFIX/bin/node` (pola `runTermux` sudah ada).
- Recovery setelah panel restart di tengah job (lihat §4.3).
- Health check yang memastikan aplikasi **stabil** (contoh: sehat 2x berturut-turut dan jumlah restart pm2 tidak naik selama N dtk setelah sehat).
- Hapus situs dengan database mewajibkan konfirmasi ketik nama, dan sebaiknya menawarkan cadangan dulu.

### 4.3 Mode gagal

| Kejadian                                                                      | Perilaku sekarang                                                                                                                                                                                                                         | Dampak                                                                                                                                                                                                                                                                                                                                                                                     | Kebutuhan                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restart cloudflared (setiap perubahan domain)                                 | Semua domain putus beberapa detik, termasuk panel. Runner menunggu runit `run` ≤ 30 dtk (`site.steps.ts:59-70`)                                                                                                                           | Polling progres error sejenak. Unggahan admin lain gagal setelah ~7 dtk retry. Situs lain blip                                                                                                                                                                                                                                                                                             | Jelaskan di UI ("panel ikut terputus sebentar; halaman ini lanjut otomatis"). Unggahan tidak boleh dimulai/berjalan saat job tunnel berjalan, atau retry harus bertahan ≥ 60 dtk. Tunggu tunnel benar-benar tersambung + probe HTTPS domain baru (non-fatal) |
| VPN/4G putus saat unggah                                                      | Retry 3x lalu gagal, dan unggah ulang dimulai dari 0                                                                                                                                                                                      | 89 MB diulang                                                                                                                                                                                                                                                                                                                                                                              | Lanjutkan dari `received` (server sudah mendukung), retry lebih panjang dengan backoff, tombol "Lanjutkan unggahan"                                                                                                                                          |
| Sesi Cloudflare Access habis saat unggah                                      | 401 → `apiFetch`/`failedResponse` reload halaman                                                                                                                                                                                          | Unggahan hilang                                                                                                                                                                                                                                                                                                                                                                            | Dengan resume, setelah login ulang pengguna cukup menekan "Lanjutkan" (simpan `uploadId` + nama file di `sessionStorage`, file dipilih ulang dan dicocokkan via sha)                                                                                         |
| Disk penuh                                                                    | Chunk `Bun.write` gagal → 500 (retryable → retry sia-sia). Assemble gagal → undo. Gagal tulis SQLite di runner → job "running" selamanya (§2.5-7)                                                                                         | Membingungkan, job menggantung                                                                                                                                                                                                                                                                                                                                                             | Preflight ruang bebas di `POST uploads` (≥ 2× ukuran + cadangan) → 507/`no_space` yang jelas. Runner menangkap error `save()` dan menandai gagal di memori + log. Batasi sisa `.app.prev.drop`/uploads                                                       |
| Health check flaky                                                            | Satu 2xx-4xx = sukses. 30 dtk tetap                                                                                                                                                                                                       | Crash-loop lolos / start lambat ditolak                                                                                                                                                                                                                                                                                                                                                    | Path + timeout per situs (default 60 dtk), syarat stabil, tampilkan stderr terakhir saat gagal                                                                                                                                                               |
| Dua aksi bersamaan                                                            | Job: 409 `busy` global. Env save dan kontrol pm2/runit tidak ikut kunci                                                                                                                                                                   | Env save di tengah health check deploy memicu restart → health salah/false-fail                                                                                                                                                                                                                                                                                                            | Env save dan restart aplikasi situs lewat runner (atau minimal `assertIdle`). Kontrol `cloudflared`/aplikasi situs dari halaman lain cek `jobs.busy()`. UI menampilkan banner "Perubahan sedang berjalan → lihat"                                            |
| Panel restart di tengah job (OOM, `sv restart panel` saat upgrade, reboot HP) | Job ditandai `failed: interrupted by panel restart` (`job.runner.ts:57-61`), deploy `failed` (`deploy.service.ts:51`). Shutdown menunggu ≤ 20 dtk (`shutdown.ts:4`), padahal satu job bisa > 60 dtk (cloudflared 30 + health 30 + pm2 20) | **Tidak cukup.** Sisa setengah jadi: entri `apps.json` tanpa baris `site` (nama jadi "taken" dan folder "exists", sehingga wizard selanjutnya menolak nama itu dan tidak ada jalan bersih-bersih dari UI), `config.yml` berubah tanpa cloudflared restart (berlaku diam-diam saat restart berikutnya), `app.new`/`.app.prev.drop` tertinggal, binary sudah tertukar tapi pm2 belum restart | Lihat Opsi 6.3                                                                                                                                                                                                                                               |
| pm2-runtime restart (reboot) dengan entri `apps.json` tanpa binary            | Belum diverifikasi                                                                                                                                                                                                                        | Bisa errored/loop                                                                                                                                                                                                                                                                                                                                                                          | Jangan tulis entri `apps.json` sebelum ada binary (Opsi 6.4), atau verifikasi                                                                                                                                                                                |
| `require('./apps.json')` tanpa file                                           | Tidak dicegah, banner justru menyarankan                                                                                                                                                                                                  | Semua aplikasi mati setelah reboot                                                                                                                                                                                                                                                                                                                                                         | P0 (Gap 1)                                                                                                                                                                                                                                                   |

### 4.4 Performa di HP

- `toSites` memanggil `pm2 jlist` setiap kali list dimuat dan setiap refresh (`site.service.ts:68`, `PANEL_REFRESH_MS`). pm2 jlist butuh node + RPC, bisa beberapa detik (`pm2.termux.ts:14-15`). `/sites/check` memanggil `pm2 list` + `listIngress` + `isListening` per ketikan (debounce 400 ms) dan bisa memanggil `usedPorts` dua kali (`site.checks.ts:115`). Cache jlist pendek (2–5 dtk) bersama untuk list/check/discovered sudah cukup.
- Hash di browser: streaming lewat `file.slice` + hasher inkremental. `crypto.subtle` tidak streaming, jadi perlu implementasi SHA-256 inkremental kecil di klien atau pindahkan verifikasi ke per-chunk (sha per chunk + sha akhir dihitung server saat assemble). Opsi 6.5.

### 4.5 Aksesibilitas (WCAG AA)

- Error field → `aria-describedby` + `aria-invalid` (sudah sebagian). Progres job: `aria-live` hanya pada teks "Sedang berjalan…" (`job.page.tsx:80`). Perubahan langkah tidak diumumkan. Gunakan satu region live yang mengumumkan "Langkah 4 dari 8: Mengunggah… selesai".
- Ikon status langkah sudah punya teks sr-only (`job.steps.tsx:43`). Pertahankan.
- Input file `aria-hidden` + `tabIndex=-1` (`deploy.card.tsx:110-120`). Tombol pengganti bisa difokus, jadi aman. Bila drop zone ditambah, tetap pertahankan tombol.
- Warna amber banner (`integration.banner.tsx:22`, `wizard.summary.tsx:35`) memakai kelas ad-hoc, bukan token wave A. Kontras perlu dicek di dark mode.

### 4.6 Mobile

- Wizard dan detail adalah pemakaian utama di HP. Kebutuhannya: tombol aksi utama selalu terlihat (sticky di bawah), detail dibagi tab/anchor, riwayat deploy berupa list padat, log dalam sheet layar penuh (benchmark §6 P2).
- Unggah dari HP: file binary biasanya ada di laptop. Alur realistis di HP adalah "Deploy dari URL" (P2) atau rollback/restart. Unggah dari HP tetap harus bisa (file di Downloads).

### 4.7 Observability

- Setiap job punya: aktor, durasi per langkah, pesan dalam bahasa Indonesia, dan detail teknis (Inggris boleh) di bawahnya yang bisa disalin (pola panduan konten "detail server di bawahnya").
- Saat deploy/restart gagal: tampilkan 30–50 baris stderr terakhir aplikasi (ambil saat itu lewat `pm2.readLog`, `pm2.termux.ts:123-129`) dengan tautan "Buka log aplikasi".
- Ringkasan (`overview.problems.ts`) sebaiknya memuat "Perubahan gagal butuh tindakan" dan "Situs bermasalah/restart-loop" (koordinasi dengan worker Ringkasan).

---

## 5. Kesenjangan (gap list)

| #   | Gap                                                                                                                             | Sev.            | Kenapa                                                                                                         | Bukti                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Saran integrasi `...require('./apps.json')` diberikan saat `apps.json` belum ada                                                | **P0**          | Satu reboot HP setelah pemilik mengikuti saran = pm2-runtime gagal, semua aplikasi produksi mati               | `id.site.ts:45-47`, `site.service.ts:274`, POCO tanpa apps.json         |
| 2   | Adopsi tanpa validasi folder/aplikasi/runtime; `dir` dipaksa `~/sites/<nama>`; aplikasi pm2 opsional & tidak terdeteksi di POCO | **P0**          | Situs adopsi pertama pemilik (makuro-solusi) sangat mungkin tercatat salah, dan deploy pertama gagal di tengah | `site.service.ts:154-195`, `site.adopt.ts:8-13`, pm2 tanpa PORT (§2.11) |
| 3   | Host panel sendiri muncul di "Belum dikelola"                                                                                   | **P0**          | Mengadopsi panel lalu menghapus/mengubah domainnya bisa memutus akses panel                                    | `site.service.ts:100-116`, POCO ingress                                 |
| 4   | Panel restart di tengah job meninggalkan state setengah jadi tanpa recovery/undo, dan tanpa jalan bersih-bersih dari UI         | **P0**          | Integritas file bersama, nama situs "terkunci"                                                                 | `job.runner.ts:57-61`, `shutdown.ts:4`                                  |
| 5   | Unggahan tidak bisa dilanjutkan; retry 7 dtk lebih pendek dari blip tunnel                                                      | **P0**          | Pemakaian utama: 89 MB lewat VPN/4G                                                                            | `deploy.card.tsx:85-89`, `upload.store.ts:76`, `deploy.upload.ts:17-22` |
| 6   | Label/pesan langkah job dan error 4xx berbahasa Inggris mentah                                                                  | **P0** (konten) | Melanggar panduan konten di layar paling kritis (saat gagal)                                                   | `site.jobs.ts:83+`, `deploy.steps.ts:59+`, `api.client.ts:103`          |
| 7   | Deploy gagal tanpa stderr aplikasi dan tanpa aksi lanjutan                                                                      | **P0**          | Pengguna tidak tahu kenapa gagal                                                                               | `deploy.steps.ts:241-243`, `job.page.tsx:37-48`                         |
| 8   | Health check: satu respons cukup, 30 dtk tetap, path tetap                                                                      | P1              | False positive crash-loop / false negative start lambat                                                        | `deploy.steps.ts:230-246`, Railway default 300 dtk                      |
| 9   | Env save = restart langsung di luar kunci job, tanpa health/riwayat                                                             | P1              | Race dengan deploy; perubahan tak tercatat di Riwayat perubahan                                                | `site.service.ts:197-214`                                               |
| 10  | Kunci job tidak berlaku untuk kontrol `/panel/apps` & `/panel/services`                                                         | P1              | Restart cloudflared/aplikasi situs di tengah job                                                               | `action.lock.ts`, `job.runner.ts:55`                                    |
| 11  | Runtime berbeda pada situs adopsi baru ditolak setelah swap                                                                     | P1              | Downtime + rollback yang tidak perlu; seharusnya ditolak saat `complete`                                       | `deploy.steps.ts:175-177`, `deploy.service.ts:143`                      |
| 12  | Wizard tidak berlanjut ke deploy pertama; entri apps.json dibuat sebelum binary ada                                             | P1              | Situs baru "berhasil" tapi tidak jalan; risiko errored saat reboot                                             | `site.jobs.ts:73-79,135`                                                |
| 13  | Konflik/kepemilikan DNS baru dicek di langkah 7; CNAME manual ke tunnel yang sama ditolak                                       | P1              | Rollback + blink ganda; resep README sendiri memicu konflik                                                    | `site.checks.ts:103-109`, `dns.provider.ts:98-102`                      |
| 14  | Integrasi tidak memblokir wizard dan tidak ada "Periksa lagi"/bantuan otomatis                                                  | P1              | Situs dibuat dalam kondisi tidak akan jalan                                                                    | `site.jobs.ts:51-54`, `integration.banner.tsx:15`                       |
| 15  | Hanya `app.prev`; tidak ada penanda "Aktif"; `canRollback` ditebak                                                              | P1              | Rollback dari riwayat (pola industri) tak mungkin; UI bisa salah                                               | `deploy.steps.ts:32-39`, `deploy.state.ts:14-17`                        |
| 16  | Dialog rollback tanpa "dari → ke" dan tanpa daftar yang ikut/tidak ikut                                                         | P1              | Benchmark §5 P1                                                                                                | `id.deploy.ts:30-36`                                                    |
| 17  | Hapus situs (DB + folder) tanpa ketik nama, tanpa tawaran cadangan                                                              | P1              | Kehilangan data permanen, pelajaran HP1                                                                        | `site.delete.tsx:39-74`                                                 |
| 18  | Detail situs tanpa header status/aksi utama, tanpa restart/log; belum pakai komponen wave A                                     | P1              | Benchmark §4                                                                                                   | `site-detail.page.tsx:54-89`                                            |
| 19  | Job tanpa aktor, durasi, filter per situs; tautan 409 busy ke job berjalan                                                      | P1              | Observability & UX                                                                                             | `site.types.ts:73-82`, `jobs.page.tsx`                                  |
| 20  | `rolled_back` vs `failed` tidak dibedakan maknanya ("aman" vs "butuh tindakan")                                                 | P1              | Pengguna tidak tahu apakah harus bertindak                                                                     | `job.state.ts:32`, `id.site.ts:156-158`                                 |
| 21  | Error `save()` SQLite membuat job menggantung "running"                                                                         | P1              | Polling tanpa akhir                                                                                            | `job.runner.ts:63-69,157`                                               |
| 22  | Preflight ruang disk untuk unggahan                                                                                             | P1              | Pesan jelas sebelum 89 MB terkirim                                                                             | `upload.store.ts:68-91`                                                 |
| 23  | Kunci reserved PORT/DATABASE_URL dikunci juga di situs adopsi; regex kunci klien ≠ server                                       | P1              | Pemilik tak bisa mengubah DATABASE_URL makuro-solusi dari panel                                                | `env.rows.ts:2,5`, `env.file.ts:4`, `site.service.ts:31`                |
| 24  | Hash seluruh file di memori browser                                                                                             | P2              | Tab HP bisa crash di file besar                                                                                | `deploy.upload.ts:35-42`                                                |
| 25  | Tempel `.env`, simpan tanpa restart, "diubah kapan"                                                                             | P2              | Benchmark §7                                                                                                   | `site.env-editor.tsx`                                                   |
| 26  | Nilai env multi-line tidak didukung                                                                                             | P2              | PEM/JSON key; pesan Inggris                                                                                    | `env.file.ts:9,21-23`                                                   |
| 27  | Tidak menunggu tunnel benar-benar tersambung + probe HTTPS domain baru                                                          | P2              | Job "berhasil" tapi domain 530/1033                                                                            | `site.steps.ts:59-70`                                                   |
| 28  | Cache `pm2 jlist` untuk list/check/discovered                                                                                   | P2              | Lambat di HP                                                                                                   | `site.service.ts:68`, `site.checks.ts:51,91,115`                        |
| 29  | Deploy dari URL                                                                                                                 | P2              | Unggah dari HP/VPN lemah                                                                                       | §3                                                                      |
| 30  | Tambah database ke situs yang sudah ada / lihat cadangan DB situs                                                               | P2              | Siklus hidup DB                                                                                                | `site.jobs.ts:102-119`                                                  |
| 31  | Port panel di dalam `sites.port_range`                                                                                          | P2              | Bisa ditawarkan ke situs baru saat panel mati                                                                  | `README.md` default 3001-3999, PORT 3200                                |
| 32  | Deploy dari CI (token)                                                                                                          | P3              | Keputusan pemilik                                                                                              | §3                                                                      |

---

## 6. Opsi & trade-off

### 6.1 Integrasi `apps.json` (Gap 1, 14)

- **A. Panel membuat `apps.json` berisi `[]` saat `GET /integration` mendeteksi file belum ada**, dan snippet diganti versi aman:
  `...(require('fs').existsSync(__dirname + '/apps.json') ? require('./apps.json') : [])`. Pemilik tetap mengedit manual, panel memverifikasi dengan `node -e require()`. Diff kecil, panel tidak menyentuh file JS tulisan tangan.
- **B. Tombol "Hubungkan otomatis"**: panel menyisipkan baris ke `apps: [` dengan editor teks + backup + validasi `node -e` (pola `ingress.editor.ts`). Paling nyaman, tetapi parser teks JS rapuh (helper `site()`, komentar), dan kesalahan berarti semua aplikasi mati saat reboot.
- **C. Panel mengambil alih seluruh ecosystem** (memindahkan entri tulisan tangan ke apps.json). Terlalu invasif.
- **Rekomendasi: A sekarang** (P0), ditambah halaman/kartu "Persiapan" dengan status per item dan tombol "Periksa lagi". Wizard membutuhkan item integrasi pm2 hijau sebelum tombol "Buat" aktif. B hanya bila pemilik meminta.

### 6.2 Adopsi yang benar (Gap 2, 3, 11, 23)

- **A. Adopsi berbasis aplikasi pm2**: "Belum dikelola" menggabungkan ingress dengan aplikasi pm2 (`pm_cwd`, `pm_exec_path`, args dari jlist; port bila diketahui). Dialog: pilih aplikasi pm2 (wajib, dropdown dari aplikasi yang belum dipakai situs), nama situs prefill = nama aplikasi, `dir` = `pm_cwd` (harus di bawah `sites.dir`), runtime dideteksi dari `<cwd>/app` dan cocok dengan script (grun vs langsung), port dari ingress. Host `APP_BASE_URL` dikecualikan (ditandai "Panel Termux").
- **B. Tetap form bebas + validasi server** (folder ada, app ada di pm2, runtime terdeteksi). Lebih sedikit kode UI, tetapi pemilik masih harus tahu nama yang benar.
- **Rekomendasi: A** (dropdown memakai data yang sudah dibaca adapter, hanya perlu menambah `cwd` di `Pm2Proc`). Server tetap memvalidasi seperti B. Untuk situs adopsi: aturan reserved env hanya untuk situs terkelola. Deploy menolak runtime yang tidak cocok di `complete` dengan pesan berisi langkah perbaikan (ganti `script` di ecosystem, atau "Ubah jadi dikelola panel" P2).

### 6.3 Panel restart di tengah job (Gap 4, 21)

- **A. Tetap tandai gagal + "Rekonsiliasi" manual**: halaman perubahan yang terputus menampilkan langkah yang tercatat `done` dan tombol "Bersihkan" yang menjalankan pemeriksaan idempoten per jenis (hapus entri apps.json tanpa situs, pulihkan `config.yml.bak` bila hash cocok, hapus `app.new`/`.app.prev.drop`, restart cloudflared bila config ≠ yang terakhir di-load). Sederhana, eksplisit, sesuai pola "butuh tindakan".
- **B. Journal + undo otomatis saat boot**: simpan state undo (`prev` bytes, flag) per langkah di DB, lalu saat boot jalankan undo untuk job `running`. Lebih otomatis, tetapi undo butuh closure state (`prev`, `hadApp`) yang sekarang hanya ada di memori. Semua langkah harus diserialisasi, dan undo saat boot bisa bertabrakan dengan pm2/cloudflared yang sedang start.
- **C. Perpanjang `SHUTDOWN_TIMEOUT_MS`** ke batas atas job (~90 dtk) agar `sv restart panel` menunggu. Murah dan menutup kasus upgrade terencana, tetapi tidak menutup OOM/reboot.
- **Rekomendasi: C + A.** C menutup penyebab paling sering (upgrade via `install-phone.sh`). A memberi jalan keluar untuk sisanya. Runner juga harus menangkap error `save()` (Gap 21). B ditunda sampai A terbukti kurang.

### 6.4 Kapan entri `apps.json` dibuat (Gap 12)

- **A. Wizard 4 langkah: …Ringkasan → Unggah binary** dalam satu alur. Job create tetap tanpa binary. Entri apps.json dibuat saat deploy pertama (langkah `apps` deploy menambah entri bila belum ada).
- **B. Tetap seperti sekarang**, dengan CTA "Unggah binary pertama" di halaman hasil job dan kartu.
- **Rekomendasi: B di gelombang ini + pindahkan pendaftaran apps.json ke deploy pertama** (menutup risiko entri tanpa binary saat reboot). Unggah di dalam wizard (A) membuat alur gagal lebih rumit (dua job berbeda). Lebih jelas berupa CTA besar di halaman hasil.

### 6.5 Unggah tangguh (Gap 5, 22, 24)

- Resume: simpan `{uploadId, site, name, size, sha}` di `sessionStorage`. Saat file yang sama dipilih lagi (ukuran + sha sama) → `GET /uploads/:id` (endpoint baru kecil yang mengembalikan `received`) → kirim chunk yang belum ada. Retry per chunk: backoff hingga ~60 dtk total. Setelah gagal tampil tombol "Lanjutkan unggahan", bukan memulai dari awal.
- Unggahan yang hilang karena restart → kode `upload_expired` dengan pesan "Panel dimulai ulang, unggah ulang".
- Hash: **opsi 1** SHA-256 inkremental di klien (≈100 baris, tanpa dependency) per 8 MB. **Opsi 2** klien kirim sha per chunk (crypto.subtle per 8 MB = memori kecil), server menghitung sha akhir saat assemble dan riwayat mencatat sha server. **Rekomendasi opsi 2**: kode lebih sedikit, integritas per chunk, dan memori tidak lagi tergantung ukuran file. Kontrak `UploadStartRequest.sha256` menjadi opsional.
- Preflight disk: `POST uploads` cek `statfs` bebas ≥ 2× ukuran + 200 MB → 507 `no_space`.

### 6.6 Health check (Gap 8)

- Kolom situs `healthPath` (default `/`) dan `healthTimeoutSec` (default 60, maks 300 seperti Railway). Sukses = 2 respons < 500 berturut-turut **dan** `restarts` pm2 tidak naik selama 5 dtk setelahnya. Gagal → ambil 50 baris stderr terakhir ke respons job (tidak disimpan permanen, Opsi 4.1) dan undo.
- Alternatif lebih murah: hanya syarat "stabil 5 dtk" tanpa kolom baru. **Rekomendasi**: syarat stabil + timeout per situs (satu kolom). Path baru bila diminta.

### 6.7 Banyak versi & rollback (Gap 15, 16)

- **A. Simpan N binary** (`releases/<sha12>`, N=3 default, 89 MB × 3 per situs) dan rollback ke baris riwayat mana pun yang file-nya masih ada. Mengikuti pola Vercel/Render. Disk HP cukup (171 GB bebas di POCO), tetapi HP lain bisa kecil.
- **B. Tetap `app.prev`** dan tambahkan `hasPrevious` + `liveSha` di `SiteDetail`, badge "Aktif", dialog "dari X → ke Y".
- **Rekomendasi: B sekarang** (P1, menutup kebohongan UI). A menjadi P2 dengan pengaturan `sites.keep_releases`.

### 6.8 Kunci & konkurensi (Gap 9, 10, 19)

- Env save menjadi job `site.env` (langkah: tulis `.env` → restart → health). Dengan begitu tercatat di Riwayat perubahan dan otomatis memakai kunci. Opsi "Simpan tanpa mulai ulang" menulis file saja (tanpa job, tetap `assertIdle`).
- Kontrol `/panel/apps` untuk aplikasi milik situs dan `/panel/services` untuk `cloudflared`/`pm2` → `jobs.assertIdle()`.
- 409 `busy` menyertakan `jobId` yang berjalan. UI menampilkan banner "Perubahan _Deploy · makuro-solusi_ sedang berjalan → Lihat".
- Antrian: **jangan** (YAGNI; satu-dua admin).

### 6.9 Restart cloudflared (Gap 27, blip)

- **A. Terima blip** + jelaskan + tunggu tunnel "ready" (`cloudflared --metrics 127.0.0.1:<p>` → `/ready`; butuh ubah run script runit, sentuh POCO) + probe HTTPS domain baru (non-fatal, pesan "DNS mungkin butuh beberapa menit").
- **B. Pindah ke tunnel remote-managed** (ingress lewat API Cloudflare, tanpa restart). Tidak ada blip, tetapi migrasi tunnel produksi, butuh izin token Tunnel:Edit, dan `config.yml` lokal tidak dipakai lagi (desain `ingress.editor.ts` dibuang).
- **Rekomendasi: A** (tanpa `/ready` dulu, cukup probe HTTPS dengan retry ≤ 30 dtk). B dicatat sebagai keputusan pemilik jangka panjang.

### 6.10 Alur first-run realistis untuk pemilik (satu situs tulisan tangan)

Kondisi awal = POCO hari ini (§2.11). Target: makuro-solusi dikelola panel tanpa downtime yang tidak perlu, lalu situs baru kedua bisa dibuat.

1. **`/panel/sites` kosong → kartu "Persiapan"** (bukan banner kuning), checklist dari `/integration` yang diperluas:
   - ✅ Tunnel `poco` terdeteksi (UUID dari kredensial).
   - ⚠️ "Situs buatan panel belum akan dijalankan pm2." Panel sudah membuat `apps.json` = `[]` (Opsi 6.1-A). Tampilkan snippet aman + tombol Salin + perintah `nano ~/sites/ecosystem.config.js` + tombol "Periksa lagi" (panel menjalankan `node -e require()` dan melaporkan jumlah aplikasi yang terbaca: "3 aplikasi terbaca, termasuk dari apps.json").
   - ⚪ Token Cloudflare (opsional): "Tanpa token, buat record DNS sendiri", tautan ke Administrasi bila super_admin.
2. **"Belum dikelola" menampilkan 1 entri**: `solusi.malikkurosaki.com` → aplikasi `makuro-solusi` (dicocokkan lewat `pm_cwd` = `~/sites/makuro-solusi` dan `.env PORT=3005`, atau dipilih manual). `panel.malikkurosaki.com` ditampilkan sebagai "Panel Termux (domain ini)" tanpa tombol adopsi.
3. **Adopsi** (Opsi 6.2-A): nama = `makuro-solusi`, folder `~/sites/makuro-solusi` ✓ ada, aplikasi pm2 `makuro-solusi` ✓ berjalan, runtime terdeteksi `grun` (glibc) ✓ sesuai script. Teks: "Panel hanya mencatat situs ini. File dan aplikasinya tidak diubah sampai kamu deploy."
4. **Detail situs adopsi**: header status "Berjalan" + domain. Di "Deploy": kartu "Versi berjalan: binary 89,2 MB, belum di-deploy lewat panel". Tombol "Cek kesehatan" (GET / sekarang) dan "Mulai ulang" (job). Peringatan runtime: "Situs ini menjalankan binary glibc lewat grun. Unggah build `bun-linux-arm64`, atau ubah `script` di ecosystem dulu untuk build Android."
5. **Deploy pertama ke situs adopsi**: alur unggah yang bisa dilanjutkan. Bila runtime tidak cocok, unggahan ditolak setelah chunk 0 (Gap 11), **sebelum** 89 MB terkirim penuh. Saat sukses: riwayat punya 1 baris "Aktif", `app.prev` = binary tulisan tangan lama, dan "Kembalikan versi sebelumnya" aktif dengan dialog "dari 3f9a… → binary sebelum panel".
6. **Situs baru kedua**: wizard aktif karena integrasi hijau → job create → halaman hasil dengan CTA besar "Unggah binary pertama" → deploy pertama mendaftarkan entri apps.json dan memulai aplikasi.

Yang sengaja **tidak** dilakukan otomatis: mengedit `ecosystem.config.js`, mengubah situs adopsi menjadi dikelola, dan restart pm2-runtime.

---

## 7. Risiko & pertanyaan terbuka

**Yang harus diputuskan PLAN**

1. Kontrak baru: `Job.actor`, `JobStep.startedAt/finishedAt`, `SiteDetail.liveSha/hasPrevious`, `DiscoveredIngress.app` → `{name,cwd,runtime}` + `self: boolean`, kode error `busy` membawa `jobId`, `upload_expired`, `no_space`, `runtime_mismatch`. Ini menyentuh `src/shared/*.types.ts`, jadi perlu dikoordinasikan dengan worker lain yang memakai `Page<Job>`.
2. Migrasi DB: kolom `site.health_timeout_sec` (default 60), mungkin `job.steps` diperluas (JSON, tanpa migrasi). Ikuti Rule 4 (guard idempotent, default untuk baris lama).
3. Pesan langkah: server mengirim `key` + parameter, dan klien menerjemahkan lewat i18n (`id.site.job.steps[key]`). Atau server menulis bahasa Indonesia langsung. Rekomendasi: **klien menerjemahkan berdasarkan `key`**, dan `message` teknis tetap sebagai "detail".
4. Urutan pengerjaan: Gap 1–3 (adopsi + integrasi) sebelum pemilik mencoba di POCO. Gap 4–7 sebelum deploy nyata pertama.
5. Verifikasi di HP yang **bukan produksi** (atau service runit throwaway): perilaku `pm2-runtime` saat entri `apps.json` script-nya tidak ada (errored vs keluar), dan apakah `pm2 start ecosystem --only x` dari CLI masuk ke daemon pm2-runtime yang sama dan bertahan setelah `sv restart pm2`.

**Risiko**

- Setiap test end-to-end di POCO menyentuh produksi (restart cloudflared memutus `solusi` + panel, dan deploy ke makuro-solusi menyentuh situs berbayar). Perlu jendela waktu dan izin pemilik. Memory proyek menyebut E2E POCO butuh OK pemilik.
- `ingress.editor.ts` hanya memahami bentuk YAML tertentu. Config tulisan tangan yang berbeda akan menolak edit (aman, tetapi pesan error harus menjelaskan).
- Menyimpan stderr di respons job bisa membocorkan rahasia yang dicetak aplikasi. Jangan disimpan permanen.

**Pertanyaan untuk pemilik (keputusan nyata saja)**

1. Untuk integrasi pm2: cukup panel memberi snippet aman + memeriksa (6.1-A), atau panel boleh **mengedit `~/sites/ecosystem.config.js` sendiri** dengan backup + validasi (6.1-B)?
2. Apakah makuro-solusi akan tetap glibc (`grun`) atau pindah ke build Android native? Bila pindah, apakah panel boleh mengubah situs adopsi menjadi "dikelola" (memindahkan entri dari ecosystem ke apps.json)?
3. Berapa versi binary yang boleh disimpan per situs (1 = sekarang, 3 = rollback dari riwayat; ±90 MB per versi)?
4. "Deploy dari URL" (aset GitHub Release) masuk rencana setelah P0/P1? Deploy dari CI dengan token tetap ditunda?
