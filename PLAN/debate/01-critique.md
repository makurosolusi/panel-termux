# Kritik PLAN 01 — Shell, design system, komponen bersama, konten & aksesibilitas

> wkr-critic-01 · 2026-11-26 · branch `feature/production-polish`. Yang dibaca: `PLAN/01` utuh, `R&D/01` (tabel gap
> G1–G27), bagian kontrak/kebutuhan di `PLAN/02` (§3.3, §3.9, §5, §7), `PLAN/03` (D22, §5, §7, dependensi), `PLAN/04`
> (K16, K17, §5, dependensi), `PLAN/05` (§3.6, F11, §7, dependensi), dan kode yang disentuh. Pemeriksaan produksi
> read-only di POCO (curl loopback ke port 3200, `log/run` runit). Tidak ada kode atau PLAN yang diubah.

## 1. Ringkasan penilaian

**Verdict: siap dengan revisi.** Bagian berikut perlu ditulis ulang: §3.1 (pemetaan status + kepemilikan), §7 (gelombang
1 dan kepemilikan lintas PLAN), §3.12 (kontrak header cache).

Arah desainnya benar dan banyak keputusannya sudah di atas rata-rata: poller single-flight yang bisa dites, `empty`
wajib, teks status yang berbeda untuk mati disengaja dan tak disengaja, fokus ke h1. Masalahnya ada di **sambungan dengan
PLAN lain**. Kamus status tidak memuat status yang sudah diminta PLAN-03. Beberapa file dimiliki dua PLAN pada waktu
yang sama. Nama props komponen berbeda dari yang ditulis konsumennya. Kontrak header cache tidak punya pemilik karena
PLAN-04 menolaknya berdasarkan spike yang keliru. Gelombang 1 juga kira-kira dua kali lebih besar dari angka yang
tertulis, dan seluruhnya ada di satu jalur kritis. Di HP, rancangannya belum memperhitungkan elemen lengket yang diminta
PLAN-03, dan pemilik (super_admin) justru tidak mendapat halaman berandanya dalam satu ketukan.

Jumlah: **2 BLOCKER · 8 MAJOR · 11 MINOR · 4 OVER**.

---

## 2. Temuan

### C1 — Kamus status tidak memuat `interrupted` dan bertentangan dengan PLAN-03; file mapping dibekukan

- **Severity**: BLOCKER
- **Area**: data / kontrak
- **Klaim di PLAN**: §3.1 pemetaan `JobStatus/DeployStatus`: `running→processing; succeeded; failed; rolled_back`. D3
  menyatakan "job/deploy `rolled_back` = 'Gagal, dibatalkan' (danger)". Lalu: "Di gelombang 2 **hanya worker PLAN-02**
  boleh mengubah dua file itu … PLAN lain yang butuh kunci baru harus mencantumkannya di PLAN-nya sekarang supaya masuk
  gelombang 1."
- **Masalah**:
  1. PLAN-03 **sudah** mencantumkannya. PLAN-03 §3 baris 262/394 menulis `JobStatus`/`DeployStatus` =
     `… | "interrupted"`, dan tabel dependensinya (baris 1276) meminta ke PLAN-01 "`interrupted` 'Terputus' tone danger,
     `rolled_back` tone **warning** 'Dikembalikan'". Daftar status job yang tampil di daftarnya (baris 1071) adalah
     "Berjalan/Berhasil/Dikembalikan/Gagal/Terputus". PLAN-01 tidak memuat `interrupted`, memberi `rolled_back` tone
     danger dengan label "Gagal, dibatalkan", dan memberi job berjalan label "Diproses…". Ketiganya bertentangan dengan
     PLAN-03.
  2. Ini akan pecah saat dikompilasi, bukan cuma beda selera. `jobStatusKey(status: JobStatus)` dan
     `deployStatusKey(status: DeployStatus)` ditulis sebagai switch atau `Record` yang exhaustive. Begitu worker server
     PLAN-03 (gelombang 1–2) menambah `interrupted` ke `src/shared`, `status.vocab.ts` gagal typecheck. Padahal file itu
     terlarang bagi PLAN-03. Hal yang sama terjadi pada PLAN-04, yang menambah `BackupRestoreStatus` (PLAN-04 baris 192)
     dan status verifikasi ("Terverifikasi"/"Belum dicek"/"Belum pernah berhasil", §5 baris 625). PLAN-01 juga mengimpor
     `BackupSummary` dari `web/backup/backup.state.ts`, file milik PLAN-04 gelombang 2. Jadi file yang dibekukan
     bergantung pada tipe yang boleh diubah PLAN lain.
- **Usulan perubahan**:
  - Pisahkan dua hal. **Tabel kanonik** (`StatusKey` → label/tone/ikon) tetap satu file milik shell. **Fungsi mapping
    mentah → kunci** pindah ke file domain milik PLAN pemilik tipenya: `site/job.status.ts` (PLAN-03),
    `backup/backup.status-key.ts` (PLAN-04), `panel/panel.status-key.ts` (PLAN-02). Test §6 tetap memeriksa setiap union
    terpetakan. Dengan begitu PLAN yang mengubah union juga memperbarui mapping-nya di gelombang yang sama, dan aturan
    "hanya PLAN-02 boleh mengubah" tidak perlu lagi.
  - Tambah kunci `interrupted` ("Terputus", danger, `UnplugIcon` atau `CircleSlashIcon`) di gelombang 1.
  - Putuskan arti `rolled_back` bersama PLAN-03 **sebelum** gelombang 1, dalam satu kalimat yang dicatat di kedua PLAN.
    Rekomendasi saya mengikuti alasan D3 PLAN-01: tone danger, karena perubahan pengguna gagal. Tapi labelnya pakai
    usulan PLAN-03, "Dikembalikan", disertai `statusHelp` "Perubahan gagal; versi lama dipulihkan". Label pendek muat di
    badge 360 px, dan "Gagal, dibatalkan" terlalu mirip dengan kunci `undone` ("Dibatalkan").
  - Job berjalan: tetapkan satu label ("Diproses…" milik PLAN-01) dan minta PLAN-03 baris 1071 mengikutinya.

### C2 — File yang sama dimiliki dua PLAN pada waktu yang sama

- **Severity**: BLOCKER
- **Area**: rencana kerja
- **Klaim di PLAN**: §7 "Semua file di bawah milik worker ini; tidak ada worker lain menyentuhnya di gelombang 1." Daftar
  1a/1c memuat `src/shared/log.types.ts`, `src/shared/roles.ts`, `id.ts`, `session.redirect.ts`, `router.tsx`,
  `pages/public-not-found.page.tsx`, `tests/web.session.test.ts`, dan `panel.pages.ts`/`dev.pages.ts`.
- **Masalah**: PLAN lain mengklaim file yang sama dan menjadwalkannya paralel dengan gelombang 1 PLAN-01:
  | File                                                             | PLAN-01                                 | Klaim lain                                                                                                                |
  | ---------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | `src/shared/log.types.ts`                                        | 1a, dengan field `stream`               | PLAN-02 G0 `wkr-mon-types-00` (baris 960), **bentuk berbeda**: tanpa `stream`, plus `LogChunk`                            |
  | `src/shared/roles.ts`                                            | 1a `isProtectedPath`                    | PLAN-05 G1 `wkr-adm-seo-01` `SPA_ROOTS`, `isKnownSpaPath` (baris 824)                                                     |
  | `src/web/i18n/id.ts`                                             | 1a (`session.serverTitle`)              | PLAN-05 G1 `wkr-adm-i18n-01` memindah login/profil keluar dari `id.ts`; PLAN-02 G2 dan PLAN-03 G3 masing-masing "1 baris" |
  | `session.redirect.ts`, `router.tsx`, `tests/web.session.test.ts` | 1c                                      | PLAN-05 G3 `wkr-adm-routing-01` (baris 842) mengerjakan hal yang **persis sama** (`*` ke root, `NotFoundRoute`)           |
  | `pages/public-not-found.page.tsx`                                | 1c ★                                    | PLAN-05 G2 `wkr-adm-account-web-01` ★                                                                                     |
  | `router.tsx` + `panel.pages.ts`                                  | 1c, lalu dilarang diubah di gelombang 2 | PLAN-02 G3 `wkr-mon-history-03` menambah rute `/panel/problems` (baris 982)                                               |
  | `src/server/index.ts` (header cache)                             | "milik PLAN-04"                         | PLAN-05 baris 865: "`index.ts` (cache header) di PLAN/01"; PLAN-04 K17: tidak dikerjakan                                  |

  Karena "gelombang 1" tiap PLAN berjalan di waktu yang sama (PLAN-01 baris 961 menyatakan PLAN-04 paralel), dua worker
  akan saling menimpa satu working tree. Itu persis dilarang Rule 23.
- **Usulan perubahan**: tambah §7.x **"Matriks kepemilikan lintas PLAN"** yang disepakati orkestrator sebelum dispatch:
  - `log.types.ts`: satu pemilik. Usul PLAN-02 G0 menulisnya **dengan** bentuk yang disepakati (lihat C4), dan PLAN-01
    1a hanya mengonsumsi.
  - `roles.ts`: PLAN-01 1a menulis `isProtectedPath` **dan** `SPA_ROOTS`/`isKnownSpaPath`, karena konsepnya sama (prefix
    area). PLAN-05 seo mengimpor saja.
  - Routing dan 404 publik: milik PLAN-01. Hapus `wkr-adm-routing-01` dan `public-not-found.page.tsx` dari PLAN-05.
  - `id.ts`: PLAN-05 `wkr-adm-i18n-01` dijalankan **sebelum** PLAN-01 1a atau sesudah 1c, jangan bersamaan. Penambahan
    satu baris dari PLAN-02/03 dikumpulkan ke gelombang 3 sesuai aturan PLAN-01 sendiri (baris 978).
  - Rute baru di gelombang 2 (`/panel/problems`): izinkan PLAN domain menambah **satu entri** di router. Cara yang lebih
    baik ada di C11, yaitu menghapus file re-export area sehingga tidak ada file beku yang menghalangi.

### C3 — Kontrak header cache (§3.12) tidak punya pemilik; bukti PLAN-04 keliru, dan solusi PLAN-01 berlebihan

- **Severity**: MAJOR
- **Area**: kontrak / fitur
- **Klaim di PLAN**: "Header aset: hanya `ETag`, **tanpa `Cache-Control`**." D13 dan §3.12 menyebut "diimplementasikan
  PLAN-04", dengan cara `Bun.serve` internal kedua di `127.0.0.1:0` yang memproksi semua request non-API.
- **Masalah**:
  1. PLAN-04 K17 (baris 83) menolak: "Cache sudah benar dari Bun (bukti spike) … **PLAN/01 tidak perlu mengerjakan R1-G14
     opsi B**." Spike itu menjalankan `bun src/server/index.ts`, bukan binary `--compile`. Saya mengukur **binary
     produksi di POCO** (loopback, Host kanonik):

     ```
     /chunk-gx0a4486.js   → 200, Content-Type text/javascript, ETag: EP0ACiSkqCY, tanpa Cache-Control
     /chunk-zzzzzzzz.js   → 200, Content-Type text/html   (SPA fallback, bukan 404)
     /login (HTML)        → 200, text/html, tanpa Cache-Control
     ```

     Jadi pengukuran PLAN-01 benar dan PLAN-04 salah. Akibatnya baris tabel §3.12 tidak dikerjakan siapa pun, dan
     PLAN-05 mengira PLAN-01 yang mengerjakannya.
  2. Solusi yang diusulkan berlebihan untuk masalahnya. Tanpa `Last-Modified`, browser tidak memberi freshness heuristik
     (RFC 9111 §4.2.2), jadi aset dengan ETag saja selalu divalidasi ulang (304) dan **tidak pernah basi**. Deteksi chunk
     gagal (F6) juga tetap jalan walau server mengirim HTML 200 untuk chunk lama. Chrome melaporkan "Failed to fetch
     dynamically imported module" (pemeriksaan MIME gagal), dan Safari/Firefox memberi pesan yang sudah ada di regex
     `isChunkLoadError`. Satu-satunya keuntungan `immutable` adalah menghemat beberapa RTT 304 per area. Untuk panel satu
     pemilik, itu tidak sebanding dengan server HTTP kedua plus proksi untuk setiap aset (R3 di PLAN-01 sendiri).
- **Usulan perubahan**:
  - Ubah D13 menjadi: aset tetap memakai header bawaan Bun (ETag, divalidasi ulang). `/__spa` ditutup oleh PLAN-04 K16.
    Baris "404 `text/plain` untuk chunk hilang" dan "`immutable`" dicatat sebagai P2, dengan pemicu "TTFB 304 terukur
    > 300 ms di HP". Bila suatu saat dibutuhkan, Cache Rule Cloudflare untuk `/chunk-*` jauh lebih murah daripada
    server kedua.
  - Kirim koreksi ke PLAN-04 K17: buktinya berasal dari mode non-compile. Kalau HTML perlu `no-cache` eksplisit,
    tambahkan satu header di handler `/*` yang sudah ada (`src/server/index.ts:110-126`).
  - Tambah test chunk §6: "chunk hilang mengembalikan HTML 200 → `isChunkLoadError` true (pesan Chrome)". Itu kondisi
    nyata hari ini.

### C4 — Nama props dan tipe komponen tidak cocok dengan yang ditulis konsumen

- **Severity**: MAJOR
- **Area**: kontrak
- **Klaim di PLAN**: §3.3–§3.5 adalah "kontrak" yang "dipakai PLAN domain tanpa menebak".
- **Masalah**: konsumen menulis nama yang berbeda. Kalau dibiarkan, tiap worker gelombang 2 akan menebak atau meminta
  "1b susulan":
  | Komponen            | PLAN-01                                  | Ditulis konsumen                                                                             |
  | ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
  | `DataTable` aksi    | `actions`                                | `rowActions` (PLAN-02 §3.9, PLAN-03 baris 987/1276)                                          |
  | `DataTable` kolom   | `hideOnMobile`                           | `columns[].hidden` (PLAN-02: kolom CPU disembunyikan bila semua kosong)                      |
  | `DataTable` error   | dihapus                                  | "`error` menerima `ApiError` atau node" (PLAN-02)                                            |
  | `LogViewer` follow  | `live: {on, onChange}`                   | `following`, `onFollowChange`, `newCount`, `toolbarStart`, `maxLines`, `emptyText` (PLAN-02) |
  | `LogLine`           | `{at, text, stream?, level?}`            | `{at, text, level?}` + `LogChunk {lines, cursor, reset, truncated}` (PLAN-02 §3.3)           |
  | `truncated`         | "server memotong → 2.000 baris terakhir" | `LogChunk.truncated` = "ada data baru lebih banyak dari yang dikirim" (arti lain)            |
  | `useApiQuery`       | `(url, refreshMs?, opts?)`               | `(url, { refreshMs, pauseHidden })` (PLAN-02)                                                |
  | `ConfirmAction`     | `tier?: "confirm" \| "typed"`            | `"none" \| "confirm" \| "typed"` (PLAN-02/03/05)                                             |
  | Pemilik `LogViewer` | PLAN-01                                  | PLAN-05 baris 44/539/699: "LogViewer dari PLAN/02 [DEP]"                                     |

  `appendLogLines` juga tidak menangani `LogChunk.reset` (rotasi file). Kalau pemanggil mengosongkan buffer lalu mengisi
  ulang dan `seq` mulai dari 0, maka `n = lines.at(-1).seq − snapshot.at(-1).seq` bernilai negatif selama pengguna
  menggulir ke atas.
- **Usulan perubahan**: tambah §3.15 "Rekonsiliasi kontrak" yang menetapkan satu nama per baris tabel di atas. PLAN-01
  menang karena ia pemilik, dan PLAN lain menyesuaikan teksnya. Isi minimum:
  - `DataTable.actions`, cukup satu nama.
  - Konsumen yang ingin menyembunyikan kolom secara kondisional cukup tidak memasukkannya ke `columns`, tanpa prop baru.
  - `LogLine` final: tanpa `stream`, karena PLAN-02 memisah stream di server lewat `?stream=`. Prop `streams` tetap ada
    sebagai kontrol yang dikendalikan pemanggil.
  - `appendLogLines(prev, chunk: { lines, reset })`, dengan reset membuang `prev` tetapi `seq` tetap melanjutkan.
  - `truncated` di viewer diganti nama menjadi `capped`.
  - `ConfirmAction` tidak punya tier "none" (tanpa konfirmasi berarti tombol biasa). Tulis itu di tabel §3.2 agar
    PLAN-02/03/05 berhenti menulisnya.
  - Pemilik `LogViewer` = PLAN-01, dan PLAN-05 diperbaiki.

### C5 — Primitif polling tidak cocok untuk follow log berbasis cursor

- **Severity**: MAJOR
- **Area**: flow / kontrak
- **Klaim di PLAN**: F4-2 "`live.on` → pemanggil poll 3 dtk (`?after=` dari PLAN-02)" lewat "`useApiQuery(..., {
  enabled: on })`" (§3.4 perilaku 1). Lalu "**dilarang `setInterval` polling sendiri**".
- **Masalah**: `useApiQuery` mengganti `data` setiap respons, dan `url` berubah tiap poll karena `after=<cursor>`. Menurut
  P8, perubahan URL berarti abort dan siklus baru, sehingga P3/P4 (jadwal setelah selesai, backoff) di-reset setiap 3
  detik dan hook kehilangan arti backoff. PLAN-02 sudah menyadari ini dan menulis `useLogFollow` sendiri (PLAN-02 §3.9).
  Tanpa primitif bersama, hook itu akan mengulang logika visibilitas/backoff atau memakai `setInterval`, padahal itu
  dilarang guard test gelombang 3. Kasus `enabled: false` sebelum data pertama juga tidak didefinisikan: `QueryView`
  akan menampilkan skeleton selamanya (`data === undefined && !error`).
- **Usulan perubahan**: ekspor `usePoller(run: (signal) => Promise<"ok"|"error">, { baseMs, enabled })` (±25 baris di
  atas `createPoller`) sebagai **satu-satunya** primitif. `useApiQuery` dibangun di atasnya, begitu juga `useLogFollow`
  milik PLAN-02, yang menyimpan cursor di ref dan **bukan** di URL. Tambahkan aturan bahwa `enabled: false` tidak
  mencegah fetch pertama, kecuali diberi `{ initial: false }`. Test §6 ditambah satu kasus: cursor berubah tiap respons
  tetapi backoff tetap 10→20→40.

### C6 — 403 berakhir di landing publik, bukan di beranda peran

- **Severity**: MAJOR
- **Area**: flow
- **Klaim di PLAN**: F3-5 "**Izin ditolak** (peran diturunkan saat dialog terbuka): 403 → `apiFetch` mengalihkan ke `/` →
  beranda peran."
- **Masalah**: `redirectFor` mengirim 403 ke `"/"` (`src/web/shared/api.client.ts:57-61`, dengan komentar "which
  SessionGate sends home"). Padahal `resolveRedirect` mengembalikan `null` untuk `/` bagi **semua** pengguna
  (`src/web/session/session.redirect.ts:15`). Admin yang diturunkan perannya mendarat di landing produk publik dengan
  CTA "Pasang di HP-mu", bukan di `/profile`. D14 justru mengukuhkan `/` sebagai halaman publik, jadi bug ini makin pasti.
- **Usulan perubahan**: satu baris, `forbidden → LOGIN_PATH`. Pengguna yang login dan membuka `/login` dialihkan
  `resolveRedirect` ke `homeFor(role)` dengan **full load** (`needsFullLoad`), sehingga `/api/me` dibaca ulang dengan
  peran baru. Perbaiki komentar di `api.client.ts:56` dan tambah test di `tests/web.session.test.ts`.

### C7 — Pemilik (super_admin) tidak mendapat berandanya dalam satu ketukan di HP

- **Severity**: MAJOR
- **Area**: UI
- **Klaim di PLAN**: D5 "Halaman harian 1 ketukan … Super Admin memakai 4 tujuan yang sama; Administrasi ada di urutan
  pertama sheet 'Lainnya'." Q1 default: tidak diganti.
- **Masalah**: `homeFor("super_admin") = "/dev"` (`src/shared/roles.ts:7`). Panel ini dipakai satu pemilik, dan pemilik
  itu super_admin. Setelah login di HP, ia mendarat di Kesehatan sistem dengan tab **"Lainnya"** yang aktif, dan untuk
  kembali ke berandanya butuh dua ketukan (Lainnya → Kesehatan sistem). Rancangan ini mengoptimalkan peran Admin, yang
  pada praktiknya mungkin tidak pernah ada.
- **Usulan perubahan**: pilih salah satu dan jadikan default.
  - (a) Slot 4 untuk super_admin = "Kesehatan" (`/dev`, label ≤ 9 huruf). "Aplikasi" pindah ke "Lainnya".
  - (b) `homeFor("super_admin") = "/panel"`. Ini perubahan milik PLAN-05, yang juga mengubah README §Layar.

  Saya merekomendasikan (b) karena lebih kecil dan membuat "Ringkasan" menjadi beranda semua operator. Q1 dijadikan
  pertanyaan pemilik dengan default yang menguntungkan pemilik.

### C8 — Elemen lengket di HP menumpuk; tidak ada pola bersama untuk bar aksi bawah

- **Severity**: MAJOR
- **Area**: UI
- **Klaim di PLAN**: §1 YAGNI: "header sticky di detail" tidak dibuat. §3.7: top bar 48 px sticky dan bottom bar 56 px
  fixed. Toast di atas bottom bar.
- **Masalah**: PLAN-03 meminta dari PLAN-01 "`PageHeader` … + varian lengket" dan "bar aksi lengket bawah HP" (baris
  1276), chip jangkar "lengket di bawah top bar" (baris 1044), footer Simpan yang lengket di editor env (baris 1093), dan
  tombol Kembali/Lanjut wizard di bar bawah (baris 1032). Kalau dijumlahkan di 360×640 (area konten ±560 px setelah UI
  browser): top bar 48 + chip ±44 + bar aksi ±64 + bottom nav 56 + safe-area, sekitar **210 px (±38%)** habis untuk
  elemen tetap. Toast (`mobileOffset` = bottom nav saja) akan menutupi bar aksi. Tanpa komponen bersama, setiap PLAN akan
  menghitung `bottom:` sendiri. PLAN-01 juga tidak menjawab permintaan PLAN-03 ini, baik menerima maupun menolak.
- **Usulan perubahan**:
  - Bottom nav **disembunyikan** di rute tugas, mengikuti pola tab bar iOS/Android yang hilang di alur push: wizard
    `/panel/sites/new` dan halaman yang sedang punya perubahan belum disimpan. Caranya dengan `handle: { task: true }`
    di route atau prop `PageHeader task`, lalu `mobile.nav.tsx` membaca `useMatches()`.
  - Satu komponen `ActionBar` (±20 baris) di `components/` dengan `bottom: var(--bottom-nav-h)`, plus safe-area. Ia
    juga menyetel `--action-bar-h`, dan `mobileOffset` toast menjumlahkan keduanya.
  - Tolak secara eksplisit "PageHeader varian lengket" di HP (top bar sudah menampilkan judul). Di desktop boleh
    menunggu bukti kebutuhan.
  - Kriteria QA: "di 360×640, elemen tetap ≤ 120 px di halaman mana pun".

### C9 — Anatomi kartu `DataTable` di HP tidak ditetapkan

- **Severity**: MAJOR
- **Area**: UI / kontrak
- **Klaim di PLAN**: §3.3 hanya menyebut "Di HP: kartu `min-h-14`, aksi di baris bawah `border-t pt-2 flex gap-2`",
  `primary`, dan `hideOnMobile`.
- **Masalah**: tidak dijelaskan bagaimana kolom non-primary dirender di kartu: label + nilai per baris, satu baris meta,
  atau badge di samping judul. Setiap PLAN sudah mulai mengarang sendiri. PLAN-04 baris 629 menulis "judul + badge di
  baris 1, waktu · ukuran di baris 2, aksi berupa tombol **penuh lebar bertumpuk**", yang bertentangan dengan `flex
  gap-2` dan aturan §5.6 "satu aksi utama + menu ⋯". PLAN-05 baris 678 menulis "⋯ kanan 44 px". Hasilnya, kartu di 360 px
  akan berbeda di setiap halaman, dan tujuan "satu sistem desain" gagal di layar yang paling penting.
- **Usulan perubahan**: tambah `mobile?: "title" | "badge" | "meta" | "hidden"` pada `DataColumn` (mengganti
  `primary`/`hideOnMobile`) dan tetapkan anatominya:
  - Baris 1: `title` (tebal, truncate) + `badge` di kanan.
  - Baris 2: semua `meta` digabung dengan " · " (`text-xs text-muted-foreground`, wrap).
  - Footer: satu aksi utama `size="sm"` + ⋯.

  Tombol bertumpuk penuh lebar dilarang. Tambahkan satu sketsa ASCII di §5, seperti §5.2.

### C10 — Gelombang 1 sebenarnya ±70 file, dan seluruhnya ada di jalur kritis empat PLAN

- **Severity**: MAJOR
- **Area**: rencana kerja
- **Klaim di PLAN**: "Perkiraan: ±30 file, ±1.700 baris produksi + ±450 baris test. Ukuran **L**." R9: "PLAN domain bisa
  menulis PLAN/test domainnya sambil menunggu."
- **Masalah**: dihitung dari tabel §7 sendiri, langkah 1a berisi 17 file + ±7 file test, 1b berisi 25 file (17 komponen,
  `query.state`, 6 `ui/*`, `styles.css`), dan 1c berisi ±29 file (11 layout termasuk yang dihapus, 5 session, 3 pages,
  router, 2 re-export area, 2 layout yang dihapus, `index.html`, `build.ts`, landing, login, content guide). Totalnya
  **±71 file produksi + ±7 test**, lebih dari dua kali angka tertulis. LogViewer dan ConfirmAction saja sudah ±600 baris,
  jadi 1.700 baris juga terlalu optimistis. Halaman web PLAN-02 (G2), PLAN-03 (G3), PLAN-04, dan PLAN-05 (G2) semuanya
  menunggu **seluruh** gelombang 1, termasuk routing, splitting, dan session yang tidak mereka butuhkan untuk memigrasi
  halaman.
- **Usulan perubahan**: pecah gelombang 1 menjadi worker paralel dengan file yang tidak beririsan. Kontraknya sudah
  tertulis, jadi tidak ada ketergantungan kode di antara mereka selain tipe:
  - `wkr-shell-core-01`: 1a (modul murni, poller, format, status, i18n shell).
  - `wkr-shell-ui-01`: komponen 1b, kecuali log.
  - `wkr-shell-log-01`: `log.buffer` + LogViewer trio + `log.time`.
  - `wkr-shell-nav-01`: 1c (shell, router, session, split).

  Domain PLAN mulai segera setelah **core + ui** masuk. LogViewer hanya memblokir halaman log (PLAN-02 G3, PLAN-05
  logs), dan nav/split tidak memblokir siapa pun. Perbarui perkiraan ukuran menjadi ±70 file / ±2.500 baris.

### C11 — Splitting per area (6 chunk, 3 file re-export, semua rute lazy) berlebihan

- **Severity**: OVER
- **Area**: fitur / rencana kerja
- **Klaim di PLAN**: D11 "Code splitting per area (landing, login, shell, panel, dev, profil)". §3.11 memakai file
  `shell.chunk.ts`, `panel.pages.ts`, dan `dev.pages.ts`.
- **Masalah**: nilai yang disebut D11 sendiri adalah "landing tidak memuat panel". Itu cukup dicapai dengan **satu** batas
  lazy. Pemilik satu-satunya (super_admin) memuat panel, dev, dan profil, jadi memecah area tidak menghemat apa pun
  baginya. Malah setiap area pertama kali dibuka menambah 1 RTT lewat tunnel. File re-export area adalah file bersama
  yang dibekukan di gelombang 2 dan langsung bentrok dengan rute baru PLAN-02 (lihat C2). `panel.pages.ts` juga memuat
  halaman tiga PLAN sekaligus (02, 03, 04).
- **Usulan perubahan**: cukup tiga chunk.
  - Entry: router, `SessionGate`, landing.
  - `login`: lazy, karena membawa better-auth.
  - `app`: satu lazy `AppLayout`, dengan semua halaman diimpor statis di dalam `app.routes.tsx` yang dimiliki
    bergantian per gelombang.

  `shell.chunk.ts`, `panel.pages.ts`, dan `dev.pages.ts` dihapus. Target ukuran §3.11 tetap berlaku. Kalau ukuran `app`
  nanti terukur > 250 KB gzip, baru dipecah lagi.

### C12 — Permintaan PLAN-02 memindah formatter ke `src/shared` belum dijawab

- **Severity**: MINOR
- **Area**: kontrak
- **Klaim di PLAN**: §3.10 mengubah `src/web/shared/format.ts`, yang dimiliki 1a.
- **Masalah**: PLAN-02 §3.9 meminta `formatBytes`/`formatDuration`/`formatNumber` dipindah ke `src/shared/format.id.ts`
  karena dipakai `problem.copy.ts` di server (pesan Telegram). File itu milik PLAN-01 gelombang 1, dan PLAN-01 diam.
  Fallback PLAN-02 adalah mengimpor `src/web/...` dari `src/shared`, yang melanggar lapisan.
- **Usulan perubahan**: 1a membuat `src/shared/format.id.ts` (formatter murni) dan `src/web/shared/format.ts` me-re-export
  ditambah `formatClock`/`formatDayLabel`. Test format dipindah sesuai lokasinya.

### C13 — Parser TAI64N dan ISO tidak dibutuhkan; ada dua parser untuk hal yang sama

- **Severity**: OVER
- **Area**: fitur
- **Klaim di PLAN**: §3.4 `splitLogTimestamp` mendukung `svlogd -tt`, TAI64N (`-t`), dan ISO ber-zona, dengan aritmetika
  `BigInt` 2^62.
- **Masalah**: semua `log/run` di POCO memakai `svlogd -tt` (diperiksa: `5 svlogd -tt`, tidak ada `-t`). pm2 tidak
  ber-zona (`at: null`), dan log panel `/dev/logs` sudah punya `at` terstruktur. Di sisi lain PLAN-02 menulis parser
  svlogd sendiri di `src/server/system/log.parse.ts` (PLAN-02 baris 863), dengan pecahan detik mentah ke ISO. Jadi ada
  dua parser, dan satu di antaranya mendukung format yang tidak ada.
- **Usulan perubahan**: satu fungsi untuk `svlogd -tt` saja (regex + potong ke milidetik), milik satu PLAN. Usul: PLAN-02
  `log.parse.ts`, karena ia yang membaca file, dan PLAN-01 cukup mengacu. TAI64N dan ISO masuk daftar YAGNI. Test §6
  disusutkan.

### C14 — `StaleNotice` `role="status"` berisi waktu relatif yang terus berubah

- **Severity**: MINOR
- **Area**: UI (a11y)
- **Klaim di PLAN**: §3.3 "`StaleNotice` (bar `warning-subtle`, `role="status"`): `id.shell.stale(rel)`", dengan `rel`
  dari `RelativeTime` yang ber-tick 15 dtk.
- **Masalah**: `role="status"` adalah live region polite. Setiap kali "2 mnt lalu" berganti menjadi "3 mnt lalu", pembaca
  layar membacakan ulang seluruh kalimat. Selama jaringan putus (backoff hingga 60 dtk), pengguna TalkBack akan
  diganggu terus-menerus.
- **Usulan perubahan**: live region hanya berisi teks statis "Tidak bisa memperbarui data." dan diumumkan sekali saat
  muncul. "Data terakhir diperbarui {rel}" dan tombol ditaruh di luar region (atau `aria-live="off"` pada `<time>`).

### C15 — Slot "Lainnya" di bottom bar memakai semantik yang salah; sheet tidak tertutup di halaman yang sama

- **Severity**: MINOR
- **Area**: UI (a11y)
- **Klaim di PLAN**: §3.7 "`aria-current="page"` pada yang aktif … Slot 5 'Lainnya' aktif bila pathname tidak cocok" dan
  "Tertutup otomatis saat `pathname` berubah (efek, bukan `onNavigate` per link)".
- **Masalah**:
  - "Lainnya" adalah tombol pembuka dialog, bukan halaman, jadi `aria-current="page"` di sana menyesatkan pembaca layar.
    Atributnya seharusnya `aria-haspopup="dialog"` + `aria-expanded`.
  - Mengetuk item untuk halaman yang **sedang** dibuka (mis. Domain saat di `/panel/domains`) tidak mengubah `pathname`,
    sehingga sheet tetap terbuka dan terasa "macet".
- **Usulan perubahan**: "Lainnya" diberi `aria-haspopup="dialog" aria-expanded`, dan status aktifnya cukup visual + teks
  `sr-only` "(halaman saat ini ada di menu ini)". Sheet ditutup oleh efek pathname **dan** satu handler klik terdelegasi
  pada `<nav>` di sheet (`onClick` yang mendeteksi `a`). Itu satu handler, bukan per link.

### C16 — Detail implementasi `ConfirmAction` yang akan gagal bila mengikuti pola radix biasa

- **Severity**: MINOR
- **Area**: kontrak / fitur
- **Klaim di PLAN**: §3.2 perilaku 3–4 (dialog tetap terbuka saat reject) dan `onConfirm: () => Promise<unknown>`.
- **Masalah**:
  - `AlertDialogAction` dari radix **menutup dialog otomatis** saat diklik. Komponen yang ada sekarang memakainya
    (`src/web/shared/confirm.dialog.tsx:46`), jadi meniru pola lama akan melanggar perilaku 4.
  - Server PLAN-03 D22 mensyaratkan `?confirm=<nama>`, dan PLAN-02 `ControlBody { confirm }` mensyaratkan nilai yang
    diketik. Signature `onConfirm()` tidak menerimanya, sehingga pemanggil harus menyalin `typedValue` sendiri.
  - Nama `ConfirmAction` sudah dipakai di `shared/confirm.dialog.tsx:18` dengan signature lain, sehingga auto-import
    selama gelombang 2 bisa memilih yang salah.
- **Usulan perubahan**: tulis eksplisit "tombol konfirmasi = `Button` biasa, bukan `AlertDialogAction`". Ubah signature
  menjadi `onConfirm: (typed?: string) => Promise<unknown>`. Ganti nama komponen lama menjadi `LegacyConfirmAction` di
  1b (satu baris re-export) sampai gelombang 3.

### C17 — Restart panel: dialog terkunci sampai pulih bertentangan dengan overlay PLAN-02

- **Severity**: MINOR
- **Area**: flow
- **Klaim di PLAN**: F3-7 "`ConfirmAction` cukup menerima `onConfirm` yang resolve setelah pulih."
- **Masalah**: PLAN-02 memakai 202 + `restart.overlay.tsx` (poll 2 dtk, maks 90 dtk). Kalau `onConfirm` menunggu pemulihan,
  dialog terkunci (Escape mati, kedua tombol disabled) hingga 90 detik, tanpa jalan keluar bila sesi Access habis
  (PLAN-02 R6).
- **Usulan perubahan**: `onConfirm` resolve begitu 202 diterima, dialog ditutup, lalu overlay PLAN-02 mengambil alih.
  Perbarui F3-7.

### C18 — `@custom-variant coarse` mengulang fitur bawaan Tailwind

- **Severity**: OVER
- **Area**: UI
- **Klaim di PLAN**: §3.8 "`styles.css`: `@custom-variant coarse (@media (pointer: coarse));`".
- **Masalah**: versi terpasang `tailwindcss` 4.3.5 sudah punya varian `pointer-coarse:` (ada di
  `node_modules/tailwindcss/dist/lib.js`).
- **Usulan perubahan**: pakai `pointer-coarse:` dan hapus baris custom-variant. Kriteria §6 tidak berubah.

### C19 — Copy PLAN-02 masih menampilkan hitungan detik yang dilarang D16

- **Severity**: MINOR
- **Area**: kontrak (konten)
- **Klaim di PLAN**: D16 "Hitungan detik ('12 dtk lalu') sengaja tidak pernah tampil."
- **Masalah**: PLAN-02 §5.1 masih menulis "Diperbarui 12 dtk lalu" dan "dicek 40 dtk lalu".
- **Usulan perubahan**: masukkan ke daftar rekonsiliasi C4. PLAN-02 memakai "baru saja" untuk < 60 dtk.

### C20 — Fitur LogViewer yang bisa ditunda

- **Severity**: OVER
- **Area**: fitur
- **Klaim di PLAN**: §3.4 perilaku 7 (baris pemisah tanggal), 8 (potong 4.000 karakter + `lineCut`), 9 (Dialog layar
  penuh berisi "viewer yang sama"), dan tiga file komponen.
- **Masalah**: untuk satu pemilik, `size="page"` sudah mengisi sisa layar, sehingga di HP halaman log **sudah** layar
  penuh. Dialog layar penuh berarti instance viewer kedua, dengan state pin/cari/scroll yang harus disinkronkan atau
  hilang. Pemisah tanggal dan pemotongan per baris adalah polesan yang belum diminta gap mana pun. Sebaliknya, ada satu
  hal yang **kurang**: syarat performa. Dengan poll 3 dtk dan 2.000 baris tanpa virtualisasi, baris harus di-memo per
  `seq`, kalau tidak setiap poll merender ulang ±6.000 node di HP.
- **Usulan perubahan**: tunda pemisah tanggal, `lineCut`, dan Dialog layar penuh ke P2. Tambah aturan "`LogLines` =
  `memo` per baris dengan key `seq`; filter dengan `useDeferredValue`". Kemungkinan cukup dua file.

### C21 — Kriteria ukuran bundle manual, padahal PLAN-05 mengharapkan skrip

- **Severity**: MINOR
- **Area**: test
- **Klaim di PLAN**: §6 Bundle: "hitung `gzip -c` … (DevTools Network, cache dimatikan)".
- **Masalah**: langkah ini tidak bisa diulang di CI, dan PLAN-05 baris 794 mengacu pada "`scripts/bundle-report.ts` milik
  PLAN/01" yang tidak ada di PLAN-01. Hasilnya, regresi ukuran tidak akan pernah tertangkap.
- **Usulan perubahan**: tambahkan satu test (`tests/web.bundle.test.ts`): `Bun.build({ entrypoints:
  ["src/web/index.html"], splitting: true, outdir: tmp, minify: true })`, lalu `Bun.gzipSync` per output. Test itu
  memastikan entry ≤ 150 KB dan bahwa entry tidak memuat string penanda dari `src/web/panel`/`dev`/`site`. Bila build
  terlalu lambat untuk `bun test`, jadikan skrip `bun run bundle:check`.

### C22 — Waktu absolut hanya di `title`, sehingga tidak terjangkau di layar sentuh

- **Severity**: MINOR
- **Area**: UI (HP, a11y)
- **Klaim di PLAN**: §3.10 "Daftar memakai `RelativeTime` (relatif < 7 hari, absolut di `title`)".
- **Masalah**: `title` tidak bisa dibuka di HP dan tidak konsisten dibacakan pembaca layar (`relative-time.tsx:27`).
  Pemilik yang menyelidiki insiden dari HP tidak bisa melihat jam persisnya.
- **Usulan perubahan**: di halaman detail dan riwayat perubahan, tampilkan absolut sebagai teks. Di daftar cukup relatif,
  tetapi sel `RelativeTime` menyertakan `aria-label` absolut.

### C23 — Tabel §3.12 bertentangan dengan PLAN-04 K16 dan PLAN-05 K16

- **Severity**: MINOR
- **Area**: kontrak
- **Klaim di PLAN**: "Navigasi HTML SPA (path lain non-`/api`) → 200" dan "`/__spa` dari luar → 404".
- **Masalah**: PLAN-05 F11 mengembalikan **404** (HTML SPA + noindex) untuk path di luar `SPA_ROOTS`. PLAN-04 K16
  mengganti `/__spa` dengan path acak per proses, sehingga path lama jatuh ke `/*`, bukan 404.
- **Usulan perubahan**: tabel §3.12 cukup menyatakan apa yang dibutuhkan klien (chunk error terdeteksi, HTML tidak basi)
  dan mengacu ke PLAN-04/05 untuk status dan path.

### C24 — Judul top bar dari efek tertinggal satu frame

- **Severity**: MINOR
- **Area**: UI
- **Klaim di PLAN**: §3.7 `useShellPage()` dipanggil `PageHeader` dan "efek dibersihkan saat unmount".
- **Masalah**: judul didaftarkan lewat `useEffect`, sehingga render pertama halaman baru masih menampilkan judul lama (atau
  kosong) di top bar HP dan di `document.title`, lalu berkedip. Di HP, judul top bar adalah satu-satunya judul yang
  terlihat (D6).
- **Usulan perubahan**: judul statis diambil dari `handle: { title }` di route lewat `useMatches()` (fitur bawaan React
  Router, sinkron). `PageHeader` hanya menimpa judul dinamis (nama situs, job), dengan `useLayoutEffect`.

### C25 — Alasan menunda badge masalah (R1-G26) sudah tidak berlaku

- **Severity**: MINOR
- **Area**: fitur
- **Klaim di PLAN**: §1 "Butuh sumber masalah murah yang tidak memaksa shell mem-poll `/api/panel/overview`".
- **Masalah**: PLAN-02 sudah menyediakan `GET /api/panel/status` (tanpa perintah sistem, poll 60 dtk) dan meminta slot
  `badge` di `NavItem` (PLAN-02 §3.9).
- **Usulan perubahan**: putuskan secara eksplisit. Tetap P2 tidak masalah, tetapi tulis alasan yang benar, mis. "tunggu
  PLAN-02 G2". Atau tambahkan `badge?: ReactNode` di `NavItem` sekarang (satu prop, nol logika) supaya PLAN-02 tidak
  perlu menyentuh file shell nanti.

---

## 3. Hal yang sudah baik (pertahankan)

- **Poller murni dengan timer di-inject** (P1–P8). Tidak meng-abort request lambat dan menggabungkan `reload()`. Ini
  memperbaiki R2-gap 4 dari akarnya, dan test-nya realistis tanpa DOM.
- **`empty` wajib di `QueryView` baru** dengan strategi B+C. Compiler memaksa teks kosong yang spesifik tanpa memecah 18
  pemanggil lama.
- **D2**: "Dihentikan" vs "Mati" dibedakan lewat **teks**, tidak hanya warna (WCAG 1.4.1). Test §6 memeriksa labelnya
  benar-benar berbeda.
- **Input typed**: `autoCapitalize="off"` dan alasannya ditulis. Ini detail khas HP yang sering terlupa.
- **`StaleNotice`** untuk data basi, menggantikan error penuh di atas data. Fokus ke `#page-title` hanya saat pathname
  berubah, bukan saat query berubah.
- **Sheet tertutup lewat efek pathname**, yang menutup bug R1-G6 dari akarnya (perlu satu tambahan, lihat C15).
- **Bukti terukur**: splitting di `--compile`, props sonner yang dicek di `.d.ts`, dan pengamatan "tanpa Cache-Control"
  yang **terkonfirmasi di produksi** (C3).
- **Daftar YAGNI eksplisit** (command palette, sort, virtualisasi, ANSI, PWA). Ini membantu kritikus dan menahan
  pembengkakan.
- **Guard test gelombang 3** (tanpa palet mentah, tanpa `setInterval`, satu `Toaster`) membuat aturan bisa ditegakkan,
  bukan sekadar anjuran.

## 4. Pertanyaan yang hanya bisa dijawab pemilik

1. **Beranda di HP (C7)**: setelah login, kamu (super_admin) mau langsung ke **Ringkasan** (`/panel`) atau ke
   **Kesehatan sistem** (`/dev`)? Kalau Kesehatan sistem, ia akan menggantikan slot "Aplikasi" di bottom bar. Rekomendasi
   kritik: Ringkasan.
2. **Label perubahan yang gagal lalu dipulihkan (C1)**: "Dikembalikan" (usulan PLAN-03) atau "Gagal, dibatalkan" (usulan
   PLAN-01)? Warnanya merah di kedua opsi. Rekomendasi kritik: "Dikembalikan" + keterangan "versi lama dipulihkan".
