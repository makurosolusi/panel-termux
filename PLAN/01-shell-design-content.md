# PLAN 01 — App shell, design system, komponen bersama, konten & aksesibilitas

> wkr-plan-shell-01 · 2026-11-26 · branch `feature/production-polish` (HEAD 74fe380). Dokumen rencana; tidak ada kode
> produksi diubah. Menutup gap `R&D/01-shell-design-content.md` (disingkat **R1-Gn**) dan menetapkan **kontrak lintas
> PLAN** yang dipakai PLAN-02 (monitoring), PLAN-03 (situs/deploy), PLAN-04 (keamanan/cadangan), PLAN-05
> (admin/onboarding/landing).
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

| Area                                                                                                                                                                                                  | Menutup                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Kamus status tunggal + tabel tone/ikon (§3.1)                                                                                                                                                         | R1-G3, sebagian R1-G12        |
| Tier konfirmasi + `ConfirmAction` baru (§3.2)                                                                                                                                                         | R1-G8                         |
| API komponen bersama: `PageHeader`, `DataTable`, `StatTile`, `StatusBadge`, `StatusIcon`, `EmptyState`, `ErrorState`, `QueryView`, `SearchField`, `RelativeTime`, `CopyButton`, `usePageParam` (§3.3) | R1-G2, G4, G19, G20, G21, G22 |
| `LogViewer` bersama (monitoring, situs/deploy, admin) + tipe `LogLine` + parser timestamp svlogd/TAI64N (§3.4)                                                                                        | prasyarat R2-gap 9/17         |
| Aturan polling `useApiQuery` (§3.5)                                                                                                                                                                   | R1-G15, R2-gap 4              |
| Toast: satu `Toaster` (§3.6)                                                                                                                                                                          | R1-G9                         |
| Navigasi mobile, judul mobile, breadcrumb, judul tab, fokus & pengumuman route (§3.7, §4)                                                                                                             | R1-G1, G6, G7, G10, G18       |
| Target sentuh (§3.8), token & tipografi (§3.9), format angka/waktu (§3.10), string Inggris primitive                                                                                                  | R1-G11, G12, G13, G20, G23    |
| Code splitting + penanganan chunk gagal (§3.11)                                                                                                                                                       | R1-G14 (klien), G24           |
| Kontrak header cache aset ber-hash (server; implementasi oleh PLAN-04) (§3.12)                                                                                                                        | R1-G14 (server)               |
| Tamu di URL tak dikenal, session fallback/error (§3.13)                                                                                                                                               | R1-G16, G25                   |
| Gelombang 1 (fondasi, satu pemilik) + aturan migrasi halaman di gelombang 2 (milik PLAN lain) + gelombang 3 (pembersihan) (§7)                                                                        | R1-G2 strategi B+C            |

### Di luar ruang lingkup (dan siapa yang memegang)

- Isi halaman domain (Ringkasan, Layanan, Aplikasi, Domain, Database, log layanan/aplikasi) → **PLAN-02**; situs,
  wizard, perubahan, deploy → **PLAN-03**; cadangan, header keamanan server → **PLAN-04**; `/dev/*`, login, profil,
  landing → **PLAN-05**. PLAN ini hanya menetapkan komponen & aturan yang harus mereka pakai.
- **R1-G17 (login)**: dieksekusi PLAN-05; syarat shell untuk login ada di §5.6.
- **R1-G26 (badge masalah di item nav)**: ditunda (P2). Butuh sumber masalah murah yang tidak memaksa shell mem-poll
  `/api/panel/overview` di setiap halaman; tergantung bentuk `Problem` baru di PLAN-02. Tidak dibuat di sini.
- Endpoint log (`?after=` offset, unduh, redaksi) → PLAN-02/05. PLAN ini hanya tipe `LogLine` dan komponen.
- Tidak dibuat (YAGNI, dicatat supaya kritikus tidak menganggapnya terlupa): command palette, header sticky di detail,
  kolom tabel yang bisa di-sort, virtualisasi log (batas 2.000 baris cukup), pencarian log regex, pewarnaan ANSI,
  PWA/manifest, telemetri.

---

## 2. Keputusan

| #   | Keputusan                                                                                                                                                                                                                                                | Alternatif                                                                      | Alasan                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Status = kunci kanonik** (`StatusKey`, 23 kunci) → `{label, tone, pulse, icon}` dari satu tabel. Pemetaan state mentah → kunci ada di satu file `components/status.vocab.ts` per jenis resource.                                                       | (a) tabel string global `toneForStatus` (sekarang); (b) tabel per domain (lama) | String yang sama punya arti beda (`down` layanan vs app, `running` job vs app); tabel per domain sudah terbukti saling bertentangan (R1 §2.5). Kunci kanonik membuat tone tidak bisa "dikarang" di domain.                      |
| D2  | Mati **disengaja** = "Dihentikan" (netral); mati **tak disengaja** = "Mati" (danger). Teks berbeda, bukan hanya warna.                                                                                                                                   | Satu label "Mati" dengan dua warna (sekarang)                                   | WCAG 1.4.1; benchmark §11.                                                                                                                                                                                                      |
| D3  | `running` job/deploy/cadangan = **"Diproses…" tone info** + titik berdenyut. Step yang di-undo = "Dibatalkan" (warning); job/deploy `rolled_back` = "Gagal, dibatalkan" (danger).                                                                        | warning untuk semua yang berjalan (tabel lama)                                  | Benchmark §11: kuning = perlu perhatian, biru = sedang diproses. Bagi pengguna, perubahan yang di-rollback tetap gagal; step yang berhasil di-undo bukan kegagalan tersendiri.                                                  |
| D4  | Tiga tier konfirmasi: **tanpa** / **AlertDialog** / **ketik nama**. Error aksi yang dikonfirmasi tampil **di dalam dialog** (dialog tetap terbuka), bukan hanya toast.                                                                                   | Undo-toast                                                                      | Hapus situs menjalankan job sistem (pm2, cloudflared, DNS) yang tidak bisa ditunda murah. Error penting tidak boleh hilang dalam 4 dtk (benchmark §9).                                                                          |
| D5  | **Navigasi mobile: bottom bar** 4 tujuan + "Lainnya" (sheet bawah) untuk peran yang punya `/panel`. Peran `user` tanpa bottom bar. Super Admin memakai 4 tujuan yang sama; Administrasi ada di urutan pertama sheet "Lainnya".                           | (a) hamburger + judul (opsi B R1); (b) "Kesehatan sistem" menggantikan Aplikasi | Halaman harian 1 ketukan (benchmark §1). Label "Administrasi" terlalu panjang untuk 5 slot di 360 px, dan "Admin" bentrok dengan nama peran. Saat di `/dev`, tab "Lainnya" tampil aktif. Owner boleh menukar (Q1).              |
| D6  | **Judul halaman di mobile = top bar** (48 px, sticky) yang menampilkan judul dari `PageHeader` + tombol kembali di detail. `<h1>` tetap ada di DOM tetapi `sr-only` di < md (tidak dobel di layar).                                                      | h1 terlihat + judul di bar (dobel); iOS large-title collapse                    | Satu sumber judul (`PageHeader`), selalu terlihat, tanpa kode IntersectionObserver.                                                                                                                                             |
| D7  | **Pengumuman route = fokus ke `<h1>`** setelah pathname berubah (bukan pada load pertama, bukan saat hanya query/hash berubah). Tidak ada live region terpisah.                                                                                          | live region + fokus (dobel dibaca); live region saja                            | Pembaca layar membacakan heading yang difokus; live region tambahan membuat judul dibaca dua kali. Pola GOV.UK.                                                                                                                 |
| D8  | Target sentuh **≥ 44 px pada `pointer: coarse`** (varian Tailwind `coarse:`); desktop tetap padat (32–36 px). Tombol ikon kecil dalam teks memakai hit-area pseudo-element, tampilan tetap 24 px.                                                        | Berdasar lebar layar (`max-md:`)                                                | Yang menentukan adalah jari, bukan lebar. Default brief (≥ 44 px).                                                                                                                                                              |
| D9  | **Polling**: rantai `setTimeout` (bukan `setInterval`), single-flight (tick dilewati saat request jalan, tidak di-abort), jeda saat tab tersembunyi, langsung ambil saat kembali terlihat bila basi, backoff ×2 maks 60 dtk.                             | SSE/WebSocket                                                                   | R2 §6.2 opsi B; push dari server di belakang tunnel + HP tidur rawan putus. Abort request lambat membuat overview tak pernah selesai (R2-gap 4).                                                                                |
| D10 | **Satu `Toaster`** di elemen root (`SessionGate`), `bottom-right` desktop, bawah selebar layar di HP di atas bottom bar; tanpa `richColors`; error toast 8 dtk + tombol tutup.                                                                           | top-center (sekarang)                                                           | Toast tidak hilang saat pindah area, ada di landing/login/profil, tidak menutupi judul.                                                                                                                                         |
| D11 | **Code splitting per area** (landing, login, shell, panel, dev, profil) dengan `lazy` React Router + `splitting: true`. i18n tetap di chunk bersama.                                                                                                     | per halaman (±20 chunk, 1 RTT tiap halaman pertama via tunnel); tanpa split     | Nilai utama: landing tidak memuat panel (R5 G21). Per area = 1 RTT per area. Terverifikasi jalan di Bun 1.4.2.                                                                                                                  |
| D12 | **Chunk gagal dimuat** → muat ulang otomatis **sekali** (guard 30 dtk di `sessionStorage`), lalu pesan "Bagian panel ini gagal dimuat" + tombol.                                                                                                         | Pesan saja                                                                      | Setelah deploy panel, tab lama yang belum menyimpan chunk area baru pasti gagal; reload sekali hampir selalu menyelesaikannya. Guard mencegah loop (pola sama dengan reload Access).                                            |
| D13 | **Header cache** (kontrak, implementasi PLAN-04): aset ber-hash `public, max-age=31536000, immutable` + `nosniff`; HTML `no-cache`; aset yang tidak ada → 404 `text/plain`, `no-store` (bukan HTML SPA).                                                 | Hanya mengandalkan TTL Cloudflare 4 jam                                         | Nama aset berbasis isi → aman di-cache selamanya. HTML harus selalu divalidasi agar tab baru mendapat chunk baru. 404 HTML membuat `import()` gagal dengan error MIME yang membingungkan.                                       |
| D14 | **Tamu di URL tak dikenal → halaman 404 publik** (dengan "Ke beranda" dan "Masuk"); tamu di area terlindungi (`/panel*`, `/dev*`, `/profile*`) → `/login` seperti sekarang. Override R&D: README + CHANGELOG ikut diubah.                                | (a) landing (kata README); (b) `/login` (kode sekarang)                         | Owner: `/` adalah halaman produk untuk orang luar; mendorong orang asing ke login bertentangan dengan itu. Mengalihkan diam-diam ke landing menyembunyikan typo URL. **Flag**: mengubah kontrak yang tertulis di README §Layar. |
| D15 | **`QueryView` baru** di `components/query-view.tsx` dengan prop `empty` **wajib**; lima state eksklusif (memuat / gagal pertama / data + gagal perbarui / kosong / isi). `QueryView` lama tetap ada sampai gelombang 3, isinya diganti ke komponen baru. | Ubah signature lama langsung (memecah 20 pemanggil di file milik PLAN lain)     | Strategi B+C R1: visual seragam segera, teks kosong spesifik dipaksa compiler saat tiap halaman pindah.                                                                                                                         |
| D16 | Format: relatif < 60 dtk = "baru saja"; GB/TB **selalu** 1 desimal ("232,0 GB"); jam log "21.54.07" (titik, sesuai guide). Contoh "Diperbarui 12 dtk lalu" di content guide diganti "Diperbarui 3 mnt lalu".                                             | Pertahankan "< 10 dtk"                                                          | Content guide bertentangan dengan dirinya sendiri; aturan tabel ("di bawah 1 menit baru saja") dipilih karena lebih tenang untuk halaman yang di-poll tiap 10 dtk. Hitungan detik ("12 dtk lalu") sengaja tidak pernah tampil.  |
| D17 | Parsing timestamp log di **modul bersama `src/shared/log.time.ts`** (dipakai server PLAN-02/05), klien hanya memformat `at` ISO ke jam lokal.                                                                                                            | Parsing di klien                                                                | Server sudah membaca file; satu parser teruji; payload `{at,text}` lebih kecil dari string ganda.                                                                                                                               |
| D18 | Destructive dark tetap `dark:bg-destructive/60` + putih (5,99:1 terukur).                                                                                                                                                                                | Ganti ke `bg-danger` + tinta gelap (7,27:1)                                     | Sudah lolos AA; perubahan visual tanpa alasan. Komentar rasio ditambahkan di `styles.css`.                                                                                                                                      |

---

## 3. Model data & kontrak API

Tidak ada tabel DB, migrasi, endpoint, atau settings key baru di PLAN ini (semuanya UI/kontrak klien). Satu-satunya
perubahan server adalah header (§3.12) yang diimplementasikan PLAN-04. Semua tipe di bawah adalah **kontrak**; nama file
adalah lokasi final.

### 3.1 Kamus status (D1–D3)

`src/web/components/status.vocab.ts` (baru):

```ts
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "./status.tone";

/** Canonical display state; every badge/dot/icon in the panel is one of these. */
export type StatusKey =
  | "running" | "healthy" | "succeeded" | "done"
  | "stopped" | "pending" | "skipped" | "unchecked" | "not_deployed" | "unknown"
  | "starting" | "restarting" | "attention" | "partial" | "undone" | "not_configured"
  | "down" | "errored" | "failed" | "unhealthy" | "rolled_back" | "crash_loop"
  | "processing";

/** Resolved status for rendering. `label` comes from `id.status`. */
export type StatusView = { key: StatusKey; label: string; tone: StatusTone; pulse: boolean; icon: LucideIcon };

export function statusView(key: StatusKey): StatusView;

// Raw state → key. The ONLY place that decides what a raw state means on screen.
export function serviceStatusKey(s: Pick<Service, "state" | "wantUp">): StatusKey;
export function appStatusKey(status: SiteAppStatus): StatusKey;          // AppStatus | "not_deployed"
export function domainHealthKey(h: DomainHealth): StatusKey;
export function jobStatusKey(status: JobStatus): StatusKey;
export function jobStepStatusKey(status: JobStepStatus): StatusKey;
export function deployStatusKey(status: DeployStatus): StatusKey;
export function backupRunStatusKey(status: BackupRunStatus): StatusKey;
export function backupSummaryKey(summary: BackupSummary): StatusKey;     // from web/backup/backup.state.ts
export const PROBLEM_TONE: Record<ProblemSeverity, StatusTone>;          // warning → warning, danger → danger
export const LOG_LEVEL_TONE: Record<LogLevel, StatusTone>;               // debug/info neutral, warn warning, error danger
```

**Tabel kanonik** (label di `src/web/i18n/id.status.ts`, `satisfies Record<StatusKey, string>`):

| Kunci            | Label                | Tone    | Denyut | Ikon (`lucide-react`) | Arti                                                            |
| ---------------- | -------------------- | ------- | ------ | --------------------- | --------------------------------------------------------------- |
| `running`        | Berjalan             | success | –      | `CircleCheckIcon`     | Proses hidup sesuai keinginan                                   |
| `healthy`        | Sehat                | success | –      | `CircleCheckIcon`     | Domain menjawab 2xx/3xx                                         |
| `succeeded`      | Berhasil             | success | –      | `CircleCheckIcon`     | Perubahan/deploy/cadangan selesai baik                          |
| `done`           | Selesai              | success | –      | `CircleCheckIcon`     | Satu langkah perubahan selesai                                  |
| `stopped`        | Dihentikan           | neutral | –      | `CircleMinusIcon`     | Mati **disengaja**                                              |
| `pending`        | Menunggu             | neutral | –      | `CircleDashedIcon`    | Langkah belum mulai                                             |
| `skipped`        | Dilewati             | neutral | –      | `CircleMinusIcon`     | Langkah tidak perlu                                             |
| `unchecked`      | Belum dicek          | neutral | –      | `CircleDashedIcon`    | Health belum pernah diperiksa                                   |
| `not_deployed`   | Belum di-deploy      | neutral | –      | `CircleDashedIcon`    | Situs tanpa proses pm2                                          |
| `unknown`        | Tidak diketahui      | neutral | –      | `CircleHelpIcon`      | Tidak bisa dibaca (`sv` fail, pm2 unknown)                      |
| `starting`       | Memulai…             | warning | ya     | `LoaderCircleIcon`    | pm2 `launching`                                                 |
| `restarting`     | Memulai ulang…       | warning | ya     | `LoaderCircleIcon`    | runit `finish` (run script keluar, runsv akan menjalankan lagi) |
| `attention`      | Perlu dicek          | warning | –      | `TriangleAlertIcon`   | Domain 4xx (mis. 401/403 dari Access), anomali non-fatal        |
| `partial`        | Sebagian gagal       | warning | –      | `TriangleAlertIcon`   | Cadangan `partial`                                              |
| `undone`         | Dibatalkan           | warning | –      | `Undo2Icon`           | Langkah berhasil di-undo                                        |
| `not_configured` | Belum diatur         | warning | –      | `TriangleAlertIcon`   | Cadangan belum dikonfigurasi                                    |
| `down`           | Mati                 | danger  | –      | `OctagonXIcon`        | Layanan mati padahal `wantUp`                                   |
| `errored`        | Bermasalah           | danger  | –      | `OctagonXIcon`        | pm2 `errored` (glosarium)                                       |
| `failed`         | Gagal                | danger  | –      | `OctagonXIcon`        | Perubahan/langkah/deploy/cadangan gagal                         |
| `unhealthy`      | Tidak sehat          | danger  | –      | `OctagonXIcon`        | Domain 5xx/530 atau tanpa jawaban                               |
| `rolled_back`    | Gagal, dibatalkan    | danger  | –      | `OctagonXIcon`        | Job/deploy gagal lalu perubahan dikembalikan                    |
| `crash_loop`     | Mulai ulang berulang | danger  | –      | `RefreshCwOffIcon`    | Dicadangkan untuk deteksi PLAN-02 (restart loop)                |
| `processing`     | Diproses…            | info    | ya     | `LoaderCircleIcon`    | Job/deploy/cadangan sedang berjalan                             |

Tone `accent` tidak dipakai untuk status (hanya `RoleBadge` Super Admin). Oranye brand tidak pernah untuk status.

**Pemetaan mentah → kunci (gelombang 1, dari tipe `src/shared/*` sekarang):**

| Sumber                     | Mentah → kunci                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Service`                  | `run`→`running`; `down`+`wantUp`→`down`; `down`+`!wantUp`→`stopped`; `finish`→`restarting`; `unknown`→`unknown`                                           |
| `SiteAppStatus`            | `online`→`running`; `stopped`→`stopped`; `errored`→`errored`; `launching`→`starting`; `unknown`→`unknown`; `not_deployed`→`not_deployed`                  |
| `DomainHealth`             | `checkedAt=null`→`unchecked`; `status=null`→`unhealthy`; 200–399→`healthy`; 400–499→`attention`; ≥500→`unhealthy` (sama dengan severity server, R2-gap 2) |
| `JobStatus`/`DeployStatus` | `running`→`processing`; `succeeded`→`succeeded`; `failed`→`failed`; `rolled_back`→`rolled_back`                                                           |
| `JobStepStatus`            | `pending`→`pending`; `running`→`processing`; `done`→`done`; `failed`→`failed`; `rolled_back`→`undone`; `skipped`→`skipped`                                |
| `BackupRunStatus`          | `running`→`processing`; `succeeded`→`succeeded`; `failed`→`failed`; `partial`→`partial`                                                                   |
| `BackupSummary`            | `not_configured`→`not_configured`; `running`→`processing`; `last_failed`→`failed`; `last_partial`→`partial`; `never`→`pending`; `ok`→`succeeded`          |

Aturan perubahan: kunci baru hanya lewat PR ke `status.vocab.ts` + `id.status.ts`. Di gelombang 2 **hanya worker
PLAN-02** boleh mengubah dua file itu (mis. memakai verdict domain dari server atau `crash_loop`); PLAN lain yang butuh
kunci baru harus mencantumkannya di PLAN-nya sekarang supaya masuk gelombang 1.

`StatusBadge` menerima `state?: StatusKey` (label/tone/pulse diambil dari kamus; `label` boleh menimpa, mis. "Gagal ·
3×"). Prop string `status` lama dan `toneForStatus`/`STATUS_TONE`/`LEGACY_TONE` dihapus di gelombang 3.

`src/web/components/status-icon.tsx` (baru): `StatusIcon({ state, className })` → ikon dari tabel, warna `TONE_TEXT`,
`motion-safe:animate-spin` untuk kunci berdenyut, `aria-hidden` + `<span className="sr-only">{label}</span>`. Dipakai
daftar langkah perubahan, daftar masalah, baris audit — tempat badge terlalu berat.

### 3.2 Tier konfirmasi (D4)

**Aturan pemilihan tier** (untuk aksi baru): data hilang permanen atau semua situs padam → **ketik nama**; mengganggu
tapi bisa dipulihkan → **AlertDialog**; aman/idempoten/hanya membaca → **tanpa**.

| Tier            | Aksi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pemilik halaman |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Tanpa**       | Mulai layanan/aplikasi · Muat ulang data · Salin · Unduh log/cadangan (tetap diaudit server) · Cadangkan sekarang · Uji koneksi/token · Kirim notifikasi uji · Simpan pengaturan · Buat situs (langkah Ringkasan wizard = konfirmasinya) · Batalkan unggahan yang sedang berjalan · Keluar                                                                                                                                                                                                                  | semua           |
| **AlertDialog** | Hentikan layanan/aplikasi biasa · Mulai ulang layanan/aplikasi (termasuk layanan terlindungi; body memuat peringatan akibat: cloudflared = semua domain putus sebentar, pm2 = semua aplikasi ikut mulai ulang, postgres = situs ber-DB terputus, panel = alur khusus PLAN-02) · Kembalikan versi sebelumnya (rollback) · Ubah peran (naik ke Admin: body menyebut "setara pemilik HP") · Cabut sesi / Keluar dari semua perangkat · Hapus domain dari situs · Pulihkan ke database **baru** (tidak menimpa) | 02, 03, 04, 05  |
| **Ketik nama**  | Hapus situs (ketik nama situs) · Hapus pengguna (ketik email) · Pulihkan yang **menimpa** data (ketik nama database) · Hentikan layanan terlindungi (`panel.protected_services`, default baru termasuk `pm2`, `postgres`; ketik nama layanan) — layanan yang tetap ditolak server untuk dihentikan diputuskan PLAN-02                                                                                                                                                                                       | 02, 03, 04, 05  |

**Kontrak komponen** `src/web/components/confirm-action.tsx` (baru; menggantikan `shared/confirm.dialog.tsx` di
gelombang 3):

```ts
type ConfirmBase = {
  title: string; // pertanyaan: "Hapus situs blog?"
  description: ReactNode; // akibat dulu, lalu apa yang tetap aman
  confirmLabel: string; // kata kerja + objek: "Hapus situs blog"
  destructive?: boolean; // tombol varian merah
  codes?: ErrorCodes; // pesan per kode error dari server
  onConfirm: () => Promise<unknown>; // reject (ApiError) = dialog tetap terbuka + error inline
  successToast?: string; // toast bentuk lampau setelah resolve: "Situs blog dihapus."
  trigger?: ReactElement; // satu tombol; dihilangkan bila dibuka dari menu "⋯"
  open?: boolean; // mode terkontrol (item DropdownMenu)
  onOpenChange?: (open: boolean) => void;
};
export type ConfirmActionProps =
  | (ConfirmBase & { tier?: "confirm" })
  | (ConfirmBase & { tier: "typed"; typedValue: string });

/** Exact match after trimming outer whitespace; case-sensitive. */
export const typedMatches = (input: string, expected: string): boolean => input.trim() === expected;
```

Perilaku wajib:

1. Tombol konfirmasi `disabled` sampai `typedMatches` (tier typed). `Enter` di input = konfirmasi bila cocok.
2. Input typed: `autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}`, `font-mono`, label
   `id.shell.confirm.typedLabel(value)` dengan nilai dalam `<code>`, hint "Huruf besar-kecil harus sama." (keyboard HP
   mengkapitalkan huruf pertama secara default — tanpa `autoCapitalize="off"` "Blog" ≠ "blog").
3. Saat `onConfirm` berjalan: kedua tombol `disabled`, tombol konfirmasi menampilkan spinner + label tetap;
   `Escape`/klik overlay **tidak** menutup (`onEscapeKeyDown`/`onPointerDownOutside` → `preventDefault` saat pending).
   Klik ganda tidak memanggil `onConfirm` dua kali.
4. Reject → pesan `apiErrorMessage(err, codes)` di bawah deskripsi, `role="alert"`, input tidak dikosongkan.
5. Resolve → dialog tertutup, `toast.success(successToast)`, fokus kembali ke trigger (radix). Bila halaman berpindah
   (mis. situs terhapus → daftar), manajer fokus route (§3.7) yang menang.
6. Tier typed: deskripsi wajib memuat `id.shell.confirm.irreversible` bila memang tidak bisa dibatalkan.
7. Copy: judul & tombol mengulang kata kerja yang sama (content guide). Tidak ada "OK"/"Ya".

### 3.3 Komponen bersama — API

Semua di `src/web/components/`. Props yang tidak disebut = tidak berubah dari kode sekarang.

**`PageHeader`** (`page-header.tsx`, diubah):

```ts
export type PageMeta = {
  updatedAt?: string | Date | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  live?: boolean;
};
export function PageHeader(props: {
  title: string; // h1 + judul tab + judul top bar mobile + crumb terakhir
  description?: ReactNode;
  status?: ReactNode; // StatusBadge di samping judul (halaman detail)
  actions?: ReactNode; // aksi utama; di HP pindah ke bawah judul
  meta?: PageMeta; // "Diperbarui 3 mnt lalu" + tombol muat ulang
  back?: { to: string; label: string }; // induk daftar; HP: tombol "‹" di top bar
  className?: string;
}): JSX.Element;
```

- Render `<h1 id="page-title" tabIndex={-1} className="… outline-none max-md:sr-only">`. Ukuran `text-xl sm:text-2xl
  font-semibold tracking-tight`.
- Mendaftarkan `{ title, back }` ke shell lewat `useShellPage()` (§3.7); efek dibersihkan saat unmount.
- **Wajib di setiap halaman kecuali landing dan login**, dirender di luar `QueryView` (judul tidak menunggu data). Judul
  detail yang tergantung data memakai nilai dari URL dulu (`blog`), lalu nama dari data bila berbeda (job: "Perubahan"
  → "Deploy blog").
- Tombol refresh `meta` memakai `size="icon-sm"` (hit-area 44 px di coarse, §3.8).

**`QueryView`** (`query-view.tsx`, baru):

```ts
export function QueryView<T>(props: {
  query: ApiQuery<T>;
  empty: ReactNode; // WAJIB. EmptyState spesifik; null hanya bila data tak mungkin kosong
  isEmpty?: (data: T) => boolean; // default: array kosong, atau { items: [] } (Page<T>)
  codes?: ErrorCodes;
  skeleton?: ReactNode; // default <RowsSkeleton />
  children: (data: T) => ReactNode;
}): JSX.Element;
```

| State                 | Kondisi                        | Render                                                                                                                              |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Memuat                | `data === undefined && !error` | `skeleton` (`aria-busy`)                                                                                                            |
| Gagal pertama         | `data === undefined && error`  | `ErrorState` title `id.common.errorTitles[kind]`, description `apiErrorMessage(error, codes)`, `onRetry=reload`, `retrying=loading` |
| Data + gagal perbarui | `data && error`                | `StaleNotice` (bar `warning-subtle`, `role="status"`): `id.shell.stale(rel)` + "Coba lagi", lalu `children(data)`                   |
| Kosong                | `data && isEmpty(data)`        | `empty`                                                                                                                             |
| Isi                   | lainnya                        | `children(data)`                                                                                                                    |

`StaleNotice` mengganti pola lama yang menaruh `ErrorState` penuh di atas data basi.

**`ErrorState`** (diubah): tambah `compact?: boolean` (satu baris, untuk bagian halaman yang gagal sendiri — "partial"
di Ringkasan). Bentuk lain tetap.

**`EmptyState`**: tetap (judul + deskripsi + aksi). Aturan konten: judul = apa isi bagian ini, deskripsi = kenapa
kosong/apa gunanya, aksi = satu CTA primer. Untuk filter tanpa hasil: judul `id.shell.noResults.title`, aksi
"Hapus filter".

**`DataTable`** (diubah; 0 pemakai sekarang, jadi bebas diubah):

```ts
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  primary?: boolean;
  hideOnMobile?: boolean;
};
export type DataPagination = { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void };
export function DataTable<T>(props: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[]; // data sudah dimuat (state dimuat/gagal = QueryView)
  rowKey: (row: T) => string;
  label: string; // aria-label tabel/list
  rowHref?: (row: T) => string; // seluruh baris/kartu jadi link (stretched link di sel primary)
  actions?: (row: T) => ReactNode; // sel terakhir desktop; footer kartu di HP; di atas link (z-10)
  rowTone?: (row: T) => StatusTone | undefined; // garis kiri 2 px tone untuk baris bermasalah
  empty?: ReactNode; // rows.length === 0 (mis. filter tanpa hasil)
  toolbar?: ReactNode;
  pagination?: DataPagination;
  className?: string;
}): JSX.Element;
```

- `loading`/`error` dihapus dari `DataTable` — satu tempat state (`QueryView`).
- Urutan baris = tanggung jawab pemanggil (bermasalah dulu). Tidak ada sort bawaan.
- Kolom aksi: header `sr-only` "Aksi". Di HP: kartu `min-h-14`, aksi di baris bawah `border-t pt-2 flex gap-2`.
- Pagination: `<nav aria-label="Paginasi">` + "Halaman 2 dari 5 · 87 entri" (`total` opsional).
- `usePageParam()` (`use-page-param.ts`, baru): `[page, setPage]` terikat `?page=` (≥ 1, nilai rusak → 1).
  Menggantikan `dev/pager.tsx` + `dev/dev.pagination.ts` (dihapus gelombang 3; `pageCount` dipindah ke file ini).

**`SearchField`** (`search-field.tsx`, baru): `({ value, onChange, label, placeholder })` → `<input type="search">`
dengan ikon kaca pembesar, label `sr-only`, `enterKeyHint="search"`, `Escape` mengosongkan. Debounce = tanggung jawab
pemanggil bila memukul server; filter klien langsung.

**`StatTile`** (diubah): nilai `text-xl` tanpa `truncate` (boleh wrap), `hint` `line-clamp-2`. Ambang tetap.
`Progress` shadcn tidak boleh dipakai untuk status (brand oranye) — pakai `StatTile progress`.

**`Section`**: h2 menjadi `text-base font-semibold` (skala benchmark §11).

**`RelativeTime`** (diubah): satu jam bersama `useNow()` di `now.store.ts` (baru) — `useSyncExternalStore`, satu
`setInterval` 15 dtk yang hanya hidup selama ada subscriber dan dijeda saat tab tersembunyi. 50 baris audit = 1 timer.

**`CopyButton`** (diubah): `value: string | (() => string)` (log besar tidak di-join tiap render); hit-area 44 px di
coarse.

**`StatusBadge`**: lihat §3.1. **`KeyValue`, `InlineCode`, `RoleBadge`, `UserAvatar`, skeletons**: tetap.

### 3.4 LogViewer (bersama PLAN-02, PLAN-03, PLAN-05)

**Tipe bersama** `src/shared/log.types.ts` (baru):

```ts
import type { LogLevel } from "./dev.types";
/** One log line as shown; `at` = ISO-8601 UTC when the line carried a timestamp we could parse. */
export type LogLine = { at: string | null; text: string; stream?: "out" | "err"; level?: LogLevel };
```

Endpoint log (PLAN-02 untuk layanan/aplikasi, PLAN-05 untuk `/dev/logs`, PLAN-03 untuk output langkah) mengembalikan
`LogLine[]` (urutan **lama → baru**). `/dev/logs` berpindah ke urutan lama → baru (konvensi terminal).

**Parser** `src/shared/log.time.ts` (baru, dipakai server):

```ts
/** Splits a leading svlogd -tt / TAI64N / ISO-with-zone timestamp off a raw line; unknown → { at: null, text: raw }. */
export function splitLogTimestamp(raw: string): { at: string | null; text: string };
```

| Format                         | Pola (di awal baris, diikuti satu spasi)                                          | Konversi                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svlogd -tt` (dipakai HP)      | `^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.\d{1,9} ` mis. `2026-11-26_13:54:24.23463` | UTC; pecahan dipotong ke milidetik                                                                                                                                      |
| `svlogd -t` (TAI64N)           | `^@[0-9a-f]{24} ` (16 hex detik + 8 hex nanodetik)                                | `unix = BigInt("0x"+16hex) − (2n**62n + 10n)`; runit menulis label sebagai `2^62 + 10 + unix_time` (`tai_unix`), jadi pengurangan ini eksak dan tanpa tabel leap second |
| ISO 8601 ber-zona              | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z                                   | [+-]\d{2}:?\d{2})[:\s]`                                                                                                                                                 | `Date.parse` |
| Lain (termasuk pm2 tanpa zona) | –                                                                                 | `at: null`, teks utuh (tidak menebak zona)                                                                                                                              |

Tanggal tidak valid (bulan 13, `Date` NaN) → `at: null`, baris utuh. Isi baris yang sudah memuat jam lokal sendiri
(umum di log aplikasi) dibiarkan.

**Buffer klien** `src/web/components/log.buffer.ts` (baru, murni & teruji):

```ts
export const LOG_MAX_LINES = 2_000;
export const LOG_LINE_DISPLAY_MAX = 4_000; // karakter; sisanya hanya di Salin/Unduh
export type BufferedLogLine = LogLine & { seq: number }; // seq naik terus, untuk "Baris baru (n)"
export function appendLogLines(
  prev: readonly BufferedLogLine[],
  incoming: readonly LogLine[],
  max?: number,
): BufferedLogLine[];
export function filterLogLines(lines: readonly BufferedLogLine[], query: string): BufferedLogLine[]; // substring, abaikan huruf besar-kecil
export function logToText(lines: readonly LogLine[]): string; // "2026-11-26 21:54:07 teks" (jam lokal), baris tanpa at = teks saja
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
```

**Komponen** `src/web/components/log-viewer.tsx` (+ `log-viewer.toolbar.tsx`, `log-lines.tsx` agar tiap file < 200
baris):

```ts
export type LogStreamFilter = "all" | "out" | "err";
export function LogViewer(props: {
  label: string; // "Log sshd" — aria-label + dasar nama file unduhan
  lines: readonly BufferedLogLine[]; // lama → baru, sudah dibatasi appendLogLines
  loading?: boolean; // muat pertama → RowsSkeleton di area log
  error?: ReactNode; // di atas area; baris lama tetap tampil
  empty: ReactNode; // "Belum ada log untuk sshd." (spesifik)
  live?: { on: boolean; onChange: (on: boolean) => void }; // tanpa prop = log statis (output langkah)
  streams?: { value: LogStreamFilter; onChange: (v: LogStreamFilter) => void };
  downloadHref?: string; // unduhan server (file penuh, diaudit); tanpa = Blob dari buffer
  truncated?: boolean; // server memotong → "Menampilkan 2.000 baris terakhir."
  showLevel?: boolean; // kolom level (/dev/logs)
  notice?: ReactNode; // mis. catatan redaksi rahasia (PLAN-02)
  size?: "page" | "inline"; // page: tinggi sisa layar (min 320 px); inline: max-h-96
}): JSX.Element;
```

Perilaku:

1. **Ikuti (live)**: tombol toggle `aria-pressed`; `on` = pemanggil mem-poll (lewat `useApiQuery(..., { enabled: on })`).
   Mati = "Dijeda". Tab tersembunyi otomatis berhenti mem-poll (§3.5) tanpa mengubah toggle.
2. **Pin ke bawah**: saat `pinned`, setelah baris berubah `useLayoutEffect` menggulir ke bawah. Gulir manual
   (bukan programatik; ditandai flag) yang menjauh > 32 px dari bawah → `pinned=false` dan viewer **membekukan
   snapshot** baris saat itu (tidak ada lompatan saat buffer memangkas baris atas). Tombol mengambang "Baris baru (n)"
   (`n = lines.at(-1).seq − snapshot.at(-1).seq`) atau "Ke baris terakhir" bila n = 0; klik / tombol `End` → render
   terbaru + pin lagi. Polling tetap jalan saat tidak di-pin.
3. **Cari**: `SearchField` "Cari di log" (placeholder "mis. error"), filter + sorot `<mark class="bg-warning-subtle
   text-foreground">`, hitungan "12 dari 2.000 baris cocok", kosong → "Tidak ada baris yang cocok. Ubah kata pencarian."
   Tanpa regex.
4. **Bungkus baris**: toggle; default **on** di `< 768 px`, off di desktop; disimpan di `localStorage`
   `panel-termux:log-wrap` (`"1"|"0"`, try/catch seperti `app.layout.tsx`). On = `whitespace-pre-wrap break-words`
   (bukan `break-all`); off = `whitespace-pre` dengan scroll horizontal **di dalam** area log saja.
5. **Salin**: menyalin baris yang terlihat (hasil filter) via `logToText`; label "Salin 12 baris" saat filter aktif.
6. **Unduh**: `downloadHref` → `<a href download>`; tanpa → Blob `text/plain` dari buffer, nama
   `<label-slug>-YYYYMMDD-HHmm.log`.
7. **Timestamp**: kolom kiri `text-muted-foreground tabular-nums`, `formatClock(at)` → "21.54.07" (jam lokal browser);
   baris pemisah tanggal saat hari lokal berganti ("Kamis, 26 Nov 2026"); baris tanpa `at` = kolom kosong.
8. **Gaya baris**: `font-mono text-xs leading-5`, area `bg-muted`; `stream: "err"` atau `level: "error"` → `bg-danger-subtle`
   - `border-l-2 border-danger` + `sr-only` "stderr"/"error"; `warn` → `border-l-2 border-warning`. Teks melewati
     `stripAnsi`. Baris > 4.000 karakter dipotong dengan `id.shell.log.lineCut(n)`.
9. **Layar penuh**: tombol membuka `Dialog` layar penuh (semua lebar; di HP pengganti fullscreen API yang tidak ada di
   iPhone) berisi viewer yang sama; `Escape` keluar, fokus kembali ke tombol.
10. **Batas DOM**: maks `LOG_MAX_LINES` baris dirender; tanpa virtualisasi.
11. **A11y**: area `role="log" aria-live="off" tabIndex={0} aria-label={label}` (bisa digulir keyboard, tidak
    dibacakan tiap poll); toolbar `role="toolbar" aria-label="Alat log"`; semua tombol ikon ber-`aria-label`.
    Segmented stream = `role="radiogroup"`.

### 3.5 Polling — `useApiQuery` (D9)

`src/web/shared/use-api-query.ts` (diubah, signature kompatibel; 20 pemanggil tidak perlu disentuh):

```ts
export type ApiQuery<T> = {
  data: T | undefined;
  error: ApiError | undefined; // dikosongkan saat sukses
  loading: boolean; // ada request berjalan (semantik lama dipertahankan)
  updatedAt: Date | null; // waktu klien sukses terakhir → PageHeader meta / StaleNotice
  reload: () => void;
};
export type QueryOptions = { enabled?: boolean }; // false: tidak fetch, tidak poll, data lama dipertahankan
export function useApiQuery<T>(url: string, refreshMs?: number, opts?: QueryOptions): ApiQuery<T>;
```

Logika jadwal dipisah ke `src/web/shared/poller.ts` (murni, timer & visibilitas di-inject → bisa dites `bun test`
tanpa DOM):

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

Aturan (P1–P8), semuanya wajib untuk setiap polling di panel — **dilarang `setInterval` polling sendiri** di halaman:

- **P1 single-flight**: tick saat request masih berjalan dilewati; request tidak di-abort. Abort hanya saat unmount,
  `url` berubah, atau `enabled` → false.
- **P2 coalesce `reload()`**: bila ada request berjalan, tandai "sekali lagi"; tepat satu fetch tambahan setelah yang
  berjalan selesai (data pasca-mutasi tidak tertimpa respons lama).
- **P3 jadwal setelah selesai**: tick berikut dijadwalkan `pollDelay(base, failures)` setelah respons, bukan interval
  tetap.
- **P4 backoff**: `failures` +1 tiap error (network/5xx/4xx), reset 0 saat sukses; 10 → 20 → 40 → 60 → 60 dtk.
  401/403 tetap mengalihkan (perilaku `apiFetch`).
- **P5 tersembunyi**: `visibilitychange` → hidden: batalkan timer (request yang berjalan dibiarkan selesai). Visible:
  bila `now − lastOk ≥ base` atau ada error → fetch segera; selain itu jadwalkan sisa waktu.
- **P6 online**: event `online` → fetch segera (failures direset).
- **P7 enabled**: `enabled: false` (job selesai, log dijeda) → tidak ada fetch/timer.
- **P8 respons basi**: respons untuk `url` lama diabaikan (abort + cek token).

Interval adalah konstanta domain (bukan di hook). Nilai acuan dari R2 §6.2, final di PLAN-02/03/04/05: Ringkasan,
Layanan, Aplikasi 10 dtk; Domain 30 dtk; Database tanpa poll; progres perubahan 1 dtk selama `running`; cadangan 3 dtk
selama berjalan; Kesehatan sistem 15 dtk; log yang diikuti 3 dtk.

### 3.6 Toast (D10)

- Satu `<Toaster>` di `SessionGate` (`session/session.gate.tsx`), bersama satu `<TooltipProvider>`. `PanelLayout`
  (`panel/panel.layout.tsx`) dan `DevLayout` (`dev/dev.layout.tsx`) **dihapus** beserta route pembungkusnya.
- `components/ui/sonner.tsx`: `position="bottom-right"`, `mobileOffset={{ bottom: "calc(var(--bottom-nav-h, 0px) +
  0.75rem + env(safe-area-inset-bottom))" }}`, `visibleToasts={3}`, `closeButton`, `containerAriaLabel="Notifikasi"`,
  `closeButtonAriaLabel="Tutup notifikasi"`, tanpa `richColors`; ikon diwarnai token lewat `toastOptions.classNames`
  (`success: "[&_[data-icon]]:text-success"`, `error: "[&_[data-icon]]:text-danger"`, `warning`, `info`).
- `--bottom-nav-h` diset di CSS: `:root:has([data-bottom-nav]) { --bottom-nav-h: 3.5rem }` (`:has` didukung Chrome
  105+, Safari 15.4+, Firefox 121+).
- `runApiAction` (`shared/api.action.ts`): error toast `{ duration: 8_000 }`. Sukses tetap default 4 dtk.
- Aturan konten: sukses = kalimat lampau pendek ("sshd dimulai ulang."); gagal mengikuti pola error. Aksi lewat dialog
  menampilkan error **di dialog** (§3.2), bukan toast. Aksi tanpa dialog (Mulai) → toast error 8 dtk, dan baris resource
  menampilkan status hasil reload.

### 3.7 Shell: judul, breadcrumb, fokus, navigasi mobile

**Konteks halaman** `src/web/layout/shell.page.tsx` (baru):

```ts
export type ShellPage = { title: string; back?: { to: string; label: string } };
export function useShellPage(page: ShellPage): void; // dipanggil PageHeader
export function useCurrentShellPage(): ShellPage | null; // dibaca AppLayout, MobileTopBar, Breadcrumbs
/** Sets document.title outside the shell (landing, login). `raw` = no " · Panel Termux" suffix. */
export function useDocumentTitle(title: string, opts?: { raw?: boolean }): void;
```

- **Judul tab**: `"<judul PageHeader> · Panel Termux"`; sebelum PageHeader terpasang → `documentTitleFor(pathname)`
  lama. Landing memanggil `useDocumentTitle(id.landing.meta.title, { raw: true })`, login
  `useDocumentTitle(id.login.title, { raw: true })` (menutup R1-G18).
- **Breadcrumb** (`breadcrumbsFor(pathname, pageTitle?)`, diubah): maksimal 3 tingkat — grup (tanpa link) › item nav
  (link, kecuali halaman ini) › judul halaman (tanpa link) bila path lebih dalam dari item nav. Segmen URL antara
  **tidak** pernah jadi crumb. `/panel/services/sshd/log` → "Server › Layanan › Log sshd"; `/panel/jobs/<uuid>` →
  "Server › Riwayat perubahan › Deploy blog". `aria-label` = "Lokasi halaman".
- **Fokus route (D7)**: di `AppLayout`, efek pada `location.pathname` (lewati render pertama dan perubahan yang hanya
  `search`/`hash`): `requestAnimationFrame(() => (document.getElementById("page-title") ?? mainEl).focus({ preventScroll: true }))`.
  `<ScrollRestoration />` React Router dipasang (atas saat navigasi baru, posisi lama saat kembali). Sheet navigasi
  memakai `onCloseAutoFocus={(e) => e.preventDefault()}` agar radix tidak mengembalikan fokus ke trigger setelah
  pindah halaman.
- **Indikator navigasi**: `useNavigation().state === "loading"` (chunk area dimuat) → bar 2 px `bg-foreground/40` di
  atas `main`, `role="progressbar"` `aria-label="Memuat halaman…"`, muncul setelah 150 ms.
- **Mobile top bar** (`layout/mobile.topbar.tsx`, menggantikan `mobile.bar.tsx`): sticky, `h-12` +
  `pt-[env(safe-area-inset-top)]`; kiri tombol "‹" (`Link` ke `back.to`, `aria-label` `Kembali ke Situs`) bila ada
  `back`; judul `text-base font-semibold truncate` `aria-hidden` (h1 asli ada di konten); kanan: `UserMenu` ringkas
  **hanya** untuk peran tanpa bottom bar (`user`). `index.html` viewport + `viewport-fit=cover`.
- **Bottom bar** (`layout/mobile.nav.tsx`, baru): `<nav aria-label="Navigasi utama" data-bottom-nav>` fixed bawah,
  `h-14` + `pb-[env(safe-area-inset-bottom)]`, 5 slot sama lebar (≥ 72 px di 360 px), ikon 20 px + label `text-[11px]
  font-medium`, `aria-current="page"` pada yang aktif, indikator aktif garis 2 px `bg-brand` di atas ikon (sama dengan
  sidebar desktop). `MOBILE_PRIMARY = ["/panel", "/panel/sites", "/panel/services", "/panel/apps"]` difilter
  `canAccess`; tidak ada yang lolos → bottom bar tidak dirender. Slot 5 "Lainnya" aktif bila pathname tidak cocok 4
  slot pertama. `main` mendapat `pb-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom))]` di < md.
- **Sheet "Lainnya"** (`layout/mobile.more.tsx`, baru): `Sheet side="bottom"` `max-h-[85dvh]` scroll, judul sr-only
  "Menu lainnya"; isi: grup nav sisanya (Administrasi dulu untuk Super Admin, lalu Server sisa: Domain, Database,
  Cadangan; Riwayat perubahan **tidak** ditambah — tetap dari halaman Situs), baris `h-12`; lalu blok akun (avatar,
  nama, peran), pilihan tema 3 tombol segmented (Sistem/Terang/Gelap), Profil, Keluar. **Tertutup otomatis saat
  `pathname` berubah** (efek, bukan `onNavigate` per link — menutup bug R1-G6 untuk semua link termasuk Profil).
- Desktop: sidebar, collapse, header breadcrumb tetap.

### 3.8 Target sentuh (D8)

- `styles.css`: `@custom-variant coarse (@media (pointer: coarse));`.
- `components/ui/button.tsx` sizes: `default` `coarse:h-11`, `sm` `coarse:h-11 coarse:px-3`, `lg` `coarse:h-12`,
  `icon`/`icon-sm`/`icon-lg` `coarse:size-11`, `icon-xs`/`xs` tetap visual 24 px + `relative
  coarse:after:absolute coarse:after:-inset-2.5 coarse:after:content-['']` (hit-area 44 px). `components/ui/input.tsx`
  dan `select` trigger: `coarse:h-11`.
- Checkbox/switch: label dibungkus `<label className="… coarse:min-h-11 flex items-center">` oleh pemanggil (aturan,
  bukan perubahan primitive).
- Item nav sheet `h-12`, bottom bar `h-14`, kartu DataTable `min-h-14`.
- Desktop (`pointer: fine`) tidak berubah.

### 3.9 Token, tipografi, string primitive

- **Larangan** (ditegakkan test di gelombang 3): kelas palet Tailwind mentah di `src/web` (pola
  `\b(?:text|bg|border|ring|fill|stroke)-(?:red|green|emerald|amber|yellow|orange|blue|sky|lime|rose)-\d{2,3}\b`) dan
  `destructive/10` → pakai `success/warning/danger/info` + `-subtle`, `TONE_CLASS`/`TONE_TEXT`/`TONE_FILL`. Pengecualian:
  `src/web/landing/**` (token `--lp-*`).
- `status.tone.ts`: tambah `TONE_TEXT: Record<StatusTone, string>` (`text-success` …) — sekarang duplikat lokal di
  `stat-tile.tsx` (`VALUE_TONE`), dipindah.
- **Skala tipografi** (dikunci lewat komponen): h1 `PageHeader` `text-xl sm:text-2xl`; h2 `Section`/`CardTitle`
  `text-base font-semibold`; isi `text-sm`; meta `text-xs text-muted-foreground`; KPI `StatTile` `text-xl tabular-nums`;
  mono untuk ID/port/path/perintah/hash/log. Halaman tidak menulis ukuran heading sendiri.
- `components/ui/dialog.tsx:63,98` dan `sheet.tsx:68`: "Close" → `id.common.close` ("Tutup"). `id.shell.breadcrumb` →
  "Lokasi halaman".
- `styles.css` komentar rasio destructive dark: `/* white on danger/60 over dark background: 6.0:1 */`.

### 3.10 Format (`src/web/shared/format.ts`)

| Fungsi                        | Kontrak baru                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatRelative(at, now)`     | `< 60 dtk` → "baru saja"; `< 24 jam` → dua satuan terbesar + "lalu"; 1 hari → "kemarin"; `< 7 hari` → "N hari lalu"; selebihnya `26 Nov 2026`; masa depan → "baru saja" |
| `formatBytes(n)`              | B/KB/MB: 1 desimal bila < 100, selain itu 0; **GB/TB selalu tepat 1 desimal** (`minimumFractionDigits: 1`) → "64,0 GB", "232,0 GB", "1,5 TB"                            |
| `formatClock(iso)` (baru)     | jam lokal "21.54.07" (`toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })`); null/invalid → ""                                      |
| `formatDayLabel(iso)` (baru)  | "Kamis, 26 Nov 2026" (pemisah hari di log)                                                                                                                              |
| `formatTemperature(c)` (baru) | "36,5 °C"; dipindah dari `id.panel.ts` (logika format tidak di i18n). `null` → "–"                                                                                      |
| `formatDateTime(iso, true)`   | Tetap ("26 Nov 2026, 14.05.07"); komentar diperbaiki                                                                                                                    |

Daftar memakai `RelativeTime` (relatif < 7 hari, absolut di `title`), bukan `formatDateTime` (migrasi per domain).

### 3.11 Code splitting (D11, D12)

- `scripts/build.ts`: tambah `splitting: true` pada `Bun.build`.
- `router.tsx`: semua route memakai `lazy`. Modul area berisi re-export komponen halaman saja (< 30 baris, sesuai
  aturan index = re-export):

| Chunk area | File re-export (baru)           | Route                                                  |
| ---------- | ------------------------------- | ------------------------------------------------------ |
| landing    | langsung `landing/landing.page` | `/`                                                    |
| login      | langsung `pages/login.page`     | `/login` (membawa `better-auth` client)                |
| shell      | `layout/shell.chunk.ts`         | pathless `AppLayout`, `NotFoundPage`, `RouteErrorPage` |
| panel      | `panel/panel.pages.ts`          | semua `/panel/*` (panel, site, deploy, backup)         |
| dev        | `dev/dev.pages.ts`              | `/dev/*`                                               |
| profil     | langsung `pages/profile.page`   | `/profile`                                             |

Bentuk: `{ path: "services", lazy: () => import("@/web/panel/panel.pages").then((m) => ({ Component: m.ServicesPage })) }`.
Entry tetap: `main.tsx`, `router.tsx`, `SessionGate`, `SessionFallback`, `SessionError`, tema.

- `isChunkLoadError(err: unknown): boolean` (`src/web/shared/chunk.error.ts`, baru): `TypeError`/`Error` dengan pesan
  cocok `/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically
  imported module|Unable to preload CSS/i` (Chrome, Safari, Firefox, Vite-style CSS).
- `reloadOnce(key, now)` (generalisasi `shouldReloadForAccess` di `api.client.ts`, jendela 30 dtk, key
  `panel.chunkReloadAt`). Dipakai `RouteErrorPage` dan `SessionError`: chunk error → `reloadOnce` → bila diblok guard,
  tampil `ErrorState` `id.shell.chunkError` + "Muat ulang halaman".
- Target ukuran (gzip, diukur dari build lokal, §6): `/` ≤ 150 KB JS; muatan awal `/panel` ≤ 200 KB JS.

### 3.12 Kontrak header cache (D13) — diimplementasikan PLAN-04

PLAN ini hanya menetapkan perilaku yang harus terlihat dari luar; file `src/server/index.ts` dan `src/server/http/*`
milik PLAN-04.

| Request                                                      | Status | `Cache-Control`                            | Header lain                                    |
| ------------------------------------------------------------ | ------ | ------------------------------------------ | ---------------------------------------------- |
| Aset bundle ber-hash yang ada (`/^\/[\w.-]+-[a-z0-9]{8}\.(js | css    | svg                                        | png                                            | webp | woff2)$/`) | 200 | `public, max-age=31536000, immutable` | `X-Content-Type-Options: nosniff`, `ETag` tetap |
| Path pola di atas yang tidak ada (chunk versi lama)          | 404    | `no-store`                                 | `content-type: text/plain`; **bukan** HTML SPA |
| Navigasi HTML SPA (path lain non-`/api`)                     | 200    | `no-cache`                                 | header keamanan yang ada (CSP, XFO, dst.)      |
| `/__spa` dari luar                                           | 404    | –                                          | (menutup R4 G12)                               |
| `/api/*`                                                     | –      | rekomendasi `no-store` (keputusan PLAN-04) | –                                              |

Fakta untuk implementasi (diverifikasi di probe sesi ini): rute aset yang didaftarkan HTMLBundle Bun adalah rute
eksak yang menang atas `"/*"`, dan Bun tidak memberi hook header untuknya. Cara yang memenuhi tabel: layani bundle
dari `Bun.serve` internal kedua di `127.0.0.1:0` (`routes: { "/": spa }`) dan proksikan semua request non-API dari
server utama (yang sudah memproksi HTML hari ini), menambah header per baris tabel. PLAN-04 boleh memilih cara lain
asal tabel terpenuhi. Path aset tetap di root → resep Access README tidak berubah.

### 3.13 Sesi, 404 publik, error

- `src/shared/roles.ts`: `isProtectedPath(path): boolean` (prefix di `AREA_MIN_ROLE`).
- `session/session.redirect.ts` `resolveRedirect`: tamu → `/login` **hanya** bila `isProtectedPath(path)`; `/`,
  `/login`, dan path tak dikenal → `null`. Pengguna login: tidak berubah.
- Router: `{ path: "*", lazy: NotFoundRoute }` di **root** (menggantikan `*` di dalam `AppLayout`).
  `NotFoundRoute` = sudah login → `<AppLayout><NotFoundPage /></AppLayout>` (AppLayout menerima `children` opsional,
  default `<Outlet />`); tamu → `PublicNotFound` (kartu tengah: logo, h1 "Halaman tidak ditemukan", body, tombol
  "Ke beranda" → `/`, link "Masuk" → `/login`).
- `session/session.api.ts` `fetchMe`: gagal jaringan → `ApiError("network")`, non-401 non-2xx →
  `ApiError("server", status)`. `SessionError`: chunk error (§3.11) → reload sekali; `network` → ikon `WifiOffIcon` +
  copy lama; `server` → `ServerCrashIcon` + `id.session.serverTitle/serverBody`.
- `SessionFallback`: `/` dan `/login` → hanya latar (tanpa skeleton, tidak ada kilatan bentuk shell sebelum landing);
  path lain → skeleton berbentuk shell (desktop: kolom sidebar 240 px + header 56 px + 3 blok; HP: top bar 48 px +
  bottom bar 56 px + 3 blok).
- `RouteErrorPage`: "Kembali" (`navigate(-1)`) diganti link "Ke beranda" → `homeFor(role)`; chunk error ditangani §3.11.

### 3.14 Copy keys (bahasa Indonesia, mengikuti content guide)

`src/web/i18n/id.status.ts` (baru): label tabel §3.1.

`src/web/i18n/id.shell.ts` (tambahan/ubahan):

```ts
breadcrumb: "Lokasi halaman",
navigating: "Memuat halaman…",
mobileNav: { label: "Navigasi utama", more: "Lainnya", moreTitle: "Menu lainnya", back: (label: string) => `Kembali ke ${label}` },
stale: (rel: string) => `Tidak bisa memperbarui data. Data terakhir diperbarui ${rel}.`,
noResults: { title: "Tidak ada yang cocok", body: "Ubah kata pencarian atau hapus filter.", clear: "Hapus filter" },
search: { clear: "Hapus pencarian" },
table: { /* + */ actions: "Aksi", pagination: "Paginasi", pageWithTotal: (p: number, n: number, total: string) => `Halaman ${p} dari ${n} · ${total} entri` },
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
publicNotFound: {
  title: "Halaman tidak ditemukan",
  body: "Alamat ini tidak ada. Periksa lagi URL-nya, atau buka beranda Panel Termux.",
  home: "Ke beranda",
  signIn: "Masuk",
},
log: {
  toolbar: "Alat log", follow: "Ikuti", paused: "Dijeda",
  newLines: (n: number) => `Baris baru (${n})`, toBottom: "Ke baris terakhir",
  search: "Cari di log", searchPlaceholder: "mis. error",
  matches: (n: string, total: string) => `${n} dari ${total} baris cocok`,
  noMatches: "Tidak ada baris yang cocok. Ubah kata pencarian.",
  wrap: "Bungkus baris", copy: "Salin log", copyFiltered: (n: string) => `Salin ${n} baris`,
  download: "Unduh .log", fullscreen: "Layar penuh", exitFullscreen: "Keluar dari layar penuh",
  streams: { all: "Semua", out: "stdout", err: "stderr" },
  truncated: (n: string) => `Menampilkan ${n} baris terakhir.`,
  lineCut: (n: string) => `… (+${n} karakter, lengkap lewat Salin atau Unduh)`,
},
```

`src/web/i18n/id.common.ts` (tambahan):

```ts
errorTitles: {
  network: "Tidak bisa terhubung ke server",
  unauthorized: "Sesi kamu sudah berakhir",
  access: "Perlu masuk lewat Cloudflare Access",
  forbidden: "Kamu tidak punya akses",
  client: "Permintaan tidak berhasil",
  server: "Server sedang bermasalah",
},
```

`id.ts` `session` + `serverTitle: "Panel Termux sedang bermasalah"`, `serverBody: "Server menjawab dengan galat. Coba
lagi beberapa saat lagi; bila berulang, periksa log panel di HP."`. `id.common.empty` (teks generik) dihapus di
gelombang 3. Content guide: contoh "Diperbarui 12 dtk lalu" → "Diperbarui 3 mnt lalu" (D16).

---

## 4. Flow

### F1 — Navigasi antar halaman (desktop & HP)

1. Pengguna mengetuk item (sidebar / bottom bar / sheet). Bila area belum dimuat, React Router menunggu chunk; bar
   navigasi muncul setelah 150 ms.
2. Halaman baru render; `PageHeader` mendaftarkan judul → judul tab, top bar HP, crumb terakhir terbarui.
3. Fokus pindah ke `#page-title` (pembaca layar membacakan judul); scroll ke atas (`ScrollRestoration`).
4. Sheet "Lainnya" (bila terbuka) tertutup karena `pathname` berubah; fokus tidak dikembalikan ke trigger.
5. **Kembali (browser back)**: posisi scroll dipulihkan; fokus tetap dipindah ke h1 (pathname berubah).
6. **Hanya query berubah** (`?page=2`, filter): tidak ada pemindahan fokus, tidak ada scroll ke atas oleh shell.
7. **Chunk gagal** (jaringan putus / versi baru): lihat F6.

### F2 — Halaman dengan polling (Ringkasan, Layanan, …)

1. Mount → fetch pertama → skeleton → data. `PageHeader.meta.updatedAt = query.updatedAt` (atau `generatedAt` server
   bila PLAN domain memilihnya) → "Diperbarui baru saja".
2. Tiap `base` ms setelah respons: fetch lagi (P3). Data lama tetap tampil; tombol refresh berputar selama `loading`.
3. Respons lambat (> base): tidak ada tick tambahan, tidak ada abort (P1).
4. **Jaringan putus**: error → `StaleNotice` di atas data "Tidak bisa memperbarui data. Data terakhir diperbarui
   2 mnt lalu." + Coba lagi; backoff 20/40/60 dtk. Event `online` → fetch segera, notice hilang saat sukses.
5. **Tab disembunyikan** (pindah aplikasi di HP, minimize): timer berhenti. Kembali setelah ≥ base → fetch segera;
   kurang dari base → sisa waktu.
6. **Sesi panel habis**: 401 → `apiFetch` mengalihkan ke `/login` (tidak berubah). **Access habis**: 401 Access →
   reload sekali (tidak berubah).
7. **Mutasi lalu `reload()`** saat poll berjalan: satu fetch tambahan setelahnya (P2).
8. **Server restart** (deploy panel): error jaringan beberapa detik → notice → pulih otomatis; bila HTML/chunk berubah
   dan pengguna pindah area → F6.

### F3 — Aksi dengan konfirmasi

1. Tier tanpa: tombol → pending (spinner, disabled) → sukses: toast lampau + `reload()`; gagal: toast error 8 dtk.
2. Tier AlertDialog: tombol → dialog (judul pertanyaan, akibat dulu) → "Hentikan sshd" → pending (dialog terkunci)
   → sukses: tutup + toast + reload; gagal: pesan inline `role="alert"`, dialog tetap terbuka, bisa "Coba lagi" atau
   "Batal".
3. Tier ketik nama: dialog + input; tombol aktif hanya saat cocok persis (trim, case-sensitive). Tempel (paste) boleh.
4. **Aksi bersamaan** (admin lain sudah menjalankan): server 409 `busy` → pesan inline dari `codes.busy` (PLAN domain
   menyediakan kode + tautan ke perubahan berjalan bila ada).
5. **Izin ditolak** (peran diturunkan saat dialog terbuka): 403 → `apiFetch` mengalihkan ke `/` → beranda peran.
6. **Jaringan putus saat pending**: `ApiError network` → pesan inline; pengguna tidak tahu apakah aksi sampai —
   pesan network sudah menyarankan coba lagi; aksi server idempoten/terkunci (tanggung jawab PLAN domain).
7. **Restart panel/cloudflared dari panel**: alur khusus PLAN-02 (202 + tunggu `/api/health`); `ConfirmAction` cukup
   menerima `onConfirm` yang resolve setelah pulih.

### F4 — Melihat log (follow)

1. Halaman log memuat tail awal → `appendLogLines([], lines)` → viewer di-pin ke bawah.
2. `live.on` → pemanggil poll 3 dtk (`?after=` dari PLAN-02) → append → gulir ke bawah.
3. Pengguna menggulir ke atas → unpin, snapshot dibekukan; tombol "Baris baru (n)" bertambah.
4. Mengetik di Cari → baris tersaring + sorot; follow tetap jalan pada baris tersaring.
5. "Baris baru (n)" / `End` → tampil terbaru, pin lagi.
6. Toggle Ikuti off → poll berhenti ("Dijeda"). Tab tersembunyi → poll berhenti otomatis.
7. **Rotasi file** (svlogd `current` diganti): ditangani server PLAN-02 (offset reset); viewer hanya menerima baris.
8. **Kosong** → `empty` spesifik; **gagal pertama** → `error` di atas area + Coba lagi; **gagal saat follow** → error
   kecil di atas, baris tetap.
9. Unduh → file server penuh (diaudit) atau Blob buffer.

### F5 — Navigasi mobile

1. Admin/Super Admin di < md: top bar (judul) + bottom bar. Ketuk "Lainnya" → sheet bawah.
2. Pilih item → navigasi → sheet tertutup otomatis (F1-4). Ketuk Profil/Keluar/tema di sheet berfungsi sama.
3. Peran `user`: tanpa bottom bar; top bar berisi judul + avatar menu (Profil, tema, Keluar).
4. Halaman detail: "‹" di top bar ke `back.to` (Link, bukan history — aman untuk deep link dari notifikasi Telegram).
5. Toast tampil di atas bottom bar; dialog/sheet menutupi bottom bar (z-index radix > bar).
6. Keyboard virtual terbuka (Android Chrome `resizes-visual` default): bottom bar tetap di bawah layout viewport,
   tidak menutupi input. QA memverifikasi (Risiko R6).

### F6 — Versi baru / chunk gagal

1. Tab terbuka saat panel di-upgrade. Pengguna pindah ke area yang belum pernah dimuat → `import()` 404 (server
   mengirim 404 `text/plain`, §3.12) → error.
2. `isChunkLoadError` → `reloadOnce("panel.chunkReloadAt")` → `location.reload()` → HTML baru (`no-cache`) → chunk baru.
3. Bila gagal lagi dalam 30 dtk (offline, server mati): `ErrorState` "Bagian panel ini gagal dimuat" + "Muat ulang
   halaman". Sidebar tetap bisa dipakai bila error terjadi di dalam shell.
4. Chunk area yang sudah di-cache browser (`immutable`) tetap jalan tanpa reload.
5. `sessionStorage` tidak tersedia → tidak reload otomatis, langsung pesan (pola sama dengan reload Access).

### F7 — Tamu & URL

1. Tamu membuka `/panel/sites` → `/login` (tidak berubah).
2. Tamu membuka `/hargaa` (typo) → 404 publik dengan "Ke beranda" / "Masuk".
3. Pengguna login membuka `/panel/xyz` → 404 di dalam shell (sidebar tetap).
4. Dengan Cloudflare Access: `/panel*` ditantang Access sebelum SPA → perilaku 1 tidak terlihat; 2 dan 3 sama. Tanpa
   Access: persis seperti di atas.

### F8 — Pertama kali / data kosong

- Setiap daftar menampilkan `EmptyState` spesifik + CTA (diisi PLAN domain; compiler memaksa `empty`).
- Mode demo tidak mengubah shell.

---

## 5. Spesifikasi UI per permukaan

### 5.1 App shell desktop (≥ md)

- Sidebar 240/56 px (tetap). Header sticky 56 px: `Breadcrumbs` (aturan §3.7). Konten `max-w-7xl` / `max-w-3xl`.
- Bar navigasi 2 px di bawah header saat chunk dimuat.
- A11y: skip link (ada), `main#main tabIndex=-1`, fokus ke h1 tiap navigasi.

### 5.2 App shell HP (< md)

```
┌──────────────────────────────┐  safe-area-top
│ ‹  Log sshd                  │  top bar 48 px (judul dari PageHeader)
├──────────────────────────────┤
│ ● Berjalan · aktif 3 jam     │  status/meta/aksi PageHeader (h1 sr-only)
│ [Mulai ulang]  [⋯]           │
│ …konten…                     │
├──────────────────────────────┤
│ ▣Ringkasan ▣Situs ▣Layanan ▣Aplikasi ▣Lainnya │  bottom bar 56 px
└──────────────────────────────┘  safe-area-bottom
```

- Tanpa scroll horizontal halaman di 360–430 px (scroll horizontal hanya di dalam tabel/log saat wrap off).
- Tema: semua warna dari token; diperiksa di terang & gelap.

### 5.3 Sheet "Lainnya"

- Komponen: `Sheet` (`components/ui/sheet.tsx`), `SidebarNav` dengan varian baris `h-12`, `UserAvatar`, `RoleBadge`,
  tombol segmented tema, `useSignOut`. Error keluar tampil inline di sheet (seperti `UserMenu` sekarang).
- A11y: judul sheet sr-only, fokus pertama ke item nav pertama, `Escape` menutup.

### 5.4 404 publik & 404 di shell

- Publik: kartu tengah `max-w-md`, `BrandLogo`, h1, body, `Button` "Ke beranda", link "Masuk". Judul tab
  "Halaman tidak ditemukan · Panel Termux". Tidak memanggil API selain `/api/me` yang sudah ada.
- Shell: `EmptyState` (ada) + `PageHeader title="Halaman tidak ditemukan"`.

### 5.5 Route error, session error, session fallback

- Route error: `ErrorState` + detail teknis mono + "Ke beranda" + "Muat ulang"; varian chunk (§3.11).
- Session error: kartu tengah; ikon per jenis; tombol "Coba lagi" (revalidate).
- Fallback: §3.13.

### 5.6 Syarat shell untuk halaman milik PLAN lain (template migrasi)

| Jenis halaman                 | Wajib                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semua (kecuali landing/login) | `PageHeader` di luar `QueryView`; satu h1; data lewat `useApiQuery` + `QueryView` dengan `empty` spesifik; status lewat `StatusBadge state=`; tanpa `setInterval` sendiri; tanpa warna palet mentah; tanpa `Toaster` sendiri; tidak menulis ukuran heading sendiri |
| Daftar                        | `DataTable` (`rowHref`, `actions` = satu aksi utama kontekstual + menu "⋯" `DropdownMenu`), urutan bermasalah dulu, `usePageParam` untuk paginasi server, `SearchField` untuk filter, `EmptyState` filter `id.shell.noResults`                                     |
| Detail                        | `PageHeader` dengan `status`, `actions`, `back={{ to: "/panel/sites", label: "Situs" }}`; bagian pakai `Section` + `KeyValue`                                                                                                                                      |
| Live                          | `PageHeader.meta = { updatedAt, onRefresh: reload, refreshing: loading, live: true }`; tanpa teks "tiap N detik"                                                                                                                                                   |
| KPI                           | `StatTile` grid `grid-cols-2 lg:grid-cols-4` + `StatTilesSkeleton`                                                                                                                                                                                                 |
| Log                           | `LogViewer` saja                                                                                                                                                                                                                                                   |
| Aksi berisiko                 | `ConfirmAction` dengan tier dari §3.2                                                                                                                                                                                                                              |
| Waktu di daftar               | `RelativeTime`                                                                                                                                                                                                                                                     |
| Login (PLAN-05, R1-G17)       | `<h1>`, `BrandLogo`, link ke `/`, error inline dengan token `danger` (`ErrorState compact`), `useDocumentTitle(..., { raw: true })`; tombol Google `coarse:h-12`                                                                                                   |
| Landing (PLAN-05)             | `useDocumentTitle(id.landing.meta.title, { raw: true })`; boleh token `--lp-*`                                                                                                                                                                                     |

---

## 6. Kriteria penerimaan

### Unit (`bun test`, tanpa DOM)

- [ ] `tests/web.status.test.ts`: setiap nilai union mentah (`ServiceState`×`wantUp`, `SiteAppStatus`, `JobStatus`,
      `JobStepStatus`, `DeployStatus`, `BackupRunStatus`, `BackupSummary`) dipetakan ke kunci sesuai tabel §3.1;
      `down`+`wantUp` dan `down`+`!wantUp` menghasilkan **label berbeda**; `DomainHealth` 204/302 → healthy, 403 →
      attention, 502/530/null → unhealthy, belum dicek → unchecked; setiap `StatusKey` punya label non-kosong; tidak ada
      kunci ber-tone `accent`.
- [ ] `tests/web.polling.test.ts` (`createPoller` dengan timer palsu yang di-inject): tick saat in-flight tidak memanggil
      `run` kedua; `reload()` saat in-flight → tepat 1 run tambahan; delay setelah 0..5 kegagalan = 10/20/40/60/60/60 dtk
      (base 10 dtk); sukses mereset; `hidden()` membatalkan timer; `visible()` setelah ≥ base → run segera, < base → sisa
      waktu; `stop()` meng-abort signal; base 120 dtk tidak pernah < 120 dtk.
- [ ] `tests/log.time.test.ts`: `2026-11-26_13:54:24.23463 pesan` → `at = 2026-11-26T13:54:24.234Z`, `text = "pesan"`;
      TAI64N `@400000006925c2b80d693a40 x` → ISO yang dihitung dari `0x6925c2b8 − 10` detik; ISO `…+08:00` dikonversi
      ke UTC; pm2 tanpa zona, baris kosong, bulan 13 → `at: null` dan teks utuh.
- [ ] `tests/web.log-buffer.test.ts`: `appendLogLines` memotong ke `max` dari depan, `seq` naik terus melewati
      pemotongan; `filterLogLines` tidak peka huruf besar-kecil; `logToText` format; `stripAnsi` membuang `\x1b[32m`.
- [ ] `tests/web.shell.test.ts` (diperluas): `breadcrumbsFor("/panel/services/sshd/log", "Log sshd")` =
      `[Server, Layanan(→/panel/services), Log sshd]` tanpa crumb `sshd`; `/panel/jobs/<uuid>` tanpa UUID; judul tab =
      `"Log sshd · Panel Termux"`; `formatRelative` 59 dtk → "baru saja", 60 dtk → "1 mnt lalu"; `formatBytes(64 GiB)` =
      "64,0 GB", `232 GiB` = "232,0 GB", `512 MiB` = "512 MB", `1,5 KiB` = "1,5 KB"; `formatClock` → "21.54.07" (TZ
      ditetapkan di test); `typedMatches(" blog ", "blog")` true, `("Blog","blog")` false; `pollDelay`.
- [ ] `tests/web.session.test.ts`: tamu `/hargaa` → null; tamu `/panel/sites` → `/login`; tamu `/` dan `/login` → null;
      `isProtectedPath` untuk `/panelx` = false (prefix harus diikuti `/` atau akhir).
- [ ] `tests/web.chunk.test.ts`: `isChunkLoadError` benar untuk pesan Chrome/Safari/Firefox, salah untuk `TypeError`
      lain; `reloadOnce` menolak dalam 30 dtk.
- [ ] Gelombang 3 `tests/web.guard.test.ts`: tidak ada import `shared/query.state`, `shared/stat.card`,
      `shared/confirm.dialog`, `panel/status.badge`, `dev/pager`; tidak ada kelas palet mentah (regex §3.9) di `src/web`
      kecuali `landing/`; tidak ada `setInterval(` di `src/web` selain `now.store.ts`; setiap `*.page.tsx` (kecuali
      landing, login) memuat `PageHeader`; tidak ada `<Toaster` selain di `session.gate.tsx`.
- [ ] `bun run typecheck`, `bun run lint`, `bun test` hijau.

### Integrasi server (milik PLAN-04, dicek bersama)

- [ ] Build lokal: `curl -sI /chunk-<hash>.js` → `cache-control: public, max-age=31536000, immutable` + `nosniff`;
      `curl -sI /chunk-zzzzzzzz.js` → 404 `text/plain` `no-store`; `curl -sI /panel` → `cache-control: no-cache`;
      `curl -sI /__spa` → 404.

### Bundle

- [ ] `bun run build:local`, jalankan, hitung `gzip -c` semua `<script>`/modulepreload yang dimuat `/` (DevTools
      Network, cache dimatikan): JS ≤ 150 KB; `/panel` muatan awal ≤ 200 KB. Navigasi `/panel → /dev` memuat chunk `dev`
      sekali.
- [ ] Binary `bun-linux-arm64-android` di HP: `/panel` dan `/dev` membuka chunk area dengan 200 (smoke test setelah
      deploy, Risiko R2).

### UI-QA di browser (390×844 dan 1440 px, tema terang & gelap)

- [ ] Setiap halaman: judul terlihat di top bar HP; satu h1 (`document.querySelectorAll("h1").length === 1`); judul
      tab unik.
- [ ] Bottom bar: 5 slot, aktif benar di `/panel`, `/panel/sites/blog` (Situs), `/dev` (Lainnya); tidak ada di peran
      `user`; safe-area tidak memotong label (emulasi iPhone dengan inset).
- [ ] Sheet "Lainnya" tertutup setelah memilih Profil (regresi R1-G6).
- [ ] Keyboard saja: Tab dari skip link → konten; setelah navigasi, `document.activeElement.id === "page-title"`;
      VoiceOver/TalkBack membacakan judul baru satu kali.
- [ ] Target sentuh: di emulasi touch (`pointer: coarse`), `getBoundingClientRect` tombol aksi, item nav, tombol
      salin (hit-area) ≥ 44 px; di desktop tinggi tombol default tetap 36 px.
- [ ] Toast: muncul di atas bottom bar di HP, kanan bawah di desktop; tetap terlihat saat pindah `/panel` → `/dev`;
      error bertahan 8 dtk dan bisa ditutup; region dibacakan "Notifikasi".
- [ ] Polling: DevTools Network — tab disembunyikan 60 dtk = 0 request; kembali → 1 request segera; server dimatikan
      → interval request 10/20/40/60 dtk dan `StaleNotice` tampil; overview lambat (throttle) tidak pernah di-abort.
- [ ] ConfirmAction: tier typed menolak "Blog" untuk `blog`; keyboard HP tidak mengkapitalkan; error server tampil di
      dialog; Escape tidak menutup saat pending.
- [ ] LogViewer: gulir ke atas saat follow → posisi tidak melompat, "Baris baru (n)" bertambah; cari menyorot; wrap
      default on di 390 px, off di 1440 px; salin/unduh berisi baris yang terlihat; layar penuh di HP; tidak ada scroll
      horizontal halaman.
- [ ] Chunk: buka tab, build ulang + restart panel, pindah ke area yang belum dimuat → halaman memuat ulang sekali dan
      berhasil; dengan server mati → pesan "Bagian panel ini gagal dimuat".
- [ ] Tamu `/hargaa` → 404 publik; tamu `/panel` tanpa Access → `/login`; dengan Access (produksi) → tantangan Access.
- [ ] Kontras: tidak ada teks status di bawah 4,5:1 di kedua tema (axe DevTools atau Lighthouse a11y ≥ 95 per jenis
      halaman).

---

## 7. Rencana kerja

### Gelombang 1 — fondasi bersama (satu pemilik: `wkr-shell-foundation-01`)

Semua file di bawah milik worker ini; tidak ada worker lain menyentuhnya di gelombang 1. Commit per langkah.

| Langkah | File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Isi                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 1a      | `src/shared/log.types.ts`★, `src/shared/log.time.ts`★, `src/shared/roles.ts`, `src/web/shared/poller.ts`★, `src/web/shared/use-api-query.ts`, `src/web/shared/format.ts`, `src/web/shared/chunk.error.ts`★, `src/web/shared/api.client.ts` (`reloadOnce`), `src/web/shared/api.action.ts`, `src/web/components/status.vocab.ts`★, `status.tone.ts`, `src/web/components/log.buffer.ts`★, `src/web/components/now.store.ts`★, `src/web/i18n/id.status.ts`★, `id.shell.ts`, `id.common.ts`, `id.ts` + tests unit                                                                                                                                                                                                                                                     | modul murni + test   |
| 1b      | `src/web/components/{page-header,query-view★,error-state,empty-state,data-table,use-page-param★,search-field★,stat-tile,section,status-badge,status-icon★,relative-time,copy-button,confirm-action★,log-viewer★,log-viewer.toolbar★,log-lines★}.tsx`, `src/web/shared/query.state.tsx` (isi diganti ke komponen baru, API lama tetap), `src/web/components/ui/{button,input,select,dialog,sheet,sonner}.tsx`, `src/web/styles.css`                                                                                                                                                                                                                                                                                                                                 | komponen             |
| 1c      | `src/web/layout/{app.layout,shell.page★,mobile.topbar★,mobile.nav★,mobile.more★,nav.items,breadcrumbs,sidebar.nav,user.menu,shell.chunk★}.tsx/ts`, hapus `layout/mobile.bar.tsx`, `src/web/session/{session.gate,session.redirect,session.fallback,session.error,session.api}.tsx/ts`, `src/web/pages/{route-error,not-found,public-not-found★}.page.tsx`, `src/web/router.tsx`, `src/web/panel/panel.pages.ts`★, `src/web/dev/dev.pages.ts`★, hapus `src/web/panel/panel.layout.tsx` & `src/web/dev/dev.layout.tsx`, `src/web/index.html` (viewport saja), `scripts/build.ts`, satu baris `useDocumentTitle` di `src/web/landing/landing.page.tsx` dan `src/web/pages/login.page.tsx`, `docs/content-guide.md` (contoh D16, tabel status menunjuk `id.status.ts`) | shell, router, split |

★ = file baru. Perkiraan: ±30 file, ±1.700 baris produksi + ±450 baris test. Ukuran **L**. Tidak ada file > 300 baris
(LogViewer dipecah tiga).

Verifikasi akhir gelombang 1: typecheck, lint, test, build lokal, QA §6 untuk shell (halaman domain masih lama tetapi
`QueryView` lama sudah memakai `ErrorState`/`RowsSkeleton`/`StaleNotice` baru).

**Paralel dengan gelombang 1** (file berbeda): PLAN-04 mengerjakan §3.12 di `src/server/index.ts` + `src/server/http/*`

- `tests/server.http.test.ts`. Pemeriksaan bersama: kriteria "Integrasi server".

### Gelombang 2 — migrasi halaman per domain (pemilik = PLAN lain, paralel)

Mulai setelah gelombang 1 masuk ke branch fitur. Setiap worker hanya menyentuh file domainnya; **dilarang mengubah**
file gelombang 1, kecuali `status.vocab.ts` + `id.status.ts` oleh PLAN-02 (§3.1). Kebutuhan perubahan komponen bersama
→ catat, dikerjakan gelombang 3 atau gelombang 1b susulan oleh pemilik shell.

| PLAN    | File (inventaris R1 §2.9)                                                                                                             | Hasil wajib (template §5.6)                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN-02 | `src/web/panel/*` (kecuali `panel.pages.ts`), `id.panel.ts`                                                                           | PageHeader + meta; `StatTile` (tanpa `Progress` brand); `DataTable`; `StatusBadge state`; `ConfirmAction` tier; `LogViewer`; string "lama" dihapus |
| PLAN-03 | `src/web/site/*`, `src/web/deploy/*`, `id.site.ts`, `id.deploy.ts`                                                                    | sama; hapus situs = typed; `Pager` → `usePageParam`; warna emerald/amber → token; `StatusIcon` untuk langkah                                       |
| PLAN-04 | `src/web/backup/*`, `id.backup.ts`                                                                                                    | sama; pulihkan menimpa = typed                                                                                                                     |
| PLAN-05 | `src/web/dev/*` (kecuali `dev.pages.ts`), `src/web/pages/{login,profile}.page.tsx`, `src/web/landing/*`, `id.dev.ts`, `id.landing.ts` | sama; hapus pengguna = typed; ubah peran = AlertDialog; `/dev/logs` → `LogViewer` lama→baru; login sesuai §5.6                                     |

File i18n baru di gelombang 2 (mis. `id.notify.ts`) di-import langsung oleh domainnya; penggabungan ke `id.ts`
dilakukan gelombang 3 (menghindari bentrok `id.ts`).

### Gelombang 3 — pembersihan (satu pemilik: `wkr-shell-cleanup-01`)

Setelah semua worker gelombang 2 selesai: hapus `shared/query.state.tsx`, `shared/stat.card.tsx`,
`shared/confirm.dialog.tsx`, `dev/pager.tsx`, `dev/dev.pagination.ts`, `panel/status.badge.tsx`, `LEGACY_TONE`,
`STATUS_TONE`/`toneForStatus` + prop `status`, tipe `Tone` di `panel/panel.status.ts`, `id.common.empty`; gabung file
i18n baru ke `id.ts`; tambah `tests/web.guard.test.ts`. Ukuran **S** (±10 file, sebagian besar penghapusan).
README/CHANGELOG (D14 tamu 404, toast, bottom bar) ditulis sekali oleh worker ringkasan di akhir.

### Ketergantungan lintas PLAN (yang harus dihormati PLAN lain)

1. **Semua PLAN**: template §5.6; tier §3.2; tanpa polling/Toaster/warna mentah sendiri; `empty` spesifik.
2. **PLAN-02**: endpoint log mengembalikan `LogLine[]` (lama → baru) dan memakai `splitLogTimestamp`; `Problem.severity`
   tetap `"warning" | "danger"` atau memperbarui `PROBLEM_TONE` di gelombangnya; pemilik tunggal `status.vocab.ts`
   di gelombang 2; alur restart `panel` memberi `onConfirm` yang resolve setelah pulih.
3. **PLAN-03**: output langkah job sebagai `LogLine[]` (bila ditampilkan); pakai kunci `processing/undone/rolled_back`.
4. **PLAN-04**: implementasi tabel §3.12 (termasuk 404 `/__spa`); jangan menamai ulang/memindah aset dari root.
5. **PLAN-05**: `/dev/logs` memakai `LogLine` (`level`) + `showLevel`; login/landing memanggil `useDocumentTitle`;
   README §Layar + CHANGELOG mencatat D14; bila PLAN-05 mengubah `scripts/build.ts` (rilis GitHub Actions), lakukan
   setelah gelombang 1 (`splitting: true` harus tetap).
6. Bila PLAN lain butuh `StatusKey`/copy key/prop komponen baru → cantumkan di PLAN-nya sekarang agar masuk gelombang 1.

---

## 8. Risiko, asumsi, pertanyaan terbuka

### Risiko

| #   | Risiko                                                                                                                            | Mitigasi                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Mengubah tone `running` → info dan label status mengubah tampilan semua halaman; test lama (`toneForStatus`, `LEGACY_TONE`) pecah | Test lama diganti di langkah 1a; tabel lama tetap sampai gelombang 3 agar halaman lama tidak berubah setengah jalan                                                   |
| R2  | Splitting terbukti di `--compile` lokal macOS, belum untuk `bun-linux-arm64-android`                                              | Smoke test di HP (§6 Bundle). Bila gagal: matikan `splitting` (satu baris), `lazy` tetap valid (import dinamis jadi satu chunk) — tidak ada kode lain yang tergantung |
| R3  | Proksi aset lewat server internal kedua (PLAN-04) menambah satu hop loopback per aset                                             | Hanya saat cache miss; aset `immutable` di browser dan edge Cloudflare. Ukur TTFB chunk di HP                                                                         |
| R4  | `pointer: coarse` tidak menangkap laptop layar sentuh (pointer utama `fine`)                                                      | Diterima: desktop tetap ≥ 24 px (WCAG 2.5.8 AA)                                                                                                                       |
| R5  | Fokus ke h1 tiap navigasi bisa terasa aneh bagi pengguna mouse (ring fokus)                                                       | `outline-none` pada h1; `:focus-visible` tidak menyala untuk fokus programatik setelah klik mouse di browser modern                                                   |
| R6  | Bottom bar `fixed` + keyboard virtual di Android/iOS                                                                              | QA F5-6; bila menutupi input di iOS, sembunyikan bar saat `focusin` pada input (tambahan kecil, hanya bila terbukti)                                                  |
| R7  | Snapshot beku di LogViewer menyembunyikan baris baru dari pencarian saat unpin                                                    | Disengaja (posisi baca stabil); tombol "Baris baru (n)" memberi tahu                                                                                                  |
| R8  | `"baru saja"` < 60 dtk menyembunyikan "12 dtk lalu" di halaman poll 10 dtk                                                        | Disengaja (D16); masalah freshness ditunjukkan `StaleNotice` saat gagal, bukan detik                                                                                  |
| R9  | Gelombang 1 besar (L) dengan satu pemilik = jalur kritis                                                                          | Tiga langkah commit; PLAN domain bisa menulis PLAN/test domainnya sambil menunggu; PLAN-04 server paralel                                                             |

### Asumsi

- A1: CSRF hotfix (Origin sama + `X-Requested-With`) masuk; `apiFetch` sudah mengirim `x-requested-with`, unduhan log
  adalah GET (tidak terkena).
- A2: Interval polling final ditetapkan PLAN domain; hook tidak memaksa nilai.
- A3: `sessionStorage` tersedia di browser target; bila tidak, reload otomatis dilewati (bukan error).
- A4: LICENSE/landing/rilis bukan bagian PLAN ini.

### Pertanyaan terbuka untuk owner

- **Q1** (D5): Super Admin memakai 4 tujuan yang sama dengan Admin; Administrasi di urutan pertama "Lainnya". Ganti
  "Aplikasi" dengan "Kesehatan sistem" untuk Super Admin? Default: tidak.
- **Q2** (D14): tamu di URL tak dikenal → 404 publik (bukan landing seperti tertulis di README). Setuju? Default: ya,
  README ikut diubah.
- **Q3** (D16): content guide diubah agar "baru saja" berlaku < 1 menit di semua tempat, termasuk "Diperbarui …".
  Default: ya.
