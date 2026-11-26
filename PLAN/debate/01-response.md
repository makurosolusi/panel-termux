# Respons penulis — PLAN 01 (shell, design system, komponen bersama)

> wkr-plan-shell-01 · 2026-11-26 · menjawab `PLAN/debate/01-critique.md` (C1–C25) dengan memperhitungkan
> `PLAN/debate/00-integration-critique.md` (X5, X8, X9, X16–X20, X24 dan jadwal W0–W3). Semua perubahan sudah
> dimasukkan ke `PLAN/01-shell-design-content.md` (bagian "Riwayat revisi" mencatat ringkasannya). Tidak ada kode
> yang diubah.
>
> Keputusan owner yang mengikat dan dipakai di sini: tamu di URL tak dikenal → 404 publik; `include_secrets` default
> off; MIT + v0.3.0. Dua pertanyaan owner masih **terbuka** dan memakai rekomendasi kritikus sebagai default: (Q1)
> beranda super_admin di HP = Ringkasan; (Q4) label `rolled_back` = "Dikembalikan".

**Rekap: 19 TERIMA · 6 TERIMA SEBAGIAN · 0 TOLAK.**

---

## Respons per temuan

### C1 — Kamus status tanpa `interrupted`; file mapping dibekukan · BLOCKER

**Verdict: TERIMA**

Bukti: PLAN-03 baris 262/394 menambah `"interrupted"` ke `JobStatus`/`DeployStatus`. Mapping exhaustive di
`status.vocab.ts` akan gagal typecheck begitu union berubah, padahal file itu terlarang bagi PLAN-03. Ini cacat
struktural rencana, bukan soal selera.

Perubahan:

- Tabel kanonik (`StatusKey` → label/tone/ikon) tetap satu file milik shell: `status.vocab.ts` + `id.status.ts`.
- Fungsi mapping mentah → kunci dipindah ke file domain milik PLAN pemilik tipenya: `panel/panel.status-key.ts`
  (PLAN-02), `site/job.status-key.ts` + `deploy/deploy.status-key.ts` (PLAN-03), `backup/backup.status-key.ts`
  (PLAN-04). Masing-masing wajib `satisfies Record<Union, StatusKey>`, sehingga union yang berubah langsung memaksa
  mapping-nya diperbarui di gelombang yang sama. Aturan "hanya PLAN-02 boleh mengubah" dihapus.
- Kunci baru di gelombang 1: `interrupted` ("Terputus", danger, `UnplugIcon`). Dari X8 juga ditambahkan
  `auth_required` ("Butuh login", neutral, `LockKeyholeIcon`), `unstable` ("Tidak stabil", warning), `tunnel_down`
  ("Tunnel terputus", danger, `WifiOffIcon`), dan `key_mismatch` ("Kunci tidak cocok", danger, `KeyRoundIcon`).
  `restoring` memakai `processing`, wildcard domain memakai `unchecked` dengan label override.
- `rolled_back`: label "Dikembalikan" dengan `statusHelp` "Perubahan gagal; versi lama dipulihkan." (`statusHelp` =
  map opsional di `id.status.ts`, dipakai sebagai teks bantuan di samping badge). Tone default **danger** (rekomendasi
  C1). Catatan untuk arbitrase: X8 merekomendasikan **warning**. Keduanya ditandai Q4 terbuka. Mengganti tone hanya
  satu nilai di tabel kanonik.
- Job berjalan tetap "Diproses…" (info). PLAN-03 baris 1071 harus memakai label itu.
- Mapping `BackupSummary` tidak lagi diimpor shell dari `web/backup/backup.state.ts`.

**Usulan kontrak & kepemilikan (untuk arbitrase):**

| Artefak                                                             | Pemilik                                    | Kapan               |
| ------------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| `StatusKey`, tabel tone/ikon, `id.status.ts` (label + `statusHelp`) | shell (`wkr-shell-core-01`)                | W1, beku sesudahnya |
| Kunci kanonik baru sesudah W1                                       | permintaan tertulis → pembersihan W4 shell | –                   |
| `*.status-key.ts` per domain                                        | PLAN pemilik union                         | gelombang halaman   |
| Test "setiap union terpetakan"                                      | domain (file test domain)                  | bersama mapping-nya |

### C2 — File yang sama dimiliki dua PLAN · BLOCKER

**Verdict: TERIMA**

Bukti: tabel kritikus dicek terhadap PLAN-02 §7 G0, PLAN-05 §7 G1–G3 (baris 824/842), dan 00-integration X16/X17.
Semua klaim ganda itu benar.

Perubahan: §7.0 "Matriks kepemilikan lintas PLAN" ditambahkan dan diselaraskan dengan jadwal integrasi (W0 kontrak,
W1/W2 shell, W3 halaman, W4 pembersihan):

| File                                                                                               | Pemilik usulan                                                            | Catatan                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/log.types.ts` (`LogLine`, `LogChunk`)                                                  | `wkr-contracts-00` (W0)                                                   | bentuk §3.4 PLAN-01; shell hanya mengonsumsi                                                                                                               |
| `src/shared/roles.ts` (`isProtectedPath`, `SPA_ROOTS`, `isKnownSpaPath`, `homeFor`)                | `wkr-contracts-00` (W0)                                                   | satu konsep (prefix area); PLAN-05 seo hanya mengimpor                                                                                                     |
| `src/shared/log.time.ts`, `src/shared/format.id.ts`                                                | `wkr-shell-core-01` (W1)                                                  | modul murni; dipakai server PLAN-02                                                                                                                        |
| `src/web/i18n/id.ts`                                                                               | `wkr-shell-core-01` (W1), lalu beku sampai W4                             | tidak ada worker halaman yang menyentuhnya (X17); PLAN-05 `wkr-adm-i18n-01` berjalan di W3 dan tidak menyentuh `id.ts`, atau penggabungannya digeser ke W4 |
| Router, `session/*`, 404 publik (`public-not-found.page.tsx`)                                      | `wkr-shell-nav-02` (W2)                                                   | `wkr-adm-routing-01` dihapus dari PLAN-05; copy 404 = PLAN-05 §5.7                                                                                         |
| `src/web/app.routes.tsx`                                                                           | `wkr-shell-nav-02` (W2), beku                                             | hanya menyusun array route domain (C11)                                                                                                                    |
| `panel/panel.routes.tsx`, `site/site.routes.tsx`, `backup/backup.routes.tsx`, `dev/dev.routes.tsx` | dibuat nav-02 (W2) dengan isi rute sekarang, lalu milik PLAN domain di W3 | rute baru (`/panel/problems`) = edit di file domain sendiri                                                                                                |
| Penyaji HTTP (`src/server/http/spa.serve.ts`)                                                      | `wkr-http-01` (W1, PLAN-04)                                               | lihat C3                                                                                                                                                   |

### C3 — Header cache tanpa pemilik; solusi berlebihan · MAJOR

**Verdict: TERIMA SEBAGIAN**

Diterima:

- Fakta: binary produksi tidak mengirim `Cache-Control` untuk chunk maupun HTML, dan chunk yang tidak ada dibalas HTML 200.
  Ini dikonfirmasi tiga kali (probe saya, POCO oleh kritikus, X5). PLAN-04 K17 keliru karena diuji tanpa `--compile`.
- Server internal kedua + proksi semua aset adalah solusi yang berlebihan. Tanpa `Last-Modified`, ETag-only membuat
  browser selalu memvalidasi ulang, jadi aset tidak pernah basi (RFC 9111 §4.2.2). Deteksi chunk gagal tetap bekerja
  dengan HTML 200, karena Chrome melaporkan "Failed to fetch dynamically imported module" saat pemeriksaan MIME gagal.

Dipertahankan:

- HTML harus mengirim `Cache-Control: no-cache` secara **eksplisit**. Alasannya: R&D-01 §2.10 mengukur Cloudflare
  menambahkan `max-age=14400` pada aset tanpa header. Bila perilaku itu juga mengenai HTML, F6 (reload sekali setelah
  deploy) akan memuat HTML lama dari cache browser, sehingga reload sia-sia dan pengguna terjebak di pesan error.
  Biayanya satu `headers.set` di handler `/*` yang sudah ada (`src/server/index.ts:110-126`).

Perubahan: D13 dan §3.12 ditulis ulang. Wajib (P0): HTML `no-cache`. P2 dengan pemicu "TTFB 304 chunk > 300 ms di
HP": `immutable` untuk aset, 404 untuk chunk hilang, nosniff aset. Jalur yang disarankan bila P2 dipicu adalah Cache
Rule Cloudflare, bukan server kedua. Status 404/`noindex` dan path `/__spa` diserahkan ke PLAN-04/05 (C23). Test chunk
ditambah: "chunk hilang = HTML 200 → `isChunkLoadError` true".

**Usulan pemilik:** `wkr-http-01` (PLAN-04, W1) di `spa.serve.ts`. Kontrak minimal: semua respons HTML SPA (200 maupun
404) membawa `Cache-Control: no-cache`; aset tidak diubah. Test di binary `build:local` (X5).

### C4 — Nama props/tipe tidak cocok dengan konsumen · MAJOR

**Verdict: TERIMA SEBAGIAN**

Ditambahkan §3.15 "Rekonsiliasi kontrak", dengan PLAN-01 sebagai pemilik nama:

| Hal                     | Keputusan final                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataTable` aksi        | `actions` (bukan `rowActions`)                                                                                                                |
| Kolom kondisional       | jangan masukkan ke `columns`; tidak ada prop `hidden`. Kolom di HP diatur `mobile` (C9)                                                       |
| `DataTable.error`       | tidak ada; state lewat `QueryView`                                                                                                            |
| `LogLine`               | `{ at, text, stream?, level? }`. **`stream?` dipertahankan** (lihat di bawah)                                                                 |
| `LogChunk`              | `{ lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean }` (bentuk PLAN-02, ditulis `wkr-contracts-00`)                       |
| Prop viewer `truncated` | diganti nama `capped` (buffer klien penuh); `LogChunk.truncated` tetap berarti "server mengirim kurang dari yang ada"                         |
| `appendLogLines`        | `(prev, chunk: { lines; reset }, max?)`. `reset` membuang `prev`, `seq` **melanjutkan** dari `prev.at(-1).seq`, jadi `n` tidak pernah negatif |
| `LogViewer` follow      | tetap `live: { on, onChange }`; `newCount` dihitung komponen dari `seq` (X9); tidak ada `toolbarStart`/`maxLines`/`emptyText` (pakai `empty`) |
| `useApiQuery`           | `(url, refreshMs?, opts?)` positional, karena 20 pemanggil sudah memakai bentuk ini; `pauseHidden` tidak ada (selalu aktif)                   |
| `ConfirmAction` tier    | hanya `"confirm" \| "typed"`. Tier "tanpa" = `Button` biasa                                                                                   |
| Pemilik `LogViewer`     | PLAN-01. PLAN-05 baris 44/539/699 harus dikoreksi                                                                                             |

Yang ditolak sebagian: `stream` tidak dihapus dari `LogLine`. Benchmark §6 dan R&D-02 §6.4 meminta segmen
"Semua/stdout/stderr". Di mode "Semua", baris stderr harus tetap ditandai (`bg-danger-subtle`), dan itu butuh `stream`
per baris. Field ini opsional, jadi endpoint yang memisah stream lewat `?stream=` tidak perlu mengisinya. X9 juga
memilih bentuk dengan `stream?`.

### C5 — Polling tidak cocok untuk follow berbasis cursor · MAJOR

**Verdict: TERIMA**

Bukti: dengan P8 (URL berubah → siklus baru), `?after=<cursor>` mereset backoff setiap respons. Analisis kritikus benar.

Perubahan:

- `usePoller(run, { baseMs, enabled, initial })` (`src/web/shared/use-poller.ts`, ±25 baris di atas `createPoller`)
  menjadi **satu-satunya** primitif polling.
- `useApiQuery` dibangun di atas `usePoller`.
- `useLogFollow(url, { enabled })` (`src/web/shared/use-log-follow.ts`) milik shell (X9). Cursor disimpan di ref, bukan
  di URL. Fungsi ini memanggil `GET <url>?after=<cursor>` → `LogChunk`, lalu `appendLogLines`.
- Aturan `enabled: false` tidak mencegah fetch pertama, kecuali diberi `initial: false`. Dengan begitu tidak ada
  skeleton abadi.
- Test baru: cursor berubah setiap respons tetapi backoff tetap 10→20→40.

**Kontrak:** endpoint follow log (PLAN-02 layanan/aplikasi, PLAN-03 bila ada) menerima `?after=` (opaque, kosong = tail
awal) dan mengembalikan `LogChunk`. `/dev/logs` (PLAN-05) memakai `useApiQuery` biasa dengan data yang diganti setiap
poll (ring buffer di memori, tanpa cursor), lalu `appendLogLines(prev, { lines, reset: true })`.

### C6 — 403 berakhir di landing publik · MAJOR

**Verdict: TERIMA**

Bukti: `src/web/shared/api.client.ts:57-61` mengembalikan `"/"` untuk `forbidden`, sedangkan
`session/session.redirect.ts:15` mengembalikan `null` untuk `/`. Akibatnya pengguna terdampar di landing.

Perubahan: `redirectFor(forbidden) → LOGIN_PATH`. Full load ke `/login` membaca ulang `/api/me`, lalu `resolveRedirect`
mengalihkan ke `homeFor(role)` dengan full load. Komentar di `api.client.ts:56` diperbaiki. Test ditambahkan di
`tests/web.api-client.test.ts`. F3-5 diperbarui. File ini milik `wkr-shell-core-01`.

### C7 — super_admin tidak mendapat berandanya dalam satu ketukan · MAJOR

**Verdict: TERIMA** (default (b), Q1 tetap terbuka)

Bukti: `src/shared/roles.ts:7` `super_admin: "/dev"`. Panel dipakai satu pemilik, dan pemilik itu super_admin.

Perubahan: default `homeFor("super_admin") = "/panel"`, sehingga Ringkasan menjadi beranda semua operator. Bottom bar
tidak berubah. Ini perubahan `roles.ts` (`wkr-contracts-00`, W0) dan README §Layar (worker dokumentasi akhir), yang
dicatat sebagai dependensi ke PLAN-05. Q1 tetap terbuka: bila owner memilih Kesehatan sistem, slot 4 untuk super_admin
menjadi "Kesehatan" (`/dev`) dan "Aplikasi" pindah ke Lainnya.

### C8 — Elemen lengket menumpuk di HP · MAJOR

**Verdict: TERIMA**

Perubahan:

- Rute tugas (`handle: { task: true }`) menyembunyikan bottom nav. Rute tugas adalah wizard `/panel/sites/new` dan
  halaman dengan perubahan yang belum disimpan, yang ditandai lewat `useTaskMode(true)` dari editor (mis. env situs).
  `mobile.nav.tsx` membaca `useMatches()` dan konteks itu.
- Komponen `ActionBar` (`components/action-bar.tsx`, ±25 baris): fixed di atas bottom nav (`bottom:
  var(--bottom-nav-h)`) + safe-area. Ia menyetel `--action-bar-h`, dan `mobileOffset` toast menjumlahkan keduanya. Di
  desktop ia menjadi footer statis biasa.
- **Ditolak eksplisit**: `PageHeader` varian lengket di HP (top bar sudah menampilkan judul), dan chip jangkar lengket
  di HP (chip ikut scroll). Header lengket desktop menunggu bukti.
- QA: di 360×640 elemen tetap ≤ 120 px di halaman mana pun (top bar 48 + nav 56 = 104; tugas: top bar 48 + ActionBar 64 = 112).
- Dependensi ke PLAN-03: baris 1032/1044/1093/1276 disesuaikan.

### C9 — Anatomi kartu DataTable di HP · MAJOR

**Verdict: TERIMA**

Perubahan: `DataColumn.mobile?: "title" | "badge" | "meta" | "hidden"` menggantikan `primary`/`hideOnMobile` (0
pemakai sekarang, jadi tanpa biaya migrasi). Default kolom tanpa `mobile` adalah `"meta"`. Anatominya:

- baris 1: title (tebal, truncate) + badge di kanan;
- baris 2: semua meta digabung " · " (`text-xs text-muted-foreground`, wrap);
- footer: satu aksi utama `size="sm"` + "⋯" (44 px di coarse).

Tombol bertumpuk penuh lebar dilarang. Sketsa ASCII ditambahkan di §5.2b. PLAN-04 baris 629 dan PLAN-05 baris 678
disesuaikan.

### C10 — Gelombang 1 ±70 file di jalur kritis · MAJOR

**Verdict: TERIMA**

Bukti: hitungan ulang dari tabel §7 lama memberi ±71 file produksi + 7 test, cocok dengan hitungan kritikus.

Perubahan: perkiraan menjadi ±70 file / ±2.500 baris (sesudah C11/C13/C20 menyusutkan sebagian). Pekerjaan dipecah
menjadi worker dengan file terpisah:

| Worker              | Gelombang    | File                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wkr-shell-core-01` | W1           | `src/shared/{log.time,format.id}.ts`★, `src/web/shared/{poller★,use-poller★,use-api-query,use-log-follow★,format,chunk.error★,api.client,api.action}.ts`, `components/{status.vocab★,status.tone,log.buffer★,now.store★}.ts`, **semua** i18n shell (`id.status★`, `id.shell`, `id.common`, `id.ts`, termasuk copy key log & confirm), test unit |
| `wkr-shell-ui-01`   | W1 (paralel) | `components/*.tsx` kecuali log (page-header, query-view★, error-state, empty-state, data-table, use-page-param★, search-field★, stat-tile, section, status-badge, status-icon★, relative-time, copy-button, confirm-action★, action-bar★), `components/ui/*`, `styles.css`, `shared/query.state.tsx`, `shared/confirm.dialog.tsx` (rename)      |
| `wkr-shell-log-01`  | W1 (paralel) | `components/{log-viewer,log-lines}.tsx`★                                                                                                                                                                                                                                                                                                        |
| `wkr-shell-nav-02`  | W2           | `layout/*`, `session/*`, `pages/{route-error,not-found,public-not-found★}.page.tsx`, `router.tsx`, `app.routes.tsx`★ + 4 file route domain★, hapus `panel.layout`/`dev.layout`, `index.html`, `scripts/build.ts`, satu baris di landing/login, `docs/content-guide.md`                                                                          |

Ketiga worker W1 hanya berbagi tipe yang sudah tertulis di PLAN. Typecheck gabungan dijalankan orkestrator di akhir W1.
Halaman domain (W3) mulai setelah core + ui masuk. LogViewer hanya memblokir halaman log, dan nav tidak memblokir migrasi
isi halaman. Integrasi menaruh nav di W2, dan itu sudah sesuai.

### C11 — Splitting per area berlebihan · OVER

**Verdict: TERIMA SEBAGIAN**

Diterima: cukup tiga chunk, yaitu entry (router, `SessionGate`, landing), `login` (lazy, membawa better-auth), dan
`app` (lazy `AppLayout` + semua halaman diimpor statis). `shell.chunk.ts`, `panel.pages.ts`, dan `dev.pages.ts`
dihapus. Ambang pemecahan ulang: `app` > 250 KB gzip.

Diubah dari usulan: file `app.routes.tsx` yang "dimiliki bergantian per gelombang" tetap menjadi file bersama yang
bentrok di W3, karena PLAN-02/03/05 berjalan paralel. Sebagai gantinya `app.routes.tsx` (beku, milik shell) hanya
menyusun array yang diekspor file route milik domain: `panel/panel.routes.tsx` (02), `site/site.routes.tsx` (03),
`backup/backup.routes.tsx` (04), `dev/dev.routes.tsx` (05). Semuanya masuk satu chunk `app` (import statis). Dengan
begitu rute baru adalah edit di file domain sendiri.

### C12 — Formatter ke `src/shared` belum dijawab · MINOR

**Verdict: TERIMA**

Perubahan: `src/shared/format.id.ts` (`formatBytes`, `formatDuration`, `formatNumber`, `formatPercent`,
`formatMegabytes`, `formatTemperature`) dibuat di W1 core. `src/web/shared/format.ts` me-re-export modul itu dan
menambah `formatRelative`/`formatClock`/`formatDateTime`/`formatLoad*`. `formatRelative` tetap di web karena memakai
i18n shell. Test format dipindah sesuai lokasinya (X24).

### C13 — Parser TAI64N/ISO tidak dibutuhkan · OVER

**Verdict: TERIMA SEBAGIAN**

Diterima: hanya `svlogd -tt`. Bukti dari kritikus: kelima `log/run` di POCO memakai `svlogd -tt`. TAI64N dan ISO masuk
daftar YAGNI, dan test disusutkan.

Lokasi tetap `src/shared/log.time.ts` (shell core), bukan `log.parse.ts` milik PLAN-02, mengikuti X9. Alasannya, fungsi
murni ini dipakai oleh dua PLAN (02 layanan/aplikasi, 03 app-log job), dan PLAN-02 `log.parse.ts` hanya berisi redaksi +
baca cursor yang memanggil `splitLogTimestamp`. Jadi tetap satu parser.

### C14 — `StaleNotice` live region dengan waktu berubah · MINOR

**Verdict: TERIMA**

Perubahan: `role="status"` hanya membungkus teks statis "Tidak bisa memperbarui data.", yang diumumkan sekali saat
muncul. "Data terakhir diperbarui {rel}" dan tombol ditaruh di luar region. `id.shell.stale` dipecah menjadi
`staleTitle` + `staleSince(rel)`.

### C15 — Semantik slot "Lainnya"; sheet macet di halaman yang sama · MINOR

**Verdict: TERIMA**

Perubahan: "Lainnya" adalah `<button aria-haspopup="dialog" aria-expanded>`, aktif secara visual + `sr-only` "(halaman
saat ini ada di menu ini)", tanpa `aria-current`. Sheet ditutup oleh efek pathname **dan** satu `onClick` terdelegasi
di `<nav>` sheet (`e.target.closest("a")`).

### C16 — Jebakan implementasi ConfirmAction · MINOR

**Verdict: TERIMA**

Bukti: `src/web/shared/confirm.dialog.tsx:44-46` memakai `AlertDialogAction`, yang menutup dialog saat diklik.

Perubahan:

- Tombol konfirmasi adalah `Button` biasa di dalam `AlertDialogFooter`, bukan `AlertDialogAction`. Penutupan dikontrol
  `open` internal.
- Signature menjadi `onConfirm: (typed?: string) => Promise<unknown>`. Nilai `typed` yang di-trim diteruskan untuk
  `?confirm=` (PLAN-03 D22) dan `ControlBody.confirm` (PLAN-02).
- Komponen lama diganti nama `LegacyConfirmAction` di W1 ui. `shared/confirm.dialog.tsx` milik ui-01 dan pemakai lama
  diperbarui oleh worker yang sama, satu baris import per file, di W1 sebelum halaman berpindah.

### C17 — Restart panel: dialog terkunci · MINOR

**Verdict: TERIMA**

Perubahan: `onConfirm` resolve begitu 202 diterima, dialog tertutup, lalu `restart.overlay.tsx` milik PLAN-02 mengambil
alih (X18). F3-7 diperbarui.

### C18 — `@custom-variant coarse` mengulang bawaan · OVER

**Verdict: TERIMA**

Bukti: `node_modules/tailwindcss/dist/lib.js` memuat `"pointer-coarse"` (diperiksa di sesi ini, tailwindcss 4.3.5).

Perubahan: semua `coarse:` diganti `pointer-coarse:`, dan baris `@custom-variant` dihapus dari rencana.

### C19 — Copy PLAN-02 masih memakai hitungan detik · MINOR

**Verdict: TERIMA**

Perubahan: masuk §3.15. PLAN-02 §5.1 dan PLAN-05 F2 memakai "Diperbarui baru saja" / "dicek baru saja" untuk < 60 dtk
(X19).

### C20 — Fitur LogViewer yang bisa ditunda · OVER

**Verdict: TERIMA**

Perubahan:

- Pemisah tanggal, `lineCut` 4.000 karakter, dan Dialog layar penuh ditunda ke P2. Copy key-nya dihapus.
- Aturan performa ditambahkan: `LogLines` = `memo` per baris dengan key `seq`, dan filter memakai `useDeferredValue`.
- Komponen menjadi dua file (`log-viewer.tsx`, `log-lines.tsx`).
- Jam tetap di kolom kiri (`formatClock`). Tanggal lengkap ada di Salin/Unduh (`logToText`).

### C21 — Kriteria ukuran bundle manual · MINOR

**Verdict: TERIMA SEBAGIAN**

Diterima: skrip yang bisa diulang, `scripts/bundle-report.ts` (yang sudah diacu PLAN-05 baris 794), dijalankan lewat
`bun run bundle:check`. Skrip ini menjalankan `Bun.build({ entrypoints: ["src/web/index.html"], splitting: true,
minify: true, outdir: <tmp> })`, lalu `Bun.gzipSync` per output. Gagal bila entry > 150 KB gz, chunk `app` awal > 200 KB
gz, atau entry memuat penanda string dari `src/web/panel`/`dev`/`site`. Bisa dipakai di CI (`ci.yml`, `wkr-dist-01`).

Tidak dijadikan `bun test`: build penuh dengan plugin tailwind memperlambat `bun test` lokal untuk semua orang. Kritikus
sudah menyebut opsi skrip sebagai fallback.

### C22 — Waktu absolut hanya di `title` · MINOR

**Verdict: TERIMA**

Perubahan: `RelativeTime` memakai `aria-label` absolut ("26 Nov 2026, 21.54"). Prop `absolute` menampilkan teks
absolut, dipakai di detail dan riwayat perubahan (aturan §5.6).

### C23 — Tabel §3.12 bertentangan dengan PLAN-04 K16 / PLAN-05 K16 · MINOR

**Verdict: TERIMA**

Perubahan: §3.12 hanya menyatakan kebutuhan klien, yaitu HTML tidak basi (`no-cache`) dan chunk error yang terdeteksi.
Status 404/`noindex` untuk path tak dikenal (PLAN-05 F11) dan path internal bundle (PLAN-04 K16) diacu, tidak didefinisikan
ulang.

### C24 — Judul top bar tertinggal satu frame · MINOR

**Verdict: TERIMA SEBAGIAN**

Diterima: judul **statis** diambil dari `handle: { title }` lewat `useMatches()`, yang sinkron dan bawaan React Router.

Diubah: judul dinamis didaftarkan `PageHeader` dengan `useLayoutEffect`, yang tetap memberi satu render dengan judul
statis/fallback sebelum override, tetapi sebelum paint. Karena semua route di file route domain memakai `handle.title`,
fallback `documentTitleFor` dihapus. Ini menambah satu field pada file route milik domain, dan dicatat di template §5.6.

### C25 — Alasan menunda badge nav tidak berlaku · MINOR

**Verdict: TERIMA**

Perubahan: `NavItem.badge?: ReactNode` ditambahkan sekarang (satu prop, nol logika, dirender sebagai titik/angka di
sidebar, bottom bar, dan sheet, dengan `aria-label` dari pemanggil). Datanya disuplai lewat `NavBadgeProvider` sederhana
(`layout/nav.badges.tsx`, context `Record<path, ReactNode>`) yang diisi PLAN-02 dari `GET /api/panel/status` di W3. Shell
tidak mem-poll apa pun. Alasan penundaan lama dihapus.

---

## Ringkasan usulan kontrak untuk arbitrase koordinator

1. **Status (C1)**: tabel kanonik milik shell (W1, beku); mapping per domain di `*.status-key.ts` milik PLAN pemilik
   union. Kunci baru: `interrupted`, `auth_required`, `unstable`, `tunnel_down`, `key_mismatch`. `rolled_back` =
   "Dikembalikan" + help. Tone danger (C1) atau warning (X8) menunggu Q4.
2. **Kepemilikan (C2)**: matriks di atas. Intinya `log.types.ts` + `roles.ts` → `wkr-contracts-00`; `id.ts` → shell
   core W1 lalu beku sampai W4; router/session/404 → shell nav W2; rute baru → file route domain.
3. **Header cache (C3)**: `wkr-http-01` di `spa.serve.ts`. P0 hanya HTML `no-cache`; `immutable`/404 chunk = P2 via
   Cache Rule Cloudflare.
4. **Nama props (C4)**: tabel §3.15 PLAN-01 berlaku harfiah untuk spec worker halaman (X20).
5. **Polling (C5)**: `usePoller` satu-satunya primitif; `useApiQuery` + `useLogFollow` (shell) di atasnya; endpoint
   follow = `?after=` → `LogChunk`.
