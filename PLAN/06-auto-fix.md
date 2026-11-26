# PLAN 06 — Perbaikan otomatis dari UI

Penulis `wkr-autofix-plan-01`, 2026-11-27, branch `feature/auto-fix`. Dasar: `R&D/07-auto-fix.md` (inventaris 54 item:
18 ya, 22 sebagian, 14 tidak). Lingkup atas arahan pemilik "sisir yang serupa dan perbaiki": **semua item ya dan
sebagian**, dikerjakan bergelombang P0 → P1 → P2. Rencana ini belum diperdebatkan; debat adversarial dijadwalkan
sebelum implementasi.

Rujukan nomor `#n` = baris inventaris R&D/07 §2.

---

## 1. Keputusan baru (usulan untuk `PLAN/DECISIONS.md`)

| #   | Keputusan                                                                                                                                                                                                                                                                                                  | Menggantikan                                       | Alasan                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Panel boleh mengubah `ecosystem.config.js`, hanya di dalam blok bertanda** `// >>> panel-termux:apps v<N>` … `// <<< panel-termux:apps`, ditambahkan di **akhir file**. Teks di luar penanda tidak pernah diubah, kecuali menghapus satu ekspresi lama `...require('./apps.json')`.                       | PLAN/03 D1 ("Panel tidak pernah mengedit")         | Alasan D1 adalah "parser teks JS rapuh". Blok di akhir file tidak butuh parser, dan hasil divalidasi dengan `node` seperti pm2 (probe yang sudah ada) |
| F2  | Setiap perbaikan file: pratinjau → tulis kandidat → validasi → backup bertanggal → `rename` atomik → cek ulang. Validasi gagal = file lama tetap, status "Dikembalikan" (A10).                                                                                                                               | –                                                  | Pola industri (pfSense, cPanel, Ansible `blockinfile`)                                                                                          |
| F3  | **Ubah file ≠ restart.** Perbaikan file tidak pernah me-restart pm2/app. Restart pm2 hanya lewat tombol terpisah dengan konsekuensi (nama app yang terputus).                                                                                                                                              | –                                                  | makuro-solusi tidak boleh terputus tanpa persetujuan                                                                                            |
| F4  | `--no-auto-exit` ditulis ke run script sekarang, **berlaku pada start pm2 berikutnya**. Status check membaca flag pada proses hidup (`/proc/<pid>/cmdline`).                                                                                                                                                 | –                                                  | Lab E4/E10c: flag masih perlu walau ada penjaga                                                                                                 |
| F5  | Perbaikan integrasi berjalan **sinkron** (bukan job situs) di bawah `jobs.exclusive()`: menolak `busy` saat ada job dan menahan job baru selama berjalan. Tercatat di audit, tidak di Riwayat perubahan.                                                                                                     | –                                                  | Operasinya < 20 dtk dan atomik (satu `rename`); tidak ada keadaan setengah jadi yang perlu dipulihkan                                            |
| F6  | Backup perbaikan disimpan di `<dataDir>/fix-backups/<file>/<yyyymmdd-HHMMSS>-<sha8 hasil>.bak` (700/600), 10 terbaru per file. Tidak di `~/sites` atau folder layanan runit.                                                                                                                                | `writeAtomic({backup})` → `<path>.bak` (satu saja) | Tidak mengotori folder pengguna/runit; banyak versi = bisa membatalkan                                                                           |
| F7  | Teks pengguna: kalimat awam dulu, nama file kedua. Instruksi manual selalu ada, dilipat di `<details>` **"Cara manual (untuk pengguna teknis)"**, terbuka otomatis hanya bila panel tidak bisa memperbaiki.                                                                                                | Snippet + `nano` sebagai jalur utama               | Masukan pemilik                                                                                                                                 |
| F8  | Mulai layanan `pm2`/`postgres` dari mana pun pesan "tidak berjalan" muncul: satu komponen tombol, memakai endpoint kontrol layanan yang ada. `start` juga menghapus file `down` layanan itu.                                                                                                              | Teks "Jalankan `sv up pm2` di HP" (8 tempat)       | D30 melarang daemon pm2 di luar runit, bukan `sv up`                                                                                            |
| F9  | Peran: perbaikan integrasi, situs, dan layanan = **admin** (A1). Pemulihan kunci data = **super_admin + sesi segar**.                                                                                                                                                                                        | –                                                  | Setara aksi admin lain                                                                                                                          |

## 2. Prioritas dan lingkup

| P   | Item (R&D/07)                                                                                                                                 | Hasil untuk pengguna                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P0  | #1 blok ecosystem, #2 ganti snippet lama, #3 penjaga, #5 entri tanpa binary, #4 `--no-auto-exit`, bug copy "versi lama" (R&D §1), pola UX generik (§4), onboarding `apps_json` | Kartu Persiapan di POCO selesai dengan 1–2 klik, tanpa Termux                                                       |
| P1  | #6 buat folder situs, #7 bangun ulang `apps.json`, #10/#16/#26 tombol Jalankan pm2/postgres (semua lokasi), #14/#15 Jalankan lagi app yang hilang dari pm2, #13 pulihkan folder situs, #12 DNS tanpa token lewat `cert.pem` + kartu record + tautan token, #37 unggah kunci data | Pesan "jalankan … di HP / lewat ssh" hilang dari alur harian                                                        |
| P2  | #8, #9, #11, #17, #18, #19, #20, #27, #28, #31, #32, #33, #38, #39, #40, #41, #43, #45/#54, #46, #47, #48, #51, #52, #53                        | Sisa jalur teknis jadi tombol/wizard; beberapa butuh keputusan pemilik (§8)                                         |

Item "tidak" (#21–25, #29, #30, #34–36, #42, #44, #49, #50) tetap manual; teksnya ditinjau agar menjelaskan kenapa.

---

## 3. P0 — Patcher `ecosystem.config.js`

### 3.1 Blok bertanda (teks persis, v1)

`<PREFIX>` diisi server saat membuat blok (`termuxPrefix()`, di fake `<home>/usr`), jadi teks blok tetap untuk satu HP.

```js
// >>> panel-termux:apps v1 (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)
// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan
// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar.
{
  const fs = require("fs");
  const path = require("path");
  const cfg = module.exports;
  const list = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.apps) ? cfg.apps : null;
  if (list) {
    let panel = [];
    try {
      const raw = require("./apps.json");
      panel = Array.isArray(raw)
        ? raw.filter((a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")))
        : [];
    } catch (e) {
      console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
    }
    const names = new Set(list.map((a) => a && a.name));
    const handWritten = list.length > 0;
    for (const a of panel) if (!names.has(a.name)) list.push(a);
    if (!handWritten && !names.has("pm2-guard"))
      list.push({ name: "pm2-guard", script: "<PREFIX>/bin/sleep", args: "infinity", interpreter: "none", autorestart: true });
  }
  globalThis.__panelTermuxApps = { v: 1, listed: list !== null };
}
// <<< panel-termux:apps
```

Kenapa bentuk ini:

- **Blok `{ }`** → tidak ada nama baru di scope file (tidak bentrok dengan `panelApps`, `fs`, `path` milik pengguna).
- **Di akhir file, memodifikasi `module.exports`** → tidak perlu mencari `apps: [` atau kurung tutupnya. Satu-satunya
  asumsi: file mengekspor array atau `{ apps: [...] }` lewat `module.exports`; asumsi itu diverifikasi oleh probe
  (`listed`).
- Filter `existsSync` identik dengan snippet B18/D2 (lab E1e/E5).
- Penjaga dinamis menggantikan saran "lihat README" (#3) dan aman di POCO (ada 2 app tangan → tidak ditambahkan).
- `globalThis.__panelTermuxApps` = bukti bagi probe bahwa blok benar-benar dieksekusi.

`ECOSYSTEM_SNIPPET` (`integration.service.ts:15`) diganti `ecosystemBlock(prefix)` dari `ecosystem.patch.ts`; "Cara
manual" menampilkan blok ini dengan instruksi "Tempel di **akhir** file". Template `deploy/pm2/ecosystem.config.js`
dan repo `server-termux` **tidak** diubah sekarang (blok tanpa penanda di sana tetap dikenali sebagai terbaru, §3.3).

### 3.2 `snippetCurrent` baru

```
current(text) = hasMarkers(text, v = BLOCK_VERSION) || legacyCurrent(text)
legacyCurrent(text) = !hasAnyMarker(text) && /panelApps/.test(text) && /existsSync/.test(text)   // template 0.3.0
```

Bug copy R&D §1: `snippet_current` disembunyikan (moot) bila teks **tidak menyebut `apps.json` sama sekali**. Di POCO
kartu menampilkan satu baris akar ("Situs buatan panel belum ikut dijalankan pm2") ditambah warning `pm2_auto_exit`.

### 3.3 Algoritma `planEcosystemFix(text, ctx)` (fungsi murni)

Input: teks file, `probeBefore`, `prefix`. Output: `{ kind: "patch", candidate, changes[] } | { kind: "unchanged" } |
{ kind: "manual", reason }`. Urutan pemeriksaan:

| Langkah | Kondisi                                                                                               | Hasil                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1       | Path bukan `*.config.js`                                                                              | `manual: not_config_js`                                                                  |
| 2       | File tidak ada                                                                                        | `manual: ecosystem_missing` (P2 #8)                                                       |
| 3       | > 256 KiB atau bukan UTF-8 valid                                                                      | `manual: too_large`                                                                       |
| 4       | `probeBefore.ok === false`                                                                            | `manual: ecosystem_unloadable` (P2 #9 menawarkan pulihkan versi terakhir yang berfungsi) |
| 5       | Penanda: jumlah `>>>` ≠ jumlah `<<<`, > 1 pasang, atau urutan terbalik                                 | `manual: markers_broken`                                                                  |
| 6       | Sepasang penanda ada: isi di antaranya == blok terbaru                                                | `unchanged`                                                                               |
| 7       | Sepasang penanda ada, isi berbeda (versi lama / disunting)                                            | `patch`: ganti seluruh region penanda (termasuk baris penanda) dengan blok terbaru        |
| 8       | Tanpa penanda, `legacyCurrent(text)`                                                                  | `unchanged` (check sudah ok; tidak disentuh)                                              |
| 9       | Tanpa penanda, regex `OLD_SPREAD` cocok **tepat satu kali** dan tidak ada sebutan `apps.json` lain     | `patch`: hapus ekspresi itu (baris dihapus bila tinggal spasi/koma) + tambah blok di akhir |
| 10      | Tanpa penanda, teks tidak menyebut `apps.json` dan `probeBefore.loadedAppsJson === false`             | `patch`: tambah blok di akhir (satu baris kosong pemisah; newline akhir dijaga)           |
| 11      | Selain itu (apps.json dimuat dengan cara lain, banyak spread, `require` dinamis)                      | `manual: unknown_apps_json_use`                                                           |

`OLD_SPREAD = /\.\.\.\s*require\(\s*(["'])\.\/apps(?:\.json)?\1\s*\)\s*,?/g`. Komentar yang memuat teks itu ikut
terhitung → ≥ 2 kecocokan → manual (lebih aman daripada menebak).

`changes[]` = daftar hunk yang dibuat patcher sendiri (tanpa library diff): `{ kind: "remove", line, text }` dan
`{ kind: "add", afterLine, lines }`. UI merender ini sebagai diff.

### 3.4 Terapkan (`applyEcosystemFix`)

1. `jobs.exclusive()` (F5) + kunci `integration` (`createActionLocks`).
2. `path = realpath(ecosystem)` (symlink tetap symlink). Baca teks + `sha256` + `stat.mode`.
3. Bila `expect[path]` dari pratinjau ≠ sha sekarang → 409 `changed` ("File berubah sejak pratinjau").
4. `probeBefore = probe(path)`; `plan = planEcosystemFix(...)`. `unchanged` → hasil `unchanged`.
5. Tulis kandidat `<dir>/.ecosystem.panel-candidate.config.js` dengan mode asli (nama harus `*.config.js`, folder sama
   agar `./apps.json` dan `__dirname` sama).
6. `probeAfter = probe(candidate)`; hapus kandidat di `finally`. Valid bila **semua**:
   - `ok`, `loadedAppsJson`, `block = { v: BLOCK_VERSION, listed: true }`;
   - `hand = probeBefore.names − namaApps.json`: setiap nama di `hand` ada di `probeAfter.names` dengan
     `digest` sama (probe mencetak `sha256(JSON.stringify(app, kunci terurut))` per app; nilai `env` tidak pernah
     dicetak);
   - `probeAfter.names − hand` == entri `apps.json` yang binary-nya ada (+ `pm2-guard` hanya bila `hand` kosong dan
     belum ada);
   - tidak ada nama ganda.
   Gagal → 422 `validation_failed` + `detail` (redaksi, 300 karakter); file asli tidak pernah tersentuh.
7. Sha file asli dibaca ulang; berubah → 409 `changed_during_fix` (pemilik sedang menyunting).
8. Backup isi asli → `fix-backups/ecosystem/<ts>-<sha8 kandidat>.bak` (600). Retensi 10.
9. `writeAtomic(path, candidate, { mode: modeAsli })`.
10. Probe file hidup sekali lagi; gagal (tidak terduga) → tulis balik isi asli, hasil `rolled_back` ("Dikembalikan").
11. Buang cache integrasi, hitung ulang, audit `integration.fix` `{ key, file, backupId, shaBefore, shaAfter, outcome }`
    (tanpa isi file).
12. Respons `FixResult` dengan `integration` terbaru.

**Idempoten:** menjalankan ulang setelah sukses = langkah 6 → `unchanged`. **App berjalan:** tidak ada pemanggilan
pm2. File baru dibaca pm2 saat runtime start berikutnya dan saat deploy pertama situs panel (`start --only`).

### 3.5 Batalkan perubahan

`POST /integration/backups/:id/restore`:

1. Backup ada, milik file yang dikenal, dan dibuat panel (folder `fix-backups`).
2. sha8 file sekarang == sha8 di nama backup (belum disunting sejak perbaikan) → lanjut. Berbeda → 409 `changed_since`;
   UI menampilkan konfirmasi kedua ("Tetap kembalikan") dan mengirim `force: true`.
3. Probe isi backup lewat kandidat (seperti §3.4 langkah 5–6, cukup `ok`). Isi saat ini juga di-backup dulu (undo atas
   undo).
4. Tulis atomik, buang cache, audit `integration.restore`.

### 3.6 Run script pm2 (`--no-auto-exit`, #4)

`planRunScriptFix(text)`:

| Kondisi                                                                                           | Hasil                                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| File `$PREFIX/var/service/pm2/run` tidak ada                                                       | `manual: run_script_missing`                                                        |
| Baris non-komentar yang memuat `pm2-runtime` ≠ 1                                                   | `manual: run_script_unknown`                                                        |
| Baris itu sudah memuat `--no-auto-exit`                                                            | `unchanged`                                                                         |
| Selain itu                                                                                         | `patch`: `/(pm2-runtime)(\s)/` → `$1 --no-auto-exit$2` pada baris itu saja          |

Validasi kandidat: `sh -n <kandidat>` (exit 0) + teks hanya berbeda di baris itu. Mode asli (0755) dijaga, backup ke
`fix-backups/pm2-run/`. Tidak ada `sv restart`.

Status check `pm2_auto_exit` (diperluas, `integration.service.ts`):

| File memuat flag | Proses pm2 hidup memuat flag (`runit.cmdline("pm2")`) | state     | params            |
| ---------------- | ------------------------------------------------------ | --------- | ----------------- |
| ya               | ya, atau pm2 tidak berjalan                            | ok        | –                 |
| ya               | tidak                                                  | warning   | `{ pending: 1 }`  |
| tidak            | –                                                      | warning   | –                 |

Baris `pending` menampilkan tombol sekunder **Mulai ulang pm2 sekarang** (endpoint kontrol layanan yang ada, tier
`confirm`, body menyebut semua app pm2 yang berjalan). Tanpa klik, flag aktif saat HP/pm2 dimulai ulang berikutnya.

### 3.7 Probe (`ecosystem.probe.ts`, diperluas)

Baris JSON probe ditambah `block: { v, listed } | null` (dari `globalThis.__panelTermuxApps`) dan
`digests: Record<name, string>`. Tipe `EcosystemProbe` ok += `block`, `digests`. Env tetap minimal (C14).

---

## 4. Pola UX generik (dipakai P0 dan seterusnya)

### 4.1 Komponen

| Komponen                           | File baru                          | Perilaku                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tombol **Perbaiki** per check      | `src/web/site/fix.button.tsx`      | Muncul di baris check yang punya `fix.available`. Satu fix bisa menutup beberapa check; tombol hanya di baris pertama, baris lain diberi label "Ikut diperbaiki"                                                               |
| **Perbaiki semua yang aman (n)**   | (di `site.setup.tsx`)              | Header kartu bila ≥ 1 fix `risk: "safe"` tersedia. Satu dialog berisi ringkasan tiap fix, satu **Terapkan**; dijalankan berurutan, berhenti di kegagalan pertama                                                              |
| Dialog pratinjau                   | `src/web/site/fix.dialog.tsx`      | Judul pertanyaan, 2–4 kalimat awam dari `effects`, `<details>` **Lihat perubahan pada file** berisi diff, tombol **Terapkan** / **Batal**. Konfirmasi tier PLAN/01: fix aman = dialog ini; restart = `confirm`; P2 merusak = `typed` |
| Diff                               | `src/web/site/fix.diff.tsx`        | Render `FixChange[]`: baris `+` hijau, `-` merah, nomor baris, monospace, scroll horizontal. Tanpa library                                                                                                                   |
| Cara manual                        | `src/web/site/setup.manual.tsx`    | `<details>` native "Cara manual (untuk pengguna teknis)": blok + "tempel di akhir file" + perintah `nano` + run script. Terbuka otomatis bila fix `available: false`                                                          |
| Toast hasil                        | sonner yang ada                    | Sukses + aksi **Batalkan** (10 dtk); `rolled_back` = warning (A10); error = pesan kode                                                                                                                                       |
| Baris "Perubahan terakhir"         | (di `site.setup.tsx`)              | "Diperbaiki panel {waktu relatif}. **Batalkan perubahan**" selama backup terbaru masih bisa dibatalkan (`GET /integration/backups`)                                                                                            |

Setelah setiap aksi kartu memakai `integration` dari respons (cek ulang otomatis, tanpa klik **Periksa lagi**).

### 4.2 Copy P0 (`src/web/i18n/id.site.ts`, `setup`)

Mengikuti `docs/content-guide.md` ("kamu", sentence case, nama file dalam kode, tanpa tanda seru).

| Kunci                                     | Teks                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                             | "Sekali saja: panel menghubungkan situs buatannya ke pm2 agar tetap berjalan setelah HP dinyalakan ulang."                                                       |
| `checks.ecosystem_spreads_apps_json.error`| "Situs buatan panel belum ikut dijalankan pm2, jadi tidak berjalan lagi setelah HP dinyalakan ulang."                                                            |
| `checks.snippet_current.error`            | "pm2 memuat situs panel dengan cara lama: bila satu situs rusak, semua aplikasi bisa berhenti."                                                                  |
| `checks.pm2_auto_exit.warning`            | "pm2 bisa berhenti sendiri saat semua aplikasi dihentikan."                                                                                                      |
| `checks.pm2_auto_exit.pending`            | "Pengaman pm2 sudah dipasang. Aktif setelah pm2 dimulai ulang berikutnya, misalnya saat HP dinyalakan ulang."                                                    |
| `checks.pm2_guard.warning`                | "pm2 bisa berhenti sendiri saat situs terakhir dihapus."                                                                                                         |
| `fix`                                     | "Perbaiki"                                                                                                                                                       |
| `fixAll(n)`                               | "Perbaiki semua yang aman (n)"                                                                                                                                   |
| `fixAlso`                                 | "Ikut diperbaiki"                                                                                                                                                |
| `dialog.ecosystem_block.title`            | "Hubungkan situs panel ke pm2?"                                                                                                                                  |
| `dialog.ecosystem_block.body(keep)`       | "Panel menambahkan satu blok di akhir `ecosystem.config.js`. Aplikasi yang sudah ada tetap sama dan tidak dimulai ulang: {makuro-solusi, adminneo}. Situs yang berjalan tidak terganggu." |
| `dialog.ecosystem_block.oldSpread`        | "Baris lama `...require('./apps.json')` diganti, karena bisa menghentikan semua aplikasi bila `apps.json` rusak."                                                 |
| `dialog.ecosystem_block.guard`            | "Karena belum ada aplikasi lain, panel juga menambahkan penjaga kecil (±6 MB) agar pm2 tetap hidup."                                                             |
| `dialog.pm2_auto_exit.title`              | "Pasang pengaman pm2?"                                                                                                                                           |
| `dialog.pm2_auto_exit.body`               | "Panel menambahkan `--no-auto-exit` ke run script layanan pm2. Berlaku saat pm2 dimulai ulang berikutnya; aplikasi tidak terganggu sekarang."                    |
| `dialog.backupNote`                       | "Salinan file lama disimpan, jadi perubahan ini bisa dibatalkan."                                                                                                |
| `dialog.showDiff`                         | "Lihat perubahan pada file"                                                                                                                                      |
| `dialog.apply` / `dialog.cancel`          | "Terapkan" / "Batal"                                                                                                                                             |
| `dialog.applying`                         | "Menerapkan…"                                                                                                                                                    |
| `dialogAll.title(n)`                      | "Perbaiki n hal sekaligus?"                                                                                                                                      |
| `done`                                    | "Diperbaiki. Pemeriksaan sudah diulang."                                                                                                                         |
| `doneAll(n)`                              | "n hal diperbaiki. Pemeriksaan sudah diulang."                                                                                                                   |
| `undo`                                    | "Batalkan"                                                                                                                                                       |
| `rolledBack`                              | "Perubahan dikembalikan: hasil perbaikan tidak bisa dimuat pm2. File lama tetap dipakai."                                                                       |
| `lastFix(ago)`                            | "Diperbaiki panel {ago}."                                                                                                                                        |
| `undoTitle(at)`                           | "Kembalikan file ke versi {at}?"                                                                                                                                 |
| `undoBody.ecosystem`                      | "Situs buatan panel tidak lagi ikut dijalankan pm2 setelah HP dinyalakan ulang."                                                                                 |
| `undoChanged`                             | "File sudah diubah lagi setelah perbaikan. Mengembalikan versi lama membuang perubahan itu."                                                                     |
| `undoForce`                               | "Tetap kembalikan"                                                                                                                                               |
| `undone`                                  | "Perubahan dibatalkan."                                                                                                                                          |
| `restartPm2`                              | "Mulai ulang pm2 sekarang"                                                                                                                                       |
| `restartPm2Body(apps)`                    | "Semua aplikasi berhenti beberapa detik lalu berjalan lagi: {apps}. Pengunjung bisa terputus sebentar."                                                          |
| `manual.title`                            | "Cara manual (untuk pengguna teknis)"                                                                                                                            |
| `manual.step1..4`                         | "Buka file ecosystem di Termux:" · "Tempel blok ini di **akhir** file:" · "Simpan. pm2 tidak perlu dimulai ulang." · "Tekan Periksa lagi."                        |
| `manual.runScript`                        | "Tambahkan `--no-auto-exit` setelah `pm2-runtime` di file ini, lalu mulai ulang layanan pm2 saat aman:"                                                          |
| `errors.changed`                          | "File berubah sejak pratinjau dibuat. Lihat perubahannya lagi."                                                                                                  |
| `errors.changed_during_fix`               | "File sedang diubah di HP. Tutup editornya, lalu coba lagi."                                                                                                     |
| `errors.validation_failed`                | "Perubahan tidak diterapkan karena hasilnya tidak bisa dimuat pm2. File lama tetap dipakai."                                                                     |
| `unfixable.ecosystem_missing`             | "File `ecosystem.config.js` tidak ada, jadi panel tidak tahu cara pm2 di HP ini dijalankan."                                                                     |
| `unfixable.ecosystem_unloadable`          | "File `ecosystem.config.js` sekarang tidak bisa dimuat pm2, jadi panel tidak mengubahnya. Perbaiki dulu kesalahannya (lihat detail), lalu periksa lagi."         |
| `unfixable.not_config_js`                 | "Nama file ecosystem harus berakhiran `.config.js` agar pm2 membacanya sebagai daftar aplikasi."                                                                  |
| `unfixable.too_large`                     | "File ecosystem terlalu besar untuk diubah otomatis."                                                                                                            |
| `unfixable.markers_broken`                | "Penanda blok panel di `ecosystem.config.js` rusak atau dobel, jadi panel tidak mengubahnya."                                                                    |
| `unfixable.unknown_apps_json_use`         | "`ecosystem.config.js` memuat `apps.json` dengan cara yang tidak dikenali panel, jadi panel tidak mengubahnya."                                                   |
| `unfixable.run_script_missing`            | "Run script layanan pm2 tidak ditemukan."                                                                                                                        |
| `unfixable.run_script_unknown`            | "Run script layanan pm2 ditulis dengan cara yang tidak dikenali panel."                                                                                          |
| `unfixableSuffix`                         | "Ikuti Cara manual di bawah."                                                                                                                                    |

Onboarding `id.dev.setup.ts` `apps_json.action`: "Perbaiki di Situs" (tautan `/panel/sites#persiapan`).

---

## 5. Kontrak API dan tipe

### 5.1 `src/shared/fix.types.ts` (baru)

```ts
import type { Integration, IntegrationCheckKey } from "./site.types";

/** Integration fixes the panel can apply itself. */
export type FixKey = "ecosystem_block" | "pm2_auto_exit" | "sites_dir_create" | "apps_json_rebuild";
/** safe = no running process is touched; every FixKey here is safe (restarts are separate service actions). */
export type FixRisk = "safe";
/** Why the panel will not apply a fix (copy: setup.unfixable.*). */
export type FixBlockReason =
  | "not_config_js" | "ecosystem_missing" | "too_large" | "ecosystem_unloadable" | "markers_broken"
  | "unknown_apps_json_use" | "run_script_missing" | "run_script_unknown" | "sites_dir_outside_home";
/** Per fix: which checks it resolves and whether it can run now. */
export type FixAvailability = {
  key: FixKey;
  checks: IntegrationCheckKey[];
  risk: FixRisk;
} & ({ available: true } | { available: false; reason: FixBlockReason });
/** Which file a change or backup belongs to. */
export type FixFile = "ecosystem" | "pm2_run" | "apps_json";
/** One hunk produced by the patcher itself (1-based lines of the current file). */
export type FixChange = { kind: "add"; afterLine: number; lines: string[] } | { kind: "remove"; line: number; text: string };
/** Preview of one file; `sha` goes back in the apply request. */
export type FixFilePreview = { file: FixFile; path: string; sha: string; changes: FixChange[] };
/** What the change means, for the plain-language dialog. */
export type FixEffects = {
  keepApps: string[];      // hand-written apps, unchanged, not restarted
  addApps: string[];       // panel sites pm2 will load (on next start)
  guard: boolean;          // pm2-guard added
  oldSpread: boolean;      // `...require('./apps.json')` removed
  appliesOnRestart: boolean; // pm2_auto_exit
};
export type FixPreview = { key: FixKey; files: FixFilePreview[]; effects: FixEffects };
/** Body of POST /integration/fixes/:key; `expect` = path → sha from the preview. */
export type FixApplyRequest = { expect: Record<string, string> };
export type FixErrorCode = "changed" | "changed_during_fix" | "validation_failed" | "busy" | "not_fixable";
export type FixBackup = { id: string; file: FixFile; at: string; undoable: boolean };
export type FixResult = {
  key: FixKey | "restore";
  outcome: "applied" | "unchanged" | "rolled_back";
  backups: FixBackup[];
  integration: Integration;
};
```

`Integration` (`site.types.ts`) += `fixes: FixAvailability[]`. `IntegrationCheck.params.pending` untuk `pm2_auto_exit`.
`ECOSYSTEM_SNIPPET` di `Integration.snippet` diganti teks blok v1.

### 5.2 Endpoint (`/api/panel`, peran admin, guard Origin + `X-Requested-With`)

| Metode | Path                                       | Hasil                                                                                         | Error                                                                  |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/integration`                             | `Integration` + `fixes`                                                                       | –                                                                      |
| POST   | `/integration/fixes/:key/preview`          | `FixPreview` (tanpa menulis apa pun)                                                          | 422 `not_fixable {reason}`, 404 key                                    |
| POST   | `/integration/fixes/:key`                  | `FixResult` (body `FixApplyRequest`)                                                          | 409 `busy`/`changed`/`changed_during_fix`, 422 `validation_failed`/`not_fixable` |
| POST   | `/integration/fixes`                       | `FixResult[]` (body `{ items: { key, expect }[] }`, berurutan, berhenti di gagal pertama)     | sama                                                                   |
| GET    | `/integration/backups`                     | `FixBackup[]` (terbaru dulu, 10 per file)                                                     | –                                                                      |
| POST   | `/integration/backups/:id/restore`         | `FixResult` (body `{ force?: boolean }`)                                                      | 409 `changed_since`/`busy`, 404                                        |

Audit (`src/shared/audit.types.ts`): `integration.fix`, `integration.restore`; P1 menambah `site.repair`,
`security.data_key_restore`. `audit.describe.ts` (web) menerjemahkan: "{aktor} memperbaiki integrasi pm2 ({file})",
"{aktor} membatalkan perbaikan {file}".

### 5.3 Runner

`job.runner.ts` += `exclusive<T>(fn: () => Promise<T>): Promise<T>`: `assertIdle()`, lalu menandai runner sibuk
sehingga `start()` melempar 409 `busy` sampai `fn` selesai. Dipakai semua fix integrasi.

---

## 6. P1 — desain per item

### 6.1 Tombol **Jalankan pm2 / postgres** (#10, #16, #26; F8)

- Komponen `src/web/shared/service-start.tsx`: `ServiceStartButton({ service })` → `POST /api/panel/services/:name/start`
  (endpoint yang ada; audit, kunci, `noteIntentionalRestart` sudah ditangani `panel.service.ts`). Sukses: toast
  "pm2 berjalan lagi. Ia juga menyala otomatis saat HP dinyalakan ulang." lalu `onStarted()` (reload data).
- Server: aksi `start` pada layanan inti (`pm2`, `postgres`, `cloudflared`) menghapus `$SVDIR/<name>/down` bila ada,
  lalu `sv up` (gotcha POCO: hapus `down` saja tidak menyalakan).
- Dipasang di: baris check `pm2_runtime`, banner blocker detail situs (`pm2_not_running`), toast error dengan kode
  `pm2_not_running`/`pm2_unavailable` (aksi sonner), halaman progres job gagal, kartu masalah Ringkasan
  (`service_down`, `pm2_unavailable`; aksi **Jalankan**), `database_failed`.
- Copy semua lokasi menjadi "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti." + tombol "Jalankan pm2";
  perintah `sv up pm2` pindah ke "Cara manual".

### 6.2 Buat folder situs (#6) — fix `sites_dir_create`

`mkdir -p` mode 700 hanya bila `realpath` induk berada di HOME (`sites_dir_outside_home` bila tidak), lalu
`ensureAppsJson`. Dialog: "Panel membuat folder `~/sites` untuk situs-situsmu." Tanpa backup (tidak ada yang
ditimpa); undo tidak ditawarkan.

### 6.3 Bangun ulang `apps.json` (#7) — fix `apps_json_rebuild`

- Tersedia bila check `apps_json` = `invalid`.
- Isi baru = `panelAppEntry` (`deploy/run.script.ts`) untuk setiap situs `managed` yang `run` dan `app`-nya ada (D5),
  urut nama. File rusak di-backup ke `fix-backups/apps-json/`.
- Validasi: `parseApps(candidate)` lolos. Pratinjau: daftar nama situs + diff. Tidak ada restart; pm2 memuat saat start
  berikutnya. Kode job `apps_json_invalid` ("Perbaiki lewat ssh") diganti "File apps.json rusak. Perbaiki dari kartu
  Persiapan di halaman Situs." + tautan.

### 6.4 Jalankan lagi app yang hilang dari pm2 (#14, #15)

- `restartApp` (`deploy.restart.ts`): situs **adopsi** yang tidak dikenal pm2 → `startFromEcosystem(eco, name)`; `null`
  → `StepError("app_not_in_ecosystem")`. Situs dikelola sudah ditangani (entri dimuat ulang) + `ensureAppsEntry` bila
  entri hilang tetapi binary ada.
- Detail situs "Tidak berjalan di pm2": tombol utama **Jalankan lagi** (job `site.restart` yang ada). Copy:
  - dikelola: "pm2 tidak menjalankan situs ini. Tekan Jalankan lagi; panel memuatnya ulang dari daftar situs panel."
  - adopsi: "pm2 tidak menjalankan aplikasi ini. Tekan Jalankan lagi untuk memuatnya dari `ecosystem.config.js`."
  - `app_not_in_ecosystem`: "Entri aplikasi ini tidak ada lagi di `ecosystem.config.js`, jadi panel tidak bisa
    menjalankannya. Tambahkan lagi lewat Cara manual, atau hapus situs ini dari panel."

### 6.5 Pulihkan folder situs (#13) — job `site.repair`

- `JobKind` += `site.repair`; langkah: `folder` (mkdir 700, undo hapus bila dibuat) → `env_write` (`PORT`; bila
  `site.database`: password baru 24 byte) → `db_password` (`ALTER ROLE <nama> PASSWORD …`, `irreversible`, terakhir).
- Tombol **Pulihkan folder** di banner `no_folder`; konfirmasi `confirm`: "Panel membuat ulang folder dan `.env` situs
  ini. Password database situs diganti dan ditulis ke `.env`. Setelah itu unggah binary-nya lagi." CTA akhir **Unggah
  binary**. Audit `site.repair`.

### 6.6 DNS tanpa token (#12)

- `CloudflaredAdapter.routeDns(tunnel, hostname)` → `cloudflared tunnel route dns <tunnel> <hostname>` (tanpa
  overwrite). Langkah `dns_ensure`: token kosong **dan** `~/.cloudflared/cert.pem` ada → `routeDns`, hasil
  `dns_routed` ("Record DNS dibuat lewat cloudflared."); `site_hostname.dnsSource = "cloudflared"` sehingga hapus domain
  tanpa token = "Record DNS dibiarkan; panel hanya bisa menghapusnya dengan token API." **Verifikasi** perilaku dan flag
  pada cloudflared terpasang sebelum implementasi (Rule 20).
- Tanpa cert dan token: kartu `src/web/site/dns.manual.tsx` berisi record siap salin (Tipe `CNAME`, Nama `<host>`, Isi
  `<tunnelId>.cfargotunnel.com`, Proxy aktif) + **Periksa lagi** (cek DNS wizard yang ada) + tautan **Buat token
  Cloudflare** dengan templat izin `Zone:Read` + `DNS:Edit` (URL templat token Cloudflare, **verifikasi formatnya**).
- Kolom migrasi `site_hostname.dns_source` → file migrasi `drizzle/0009_auto_fix.sql` (`ADD COLUMN … DEFAULT 'api'`,
  idempoten, komentar kenapa; Rule 4).

### 6.7 Unggah kunci data lama (#37)

- `POST /api/dev/security/data-key/restore` (super_admin, sesi segar, multipart ≤ 4 KiB).
- Server: parse kunci → coba dekripsi **setiap** pengaturan rahasia tersimpan dengan kunci itu (`crypto.service.ts`);
  ada yang gagal → 422 `key_wrong` ("File ini bukan kunci data yang dipakai pengaturan rahasia panel."). Cocok →
  salin kunci sekarang ke `data/secret.replaced-<ts>` (600) → `writeAtomic(secret, 600)` → audit
  `security.data_key_restore` → 202 → restart diri yang sudah ada (graceful, runit) → overlay "Panel dimulai ulang…".
- UI kartu Kunci data: tombol utama **Unggah file kunci data lama** (input file native); tiga perintah `sv`/`cp` pindah
  ke "Cara manual". Tanpa runit (`not_supervised`) → tombol disabled dengan alasan.

---

## 7. P2 — desain ringkas (tiap item dimulai setelah keputusan pemilik di §8 bila disebut)

| #       | Desain                                                                                                                                                                                                                     | Tier konfirmasi |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| #8      | Fix `ecosystem_create`: tersedia bila file tidak ada **dan** run script pm2 menunjuk path itu; tulis template `deploy/pm2/ecosystem.config.js` + validasi probe; tanpa restart                                             | dialog          |
| #9      | Pada `ecosystem_unloadable`: tampilkan pesan node (`detail`) dan, bila ada backup panel yang lolos probe, **Pulihkan versi terakhir yang berfungsi ({waktu})** via endpoint restore §3.5 (`force` bila disunting)            | confirm         |
| #11     | Bila `config.yml` tidak ada tetapi tepat satu `~/.cloudflared/<uuid>.json` ada: tulis `config.yml` minimal (`tunnel`, `credentials-file`, `ingress: [{service: http_status:404}]`) + `ingress validate`                      | dialog          |
| #17     | Hasil job `dns_delete_failed`: tombol **Coba hapus lagi** (langkah DNS yang sama, job `hostname.remove` retry)                                                                                                              | –               |
| #18     | `dns_foreign_record`: **Ambil alih record ini** menampilkan nilai lama; ganti via API, catat sebagai milik panel                                                                                                            | typed (domain)  |
| #19     | Rute tulisan tangan: **Hapus rute** memakai `removeIngressRule` + validasi + backup + restart cloudflared; body menyebut domain lain yang ikut terputus                                                                      | typed (domain)  |
| #20     | **Ambil alih ke panel** untuk situs adopsi: entri pindah ke `apps.json` + `run`; entri tangan di ecosystem dinonaktifkan hanya bila berupa satu ekspresi `site('<nama>')` yang dikenali, divalidasi probe. Butuh keputusan | typed           |
| #27     | `host_rebooted`: detail dihitung dari status layanan ("Semua layanan berjalan." atau daftar yang mati + **Jalankan**)                                                                                                        | –               |
| #28     | `system_error`: tampilkan `detail` teknis teredaksi di `<details>` + tautan log layanan; "cek lewat SSH" ke Cara manual                                                                                                      | –               |
| #31/#32 | Empty state Aplikasi/Domain: aksi utama **Buat situs** / **Tambah domain**; jalur file di Cara manual                                                                                                                      | –               |
| #33     | Tombol **Pasang paket termux-api** (`pkg install -y termux-api`, job dengan log) + teks "Pasang juga aplikasi Termux:API dari F-Droid"                                                                                     | confirm         |
| #38     | Perintah `scp` kunci data ke Cara manual                                                                                                                                                                                   | –               |
| #39/#40 | **Pasang Cloudflare Access**: dengan token berizin Access + `account_id`, buat satu aplikasi self-hosted 4 path + policy Allow email super admin; pratinjau daftar path & email; setelah itu cek "Access terdeteksi". Tambah Admin → tawarkan tambah email ke policy. Endpoint API **perlu verifikasi** | confirm         |
| #41     | Bantuan pengaturan: tautan langsung ke halaman pembuatan token/bucket dengan templat izin                                                                                                                                   | –               |
| #43     | **Hubungkan akun Cloudflare**: jalankan `cloudflared tunnel login`, tampilkan URL otorisasi yang dicetak, tunggu `cert.pem` (batas 5 mnt), lalu cek ulang                                                                    | –               |
| #45/#54 | **Pulihkan dari cadangan** (HP sama): `sites`/`cloudflared` diekstrak `-k` (tanpa menimpa); `panel.db`: unduh → snapshot → tukar saat restart. HP baru: wizard setelah kredensial bucket diisi                           | typed           |
| #46     | **Nonaktifkan HP ini** (pindah HP): `sv down` + `down` untuk cloudflared, pm2, panel sebagai aksi terakhir; body menyatakan panel tidak terjangkau sesudahnya                                                               | typed           |
| #47/#48 | **Perbarui panel** / **Kembalikan versi panel sebelumnya** di Kesehatan sistem: unduh tarball rilis + `SHA256SUMS`, jalankan `install-phone.sh` sebagai proses terlepas, pantau `/api/health`; gagal → `panel.prev`     | confirm         |
| #51–#53 | Installer: tanya nilai `.env` yang kosong (`read`, secret tanpa echo); tambah ingress panel memakai logika editor yang sama + `tunnel route dns` bila `cert.pem` ada; tawarkan pasang nodejs-lts + pm2 (versi pin)       | prompt y/N      |

---

## 8. Pertanyaan terbuka (dengan rekomendasi)

| #   | Pertanyaan                                                                                                       | Rekomendasi                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Batalkan D1 (panel tidak pernah mengedit ecosystem)?                                                             | **Ya**, ganti dengan F1. Risiko D1 ditutup validasi node + backup + restore otomatis; tanpanya pemilik non-teknis buntu                                                          |
| Q2  | Blok di akhir file (mutasi `module.exports`) atau di atas `module.exports` + `...panelApps` di array?             | **Akhir file.** Tidak perlu mengurai kode pengguna; satu-satunya asumsi diverifikasi probe. Kekurangan: berbeda dari layout README/template, ditangani `legacyCurrent`            |
| Q3  | Fix sebagai job situs (tampil di Riwayat perubahan) atau sinkron?                                                | **Sinkron + audit** (F5). Atomik, < 20 dtk, tanpa keadaan setengah jadi                                                                                                         |
| Q4  | `--no-auto-exit`: restart pm2 langsung atau berlaku saat restart berikutnya?                                     | **Berlaku berikutnya** (default), tombol **Mulai ulang pm2 sekarang** opsional dengan konsekuensi. Tetap perlu walau ada penjaga (E4/E10c)                                     |
| Q5  | Penjaga `pm2-guard` dinamis di blok?                                                                             | **Ya**, hanya bila tidak ada app tangan. POCO tidak mendapat penjaga                                                                                                           |
| Q6  | Ubah template `deploy/pm2/ecosystem.config.js` dan `server-termux` ke blok bertanda sekarang?                    | **Belum.** Template 0.3.0 tetap dikenali `legacyCurrent`; ubah saat versi blok naik (butuh izin pemilik untuk server-termux, B24)                                                |
| Q7  | Lokasi backup?                                                                                                   | `<dataDir>/fix-backups/` (F6), ikut cadangan `panel` tidak; cukup lokal (file kecil, tujuan = undo cepat)                                                                       |
| Q8  | Peran yang boleh memperbaiki?                                                                                    | admin (A1); kunci data super_admin + sesi segar                                                                                                                                 |
| Q9  | DNS lewat `cert.pem` tanpa token (P1)?                                                                           | **Ya** untuk membuat; hapus tetap butuh token, dinyatakan jujur di UI                                                                                                           |
| Q10 | P2 yang menyentuh kode/record milik pengguna (#18, #19, #20) dan fitur baru (#39 Access API, #47/#48 update panel)? | Masuk v0.4.0 hanya setelah pemilik menyetujui per item; usulan urutan: #48 → #39 → #19 → #18 → #20                                                                              |
| Q11 | Versi rilis?                                                                                                     | **0.4.0** (fitur baru, `CHANGELOG.md` Added/Changed)                                                                                                                             |

---

## 9. Mode fake dan data demo (QA wajib bisa menguji)

- `FAKE_SCENARIO_FILE` (`.panel-fake.json`) += `integration?: "ready" | "poco" | "old_spread" | "exotic" | "broken" |
  "no_sites_dir" | "apps_json_invalid"`. `seedSandbox` menulis fixture yang sesuai (ditandai `// test-only`) saat
  sandbox dibuat; default tetap `ready`. `poco` = salinan struktur ecosystem POCO (§1 R&D, path diarahkan ke sandbox,
  binary `grun`/`php` palsu) + run script pm2 tanpa flag.
- `RunitAdapter.cmdline(name): Promise<string[] | null>`; fake menyimpan teks `run` saat layanan terakhir dinyalakan,
  sehingga `pending` bisa diuji (tulis flag → `pending` → Mulai ulang pm2 → ok).
- Fake `control(start)` menghapus file `down` sandbox seperti termux.
- `scripts/demo-seed.ts` menerima `--integration poco` untuk QA browser.
- Probe di fake memakai `node` host (sudah begitu).

## 10. Test (bun test, `tests/`)

| File                                   | Isi (assertion nyata)                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ecosystem.patch.test.ts`        | Fixture `tests/fixtures/ecosystem/{poco,template,old-spread,old-spread-x2,marked-v0,marked-current,markers-broken,array-export,dynamic-require,exports-function}.config.js`: kind + reason per fixture; POCO → candidate memuat makuro-solusi & adminneo tak berubah (digest), blok di akhir; dua kali apply = `unchanged`; old spread hilang; `changes[]` menunjuk baris benar |
| `tests/ecosystem.fix.test.ts`          | Temp dir + fake system + node: apply POCO → file baru, mode 0600 dijaga, symlink dijaga, backup ada, probe names = hand + panel runnable; validasi gagal (fixture `exports-function`) → file asli byte-identik; sha berubah antara pratinjau dan apply → `changed`; berubah saat validasi → `changed_during_fix`; restore, `changed_since`, `force`; retensi 10 |
| `tests/runscript.patch.test.ts`        | Run POCO → flag tepat setelah `pm2-runtime`; run template (sudah ada) → `unchanged`; flag hanya di komentar → patch; dua baris `pm2-runtime` → `run_script_unknown`; `sh -n` gagal → tidak ditulis; mode 0755                                                                                                                         |
| `tests/site.integration.test.ts`       | `snippet_current` moot tanpa sebutan apps.json (bug POCO); `legacyCurrent` template ok; `pm2_auto_exit` pending via fake `cmdline`; `fixes[]` sesuai skenario                                                                                                                                                                       |
| `tests/integration.fix.api.test.ts`    | Peran `user` 403, CSRF tanpa header 403; preview tidak menulis; apply → 200 + audit `integration.fix`; job berjalan → 409 `busy`; selama fix `jobs.start` → 409; apply-all berhenti di gagal pertama; backups + restore                                                                                                               |
| `tests/web.site.test.ts` (tambahan)    | Baris check dengan fix → tombol Perbaiki; fix tidak tersedia → `<details>` manual terbuka + alasan; dialog menyebut app yang dipertahankan; toast `rolled_back` tone warning; kamus `setup.*` lengkap (`satisfies`)                                                                                                                    |
| P1                                     | `tests/service.start.test.ts` (hapus `down` + start, audit), `tests/apps-json.rebuild.test.ts`, `tests/site.repair.test.ts` (folder, env, ALTER ROLE di fake postgres, undo), `tests/dns.route.test.ts` (fallback cert.pem, `dnsSource`), `tests/data-key.restore.test.ts` (kunci salah 422, benar → file 600 + backup + restart dipanggil), `tests/db.migrate.test.ts` 0009 |

Gerbang tiap gelombang: `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run bundle:check`
(anggaran `/panel` 215 KB hampir habis: dialog/diff dimuat lazy saat tombol Perbaiki ditekan).

## 11. Kriteria penerimaan

1. Di fake skenario `poco`: kartu Persiapan menampilkan 1 error ("Situs buatan panel belum ikut dijalankan pm2…") + 1
   warning, tombol **Perbaiki semua yang aman (2)**; satu klik + **Terapkan** → kartu menjadi satu baris "pm2 siap",
   tanpa membuka Termux.
2. Isi ecosystem hasil: teks asli byte-identik sampai baris terakhirnya, lalu blok v1. Mode file tetap. pm2 (fake) tidak
   menerima satu pun `restart/stop/delete/start` selama fix.
3. Menjalankan fix kedua kali: `unchanged`, file tidak ditulis (mtime tetap).
4. **Batalkan** dari toast mengembalikan file byte-identik dengan aslinya; check kembali error.
5. Fixture eksotis: tidak ada penulisan, baris menampilkan alasan awam + "Cara manual" terbuka.
6. Validasi gagal yang dipaksa (test): file asli utuh, toast "Dikembalikan" tone warning, audit `outcome: rolled_back`.
7. `pm2_auto_exit`: setelah fix → "aktif setelah pm2 dimulai ulang"; **Mulai ulang pm2 sekarang** meminta konfirmasi yang
   menyebut semua app; sesudahnya ok.
8. Tidak ada lagi teks "Jalankan `sv up pm2` di HP" di jalur utama (grep `sv up` di `src/web/i18n` hanya di kunci
   `manual`). Hal yang sama untuk "lewat ssh" pada item P1.
9. Semua aksi tercatat di audit dengan aktor; tidak ada isi file/nilai env di log atau audit (Rule 12).
10. Uji manual di POCO **hanya atas izin pemilik**: fix ecosystem + run script, verifikasi `pm2 list` tidak berubah
    (pid makuro-solusi & adminneo sama), reboot test terpisah atas izin.

## 12. Rencana kerja (worker, kepemilikan file eksklusif)

Satu worker per file per gelombang; worker tidak commit/push/ganti branch. Kontrak §5.1 ditulis lebih dulu agar
gelombang berikutnya bisa paralel.

| Gelombang | Worker                 | File (eksklusif)                                                                                                                                                                                                                         |
| --------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0        | `wkr-fix-contracts-00` | `src/shared/fix.types.ts` (baru), `src/shared/site.types.ts` (`Integration.fixes`, params), `src/shared/audit.types.ts`                                                                                                                  |
| F1        | `wkr-fix-core-01`      | `src/server/sites/ecosystem.patch.ts` (baru: blok, `planEcosystemFix`, `snippetCurrent`), `src/server/sites/runscript.patch.ts` (baru), `src/server/sites/fix.backup.ts` (baru), `src/server/sites/ecosystem.probe.ts`, `tests/ecosystem.patch.test.ts`, `tests/runscript.patch.test.ts`, `tests/fixtures/ecosystem/*` |
| F1        | `wkr-fix-adapters-01`  | `src/server/system/*` (`cmdline`, start hapus `down`, skenario fake), `scripts/demo-seed*.ts`, `tests/system.fake.test.ts`                                                                                                              |
| F1        | `wkr-fix-web-01`       | `src/web/site/site.setup.tsx`, `fix.button.tsx`, `fix.dialog.tsx`, `fix.diff.tsx`, `setup.manual.tsx` (baru), `site.adopt.ts`, `site.api.ts`, `src/web/i18n/id.site.ts`, `src/web/i18n/id.dev.setup.ts`, `src/web/dev/audit.describe.ts`, `tests/web.site.test.ts` |
| F2        | `wkr-fix-service-01`   | `src/server/sites/integration.fix.ts` (baru: preview/apply/restore, audit, kunci), `integration.service.ts`, `job.runner.ts` (`exclusive`), `src/server/routes/sites.routes.ts`, `site.service.ts`, `tests/ecosystem.fix.test.ts`, `tests/integration.fix.api.test.ts`, `tests/site.integration.test.ts` |
| F2        | `wkr-fix-qa-02`        | Read-only: QA browser fake `poco` (host `*.localhost` berbeda), laporan di scratchpad                                                                                                                                                   |
| F3a       | `wkr-svc-start-03`     | `src/web/shared/service-start.tsx` (baru), `src/server/panel/panel.service.ts`, `src/web/i18n/id.deploy.ts`, `id.panel.ts`, `src/shared/problem.copy.ts`, komponen kartu masalah Ringkasan, `src/web/site/job.failure.tsx`, `tests/service.start.test.ts` |
| F3a       | `wkr-dns-route-03`     | `src/server/system/cloudflared.termux.ts` + fake (`routeDns`; satu-satunya pemilik `system/*` di F3), `src/server/cloudflare/*`, `src/server/sites/site.steps.ts`, `drizzle/0009_auto_fix.sql` + schema, `src/web/site/dns.manual.tsx`, `id.settings.ts`, `tests/dns.route.test.ts` |
| F3a       | `wkr-datakey-03`       | `src/server/routes/security.routes.ts`, `src/server/data-key.service.ts`, `src/web/security/*`, `src/web/i18n/id.security.ts`, `tests/data-key.restore.test.ts`                                                                          |
| F3b       | `wkr-site-repair-03`   | `src/server/sites/integration.fix.ts` (fix `sites_dir_create`, `apps_json_rebuild`), `site.jobs.ts` (`site.repair`), `src/shared/job.types.ts`, `src/server/deploy/deploy.restart.ts`, `src/web/i18n/id.job.ts`, `id.site-detail.ts`, `id.site.ts`, `src/web/site/site-detail.page.tsx`, tests P1 situs |
| F4        | per item P2            | Ditetapkan setelah keputusan Q10; satu worker per item, file diumumkan di spec                                                                                                                                                         |
| Akhir     | `wkr-fix-docs-05`      | `README.md` (bagian Integrasi pm2, Instal, Kunci data: hanya bagian yang kontraknya berubah), `CHANGELOG.md` 0.4.0, `PLAN/DECISIONS.md` (F1–F9 setelah debat), `docs/content-guide.md` (pola "Cara manual"), `package.json` versi              |

Catatan: `id.site.ts` dimiliki `wkr-fix-web-01` di F1 dan `wkr-site-repair-03` di F3b (berurutan, tidak bentrok);
`wkr-dns-route-03` mengirim teks DNS untuk `id.site.ts` lewat spec ke `wkr-site-repair-03` agar tidak berbagi file di F3.

## 13. Risiko

| Risiko                                                           | Mitigasi                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Blok mengubah perilaku pm2 saat reboot berikutnya (tidak teruji live) | Validasi probe = cara pm2 memuat file; QA reboot di POCO hanya atas izin; backup + Batalkan                           |
| Pemilik menyunting file bersamaan                                 | Cek sha sebelum `rename` (`changed_during_fix`)                                                                        |
| `node` di HP tidak ada / timeout                                  | Fix tidak tersedia (`ecosystem_unloadable` via probe), jatuh ke Cara manual                                            |
| Kode tangan yang mengekspor fungsi/Promise                        | `listed: false` → validasi gagal → file tidak disentuh                                                                 |
| Anggaran bundle `/panel`                                          | Dialog dan diff lazy-load                                                                                              |
| Kebijakan lama (D1, rute tangan, record asing) diubah tanpa debat | PLAN ini wajib lewat debat adversarial + keputusan pemilik Q1/Q10 sebelum F1                                           |
