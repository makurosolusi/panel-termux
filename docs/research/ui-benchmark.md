# Benchmark UI/UX — patokan redesign Panel Termux

> Riset 2026-11-26 (wkr-research-01). Sumber: halaman publik, docs publik, dan galeri screenshot resmi.
> Tidak login di mana pun. Tailwind Plus (application shells) ternyata **di balik login**, jadi tidak dipakai.
> Screenshot referensi ada di `docs/research/img/` (hak cipta milik masing-masing produk, hanya untuk referensi internal).

Konteks pembaca: pengguna = indie dev Indonesia, sering buka panel dari HP, server = HP Android itu sendiri.
Semua rekomendasi bisa dikerjakan dengan stack yang sudah ada (React 19, shadcn/radix, Tailwind 4, lucide,
sonner). Tidak ada library baru yang direkomendasikan.

Prioritas: **P1** = kerjakan di redesign pertama, **P2** = setelah P1 stabil, **P3** = bagus kalau sempat.

---

## 0. Ringkasan temuan lintas produk

1. **Status selalu nomor satu.** Coolify menaruh pill status (`● Running`, `● Exited`, `● Restarting`) di tiap baris
   tabel _dan_ di header halaman detail, di samping breadcrumb. Uptime Kuma menaruh "Up" besar plus 30 bar heartbeat.
2. **Header detail = breadcrumb + status + 1 tombol aksi utama (split button).** Coolify: `Tim / Proyek / env / Resource`
   - `● Running ▾` + tombol ungu `Deploy | ▾` atau `Restart | ▾`. Aksi lain masuk dropdown tombol itu.
3. **Navigasi sekunder detail dikelompokkan berdasarkan niat**, bukan tab datar: Coolify memakai grup
   _Settings / Observe & troubleshoot / Deploy / Automation / Operations_, plus kolom "Filter settings".
4. **Deploy = tabel riwayat di atas, log di bawah.** Coolify: Status · Source · Commit · Started ("21 seconds ago") ·
   Duration ("00m 07s") · Server. Toolbar log: follow, scroll-ke-bawah, debug toggle, fullscreen, copy, download,
   pill `● Finished`, dan "Find in logs".
5. **Rollback selalu dari daftar deploy, dengan konfirmasi yang menjelaskan apa yang ikut/tidak ikut kembali.**
   Render menampilkan tabel "yang dikembalikan vs tetap" (env vars ikut, disk tidak); Vercel menampilkan dialog
   "deploy saat ini → target" lalu **mematikan auto-deploy** setelah rollback. Render juga melakukan hal yang sama.
6. **Rahasia = write-only.** Vercel kini membagi env var jadi _Config_ (bisa dibaca ulang) vs _Secret_ (tidak bisa
   dibaca setelah disimpan; untuk ganti, isi nilai baru). Coolify menampilkan password sebagai `••••••••` + ikon mata.
7. **Log viewer modern = rentang waktu + live tail + filter level + klik-untuk-filter.** Render: default "Last hour",
   opsi "Live tail", ikon level disembunyikan untuk info, jam lokal, hover untuk timestamp penuh (lokal/UTC/Unix),
   klik nama instance untuk jadi filter. Vercel: 4xx = amber "Warning", 5xx = merah "Error".
8. **Audit log punya kolom baku**: event type, timestamp, project/resource, actor (user / staff / _system_), event data
   (Railway). Vercel: ekspor CSV per rentang waktu.
9. **Peran sederhana menang untuk tim kecil.** Dokploy: Owner (1, tak bisa dipindah) / Admin / Member + centang izin
   granular. Portainer punya 8 peran dan "Effective access viewer" — terlalu berat untuk kita.
10. **Aksi destruktif kelas berat = ketik nama untuk konfirmasi** (Vercel "type the project name to confirm" untuk
    Pause/Delete Project; section Pause diletakkan tepat di atas Delete).
11. **KPI card di mobile shadcn dashboard-01 menumpuk 1 kolom** → 4 kartu menghabiskan satu layar penuh HP tanpa info
    lain. Ini contoh yang _harus dihindari_ untuk Ringkasan kita (lihat `img/shadcn-dashboard-mobile.png`).
12. **Landing dev-tool open-source**: hero 1 kalimat + subjudul "alternatif X", 2 CTA, **perintah install dengan tombol
    copy** (Dokploy, Coolify, CapRover), lalu screenshot produk asli, "how it works", fitur, FAQ/footer. Social proof
    mereka = angka (stars, instance) dan sponsor — kita belum punya, lihat §10.

---

## 1. App shell & navigasi

**Pola yang dipakai produk lain**

- Coolify: sidebar kiri berlabel grup kecil abu-abu — _Workspace_ (Dashboard, Projects, Analytics, Terminal),
  _Infrastructure_ (Servers, Sources, …, S3 Storage), _Manage_ (Team, Notifications, Keys & Tokens, Settings);
  "Admin" terpisah di bawah; user menu + tombol collapse di paling bawah. Search `Ctrl+K` di atas. Di halaman resource
  sidebar utama menciut jadi rail ikon dan kolom kedua berisi navigasi resource.
- shadcn blocks: `sidebar-07` (collapse ke ikon), `sidebar-01` (grup per section), dashboard-01 (tombol "Quick Create"
  di atas, Settings/Help/Search di bawah, avatar + email di footer sidebar, `SidebarTrigger` di header).
- Linear: sidebar sangat padat (item ±28px, ikon 16px, label 13px), grup "Workspace ▾" bisa dilipat.
- Railway/Vercel: team/project switcher di kiri atas, breadcrumb sebagai switcher (chevron ↕ tiap segmen di Coolify).

**Rekomendasi untuk Panel Termux**

- P1 — Kelompokkan nav: **Server** (Ringkasan), **Aplikasi** (Situs, Aplikasi pm2, Layanan), **Jaringan & Data**
  (Domain, Database, Backup), lalu di bawah terpisah **Admin** (hanya untuk role admin) dan menu user (Profil, tema,
  keluar). Label grup `text-xs text-muted-foreground uppercase tracking-wide` gaya Coolify.
- P1 — Badge masalah di item nav: titik merah/angka kecil di "Layanan" bila ada service down, di "Backup" bila run
  terakhir gagal. Murah dan langsung problem-first.
- P1 — Mobile: pertahankan `mobile.bar.tsx` sebagai **bottom bar 4–5 tujuan** (Ringkasan, Situs, Layanan, Log/Aplikasi,
  "Lainnya" → sheet berisi sisanya). Target sentuh ≥ 44px, hormati `env(safe-area-inset-bottom)`.
- P2 — Breadcrumb di header detail yang segmennya bisa dipakai pindah ke situs lain (dropdown), gaya Coolify.
- P2 — Command palette `Ctrl+K` (radix Dialog + filter sederhana atas daftar nav + daftar situs). Tanpa library cmdk.

**Hindari**

- Tab bar atas + sidebar sekaligus di mobile (dua level nav di layar 390px).
- Hamburger sebagai satu-satunya nav di mobile untuk halaman yang dibuka tiap hari.
- Ikon tanpa label di bottom bar.

---

## 2. Ringkasan (overview server)

**Pola yang dipakai produk lain**

- Uptime Kuma: per monitor = pill persentase berwarna + strip 10–30 bar heartbeat (hijau/merah/abu) → status historis
  terbaca tanpa grafik. Detail: "Up" besar, "Check every 60 seconds", baris metrik (Response, Avg 24h, Uptime 24h/30d,
  Cert Exp.) lalu grafik.
- shadcn dashboard-01: 4 KPI card (label kecil, angka besar `$1,250.00`, badge tren `↗ +12.5%`, kalimat penjelas
  "Trending up this month"), lalu chart area dengan toggle rentang (3 bulan/30/7 hari), lalu tabel.
- Dokploy (fitur): monitoring CPU/memori/disk/network real-time + notifikasi saat lewat ambang.
- Railway: kartu service di canvas menampilkan nama, domain, "Deployed just now", "Online".

**Rekomendasi untuk Panel Termux**

- P1 — **Problem-first strip di paling atas**: bila ada masalah (service down, pm2 errored, domain unhealthy, backup
  gagal, baterai < 20% & tidak dicas, suhu tinggi, disk > 90%), tampilkan daftar `Alert` ringkas dengan tautan
  langsung ke resource ("api-toko — pm2 errored 3× · Lihat log"). Bila tidak ada: satu baris hijau "Semua sehat ·
  dicek 12 dtk lalu". Ini yang paling penting di HP.
- P1 — **Device vitals dalam grid 2×2 kompak** di mobile (Baterai, Suhu, Memori, Disk) — angka + bar tipis/`Progress`,
  bukan 4 kartu tinggi yang ditumpuk. Load average jadi baris kecil di bawahnya. Tinggi total ≤ ~200px di 390px.
- P1 — Ringkasan resource sebagai **hitungan dengan status**: "Layanan 7 · 1 mati", "Aplikasi 4 · semua jalan",
  "Domain 5 · 1 tidak sehat" — tiap kartu tautan ke halaman listnya (sudah ada `stat.card.tsx`, perluas).
- P2 — Strip heartbeat ala Uptime Kuma untuk domain (12 cek terakhir) bila backend menyimpan histori cek; kalau tidak
  ada histori, jangan dipalsukan.
- P2 — Aktivitas terbaru = 5 entri audit terakhir dengan waktu relatif, tautan "Lihat semua".
- P2 — Backup: satu baris "Backup terakhir: sukses · 6 jam lalu · 42 MB" atau merah bila gagal/terlambat.

**Hindari**

- Grafik besar di atas lipatan yang tidak menjawab "ada yang rusak?".
- Badge tren (+12.5%) untuk metrik yang tidak punya baseline bermakna.
- Polling agresif yang menghabiskan baterai HP-server — beri jeda (mis. 10–15 dtk) dan pause saat tab tersembunyi
  (`document.visibilityState`).

---

## 3. Halaman daftar resource (Situs, Layanan, Aplikasi, Domain, Database, Backup)

**Pola yang dipakai produk lain**

- Coolify (environment view): **satu tabel** Resource (ikon + nama + deskripsi kecil) · Type · Status (pill dengan titik)
  · Domain · Server · Tags; paginasi "1-9 of 9" + page size; search dan filter di atas.
- Coolify deploy history: search + tombol Filter + Sort.
- Portainer containers: kolom indikator "image up to date" (centang hijau / silang oranye / strip abu = tidak diketahui)
  — tiga keadaan, termasuk "tidak tahu", eksplisit.
- Uptime Kuma: list kiri + detail kanan (master–detail) dengan search di atas list.

**Rekomendasi untuk Panel Termux**

- P1 — Desktop (`md:` ke atas): `Table` dengan kolom tetap: **Nama** (+ subjudul muted: port/command/path), **Status**
  (`StatusBadge`), 1–2 kolom kunci (Domain/Port/Uptime/Memori), **waktu relatif** ("diubah 3 jam lalu"), dan kolom aksi
  kanan: tombol ikon untuk aksi paling sering (Restart) + `DropdownMenu` "⋯" untuk sisanya.
- P1 — Mobile: render baris yang sama sebagai **list card padat** (nama + badge di baris 1, meta muted di baris 2,
  "⋯" di kanan). Satu komponen, dua layout via Tailwind, bukan dua sumber data.
- P1 — Search lokal di atas list (filter client-side cukup untuk puluhan item) + filter chip status
  ("Semua · Jalan · Mati").
- P1 — Urutan default: yang bermasalah dulu, lalu alfabet.
- P2 — Paginasi hanya bila backend mengembalikan > 50 item (audit log, riwayat deploy, run backup) — format
  "1–20 dari 134".

**Hindari**

- Grid kartu besar bergambar untuk resource operasional (cocok untuk katalog "pilih jenis", bukan untuk daftar).
- Warna status saja tanpa teks (buta warna + layar HP di bawah matahari).
- Tombol Stop/Delete langsung terlihat di setiap baris tanpa konfirmasi.

---

## 4. Halaman detail resource (Situs)

**Pola yang dipakai produk lain**

- Coolify: header = breadcrumb · pill status dengan dropdown · tautan "Links ▾" (buka domain) · split button aksi utama.
  Navigasi kiri bergrup; konten = kartu-kartu section dengan judul ("Database details", "Credentials",
  "Initialization"), field 2 kolom di desktop.
- Railway: per service — Deployments, Variables, Metrics, Settings; logs per deployment saat deployment diklik.
- Vercel: "Production Deployment tile" di overview proyek berisi deploy aktif + tombol Instant Rollback.

**Rekomendasi untuk Panel Termux**

- P1 — Header sticky: nama situs + `StatusBadge` + domain utama (tautan eksternal) + **satu tombol utama "Deploy"**
  dan `DropdownMenu` untuk Restart/Stop/Hapus. Di mobile tombol utama tetap terlihat (ikon + label pendek).
- P1 — Tab (radix Tabs atau sub-route) dengan urutan: **Ringkasan · Deploy · Log · Domain · Env · Pengaturan**.
  Di mobile tab bisa di-scroll horizontal; jangan lebih dari 6.
- P1 — Tab Ringkasan = "kartu deploy aktif" ala Vercel: versi/berkas, kapan, oleh siapa, durasi, tombol "Rollback ke
  sebelumnya" + 3 deploy terakhir + domain dengan status health.
- P2 — Section bergaya Coolify (kartu berjudul) di Pengaturan, dengan zona bahaya terpisah di bawah (§7).

**Hindari**

- Aksi utama tersembunyi di dalam menu "⋯".
- Halaman detail yang membuka dengan form edit (mode edit harus disengaja).

---

## 5. Deploy UX (upload binary, progres, riwayat, rollback)

**Pola yang dipakai produk lain**

- Coolify: tabel riwayat (Status pill · Source "Manual" · Commit · Started relatif · Duration `00m 07s` · Server), log
  tepat di bawah dengan pill `● Finished`, tiap baris log diberi timestamp, penanda tahap ("Building docker image
  started." … "Rolling update completed.").
- Railway: status deploy (Building… → Deployed just now / Online), pre-deploy command, healthcheck sebelum dianggap
  sukses; "Staged changes" untuk ditinjau sebelum deploy.
- Render: dropdown "Manual Deploy" (deploy commit terbaru, commit tertentu, clear cache & deploy, restart); rollback
  memakai artefak build lama sehingga cepat; rollback **mematikan auto-deploy** dan halaman Settings menjelaskan cara
  menyalakan lagi. Tabel jelas apa yang ikut rollback (env vars ✓, disk ✗, custom domain ✗).
- Vercel: dialog rollback menampilkan deploy sekarang vs target, daftar domain yang terdampak, pengingat bahwa
  database/API eksternal tidak ikut kembali; hanya satu rollback berjalan sekaligus.
- CapRover: "Roll back an image … App settings and persistent data stay at their current versions."

**Rekomendasi untuk Panel Termux**

- P1 — Progres deploy sebagai **stepper vertikal** dengan tahap nyata dari backend: Unggah → Verifikasi → Pasang →
  Restart → Health check. Tiap tahap: ikon (menunggu/berjalan/sukses/gagal), durasi, dan baris log tahap itu yang bisa
  dibuka. Bar `Progress` hanya untuk tahap unggah (persen byte).
- P1 — Saat gagal: tahap yang gagal terbuka otomatis, pesan error di atas log, tombol "Coba lagi" dan
  "Rollback ke deploy sebelumnya".
- P1 — Tabel riwayat: Status · Versi/berkas (nama + ukuran) · Oleh (user) · Mulai (relatif, hover = absolut) · Durasi
  (`1m 07d` atau `00:07`) · aksi "⋯" (Lihat log, Rollback ke sini). Deploy aktif diberi badge "Aktif".
- P1 — Dialog rollback berisi: dari versi X → ke versi Y, apa yang ikut kembali (binary) dan yang **tidak** (env var,
  database, file data) — pelajaran Render/Vercel.
- P2 — Upload: drop zone + `<input type="file">` native; tampilkan nama, ukuran, dan validasi sebelum mulai.

**Hindari**

- Spinner tunggal "Deploying…" tanpa tahap selama puluhan detik (di HP, koneksi bisa putus dan user tidak tahu
  apakah harus menunggu).
- Rollback tanpa menjelaskan bahwa data/env tidak ikut kembali.

---

## 6. Log viewer (Layanan, Aplikasi, deploy, admin app logs)

**Pola yang dipakai produk lain**

- Coolify: toolbar ikon — follow/live (aktif = ungu), lompat ke bawah, toggle debug, fullscreen, copy, download;
  pill status; "Find in logs". Monospace, timestamp kolom kiri abu, pesan putih.
- Render: rentang waktu default "Last hour", "Live tail"; ikon level (info disembunyikan sampai hover); jam lokal,
  hover menampilkan lokal/UTC/Unix; klik instance → jadi filter; search mendukung wildcard/regex.
- Vercel: Live mode; filter level Warning/Error/Fatal; 4xx = amber, 5xx = merah; search utama, hasil terbaru dulu.
- Railway: sintaks filter `@level:error AND "failed to send"`; negasi `-`.

**Rekomendasi untuk Panel Termux**

- P1 — Satu komponen `LogViewer` dipakai di semua tempat: area `font-mono text-xs leading-5`, background sedikit
  berbeda dari card, timestamp kolom muted, baris stderr/error berlatar `danger-subtle`.
- P1 — Toolbar: **Ikuti (follow)** toggle — otomatis mati bila user scroll ke atas dan muncul tombol "↓ Baris baru (12)";
  **Cari** (highlight + filter baris yang cocok); **Bungkus baris** toggle (default _on_ di mobile, _off_ di desktop);
  **Salin** (semua/yang terfilter); **Unduh .log**.
- P1 — Pilihan stdout/stderr/semua sebagai segmented control kecil.
- P2 — Batasi buffer di DOM (mis. 2.000 baris terakhir) dengan teks "Menampilkan 2.000 baris terakhir" — HP lemah.
- P2 — Fullscreen di mobile (sheet layar penuh) karena log sempit di layar 390px.

**Hindari**

- Font proporsional untuk log; pewarnaan ANSI acak yang mengurangi kontras.
- Auto-scroll yang merebut posisi saat user sedang membaca ke atas.

---

## 7. Pengaturan, rahasia, dan zona bahaya (Env Situs, Admin Settings, Backup S3/R2)

**Pola yang dipakai produk lain**

- Coolify: settings dibagi section kartu berjudul + nav kiri dengan sub-item + "Filter settings"; password `••••••••`
  - ikon mata; label wajib bertanda `*`, ikon ⓘ untuk penjelasan; placeholder "Leave empty to use the image default."
- Vercel env vars: Config (terbaca ulang) vs Secret (write-only; "provide a new value to rotate"); kunci Secret tak bisa
  diubah; nilai Secret ≥ 32 karakter yang muncul di build log diganti `[REDACTED]`.
- Railway: variables dengan raw editor (tempel `.env`), referensi variabel.
- Vercel project settings: section "Pause Project" tepat di atas "Delete Project"; keduanya minta ketik nama proyek.

**Rekomendasi untuk Panel Termux**

- P1 — Env var: tabel Kunci · Nilai (rahasia ditampilkan `••••••` + tombol mata _hanya_ bila backend memang
  mengizinkan baca; bila write-only, tampilkan "Tersimpan · diubah 2 hari lalu" dan tombol "Ganti nilai") · aksi.
  Tombol "Tempel .env" (textarea, parse `KEY=VALUE` di client, pratinjau sebelum simpan).
- P1 — Perubahan env menampilkan banner "Perlu restart/deploy agar berlaku" + tombol aksinya (Railway/Render
  menekankan ini).
- P1 — Halaman pengaturan admin: kartu per kelompok (Umum, Keamanan, Backup/S3, Notifikasi), tombol simpan per kartu
  (bukan satu tombol global di bawah halaman panjang). Kunci S3/R2 = field rahasia write-only.
- P1 — **Zona bahaya** di bawah, kartu border `danger`, tiap aksi punya penjelasan satu kalimat dan tombol
  `variant="destructive"`; hapus situs/database/restore backup = ketik nama untuk konfirmasi.
- P2 — Input filter pengaturan bila section > 6.

**Hindari**

- Menampilkan rahasia penuh di mana pun secara default, atau mencetaknya ke log/toast.
- Autosave diam-diam untuk field kritis (S3 endpoint, password) — butuh simpan eksplisit + toast.

---

## 8. Admin: pengguna & peran, audit log, kesehatan sistem

**Pola yang dipakai produk lain**

- Dokploy: Owner (satu, tidak bisa dipindah) / Admin / Member; Member mendapat centang izin granular (create/delete
  project, akses Docker, API/CLI, SSH keys…), plus akses per proyek.
- Portainer BE: banyak peran (Environment admin, Operator, Helpdesk, Standard, Read-only) + "Effective access viewer".
- Railway audit log: Event type · Timestamp · Project · Environment · Event data · Actor (User / Staff / System).
- Vercel audit log: hanya owner/security; ekspor CSV per rentang (90 hari).

**Rekomendasi untuk Panel Termux**

- P1 — Pengguna: tabel Nama/ID · Peran (badge) · Terakhir aktif (relatif) · Sesi aktif · aksi "⋯" (ubah peran,
  cabut sesi, nonaktifkan). Peran **maks 2–3** (Admin, Operator/Viewer) dengan deskripsi satu baris tiap peran di
  dialog ubah peran. Larang menurunkan admin terakhir (tampilkan alasan, bukan tombol mati tanpa penjelasan).
- P1 — Audit log: tabel Waktu (relatif + absolut di tooltip) · Aktor (user atau "Sistem") · Aksi (kata kerja Indonesia
  konsisten: "memulai ulang layanan") · Target (tautan) · Hasil (sukses/gagal). Filter: aktor, jenis aksi, rentang
  waktu. Paginasi wajib. Baris bisa dibuka untuk melihat detail JSON (dengan nilai rahasia sudah disamarkan).
- P1 — Kesehatan sistem: daftar cek (DB, disk, proses panel, sertifikat, versi) dengan status + "dicek X lalu" +
  tombol "Cek ulang".
- P3 — Ekspor CSV audit log.

**Hindari**

- Matriks izin per-resource ala Portainer — kompleksitas tak sebanding untuk 1–3 pengguna.
- Audit log tanpa aktor "Sistem" (backup terjadwal, restart otomatis jadi tak terjelaskan).

---

## 9. Pola pendukung (empty state, onboarding, konfirmasi, toast, loading)

**Pola yang dipakai produk lain**

- Coolify "Choose a resource": katalog kartu (ikon, judul, sumber, deskripsi 2 baris, tombol "Docs" sekunder +
  "Deploy →" primer), search + filter kategori — berfungsi sebagai empty state sekaligus wizard langkah 1.
- Vercel: dialog destruktif menjelaskan dampak, ketik nama untuk konfirmasi; setelah aksi tampil pesan sukses
  spesifik ("successful rollback").
- Render: setelah rollback, beri tahu efek samping (auto-deploy dimatikan) dan di mana mengembalikannya.

**Rekomendasi untuk Panel Termux**

- P1 — Empty state tiap list: ikon lucide, satu kalimat apa ini, satu CTA primer ("Buat situs pertama"), tautan docs.
  Bukan ilustrasi besar.
- P1 — Onboarding checklist di Ringkasan selama belum lengkap (dismissable): Buat situs → Tambah domain → Atur backup
  S3/R2 → Uji restore. Tiap item centang otomatis dari data nyata.
- P1 — Konfirmasi bertingkat: (a) tanpa konfirmasi: start, lihat, salin; (b) `AlertDialog` biasa: stop, restart,
  cabut sesi; (c) ketik nama: hapus situs/database, restore backup (menimpa data), hapus pengguna. Tombol konfirmasi
  menyebut aksinya ("Hapus situs toko-api"), bukan "OK".
- P1 — Toast (sonner): sukses singkat ("Layanan nginx dimulai ulang"), error dengan penyebab + aksi "Lihat log";
  operasi panjang pakai `toast.promise`/loading toast yang berubah jadi sukses/gagal. Jangan toast untuk hal yang sudah
  terlihat di layar.
- P1 — Loading: `Skeleton` berbentuk sama dengan konten (baris tabel, kartu vitals) — tidak ada spinner full-page
  setelah render pertama; refetch latar belakang tidak mengosongkan data lama (tampilkan indikator kecil "memperbarui").
- P2 — Tombol aksi menampilkan state pending (spinner kecil + disabled) dan optimistik untuk start/stop.

**Hindari**

- Dialog konfirmasi untuk aksi aman (melatih user klik "Ya" tanpa membaca).
- Toast sebagai satu-satunya tempat pesan error penting (hilang dalam 4 detik).

---

## 10. Landing page publik

**Pola yang dipakai produk lain**

- Coolify: "Self-hosting with superpowers." + subjudul "open-source and self-hostable alternative to Vercel, Heroku,
  Netlify and Railway"; CTA "Self-host for free"; angka (21k+ komunitas, "537,403+ self-hosted instances");
  carousel 6 screenshot produk asli dengan caption satu kalimat; "HOW IT WORKS — Push your code. Coolify does the
  rest." dengan diagram `git push → Coolify → server`; sponsor; "Open source and free forever. Read our philosophy".
- Dokploy: badge kecil di atas hero, judul 3 baris, 2 CTA, **kotak perintah install dengan tombol copy**, lalu grid
  fitur ikon+judul+2 kalimat, tab demo per area (Applications, Logs, Monitoring, Backups…), "Stats you didn't ask
  for".
- CapRover: "Deploy apps on your own server." + "Install CapRover" + **Live demo (password ditampilkan)**; contoh
  Dockerfile + `caprover deploy`; bagian "Operate your apps" (rollback, HTTPS otomatis); "Compare CapRover with other
  platforms"; footer Apache 2.0.
- Linear: tipografi hero besar rapat (tracking negatif), subjudul satu kalimat abu, langsung disusul mock UI produk.

**Pengganti social proof yang jujur (kita belum punya pengguna/angka)**

- Screenshot/rekaman **asli** dari HP sungguhan (bukan mockup generik), dengan caption apa yang terlihat.
- Spesifikasi nyata yang bisa diverifikasi: "jalan di HP Android ARM64 dengan Termux, tanpa root", ukuran binary,
  RAM saat idle — angka hasil ukur sendiri.
- "Kode terbuka" + lisensi + tautan repo + changelog terbaru ("rilis 0.2.1, 26 Nov 2026") sebagai bukti proyek hidup.
- Bagian "Batasan jujur" / FAQ: apa yang tidak cocok (trafik besar, HP mati = situs mati, IP rumah) — membangun
  kepercayaan lebih dari testimoni palsu.
- Demo: video pendek/GIF alur deploy, bukan demo publik login (risiko keamanan).

**Rekomendasi untuk Panel Termux** (landing sudah punya hero/why/steps/features/arch/faq/final)

- P1 — Hero: satu kalimat manfaat ("Jadikan HP Android bekas server untuk situs & aplikasimu"), subjudul yang
  menyebut pembanding yang dikenal ("panel ala Coolify, berjalan di Termux"), CTA primer "Pasang sekarang", CTA
  sekunder "Lihat cara kerja"; **blok perintah install + tombol salin** tepat di bawah CTA.
- P1 — Screenshot panel asli (Ringkasan di HP) di samping/bawah hero; `phone.mock.tsx` boleh dipakai bila isinya
  render UI asli.
- P1 — "Cara kerja" 3 langkah dengan perintah nyata; "Batasan" jujur di FAQ.
- P2 — Footer: lisensi, repo, changelog, docs, kontak/komunitas; tanpa tautan mati.

**Hindari**

- Angka/testimoni/logo perusahaan yang dikarang; badge "Trusted by …".
- Hero yang hanya slogan tanpa menjelaskan _apa_ produknya dalam 5 detik.

---

## 11. Lintas halaman (design system ringan)

**Kepadatan**

- Data UI (tabel, list, log) memakai `text-sm` (14px) untuk isi dan `text-xs` (12px) untuk meta — level Coolify/Linear.
  Tinggi baris tabel ±44px desktop, item list mobile ±56–64px (target sentuh). Padding card `p-4` mobile, `p-6` desktop.
- Lebar konten maksimum ±1200px; halaman form/pengaturan ±720px.

**Skala tipografi** (cukup 5 tingkat)

- Judul halaman `text-xl font-semibold` (mobile) / `text-2xl` (desktop), `tracking-tight`.
- Judul section/card `text-base font-semibold`.
- Isi `text-sm`, meta/label `text-xs text-muted-foreground`.
- Angka KPI `text-2xl font-semibold tabular-nums`.
- Mono (`font-mono`) untuk ID, port, path, perintah, hash, log.

**Semantik warna** (token sudah ada di `styles.css`: success/warning/danger/info + `-subtle`)

- Hijau = berjalan/sehat/sukses; kuning/amber = transisi atau perlu perhatian (memulai, restart loop, 4xx, disk 80–90%);
  merah = mati tak disengaja/gagal/5xx/kritis; abu = dihentikan sengaja/tidak diketahui/belum pernah; biru/info =
  sedang diproses (deploy berjalan, backup berjalan). Oranye brand **hanya** untuk aksi utama & fokus, jangan untuk status.

**Kosakata status** (satu kamus, dipakai di semua halaman — taruh di `panel.status.ts` / i18n)

| Keadaan                                                                           | Label                     | Warna                      |
| --------------------------------------------------------------------------------- | ------------------------- | -------------------------- |
| running / online                                                                  | Berjalan                  | success                    |
| stopped (oleh user)                                                               | Dihentikan                | netral                     |
| crashed / errored / exited≠0                                                      | Gagal / Mati              | danger                     |
| starting / restarting                                                             | Memulai… / Memulai ulang… | warning (+titik berdenyut) |
| deploying / backup running                                                        | Diproses…                 | info                       |
| healthy / unhealthy (domain)                                                      | Sehat / Tidak sehat       | success / danger           |
| unknown                                                                           | Tidak diketahui           | netral, ikon `?`           |
| Badge = titik berwarna + teks (gaya Coolify `● Running`), bukan blok warna penuh. |

**Waktu**

- Relatif untuk < 7 hari ("12 dtk lalu", "3 jam lalu", "kemarin"), absolut setelahnya ("12 Nov 2026 14.05").
  Hover/long-press menampilkan absolut lengkap + zona (Render). Pakai `Intl.RelativeTimeFormat('id')` dan
  `Intl.DateTimeFormat('id-ID')` — tanpa library.
- Durasi: `7 dtk`, `1 mnt 07 dtk`, `2 j 15 mnt`.
- Timestamp log: `HH:mm:ss` saja, tanggal hanya saat berganti hari.

**Angka**

- `Intl.NumberFormat('id-ID')` → `1.234`, desimal koma `12,5%`. Byte: biner dengan satuan `MB/GB` satu desimal
  (`1,2 GB`). Persentase disk/memori tanpa desimal kecuali < 10%. `tabular-nums` di semua kolom angka.

**Gerak (motion)**

- Hanya untuk umpan balik: transisi 150–200ms pada hover/expand, titik status berdenyut untuk keadaan transisi,
  skeleton shimmer. Hormati `prefers-reduced-motion` (Tailwind `motion-safe:`). Tidak ada animasi masuk halaman.

**Aksesibilitas & mobile**

- Kontras token sudah AA; jaga ikon-saja punya `aria-label`; fokus ring terlihat; target sentuh ≥ 44px; jangan ada
  scroll horizontal halaman kecuali di dalam tabel/log.

---

## Lampiran — URL yang dilihat

- https://coolify.io (termasuk galeri 6 screenshot: environment, analytics, new-resource, deployment-logs, database)
- https://coolify.io/docs/get-started/introduction · https://coolify.io/docs/knowledge-base/server/introduction
- https://railway.com · https://docs.railway.com/overview/the-basics · https://docs.railway.com/guides/deployments
- https://docs.railway.com/guides/logs · https://docs.railway.com/guides/variables · https://docs.railway.com/guides/healthchecks
- https://docs.railway.com/enterprise/audit-logs
- https://vercel.com/docs/deployments/managing-deployments · https://vercel.com/docs/observability/runtime-logs
- https://vercel.com/docs/instant-rollback · https://vercel.com/docs/environment-variables/sensitive-environment-variables
- https://vercel.com/docs/audit-log · https://vercel.com/docs/projects/managing-projects
- https://render.com/docs/logging · https://render.com/docs/deploys · https://render.com/docs/rollbacks · https://render.com/docs/service-previews
- https://fly.io/docs/monitoring/metrics/
- https://dokploy.com · https://docs.dokploy.com/docs/core · https://docs.dokploy.com/docs/core/permissions
- https://caprover.com
- https://docs.portainer.io/user/docker/containers · https://docs.portainer.io/admin/user/roles
- https://github.com/louislam/uptime-kuma (screenshot dashboard di README) · https://uptime.kuma.pet
- https://linear.app
- https://ui.shadcn.com/blocks · https://ui.shadcn.com/blocks/sidebar · https://ui.shadcn.com/examples/dashboard
- https://ui.shadcn.com/view/new-york-v4/dashboard-01 (desktop + viewport 390px)
- https://tailwindcss.com/plus/ui-blocks/application-ui (… /application-shells/sidebar) — **di balik login, tidak dipakai**

Screenshot tersimpan: `img/coolify-resource-list.png`, `img/coolify-deploy-logs.png`, `img/coolify-settings-secret.png`,
`img/uptime-kuma-monitor.png`, `img/shadcn-dashboard-mobile.png`, `img/dokploy-hero.png`.
