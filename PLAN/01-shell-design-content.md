# PLAN 01 — App shell, design system, komponen bersama, konten & aksesibilitas

> wkr-plan-shell-01 · 2026-11-26 · branch `feature/production-polish` (HEAD 74fe380). Dokumen rencana; tidak ada kode
> produksi diubah. Menutup gap `R&D/01-shell-design-content.md` (disingkat **R1-Gn**) dan menetapkan **kontrak lintas
> PLAN** yang dipakai PLAN-02 (monitoring), PLAN-03 (situs/deploy), PLAN-04 (keamanan/cadangan), PLAN-05
> (admin/onboarding/landing).
>
> **Revisi 1 (debat)**: semua temuan `PLAN/debate/01-critique.md` C1–C25 dijawab di `PLAN/debate/01-response.md`
> (19 terima, 6 terima sebagian, 0 tolak), diselaraskan dengan `PLAN/debate/00-integration-critique.md`. Ringkasan di
> §9 "Riwayat revisi". Bagian yang berubah besar: §2, §3.1, §3.2, §3.4, §3.5, §3.11, §3.12, §3.15 (baru), §5.2b (baru),
> §7.
>
> **Revisi 2 (keputusan final)**: diselaraskan dengan `PLAN/DECISIONS.md` (mengikat): A7, A8, A10, A11, B11–B13,
> B19, B20. Lihat §9.
>
> Bukti baru di sesi ini (bukan dari R&D):
> - **Code splitting terbukti jalan** di Bun 1.4.2 `--compile` + HTML import: probe
>   (`scratchpad/split-probe`) dengan `Bun.build({ compile, splitting: true })` dan `import()` dinamis menghasilkan chunk
>   kedua yang dilayani bundle di `/chunk-<hash8>.js` (root, sama dengan aset lama). Header aset: hanya `ETag`, **tanpa
>   `Cache-Control`**. Belum diuji untuk target `bun-linux-arm64-android` (lihat Risiko R2).
> - Aset bundle sekarang: `/chunk-*.js`, `/chunk-*.css`, `/favicon-<hash8>.svg` (`strings dist/panel`).
> - **Kontras tombol destructive di tema gelap = 5,99:1** (putih di atas `danger/60` dikomposit ke `--background`
>   gelap, dihitung dari nilai oklch `styles.css`) → lolos AA. R1-G27 ditutup tanpa perubahan warna.
> - `react-router@8.5.3` mendukung properti route `lazy`; `sonner@2.0.8` mendukung `mobileOffset`,
>   `containerAriaLabel`, `closeButtonAriaLabel` (dicek di `node_modules/*/dist/index.d.ts`). Default
>   `containerAriaLabel` sonner berbahasa Inggris ("Notifications").

---

## 1. Tujuan & ruang lingkup

**Tujuan**: satu sistem desain yang dipakai semua halaman, dengan kontrak yang cukup tepat sehingga PLAN domain bisa
memigrasi halamannya tanpa menebak, dan kritikus bisa menyerang klaim konkret.

### Masuk ruang lingkup

| Area                                                                                                                                                                                                                                         | Menutup                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Kamus status tunggal + tabel tone/ikon (§3.1)                                                                                                                                                                                                | R1-G3, sebagian R1-G12        |
| Tier konfirmasi + `ConfirmAction` baru (§3.2)                                                                                                                                                                                                | R1-G8                         |
| API komponen bersama: `PageHeader`, `DataTable`, `StatTile`, `StatusBadge`, `StatusIcon`, `EmptyState`, `ErrorState`, `QueryView`, `SearchField`, `RelativeTime`, `CopyButton`, `usePageParam`, `ActionBar`, rekonsiliasi nama (§3.3, §3.15) | R1-G2, G4, G19, G20, G21, G22 |
| `LogViewer` bersama (monitoring, situs/deploy, admin) + tipe `LogLine` + `LogChunk` + `useLogFollow` + parser `svlogd -tt` (§3.4)                                                                                                            | prasyarat R2-gap 9/17         |
| Primitif polling `usePoller` + `useApiQuery` (§3.5)                                                                                                                                                                                          | R1-G15, R2-gap 4              |
| Toast: satu `Toaster` (§3.6)                                                                                                                                                                                                                 | R1-G9                         |
| Navigasi mobile, judul mobile, breadcrumb, judul tab, fokus & pengumuman route (§3.7, §4)                                                                                                                                                    | R1-G1, G6, G7, G10, G18       |
| Target sentuh (§3.8), token & tipografi (§3.9), format angka/waktu (§3.10), string Inggris primitive                                                                                                                                         | R1-G11, G12, G13, G20, G23    |
| Code splitting + penanganan chunk gagal (§3.11)                                                                                                                                                                                              | R1-G14 (klien), G24           |
| Kontrak header cache HTML (server; implementasi `wkr-http-01`) (§3.12)                                                                                                                                                                       | R1-G14 (server)               |
| Tamu di URL tak dikenal, session fallback/error (§3.13)                                                                                                                                                                                      | R1-G16, G25                   |
| Matriks kepemilikan lintas PLAN, worker shell paralel W1/W2, migrasi halaman W3 (PLAN lain), pembersihan W4 (§7)                                                                                                                             | R1-G2 strategi B+C            |

### Di luar ruang lingkup (dan siapa yang memegang)

- Isi halaman domain (Ringkasan, Layanan, Aplikasi, Domain, Database, log layanan/aplikasi) → **PLAN-02**; situs,
  wizard, perubahan, deploy → **PLAN-03**; cadangan, header keamanan server → **PLAN-04**; `/dev/*`, login, profil,
  landing → **PLAN-05**. PLAN ini hanya menetapkan komponen & aturan yang harus mereka pakai.
- **R1-G17 (login)**: dieksekusi PLAN-05; syarat shell untuk login ada di §5.6.
- **R1-G26 (badge masalah di item nav)**: shell hanya menyediakan slot `NavItem.badge` + `NavBadgeProvider` (§3.7,
  nol logika, tanpa polling). Datanya diisi PLAN-02 dari `GET /api/panel/status` di gelombang halaman.
- Endpoint log (`?after=` cursor, unduh, redaksi) → PLAN-02/05. PLAN ini memegang komponen, `useLogFollow`, parser
  `svlogd -tt`, dan bentuk tipe (`log.types.ts` ditulis `wkr-contracts-00`).
- Tidak dibuat (YAGNI, dicatat supaya kritikus tidak menganggapnya terlupa): command palette, header lengket (desktop
  dan HP), chip jangkar lengket di HP, kolom tabel yang bisa di-sort, virtualisasi log (batas 2.000 baris cukup),
  pencarian log regex, pewarnaan ANSI, PWA/manifest, telemetri, parser TAI64N/ISO (semua `log/run` di POCO memakai
  `svlogd -tt`), split per area (cukup 3 chunk), cara implementasi header aset (milik `wkr-http-01`, PLAN-04 r2).
- Masuk v0.3.0 (A8, tidak ada penundaan): pemisah tanggal di log (aturan benchmark §11 "tanggal hanya saat berganti
  hari"; log pm2/svlogd melewati tengah malam), potong tampilan baris > 4.000 karakter (perlindungan performa HP;
  Salin/Unduh tetap utuh), `Cache-Control: immutable` untuk aset ber-hash + 404 untuk chunk yang tidak ada (B11,
  dikerjakan `wkr-http-01`). Dialog layar penuh log **tidak dibuat**: tidak melayani fitur yang direncanakan, karena
  halaman log `size="page"` sudah mengisi layar HP.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                                                                                                               | Alternatif                                                                                                               | Alasan                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Status = kunci kanonik** (`StatusKey`, 28 kunci) → `{label, tone, pulse, icon, help?}` dari satu tabel milik shell (`components/status.vocab.ts` + `i18n/id.status.ts`). **Pemetaan state mentah → kunci ada di file domain milik PLAN pemilik union** (`*.status-key.ts`, `satisfies Record<Union, StatusKey>`).                                     | (a) tabel string global `toneForStatus` (sekarang); (b) label/tone per domain (lama); (c) mapping di file shell (rev. 0) | Kunci kanonik membuat tone tidak bisa dikarang di domain. Mapping di file domain berarti PLAN yang mengubah union (mis. `interrupted` PLAN-03) memperbarui mapping-nya di gelombang yang sama tanpa menyentuh file shell yang beku (C1). |
| D2  | Mati **disengaja** = "Dihentikan" (netral); mati **tak disengaja** = "Mati" (danger). Teks berbeda, bukan hanya warna.                                                                                                                                                                                                                                  | Satu label "Mati" dengan dua warna (sekarang)                                                                            | WCAG 1.4.1; benchmark §11.                                                                                                                                                                                                               |
| D3  | `running` job/deploy/cadangan = **"Diproses…" tone info** + denyut. Step yang di-undo = "Dibatalkan" (warning). Job/deploy `rolled_back` = **"Dikembalikan" tone warning** + help "Perubahan gagal; versi lama dipulihkan." (A10). `interrupted` = **"Terputus" tone warning** (B12). Danger disimpan untuk `failed` dan kegagalan yang butuh tindakan. | "Gagal, dibatalkan"/danger (rev. 0–1)                                                                                    | Keputusan owner A10 dan arbitrase B12: warna mengikuti "perlu tindakan atau tidak" (benchmark §11). Label pendek muat di badge 360 px dan tidak mirip `undone`.                                                                          |
| D4  | Tiga tier konfirmasi: **tanpa** / **AlertDialog** / **ketik nama**. Error aksi yang dikonfirmasi tampil **di dalam dialog** (dialog tetap terbuka), bukan hanya toast.                                                                                                                                                                                  | Undo-toast                                                                                                               | Hapus situs menjalankan job sistem (pm2, cloudflared, DNS) yang tidak bisa ditunda murah. Error penting tidak boleh hilang dalam 4 dtk (benchmark §9).                                                                                   |
| D5  | **Navigasi mobile: bottom bar** 4 tujuan (Ringkasan, Situs, Layanan, Aplikasi) + "Lainnya" (sheet bawah) untuk peran yang punya `/panel`. Peran `user` tanpa bottom bar. **Beranda super_admin = `/panel` (Ringkasan) di semua ukuran layar** (A11, B19); `/dev` tetap di nav (Administrasi urutan pertama sheet).                                      | (a) hamburger + judul; (b) slot 4 super_admin = "Kesehatan"                                                              | Halaman harian 1 ketukan; pemilik mendarat di slot 1. Diputuskan owner.                                                                                                                                                                  |
| D6  | **Judul halaman di mobile = top bar** (48 px, sticky) yang menampilkan judul dari `PageHeader` + tombol kembali di detail. `<h1>` tetap ada di DOM tetapi `sr-only` di < md (tidak dobel di layar).                                                                                                                                                     | h1 terlihat + judul di bar (dobel); iOS large-title collapse                                                             | Satu sumber judul (`PageHeader`), selalu terlihat, tanpa kode IntersectionObserver.                                                                                                                                                      |
| D7  | **Pengumuman route = fokus ke `<h1>`** setelah pathname berubah (bukan pada load pertama, bukan saat hanya query/hash berubah). Tidak ada live region terpisah.                                                                                                                                                                                         | live region + fokus (dobel dibaca); live region saja                                                                     | Pembaca layar membacakan heading yang difokus; live region tambahan membuat judul dibaca dua kali. Pola GOV.UK.                                                                                                                          |
| D8  | Target sentuh **≥ 44 px pada `pointer: coarse`** lewat varian bawaan Tailwind 4 **`pointer-coarse:`**; desktop tetap padat (32–36 px). Tombol ikon kecil dalam teks memakai hit-area pseudo-element, tampilan tetap 24 px.                                                                                                                              | Berdasar lebar layar (`max-md:`); `@custom-variant` sendiri (rev. 0)                                                     | Yang menentukan jari, bukan lebar. `pointer-coarse` sudah ada di tailwindcss 4.3.5 (C18).                                                                                                                                                |
| D9  | **Polling**: rantai `setTimeout` (bukan `setInterval`), single-flight (tick dilewati saat request jalan, tidak di-abort), jeda saat tab tersembunyi, langsung ambil saat kembali terlihat bila basi, backoff ×2 maks 60 dtk.                                                                                                                            | SSE/WebSocket                                                                                                            | R2 §6.2 opsi B; push dari server di belakang tunnel + HP tidur rawan putus. Abort request lambat membuat overview tak pernah selesai (R2-gap 4).                                                                                         |
| D10 | **Satu `Toaster`** di elemen root (`SessionGate`), `bottom-right` desktop, bawah selebar layar di HP di atas bottom bar; tanpa `richColors`; error toast 8 dtk + tombol tutup.                                                                                                                                                                          | top-center (sekarang)                                                                                                    | Toast tidak hilang saat pindah area, ada di landing/login/profil, tidak menutupi judul.                                                                                                                                                  |
| D11 | **Tiga chunk**: entry (router, `SessionGate`, landing), `login` (lazy, membawa better-auth), `app` (satu lazy `AppLayout` + semua halaman diimpor statis lewat `app.routes.tsx`). Pecah lagi hanya bila `app` > 250 KB gzip.                                                                                                                            | per area 6 chunk (rev. 0); per halaman; tanpa split                                                                      | Nilai utama: landing tidak memuat panel. Pemilik memuat semua area, jadi split per area hanya menambah RTT lewat tunnel (C11). Terverifikasi jalan di Bun 1.4.2.                                                                         |
| D12 | **Chunk gagal dimuat** → muat ulang otomatis **sekali** (guard 30 dtk di `sessionStorage`), lalu pesan "Bagian panel ini gagal dimuat" + tombol.                                                                                                                                                                                                        | Pesan saja                                                                                                               | Setelah deploy panel, tab lama yang belum menyimpan chunk area baru pasti gagal; reload sekali hampir selalu menyelesaikannya. Guard mencegah loop (pola sama dengan reload Access).                                                     |
| D13 | **Header** (kontrak, implementasi `wkr-http-01`, B11): semua HTML SPA (200 dan 404) `Cache-Control: no-cache`; aset ber-hash `public, max-age=31536000, immutable`; path aset ber-hash yang tidak ada → 404 (bukan HTML SPA); `/__spa` tidak terjangkau dari luar. Klien tetap memuat ulang sekali saat chunk gagal (D12).                              | ETag saja (rev. 1); server kedua (rev. 0, cara implementasi diserahkan ke PLAN-04 r2)                                    | B11/A8: masuk v0.3.0. Nama aset berbasis isi → aman di-cache selamanya; HTML harus selalu divalidasi agar reload F6 mendapat chunk baru; 404 membuat kegagalan chunk eksplisit.                                                          |
| D14 | **Tamu di URL tak dikenal → halaman 404 publik** (dengan "Ke beranda" dan "Masuk"); tamu di area terlindungi (`/panel*`, `/dev*`, `/profile*`) → `/login` seperti sekarang. Override R&D: README + CHANGELOG ikut diubah.                                                                                                                               | (a) landing (kata README); (b) `/login` (kode sekarang)                                                                  | Owner: `/` adalah halaman produk untuk orang luar; mendorong orang asing ke login bertentangan dengan itu. Mengalihkan diam-diam ke landing menyembunyikan typo URL. **Flag**: mengubah kontrak yang tertulis di README §Layar.          |
| D15 | **`QueryView` baru** di `components/query-view.tsx` dengan prop `empty` **wajib**; lima state eksklusif (memuat / gagal pertama / data + gagal perbarui / kosong / isi). `QueryView` lama tetap ada sampai gelombang 3, isinya diganti ke komponen baru.                                                                                                | Ubah signature lama langsung (memecah 20 pemanggil di file milik PLAN lain)                                              | Strategi B+C R1: visual seragam segera, teks kosong spesifik dipaksa compiler saat tiap halaman pindah.                                                                                                                                  |
| D16 | Format: relatif < 60 dtk = "baru saja"; GB/TB **selalu** 1 desimal ("232,0 GB"); jam log "21.54.07" (titik, sesuai guide). Contoh "Diperbarui 12 dtk lalu" di content guide diganti "Diperbarui 3 mnt lalu".                                                                                                                                            | Pertahankan "< 10 dtk"                                                                                                   | Content guide bertentangan dengan dirinya sendiri; aturan tabel ("di bawah 1 menit baru saja") dipilih karena lebih tenang untuk halaman yang di-poll tiap 10 dtk. Hitungan detik ("12 dtk lalu") sengaja tidak pernah tampil.           |
| D17 | Parsing timestamp log **hanya `svlogd -tt`**, di modul bersama `src/shared/log.time.ts` (shell core), dipanggil server PLAN-02/03. Klien hanya memformat `at` ke jam lokal.                                                                                                                                                                             | TAI64N + ISO (rev. 0); parser di PLAN-02 `log.parse.ts`                                                                  | Semua `log/run` di POCO memakai `-tt` (C13). Satu parser untuk dua PLAN pembaca log (X9).                                                                                                                                                |
| D18 | Destructive dark tetap `dark:bg-destructive/60` + putih (5,99:1 terukur).                                                                                                                                                                                                                                                                               | Ganti ke `bg-danger` + tinta gelap (7,27:1)                                                                              | Sudah lolos AA; perubahan visual tanpa alasan. Komentar rasio ditambahkan di `styles.css`.                                                                                                                                               |
| D19 | 403 dari API → **`/login`** (full load), yang lalu mengalihkan ke `homeFor(role)` dengan peran baru.                                                                                                                                                                                                                                                    | `"/"` (sekarang)                                                                                                         | `/` adalah landing publik dan `resolveRedirect` tidak mengalihkannya (`api.client.ts:57-61`, `session.redirect.ts:15`), jadi admin yang diturunkan terdampar di landing (C6).                                                            |
| D20 | **Rute tugas** (`handle: { task: true }` atau `useTaskMode(true)`) menyembunyikan bottom nav. Bar aksi bawah HP = satu komponen `ActionBar`. Elemen tetap di 360×640 ≤ 120 px.                                                                                                                                                                          | header/chip lengket per halaman                                                                                          | Top bar + chip + bar aksi + nav ≈ 210 px (±38% layar) bila dibiarkan (C8). Pola tab bar iOS/Android yang hilang di alur push.                                                                                                            |
| D21 | **Satu primitif polling `usePoller`**; `useApiQuery` dan `useLogFollow` (cursor di ref, bukan URL) dibangun di atasnya.                                                                                                                                                                                                                                 | `useApiQuery` dengan URL ber-cursor; hook follow per PLAN                                                                | URL berubah tiap poll mereset backoff (P8); hook terpisah per PLAN mengulang logika visibilitas/backoff (C5).                                                                                                                            |

---

## 3. Model data & kontrak API

Tidak ada tabel DB, migrasi, endpoint, atau settings key baru di PLAN ini (semuanya UI/kontrak klien). Satu-satunya
perubahan server adalah satu header HTML (§3.12), diimplementasikan `wkr-http-01`. Semua tipe di bawah adalah
**kontrak**; nama file adalah lokasi final. Nama props dan tipe di sini mengalahkan nama yang ditulis PLAN lain (§3.15).

### 3.1 Kamus status (D1–D3)

`src/web/components/status.vocab.ts` (baru, milik shell, beku setelah W1):

```ts
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "./status.tone";

/** Canonical display state; every badge/dot/icon in the panel is one of these. */
export type StatusKey =
  | "running" | "healthy" | "succeeded" | "done"
  | "stopped" | "pending" | "skipped" | "unchecked" | "not_deployed" | "unknown" | "auth_required"
  | "starting" | "restarting" | "attention" | "partial" | "undone" | "not_configured" | "unstable"
  | "down" | "errored" | "failed" | "unhealthy" | "rolled_back" | "crash_loop" | "interrupted"
  | "tunnel_down" | "key_mismatch"
  | "processing";

/** Resolved status for rendering. `label`/`help` come from `id.status` / `id.statusHelp`. */
export type StatusView = {
  key: StatusKey; label: string; help: string | null; tone: StatusTone; pulse: boolean; icon: LucideIcon;
};
export function statusView(key: StatusKey): StatusView;
export const PROBLEM_TONE: Record<ProblemSeverity, StatusTone>;   // warning → warning, danger → danger
export const LOG_LEVEL_TONE: Record<LogLevel, StatusTone>;        // debug/info neutral, warn warning, error danger
```

**Tabel kanonik** (label di `src/web/i18n/id.status.ts` `satisfies Record<StatusKey, string>`; `statusHelp` opsional
`Partial<Record<StatusKey, string>>` di file yang sama, ditampilkan sebagai teks bantuan di samping badge / di
`aria-describedby`):

| Kunci            | Label                | Tone    | Denyut | Ikon (`lucide-react`) | Arti                                                                                         |
| ---------------- | -------------------- | ------- | ------ | --------------------- | -------------------------------------------------------------------------------------------- |
| `running`        | Berjalan             | success | –      | `CircleCheckIcon`     | Proses hidup sesuai keinginan                                                                |
| `healthy`        | Sehat                | success | –      | `CircleCheckIcon`     | Domain menjawab 2xx/3xx                                                                      |
| `succeeded`      | Berhasil             | success | –      | `CircleCheckIcon`     | Perubahan/deploy/cadangan selesai baik                                                       |
| `done`           | Selesai              | success | –      | `CircleCheckIcon`     | Satu langkah perubahan selesai                                                               |
| `stopped`        | Dihentikan           | neutral | –      | `CircleMinusIcon`     | Mati **disengaja** (termasuk domain ke aplikasi yang dihentikan)                             |
| `pending`        | Menunggu             | neutral | –      | `CircleDashedIcon`    | Langkah belum mulai / cadangan belum pernah jalan                                            |
| `skipped`        | Dilewati             | neutral | –      | `CircleMinusIcon`     | Langkah tidak perlu                                                                          |
| `unchecked`      | Belum dicek          | neutral | –      | `CircleDashedIcon`    | Belum pernah diperiksa (label boleh ditimpa, mis. wildcard)                                  |
| `not_deployed`   | Belum di-deploy      | neutral | –      | `CircleDashedIcon`    | Situs tanpa proses pm2                                                                       |
| `unknown`        | Tidak diketahui      | neutral | –      | `CircleHelpIcon`      | Tidak bisa dibaca                                                                            |
| `auth_required`  | Butuh login          | neutral | –      | `LockKeyholeIcon`     | Domain menjawab 401/403 (mis. Cloudflare Access)                                             |
| `starting`       | Memulai…             | warning | ya     | `LoaderCircleIcon`    | pm2 `launching`                                                                              |
| `restarting`     | Memulai ulang…       | warning | ya     | `LoaderCircleIcon`    | runit `finish`                                                                               |
| `attention`      | Perlu dicek          | warning | –      | `TriangleAlertIcon`   | Anomali non-fatal (4xx lain)                                                                 |
| `partial`        | Sebagian gagal       | warning | –      | `TriangleAlertIcon`   | Cadangan `partial`                                                                           |
| `undone`         | Dibatalkan           | warning | –      | `Undo2Icon`           | Langkah berhasil di-undo                                                                     |
| `not_configured` | Belum diatur         | warning | –      | `TriangleAlertIcon`   | Cadangan belum dikonfigurasi                                                                 |
| `unstable`       | Tidak stabil         | warning | –      | `TriangleAlertIcon`   | Cek domain gagal sebagian (sebelum ambang down PLAN-02)                                      |
| `down`           | Mati                 | danger  | –      | `OctagonXIcon`        | Layanan mati padahal `wantUp`                                                                |
| `errored`        | Bermasalah           | danger  | –      | `OctagonXIcon`        | pm2 `errored` (glosarium)                                                                    |
| `failed`         | Gagal                | danger  | –      | `OctagonXIcon`        | Perubahan/langkah/deploy/cadangan gagal                                                      |
| `unhealthy`      | Tidak sehat          | danger  | –      | `OctagonXIcon`        | Domain 5xx atau tanpa jawaban                                                                |
| `rolled_back`    | Dikembalikan         | warning | –      | `Undo2Icon`           | Job/deploy gagal lalu versi lama dipulihkan. Help: "Perubahan gagal; versi lama dipulihkan." |
| `crash_loop`     | Mulai ulang berulang | danger  | –      | `RefreshCwOffIcon`    | Restart loop (deteksi PLAN-02)                                                               |
| `interrupted`    | Terputus             | warning | –      | `UnplugIcon`          | Job/deploy terputus restart panel (PLAN-03 D10)                                              |
| `tunnel_down`    | Tunnel terputus      | danger  | –      | `WifiOffIcon`         | Domain gagal karena cloudflared/tunnel (PLAN-02 verdict)                                     |
| `key_mismatch`   | Kunci tidak cocok    | danger  | –      | `KeyRoundIcon`        | Kunci data tidak cocok (PLAN-04)                                                             |
| `processing`     | Diproses…            | info    | ya     | `LoaderCircleIcon`    | Job/deploy/cadangan/pemulihan sedang berjalan                                                |

Tone `rolled_back` dan `interrupted` = warning (A10, B12): perubahan tidak menimbulkan kerusakan (dikembalikan) atau
menunggu tindakan "Bersihkan" yang dipandu (terputus); danger hanya untuk kegagalan nyata.

Tone `accent` tidak dipakai untuk status (hanya `RoleBadge` Super Admin). Oranye brand tidak pernah untuk status.

**Pemetaan mentah → kunci: milik PLAN pemilik union**, satu file per domain, wajib `satisfies Record<Union, StatusKey>`
(atau fungsi dengan `switch` exhaustive), dengan test "setiap nilai union terpetakan" di file test domain:

| File (pemilik)                                  | Union                                       | Pemetaan acuan (dari kode sekarang; pemilik boleh memperhalus dengan kunci kanonik)                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/web/panel/panel.status-key.ts` (PLAN-02)   | `Service`, `SiteAppStatus`, domain verdict  | `run`→running; `down`+`wantUp`→down; `down`+`!wantUp`→stopped; `finish`→restarting; `unknown`→unknown · `online`→running; `stopped`→stopped; `errored`→errored; `launching`→starting; `not_deployed`→not_deployed · domain: belum dicek→unchecked; 2xx/3xx→healthy; 401/403→auth_required; 4xx lain→attention; ≥500/tanpa jawaban→unhealthy; verdict PLAN-02 → `unstable`/`tunnel_down`/`stopped` |
| `src/web/site/job.status-key.ts` (PLAN-03)      | `JobStatus`, `JobStepStatus`                | `running`→processing; `succeeded`; `failed`; `rolled_back`; `interrupted` · step: `pending`; `running`→processing; `done`; `failed`; `rolled_back`→undone; `skipped`                                                                                                                                                                                                                              |
| `src/web/deploy/deploy.status-key.ts` (PLAN-03) | `DeployStatus`                              | sama dengan `JobStatus`                                                                                                                                                                                                                                                                                                                                                                           |
| `src/web/backup/backup.status-key.ts` (PLAN-04) | `BackupRunStatus`, `BackupSummary`, restore | `running`→processing; `succeeded`; `failed`; `partial` · summary `not_configured`; `running`→processing; `last_failed`→failed; `last_partial`→partial; `never`→pending; `ok`→succeeded · restore berjalan→processing                                                                                                                                                                              |

Fungsi domain boleh mengembalikan `{ key, label?, detail? }` (mis. `domainVerdict` PLAN-02: kunci + kalimat
penjelasan), tetapi **tidak boleh** menentukan tone/label baru. Kunci kanonik baru setelah W1 = permintaan tertulis ke
pemilik shell, dikerjakan di W4.

`StatusBadge` menerima `state?: StatusKey` (label/tone/pulse dari kamus; `label` boleh menimpa, mis. "Gagal · 3×").
Prop string `status` lama dan `toneForStatus`/`STATUS_TONE`/`LEGACY_TONE` dihapus di W4.

`src/web/components/status-icon.tsx` (baru): `StatusIcon({ state, className })` → ikon dari tabel, warna `TONE_TEXT`,
`motion-safe:animate-spin` untuk kunci berdenyut, `aria-hidden` + `<span className="sr-only">{label}</span>`. Dipakai
daftar langkah perubahan, daftar masalah, baris audit.

### 3.2 Tier konfirmasi (D4)

**Aturan pemilihan tier** (untuk aksi baru): data hilang permanen atau semua situs padam → **ketik nama**; mengganggu
tapi bisa dipulihkan → **AlertDialog**; aman/idempoten/hanya membaca → **tanpa** (= `Button` biasa; `ConfirmAction`
tidak punya tier "none").

| Tier            | Aksi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pemilik halaman |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Tanpa**       | Mulai layanan/aplikasi · Muat ulang data · Salin · Unduh log/cadangan (tetap diaudit server) · Cadangkan sekarang · Uji koneksi/token · Kirim notifikasi uji · Simpan pengaturan · Buat situs (langkah Ringkasan wizard = konfirmasinya) · Batalkan unggahan yang sedang berjalan · Keluar                                                                                                                                                                                                                                                                                                                                  | semua           |
| **AlertDialog** | Hentikan layanan/aplikasi biasa · Mulai ulang layanan/aplikasi (termasuk layanan terlindungi; body memuat peringatan akibat: cloudflared = semua domain putus sebentar, pm2 = semua aplikasi ikut mulai ulang, postgres = situs ber-DB terputus, panel = `onConfirm` resolve pada 202 lalu overlay PLAN-02) · Kembalikan versi sebelumnya · Ubah peran (naik ke Admin: "setara pemilik HP") · Cabut sesi / Keluar dari semua perangkat · **Keluarkan semua pengguna** (bisa dipulihkan dengan login ulang) · Hapus domain dari situs · **Hapus situs adopsi** (tidak ada data yang dihapus) · Pulihkan ke database **baru** | 02, 03, 04, 05  |
| **Ketik nama**  | Hapus situs **dikelola** (ketik nama situs; folder + DB dihapus) · Hapus pengguna (ketik email) · Pulihkan yang **menimpa** data (ketik nama database) · Hentikan layanan terlindungi (`panel.protected_services`, default termasuk `pm2`, `postgres`; ketik nama layanan; yang tetap ditolak server diputuskan PLAN-02)                                                                                                                                                                                                                                                                                                    | 02, 03, 04, 05  |

**Kontrak** `src/web/components/confirm-action.tsx` (baru). Komponen lama di `shared/confirm.dialog.tsx` diganti nama
`LegacyConfirmAction` di W1 (pemakai lama diperbarui satu baris import oleh worker yang sama) agar auto-import tidak
memilih yang salah; dihapus di W4.

```ts
type ConfirmBase = {
  title: string; // pertanyaan: "Hapus situs blog?"
  description: ReactNode; // akibat dulu, lalu apa yang tetap aman
  confirmLabel: string; // kata kerja + objek: "Hapus situs blog"
  destructive?: boolean;
  codes?: ErrorCodes;
  /** Receives the trimmed typed value (tier typed) for `?confirm=` / `ControlBody.confirm`. Reject = stay open + inline error. */
  onConfirm: (typed?: string) => Promise<unknown>;
  successToast?: string; // "Situs blog dihapus."
  trigger?: ReactElement; // dihilangkan bila dibuka dari menu "⋯"
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
export type ConfirmActionProps =
  | (ConfirmBase & { tier?: "confirm" })
  | (ConfirmBase & { tier: "typed"; typedValue: string });

/** Exact match after trimming outer whitespace; case-sensitive. */
export const typedMatches = (input: string, expected: string): boolean => input.trim() === expected;
```

Perilaku wajib:

1. **Tombol konfirmasi = `Button` biasa di `AlertDialogFooter`, bukan `AlertDialogAction`** (radix menutup dialog
   otomatis saat `AlertDialogAction` diklik; pola lama `confirm.dialog.tsx:44-46`). Buka/tutup dikontrol state `open`.
2. Tier typed: tombol `disabled` sampai `typedMatches`; `Enter` = konfirmasi bila cocok. Input `autoComplete="off"
   autoCapitalize="off" autoCorrect="off" spellCheck={false}`, `font-mono`, label `typedLabel(value)` dengan nilai dalam
   `<code>`, hint "Huruf besar-kecil harus sama.".
3. Pending: kedua tombol `disabled`, spinner di tombol konfirmasi; `Escape`/overlay tidak menutup; klik ganda tidak
   memanggil `onConfirm` dua kali.
4. Reject → `apiErrorMessage(err, codes)` di bawah deskripsi, `role="alert"`, input tidak dikosongkan.
5. Resolve → tutup, `toast.success(successToast)`, fokus kembali ke trigger (radix); bila halaman berpindah, manajer
   fokus route (§3.7) yang menang.
6. Tier typed: deskripsi memuat `id.shell.confirm.irreversible` bila memang tidak bisa dibatalkan.
7. Copy: judul & tombol mengulang kata kerja yang sama. Tidak ada "OK"/"Ya".
8. Alur panjang (restart `panel`, restart cloudflared): `onConfirm` resolve begitu server menerima (202), dialog
   ditutup, lalu UI domain (overlay PLAN-02) yang menunggu pemulihan. Dialog tidak pernah terkunci > durasi request.

### 3.3 Komponen bersama — API

Semua di `src/web/components/`. Props yang tidak disebut = tidak berubah dari kode sekarang.

**`PageHeader`** (diubah):

```ts
export type PageMeta = {
  updatedAt?: string | Date | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  live?: boolean;
};
export function PageHeader(props: {
  title: string; // h1; menimpa judul statis route (handle.title) bila berbeda
  description?: ReactNode;
  status?: ReactNode; // StatusBadge di samping judul (detail)
  actions?: ReactNode; // aksi utama; di HP di bawah judul
  meta?: PageMeta; // "Diperbarui 3 mnt lalu" + muat ulang
  back?: { to: string; label: string }; // induk daftar; HP: tombol "‹" di top bar
  className?: string;
}): JSX.Element;
```

- Render `<h1 id="page-title" tabIndex={-1} className="… outline-none max-md:sr-only">`, `text-xl sm:text-2xl
  font-semibold tracking-tight`.
- Judul dinamis didaftarkan ke shell dengan `useLayoutEffect` (sebelum paint); judul statis berasal dari route
  `handle.title` (§3.7). Wajib di setiap halaman kecuali landing/login, dirender di luar `QueryView`.
- Tombol refresh `meta` `size="icon-sm"`.

**`QueryView`** (`query-view.tsx`, baru):

```ts
export function QueryView<T>(props: {
  query: ApiQuery<T>;
  empty: ReactNode; // WAJIB; null hanya bila data tak mungkin kosong
  isEmpty?: (data: T) => boolean; // default: array kosong, atau { items: [] }
  codes?: ErrorCodes;
  skeleton?: ReactNode; // default <RowsSkeleton />
  children: (data: T) => ReactNode;
}): JSX.Element;
```

| State                 | Kondisi                        | Render                                                                                                                |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Memuat                | `data === undefined && !error` | `skeleton` (`aria-busy`)                                                                                              |
| Gagal pertama         | `data === undefined && error`  | `ErrorState` title `id.common.errorTitles[kind]`, description `apiErrorMessage`, `onRetry=reload`, `retrying=loading` |
| Data + gagal perbarui | `data && error`                | `StaleNotice` lalu `children(data)`                                                                                   |
| Kosong                | `data && isEmpty(data)`        | `empty`                                                                                                               |
| Isi                   | lainnya                        | `children(data)`                                                                                                      |

**`StaleNotice`** (di `query-view.tsx`): bar `warning-subtle`. Hanya `<p role="status">{staleTitle}</p>` ("Tidak bisa
memperbarui data.") yang menjadi live region, diumumkan sekali saat muncul. `staleSince(rel)` ("Data terakhir
diperbarui 3 mnt lalu.") dan tombol "Coba lagi" di luar region.

**`ErrorState`**: tambah `compact?: boolean` (satu baris, untuk bagian yang gagal sendiri). **`EmptyState`**: tetap;
filter tanpa hasil memakai `id.shell.noResults` + aksi "Hapus filter".

**`DataTable`** (diubah; 0 pemakai sekarang):

```ts
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Phone card slot; default "meta". */
  mobile?: "title" | "badge" | "meta" | "hidden";
};
export type DataPagination = { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void };
export function DataTable<T>(props: {
  columns: readonly DataColumn<T>[]; // kolom kondisional: jangan masukkan (tanpa prop `hidden`)
  rows: readonly T[]; // state memuat/gagal = QueryView
  rowKey: (row: T) => string;
  label: string;
  rowHref?: (row: T) => string; // stretched link pada sel `title`
  actions?: (row: T) => ReactNode; // satu aksi utama + "⋯"; di atas link (z-10)
  rowTone?: (row: T) => StatusTone | undefined;
  empty?: ReactNode; // rows.length === 0 (filter tanpa hasil)
  toolbar?: ReactNode;
  pagination?: DataPagination;
  className?: string;
}): JSX.Element;
```

- Desktop: tabel, kolom `mobile` diabaikan; kolom aksi header `sr-only` "Aksi".
- **Anatomi kartu HP** (wajib, sketsa §5.2b): baris 1 = kolom `title` (tebal, truncate) + kolom `badge` rata kanan;
  baris 2 = semua kolom `meta` digabung " · " (`text-xs text-muted-foreground`, wrap); footer = hasil `actions` (satu
  `Button size="sm"` + `DropdownMenu` "⋯" ikon 44 px di coarse), `border-t pt-2 flex items-center justify-between`.
  Tombol bertumpuk penuh lebar **dilarang**. Kartu `min-h-14`, `rowTone` = garis kiri 2 px.
- Urutan baris = pemanggil (bermasalah dulu). Pagination `<nav aria-label="Paginasi">`.
- `usePageParam()` (`use-page-param.ts`, baru): `[page, setPage]` terikat `?page=` (≥ 1, rusak → 1).

**`ActionBar`** (`action-bar.tsx`, baru, ±25 baris): di < md fixed `bottom: var(--bottom-nav-h, 0px)` +
`pb-[env(safe-area-inset-bottom)]` (bila bottom nav disembunyikan rute tugas, menempel di bawah), latar `bg-background/95
border-t`, isi `flex gap-2` dengan tombol `size="default"` (44 px); menyetel `--action-bar-h: 4rem` lewat
`data-action-bar` (`:root:has([data-action-bar])`); konten halaman mendapat padding bawah setinggi itu. Di ≥ md: footer
statis biasa (tidak fixed). Dipakai wizard Kembali/Lanjut dan editor Simpan (PLAN-03).

**`SearchField`** (baru): `({ value, onChange, label, placeholder })` → `<input type="search">` + ikon, label `sr-only`,
`enterKeyHint="search"`, `Escape` mengosongkan.

**`StatTile`**: nilai `text-xl` tanpa `truncate`, `hint` `line-clamp-2`. `Progress` shadcn tidak dipakai untuk status.
**`Section`**: h2 `text-base font-semibold`.

**`RelativeTime`**: satu jam bersama `useNow()` (`now.store.ts`, `useSyncExternalStore`, satu `setInterval` 15 dtk saat
ada subscriber, dijeda saat tab tersembunyi — satu-satunya `setInterval` yang diizinkan). `aria-label` = waktu absolut
("26 Nov 2026, 21.54"), `title` tetap. Prop `absolute?: boolean` menampilkan teks absolut (wajib di halaman detail dan
riwayat perubahan, §5.6).

**`CopyButton`**: `value: string | (() => string)`; hit-area 44 px di coarse.

**`StatusBadge`**: §3.1. **`KeyValue`, `InlineCode`, `RoleBadge`, `UserAvatar`, skeletons**: tetap.

### 3.4 LogViewer (pemilik PLAN-01; dipakai PLAN-02, PLAN-03, PLAN-05)

**Tipe bersama** `src/shared/log.types.ts` (ditulis `wkr-contracts-00` di W0, bentuk ini):

```ts
import type { LogLevel } from "./dev.types";
/** One log line as shown; `at` = ISO-8601 UTC when the line carried a timestamp we could parse. */
export type LogLine = { at: string | null; text: string; stream?: "out" | "err"; level?: LogLevel };
/** One follow response. `cursor` is opaque; `reset` = file rotated/replaced, drop what you have; `truncated` = server sent less than available. */
export type LogChunk = { lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean };
```

`stream` opsional: diisi hanya pada tampilan "Semua" (stdout+stderr digabung) agar baris stderr tetap ditandai;
endpoint yang memisah stream lewat `?stream=` tidak perlu mengisinya. Urutan selalu **lama → baru** (termasuk
`/dev/logs`).

**Parser** `src/shared/log.time.ts` (shell core, dipanggil server):

```ts
/** Splits a leading `svlogd -tt` timestamp (UTC) off a raw line; anything else → { at: null, text: raw }. */
export function splitLogTimestamp(raw: string): { at: string | null; text: string };
```

Pola `^(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2}):(\d{2})\.(\d{1,9}) ` (mis. `2026-11-26_13:54:24.23463`), UTC, pecahan
dipotong ke milidetik. Tanggal tidak valid → `at: null`, baris utuh. Format lain (pm2 tanpa zona) tidak ditebak.

**Buffer klien** `src/web/components/log.buffer.ts`:

```ts
export const LOG_MAX_LINES = 2_000;
export const LOG_LINE_DISPLAY_MAX = 4_000; // karakter; sisanya hanya di Salin/Unduh
export type BufferedLogLine = LogLine & { seq: number };
/** `reset` drops `prev` but `seq` keeps counting from prev's last seq, so "new lines" never goes negative. */
export function appendLogLines(
  prev: readonly BufferedLogLine[],
  chunk: { lines: readonly LogLine[]; reset: boolean },
  max?: number,
): BufferedLogLine[];
export function filterLogLines(lines: readonly BufferedLogLine[], query: string): BufferedLogLine[]; // substring, case-insensitive
export function logToText(lines: readonly LogLine[]): string; // "2026-11-26 21:54:07 teks" (lokal); tanpa at = teks saja
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
```

**Hook follow** `src/web/shared/use-log-follow.ts` (shell core):

```ts
/** Follows a cursor log endpoint: GET `${url}?after=<cursor>` → LogChunk, appended into a capped buffer. */
export function useLogFollow(
  url: string,
  opts: { enabled: boolean; baseMs?: number },
): {
  lines: BufferedLogLine[];
  error: ApiError | undefined;
  loading: boolean;
  capped: boolean;
  truncated: boolean;
  reload: () => void;
};
```

Cursor disimpan di `ref` (URL tetap) → backoff/visibilitas `usePoller` berlaku utuh. `url` berubah (stream lain) =
buffer dan cursor direset. Default `baseMs` 3.000. Fetch pertama selalu jalan (tail awal) walau `enabled: false`.

**Komponen** `src/web/components/log-viewer.tsx` + `log-lines.tsx` (dua file):

```ts
export type LogStreamFilter = "all" | "out" | "err";
export function LogViewer(props: {
  label: string; // "Log sshd"
  lines: readonly BufferedLogLine[];
  loading?: boolean;
  error?: ReactNode;
  empty: ReactNode;
  live?: { on: boolean; onChange: (on: boolean) => void }; // tanpa = log statis
  streams?: { value: LogStreamFilter; onChange: (v: LogStreamFilter) => void };
  downloadHref?: string; // unduhan server (diaudit); tanpa = Blob dari buffer
  capped?: boolean; // buffer klien penuh → "Menampilkan 2.000 baris terakhir."
  showLevel?: boolean;
  notice?: ReactNode;
  size?: "page" | "inline";
}): JSX.Element;
```

Perilaku:

1. **Ikuti**: toggle `aria-pressed`; `on` → `useLogFollow({ enabled: on })`. Mati = "Dijeda".
2. **Pin**: saat pinned, `useLayoutEffect` gulir ke bawah setelah baris berubah. Gulir manual > 32 px dari bawah →
   unpin + snapshot dibekukan. Tombol mengambang "Baris baru (n)" (`n` dihitung komponen dari `seq`) atau "Ke baris
   terakhir"; klik / `End` → pin lagi. Polling tetap jalan saat unpin.
3. **Cari**: `SearchField`, filter + `<mark>`, hitungan "12 dari 2.000 baris cocok", filter lewat `useDeferredValue`.
4. **Bungkus**: default on < 768 px, off di desktop; `localStorage` `panel-termux:log-wrap` (try/catch).
5. **Salin**: baris terlihat via `logToText`. **Unduh**: `downloadHref` atau Blob `<label-slug>-YYYYMMDD-HHmm.log`.
6. **Timestamp**: kolom kiri `formatClock(at)` "21.54.07"; baris pemisah `formatDayLabel(at)` ("Kamis, 26 Nov 2026",
   `role="separator"`) saat hari lokal berganti antara dua baris ber-`at`; tanggal lengkap juga di Salin/Unduh.
7. **Gaya**: `font-mono text-xs leading-5`, area `bg-muted`; stderr/error `bg-danger-subtle border-l-2 border-danger` +
   `sr-only`; warn `border-l-2 border-warning`; teks lewat `stripAnsi`.
8. **Performa**: `LogLines` merender baris `memo` dengan key `seq`, sehingga satu poll yang menambah k baris hanya
   merender k baris baru. Maks `LOG_MAX_LINES` baris di DOM, tanpa virtualisasi.
9. **A11y**: area `role="log" aria-live="off" tabIndex={0} aria-label={label}`; toolbar `role="toolbar"`; stream =
   `role="radiogroup"`; semua tombol ikon ber-`aria-label`.
10. **Baris panjang**: teks > `LOG_LINE_DISPLAY_MAX` (4.000) karakter dipotong di tampilan + `id.shell.log.lineCut(n)`;
    Salin/Unduh memakai teks utuh.
11. Tidak ada Dialog layar penuh (`size="page"` sudah mengisi layar HP; §1).

### 3.5 Polling — `usePoller` + `useApiQuery` (D9, D21)

Logika jadwal murni `src/web/shared/poller.ts` (timer & visibilitas di-inject, dites tanpa DOM):

```ts
export const POLL_BACKOFF_MAX_MS = 60_000;
export const pollDelay = (baseMs: number, failures: number): number =>
  Math.max(baseMs, Math.min(baseMs * 2 ** Math.min(failures, 6), POLL_BACKOFF_MAX_MS));
export function createPoller(deps: {
  run: (signal: AbortSignal) => Promise<"ok" | "error">;
  baseMs: number | undefined;
  isHidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}): { start(): void; reload(): void; visible(): void; hidden(): void; online(): void; stop(): void };
```

**Satu-satunya primitif React** `src/web/shared/use-poller.ts` (±25 baris):

```ts
/** Runs `run` now and then every baseMs per rules P1–P8. `enabled:false` stops the schedule (not the first run unless initial:false). */
export function usePoller(
  run: (signal: AbortSignal) => Promise<"ok" | "error">,
  opts: { baseMs?: number; enabled?: boolean; initial?: boolean; key?: string }, // key berubah = siklus baru
): { reload: () => void; running: boolean };
```

`useApiQuery` (`use-api-query.ts`, signature kompatibel; 20 pemanggil tidak berubah) dan `useLogFollow` dibangun di
atas `usePoller`:

```ts
export type ApiQuery<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean; // ada request berjalan (semantik lama)
  updatedAt: Date | null; // sukses terakhir (waktu klien)
  reload: () => void;
};
export type QueryOptions = { enabled?: boolean; initial?: boolean };
export function useApiQuery<T>(url: string, refreshMs?: number, opts?: QueryOptions): ApiQuery<T>;
```

Aturan (wajib untuk semua polling; **dilarang `setInterval`/`setTimeout` polling sendiri** di halaman):

- **P1 single-flight**: tick saat request berjalan dilewati, tidak di-abort. Abort hanya saat unmount, `key`/`url`
  berubah, atau `enabled` → false.
- **P2 coalesce `reload()`**: satu fetch tambahan setelah yang berjalan selesai.
- **P3 jadwal setelah selesai**: `pollDelay(base, failures)` setelah respons.
- **P4 backoff**: `failures` +1 tiap error, reset saat sukses; 10 → 20 → 40 → 60 → 60 dtk. 401/403 tetap mengalihkan.
- **P5 tersembunyi**: hidden → batalkan timer; visible → fetch segera bila `now − lastOk ≥ base` atau ada error, selain
  itu sisa waktu.
- **P6 online**: fetch segera, failures direset.
- **P7 enabled**: `false` → tidak ada timer. Fetch pertama tetap jalan kecuali `initial: false` (tidak ada skeleton
  abadi).
- **P8 respons basi**: respons untuk `key`/`url` lama diabaikan. Follow log tidak mengubah URL (cursor di ref).
- Halaman yang menahan `StaleNotice` sementara (mis. progres job selama langkah `tunnel_restart` < 120 dtk, PLAN-03)
  melakukannya di pemanggil, tanpa opsi hook baru (X19).

Interval = konstanta domain. Acuan: Ringkasan/Layanan/Aplikasi 10 dtk; Domain 30 dtk; Database tanpa poll; progres
perubahan 1 dtk selama `running`; cadangan 3 dtk selama berjalan; Kesehatan sistem 15 dtk; log diikuti 3 dtk;
`/api/panel/status` (badge nav) 60 dtk.

### 3.6 Toast (D10)

- Satu `<Toaster>` + satu `<TooltipProvider>` di `SessionGate`. `PanelLayout`/`DevLayout` dihapus beserta route
  pembungkusnya.
- `components/ui/sonner.tsx`: `position="bottom-right"`, `mobileOffset={{ bottom: "calc(var(--bottom-nav-h, 0px) +
  var(--action-bar-h, 0px) + 0.75rem + env(safe-area-inset-bottom))" }}`, `visibleToasts={3}`, `closeButton`,
  `containerAriaLabel="Notifikasi"`, `closeButtonAriaLabel="Tutup notifikasi"`, tanpa `richColors`; ikon diwarnai token
  lewat `toastOptions.classNames`.
- CSS: `:root:has([data-bottom-nav]) { --bottom-nav-h: 3.5rem }`, `:root:has([data-action-bar]) { --action-bar-h: 4rem }`.
- `runApiAction`: error toast `{ duration: 8_000 }`.
- Konten: sukses = kalimat lampau pendek; aksi lewat dialog → error di dialog; aksi tanpa dialog → toast error 8 dtk.

### 3.7 Shell: judul, breadcrumb, fokus, navigasi mobile

**Judul**:

- Judul **statis** per route di `handle: { title: string; task?: boolean }` di file route domain, dibaca sinkron lewat
  `useMatches()` (route terdalam yang punya `title`).
- Judul **dinamis**: `PageHeader` memanggil `useShellPage({ title, back })` (`layout/shell.page.tsx`) dengan
  `useLayoutEffect`; nilai ini menimpa `handle.title`.
- `useDocumentTitle(title, { raw? })` untuk landing/login (di luar shell).
- Judul tab: `"<judul> · Panel Termux"`. `documentTitleFor` lama dihapus (semua route punya `handle.title`).

**Breadcrumb** `breadcrumbsFor(pathname, pageTitle)`: maks 3 tingkat (grup › item nav (link) › judul halaman bila path
lebih dalam). Segmen URL antara tidak pernah jadi crumb. `aria-label` "Lokasi halaman".

**Fokus route (D7)**: efek pada `pathname` (lewati render pertama dan perubahan `search`/`hash` saja):
`requestAnimationFrame(() => (document.getElementById("page-title") ?? mainEl).focus({ preventScroll: true }))`.
`<ScrollRestoration />` dipasang. Sheet nav `onCloseAutoFocus={(e) => e.preventDefault()}`.

**Indikator navigasi**: `useNavigation().state === "loading"` → bar 2 px `bg-foreground/40` di atas `main`, setelah 150
ms, `role="progressbar"` `aria-label="Memuat halaman…"`.

**Mobile top bar** (`layout/mobile.topbar.tsx`, mengganti `mobile.bar.tsx`): sticky `h-12` +
`pt-[env(safe-area-inset-top)]`; "‹" (Link ke `back.to`, `aria-label` `Kembali ke Situs`) bila ada `back`; judul
`text-base font-semibold truncate` `aria-hidden`; `UserMenu` ringkas hanya untuk peran tanpa bottom bar.
`index.html` viewport + `viewport-fit=cover`.

**Bottom bar** (`layout/mobile.nav.tsx`): `<nav aria-label="Navigasi utama" data-bottom-nav>` fixed bawah, `h-14` +
safe-area, 5 slot sama lebar, ikon 20 px + label `text-[11px]`. Slot 1–4 = `Link` dengan `aria-current="page"` bila
aktif. `MOBILE_PRIMARY = ["/panel", "/panel/sites", "/panel/services", "/panel/apps"]` difilter `canAccess`; kosong →
tidak dirender. **Disembunyikan pada rute tugas** (`handle.task` di match mana pun, atau `useTaskMode(true)` dari
komponen yang punya perubahan belum disimpan; `layout/task.mode.tsx`). Slot 5 "Lainnya" = `<button
aria-haspopup="dialog" aria-expanded={open}>`; tanpa `aria-current`; saat halaman aktif ada di dalam sheet: penanda
visual + `sr-only` "(halaman saat ini ada di menu ini)".

**Sheet "Lainnya"** (`layout/mobile.more.tsx`): `Sheet side="bottom"` `max-h-[85dvh]`; grup nav sisanya (Administrasi
dulu untuk Super Admin, lalu Domain, Database, Cadangan), baris `h-12`; blok akun (avatar, nama, peran), tema
segmented, Profil, Keluar. Ditutup oleh efek `pathname` **dan** satu `onClick` terdelegasi di `<nav>` sheet
(`(e.target as Element).closest("a")` → tutup), sehingga mengetuk halaman yang sedang dibuka juga menutup sheet.

**Badge nav** (`layout/nav.badges.tsx`): `NavItem.badge?: ReactNode` + `NavBadgeProvider` (context `Record<path,
ReactNode>` yang diisi pemanggil). Shell merender badge di sidebar, bottom bar, dan sheet. Tidak ada fetch di shell;
PLAN-02 menyediakan provider di W3.

Desktop: sidebar, collapse, header breadcrumb tetap.

### 3.8 Target sentuh (D8)

- Varian bawaan Tailwind 4 `pointer-coarse:` (tanpa `@custom-variant`).
- `components/ui/button.tsx`: `default`/`sm` `pointer-coarse:h-11`, `lg` `pointer-coarse:h-12`,
  `icon`/`icon-sm`/`icon-lg` `pointer-coarse:size-11`, `icon-xs`/`xs` visual 24 px + `relative
  pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']`. `input`/`select`
  trigger `pointer-coarse:h-11`.
- Checkbox/switch: label pembungkus `pointer-coarse:min-h-11` (aturan pemanggil).
- Item sheet `h-12`, bottom bar `h-14`, kartu DataTable `min-h-14`, `ActionBar` tombol 44 px.

### 3.9 Token, tipografi, string primitive

- **Larangan** (guard test W4): kelas palet Tailwind mentah
  `\b(?:text|bg|border|ring|fill|stroke)-(?:red|green|emerald|amber|yellow|orange|blue|sky|lime|rose)-\d{2,3}\b` dan
  `destructive/10` di `src/web` kecuali `landing/`.
- `status.tone.ts`: tambah `TONE_TEXT` (pindahan `VALUE_TONE` dari `stat-tile.tsx`).
- Skala tipografi dikunci lewat komponen: h1 `text-xl sm:text-2xl`; h2 `text-base font-semibold`; isi `text-sm`; meta
  `text-xs text-muted-foreground`; KPI `text-xl tabular-nums`; mono untuk ID/port/path/perintah/hash/log.
- `ui/dialog.tsx:63,98`, `ui/sheet.tsx:68`: "Close" → `id.common.close`. `id.shell.breadcrumb` → "Lokasi halaman".
- `styles.css` komentar: `/* white on danger/60 over dark background: 6.0:1 */`.

### 3.10 Format

`src/shared/format.id.ts` (baru, murni, dipakai server PLAN-02 untuk pesan Telegram): `formatBytes`, `formatDuration`,
`formatNumber`, `formatPercent`, `formatMegabytes`, `formatTemperature`. `src/web/shared/format.ts` me-re-export
semuanya dan menambah yang butuh i18n/locale klien:

| Fungsi                      | Kontrak                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatRelative(at, now)`   | `< 60 dtk` "baru saja"; `< 24 jam` dua satuan + "lalu"; 1 hari "kemarin"; `< 7 hari` "N hari lalu"; selebihnya `26 Nov 2026`; masa depan "baru saja" |
| `formatBytes(n)`            | B/KB/MB: 1 desimal bila < 100, selain itu 0; **GB/TB selalu tepat 1 desimal** ("64,0 GB", "232,0 GB")                                                |
| `formatDayLabel(iso)`       | "Kamis, 26 Nov 2026" (pemisah hari di log)                                                                                                           |
| `formatClock(iso)`          | "21.54.07" lokal; null/invalid → ""                                                                                                                  |
| `formatTemperature(c)`      | "36,5 °C"; null → "–" (pindah dari `id.panel.ts`)                                                                                                    |
| `formatDateTime(iso, true)` | tetap ("26 Nov 2026, 14.05.07"); komentar diperbaiki                                                                                                 |

### 3.11 Code splitting (D11, D12)

- `scripts/build.ts`: `splitting: true`.
- Struktur route:

| Chunk   | Isi                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| entry   | `main.tsx`, `router.tsx`, `SessionGate`, `SessionFallback`, `SessionError`, tema, `LandingPage` (impor statis)                  |
| `login` | `lazy: () => import("@/web/pages/login.page")` (membawa better-auth client)                                                     |
| `app`   | satu `lazy: () => import("@/web/app.routes")` untuk route pathless `AppLayout`; `app.routes.tsx` mengimpor statis semua halaman |

- `src/web/app.routes.tsx` (milik shell, beku setelah W2) hanya menyusun array dari file route **milik domain**:
  `panel/panel.routes.tsx` (PLAN-02: Ringkasan, Layanan, Aplikasi, Domain, Database, log, `/panel/problems`),
  `site/site.routes.tsx` (PLAN-03: situs, wizard, perubahan), `backup/backup.routes.tsx` (PLAN-04), `dev/dev.routes.tsx`
  (PLAN-05), plus `profile` dan `*` (shell). Tiap entri punya `handle.title`. Rute baru = edit file route domain sendiri.
  Ke-4 file dibuat W2 nav-02 dengan rute yang ada sekarang.
- `isChunkLoadError(err)` (`src/web/shared/chunk.error.ts`): pesan
  `/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i`.
  Hari ini chunk yang hilang dijawab HTML 200 → Chrome tetap melempar "Failed to fetch dynamically imported module" (MIME).
- `reloadOnce(key, now)` (generalisasi `shouldReloadForAccess`, jendela 30 dtk, key `panel.chunkReloadAt`) dipakai
  `RouteErrorPage` dan `SessionError`.
- Target (gzip): `/` ≤ 150 KB JS; muatan awal `/panel` (entry + app) ≤ 200 KB JS; `app` > 250 KB → pecah lagi.
  Diukur `bun run bundle:check` (§6).

### 3.12 Kontrak header cache (D13) — implementasi `wkr-http-01` (PLAN-04)

PLAN ini hanya menyatakan kebutuhan klien:

| Kebutuhan                                                | Kontrak                                                                                                                                                                | Prioritas        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| HTML tidak basi setelah deploy (agar reload F6 berhasil) | Setiap respons HTML SPA (status apa pun, termasuk 404 `noindex` PLAN-05) membawa `Cache-Control: no-cache`                                                             | P0               |
| Chunk gagal terdeteksi                                   | Klien mendeteksi baik 404 maupun HTML 200 (kondisi sebelum B11 dipasang); tidak perlu header khusus                                                                    | –                |
| Aset tidak divalidasi ulang tiap navigasi                | Aset ber-hash (`/^\/[\w.-]+-[a-z0-9]{8}\.(js\|css\|svg\|png\|webp\|woff2)$/`) `Cache-Control: public, max-age=31536000, immutable` + `X-Content-Type-Options: nosniff` | P0 (v0.3.0, B11) |
| Chunk hilang → 404                                       | Path pola di atas yang tidak ada → 404 `text/plain`, `Cache-Control: no-store` (bukan HTML SPA)                                                                        | P0 (v0.3.0, B11) |
| `/__spa` / path internal bundle                          | Tidak terjangkau dari luar (404), detail di PLAN-04 K16                                                                                                                | P0 (B11)         |

Status HTTP untuk path tak dikenal (PLAN-05 F11) dan path internal bundle (PLAN-04 K16) didefinisikan di PLAN masing-masing.
Cara implementasi (proksi/bundle internal) = PLAN-04 r2, dikerjakan `wkr-http-01` di `src/server/http/spa.serve.ts`.
Bukti: binary `--compile` saat ini tidak mengirim `Cache-Control` untuk HTML maupun chunk (probe sesi ini, POCO, X5).
PLAN-04 K17 ("cache sudah benar dari Bun") diuji tanpa `--compile` dan harus dikoreksi.

### 3.13 Sesi, 404 publik, error

- `src/shared/roles.ts` (`wkr-contracts-00`, W0): `isProtectedPath`, `SPA_ROOTS`, `isKnownSpaPath`, dan **`homeFor("super_admin") = "/panel"`** (A11, B19).
- `api.client.ts` `redirectFor`: `forbidden` → `LOGIN_PATH` (D19); komentar `:56` diperbaiki.
- `session.redirect.ts` `resolveRedirect`: tamu → `/login` hanya bila `isProtectedPath(path)`; `/`, `/login`, path tak
  dikenal → `null`.
- Router: `{ path: "*", Component: NotFoundRoute }` di root. Login → `<AppLayout><NotFoundPage /></AppLayout>`
  (`AppLayout` menerima `children`); tamu → `PublicNotFound` dengan copy PLAN-05 §5.7 (header ringkas logo + "Masuk",
  judul "Halaman tidak ditemukan", isi "Alamat ini tidak ada di Panel Termux.", aksi "Ke beranda" + "Masuk"). Klien saja;
  status 404 + `noindex` di server = PLAN-05/`wkr-http-01`.
- `session.api.ts` `fetchMe`: jaringan → `ApiError("network")`, non-401 gagal → `ApiError("server", status)`.
  `SessionError`: chunk error → reload sekali; network → `WifiOffIcon` + copy lama; server → `ServerCrashIcon` +
  `serverTitle/serverBody`.
- `SessionFallback`: `/` dan `/login` → hanya latar; lainnya → skeleton berbentuk shell.
- `RouteErrorPage`: "Kembali" (`navigate(-1)`) → link "Ke beranda" (`homeFor(role)`).

### 3.14 Copy keys

`src/web/i18n/id.status.ts` (baru): label tabel §3.1 + `statusHelp` (`rolled_back`: "Perubahan gagal; versi lama
dipulihkan.", `interrupted`: "Panel dimulai ulang saat perubahan berjalan. Periksa lalu bersihkan.", `auth_required`:
"Domain menjawab, tetapi meminta login (mis. Cloudflare Access).").

`src/web/i18n/id.shell.ts` (tambahan/ubahan; **semua** ditulis `wkr-shell-core-01`, worker ui/log hanya memakai):

```ts
breadcrumb: "Lokasi halaman",
navigating: "Memuat halaman…",
mobileNav: { label: "Navigasi utama", more: "Lainnya", moreTitle: "Menu lainnya", moreActive: "(halaman saat ini ada di menu ini)", back: (label: string) => `Kembali ke ${label}` },
staleTitle: "Tidak bisa memperbarui data.",
staleSince: (rel: string) => `Data terakhir diperbarui ${rel}.`,
noResults: { title: "Tidak ada yang cocok", body: "Ubah kata pencarian atau hapus filter.", clear: "Hapus filter" },
search: { clear: "Hapus pencarian" },
table: { /* + */ actions: "Aksi", more: "Aksi lain", pagination: "Paginasi", pageWithTotal: (p: number, n: number, total: string) => `Halaman ${p} dari ${n} · ${total} entri` },
confirm: {
  typedLabel: (value: string) => `Ketik ${value} untuk konfirmasi`,
  typedHint: "Huruf besar-kecil harus sama.",
  irreversible: "Tindakan ini tidak bisa dibatalkan.",
},
toaster: { region: "Notifikasi", close: "Tutup notifikasi" },
chunkError: {
  title: "Bagian panel ini gagal dimuat",
  body: "Biasanya karena panel baru diperbarui atau koneksi terputus. Muat ulang halaman untuk memakai versi terbaru.",
  reload: "Muat ulang halaman",
},
routeError: { /* back diganti */ home: "Ke beranda" },
publicNotFound: { title: "Halaman tidak ditemukan", body: "Alamat ini tidak ada di Panel Termux.", home: "Ke beranda", signIn: "Masuk" },
log: {
  toolbar: "Alat log", follow: "Ikuti", paused: "Dijeda",
  newLines: (n: number) => `Baris baru (${n})`, toBottom: "Ke baris terakhir",
  search: "Cari di log", searchPlaceholder: "mis. error",
  matches: (n: string, total: string) => `${n} dari ${total} baris cocok`,
  noMatches: "Tidak ada baris yang cocok. Ubah kata pencarian.",
  wrap: "Bungkus baris", copy: "Salin log", copyFiltered: (n: string) => `Salin ${n} baris`,
  download: "Unduh .log",
  streams: { all: "Semua", out: "stdout", err: "stderr" },
  capped: (n: string) => `Menampilkan ${n} baris terakhir.`,
  lineCut: (n: string) => `… (+${n} karakter, lengkap lewat Salin atau Unduh)`,
},
```

`id.common.ts`: `errorTitles` (network "Tidak bisa terhubung ke server", unauthorized "Sesi kamu sudah berakhir",
access "Perlu masuk lewat Cloudflare Access", forbidden "Kamu tidak punya akses", client "Permintaan tidak berhasil",
server "Server sedang bermasalah"). `id.ts` `session.serverTitle` "Panel Termux sedang bermasalah", `serverBody` "Server
menjawab dengan galat. Coba lagi beberapa saat lagi; bila berulang, periksa log panel di HP.". `id.common.empty` dihapus
di W4. Content guide: contoh "Diperbarui 12 dtk lalu" → "Diperbarui 3 mnt lalu" (D16).

### 3.15 Rekonsiliasi kontrak (nama final; mengalahkan teks PLAN lain)

| Hal                        | Final (PLAN-01)                                                  | Yang harus dikoreksi di PLAN lain                                                       |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Aksi baris `DataTable`     | `actions`                                                        | `rowActions` (PLAN-02 §3.9, PLAN-03 §5/baris 987/1276)                                  |
| Kolom kondisional          | tidak dimasukkan ke `columns`; slot HP = `mobile`                | `columns[].hidden` (PLAN-02)                                                            |
| Error di `DataTable`       | tidak ada; `QueryView`                                           | "`error` menerima `ApiError`" (PLAN-02)                                                 |
| `LogLine` / `LogChunk`     | §3.4                                                             | PLAN-02 §3.3 (tambah `stream?`), PLAN-03 `AppLogTail.lines` = `LogLine[]`               |
| Viewer follow              | `live: { on, onChange }`; `newCount` internal; `empty`; `capped` | `following`/`onFollowChange`/`newCount`/`toolbarStart`/`maxLines`/`emptyText` (PLAN-02) |
| Hook follow                | `useLogFollow` (shell)                                           | `useLogFollow` milik PLAN-02 §3.9                                                       |
| `useApiQuery`              | `(url, refreshMs?, opts?)`; jeda saat tersembunyi selalu aktif   | `(url, { refreshMs, pauseHidden })` (PLAN-02)                                           |
| Tier konfirmasi            | `"confirm" \| "typed"`; tanpa = `Button`                         | `"none"` (PLAN-02/03/05)                                                                |
| `onConfirm`                | `(typed?: string) => Promise<unknown>`                           | –                                                                                       |
| Pemilik `LogViewer`        | PLAN-01                                                          | "LogViewer dari PLAN/02" (PLAN-05 baris 44/539/699)                                     |
| Waktu relatif              | "baru saja" < 60 dtk                                             | "12 dtk lalu", "40 dtk lalu" (PLAN-02 §5.1, PLAN-05 F2)                                 |
| Header lengket / bar bawah | `ActionBar`; rute tugas; tanpa header/chip lengket di HP         | PLAN-03 baris 1032/1044/1093/1276                                                       |
| Kartu HP                   | anatomi §3.3/§5.2b                                               | "tombol penuh lebar bertumpuk" (PLAN-04 baris 629), PLAN-05 baris 678                   |
| Mapping status             | `*.status-key.ts` milik domain, kunci dari §3.1                  | `domainVerdict` + label sendiri (PLAN-02 §5.4/§5.6)                                     |

Spec worker gelombang halaman wajib mengutip signature §3.3–§3.5 secara harfiah (X20).

---

## 4. Flow

### F1 — Navigasi antar halaman

1. Ketuk item (sidebar / bottom bar / sheet). Pertama kali membuka area aplikasi: router menunggu chunk `app`; bar
   navigasi muncul setelah 150 ms. Navigasi berikutnya di dalam aplikasi tidak memuat chunk.
2. Halaman render; judul statis dari `handle.title` langsung tampil di top bar dan tab (sinkron); `PageHeader` menimpa
   judul dinamis sebelum paint.
3. Fokus pindah ke `#page-title`; scroll ke atas (`ScrollRestoration`).
4. Sheet "Lainnya" tertutup (efek pathname atau klik terdelegasi, termasuk ketukan pada halaman yang sedang dibuka).
5. Back browser: posisi scroll dipulihkan; fokus tetap ke h1.
6. Hanya query berubah: tidak ada pemindahan fokus/scroll.
7. Chunk gagal: F6.

### F2 — Halaman dengan polling

1. Mount → fetch → skeleton → data; `PageHeader.meta.updatedAt = query.updatedAt` (atau `generatedAt`).
2. Tiap `base` ms setelah respons: fetch lagi; data lama tetap tampil.
3. Respons lambat: tidak ada tick tambahan, tidak ada abort.
4. Jaringan putus: `StaleNotice` (live region diumumkan sekali) + backoff 20/40/60 dtk; `online` → fetch segera.
5. Tab tersembunyi: timer berhenti; kembali → segera bila basi.
6. Sesi panel habis: 401 → `/login`. Access habis: reload sekali.
7. Mutasi lalu `reload()` saat poll berjalan: satu fetch tambahan.
8. Server restart: notice → pulih; pindah area setelah upgrade → F6.

### F3 — Aksi dengan konfirmasi

1. Tanpa: tombol → pending → sukses: toast + `reload()`; gagal: toast error 8 dtk.
2. AlertDialog: dialog → konfirmasi → pending (terkunci) → sukses: tutup + toast + reload; gagal: pesan inline, dialog
   tetap terbuka.
3. Ketik nama: tombol aktif saat cocok persis; `onConfirm(typed)` meneruskan nilai ke server (`?confirm=` /
   `ControlBody.confirm`). Paste boleh.
4. 409 `busy`: pesan inline dari `codes.busy`.
5. **Izin ditolak** (peran diturunkan saat dialog terbuka): 403 → `apiFetch` full load ke `/login` → `/api/me` dibaca
   ulang → `resolveRedirect` mengalihkan ke `homeFor(role)` baru (mis. `/profile`). Tidak pernah ke landing.
6. Jaringan putus saat pending: pesan network inline; idempotensi/kunci di server = PLAN domain.
7. Restart `panel`/cloudflared: `onConfirm` resolve pada 202 → dialog tertutup → overlay PLAN-02 (poll `/api/health`).

### F4 — Melihat log (follow)

1. `useLogFollow(url, { enabled: live })` mengambil tail awal → `appendLogLines([], chunk)` → pin ke bawah.
2. Follow on: poll 3 dtk `?after=<cursor>` (cursor di ref, URL tetap) → append → gulir ke bawah.
3. Gulir ke atas → unpin, snapshot beku, "Baris baru (n)" bertambah.
4. Cari → filter + sorot (deferred); follow tetap jalan.
5. "Baris baru (n)" / `End` → terbaru, pin lagi.
6. Follow off / tab tersembunyi → poll berhenti; backoff saat error tetap 10→20→40 walau cursor berubah.
7. **Rotasi file**: server mengirim `reset: true` → buffer dibuang, `seq` melanjutkan (n tidak negatif), snapshot
   (bila unpin) dipertahankan sampai pengguna pin lagi.
8. Kosong → `empty`; gagal pertama → `error` + Coba lagi; gagal saat follow → error kecil, baris tetap.
9. Ganti stream (`url` berubah) → buffer + cursor direset, tail awal stream baru.
10. `/dev/logs`: `useApiQuery` biasa (ring buffer server, tanpa cursor) → `appendLogLines(prev, { lines, reset: true })`.

### F5 — Navigasi mobile

1. Admin/Super Admin < md: top bar + bottom bar. Super Admin mendarat di Ringkasan (slot 1).
2. "Lainnya" → sheet; pilih item → tertutup (F1-4).
3. `user`: tanpa bottom bar; avatar menu di top bar.
4. Detail: "‹" ke `back.to` (Link).
5. **Rute tugas** (wizard situs, editor dengan perubahan belum disimpan): bottom bar disembunyikan; `ActionBar`
   menempel di bawah. Keluar dari rute tugas / simpan → bottom bar kembali.
6. Toast di atas bottom bar + ActionBar; dialog/sheet menutupi keduanya.
7. Keyboard virtual: QA (R6).

### F6 — Versi baru / chunk gagal

1. Tab terbuka saat panel di-upgrade; pengguna membuka login/aplikasi yang chunk-nya belum dimuat → `import()` gagal
   (setelah B11 server menjawab 404; sebelum itu HTML 200 → error MIME — keduanya terdeteksi).
2. `isChunkLoadError` → `reloadOnce` → reload → HTML baru (`no-cache`, §3.12) → chunk baru.
3. Gagal lagi dalam 30 dtk: `ErrorState` chunk + "Muat ulang halaman".
4. Chunk yang sudah di-cache browser tetap jalan (divalidasi ETag).
5. `sessionStorage` tidak tersedia → langsung pesan.

### F7 — Tamu & URL

1. Tamu `/panel/sites` → `/login`.
2. Tamu `/hargaa` → 404 publik ("Ke beranda" / "Masuk").
3. Login `/panel/xyz` → 404 di shell.
4. Dengan Access: `/panel*` ditantang Access dulu; 2 dan 3 sama. Tanpa Access: seperti di atas.

### F8 — Pertama kali / data kosong

- Setiap daftar menampilkan `EmptyState` spesifik + CTA (compiler memaksa `empty`). Mode demo tidak mengubah shell.

---

## 5. Spesifikasi UI per permukaan

### 5.1 App shell desktop (≥ md)

Sidebar 240/56 px (tetap) dengan badge nav. Header sticky 56 px: `Breadcrumbs`. Konten `max-w-7xl`/`max-w-3xl`. Bar
navigasi 2 px saat chunk dimuat. Skip link, `main#main tabIndex=-1`, fokus ke h1.

### 5.2 App shell HP (< md)

```
┌──────────────────────────────┐  safe-area-top
│ ‹  Log sshd                  │  top bar 48 px
├──────────────────────────────┤
│ ● Berjalan · aktif 3 jam     │  status/meta/aksi PageHeader (h1 sr-only)
│ [Mulai ulang]  [⋯]           │
│ …konten…                     │
├──────────────────────────────┤
│ Ringkasan Situs Layanan Aplikasi Lainnya │  bottom bar 56 px (hilang di rute tugas)
└──────────────────────────────┘  safe-area-bottom
```

Elemen tetap ≤ 120 px di 360×640 (biasa: 48 + 56 = 104; rute tugas: 48 + ActionBar 64 = 112). Tanpa scroll horizontal
halaman di 360–430 px.

### 5.2b Kartu `DataTable` di HP

```
┌────────────────────────────────────┐
│ blog                      ● Berjalan │  baris 1: mobile:"title" + mobile:"badge"
│ blog.contoh.com · port 3001 · 2 jam lalu │  baris 2: semua mobile:"meta" digabung " · "
├────────────────────────────────────┤
│ [Mulai ulang]                   [⋯] │  footer: satu aksi utama sm + menu ⋯ (44 px di coarse)
└────────────────────────────────────┘
```

Seluruh kartu adalah link bila `rowHref` (stretched link di judul; footer di atasnya, z-10). Garis kiri tone bila
`rowTone`. Tidak ada tombol penuh lebar bertumpuk.

### 5.3 Sheet "Lainnya"

`Sheet`, `SidebarNav` varian `h-12`, `UserAvatar`, `RoleBadge`, tema segmented, `useSignOut` (error inline). Judul
sheet sr-only, fokus ke item pertama, `Escape` menutup.

### 5.4 404 publik & 404 di shell

Publik: copy PLAN-05 §5.7, `BrandLogo`, `EmptyState`, "Ke beranda" + "Masuk". Shell: `EmptyState` + `PageHeader
title="Halaman tidak ditemukan"`.

### 5.5 Route error, session error, session fallback

§3.11/§3.13.

### 5.6 Syarat shell untuk halaman milik PLAN lain (template migrasi)

| Jenis halaman                 | Wajib                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semua (kecuali landing/login) | entri route dengan `handle.title`; `PageHeader` di luar `QueryView`; satu h1; data lewat `useApiQuery`/`useLogFollow`; `QueryView` dengan `empty` spesifik; status lewat `StatusBadge state=` + mapping `*.status-key.ts`; tanpa polling sendiri, warna palet mentah, `Toaster` sendiri, ukuran heading sendiri |
| Daftar                        | `DataTable` (`rowHref`, `actions` = satu aksi utama + "⋯", kolom `mobile`), urutan bermasalah dulu, `usePageParam`, `SearchField`, `EmptyState` filter `id.shell.noResults`; waktu `RelativeTime`                                                                                                               |
| Detail / riwayat perubahan    | `PageHeader` dengan `status`, `actions`, `back`; `Section` + `KeyValue`; waktu `RelativeTime absolute`                                                                                                                                                                                                          |
| Live                          | `PageHeader.meta = { updatedAt, onRefresh: reload, refreshing: loading, live: true }`; tanpa "tiap N detik", tanpa hitungan detik                                                                                                                                                                               |
| Tugas (wizard, editor)        | `handle.task: true` atau `useTaskMode(dirty)`; tombol utama di `ActionBar`                                                                                                                                                                                                                                      |
| KPI                           | `StatTile` grid `grid-cols-2 lg:grid-cols-4` + `StatTilesSkeleton`                                                                                                                                                                                                                                              |
| Log                           | `LogViewer` + `useLogFollow` (cursor) atau `useApiQuery` (ring)                                                                                                                                                                                                                                                 |
| Aksi berisiko                 | `ConfirmAction` tier §3.2                                                                                                                                                                                                                                                                                       |
| Login (PLAN-05, R1-G17)       | `<h1>`, `BrandLogo`, link ke `/`, `ErrorState compact`, `useDocumentTitle(..., { raw: true })`, tombol Google `pointer-coarse:h-12`                                                                                                                                                                             |
| Landing (PLAN-05)             | `useDocumentTitle(id.landing.meta.title, { raw: true })`; boleh token `--lp-*`                                                                                                                                                                                                                                  |

---

## 6. Kriteria penerimaan

### Unit (`bun test`, tanpa DOM)

- [ ] `tests/web.status.test.ts` (shell): setiap `StatusKey` punya label non-kosong dan entri tone/ikon; tidak ada kunci
      ber-tone `accent`; `rolled_back` punya `statusHelp`.
- [ ] Test mapping per domain (pemilik domain, di file test domain): setiap nilai union terpetakan; `down`+`wantUp` dan
      `down`+`!wantUp` menghasilkan label berbeda; `interrupted` → `interrupted`.
- [ ] `tests/web.polling.test.ts` (`createPoller`, timer di-inject): tick saat in-flight tidak memanggil `run` kedua;
      `reload()` saat in-flight → tepat 1 run tambahan; delay 10/20/40/60/60/60 dtk; sukses mereset; `hidden()`
      membatalkan timer; `visible()` ≥ base → segera, < base → sisa; `stop()` meng-abort; base 120 dtk tidak pernah <
      120 dtk; **run yang mengubah cursor tiap respons (URL tetap) tetap mengikuti backoff 10→20→40**; `enabled:false` +
      `initial` default → tepat satu run, `initial:false` → nol run.
- [ ] `tests/log.time.test.ts`: `2026-11-26_13:54:24.23463 pesan` → `at = 2026-11-26T13:54:24.234Z`, `text = "pesan"`;
      pm2 tanpa zona, baris kosong, bulan 13 → `at: null`, teks utuh.
- [ ] `tests/web.log-buffer.test.ts`: potong ke `max` dari depan; `seq` naik terus melewati pemotongan **dan `reset`**;
      `filterLogLines` tidak peka huruf besar-kecil; `logToText`; `stripAnsi`.
- [ ] `tests/web.shell.test.ts`: `breadcrumbsFor("/panel/services/sshd/log", "Log sshd")` = `[Server, Layanan(→),
      Log sshd]`; `/panel/jobs/<uuid>` tanpa UUID; `formatRelative` 59 dtk "baru saja", 60 dtk "1 mnt lalu";
      `formatBytes` 64 GiB "64,0 GB", 232 GiB "232,0 GB", 512 MiB "512 MB", 1,5 KiB "1,5 KB"; `formatClock`
      "21.54.07" (TZ ditetapkan); `typedMatches(" blog ","blog")` true, `("Blog","blog")` false.
- [ ] `tests/format.id.test.ts`: fungsi `src/shared/format.id.ts` sama hasilnya dengan re-export web.
- [ ] `tests/web.session.test.ts`: tamu `/hargaa` → null; tamu `/panel/sites` → `/login`; `/` dan `/login` → null;
      `isProtectedPath("/panelx")` = false; `homeFor("super_admin") = "/panel"`.
- [ ] `tests/web.api-client.test.ts`: `redirectFor(forbidden)` = `/login`; unauthorized = `/login`.
- [ ] `tests/web.chunk.test.ts`: `isChunkLoadError` benar untuk pesan Chrome (termasuk kasus chunk dijawab HTML 200),
      Safari, Firefox; salah untuk `TypeError` lain; `reloadOnce` menolak dalam 30 dtk.
- [ ] W4 `tests/web.guard.test.ts`: tidak ada import `shared/query.state`, `shared/stat.card`, `shared/confirm.dialog`,
      `panel/status.badge`, `dev/pager`; tidak ada kelas palet mentah di `src/web` (kecuali `landing/`); tidak ada
      `setInterval(`/polling `setTimeout` di `src/web` selain `now.store.ts`/`use-poller.ts`; setiap `*.page.tsx`
      (kecuali landing, login) memuat `PageHeader`; setiap entri route domain punya `handle.title`; tidak ada `<Toaster`
      selain di `session.gate.tsx`; tidak ada `AlertDialogAction` di `confirm-action.tsx`.
- [ ] `bun run typecheck`, `bun run lint`, `bun test` hijau.

### Integrasi server (`wkr-http-01`, dicek bersama, di binary `build:local`)

- [ ] `curl -sI /panel`, `/login`, `/` dan path 404 → `cache-control: no-cache`.
- [ ] `curl -sI /chunk-<hash>.js` → `cache-control: public, max-age=31536000, immutable` + `nosniff`;
      `curl -sI /chunk-zzzzzzzz.js` → 404 `text/plain` `no-store`; `curl -sI /__spa` → 404.

### Bundle (`bun run bundle:check` = `scripts/bundle-report.ts`, juga di CI)

- [ ] `Bun.build({ entrypoints: ["src/web/index.html"], splitting: true, minify: true, outdir: tmp })` + `Bun.gzipSync`:
      entry ≤ 150 KB gz; entry + `app` ≤ 200 KB gz; entry tidak memuat penanda string dari `src/web/panel`/`dev`/`site`
      (mis. judul i18n khusus halaman itu); skrip keluar non-zero bila gagal.
- [ ] Binary `bun-linux-arm64-android` di HP: `/login` dan `/panel` memuat chunk dengan 200 (Risiko R2).

### UI-QA di browser (390×844, 360×640, 1440 px; terang & gelap)

- [ ] Setiap halaman: judul di top bar HP **tidak berkedip** saat navigasi (judul statis langsung benar); satu h1;
      judul tab unik.
- [ ] Bottom bar: aktif benar di `/panel`, `/panel/sites/blog` (Situs), `/dev` (Lainnya, `aria-expanded`, tanpa
      `aria-current`); tidak ada di peran `user`; **hilang di `/panel/sites/new`**.
- [ ] Super Admin login di HP → Ringkasan, slot 1 aktif.
- [ ] Sheet "Lainnya" tertutup setelah memilih Profil, dan setelah mengetuk halaman yang sedang dibuka.
- [ ] 360×640: elemen tetap ≤ 120 px di Ringkasan, detail situs, wizard, editor env; toast tidak menutupi `ActionBar`.
- [ ] Kartu `DataTable` di 360 px mengikuti §5.2b di semua daftar (Situs, Layanan, Aplikasi, Domain, Cadangan,
      Pengguna).
- [ ] Keyboard: setelah navigasi `document.activeElement.id === "page-title"`; TalkBack/VoiceOver membacakan judul satu
      kali; `StaleNotice` dibacakan sekali walau terlihat > 2 menit.
- [ ] Target sentuh (emulasi `pointer: coarse`) ≥ 44 px untuk tombol aksi, item nav, hit-area salin; desktop tetap 36 px.
- [ ] Toast di atas bottom bar/ActionBar di HP, kanan bawah di desktop, bertahan saat pindah `/panel` → `/dev`.
- [ ] Polling: tab tersembunyi 60 dtk = 0 request; kembali → 1 request; server mati → 10/20/40/60 dtk + `StaleNotice`.
- [ ] ConfirmAction: typed menolak "Blog" untuk `blog`; keyboard HP tidak mengkapitalkan; error server di dialog;
      Escape tidak menutup saat pending; restart panel: dialog tertutup segera setelah 202.
- [ ] 403 saat dialog terbuka (turunkan peran di tab lain) → berakhir di `/profile`, bukan landing.
- [ ] LogViewer: unpin tanpa lompatan; "Baris baru (n)" tidak pernah negatif saat rotasi; cari menyorot; wrap default
      sesuai lebar; salin/unduh benar; poll 3 dtk dengan 2.000 baris tidak membuat jank (Performance panel: render per
      poll < 16 ms di emulasi CPU 4× lebih lambat).
- [ ] Chunk: build ulang + restart saat tab terbuka, buka area belum dimuat → reload sekali dan berhasil; server mati →
      pesan chunk.
- [ ] Tamu `/hargaa` → 404 publik; tamu `/panel` → `/login`; dengan Access (produksi) → tantangan Access.
- [ ] Kontras: Lighthouse a11y ≥ 95 per jenis halaman di kedua tema.

---

## 7. Rencana kerja

Diselaraskan dengan jadwal `PLAN/debate/00-integration-critique.md` (W0 kontrak → W1 modul murni/server dasar → W2
layanan + shell layout → W3 halaman → W4 pembersihan). Nama worker shell bisa dipetakan oleh koordinator ke nama
integrasi (`wkr-shell-found-01` = core + ui + log; `wkr-shell-layout-02` = nav).

### 7.0 Matriks kepemilikan lintas PLAN (usulan untuk arbitrase)

| File / artefak                                                                                               | Pemilik                                                | Gelombang |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------- |
| `src/shared/log.types.ts` (`LogLine`, `LogChunk` §3.4)                                                       | `wkr-contracts-00`                                     | W0        |
| `src/shared/roles.ts` (`isProtectedPath`, `SPA_ROOTS`, `isKnownSpaPath`, `homeFor` super_admin)              | `wkr-contracts-00`                                     | W0        |
| `src/shared/{log.time,format.id}.ts`                                                                         | `wkr-shell-core-01`                                    | W1        |
| `src/web/i18n/{id.ts,id.shell.ts,id.common.ts,id.status.ts}`                                                 | `wkr-shell-core-01`, lalu beku sampai W4               | W1        |
| `src/web/components/*`, `components/ui/*`, `styles.css`, `shared/{query.state,confirm.dialog}.tsx`           | `wkr-shell-ui-01` / `wkr-shell-log-01`                 | W1        |
| `src/server/http/spa.serve.ts` (header §3.12, B11)                                                           | `wkr-http-01` (PLAN-04)                                | W1        |
| `src/web/{router,app.routes}.tsx`, `layout/*`, `session/*`, `pages/{route-error,not-found,public-not-found}` | `wkr-shell-nav-02`                                     | W2        |
| `panel/panel.routes.tsx`, `site/site.routes.tsx`, `backup/backup.routes.tsx`, `dev/dev.routes.tsx`           | dibuat `wkr-shell-nav-02` (W2); milik PLAN 02/03/04/05 | W2 → W3   |
| `*.status-key.ts` per domain                                                                                 | PLAN pemilik union                                     | W3        |
| File i18n domain (`id.panel`, `id.site`, …) dan file i18n baru domain                                        | PLAN domain (impor langsung, tanpa `id.ts`)            | W3        |
| Penggabungan i18n baru ke `id.ts`, penghapusan kode lama, guard test                                         | `wkr-shell-cleanup-04`                                 | W4        |

Dihapus dari PLAN lain: `wkr-adm-routing-01` dan `public-not-found.page.tsx` (PLAN-05); `log.types.ts` dari
`wkr-mon-types-00` (PLAN-02); `useLogFollow` (PLAN-02); edit `id.ts` di gelombang halaman (PLAN-02/03/04/05).
`wkr-adm-i18n-01` (PLAN-05) tidak menyentuh `id.ts`: string login/profil yang ingin dipindah keluar `id.ts` dipindah di
W4.

### 7.1 W1 — fondasi shell (tiga worker paralel, file terpisah)

| Worker              | File (eksklusif)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Ukuran                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `wkr-shell-core-01` | `src/shared/{log.time,format.id}.ts`★, `src/web/shared/{poller★,use-poller★,use-api-query,use-log-follow★,format,chunk.error★,api.client,api.action}.ts`, `src/web/components/{status.vocab★,status.tone,log.buffer★,now.store★}.ts`, `src/web/i18n/{id.status★,id.shell,id.common,id}.ts` (semua copy key §3.14), `tests/{web.status,web.polling,log.time,web.log-buffer,format.id,web.api-client,web.chunk}.test.ts`, `tests/web.shell.test.ts` (bagian format) | M (±18 file, ±900 baris)   |
| `wkr-shell-ui-01`   | `src/web/components/{page-header,query-view★,error-state,empty-state,data-table,use-page-param★,search-field★,stat-tile,section,status-badge,status-icon★,relative-time,copy-button,confirm-action★,action-bar★}.tsx`, `src/web/components/ui/{button,input,select,dialog,sheet,sonner}.tsx`, `src/web/styles.css`, `src/web/shared/{query.state,confirm.dialog}.tsx` + satu baris import di pemakai `LegacyConfirmAction`                                        | L (±25 file, ±1.000 baris) |
| `wkr-shell-log-01`  | `src/web/components/{log-viewer,log-lines}.tsx`★                                                                                                                                                                                                                                                                                                                                                                                                                  | S (2 file, ±250 baris)     |

Ketiganya hanya berbagi tipe yang tertulis di PLAN ini; typecheck gabungan oleh orkestrator di akhir W1. Paralel dengan
`wkr-http-01` (header HTML) dan `wkr-contracts-00` sudah selesai di W0.

### 7.2 W2 — shell layout (`wkr-shell-nav-02`)

`src/web/layout/{app.layout,shell.page★,task.mode★,nav.badges★,mobile.topbar★,mobile.nav★,mobile.more★,nav.items,breadcrumbs,sidebar.nav,user.menu}.tsx/ts`,
hapus `layout/mobile.bar.tsx`, `src/web/session/{session.gate,session.redirect,session.fallback,session.error,session.api}.tsx/ts`,
`src/web/pages/{route-error,not-found,public-not-found★}.page.tsx`, `src/web/router.tsx`, `src/web/app.routes.tsx`★,
4 file route domain★ (isi = rute sekarang + `handle.title`), hapus `panel/panel.layout.tsx` & `dev/dev.layout.tsx`,
`src/web/index.html` (viewport), `scripts/build.ts` (`splitting`), satu baris `useDocumentTitle` di
`landing/landing.page.tsx` & `pages/login.page.tsx`, `docs/content-guide.md`, `tests/web.session.test.ts`,
`tests/web.shell.test.ts` (bagian breadcrumb). Ukuran L (±25 file, ±800 baris). Tergantung W1 core + ui.

Total shell W1+W2 ≈ 70 file, ±2.950 baris termasuk test (revisi dari ±30 file/1.700 baris).

### 7.3 W3 — migrasi halaman per domain (pemilik = PLAN lain, paralel)

Mulai setelah W1 core + ui (halaman log juga butuh log-01; tidak butuh nav-02 untuk isi halaman, tetapi file route
domain dari nav-02 harus sudah ada sebelum menambah rute). Worker W3 tidak mengubah file W1/W2 selain file route domain
miliknya.

| PLAN    | File                                                                                                                                           | Hasil wajib (template §5.6)                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| PLAN-02 | `src/web/panel/*` (termasuk `panel.routes.tsx`, `panel.status-key.ts`★, provider badge nav), `id.panel.ts`                                     | PageHeader + meta; StatTile; DataTable; StatusBadge; ConfirmAction; LogViewer + `useLogFollow`; string "lama" dihapus |
| PLAN-03 | `src/web/site/*`, `src/web/deploy/*` (termasuk `site.routes.tsx`, `job.status-key.ts`★, `deploy.status-key.ts`★), `id.site.ts`, `id.deploy.ts` | hapus situs dikelola = typed; `usePageParam`; token warna; `StatusIcon` langkah; wizard `handle.task` + `ActionBar`   |
| PLAN-04 | `src/web/backup/*` (termasuk `backup.routes.tsx`, `backup.status-key.ts`★), `id.backup.ts`                                                     | pulihkan menimpa = typed; kartu HP §5.2b                                                                              |
| PLAN-05 | `src/web/dev/*` (termasuk `dev.routes.tsx`), `pages/{login,profile}.page.tsx`, `src/web/landing/*`, `id.dev.ts`, `id.landing.ts`               | hapus pengguna = typed; ubah peran = AlertDialog; `/dev/logs` → LogViewer lama→baru; login §5.6                       |

### 7.4 W4 — pembersihan (`wkr-shell-cleanup-04`)

Hapus `shared/query.state.tsx`, `shared/stat.card.tsx`, `shared/confirm.dialog.tsx` (`LegacyConfirmAction`),
`dev/pager.tsx`, `dev/dev.pagination.ts`, `panel/status.badge.tsx`, `LEGACY_TONE`, `STATUS_TONE`/`toneForStatus` + prop
`status`, tipe `Tone` di `panel/panel.status.ts`, `id.common.empty`; gabung file i18n baru ke `id.ts`; kunci status
tambahan yang diminta tertulis; `tests/web.guard.test.ts`. Ukuran S. README/CHANGELOG (404 publik, beranda
super_admin, toast, bottom bar) ditulis sekali oleh worker dokumentasi akhir.

### 7.5 Ketergantungan lintas PLAN (wajib dihormati)

1. **Semua PLAN**: §3.15 dan template §5.6 berlaku harfiah; tier §3.2; mapping status di file domain sendiri.
2. **PLAN-02**: endpoint follow `?after=` → `LogChunk` (lama → baru) memakai `splitLogTimestamp`; `domainVerdict`
   mengembalikan `StatusKey` (+ kalimat), tabel label §5.6 PLAN-02 dihapus; restart `panel` = 202 + overlay; provider
   badge nav dari `/api/panel/status`; copy tanpa hitungan detik.
3. **PLAN-03**: `JobStatus`/`DeployStatus` + `interrupted` dipetakan di `job.status-key.ts`/`deploy.status-key.ts`;
   label job berjalan "Diproses…"; wizard/editor pakai `ActionBar` + rute tugas; tanpa chip/header lengket di HP;
   `AppLogTail.lines: LogLine[]`.
4. **PLAN-04**: `wkr-http-01` memenuhi tabel §3.12 (HTML `no-cache`, aset `immutable`, chunk hilang 404, `/__spa` 404); koreksi K17; kartu HP §5.2b.
5. **PLAN-05**: hapus `wkr-adm-routing-01` dan `public-not-found.page.tsx`; LogViewer pemiliknya PLAN-01; `homeFor`
   super_admin `/panel` (via `wkr-contracts-00`) + README §Layar; login/landing `useDocumentTitle`; perubahan
   `scripts/build.ts` (rilis) setelah W2, `splitting: true` tetap; `scripts/bundle-report.ts` dipakai `ci.yml`.

---

## 8. Risiko, asumsi, pertanyaan terbuka

### Risiko

| #   | Risiko                                                                                                                 | Mitigasi                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Tone `running` → info dan label baru mengubah tampilan semua halaman; test lama (`toneForStatus`, `LEGACY_TONE`) pecah | Tabel lama tetap sampai W4; test lama diganti di W1 core                                                                                              |
| R2  | Splitting terbukti di `--compile` lokal macOS, belum di `bun-linux-arm64-android`                                      | Smoke test di HP; bila gagal, matikan `splitting` (satu baris), `lazy` tetap valid                                                                    |
| R3  | Proksi/bundle internal untuk header aset (B11) menambah satu hop loopback per aset                                     | Hanya saat cache miss; aset `immutable` di browser dan edge; ukur TTFB chunk di HP (milik `wkr-http-01`)                                              |
| R4  | `pointer: coarse` tidak menangkap laptop layar sentuh                                                                  | Diterima: desktop ≥ 24 px (WCAG 2.5.8)                                                                                                                |
| R5  | Fokus ke h1 tiap navigasi terasa aneh bagi pengguna mouse                                                              | `outline-none`; `:focus-visible` tidak menyala untuk fokus programatik setelah klik                                                                   |
| R6  | Bottom bar/ActionBar `fixed` + keyboard virtual                                                                        | QA F5-7; bila menutupi input di iOS, sembunyikan saat `focusin` (hanya bila terbukti)                                                                 |
| R7  | Snapshot beku menyembunyikan baris baru dari pencarian saat unpin                                                      | Disengaja; "Baris baru (n)" memberi tahu                                                                                                              |
| R8  | "baru saja" < 60 dtk menyembunyikan hitungan detik                                                                     | Disengaja (D16); freshness lewat `StaleNotice`                                                                                                        |
| R9  | W3 menunggu W1 core + ui                                                                                               | W1 dipecah tiga worker paralel; nav (W2) tidak memblokir isi halaman                                                                                  |
| R10 | Mapping status tersebar di 4 file domain → kembali ke "tabel per domain"?                                              | Tidak: label/tone tetap satu tabel; domain hanya memilih kunci; review W3 menolak `TONE_CLASS` atau label status yang ditulis langsung di file domain |

### Asumsi

- A1: CSRF hotfix masuk; `apiFetch` mengirim `x-requested-with`; unduhan log GET.
- A2: Interval polling final ditetapkan PLAN domain.
- A3: `sessionStorage` biasanya tersedia; bila tidak, reload otomatis dilewati.
- A4: LICENSE (MIT), rilis v0.3.0, landing di luar PLAN ini; `include_secrets` default off tidak menyentuh shell.

### Pertanyaan terbuka untuk owner

Tidak ada. Q1 (beranda super_admin → Ringkasan, A11/B19), Q2 (tamu di URL tak dikenal → 404 publik, A7), Q3 ("baru
saja" < 1 menit, default berlaku), dan Q4 (`rolled_back` "Dikembalikan" warning, A10) sudah diputuskan.

---

## 9. Riwayat revisi

| Rev | Tanggal    | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | 2026-11-26 | Versi awal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1   | 2026-11-26 | Debat (`PLAN/debate/01-response.md`: 19 terima, 6 sebagian, 0 tolak). Mapping status ke file domain + kunci `interrupted`/`auth_required`/`unstable`/`tunnel_down`/`key_mismatch`; `rolled_back` "Dikembalikan" (Q4). Matriks kepemilikan §7.0; W1 jadi tiga worker paralel, ukuran direvisi ±70 file. Header cache disederhanakan ke HTML `no-cache` (P0) + P2. §3.15 rekonsiliasi nama. `usePoller` + `useLogFollow`. 403 → `/login`. Beranda super_admin `/panel` (Q1). Rute tugas + `ActionBar`. Anatomi kartu HP. 3 chunk + file route domain. `format.id.ts`. Parser hanya `svlogd -tt`. LogViewer dua file (fitur P2 ditunda, memo per `seq`). `StaleNotice` live region statis. Semantik "Lainnya". `ConfirmAction` tanpa `AlertDialogAction`, `onConfirm(typed)`, `LegacyConfirmAction`, resolve pada 202. `pointer-coarse:`. `bundle:check`. `RelativeTime` `aria-label`/`absolute`. Judul statis dari `handle.title`. Slot badge nav. |
| 2   | 2026-11-26 | Keputusan final `PLAN/DECISIONS.md`: `rolled_back` "Dikembalikan" dan `interrupted` "Terputus" tone **warning** (A10, B12); beranda super_admin `/panel` di semua ukuran, Q1/Q4 ditutup (A11, B19); header aset `immutable` + 404 chunk hilang + `/__spa` 404 masuk v0.3.0 oleh `wkr-http-01` (B11), reload chunk klien tetap; pemisah tanggal dan potong baris panjang di LogViewer dikembalikan (A8), Dialog layar penuh dibuang (tidak melayani fitur); kontrak log/poller (B13), 403 → `/login` (B20), 404 publik (A7) dikonfirmasi tanpa perubahan.                                                                                                                                                                                                                                                                                                                                                                                         |
