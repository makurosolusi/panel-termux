# R&D 05 — Administrasi, onboarding, profil, login, dan landing page

> wkr-rnd-admin-01, 2026-11-26, branch `feature/production-polish` (HEAD 2a55c8b). Hanya riset, tidak ada kode yang diubah.
> Bukti: membaca kode, build lokal `dist/panel` mode demo di port 3415 (data dir sementara, sesi super_admin dan
> `user` dibuat langsung di DB sementara), screenshot ego-browser di lebar 390px dan 1440px, landing publik Coolify,
> CapRover, dan Railway (Dokploy timeout, jadi dipakai data dari `docs/research/ui-benchmark.md`), plus `curl` read-only
> ke landing produksi `https://panel.malikkurosaki.com/` (hanya header dan status code, tanpa login).

---

## 1. Ruang lingkup

| Area               | Halaman / komponen                                                                                       | API                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Kesehatan sistem   | `/dev` → `src/web/dev/health.page.tsx`                                                                   | `GET /api/dev/health` (`src/server/dev/health.service.ts`)                                     |
| Pengguna           | `/dev/users` → `users.page.tsx`, `users.list.tsx`                                                        | `GET /api/dev/users?q&page`, `PATCH/DELETE /api/dev/users/:id` (`users.service.ts`)            |
| Audit              | `/dev/audit` → `audit.page.tsx`                                                                          | `GET /api/dev/audit?action&actorId&page` (`src/server/audit.service.ts`)                       |
| Log                | `/dev/logs` → `logs.page.tsx`                                                                            | `GET /api/dev/logs?level&q&limit` (`src/server/log.service.ts`, ring 2.000 baris)              |
| Pengaturan         | `/dev/settings` → `settings.page.tsx`, `setting.field.tsx`, `settings.state.ts`, `cloudflare.verify.tsx` | `GET /api/dev/settings`, `PUT /api/dev/settings/:key`, `POST /api/dev/cloudflare/verify`       |
| Onboarding pertama | **belum ada UI**                                                                                         | `GET /api/dev/setup` (`src/server/dev/setup.service.ts`, didaftarkan di `api.routes.ts:70-75`) |
| Profil             | `/profile` → `src/web/pages/profile.page.tsx`, menu akun `layout/user.menu.tsx`                          | `GET /api/me`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST …/revoke-others`   |
| Login & sesi       | `/login` → `pages/login.page.tsx`, `session/*`, `auth/auth.client.ts`                                    | Better Auth `/api/auth/*`                                                                      |
| Landing publik     | `/` → `src/web/landing/*`, copy `src/web/i18n/id.landing.ts`, meta di `src/web/index.html`               | `GET /api/me` (untuk memilih CTA)                                                              |

Di luar ruang lingkup (domain worker lain): Ringkasan `/panel`, situs/deploy, cadangan, shell & design system (hanya
dirujuk bila memengaruhi halaman di atas).

---

## 2. Kondisi sekarang — audit

### 2.1 Pola umum semua halaman `/dev`

- **Tidak ada judul halaman.** Kelima halaman `/dev` tidak memakai `PageHeader` (`components/page-header.tsx`), jadi
  tidak ada `<h1>`. Di desktop judul hanya tersirat dari breadcrumb; di HP breadcrumb disembunyikan
  (`layout/app.layout.tsx:66`, `hidden … md:flex`), sehingga di 390px pengguna **tidak tahu sedang di halaman mana**
  (terlihat di screenshot Pengguna/Audit/Log: halaman langsung dibuka dengan kolom pencarian). Hanya `/profile` yang
  punya `PageHeader`.
- **Empty state generik.** `QueryView` selalu merender `<EmptyState />` dengan `id.common.empty` ("Belum ada yang bisa
  ditampilkan di sini.") (`shared/query.state.tsx:22,68`). String khusus `id.dev.users.empty`, `audit.empty`,
  `logs.empty`, `common.noResults` (`i18n/id.dev.ts:25,66,72,79`) **tidak pernah dipakai** (kode mati).
- **Komponen design system wave A belum dipakai** di `/dev`: `DataTable`, `StatTile`, `RelativeTime`, `KeyValue`,
  `Section`, `StatusBadge` ada di `src/web/components/` tetapi halaman `/dev` masih memakai `StatCard` lama
  (`shared/stat.card`), `Table` manual, dan `formatDateTime` absolut.
- **Polling tanpa jeda saat tab tersembunyi.** `useApiQuery` memakai `setInterval` polos (`shared/use-api-query.ts:34-38`);
  Kesehatan tiap 15 dtk, Log tiap 5 dtk terus berjalan walau tab di background (beban baterai HP-server dan HP pembuka).
- **Toaster dipasang per area** (`dev/dev.layout.tsx:9`) — hanya pembungkus toast; tidak masalah, tapi tiap area punya
  Toaster sendiri (cek konsistensi dengan shell).

### 2.2 Kesehatan sistem (`/dev`)

**Data** (`shared/dev.types.ts:12-25`, `health.service.ts:17-40`): `version`, `schemaVersion` (nama migrasi mentah,
mis. `0005_drop_invites`), `startedAt`, `uptimeSec`, `memory.rssMb/heapUsedMb`, `db.sizeBytes` (tanpa WAL),
`dataDir.freeBytes/totalBytes` (statfs), `runtime.{bun,node,platform,arch}`, `cpuCores`, `requestsPerMinute`,
`errorCount5m`, `counts.{users,sessions}`.

**Flow**: GET tiap 15 dtk → 6 kartu `StatCard`. Error → `QueryView` error state.

**Masalah UI/UX**

1. Tidak menjawab "apakah panel sehat?". Tidak ada vonis (Sehat / Perlu perhatian), semua kartu netral. Penyimpanan
   94% (terlihat di build lokal) tampil dengan bar oranye brand yang sama seperti 10% — tanpa tone warning/danger.
2. **`requestsPerMinute` dan `errorCount5m` dikirim server tapi tidak ditampilkan** (`health.page.tsx:27-49`). Padahal
   5xx adalah sinyal kesehatan terpenting yang sudah tersedia.
3. Yang dibutuhkan operator tapi tidak ada: mode adapter (`termux` vs `demo` — kini hanya di log start), skema
   "terbaru/tertinggal" (pembanding `latestSchemaVersion()` sudah ada untuk `/api/ready`, `api.routes.ts:53-63`),
   status penjadwal cadangan (`lastRun`/`nextRunAt` sudah dihitung di `backup/backup.service.ts:176-179`), error terakhir
   (ring log level `error`), status job situs yang berjalan, status token Cloudflare, dan pengingat file `data/secret`
   belum dicadangkan (README §Backup).
4. Kartu "Pengguna terdaftar" mengulang angka: nilai `4` lalu subjudul "4 pengguna · 2 sesi aktif"
   (`health.page.tsx:45-47`). `id.dev.health.countsDetail` ada tapi tidak dipakai.
5. Runtime ditulis `Bun 1.4.5 (darwin/arm64)` di kartu Memori — informasi teknis mentah, tempatnya di baris detail.
6. 6 kartu tinggi ditumpuk 1 kolom di HP (≈ 760px, screenshot `dev-health-m`) — pola yang diperingatkan benchmark §0.11.

**Masalah konten**: "Diperbarui otomatis tiap 15 detik" (`id.dev.ts:33`, sudah diberi komentar "lama") melanggar
`docs/content-guide.md` §Teks bantuan (harus "Diperbarui 12 dtk lalu"). "Skema database 0005_drop_invites" tidak
bermakna bagi pengguna.

**Kode**: `getHealth` sinkron dan murah — baik. `STARTED_AT` dihitung dari `process.uptime()` — baik.

### 2.3 Pengguna (`/dev/users`)

**Data** (`DevUser`, `dev.types.ts:28-37`): id, email, name, image, role, createdAt, `lastSeenAt` (subquery
`max(session.updated_at)`, `users.service.ts:14-16`), `isEnvSuperAdmin`.

**Flow**: cari (Enter/tombol) → `?q=` → tabel (≥ sm) atau kartu (HP). Ubah peran = `Select` langsung `PATCH` tanpa
konfirmasi (`users.list.tsx:53`). Hapus = `ConfirmDelete` → `DELETE` → FK cascade menghapus sesi & akun OAuth
(`users.service.ts:99-108`). Server menolak (409 `protected`) untuk super admin env dan diri sendiri (`:76-82`); UI
menampilkan gembok (`users.list.tsx:23,44-50`).

**Masalah**

1. **Promosi ke Admin tanpa konfirmasi.** Satu tap di `Select` memberi akses penuh ke server (layanan, situs, deploy,
   database). Di HP, salah tap mudah. Tidak ada penjelasan per peran.
2. **`lastSeenAt` tidak andal.** Diturunkan dari `session.updated_at`; setelah pengguna keluar atau sesinya dicabut
   (baris sesi hilang), kolom kembali ke "Belum pernah" walau ia pernah aktif. Terlihat juga di build lokal: "Budi
   Admin — Terakhir aktif: Belum pernah".
3. Tidak ada jumlah sesi aktif per pengguna dan **tidak ada aksi "Keluarkan dari semua perangkat"** tanpa menghapus
   akun. Menurunkan peran berlaku seketika (role dibaca ulang dari DB tiap request, `role.guard.ts:25-31`) — benar, tapi
   tidak dijelaskan di UI.
4. **Hapus tidak memblokir.** Login terbuka untuk semua akun Google (`auth.service.ts:18-35`); orang yang dihapus bisa
   langsung login lagi sebagai `user` baru. Teks dialog jujur menyebutkannya (`id.dev.ts:64-65`), tapi tidak ada cara
   untuk benar-benar menolak akun.
5. Urutan `createdAt desc` (`users.service.ts:62`): akun asing yang baru login menenggelamkan admin. Tidak ada filter
   peran ("Admin saja").
6. Waktu absolut (`formatDateTime`) bukan relatif; kolom "Bergabung" kurang penting dibanding "Terakhir aktif".
7. Teks pembuka "Akun baru masuk sebagai Pengguna. Ubah perannya ke Admin di sini agar bisa membuka Panel." — "Panel"
   kapital dan tidak menjelaskan risiko.

### 2.4 Audit (`/dev/audit`)

**Data** (`DevAuditEntry`, `dev.types.ts:49-56`; tabel `audit_log` dengan `actor_id … onDelete: "set null"`,
`db/schema/audit-log.schema.ts`). 23 jenis aksi (`audit.service.ts:12-31`).

**Masalah**

1. **Atribusi salah setelah pengguna dihapus.** FK `set null` membuat `actor` = null, dan UI menampilkan `null` sebagai
   "Sistem" (`audit.page.tsx:28`). Jadi "Citra mengubah peran X" berubah jadi "Sistem mengubah peran X" setelah Citra
   dihapus — jejak audit menyesatkan. String `id.dev.common.deletedUser` sudah ada tapi tidak dipakai, dan server
   tidak bisa membedakan "sistem" vs "pengguna terhapus" karena keduanya null.
2. **Filter aksi = exact match** (`audit.service.ts:56`) tetapi placeholder "mis. user.role" (`id.dev.ts:71`) mengajak
   mengetik awalan → hasil selalu kosong. `KNOWN_ACTIONS` di UI hanya 4 dari 23 aksi (`audit.page.tsx:16`).
3. Baris menampilkan kode mentah: badge `user.role_change`, target `u-us` (ID internal), `meta` sebagai JSON satu baris
   (`audit.page.tsx:18-37`). Tidak ada kalimat manusiawi ("Ana mengubah peran Citra: Pengguna → Admin").
4. Filter aktor (`actorId`) didukung API (`dev.routes.ts:51-53`) tapi tidak ada di UI; tidak ada rentang waktu; tidak
   ada IP/perangkat (sesi sudah menyimpan `ipAddress`/`userAgent`).
5. Empty state generik (lihat 2.1); di build lokal halaman audit hanya berisi kolom "mis. user.role" dan "Belum ada yang
   bisa ditampilkan di sini." tanpa judul.

### 2.5 Log (`/dev/logs`)

**Data**: ring buffer in-memory 2.000 baris (`log.service.ts:4-18`), `{at, level, msg}`, terbaru dulu, limit default 200.

**Masalah**

1. **Log memenuhi dirinya sendiri.** Setiap request API dicatat level `info` (`http/request.log.ts:32-33`), termasuk
   `GET /api/dev/logs` (polling 5 dtk dari halaman ini) dan `GET /api/me`. Di build lokal 12 baris teratas semuanya
   `[http] GET /api/me …` / `/api/dev/*`. Dengan ring 2.000 baris, beberapa jam membuka halaman Log menggeser log
   penting keluar dari buffer.
2. Tiap baris menampilkan tanggal lengkap "26 Nov 2026, 21.57.26" (`logs.page.tsx:61`) — di 390px kolom pesan tinggal
   ±40% lebar, dan `break-all` memotong kata di tengah (`/api/` + `me`). Panduan konten: jam saja.
3. Tidak ada "ikuti/jeda", salin, unduh; hanya switch "Perbarui otomatis". Urutan terbaru-di-atas berlawanan dengan
   konvensi terminal (benchmark §6) — perlu keputusan satu komponen `LogViewer` bersama domain log layanan/aplikasi.
4. Log hilang saat panel restart (in-memory); log lama hanya ada di `$PREFIX/var/log/sv/panel/` — tidak disebut di UI.

### 2.6 Pengaturan (`/dev/settings`)

**Data**: registri 13 setting di server (`settings.service.ts:63-171`) dengan `label`, `description`, `secret`,
`default`, `validate`. API mengembalikan `value` null untuk rahasia, `isSet`, `updatedAt` (`describeSetting`, `:202-214`).

**Flow**: satu `Card` berisi 13 form; tiap form simpan sendiri (`setting.field.tsx:37-83`); rahasia write-only,
tombol ↺ = "Kosongkan"/"Kembalikan ke bawaan" langsung jalan tanpa konfirmasi (`:66-76`).

**Masalah**

1. **Seluruh teks pengaturan berbahasa Inggris.** Label, deskripsi, dan pesan validasi berasal dari registri server
   ("Cloudflare API token", "Directory holding hosted sites…", "must be 32 hex characters") dan dirender apa adanya.
   Pesan error validasi masuk toast dalam bahasa Inggris. Melanggar panduan konten (bahasa, glosarium "Cadangan",
   "Situs", "Layanan").
2. **Status "Bawaan" untuk setting kosong tanpa default.** `settingStatus` mengembalikan `default` untuk setting non-rahasia
   yang belum diisi walau `default: null` (`settings.state.ts:22-25`) → `cloudflare.account_id`, `backup.s3_endpoint`,
   `backup.s3_bucket` tampil "Bawaan" padahal kosong (terlihat di snapshot). Menyesatkan saat menyiapkan cadangan.
3. Tidak dikelompokkan: 13 field datar (≈ 2.000px di HP). Lima field S3 disimpan satu per satu → konfigurasi cadangan
   setengah jadi di antara penyimpanan, tidak ada "simpan grup".
4. Input teks bebas untuk nilai berstruktur: `backup.hour` ("3" atau "off"), `sites.port_range` ("3001-3999"),
   `panel.protected_services` (CSV). Pengguna HP harus mengetik format yang tepat.
5. **"Uji token" selalu tampil** walau token belum diisi, dan jawabannya dari server berbahasa Inggris ("Cloudflare API
   token is not set (/dev settings)", `cloudflare/dns.provider.ts:72-79`) — dibuktikan via `curl` di build lokal.
6. Tidak ada tombol uji untuk kredensial S3 (lihat §6.4). Kesalahan baru ketahuan saat backup terjadwal jam 03.00.
7. "Kosongkan" token Cloudflare / kunci S3 tanpa konfirmasi; mengubah `sites.dir` saat sudah ada situs tidak
   diperingatkan (situs lama tetap di folder lama).
8. Tidak ada tautan bantuan (cara membuat token Cloudflare dengan izin Zone:DNS:Edit + Zone:Read, cara membuat kunci R2)
   — README punya penjelasannya, UI tidak.
9. Kunci teknis (`cloudflare.api_token`) ditampilkan sejajar label — boleh, tapi sebaiknya sekunder.

### 2.7 Onboarding pertama (super_admin)

`GET /api/dev/setup` mengembalikan 5 item `{key, done, hint}` (`setup.service.ts:10-41`): `cloudflare_token`, `backup`,
`apps_json`, `adopt_sites`, `admins`. Fakta:

- **Tidak dipakai di web sama sekali** (`grep "/setup" src/web` kosong). Super admin pertama mendarat di `/dev`
  (Kesehatan sistem) tanpa arahan apa pun.
- `hint` berbahasa Inggris dan menyebut path (`/dev settings`) — tidak bisa ditampilkan langsung.
- `admins` ditandai "Optional" di hint tapi diperlakukan setara; di build lokal `admins: done` karena ada admin seed.
- Item penting yang belum tercakup: Cloudflare Access di depan path privat (README §Instal langkah 4 — tanpa ini siapa
  pun bisa login), salinan `data/secret` di tempat aman (README §Backup), uji pemulihan cadangan.
- Peran `admin` (bukan super_admin) yang mendarat di `/panel` tidak mendapat onboarding sama sekali; sebagian item
  (situs pertama) relevan untuknya.

### 2.8 Profil (`/profile`) dan peran `user`

- Isi: avatar, nama, email, peran, tombol Keluar (`profile.page.tsx:11-44`). Tema hanya di menu akun.
- **API sesi sudah lengkap tapi tanpa UI**: daftar sesi dengan "Chrome on Android", IP tersamar, revoke satu/semua
  (`me.routes.ts:31-36`, `auth/sessions.service.ts`). `grep "me/sessions" src/web` kosong.
- **Peran `user` = jalan buntu.** Siapa pun yang login dengan Google (termasuk orang asing dari landing) melihat
  sidebar berisi satu item "Profil" dan kartu identitas (screenshot `profile-user-m`). Tidak ada penjelasan
  "akun kamu belum punya akses", siapa yang harus dihubungi, atau apa langkah berikutnya. Landing untuk orang ini
  menampilkan tombol "Buka panel" yang mengarah ke `/profile` (dicek di build lokal) — label menjanjikan panel.
- Tidak ada hapus akun sendiri (privasi: email orang asing tersimpan permanen kecuali super admin menghapusnya).

### 2.9 Login (`/login`)

- Kartu tunggal: judul, subjudul jujur ("Akun baru masuk sebagai Pengguna sampai Super Admin mengubah perannya"),
  tombol Google (`login.page.tsx:31-54`). Tanpa logo, tanpa tautan kembali ke `/`, tanpa nama/pemilik instance.
- Semua kode `?error=` dipetakan ke satu pesan generik (`login.error.ts:4-7`); "pengguna membatalkan" dan "state tidak
  cocok/cookie diblokir" diperlakukan sama.
- Tamu yang membuka alamat tak dikenal (mis. `/xyz`) diarahkan ke `/login` (`session.redirect.ts:16`, diverifikasi di
  build lokal), bertentangan dengan README ("Alamat yang tidak dikenal menampilkan halaman perkenalan") dan CHANGELOG
  0.2.0. Pengguna login mendapat 404 di dalam shell — itu benar.

### 2.10 Landing publik (`/`)

**Struktur** (`landing.page.tsx:11-30`): header sticky (wordmark, Fitur, Cara kerja, FAQ, GitHub, CTA) → Hero (eyebrow,
judul 3 baris, lead, CTA "Masuk dengan Google", "Lihat cara kerjanya", mock HP, strip spesifikasi 4 angka) → §01 Kenapa
HP lama (4) → §02 Fitur (bento 6) → §03 Cara kerja (4 langkah + perintah) → §04 Arsitektur (diagram) → §05 FAQ (5,
`<details>` native) → CTA penutup → footer (tagline + GitHub). Tinggi halaman di 390px: 7.640px.

**Jalur konversi saat ini**: tamu → "Masuk dengan Google" (3× di halaman: header, hero, penutup) → `/login` → Google →
akun `user` di **panel milik pemilik instance**. Yang sudah login → "Buka panel" → halaman awal peran (`landing.cta.ts:10-13`).

**Kejujuran klaim** (dibanding `docs/content-guide.md` §Landing dan fakta repo):

| Klaim                                          | Status                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "1 binary native Android", "tanpa root/Docker" | Benar.                                                                                                                                                                                                                                                                              |
| "~110 MB ukuran file binary"                   | `dist/panel-android-arm64` = 116.728.296 B (≈ 111 MiB / 117 MB). Benar dalam MiB, tapi angka akan bergeser tiap rilis dan tidak ada sumber tunggal.                                                                                                                                 |
| "~65 MB RAM terukur di HP sungguhan"           | Sesuai README ("sekitar 65 MB RSS"). Tidak ada tanggal/versi pengukuran.                                                                                                                                                                                                            |
| "Unggah binary … dengan checksum SHA-256"      | Benar (`deploy/deploy.upload.ts`, `server/deploy/upload.store.ts`).                                                                                                                                                                                                                 |
| Langkah "Pasang panel: salin binary ke HP"     | **Tidak bisa diikuti pengunjung.** Repo publik tanpa rilis (`gh repo view`: `latestRelease: null`), jadi binary harus dibuild sendiri dengan Bun di komputer (`bun run build`), langkah yang tidak disebut. Perintah `sh scripts/install-phone.sh` mengandaikan repo sudah disalin. |
| "Kode sumber di GitHub"                        | Benar, repo publik. Tapi **tidak ada file LICENSE** (`licenseInfo: null`) → secara hukum bukan open source; jangan pernah menulis "open source" sebelum lisensi ada.                                                                                                                |
| FAQ "Aman dibuka ke internet?"                 | Menyebut Cloudflare Access sebagai "lapisan tambahan", padahal README §Keamanan menjadikannya praktis wajib karena login terbuka untuk semua akun Google. Klaim terlalu menenangkan.                                                                                                |
| Mock HP                                        | Diberi caption "tampilan ilustrasi" — jujur. Tapi isinya tidak memakai format/glosarium aplikasi: "2.1 GB" (harus "2,1 GB"), "34°C" (harus "34 °C"), "Disk" (glosarium: "Penyimpanan").                                                                                             |

**SEO / meta** (`index.html:1-34`, diverifikasi di DOM): hanya `title`, `description`, `theme-color`, favicon SVG. Tidak
ada `og:*`, `twitter:*`, `link rel=canonical`, `og:image`, `apple-touch-icon`, manifest. Karena SPA, konten landing
tidak ada di HTML awal; scraper pratinjau tautan (WhatsApp, Telegram, X — tidak menjalankan JS) hanya melihat
title/description yang **sama untuk semua path** (`/login`, `/panel` ikut berjudul "Panel Termux — HP Android jadi
server"). Di produksi `robots.txt` dan `sitemap.xml` menjawab **200 dengan HTML SPA** (soft-404), sehingga crawler bebas
mengindeks `/login`, `/panel`, `/dev`.

**Performa**: landing memuat bundle aplikasi penuh — `chunk-*.js` 706 KB + CSS 85 KB (tanpa kompresi di server lokal;
di produksi Cloudflare menyajikan `br` dan `cache-control: max-age=14400`, HIT). Seluruh React app (router, shadcn,
radix, better-auth client) diunduh hanya untuk halaman statis. Font memakai stack sistem (`styles.css:169-170`) — baik,
tanpa unduhan font. Animasi dibungkus `prefers-reduced-motion: no-preference` (`styles.css:195`) — baik.

**Mobile** (screenshot 390px): wordmark "panel-termux" dan tombol "Masuk dengan Google" di header masing-masing patah
2 baris; eyebrow uppercase patah 2 baris. Hero + CTA masih di atas lipatan; mock HP mulai di ±620px.

**Konsistensi brand dengan aplikasi**

- Wordmark landing `panel-termux` (huruf kecil, mono) di header & footer (`landing.header.tsx:18`, `final.section.tsx:38`)
  vs "Panel Termux" di aplikasi (`layout/brand.logo.tsx:24`). Panduan konten: "panel-termux hanya di konteks teknis".
- Logomark: landing = kotak **tinta** dengan `>_` (`landing.header.tsx:15`), aplikasi & favicon = kotak **oranye**
  (`brand.logo.tsx:10`).
- Tipografi: landing serif (Iowan/Noto Serif) + mono; aplikasi sans. Token terpisah `--lp-*` vs `--brand` walau nilai
  oranye sama (`styles.css:37,96`). Perbedaan gaya editorial landing vs aplikasi bisa diterima (Linear, Vercel juga
  begitu), tetapi **logomark dan nama** harus satu.
- Login (`/login`) tidak memakai elemen brand sama sekali — jembatan landing → aplikasi terasa seperti situs lain.

### 2.11 Observasi produksi (read-only)

`curl` tanpa cookie ke `https://panel.malikkurosaki.com`: `/dev`, `/panel`, `/profile` → **200** (bukan redirect ke
login Cloudflare Access); `/api/dev/ping`, `/api/panel/ping` → 401 dari aplikasi. Artinya **Cloudflare Access tampaknya
belum terpasang di path privat produksi**, sehingga satu-satunya penjaga adalah peran di server, dan siapa pun dari
landing bisa membuat akun `user` di panel pemilik. (Bisa juga Access dikonfigurasi berbeda dari resep README — perlu
konfirmasi pemilik, lihat §7.)

---

## 3. Standar industri

Sumber utama `docs/research/ui-benchmark.md` (§7, §8, §9, §10); tambahan dilihat langsung di sesi ini ditandai ✱;
yang dari pengetahuan umum dan belum diverifikasi ulang di sesi ini ditandai (p).

**Landing & jalur konversi (self-hosted vs SaaS)**

- ✱ **Coolify** (coolify.io): CTA utama "Self-host for free" → `/self-hosted` (panduan instal), CTA kedua "Start with
  Cloud"; masuk ke layanan hosted dipisah sebagai "To Cloud" → `app.coolify.io`. **Tidak ada tombol login ke instance
  self-hosted di landing** — instance pengguna punya halaman login sendiri. Meta lengkap: `og:title/description/image`
  (+ width/height/alt), `twitter:card`, `canonical`.
- ✱ **CapRover** (caprover.com): "Install CapRover" → `/docs/get-started`, "Live demo" (password ditampilkan di
  halaman), "GitHub", contoh Dockerfile + perintah deploy. Hanya `canonical`, tanpa OG.
- ✱ **Railway** (railway.com): SaaS, jadi "Sign in" dan "Deploy →" (`/new`) masuk akal sebagai CTA. OG + Twitter + canonical lengkap.
- **Dokploy** (benchmark §10): perintah instal satu baris dengan tombol salin tepat di bawah hero.
- Pola: produk self-hosted mengarahkan pengunjung ke **instalasi**, bukan login; login hanya untuk SaaS milik vendor.

**Onboarding instance self-hosted** (p)

- Uptime Kuma, Portainer: halaman pertama setelah instal = buat akun admin; tidak ada registrasi publik.
- Coolify: pengguna pertama jadi owner; registrasi bisa dimatikan di pengaturan instance.
- Dokploy (benchmark §8): Owner tunggal + undangan untuk anggota.
- Benchmark §9: checklist onboarding di halaman utama, centang otomatis dari data nyata, bisa ditutup.

**Admin** (benchmark §8): pengguna = tabel nama · peran · terakhir aktif relatif · sesi aktif · aksi ⋯ (ubah peran,
cabut sesi, nonaktifkan); deskripsi satu baris per peran di dialog ubah peran. Audit = waktu · aktor (pengguna /
"Sistem") · aksi berkata kerja · target bertaut · hasil; filter aktor/aksi/rentang; detail JSON tersamar (Railway,
Vercel). Kesehatan = daftar cek berstatus + "dicek X lalu" + "Cek ulang".

**Pengaturan & rahasia** (benchmark §7): kartu per kelompok dengan tombol simpan per kartu, rahasia write-only
"Tersimpan · diubah 2 hari lalu" + "Ganti nilai", label wajib `*`, ikon bantuan, placeholder contoh. (p) Coolify punya
"Test connection" untuk S3 storage sebelum dipakai backup; Portainer/Coolify menguji koneksi registry/S3 saat simpan.

**Log** (benchmark §6): satu `LogViewer` — follow yang mati saat menggulir ke atas, cari, wrap, salin, unduh; timestamp
`HH:mm:ss`.

**Profil** (p): Vercel/GitHub/Google menampilkan daftar sesi/perangkat dengan "perangkat ini" dan tombol keluar per
sesi; tema ada di pengaturan akun.

---

## 4. Kebutuhan produksi

- **Keamanan / akses**: login terbuka + CTA publik "Masuk dengan Google" = permukaan serangan dan penumpukan akun asing.
  Akun asing tidak boleh pernah melihat data server; saat ini dijamin peran server (benar), tetapi email/nama mereka
  tersimpan permanen (PII) dan setiap login asing menulis baris audit `auth.sign_in`. Promosi peran = memberi akses
  setara shell → harus disengaja (konfirmasi) dan tercatat dengan aktor yang benar selamanya.
- **Integritas audit**: aktor harus tetap terbaca setelah pengguna dihapus (snapshot nama/email saat kejadian), dan
  "Sistem" hanya untuk aksi tanpa aktor (penjadwal). Nilai rahasia tidak pernah masuk `meta` (sudah dijaga,
  `dev.routes.ts:81-82`).
- **Reliabilitas**: konfigurasi cadangan yang salah harus ketahuan saat disimpan, bukan jam 03.00. Kesehatan harus
  menampilkan cadangan terakhir gagal/terlambat dan 5xx.
- **Kinerja di HP**: polling berhenti saat tab tersembunyi; halaman Log tidak boleh membanjiri ring buffer dengan
  request-nya sendiri; landing tidak mengunduh bundle aplikasi penuh (target ≤ ~150 KB JS terkompresi untuk `/`, atau
  HTML statis).
- **Aksesibilitas (WCAG AA)**: setiap halaman punya satu `<h1>`; status tidak hanya warna (bar penyimpanan 94% perlu
  teks "Hampir penuh"); target sentuh ≥ 44px (tombol ↺ pengaturan ikon-saja `size` default); dialog konfirmasi
  mengembalikan fokus; `aria-live` untuk hasil "Uji token" sudah ada (`role="status"`).
- **Mobile**: judul halaman terlihat di 390px; tabel pengguna/audit sebagai list padat; form pengaturan berkelompok yang
  bisa dilipat; log dengan jam saja.
- **Observability**: versi + skema (terbaru/tertinggal) + mode adapter + uptime + 5xx 5 mnt + error terakhir + status
  penjadwal cadangan + job yang berjalan di satu layar, dengan tautan ke Log (level Kesalahan) dan Cadangan.
- **Failure modes** yang harus ditangani UI: `data/secret` hilang/berganti → semua rahasia gagal didekripsi
  (`getSetting` melempar, `settings.service.ts:192-196`) → Pengaturan harus menampilkan "Tidak bisa dibaca, isi ulang"
  bukan galat 500; penyimpanan penuh → SQLite gagal tulis; Access sesi habis (sudah ditangani 0.2.1).
- **Konten**: semua teks yang terlihat pengguna berbahasa Indonesia sesuai glosarium, termasuk yang berasal dari
  server (label pengaturan, pesan validasi, hasil uji token, hint setup).

---

## 5. Kesenjangan (gap list)

| #   | Sev | Gap                                                                                                                            | Kenapa                                                                                  | Bukti                                                                                |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| G1  | P0  | CTA landing utama "Masuk dengan Google" mengajak pengunjung asing login ke panel pribadi pemilik                               | Salah audiens, menumpuk akun asing (PII), jalan buntu di `/profile`, permukaan serangan | `landing.cta.ts:10-13`, `id.landing.ts:6`, §2.11                                     |
| G2  | P0  | Peran `user` jalan buntu: tanpa penjelasan, tanpa langkah berikutnya; landing menyebutnya "Buka panel"                         | Setiap login baru (termasuk anggota tim sah) bingung; tiket ke pemilik                  | `profile.page.tsx`, screenshot `profile-user-m`, build lokal "Buka panel → /profile" |
| G3  | P0  | Teks Pengaturan (label, deskripsi, validasi), hasil "Uji token", dan hint setup berbahasa Inggris                              | Melanggar panduan konten; halaman yang paling sering dipakai super admin saat setup     | `settings.service.ts:63-171`, `dns.provider.ts:72-79`, `setup.service.ts:18-38`      |
| G4  | P0  | Onboarding pertama tidak ada di UI walau API `/dev/setup` siap                                                                 | Super admin baru tidak tahu urutan wajib (token, cadangan, Access, secret)              | `grep /setup src/web` kosong; `setup.service.ts`                                     |
| G5  | P0  | Halaman `/dev` tanpa `<h1>`/judul; di HP tidak ada penanda halaman sama sekali                                                 | A11y (WCAG 2.4.2/2.4.6 praktik), orientasi di HP                                        | `app.layout.tsx:66`, semua `src/web/dev/*.page.tsx`                                  |
| G6  | P0  | Audit menampilkan aktor terhapus sebagai "Sistem"                                                                              | Jejak audit menyesatkan = gagal fungsi utama audit                                      | `audit-log.schema.ts` (`set null`), `audit.page.tsx:28`                              |
| G7  | P1  | Promosi ke Admin tanpa konfirmasi & tanpa deskripsi peran                                                                      | Satu tap memberi akses setara shell                                                     | `users.list.tsx:53`                                                                  |
| G8  | P1  | Status "Bawaan" untuk setting kosong tanpa default                                                                             | Menyesatkan saat setup cadangan/Cloudflare                                              | `settings.state.ts:22-25`, snapshot pengaturan                                       |
| G9  | P1  | Tidak ada uji koneksi S3; "Uji token" tampil walau kosong                                                                      | Kesalahan cadangan baru ketahuan saat run terjadwal                                     | `setting.field.tsx:79`, §2.6                                                         |
| G10 | P1  | Kesehatan tidak menampilkan 5xx, req/mnt (sudah ada di API), mode adapter, skema tertinggal, cadangan, error terakhir, vonis   | Halaman "Kesehatan" tidak menjawab "sehat atau tidak"                                   | `health.page.tsx:27-49`, `dev.types.ts:22-23`                                        |
| G11 | P1  | Filter audit exact-match dengan placeholder awalan; 4/23 aksi disarankan; tanpa filter aktor; baris berupa kode mentah         | Filter tampak rusak; audit tak terbaca                                                  | `audit.service.ts:56`, `id.dev.ts:71`, `audit.page.tsx:16-37`                        |
| G12 | P1  | Halaman Log membanjiri ring buffer dengan request polling-nya sendiri                                                          | Log penting hilang dari buffer 2.000 baris                                              | `request.log.ts:32-33`, screenshot `dev-logs-m`                                      |
| G13 | P1  | Landing tidak punya jalur instal yang bisa diikuti (tanpa rilis, langkah build tidak disebut) dan tanpa blok perintah+salin    | Pengunjung yang benar (calon pemasang) tidak bisa konversi                              | `id.landing.ts:100-121`, `gh repo view` (no release)                                 |
| G14 | P1  | Tidak ada LICENSE; FAQ keamanan meremehkan perlunya Access                                                                     | Kejujuran klaim; risiko hukum/kepercayaan                                               | `gh repo view` `licenseInfo:null`, `id.landing.ts:148-150`                           |
| G15 | P1  | Tanpa OG/Twitter/canonical/og:image; robots.txt & sitemap soft-404; judul sama di semua path sebelum JS                        | Pratinjau tautan di WhatsApp/Telegram kosong; `/login` `/panel` terindeks               | `index.html`, `curl` produksi                                                        |
| G16 | P1  | Brand tidak konsisten (wordmark `panel-termux`, logomark tinta vs oranye; login tanpa brand)                                   | Landing ↔ aplikasi terasa dua produk                                                    | `landing.header.tsx:15-18`, `brand.logo.tsx:10,24`, `login.page.tsx`                 |
| G17 | P1  | Profil tanpa daftar sesi/revoke walau API siap                                                                                 | Keamanan akun (keluar dari HP yang hilang)                                              | `me.routes.ts:31-36`, `grep me/sessions src/web` kosong                              |
| G18 | P1  | Pengaturan datar 13 field, tanpa grup/simpan grup/kontrol terstruktur/tautan bantuan; "Kosongkan" rahasia tanpa konfirmasi     | Setup lambat & rawan salah di HP                                                        | `settings.page.tsx`, `setting.field.tsx:66-76`                                       |
| G19 | P1  | Empty state generik di semua `/dev`; string spesifik tak terpakai (kode mati)                                                  | Panduan konten "apa isi bagian ini + aksi pertama"                                      | `query.state.tsx:68`, `id.dev.ts:25,66,72,79`                                        |
| G20 | P1  | `lastSeenAt` hilang setelah sesi berakhir; tidak ada "keluarkan dari semua perangkat" untuk pengguna lain                      | Data tidak andal; tidak ada respons insiden selain hapus                                | `users.service.ts:14-16`                                                             |
| G21 | P2  | Landing memuat bundle aplikasi penuh (706 KB mentah) untuk halaman statis                                                      | LCP di HP/3G; produksi tertolong brotli+cache CF                                        | resource timing build lokal                                                          |
| G22 | P2  | Header landing patah 2 baris di 390px; mock HP tidak ikut glosarium/format angka                                               | Kesan kurang rapi                                                                       | screenshot `landing-m-1`, `phone.mock.tsx:7-12`                                      |
| G23 | P2  | Polling tidak berhenti saat tab tersembunyi                                                                                    | Baterai HP-server & HP pembuka                                                          | `use-api-query.ts:34-38`                                                             |
| G24 | P2  | Login: tanpa tautan ke `/`, error OAuth tidak dibedakan; tamu di path tak dikenal → `/login` (README/CHANGELOG bilang landing) | Docs tidak sinkron; orientasi                                                           | `login.error.ts`, `session.redirect.ts:16`, README §Layar                            |
| G25 | P2  | Log: tanggal penuh per baris, `break-all`, tanpa salin/unduh/ikuti                                                             | Keterbacaan di HP                                                                       | `logs.page.tsx:56-66`                                                                |
| G26 | P2  | Daftar pengguna tanpa filter peran; urutan terbaru dulu; waktu absolut                                                         | Admin tenggelam oleh akun asing                                                         | `users.service.ts:62`                                                                |
| G27 | P2  | Tidak ada hapus akun sendiri untuk peran `user`                                                                                | Privasi akun asing yang tidak sengaja login                                             | `me.routes.ts`                                                                       |
| G28 | P2  | Ekspor audit (CSV)                                                                                                             | Benchmark P3; jarang dibutuhkan 1–3 pengguna                                            | benchmark §8                                                                         |

---

## 6. Opsi & trade-off

### 6.1 Siapa pengunjung `/` dan ke mana CTA-nya (G1, G2, G13)

Fakta yang menentukan: landing **di-embed di binary**, jadi setiap instance Panel Termux (milik siapa pun) menampilkan
halaman pemasaran yang sama di root domain panelnya. Pengunjung root sebuah instance ada dua jenis:

- **A. Calon pemasang** — datang dari tautan/sosmed/GitHub, ingin memasang Panel Termux **di HP-nya sendiri**. Ia tidak
  pernah butuh akun di panel orang lain. Konversi yang benar: baca cara pasang → GitHub/README → build & instal.
- **B. Pemilik/tim instance itu** — sudah tahu produknya, hanya butuh pintu masuk cepat. Jumlahnya 1–3 orang.

Hari ini CTA utama melayani B dengan gaya yang ditujukan ke A (CTA oranye besar 3×), hasilnya A login ke panel
pemilik, jadi `user`, dan buntu. Tidak ada produk self-hosted pembanding yang melakukan ini (Coolify/CapRover: CTA =
instal; login hanya untuk SaaS mereka).

| Opsi                                                                                                                                                                                                                                                                          | Plus                                                                              | Minus                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **O1. Tukar hierarki CTA.** Primer = "Pasang di HP-mu" → `#pasang` (blok perintah + salin, lalu "Panduan lengkap di GitHub"); sekunder = "Lihat cara kerja". "Masuk" jadi tautan teks kecil di header ("Masuk" untuk tamu, "Buka panel" untuk yang login), tanpa logo Google. | Diff kecil (copy + `landing.cta.ts` + hero/final); melayani A tanpa menyulitkan B | Login asing tetap mungkin lewat `/login` (dibatasi oleh G2 + Access)                             |
| **O2. Mode root per instance** (setting `panel.root_page` = `landing` / `login`). Instance baru default `login`: `/` langsung kartu login ber-brand + tautan "Apa ini? → situs proyek". Landing pemasaran hanya aktif di instance showcase pemilik.                           | Instance orang lain tidak jadi papan iklan; tamu asing tak diundang               | Satu setting + cabang router; landing butuh "rumah" kanonik (instance pemilik atau GitHub Pages) |
| **O3. Pisahkan landing dari binary** (situs statis terpisah, mis. GitHub Pages), root instance = login.                                                                                                                                                                       | Landing bisa di-prerender, SEO & performa terbaik; binary lebih kecil             | Dua deploy, dua codebase/aset; kerja paling besar; kehilangan "landing gratis di tiap instance"  |

**Rekomendasi: O1 sekarang (P0), O2 sebagai keputusan pemilik untuk rilis berikutnya.** O1 menyelesaikan salah-audiens
dengan perubahan copy dan satu fungsi. O3 tidak sepadan sebelum ada trafik pemasaran nyata. Bersamaan dengan O1,
**G2 wajib**: `/profile` untuk peran `user` menampilkan kartu "Akun kamu belum punya akses ke panel ini" + penjelasan
"Panel ini milik pemiliknya. Bila kamu anggota tim, minta Super Admin memberimu peran Admin." + tombol "Keluar" +
(G27) "Hapus akun saya". Tombol "Minta akses" yang mengirim notifikasi ke super admin = P2 (butuh mekanisme notifikasi
yang belum ada; cukup baris audit `access.request` + badge di Pengguna bila diinginkan).

### 6.2 Kebijakan login terbuka (G1, G20 poin hapus-tidak-memblokir)

| Opsi                                                                                                             | Plus                                  | Minus                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| P-a. Tetap terbuka + andalkan Access (status quo)                                                                | Nol kode                              | Produksi saat ini tampak tanpa Access (§2.11) → akun asing nyata               |
| P-b. Setting `auth.allowed_emails` (daftar email/domain, kosong = terbuka) dicek di hook `session.create.before` | Penolakan di sumber, bukan di Access  | Pesan penolakan di `/login?error=` perlu dipetakan; kembali mirip era "invite" |
| P-c. Status "diblokir" per pengguna (hapus → blokir)                                                             | Menjawab "hapus tapi bisa login lagi" | Kolom baru + migrasi; kurang berguna bila P-b ada                              |

**Rekomendasi**: keputusan pemilik (lihat §7 Q1). Bila login memang sengaja terbuka (CHANGELOG 0.1.0 menghapus
undangan), minimal **onboarding (G4) wajib memuat item "Cloudflare Access aktif"** dan Kesehatan menampilkan
peringatan bila tidak terdeteksi. Deteksi murah: request yang lewat Access membawa header
`Cf-Access-Authenticated-User-Email` (perlu diverifikasi terhadap docs Cloudflare saat PLAN — Rule 20).

### 6.3 Onboarding pertama (G4)

Tempat: **kartu "Siapkan Panel Termux" di atas halaman Kesehatan sistem** (rumah super_admin), juga ringkas di
Ringkasan `/panel` untuk admin (item situs pertama saja) — koordinasi dengan domain Ringkasan.

Isi & urutan (wajib dulu, opsional terakhir), centang otomatis dari data:

1. Lindungi path privat dengan Cloudflare Access (deteksi header, atau centang manual "Sudah" bila tidak terdeteksi) — tautan ke README.
2. Simpan salinan `data/secret` di tempat aman (centang manual; tidak bisa dideteksi).
3. Token API Cloudflare (`cloudflare_token`) → tautan ke grup Cloudflare di Pengaturan + "Uji token".
4. Cadangan ke S3/R2 (`backup`) → grup Cadangan + "Uji koneksi"; selesai penuh setelah run pertama sukses.
5. `apps.json` di `ecosystem.config.js` (`apps_json`) → blok kode + Salin.
6. Situs pertama / adopsi (`adopt_sites`) → "Buat situs".
7. (Opsional) Admin kedua (`admins`).

Penutupan:

| Opsi                                                                                       | Plus                            | Minus                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| D1. Hilang otomatis saat semua wajib selesai; tombol "Sembunyikan" disimpan `localStorage` | Tanpa skema baru                | Muncul lagi di perangkat lain                                       |
| D2. Status dismiss di tabel `setting` (`onboarding.dismissed_at`)                          | Satu kali untuk semua perangkat | Setting baru di registri (tanpa migrasi, tabel key-value sudah ada) |

**Rekomendasi D2** — tabel `setting` sudah key-value, jadi tanpa migrasi; super admin sering pindah HP ↔ laptop.
Item manual (1, 2) juga disimpan di sana. Server mengembalikan `title`/`hint` sebagai **kode**, teks Indonesia di
`id.dev.ts` (lihat 6.5).

### 6.4 "Uji koneksi" untuk kredensial S3 (G9)

| Opsi                                                                                             | Plus                                              | Minus                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- |
| T1. `POST /api/dev/backup/verify`: PUT objek kecil `<prefix>.panel-termux-check` → HEAD → DELETE | Menguji persis izin yang dipakai backup + retensi | Butuh izin delete (memang dibutuhkan retensi); satu objek sementara |
| T2. Hanya `ListObjectsV2` di prefix                                                              | Read-only                                         | Lolos walau kunci tidak punya izin tulis → palsu positif            |
| T3. Tanpa tombol; tampilkan hasil run terakhir saja                                              | Nol kode                                          | Kesalahan baru ketahuan berjam-jam kemudian                         |

**Rekomendasi T1**, dipakai juga oleh onboarding item 4. Pesan hasil dalam bahasa Indonesia, menyebut langkah yang
gagal ("Bisa menulis, tapi tidak bisa menghapus: retensi tidak akan jalan"). Sama untuk "Uji token": sembunyikan bila
token belum diisi, pesan server diganti kode → teks Indonesia.

### 6.5 Teks dari server (G3)

| Opsi                                                                                                               | Plus                                                 | Minus                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| L1. Terjemahkan string di `settings.service.ts` langsung ke Indonesia                                              | Diff terkecil                                        | Teks UI tersebar di server; panduan konten mengacu `src/web/i18n`             |
| L2. Server kirim `key` + kode error (`invalid_format` + `params`); label, deskripsi, bantuan, pesan di `id.dev.ts` | Satu sumber teks UI; server tetap bahasa log Inggris | Lebih banyak string di web; `DevSetting.label/description` jadi tidak dipakai |

**Rekomendasi L2** untuk pengaturan, hasil uji, dan hint setup — konsisten dengan pola `errorCodes` yang sudah ada.
Registri web juga tempat yang tepat untuk **grup**, **jenis kontrol** (select jam 0–23 + "Mati", dua input angka port,
chip layanan), dan **tautan bantuan**.

### 6.6 Aktor audit yang terhapus (G6)

| Opsi                                                                                                                      | Plus                                                  | Minus                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| A1. Kolom `actor_label` (nama/email saat kejadian) di `audit_log`; UI: `actor ?? actor_label + " (terhapus)" ?? "Sistem"` | Jejak permanen; backfill dari `user` untuk baris lama | Migrasi (kolom nullable, aman, idempotent)     |
| A2. Soft-delete pengguna (jangan hapus baris `user`)                                                                      | Join tetap jalan                                      | Mengubah semantik hapus + FK sesi; lebih besar |
| A3. Ganti hanya teks: null → "Sistem atau pengguna terhapus"                                                              | Nol migrasi                                           | Tetap ambigu                                   |

**Rekomendasi A1** (migrasi kecil, backfill satu `UPDATE … FROM user`). Sekalian tampilkan target bertaut nama
(user → email, setting → label) dan kalimat per aksi dari kamus `id.dev.audit.actions`.

### 6.7 Kebisingan log (G12)

Rekomendasi paling murah: catat request **sukses** ke `/api/me` dan `/api/dev/logs` di level `debug` (perluas
`QUIET_PATHS`, `request.log.ts:7`) — tetap terhitung di statistik, tetap terlihat bila level Debug dipilih. Alternatif
(log request terpisah dari log aplikasi) tidak sebanding.

### 6.8 OG/SEO di SPA (G15)

Server sudah memproses HTML halaman untuk CSP (`index.ts:82-126`). Opsi: (S1) tag statis di `index.html` dengan
`og:image` relatif — **tidak valid**, OG butuh URL absolut; (S2) server menyuntikkan `og:url`/`og:image`/`canonical`
absolut dari `APP_BASE_URL` saat menyajikan HTML + `robots.txt` nyata (`Disallow: /panel /dev /profile /login /api`) +
header `X-Robots-Tag: noindex` untuk path non-landing. **Rekomendasi S2** (gambar OG 1200×630 sebagai aset statis yang
di-embed).

---

## 7. Risiko & pertanyaan terbuka

**Pertanyaan untuk pemilik (keputusan nyata):**

1. **Login terbuka untuk semua akun Google — tetap?** Produksi saat ini menjawab 200 untuk `/dev` `/panel` `/profile`
   tanpa tantangan Access (§2.11). Pilih: (a) tetap terbuka + Access wajib di onboarding, atau (b) daftar email/domain
   yang diizinkan di Pengaturan (§6.2). Ini menentukan copy landing, `/login`, dan halaman `user`.
2. **Root `/` instance orang lain: landing pemasaran atau langsung login?** (O1 vs O2, §6.1). Dan di mana "rumah"
   kanonik landing — `panel.malikkurosaki.com` atau halaman GitHub?
3. **Lisensi repo.** Tanpa LICENSE, landing tidak boleh mengklaim open source dan pengunjung secara hukum tidak boleh
   memakai kodenya. Lisensi apa (MIT/Apache-2.0/AGPL)?
4. **Distribusi binary.** Apakah akan ada GitHub Release berisi `panel-android-arm64`? Tanpa itu langkah "Pasang panel"
   di landing harus menyebut build dengan Bun di komputer (jujur tapi friksi besar).

**Risiko untuk PLAN:**

- Menukar CTA (O1) mengubah kontrak yang dijelaskan README §Layar dan CHANGELOG 0.2.0 ("Masuk dengan Google") → docs
  wajib ikut (Rule 16). Test `tests/web.landing.test.ts` menguji label/arah CTA dan perlu diperbarui.
- Kolom `actor_label` = perubahan skema → migrasi + verifikasi lokal + test (Rule 4).
- L2 (teks pengaturan pindah ke web) memecah kontrak `DevSetting.label/description`; pastikan tidak ada konsumen lain.
- "Uji koneksi S3" menulis/menghapus objek di bucket nyata → objek uji harus di bawah `backup.prefix` agar tidak
  menyentuh data lain; panggilan nyata ke R2 belum pernah diuji end-to-end (README §Keterbatasan).
- Deteksi Access via header belum diverifikasi terhadap docs Cloudflare terbaru; bila tidak andal, item onboarding
  jadi centang manual.
- Halaman `/dev` tanpa judul dan empty state generik kemungkinan juga terjadi di domain lain — sebaiknya diperbaiki di
  `QueryView`/shell sekali (koordinasi dengan worker shell), bukan per halaman.
- Perubahan landing harus menjaga syarat Access di README: `/`, `/login`, `/api/me`, aset bundle tetap publik. Bila
  landing dipecah dari bundle aplikasi (G21), pastikan nama aset baru tetap di root dan tidak tertutup Access.
- Kode mati yang ditemukan (`id.dev.*.empty`, `countsDetail`, `deletedUser`, `health.refreshing`) harus dipakai atau
  dihapus di PR yang sama (Rule 17).

**Lampiran — artefak sesi ini** (scratchpad, sementara): screenshot di
`/private/tmp/claude-501/-Users-bip-test-panel-termux/ca2c3cc5-ee0a-4bb1-9206-ebdeb3da612d/scratchpad/w5/shots/`
(`landing-m-1`, `landing-d-1`, `login-m`, `dev-health-m`, `dev-users-m`, `dev-audit-m`, `dev-logs-m`,
`dev-settings-m`, `profile-user-m`, `cmp-coolify`, `cmp-caprover`, `cmp-railway`). Proses panel lokal port 3415 sudah
dihentikan; data dir sementara hanya berisi data dummy.
