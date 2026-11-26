# R&D 01 — App shell, design system, komponen bersama, konten & aksesibilitas

> wkr-rnd-shell-01 · 2026-11-26 · branch `feature/production-polish` (HEAD 2a55c8b). Hanya riset, tidak ada kode diubah.
> Bukti: baca kode `src/web/**`, build lokal `dist/panel` (mode fake, port 3411, sesi super admin di-seed ke DB temp lalu
> dihapus), screenshot ego-browser 390×844 dan 1600 px, `curl` header produksi (GET publik, read-only).

---

## 1. Ruang lingkup

| Area                           | File utama                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell & navigasi               | `src/web/layout/{app.layout,app.sidebar,mobile.bar,sidebar.nav,nav.items,breadcrumbs,user.menu,brand.logo}.tsx`, `src/web/router.tsx`                                                                 |
| Tema                           | `src/web/theme/theme.{preference,store}.ts`, script boot di `src/web/index.html:12-27`                                                                                                                |
| Design token                   | `src/web/styles.css` (token app `:root`, dark `[data-theme=dark]`, token landing `--lp-*`)                                                                                                            |
| Komponen bersama baru (wave A) | `src/web/components/{page-header,stat-tile,status-badge,status.tone,data-table,empty-state,error-state,skeletons,section,key-value,inline-code,copy-button,relative-time,role-badge,user-avatar}.tsx` |
| Komponen lama (pra-wave A)     | `src/web/shared/{query.state,stat.card,confirm.dialog,api.action}.tsx`, `src/web/panel/{status.badge,panel.status,unit.card}.ts*`, `src/web/dev/pager.tsx`                                            |
| Format                         | `src/web/shared/format.ts`, `src/web/components/relative-time.tsx`                                                                                                                                    |
| Konten                         | `src/web/i18n/*.ts` vs `docs/content-guide.md`                                                                                                                                                        |
| Halaman sistem                 | `pages/{login,not-found,route-error,profile}.page.tsx`, `session/{session.error,session.fallback,session.gate}.tsx`                                                                                   |
| Toast & dialog                 | `components/ui/sonner.tsx`, `panel/panel.layout.tsx`, `dev/dev.layout.tsx`, `shared/confirm.dialog.tsx`, `components/ui/{dialog,alert-dialog,sheet}.tsx`                                              |
| Bundle SPA                     | `scripts/build.ts`, `src/server/index.ts:4` (`import spa from "../web/index.html"`)                                                                                                                   |

Di luar scope (punya worker lain, hanya disentuh bila menyangkut pola bersama): isi Ringkasan, wizard situs, deploy,
log viewer, cadangan, admin. Inventaris komponen di §2.9 mencakup semua halaman karena migrasinya pola bersama.

---

## 2. Kondisi sekarang — audit

### 2.1 Router & struktur route

- Satu `createBrowserRouter` (`router.tsx:37-93`), **semua halaman di-import statis** (`router.tsx:2-31`), tanpa `lazy`.
  Root loader `fetchMe` sekali per page load; `SessionGate` mengulang aturan redirect tiap navigasi.
- `ErrorBoundary` pathless di dalam `AppLayout` (`router.tsx:51-53`) → error halaman tetap di dalam shell. Bagus.
- `path: "*"` hanya ada di dalam `AppLayout` (`router.tsx:86`). Tamu yang membuka alamat tak dikenal diarahkan ke
  `/login` oleh `resolveRedirect` (`session/session.redirect.ts:16`) — **terverifikasi di build lokal**: semua 16 path
  terproteksi sebagai tamu berakhir di judul "Masuk ke Panel Termux". Ini **bertentangan** dengan README
  ("Alamat yang tidak dikenal menampilkan halaman perkenalan") dan CHANGELOG 0.2.0.
- `PanelLayout` dan `DevLayout` hanya membungkus `<Toaster>` (+ `TooltipProvider` ganda di `panel.layout.tsx:8`, padahal
  `AppLayout` sudah memasang satu di `app.layout.tsx:55`).

### 2.2 App shell

**Desktop (≥ md)** — `app.sidebar.tsx`: sidebar 240 px / 56 px (collapse disimpan di `localStorage`
`panel-termux:sidebar-collapsed`, `app.layout.tsx:13-30`), grup Server / Administrasi / Akun (`nav.items.ts:33-63`),
toggle collapse + `UserMenu` di bawah. Header sticky 56 px hanya berisi breadcrumbs (`app.layout.tsx:66-68`), **tanpa
slot aksi/status**. Konten `max-w-7xl` atau `max-w-3xl` per item nav (`nav.items.ts:27`, `app.layout.tsx:70`).

**Mobile (< md)** — `mobile.bar.tsx`: top bar logo + tombol hamburger → `Sheet` kiri 288 px berisi nav penuh + user menu.
Temuan:

1. **Tidak ada judul halaman maupun breadcrumb di mobile.** Breadcrumb hanya `hidden md:flex` (`app.layout.tsx:66`) dan
   12 dari 16 halaman tidak punya `<h1>` (lihat 2.4). Screenshot 390 px `/panel/services` dan `/panel` hanya
   menampilkan "Panel Termux ≡" lalu langsung kartu — pengguna tidak tahu sedang di halaman mana.
2. **Hamburger satu-satunya navigasi** untuk halaman yang dibuka tiap hari — persis yang dilarang
   `docs/research/ui-benchmark.md` §1 ("Hindari: Hamburger sebagai satu-satunya nav di mobile").
3. **Sheet tidak tertutup saat navigasi dari `UserMenu`.** `onNavigate={() => setOpen(false)}` hanya diberikan ke
   `SidebarNav` (`mobile.bar.tsx:46`); item "Profil" di `UserMenu` (`user.menu.tsx:70-75`) adalah `<Link>` biasa, jadi
   sheet tetap terbuka menutupi halaman profil. Tidak ada efek "tutup saat `pathname` berubah".
4. Top bar tidak memakai `env(safe-area-inset-top)`; sheet memakai `safe-area-inset-bottom` (`mobile.bar.tsx:48`) tapi
   `index.html:5` tidak punya `viewport-fit=cover`, jadi nilai inset selalu 0 (harmless sekarang, salah bila PWA nanti).
5. Tidak ada indikator masalah di item nav (benchmark §1 P1: titik merah di "Layanan"/"Cadangan").

**Breadcrumbs** — `breadcrumbsFor` (`nav.items.ts:93-106`) membuat crumb antara untuk tiap segmen URL. Untuk
`/panel/services/sshd/log` hasilnya "Server › Layanan › sshd › Log" dengan **"sshd" bertaut ke `/panel/services/sshd`
yang bukan route** → 404. Sama untuk `/panel/apps/:name/log`. `/panel/jobs/:id` menampilkan UUID mentah sebagai crumb dan
judul tab. Segmen grup ("Server") tidak bertaut (benar), tapi label `breadcrumb: "Breadcrumb"` (`id.shell.ts:30`) masih
bahasa Inggris.

**Document title** — `documentTitleFor` (`nav.items.ts:117-121`) di `useEffect` shell: "Situs · Panel Termux",
"Log · sshd · Layanan · Panel Termux" (terverifikasi). Masalah: (a) judul detail memakai segmen URL, bukan nama
data (job → UUID); (b) `LoginPage` men-set "Masuk ke Panel Termux" (`login.page.tsx:16`) lalu **landing tidak pernah
mengembalikan judulnya** — navigasi SPA /login → / meninggalkan judul login; (c) path tak dikenal → "Halaman tidak
ditemukan · Panel Termux" (benar).

**User menu** — `user.menu.tsx`: avatar, nama, peran, radio tema (Sistem/Terang/Gelap), Profil, Keluar (tetap terbuka
agar error terlihat — bagus). `DropdownMenuContent side="top"` cocok di sidebar bawah. Email ditampilkan di menu
(PII ke layar sendiri, aman).

**Tema** — preferensi `system|light|dark`, boot script pra-paint, `useSyncExternalStore`, `theme-color` meta ikut.
Solid. Kekurangan: tanpa JS halaman putih kosong (SPA, wajar); token hanya di `[data-theme]`, tanpa fallback
`prefers-color-scheme` (keputusan sadar, `styles.css:5-8`).

**Fokus & pembaca layar** — skip link ada (`app.layout.tsx:56-61`), `main tabIndex=-1`. Tapi **tidak ada manajemen
fokus/pengumuman saat pindah route**: fokus tetap di link sidebar/sheet, pembaca layar tidak diberi tahu halaman
berganti (React Router tidak melakukannya otomatis). `:focus-visible` global 2 px ring (`styles.css:225-228`) baik.

### 2.3 Design token & tipografi

- Token warna lengkap: netral hangat, `brand` oranye, `success/warning/danger/info` + `-subtle`, rasio kontras ditulis
  di komentar (`styles.css:16-88`). Dark mode memakai nilai sendiri. Shadow scale, radius, font sistem (tanpa font host,
  cocok offline).
- **Token tidak dipakai konsisten** — warna Tailwind mentah masih di 9 tempat:
  `panel/overview.page.tsx:45` (amber banner mode demo), `site/integration.banner.tsx:22`, `site/wizard.summary.tsx:35`,
  `site/site.env-editor.tsx:84` (amber), `site/job.steps.tsx:18-19` dan `dev/logs.page.tsx:20` (emerald/amber),
  `site/wizard.target.tsx:67`, `dev/cloudflare.verify.tsx:38` (emerald-600 — **tanpa varian dark**, kontras turun di tema
  gelap). Banyak juga `destructive/10` + `text-destructive` (lama) alih-alih `danger-subtle`/`text-danger`
  (`shared/query.state.tsx:36`, `pages/login.page.tsx:42`).
- `Progress` di kartu Memori/Penyimpanan Ringkasan memakai warna **brand oranye** (screenshot 390 px), melanggar aturan
  benchmark §11 "Oranye brand hanya untuk aksi utama & fokus, jangan untuk status". `StatTile` baru sudah benar (warna
  per ambang), tapi belum dipakai.
- Tombol `destructive` di dark: `dark:bg-destructive/60` + `text-white` (`components/ui/button.tsx:13`) — rasio belum
  diukur; komentar `styles.css:50` hanya menjamin 5,9:1 untuk light.
- Skala tipografi tidak seragam: `PageHeader` h1 `text-xl sm:text-2xl` (`page-header.tsx:36`), halaman lama h1
  `text-lg` (`site-detail.page.tsx:63`, `jobs.page.tsx:25`, `backups.page.tsx:49`, `job.page.tsx:78`,
  `site-new.page.tsx:52`), `log.page.tsx:66` memakai h2 sebagai judul. `Section` h2 `text-sm`, `CardTitle` div
  `leading-none font-semibold`. Benchmark §11 menetapkan 5 tingkat — belum ditegakkan.
- Kepadatan: tombol `default` 36 px, `sm` 32 px, `icon-xs` 24 px (`button.tsx:21-28`), item nav 32 px
  (`sidebar.nav.tsx:53`), input 36 px. Di HP target sentuh < 44 px di hampir semua kontrol (tombol Mulai/Hentikan/Mulai
  ulang/Log 32 px, `CopyButton` dan tombol refresh `PageHeader` 24 px). WCAG 2.2 AA (2.5.8) mensyaratkan ≥ 24 px — lolos
  tipis; pedoman platform (Apple 44 pt, Material 48 dp) dan benchmark §11 (item list mobile 56–64 px) tidak.

### 2.4 Header halaman

Hasil evaluasi DOM di build lokal (sesi super admin):

| Path                                                                                 | `<h1>`                                                   | Judul tab |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------- |
| /panel, /panel/services, /panel/apps, /panel/domains, /panel/databases, /panel/sites | **tidak ada**                                            | ok        |
| /dev, /dev/users, /dev/audit, /dev/logs, /dev/settings                               | **tidak ada**                                            | ok        |
| /panel/services/sshd/log                                                             | **tidak ada** (h2 "Log sshd")                            | ok        |
| /panel/jobs, /panel/backups, /panel/sites/new, /profile                              | ada                                                      | ok        |
| /login                                                                               | **tidak ada** (`CardTitle` = `div`, `login.page.tsx:35`) | ok        |

Hanya `/profile` memakai `PageHeader`. Halaman live menulis teks statis "Diperbarui otomatis tiap 10 detik"
(`overview.page.tsx:70`, `id.panel.ts:24`) dan "... tiap 15 detik" (`health.page.tsx:57`, `id.dev.ts:33`) — dilarang
eksplisit oleh `docs/content-guide.md` ("Teks bantuan dan status data"); i18n sendiri menandainya `// lama`.

### 2.5 Kosakata & warna status

Ada **dua tabel tone yang bertentangan**:

- Baru: `components/status.tone.ts:12-35` — `running → info`, `rolled_back → danger`, `launching → warning`.
- Lama: `panel/panel.status.ts:4` (`ok|warn|bad|muted`), `site/job.state.ts:22-32`, `deploy/deploy.state.ts:5`,
  `backup/backup.state.ts:7-22` — `running → warn` (kuning, bukan info), job step `rolled_back → warn` tapi job
  `rolled_back → bad`. Dijembatani `LEGACY_TONE` + adapter `panel/status.badge.tsx` (11 pemakai).

Label juga tidak satu kamus (`id.panel.ts:44-56`): service `down` = "Mati", `finish` = "Berhenti"; app `stopped` =
"Berhenti", `launching` = "Sedang dimulai". Benchmark §11 menetapkan "Dihentikan" (sengaja), "Gagal/Mati" (tak
disengaja), "Memulai…". Ringkasan memakai "Semua normal / N perlu dicek" (`id.panel.ts:42`) vs "Sehat" di benchmark.
Service `down` + `wantUp` diberi tone `bad` tapi label tetap "Mati" — warna dan teks sama untuk "mati disengaja" dan
"mati tak disengaja" hanya beda warna (gagal WCAG 1.4.1 "use of color" untuk pembeda yang penting).

`StatusBadge` baru (`status-badge.tsx`) = titik + teks, `pulse` opsional — sesuai benchmark. Badge "Inti"
(`services.page.tsx:37`) memakai `Badge` shadcn, bukan `StatusBadge`/tone netral.

### 2.6 Komponen bersama

| Komponen baru                                                     | Status                             | Catatan audit                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                      | dipakai 1× (`profile.page.tsx:17`) | Tanpa slot status/breadcrumb-override; `MetaLine` pakai `animate-ping` (dimatikan reduced-motion global, ok). Tidak sticky.                                                                                                                             |
| `StatTile`                                                        | **0 pemakai**                      | `role="progressbar"` + ambang; `truncate` pada nilai (angka panjang terpotong tanpa tooltip).                                                                                                                                                           |
| `StatusBadge`                                                     | dipakai lewat adapter lama         | ok                                                                                                                                                                                                                                                      |
| `DataTable`                                                       | **0 pemakai**                      | Tabel ≥ md, kartu `dl` di mobile. Tidak ada slot aksi baris/"⋯", tidak ada baris-sebagai-link, tidak ada sort; `error`/`empty` sebagai `ReactNode` (pemanggil harus merakit sendiri). Dua `aria-label` sama untuk table + ul (hanya satu terlihat, ok). |
| `EmptyState` (components)                                         | 1× (404)                           | Bentuk sesuai guide (judul + deskripsi + aksi).                                                                                                                                                                                                         |
| `ErrorState` (components)                                         | 1× (route error)                   | Tidak menerima `ApiError` langsung — butuh adaptor dari `apiErrorMessage`.                                                                                                                                                                              |
| `skeletons.tsx`                                                   | **0 pemakai**                      | Duplikat `ListSkeleton` lama (`shared/query.state.tsx:10`).                                                                                                                                                                                             |
| `Section`, `KeyValue`, `InlineCode`, `CopyButton`, `RelativeTime` | **0 pemakai**                      | `RelativeTime` membuat 1 `setInterval` 5 dtk per elemen (`relative-time.tsx:21-24`) — 50 baris audit = 50 timer.                                                                                                                                        |

Pola lama yang masih aktif:

- `QueryView` + `EmptyState`/`ErrorState` lama (`shared/query.state.tsx`) dipakai **20×** di 18 file. Empty state-nya
  selalu teks generik `id.common.empty` "Belum ada yang bisa ditampilkan di sini." (terlihat di screenshot `/panel/sites`)
  — melanggar pola "apa isi bagian ini + aksi pertama". String spesifik sudah ada tapi **tidak terpakai**:
  `id.dev.users.empty`, `id.dev.audit.empty`, `id.dev.logs.empty` (0 referensi).
- `StatCard` lama (`shared/stat.card.tsx`) di Ringkasan, `device.cards.tsx`, Kesehatan sistem: kartu tinggi
  `text-2xl` — di 390 px 8 kartu ditumpuk satu kolom (screenshot: 4 kartu memenuhi layar pertama), pola yang
  benchmark §0.11 sebut "harus dihindari".
- `Pager` di `dev/pager.tsx` dipakai juga oleh `site/jobs.page.tsx` dan `backup/backups.page.tsx` (dependensi lintas
  domain ke folder `dev/`); `<nav>` tanpa `aria-label`; duplikat `PaginationFooter` di `DataTable`.
- `ConfirmAction` (`shared/confirm.dialog.tsx`) — satu tingkat saja. `ConfirmDelete` selalu tombol "Hapus" generik
  (`confirm.dialog.tsx:70`), padahal guide: tombol mengulang kata kerja + objek ("Hapus domain"). Hapus situs
  (`site/site.delete.tsx:40-73`) memakai `AlertDialog` sendiri tanpa **ketik nama untuk konfirmasi**; hapus pengguna
  juga satu klik konfirmasi. Control buttons menampilkan dialog untuk **Mulai** juga (`control.buttons.tsx:50-63`) —
  benchmark §9: start tidak perlu konfirmasi. Body dialog masih `confirmBody` lama "Aksi "Mulai" akan dijalankan pada
  x." (`id.panel.ts:66`) walau `confirmBodies` (akibat dulu) sudah ditulis.
- Toast: `runApiAction` (`shared/api.action.ts`) toast sukses/gagal; `Toaster` dipasang **dua kali** (`panel.layout.tsx:10`,
  `dev.layout.tsx:9`), tidak ada di `/profile` dan landing; berpindah /panel ↔ /dev meng-unmount toaster → toast yang
  sedang tampil hilang. `richColors` memakai palet sonner sendiri, bukan token `success/danger`. `position="top-center"`
  menutupi top bar sticky di HP. Toast error penting (mis. gagal hentikan layanan) hilang otomatis (~4 dtk) tanpa jejak
  di layar — benchmark §9 "Hindari".
- String Inggris di primitive shadcn: `sr-only "Close"` (`components/ui/dialog.tsx:63`, `sheet.tsx:68`), tombol
  `Close` (`dialog.tsx:98`).

### 2.7 Format angka & waktu (`shared/format.ts`)

| Fungsi                               | Perilaku                                                                                                                    | Selisih dengan `docs/content-guide.md`                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `formatRelative` (`:58-70`)          | "baru saja" < 10 dtk, lalu "12 dtk lalu"                                                                                    | Guide: di bawah 1 menit "baru saja".                                                        |
| `formatRelative` > 7 hari            | tanggal saja                                                                                                                | ok (benchmark: absolut setelah 7 hari)                                                      |
| `formatBytes` (`:7-17`)              | `maximumFractionDigits` → "64 GB"                                                                                           | Guide: GB/TB **selalu 1 desimal** ("64,0 GB"); ≥ 100 GB juga dibulatkan 0 desimal.          |
| `formatDateTime(…, true)` (`:77-82`) | `timeStyle: "medium"` → "14.05.07"                                                                                          | Komentar bilang ":07"; tidak konsisten dengan pola jam "HH.MM".                             |
| `formatLoad`                         | "0,50 · 1,00 · 1,25"                                                                                                        | ok; `formatLoadPerCore` tersedia tapi Ringkasan masih pakai `formatLoad`.                   |
| Memori perangkat                     | `t.memoryFree` "3788 MB bebas dari 11776 MB" (`id.panel.ts:32`, screenshot)                                                 | Harus lewat `formatMegabytes` → "3,7 GB bebas dari 11,5 GB".                                |
| Waktu di daftar                      | `formatDateTime` absolut di `users.list.tsx:94,120-121`, `audit.page.tsx:28`, `deploy.history.tsx:73`, `backup.runs.tsx:61` | Benchmark §11: relatif < 7 hari + absolut di tooltip (`RelativeTime` sudah ada, 0 pemakai). |
| Suhu                                 | format lokal di i18n (`id.panel.ts:30`)                                                                                     | Logika format di file i18n; pindah ke `format.ts`.                                          |

`formatDuration` sudah benar ("7 mnt 17 dtk"). Test format ada di `tests/web.shell.test.ts` (14 test).

### 2.8 Halaman sistem

- **Login** (`login.page.tsx`): kartu tengah 384 px, tombol Google `lg` (40 px). Tidak ada logo/brand, tidak ada
  tautan kembali ke landing, tidak ada `<h1>`, ikon Google monokrom. Semua `?error=` → satu pesan generik
  (`login.error.ts:4-7`), termasuk kasus yang sebenarnya berbeda (state mismatch, akun ditolak). Error inline memakai
  `destructive/10` lama.
- **404** (`not-found.page.tsx`): `EmptyState` di dalam shell + tombol ke beranda peran. Baik. Tamu tidak pernah
  melihatnya (lihat 2.1).
- **Route error** (`route-error.page.tsx`): pesan + detail teknis mono + "Kembali" (`navigate(-1)` — bila dibuka dari
  deep link, keluar dari aplikasi) + "Muat ulang". Tidak membedakan **chunk gagal dimuat setelah deploy** (relevan bila
  code splitting ditambahkan).
- **Session error/fallback** (`session.error.tsx`, `session.fallback.tsx`): ikon WifiOff untuk semua kegagalan
  `/api/me` (juga HTTP 500, bukan hanya jaringan). Skeleton fallback tidak menyerupai shell (kotak di tengah) → layout
  "melompat" saat shell muncul.

### 2.9 Inventaris komponen — halaman yang masih memakai pola lama

| Halaman / file                                                                                                              | Pola lama                                                                                                              | Migrasi ke                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel/overview.page.tsx`                                                                                                   | tanpa h1; teks "tiap 10 detik"; `QueryView`; `StatCard`; `status.badge` adapter; banner amber mentah                   | `PageHeader` (meta `updatedAt`/`live`/`onRefresh`); `StatTile` grid 2×2; `StatusBadge` tone semantik; banner `warning-subtle` (domain worker Ringkasan) |
| `panel/device.cards.tsx`                                                                                                    | `StatCard` + `Progress` brand; MB mentah                                                                               | `StatTile` + `progress`/`thresholds`; `formatMegabytes`, `formatLoadPerCore`                                                                            |
| `panel/services.page.tsx`, `panel/apps.page.tsx`                                                                            | tanpa h1; `QueryView`; `UnitCard` grid kartu; adapter `status.badge`; `Badge` "Inti"                                   | `PageHeader` + `DataTable` (kolom Nama/Status/Uptime/aksi; kartu di mobile) + `StatusBadge`; aksi utama + menu "⋯"                                      |
| `panel/unit.card.tsx`, `panel/status.badge.tsx`, `panel/panel.status.ts` (tipe `Tone`)                                      | adapter lama                                                                                                           | hapus setelah migrasi; `panel.status.ts` kembalikan `StatusTone`                                                                                        |
| `panel/control.buttons.tsx`                                                                                                 | konfirmasi untuk Mulai; `confirmBody` lama                                                                             | tier konfirmasi (2.6); `confirmBodies`, toast `doneBy`                                                                                                  |
| `panel/domains.page.tsx`                                                                                                    | tanpa h1; `QueryView`; `Card` per domain; `formatDateTime` di `title`                                                  | `PageHeader` + `DataTable` + `RelativeTime` "dicek 3 mnt lalu"                                                                                          |
| `panel/databases.page.tsx`                                                                                                  | tanpa h1; `QueryView`; `Table` mentah (tidak responsif)                                                                | `PageHeader` + `DataTable`                                                                                                                              |
| `panel/log.page.tsx`                                                                                                        | h2 sebagai judul; tombol "Kembali" manual                                                                              | `PageHeader` (judul "Log sshd"); breadcrumb benar; LogViewer (worker log)                                                                               |
| `site/sites.page.tsx`                                                                                                       | tanpa h1; `QueryView` + empty generik; grid `SiteCard`                                                                 | `PageHeader` (aksi "Buat situs"), `DataTable`, `EmptyState` spesifik + CTA                                                                              |
| `site/site-detail.page.tsx`, `site/jobs.page.tsx`, `site/job.page.tsx`, `site/site-new.page.tsx`, `backup/backups.page.tsx` | h1 `text-lg` manual; `QueryView`; `Pager` dari `dev/`; adapter `status.badge`                                          | `PageHeader`, `DataTable` + `pagination`, `StatusBadge`, `RelativeTime`                                                                                 |
| `site/site.card.tsx`, `site/job.steps.tsx`, `site/integration.banner.tsx`, `site/wizard.*.tsx`, `site/site.env-editor.tsx`  | warna emerald/amber mentah, tone lama                                                                                  | token `success/warning` + `TONE_CLASS`                                                                                                                  |
| `site/site.delete.tsx`                                                                                                      | `AlertDialog` sendiri tanpa ketik nama                                                                                 | `ConfirmAction` tier "ketik nama"                                                                                                                       |
| `deploy/deploy.history.tsx`                                                                                                 | `QueryView`; `formatDateTime`; adapter `status.badge`                                                                  | `DataTable` + `RelativeTime` + `StatusBadge`                                                                                                            |
| `backup/backup.runs.tsx`, `backup/backup.status.tsx`                                                                        | tone lama; `formatDateTime`                                                                                            | `StatusBadge` tone semantik; `RelativeTime`                                                                                                             |
| `dev/health.page.tsx`                                                                                                       | tanpa h1; "tiap 15 detik"; `StatCard`; skeleton custom                                                                 | `PageHeader` meta + `StatTile` + `StatTilesSkeleton`                                                                                                    |
| `dev/users.page.tsx`, `dev/users.list.tsx`                                                                                  | tanpa h1; `QueryView` (empty generik meski `users.empty` ada); `Table` + kartu ditulis manual; `ConfirmDelete` "Hapus" | `PageHeader` + `DataTable` + `EmptyState` spesifik + konfirmasi "Hapus pengguna"                                                                        |
| `dev/audit.page.tsx`, `dev/logs.page.tsx`                                                                                   | tanpa h1; `QueryView`; list `<li>` manual; amber mentah                                                                | `PageHeader` + `DataTable`/LogViewer + `RelativeTime` + `EmptyState` filter (`noResults`)                                                               |
| `dev/settings.page.tsx`                                                                                                     | tanpa h1; `QueryView`                                                                                                  | `PageHeader` + `Section` per kelompok (worker admin)                                                                                                    |
| `pages/login.page.tsx`                                                                                                      | `CardTitle` div; error `destructive/10`                                                                                | h1, `ErrorState`/token `danger`, brand mark                                                                                                             |
| `panel/panel.layout.tsx`, `dev/dev.layout.tsx`                                                                              | `Toaster` ganda, `TooltipProvider` ganda                                                                               | satu `Toaster` di root/`AppLayout`; hapus kedua layout bila kosong                                                                                      |
| `shared/query.state.tsx`, `shared/stat.card.tsx`, `dev/pager.tsx`                                                           | duplikat komponen baru                                                                                                 | hapus setelah semua pemakai pindah                                                                                                                      |

### 2.10 Performa bundle

Diukur dari `dist/panel` (build lokal, minify) dan metafile `Bun.build` atas `src/web/main.tsx`:

- **Satu chunk JS 722.802 B (≈ 230 KB gzip)** + CSS 87 KB (≈ 15 KB gzip). Tanpa code splitting; landing, login, semua
  halaman panel/admin, better-auth client ikut di chunk pertama.
- Kontributor: `react-dom` 207 KB, `react-router` 102 KB, `sonner` 35 KB, `src/web/components` 27 KB, `cn` 27 KB,
  `i18n` 24 KB (semua bahasa layar, termasuk landing), `src/web/site` 24 KB, `lucide-react` 23 KB, `radix select` 19 KB,
  `src/web/landing` 17 KB, `better-auth` + `@better-fetch` 28 KB, `src/web/dev` 11 KB.
- Kode app sendiri (landing + site + dev + panel + deploy + i18n) ≈ 100 KB min → lazy per area menghemat ±60–80 KB min
  (±20–25 KB gzip) dari muatan awal; vendor (react-dom + router ≈ 310 KB) tetap.
- Produksi (`curl` https://panel.malikkurosaki.com): Cloudflare menyajikan `content-encoding: br`; JS bernama hash
  mendapat `cache-control: max-age=14400` (TTL bawaan Cloudflare, bukan dari origin) dan `cf-cache-status: MISS` pada
  permintaan pertama. **Origin tidak mengirim `Cache-Control`** untuk aset ber-hash (hanya `ETag`), dan tidak
  mengompresi (ok karena CF). Setiap 4 jam browser memvalidasi ulang 720 KB.
- Polling: `useApiQuery` interval tetap (`PANEL_REFRESH_MS = 10_000`, `panel/panel.api.ts:24`) **tanpa jeda saat tab
  tersembunyi** (tidak ada `visibilityState` di `src/web`). Di HP-server, tab panel yang terbuka di HP lain tetap
  menembak `/api/panel/overview` tiap 10 dtk.

---

## 3. Standar industri

Mengacu `docs/research/ui-benchmark.md` (§1, §3, §9, §11) ditambah pengamatan berikut (sumber publik, tidak login):

| Pola                                                                           | Produk & tempat                                                                          | Relevansi                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| Sidebar bergrup + collapse ke rail ikon, user menu di footer                   | Coolify (galeri screenshot coolify.io), shadcn `sidebar-07`                              | Sudah ada; tinggal badge masalah     |
| Navigasi mobile: bottom bar 4–5 tujuan berlabel + "Lainnya"                    | Benchmark §1 P1; pola umum aplikasi native (Material navigation bar, iOS tab bar)        | Belum ada                            |
| Header detail = breadcrumb + status pill + aksi utama                          | Coolify (resource header), Vercel project overview                                       | `PageHeader` belum punya slot status |
| Judul halaman selalu terlihat di mobile                                        | shadcn dashboard-01 mobile (`SiteHeader` dengan judul di bar atas), Railway mobile web   | Hilang di kita                       |
| Empty state ikon + kalimat + 1 CTA                                             | Coolify "Choose a resource", benchmark §9                                                | Komponen ada, tak dipakai            |
| Konfirmasi 3 tingkat (tanpa / dialog / ketik nama)                             | Vercel (Delete/Pause Project "type the project name"), GitHub (hapus repo), benchmark §9 | Hanya 1 tingkat                      |
| Toast singkat, error penting juga inline                                       | sonner docs; benchmark §9                                                                | Toast saja                           |
| Waktu relatif + absolut di hover                                               | Render logs, Coolify deploy list ("21 seconds ago"), GitHub `relative-time`              | Komponen ada, tak dipakai            |
| Skeleton berbentuk konten, refetch tanpa mengosongkan                          | benchmark §9; `useApiQuery` sudah mempertahankan data                                    | Sebagian                             |
| Route change mengumumkan judul + fokus ke h1                                   | GOV.UK Design System & Gatsby/Next.js route announcer (`aria-live` judul halaman)        | Tidak ada                            |
| Lazy route + `vendor` terpisah, `Cache-Control: immutable` untuk aset ber-hash | React Router docs (`lazy` route property), Vite/Next default untuk `/assets/*-[hash]`    | Tidak ada                            |

---

## 4. Kebutuhan produksi

- **Aksesibilitas (WCAG 2.2 AA)**: satu `<h1>` per halaman (1.3.1/2.4.6); judul tab unik (2.4.2) — ada; perubahan route
  diumumkan dan fokus dipindah (2.4.3, 4.1.3); status tidak hanya warna (1.4.1); kontras teks ≥ 4.5:1 di kedua tema,
  termasuk warna mentah yang tersisa dan tombol destructive dark (1.4.3); target ≥ 24 px wajib (2.5.8), ≥ 44 px untuk
  kontrol utama di HP sebagai target produk; semua tombol ikon ber-`aria-label` bahasa Indonesia; dialog menjebak fokus
  dan mengembalikannya (radix sudah).
- **Mobile 360–430 px**: tanpa scroll horizontal halaman (terverifikasi `scrollWidth = 390`), judul + lokasi selalu
  terlihat, navigasi utama 1 ketukan, aksi utama tidak terpotong/wrap ke baris ke-3, safe-area bila dibuka sebagai PWA.
- **Konsistensi konten**: semua teks dari `i18n` dan patuh glosarium; satu kamus status; format waktu/byte satu sumber.
- **Reliabilitas UI**: error penting tidak hanya di toast; toaster tidak hilang saat pindah area; empty/error/loading
  eksklusif dan spesifik; error boundary bisa membedakan "versi baru tersedia" (chunk 404) dari bug.
- **Performa di HP**: muatan awal JS ≤ ~200 KB gzip untuk route panel (target realistis dengan vendor sekarang ±190 KB),
  landing tidak memuat kode panel, aset ber-hash `immutable`, polling dijeda saat tab tersembunyi (hemat baterai HP-server
  dan HP klien), satu timer global untuk waktu relatif.
- **Observability**: route error dan chunk-load error tercatat (console sekarang; `/api/dev/logs` hanya log server).
  Tidak perlu telemetri pihak ketiga.
- **Keamanan**: tidak ada data sensitif baru; CSP sekarang (`script-src 'self' + hash`) kompatibel dengan lazy chunk
  karena same-origin.

---

## 5. Kesenjangan (gap list)

| #   | Gap                                                                                                                                         | Sev                                                 | Kenapa                                                                                          | Bukti                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| G1  | 12/16 halaman tanpa `<h1>`; di mobile tak ada judul maupun breadcrumb                                                                       | **P0**                                              | Pengguna HP tidak tahu sedang di mana; pembaca layar tanpa heading utama                        | §2.4 tabel, `app.layout.tsx:66`                                                                                  |
| G2  | Komponen wave A (PageHeader, DataTable, StatTile, EmptyState, ErrorState, skeletons, RelativeTime…) hampir tak dipakai; 20 `QueryView` lama | **P0**                                              | Redesign belum terlihat; dua sistem desain paralel                                              | §2.6, §2.9                                                                                                       |
| G3  | Dua tabel tone status yang bertentangan + label status tidak satu kamus; mati sengaja vs tak sengaja hanya dibedakan warna                  | **P0**                                              | Inkonsistensi makna warna antar halaman; gagal 1.4.1                                            | `status.tone.ts` vs `panel.status.ts`, `job.state.ts`, `deploy.state.ts`, `backup.state.ts`; `id.panel.ts:44-56` |
| G4  | Empty state generik "Belum ada yang bisa ditampilkan di sini." di semua list                                                                | **P0**                                              | Melanggar content guide; tidak memberi aksi pertama; string spesifik sudah ada tapi tak dipakai | `query.state.tsx:22`, screenshot `/panel/sites`                                                                  |
| G5  | Teks statis "Diperbarui otomatis tiap N detik"                                                                                              | P1                                                  | Dilarang content guide; `PageHeader.meta` sudah siap                                            | `id.panel.ts:24`, `id.dev.ts:33`                                                                                 |
| G6  | Mobile nav hanya hamburger; sheet tidak tertutup saat navigasi lewat user menu                                                              | **P0** (bug sheet) / P1 (bottom bar)                | Bug terlihat; benchmark §1 P1                                                                   | `mobile.bar.tsx:46`, `user.menu.tsx:70-75`                                                                       |
| G7  | Breadcrumb membuat tautan ke route yang tidak ada (`/panel/services/sshd`) dan UUID mentah untuk job                                        | P1                                                  | Klik → 404; crumb tidak bermakna                                                                | `nav.items.ts:98-102`                                                                                            |
| G8  | Konfirmasi satu tingkat: Mulai minta konfirmasi, hapus situs/pengguna tanpa ketik nama, tombol "Hapus" generik                              | **P0** (hapus situs tanpa ketik nama = data hilang) | Benchmark §9 tier; guide "tombol mengulang kata kerja"                                          | `control.buttons.tsx:50`, `site.delete.tsx`, `confirm.dialog.tsx:70`                                             |
| G9  | Toaster ganda per layout, hilang saat pindah area, tidak ada di /profile; `richColors` bukan token; top-center menutupi bar                 | P1                                                  | Pesan hasil aksi bisa hilang                                                                    | `panel.layout.tsx:10`, `dev.layout.tsx:9`                                                                        |
| G10 | Tidak ada manajemen fokus/pengumuman route change                                                                                           | P1                                                  | WCAG 2.4.3 / 4.1.3 untuk SPA                                                                    | `app.layout.tsx:44-46` hanya `document.title`                                                                    |
| G11 | Target sentuh 24–36 px di kontrol utama mobile                                                                                              | P1                                                  | Salah ketuk Hentikan vs Mulai ulang di HP                                                       | `button.tsx:21-28`, screenshot services                                                                          |
| G12 | Warna Tailwind mentah (9 tempat), sebagian tanpa varian dark; Progress status berwarna brand                                                | P1                                                  | Kontras dark tak terjamin; brand dipakai untuk status                                           | §2.3                                                                                                             |
| G13 | Format menyimpang dari guide: "baru saja" < 10 dtk, GB tanpa desimal tetap, memori MB mentah, waktu absolut di daftar                       | P1                                                  | Satu sumber format adalah kontrak guide                                                         | §2.7                                                                                                             |
| G14 | Bundle 1 chunk 723 KB (230 KB gz), tanpa lazy route; aset hash tanpa `Cache-Control: immutable`                                             | P1                                                  | Muatan awal landing = seluruh panel; revalidasi tiap 4 jam                                      | §2.10                                                                                                            |
| G15 | Polling tidak dijeda saat tab tersembunyi; 1 interval per `RelativeTime`                                                                    | P1                                                  | Baterai HP server & klien                                                                       | `use-api-query.ts:34-38`, `relative-time.tsx:21`                                                                 |
| G16 | README/CHANGELOG bilang URL tak dikenal → landing, kode → /login                                                                            | P1                                                  | Docs tidak sinkron (Rule 16) atau perilaku salah                                                | `session.redirect.ts:16`, README "Layar dan peran"                                                               |
| G17 | Login: tanpa h1, tanpa brand, tanpa tautan ke landing, satu pesan untuk semua `?error=`                                                     | P1                                                  | Halaman pertama yang dilihat semua pengguna                                                     | `login.page.tsx`, `login.error.ts`                                                                               |
| G18 | Judul tab landing tertinggal "Masuk ke Panel Termux" setelah navigasi SPA dari /login                                                       | P2                                                  | Kosmetik, tapi mudah                                                                            | `login.page.tsx:16`, landing tak set title                                                                       |
| G19 | Header tanpa slot status/aksi (`PageHeader` tanpa `status`), tidak sticky di detail                                                         | P1                                                  | Benchmark §0.2/§4                                                                               | `page-header.tsx`                                                                                                |
| G20 | Skala tipografi tidak ditegakkan (h1 `text-lg` vs `text-xl/2xl`, h2 sebagai judul)                                                          | P2                                                  | Konsistensi visual                                                                              | §2.3                                                                                                             |
| G21 | `DataTable` tanpa slot aksi baris/"⋯", tanpa baris-link, tanpa sort, tanpa search bawaan                                                    | P1                                                  | Prasyarat migrasi list (benchmark §3 P1)                                                        | `data-table.tsx`                                                                                                 |
| G22 | `Pager` lintas domain di `dev/`, duplikat `PaginationFooter`; `<nav>` tanpa label                                                           | P2                                                  | Struktur & a11y                                                                                 | `dev/pager.tsx`                                                                                                  |
| G23 | String Inggris di primitive (`Close`, `Breadcrumb`)                                                                                         | P2                                                  | Pembaca layar membaca campur bahasa                                                             | `dialog.tsx:63,98`, `sheet.tsx:68`, `id.shell.ts:30`                                                             |
| G24 | Route error: "Kembali" = `navigate(-1)` bisa keluar app; tidak mengenali chunk-load error                                                   | P2 (P1 bila G14 dikerjakan)                         | Setelah deploy, tab lama gagal memuat chunk baru                                                | `route-error.page.tsx:30`                                                                                        |
| G25 | Session fallback tidak berbentuk shell; SessionError selalu ikon "offline"                                                                  | P2                                                  | Layout shift, pesan kurang tepat untuk 5xx                                                      | `session.fallback.tsx`, `session.error.tsx:14`                                                                   |
| G26 | Badge masalah di item nav (Layanan/Cadangan)                                                                                                | P2                                                  | Benchmark §1 P1, butuh data problems dari API overview                                          | `nav.items.ts`                                                                                                   |
| G27 | Tombol destructive dark (`/60` + putih) belum diukur kontrasnya                                                                             | P2                                                  | Klaim AA di `styles.css` hanya light                                                            | `button.tsx:13`                                                                                                  |

---

## 6. Opsi & trade-off

### G2 — Strategi migrasi ke komponen baru

- **A. Big-bang satu gelombang**: semua halaman dimigrasi bersamaan, lalu hapus `query.state`, `stat.card`, adapter.
  Cepat selesai, tapi bentrok file dengan worker domain lain (Ringkasan, situs, admin).
- **B. Per domain, komponen bersama dulu**: (1) lengkapi API bersama (G19, G21, `QueryView` baru yang memakai
  `ErrorState`/`EmptyState`/`RowsSkeleton` dengan `empty` wajib), (2) tiap worker domain memigrasi halamannya, (3) satu
  langkah akhir hapus kode lama + lint rule larangan import `shared/query.state`.
- **C. Adaptor**: ubah `QueryView` lama agar merender komponen baru → visual langsung seragam tanpa menyentuh halaman.
  Murah, tapi empty state tetap generik kecuali tiap pemanggil menambah props.
- **Rekomendasi: B, dengan C sebagai langkah 1** (ganti isi `QueryView` ke komponen baru + jadikan `empty` prop wajib —
  compiler memaksa tiap halaman memberi teks spesifik). Kepemilikan file per worker jelas.

### G3 — Satu kamus status

- **A.** Pertahankan `toneForStatus` string-global (`status.tone.ts`) dan buang tabel per domain. Masalah: string sama
  beda makna (`down` service vs app, `running` job vs app).
- **B.** Satu modul `status.vocab.ts` per **jenis resource** → `{ label, tone, pulse }` (service, app, domain, job,
  deploy, backup run), memakai label dari satu tabel i18n "kamus status". `StatusBadge` menerima `{label,tone}` hasilnya.
- **Rekomendasi: B.** Menghapus `LEGACY_TONE`, adapter `panel/status.badge.tsx`, dan tabel tone di 4 file `*.state.ts`.
  Kamus label mengikuti benchmark §11: Berjalan / Dihentikan / Gagal / Memulai… / Diproses… / Sehat / Tidak sehat /
  Tidak diketahui; `down + wantUp` → "Mati tak terduga" (teks berbeda, bukan hanya warna).

### G6 — Navigasi mobile

- **A. Bottom bar 4 + "Lainnya"** (Ringkasan, Situs, Layanan, Aplikasi, Lainnya→sheet). Sesuai benchmark; menambah
  ±56 px + safe area di bawah; peran `user` hanya punya Profil (bar disembunyikan).
- **B. Tetap hamburger + judul halaman di top bar + tombol kembali di detail.** Minim perubahan, tetap 2 ketukan per
  pindah halaman.
- **Rekomendasi: A untuk admin/super admin, B (judul di top bar) wajib di semua peran.** Isi bar untuk super admin perlu
  diputuskan (lihat §7 Q1). Bug sheet (tutup saat `pathname` berubah) dikerjakan apa pun opsinya.

### G8 — Tier konfirmasi

- Satu komponen `ConfirmAction` dengan `tier: "none" | "confirm" | "typed"`; `typed` menampilkan input "Ketik `blog`
  untuk konfirmasi", tombol aktif bila cocok (case-sensitive, trim). Pemetaan: none = Mulai, salin, lihat; confirm =
  Hentikan, Mulai ulang, Rollback, ubah peran, cabut sesi, hapus domain; typed = hapus situs, hapus pengguna,
  pulihkan/restore. Label tombol = kata kerja + objek ("Hapus situs blog").
- Alternatif "undo toast" (aksi langsung, bisa dibatalkan 5 dtk) — tidak cocok: hapus situs menjalankan job sistem
  (pm2, cloudflared, DNS) yang tidak bisa ditunda murah di backend sekarang. **Rekomendasi: tier.**

### G14 — Code splitting & cache

- **A. `lazy` per area** (landing, login, `/panel/*` site+deploy, `/dev/*`) memakai properti `lazy` React Router +
  `Bun.build({ splitting: true })`. Perlu verifikasi bahwa HTML import Bun (`import spa from "../web/index.html"`) di
  `--compile` mendukung splitting dan menyematkan chunk tambahan (Rule 20: cek docs Bun versi terpasang sebelum PLAN).
- **B. Hanya `Cache-Control: public, max-age=31536000, immutable` untuk `/chunk-*`** + `no-cache` untuk HTML. Murah,
  tanpa risiko chunk-hilang-setelah-deploy.
- **C. A + B + penanganan chunk error** (route error mengenali `TypeError: Failed to fetch dynamically imported module`
  → "Versi panel baru tersedia. Muat ulang.").
- **Rekomendasi: B sekarang (P1), C setelah verifikasi Bun.** Penghematan A hanya ±20–25 KB gzip karena vendor
  dominan; nilai terbesar justru landing yang tidak memuat panel. Jangan ganti router/React.

### G9 — Toast

- Satu `<Toaster>` di `SessionGate`/root (mencakup landing, profile, panel, dev), `position="bottom-center"` di mobile
  dengan offset safe-area (tidak menutupi judul), `top-right` desktop; tanpa `richColors`, pakai token via CSS var
  sonner. Error aksi yang penting juga ditulis inline di baris resource (mis. "Gagal dihentikan · Lihat log").
  Tidak ada opsi lain yang layak.

### G15 — Polling & timer

- `useApiQuery`: lewati tick saat `document.visibilityState === "hidden"` dan `reload()` segera saat kembali terlihat.
- `RelativeTime`: satu `useSyncExternalStore` "now" global yang berdetak 15 dtk (hanya bila ada subscriber).
- Keduanya < 20 baris, tanpa dependensi.

---

## 7. Risiko & pertanyaan terbuka

**Risiko untuk PLAN**

1. **Bentrok kepemilikan file**: halaman di §2.9 juga milik worker domain (Ringkasan, situs/deploy, cadangan, admin).
   PLAN harus menetapkan: worker shell memegang `components/*`, `layout/*`, `shared/format.ts`, `status.vocab`,
   `i18n/id.shell.ts`/`id.common.ts`; worker domain memigrasi halamannya memakai API itu. Gelombang 1 = komponen bersama,
   gelombang 2 = halaman.
2. **Mengubah tone `running` dari warning ke info** mengubah makna visual job/deploy/backup yang sedang berjalan;
   test `tests/web.*.test.ts` yang mengecek tone lama perlu diperbarui.
3. **Format byte "64,0 GB"** mengubah semua angka yang tampil; test `web.shell.test.ts` ikut berubah.
4. **Code splitting dengan `bun build --compile`** belum terbukti di repo ini; bila tidak didukung, fallback ke opsi B
   saja (cache header).
5. **Konfirmasi ketik nama** menambah friksi; batasi hanya ke aksi tak bisa dibatalkan.
6. Perilaku tamu di URL tak dikenal (G16): memilih "landing" berarti mengubah `resolveRedirect`; memilih "/login"
   berarti memperbaiki README + CHANGELOG. Keduanya kecil, tapi harus satu keputusan.

**Pertanyaan untuk owner** (hanya yang benar-benar keputusan)

- **Q1.** Bottom bar mobile: isi 4 tujuan untuk admin = Ringkasan · Situs · Layanan · Aplikasi (+ Lainnya). Untuk
  super admin, apakah "Kesehatan sistem" menggantikan salah satunya, atau tetap di "Lainnya"?
- **Q2.** Tamu yang membuka alamat tak dikenal: diarahkan ke **landing** (sesuai README/CHANGELOG) atau ke **/login**
  (perilaku kode sekarang)?
- **Q3.** Target sentuh: setuju standar produk **44 px** untuk kontrol utama di < md (tombol aksi, item nav, baris
  list), dengan desktop tetap padat 32–36 px?
