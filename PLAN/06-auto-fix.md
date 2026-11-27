# PLAN 06 — Perbaikan otomatis dari UI

Revisi 2 oleh `wkr-autofix-plan-02`, 2026-11-27, branch `feature/auto-fix`. Revisi 1 (`wkr-autofix-plan-01`) sudah
diperdebatkan di `PLAN/debate/06-auto-fix-debate.md`. Semua BLOCKER/MAJOR dan 16 edit wajib di sana sudah diterapkan di
sini. Keputusan koordinator yang mengikat ada di `PLAN/DECISIONS.md` §C (C1–C8). Bila dokumen ini bertentangan dengan
DECISIONS, DECISIONS yang berlaku.

Dasar: `R&D/07-auto-fix.md` (inventaris 54 item). Rujukan `#n` = baris inventaris R&D/07 §2. Rujukan "debat Cn" =
temuan di dokumen debat. Rujukan "DECISIONS Cn" = keputusan koordinator.

**Lingkup rilis 0.4.0 (DECISIONS C2, C7): P0 + P1 di dokumen ini. Semua item lain ada di §13 Backlog beserta alasannya.**

---

## 1. Keputusan PLAN (diikat DECISIONS C1–C8)

| #   | Keputusan                                                                                                                                                                                                                                                                                                                                                                          | Menggantikan                                       | Alasan                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Panel boleh mengubah `ecosystem.config.js`, hanya di dalam blok bertanda** `// >>> panel-termux:apps v<N>` … `// <<< panel-termux:apps`, ditambahkan di **akhir file**. Teks di luar penanda tidak pernah diubah, kecuali menghapus satu ekspresi lama `...require('./apps.json')`. Run script pm2 hanya boleh ditambah `--no-auto-exit` (F4). Disetujui pemilik (DECISIONS C1). | PLAN/03 D1 ("Panel tidak pernah mengedit")         | Alasan D1 adalah "parser teks JS rapuh". Blok di akhir file tidak butuh parser, dan hasilnya divalidasi dengan `node` seperti pm2 memuatnya |
| F2  | Setiap perbaikan file: pratinjau → tulis kandidat → validasi → backup bertanggal → `rename` atomik → cek sha. **Kandidat dan backup di-fsync sebelum rename; `writeAtomic` melakukan fsync pada file dan direktori** (debat C1). File dibaca sebagai byte, bukan teks (debat C2). Validasi gagal = file lama tetap, status **"Tidak diterapkan"** (warning).                       | –                                                  | Pola industri (Ansible `blockinfile`, pfSense). HP bisa mati mendadak (A9), jadi tanpa fsync rename bisa selamat sementara isinya hilang    |
| F3  | **Ubah file ≠ restart.** Perbaikan file tidak pernah me-restart pm2 atau app. Restart pm2 hanya lewat aksi terpisah F10.                                                                                                                                                                                                                                                           | –                                                  | makuro-solusi tidak boleh terputus tanpa persetujuan                                                                                        |
| F4  | `--no-auto-exit` ditulis ke run script sekarang dan **berlaku pada start pm2 berikutnya** (DECISIONS C3). Deteksi "belum aktif": flag ada di file **dan** `mtime(run) > waktu start layanan pm2` (`now − uptime` dari `supervise`). Keadaan ini = `ok` + info, bukan warning (debat C6, C14).                                                                                      | Deteksi lewat `/proc/<pid>/cmdline`                | Lab E4/E10c: flag tetap perlu walau ada penjaga. Tanpa adapter baru                                                                         |
| F5  | Perbaikan integrasi berjalan **sinkron** (bukan job situs) di bawah `jobs.assertIdle()` + `backup.busy()` + kunci aksi `integration` (`createActionLocks`). Tercatat di audit, tidak di Riwayat perubahan. Durasi biasanya < 5 dtk; batas keras ±35 dtk (satu probe kandidat dengan timeout 15 dtk, ditambah probe awal bila cache basi) (debat C10, C13).                         | `jobs.exclusive()`                                 | Satu-satunya penulis ecosystem adalah fix ini; deploy hanya membaca ecosystem. `rename` atomik, jadi tidak ada keadaan setengah jadi        |
| F6  | Backup di `<dataDir>/fix-backups/<file>/<yyyymmdd-HHMMSS>-<sha8 hasil>.bak` (folder 700, file 600), 10 terbaru per file, lokal saja (tidak ikut cadangan `panel`/R2) (DECISIONS C5).                                                                                                                                                                                               | `writeAtomic({backup})` → `<path>.bak` (satu saja) | Tidak mengotori folder pengguna/runit. Isi ecosystem bisa memuat `env` rahasia, jadi tidak diunggah                                         |
| F7  | Teks pengguna: kalimat awam dulu, nama file kedua. Instruksi manual selalu ada, dilipat di `<details>` **"Cara manual (untuk pengguna teknis)"**, terbuka otomatis hanya bila panel tidak bisa memperbaiki.                                                                                                                                                                        | Snippet + `nano` sebagai jalur utama               | Masukan pemilik                                                                                                                             |
| F8  | Mulai layanan `pm2`/`postgres` dari mana pun pesan "tidak berjalan" muncul: satu komponen tombol, memakai endpoint kontrol layanan yang ada. `start` juga menghapus file `down` layanan itu; copy tombol menyebut "menyala otomatis saat HP dinyalakan ulang".                                                                                                                     | Teks "Jalankan `sv up pm2` di HP" (8 tempat)       | D30 melarang daemon pm2 di luar runit, bukan `sv up`                                                                                        |
| F9  | Peran: semua perbaikan integrasi, restart pm2 yang dicek, dan tombol layanan = **admin** (A1), tiap aksi diaudit dengan aktor (DECISIONS C6). Tanpa re-auth: teks perubahan ditentukan panel, bukan pengguna.                                                                                                                                                                      | –                                                  | Setara aksi admin lain; guard CSRF yang ada (B17) cukup                                                                                     |
| F10 | **Restart pm2 dari panel selalu `confirm`, selalu dicek, dan menawarkan "Kembalikan dan mulai ulang"** bila ada app yang tidak kembali setelah panel mengubah ecosystem (debat C5). Copy konsekuensi menyebut nama semua app yang berjalan (DECISIONS C3).                                                                                                                         | Tombol restart tanpa pemeriksaan sesudahnya        | Restart pm2 = pemuatan pertama blok hasil patch                                                                                             |
| F11 | Penjaga `pm2-guard` ditambahkan blok **hanya bila tidak ada app tulisan tangan** (DECISIONS C4). POCO (2 app tangan) tidak mendapat penjaga.                                                                                                                                                                                                                                       | Saran "lihat README" (#3)                          | Lab E4/E10                                                                                                                                  |
| F12 | **Fix ecosystem baru aktif di build termux setelah lab E11 lulus** (DECISIONS C8, debat C4). Sebelum itu `available: false, reason: "not_verified"` di mode termux; mode fake selalu aktif agar QA bisa menguji. Fix run script tidak ikut gerbang ini.                                                                                                                            | –                                                  | Blok v1 belum pernah dimuat pm2-runtime nyata                                                                                               |

## 2. Lingkup

| P   | Item                                                                                                                                                                                                                                                                                                                                                    | Hasil untuk pengguna                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| P0  | `writeAtomic` fsync + baca byte (debat C1, C2); probe sentinel (C3); fix `ecosystem_block` (#1, #2, #3, #5); fix `pm2_auto_exit` (#4); restart pm2 yang dicek (F10); restore backup terbaru; bug copy `snippet_current`; hapus aturan moot `pm2_guard` (C15); copy C16; onboarding `apps_json`; skenario fake `poco`/`old_spread`/`exotic`; gerbang E11 | Kartu Persiapan di POCO selesai dengan 1–2 klik, tanpa Termux          |
| P1  | #10/#16/#26 tombol Jalankan pm2/postgres (semua lokasi); #14/#15 **Jalankan lagi**; #12A kartu record DNS siap salin; #12B `route dns` lewat `cert.pem` (bersyarat gerbang G0); #6 fix `sites_dir_create`                                                                                                                                               | Pesan "jalankan … di HP / lewat ssh" hilang dari alur harian yang umum |
| –   | Semua item lain                                                                                                                                                                                                                                                                                                                                         | §13 Backlog                                                            |

Item "tidak" (#21–25, #29, #30, #34–36, #42, #44, #49, #50) tetap manual; teksnya tidak diubah di gelombang ini.

---

## 3. P0 — Patcher `ecosystem.config.js` dan run script

### 3.1 Blok bertanda (teks persis, v1)

`<GUARD_SCRIPT>` diisi server dengan `JSON.stringify(termuxPrefix() + "/bin/sleep")` (di fake `<home>/usr/bin/sleep`),
bukan interpolasi mentah (debat C11). Teks blok tetap untuk satu HP. Baris akhir memakai EOL file: bila file memuat
`\r\n`, seluruh blok ditulis dengan `\r\n` (debat C2).

```js
// >>> panel-termux:apps v1 (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)
// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan
// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar. Blok ini tidak pernah menggagalkan file.
;{
  try {
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
        console.error("[ecosystem] apps.json dilewati: " + e.message);
      }
      const names = new Set(list.map((a) => a && a.name));
      const handWritten = list.length > 0;
      for (const a of panel) if (!names.has(a.name)) list.push(a);
      if (!handWritten && !names.has("pm2-guard"))
        list.push({ name: "pm2-guard", script: <GUARD_SCRIPT>, args: "infinity", interpreter: "none", autorestart: true });
    }
    globalThis.__panelTermuxApps = { v: 1, listed: list !== null };
  } catch (e) {
    console.error("[ecosystem] blok panel dilewati: " + e.message);
  }
}
// <<< panel-termux:apps
```

Kenapa bentuk ini:

- **Awalan `;` dan blok `{ }`** → aman dari ASI, tidak ada nama baru di scope file (tidak bentrok dengan `panelApps`,
  `fs`, `path` milik pengguna).
- **Seluruh badan di dalam `try`** → `push` pada array beku/proxy tidak menggagalkan ecosystem; app tangan tetap
  dimuat. Bila blok gagal, `__panelTermuxApps` tidak diset, jadi validasi kandidat menolaknya (debat C11).
- **Di akhir file, memodifikasi `module.exports`** → tidak perlu mencari `apps: [`. Satu-satunya asumsi (file mengekspor
  array atau `{ apps: [...] }`) diverifikasi probe (`listed`).
- Filter `existsSync` identik dengan snippet B18/D2 (lab E1e/E5). Panel sendiri hanya menulis entri `apps.json` setelah
  binary ada (B18), jadi filter yang hanya memeriksa `script` cukup.
- Penjaga dinamis sesuai F11.

`ECOSYSTEM_SNIPPET` (`integration.service.ts`) dihapus; `Integration.snippet` = `ecosystemBlock(prefix, eol)` dari
`ecosystem.patch.ts`. "Cara manual" menampilkan blok ini dengan instruksi "Tempel di **akhir** file". Template
`deploy/pm2/ecosystem.config.js` dan repo `server-termux` **tidak** diubah di 0.4.0 (§13).

### 3.2 `snippetCurrent` baru

```
current(text) = hasMarkers(text, v = BLOCK_VERSION) || legacyCurrent(text)
legacyCurrent(text) = !hasAnyMarker(text) && /panelApps/.test(text) && /existsSync/.test(text)   // template 0.3.0
```

Bug copy R&D §1: `snippet_current` disembunyikan (moot) bila teks **tidak menyebut `apps.json` sama sekali**. Di POCO
kartu menampilkan satu baris akar (`ecosystem_spreads_apps_json`) ditambah warning `pm2_auto_exit`.

### 3.3 Algoritma `planEcosystemFix(input)` (fungsi murni)

Input: `{ bytes: Buffer, path, realDir, sitesDirReal, nlink, probeBefore, prefix }`. Output:
`{ kind: "patch", candidate: Buffer, changes[], effects } | { kind: "unchanged" } | { kind: "manual", reason }`.

Decode: `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` sehingga BOM tetap ada di teks dan ikut ditulis
balik. Untuk kasus "tambah di akhir", kandidat = byte asli + byte blok (bukan encode ulang), jadi byte-identik terjamin.

| Langkah | Kondisi                                                                                      | Hasil                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1       | Path bukan `*.config.js`                                                                     | `manual: not_config_js`                                                                    |
| 2       | File tidak ada                                                                               | `manual: ecosystem_missing`                                                                |
| 3       | `realDir ≠ sitesDirReal` (symlink ke luar `sites.dir`) atau `nlink > 1` (debat C12)          | `manual: ecosystem_linked`                                                                 |
| 4       | > 256 KiB                                                                                    | `manual: too_large`                                                                        |
| 5       | Decode fatal gagal (debat C2)                                                                | `manual: not_utf8`                                                                         |
| 6       | `probeBefore.ok === false`                                                                   | `manual: ecosystem_unloadable`                                                             |
| 7       | Penanda: jumlah `>>>` ≠ jumlah `<<<`, > 1 pasang, atau urutan terbalik                       | `manual: markers_broken`                                                                   |
| 8       | Sepasang penanda ada, isi di antaranya == blok terbaru                                       | `unchanged`                                                                                |
| 9       | Sepasang penanda ada, isi berbeda (versi lama / disunting)                                   | `patch`: ganti seluruh region penanda (termasuk baris penanda) dengan blok terbaru         |
| 10      | Tanpa penanda, `legacyCurrent(text)`                                                         | `unchanged`                                                                                |
| 11      | Tanpa penanda, `OLD_SPREAD` cocok **tepat satu kali** dan tidak ada sebutan `apps.json` lain | `patch`: hapus ekspresi itu (baris dihapus bila tinggal spasi/koma) + tambah blok di akhir |
| 12      | Tanpa penanda, teks tidak menyebut `apps.json` dan `probeBefore.loadedAppsJson === false`    | `patch`: tambah blok di akhir (satu baris kosong pemisah; newline akhir dijaga)            |
| 13      | Selain itu (apps.json dimuat dengan cara lain, banyak spread, `require` dinamis)             | `manual: unknown_apps_json_use`                                                            |

Gerbang F12 dicek sebelum fungsi ini (di `integration.fix.ts`): mode termux dan `ECOSYSTEM_FIX_ON_TERMUX === false` →
`manual: not_verified`.

`OLD_SPREAD = /\.\.\.\s*require\(\s*(["'])\.\/apps(?:\.json)?\1\s*\)\s*,?/g`. Komentar yang memuat teks itu ikut
terhitung → ≥ 2 kecocokan → manual.

`changes[]` = hunk yang dibuat patcher sendiri (tanpa library diff): `{ kind: "remove", line, text }` dan
`{ kind: "add", afterLine, lines }`.

### 3.4 Terapkan (`applyEcosystemFix`)

1. `jobs.assertIdle()` dan `backup.busy()` → 409 `busy`; kunci aksi `integration` (`createActionLocks`) (F5).
2. `path = realpath(ecosystem)`. Baca **byte** + `sha256(bytes)` + `stat.mode` + `stat.nlink`.
3. `expect[path]` dari pratinjau ≠ sha sekarang → 409 `changed`.
4. `probeBefore` = probe dari cache integrasi bila sha-nya sama, selain itu probe baru. `plan = planEcosystemFix(...)`.
   `unchanged` → hasil `unchanged` tanpa menulis apa pun. `manual` → 422 `not_fixable {reason}`.
5. Tulis kandidat `<dir>/.ecosystem.panel-candidate.config.js` dengan mode asli dan fsync (nama harus `*.config.js`,
   folder sama agar `./apps.json` dan `__dirname` sama).
6. `probeAfter = probe(candidate)`; kandidat dihapus di `finally`. Valid bila **semua** (debat C3):
   - `ok`, `block = { v: BLOCK_VERSION, listed: true }`;
   - sentinel `__panel_probe__` ada (= `spreads`);
   - setiap app tangan di `probeBefore.digests` ada di `probeAfter.digests` dengan digest sama;
   - `pm2-guard` ada bila dan hanya bila tidak ada app tangan (atau sudah ada sebelumnya);
   - tidak ada nama ganda.
     Gagal → 422 `validation_failed` + `detail` (teredaksi, 300 karakter); file asli tidak tersentuh.
7. Sha file asli dibaca ulang; berubah → 409 `changed_during_fix`.
8. Backup: `copyFileSync` isi asli (byte) → `fix-backups/ecosystem/<ts>-<sha8 kandidat>.bak` (600), fsync file +
   direktori. Retensi 10.
9. `writeAtomic(path, candidateBytes, { mode: modeAsli })` (fsync file, rename, fsync direktori).
10. Sha file hidup dibaca ulang dan dibandingkan dengan sha kandidat (pengganti probe ketiga, debat C10). Berbeda →
    `log.warn` dan audit mencatat sha sebenarnya; tidak ada tulis balik (bisa menimpa suntingan orang lain).
11. Buang cache integrasi, hitung ulang, audit `integration.fix` `{ key, file, backupId, shaBefore, shaAfter, outcome }`
    (tanpa isi file).
12. Respons `FixResult` dengan `integration` terbaru.

**Error I/O** (debat C19): `ENOSPC` → 507 `disk_full`; `EACCES`/`EPERM` → 422 `not_writable`. File asli tetap utuh
karena backup dan kandidat ditulis sebelum rename. Error lain di-throw dengan konteks (operasi + path + penyebab asal).

**Saat boot** (debat C13): hapus kandidat yatim `.ecosystem.panel-candidate.config.js` di `sites.dir` (isinya bisa
memuat rahasia dari `env`).

**Idempoten:** menjalankan ulang setelah sukses → langkah 8 atau 10 tabel §3.3 → `unchanged`. **App berjalan:** tidak ada
pemanggilan pm2. File baru dibaca pm2 saat runtime start berikutnya dan saat deploy pertama situs panel (`start --only`).

### 3.5 Batalkan perubahan (restore)

`POST /integration/backups/:id/restore`, body `{ force?: boolean; restart?: boolean }`:

1. `id` harus cocok `^(ecosystem|pm2_run)\.\d{8}-\d{6}-[0-9a-f]{8}$`, di-resolve ke
   `fix-backups/<file>/<ts>-<sha8>.bak` lalu dicek tetap di dalam `fix-backups/<file>/`. Tidak ada → 404 `not_found`.
   Path tujuan restore hanya dari `FixFile` → path server, tidak pernah dari body (debat C17).
2. Kunci dan `busy` seperti §3.4 langkah 1.
3. sha8 file sekarang == sha8 di nama backup → lanjut. Berbeda dan `force` tidak diset → 409 `changed_since`.
4. Validasi isi backup lewat kandidat (ecosystem: probe `ok`; pm2_run: cek sintaks §3.6). Isi saat ini juga di-backup
   dulu (undo atas undo).
5. `writeAtomic`, buang cache, audit `integration.restore` `{ file, backupId, forced }`.
6. `restart: true` → jalankan restart yang dicek (§3.7) dan sertakan hasilnya di `FixResult.restart`.

Dialog restore (debat C9) menyebut situs dikelola yang ada di `apps.json` saat ini: "{blog dan shop} tidak berjalan lagi
setelah HP dinyalakan ulang." Daftar tidak kosong → tier `confirm`; kosong → dialog biasa. Data dari
`Integration.lastFix.affectedSites`. Undo tetap tersedia: panel tetap hidup walaupun pm2 mati (runit terpisah).

### 3.6 Run script pm2 (`--no-auto-exit`, #4)

`planRunScriptFix(bytes)`:

| Kondisi                                                                                                 | Hasil                                                                      |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| File `$PREFIX/var/service/pm2/run` tidak ada                                                            | `manual: run_script_missing`                                               |
| File adalah symlink, `nlink > 1`, atau bukan UTF-8                                                      | `manual: run_script_unknown`                                               |
| Baris non-komentar yang memuat `pm2-runtime` ≠ 1, atau baris itu memuat `pm2-runtime start` (debat C20) | `manual: run_script_unknown`                                               |
| Baris itu sudah memuat `--no-auto-exit`                                                                 | `unchanged`                                                                |
| Selain itu                                                                                              | `patch`: `/(pm2-runtime)(\s)/` → `$1 --no-auto-exit$2` pada baris itu saja |

Validasi kandidat: interpreter dari shebang bila ada di `$PREFIX/bin` (mis. `bash -n`), selain itu `sh -n`; exit 0 dan
teks hanya berbeda di baris itu. Mode asli (0755) dijaga, backup ke `fix-backups/pm2_run/`, fsync seperti §3.4. Tidak
ada `sv restart`.

Status check `pm2_auto_exit` (`integration.service.ts`):

| Flag di file | Layanan pm2                                   | state   | params           | Teks                                  |
| ------------ | --------------------------------------------- | ------- | ---------------- | ------------------------------------- |
| tidak        | –                                             | warning | –                | `checks.pm2_auto_exit.warning`        |
| ya           | tidak berjalan, atau `mtime(run) ≤ startedAt` | ok      | –                | –                                     |
| ya           | berjalan dan `mtime(run) > startedAt`         | ok      | `{ pending: 1 }` | `checks.pm2_auto_exit.pending` (info) |

`startedAt = now − uptime` dari `RunitAdapter.supervise("pm2")` yang sudah ada. Batas: suntingan komentar di run script
juga dihitung pending (`ponytail:` di kode; dapat diterima). Baris pending tidak punya tombol; tautan sekunder **Mulai
ulang pm2 sekarang** ada di `<details>` kartu (debat C6).

**Aturan moot dihapus** (debat C15): `pm2_guard` tidak lagi disembunyikan karena flag `--no-auto-exit` di file. Dengan blok
v1, `pm2_guard` hanya gagal di file lama tanpa penjaga dan tanpa app tangan.

### 3.7 Restart pm2 yang dicek (F10, debat C5)

`POST /integration/pm2/restart` (body kosong) → `Pm2RestartResult`:

1. Kunci `integration`, `jobs.assertIdle()`, `backup.busy()` → 409 `busy`.
2. `before` = nama app pm2 yang `online` dengan pid valid (B18).
3. Restart lewat jalur yang ada: `controlService(actorId, "pm2", "restart")` (audit `service.restart`,
   `noteIntentionalRestart`, kunci `service:pm2`).
4. Polling `pm2.list()` tiap 2 dtk sampai 30 dtk, sampai setiap nama di `before` `online` dengan pid > 0 yang hidup.
5. `missing` = nama yang tidak kembali. Bila `missing` tidak kosong **dan** `lastFix` ecosystem dibuat setelah start pm2
   sebelumnya → `offerRestore = lastFix.id`.
6. Audit `integration.pm2_restart` `{ missing: n }`. Respons memuat `integration` terbaru.

UI: dialog `confirm` dengan `restartPm2Body(apps)` + `restartPm2FileNote` bila ecosystem diubah panel sejak pm2 start.
`missing` tidak kosong → hasil warning `restartCheckFailed(apps)` + tombol **Kembalikan file ecosystem dan mulai ulang
pm2** (tier `confirm`) → `POST /integration/backups/:id/restore { restart: true, force }`. Tidak ada rollback otomatis
tanpa klik.

### 3.8 Probe (`ecosystem.probe.ts`, diperluas)

- Sebelum `require(eco)`, probe mengisi `require.cache[<dir>/apps.json]` dengan
  `[{ name: "__panel_probe__", script: process.execPath, interpreter: "none" }]` (debat C3). Entri ini selalu lolos filter.
- Baris JSON probe ditambah `spreads` (sentinel muncul di daftar), `block: { v, listed } | null` (dari
  `globalThis.__panelTermuxApps`), dan `digests: Record<name, string>` (`sha256(JSON.stringify(app, kunci terurut))`;
  nilai `env` ikut di-hash tetapi tidak pernah dicetak).
- Sentinel dibuang dari `names`, `envKeys`, dan `digests` sebelum dikembalikan.
- Tipe `EcosystemProbe` ok += `spreads`, `block`, `digests`. Env probe tetap minimal (`PROBE_ENV_KEYS`).
- Konsekuensi: `names` tidak lagi memuat entri `apps.json` asli. `Integration.appNames` = `probe.names` ∪ nama entri
  `apps.json` yang runnable (dihitung di `integration.service.ts`), sehingga `readyLine(n)` tetap benar.
- `check("ecosystem_spreads_apps_json")` = `probe.ok && probe.spreads` (menutup bug "lupa `...panelApps`" yang lolos saat
  `apps.json = []`). Params `{ noSites: 1 }` bila `apps.json` kosong (copy C16).

---

## 4. Pola UX (P0 dan P1)

### 4.1 Komponen

| Komponen                                 | File                            | Perilaku                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tombol kartu **Perbaiki semua (n)**      | (di `site.setup.tsx`)           | Header kartu Persiapan bila ≥ 1 fix `available`. Label "Perbaiki" bila n = 1. Satu-satunya tombol fix; tidak ada tombol per baris (debat C18)                                                                                                      |
| Dialog pratinjau                         | `src/web/site/fix.dialog.tsx`   | Memanggil preview tiap fix, menampilkan ringkasan awam dari `effects` per fix, `<details>` **Lihat perubahan pada file** berisi diff, tombol **Terapkan** / **Batal**. Terapkan = klien memanggil fix satu per satu, berhenti di kegagalan pertama |
| Diff                                     | `src/web/site/fix.diff.tsx`     | Render `FixChange[]`: baris `+`/`-`, nomor baris, monospace, scroll horizontal. Tanpa library                                                                                                                                                      |
| Cara manual                              | `src/web/site/setup.manual.tsx` | `<details>` native: blok + "tempel di akhir file" + perintah `nano` + run script. Terbuka otomatis bila ada fix `available: false`                                                                                                                 |
| Toast hasil                              | sonner yang ada                 | Sukses tanpa aksi undo; `validation_failed` = "Tidak diterapkan" tone warning; error lain = pesan kode                                                                                                                                             |
| Baris "Perubahan terakhir" + restart pm2 | (di `site.setup.tsx`)           | Di dalam `<details>` kartu: "Diperbaiki panel {waktu}. **Batalkan perubahan**" (dari `Integration.lastFix`) dan tautan **Mulai ulang pm2 sekarang** (§3.7). Satu-satunya UI undo                                                                   |

Dialog dan diff dimuat lazy saat tombol ditekan (anggaran `/panel` 215 KB, B30). Setelah setiap aksi kartu memakai
`integration` dari respons (cek ulang otomatis).

### 4.2 Copy (`src/web/i18n/id.site.ts`, objek `setup`)

Mengikuti `docs/content-guide.md` ("kamu", sentence case, nama file dalam kode, tanpa tanda seru).

| Kunci                                        | Teks                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                                | "Sekali saja: panel menghubungkan situs buatannya ke pm2 agar tetap berjalan setelah HP dinyalakan ulang."                                                                                |
| `checks.ecosystem_spreads_apps_json.error`   | "Situs buatan panel belum ikut dijalankan pm2, jadi tidak berjalan lagi setelah HP dinyalakan ulang."                                                                                     |
| `checks.ecosystem_spreads_apps_json.noSites` | "Sebelum situs pertama dibuat, panel perlu menghubungkannya ke pm2."                                                                                                                      |
| `checks.snippet_current.error`               | "pm2 memuat situs panel dengan cara lama: bila satu situs rusak, semua aplikasi bisa berhenti."                                                                                           |
| `checks.pm2_auto_exit.warning`               | "pm2 bisa berhenti sendiri saat semua aplikasi dihentikan."                                                                                                                               |
| `checks.pm2_auto_exit.pending`               | "Pengaman pm2 sudah dipasang. Aktif setelah HP atau pm2 dimulai ulang."                                                                                                                   |
| `checks.pm2_guard.warning`                   | "pm2 bisa berhenti sendiri saat situs terakhir dihapus."                                                                                                                                  |
| `fix` / `fixAll(n)`                          | "Perbaiki" / "Perbaiki semua (n)"                                                                                                                                                         |
| `dialog.ecosystem_block.title`               | "Hubungkan situs panel ke pm2?"                                                                                                                                                           |
| `dialog.ecosystem_block.body(keep)`          | "Panel menambahkan satu blok di akhir `ecosystem.config.js`. Aplikasi yang sudah ada tetap sama dan tidak dimulai ulang: {makuro-solusi, adminneo}. Situs yang berjalan tidak terganggu." |
| `dialog.ecosystem_block.oldSpread`           | "Baris lama `...require('./apps.json')` diganti, karena bisa menghentikan semua aplikasi bila `apps.json` rusak."                                                                         |
| `dialog.ecosystem_block.guard`               | "Karena belum ada aplikasi lain, panel juga menambahkan penjaga kecil (±6 MB) agar pm2 tetap hidup."                                                                                      |
| `dialog.pm2_auto_exit.title`                 | "Pasang pengaman pm2?"                                                                                                                                                                    |
| `dialog.pm2_auto_exit.body`                  | "Panel mengubah pengaturan layanan pm2 agar tidak berhenti sendiri saat semua aplikasi dihentikan. Berlaku saat pm2 dimulai ulang berikutnya; aplikasi tidak terganggu sekarang."         |
| `dialog.sites_dir_create.title`              | "Buat folder situs?"                                                                                                                                                                      |
| `dialog.sites_dir_create.body(dir)`          | "Panel membuat folder `{dir}` untuk situs-situsmu."                                                                                                                                       |
| `dialog.backupNote`                          | "Salinan file lama disimpan, jadi perubahan ini bisa dibatalkan."                                                                                                                         |
| `dialog.showDiff`                            | "Lihat perubahan pada file"                                                                                                                                                               |
| `dialog.apply` / `dialog.cancel`             | "Terapkan" / "Batal"                                                                                                                                                                      |
| `dialog.applying`                            | "Menerapkan…"                                                                                                                                                                             |
| `dialogAll.title(n)`                         | "Perbaiki n hal sekaligus?"                                                                                                                                                               |
| `done` / `doneAll(n)`                        | "Diperbaiki. Pemeriksaan sudah diulang." / "n hal diperbaiki. Pemeriksaan sudah diulang."                                                                                                 |
| `notApplied`                                 | "Tidak diterapkan: hasil perubahan tidak bisa dimuat pm2. File lama tetap dipakai."                                                                                                       |
| `lastFix(ago)`                               | "Diperbaiki panel {ago}."                                                                                                                                                                 |
| `undoAction`                                 | "Batalkan perubahan"                                                                                                                                                                      |
| `undoTitle(at)`                              | "Kembalikan file ke versi {at}?"                                                                                                                                                          |
| `undoBody.ecosystem`                         | "Situs buatan panel tidak lagi ikut dijalankan pm2 setelah HP dinyalakan ulang."                                                                                                          |
| `undoBody.ecosystemSites(sites)`             | "{blog dan shop} tidak berjalan lagi setelah HP dinyalakan ulang. Sekarang tetap berjalan."                                                                                               |
| `undoBody.pm2_run`                           | "pm2 kembali bisa berhenti sendiri saat semua aplikasi dihentikan."                                                                                                                       |
| `undoChanged`                                | "File sudah diubah lagi setelah perbaikan. Mengembalikan versi lama membuang perubahan itu."                                                                                              |
| `undoForce`                                  | "Tetap kembalikan"                                                                                                                                                                        |
| `undone`                                     | "Perubahan dibatalkan."                                                                                                                                                                   |
| `restartPm2`                                 | "Mulai ulang pm2 sekarang"                                                                                                                                                                |
| `restartPm2Body(apps)`                       | "Semua aplikasi berhenti beberapa detik lalu berjalan lagi: {apps}. Pengunjung bisa terputus sebentar."                                                                                   |
| `restartPm2FileNote`                         | "Perubahan yang dibuat panel pada `ecosystem.config.js` ikut berlaku sekarang."                                                                                                           |
| `restartOk`                                  | "pm2 dimulai ulang. Semua aplikasi berjalan lagi."                                                                                                                                        |
| `restartCheckFailed(apps)`                   | "{apps} tidak berjalan lagi setelah pm2 dimulai ulang."                                                                                                                                   |
| `restoreAndRestart`                          | "Kembalikan file ecosystem dan mulai ulang pm2"                                                                                                                                           |
| `manual.title`                               | "Cara manual (untuk pengguna teknis)"                                                                                                                                                     |
| `manual.step1..4`                            | "Buka file ecosystem di Termux:" · "Tempel blok ini di **akhir** file:" · "Simpan. pm2 tidak perlu dimulai ulang." · "Tekan Periksa lagi."                                                |
| `manual.runScript`                           | "Tambahkan `--no-auto-exit` setelah `pm2-runtime` di file ini, lalu mulai ulang layanan pm2 saat aman:"                                                                                   |
| `errors.busy`                                | "Ada perubahan situs atau cadangan yang sedang berjalan. Coba lagi setelah selesai."                                                                                                      |
| `errors.changed`                             | "File berubah sejak pratinjau dibuat. Lihat perubahannya lagi."                                                                                                                           |
| `errors.changed_during_fix`                  | "File sedang diubah di HP. Tutup editornya, lalu coba lagi."                                                                                                                              |
| `errors.disk_full`                           | "Memori HP penuh, jadi file tidak diubah."                                                                                                                                                |
| `errors.not_writable`                        | "Panel tidak punya izin mengubah file ini, jadi file tidak diubah."                                                                                                                       |
| `unfixable.ecosystem_missing`                | "File `ecosystem.config.js` tidak ada, jadi panel tidak tahu cara pm2 di HP ini dijalankan."                                                                                              |
| `unfixable.ecosystem_unloadable`             | "File `ecosystem.config.js` sekarang tidak bisa dimuat pm2, jadi panel tidak mengubahnya. Perbaiki dulu kesalahannya (lihat detail), lalu periksa lagi."                                  |
| `unfixable.ecosystem_linked`                 | "`ecosystem.config.js` adalah tautan ke file di folder lain, jadi panel tidak mengubahnya."                                                                                               |
| `unfixable.not_config_js`                    | "Nama file ecosystem harus berakhiran `.config.js` agar pm2 membacanya sebagai daftar aplikasi."                                                                                          |
| `unfixable.too_large`                        | "File ecosystem terlalu besar untuk diubah otomatis."                                                                                                                                     |
| `unfixable.not_utf8`                         | "File ecosystem memakai penyandian teks selain UTF-8, jadi panel tidak mengubahnya agar isinya tidak rusak."                                                                              |
| `unfixable.markers_broken`                   | "Penanda blok panel di `ecosystem.config.js` rusak atau dobel, jadi panel tidak mengubahnya."                                                                                             |
| `unfixable.unknown_apps_json_use`            | "`ecosystem.config.js` memuat `apps.json` dengan cara yang tidak dikenali panel, jadi panel tidak mengubahnya."                                                                           |
| `unfixable.not_verified`                     | "Perbaikan otomatis file ini belum diaktifkan di versi panel ini."                                                                                                                        |
| `unfixable.run_script_missing`               | "Run script layanan pm2 tidak ditemukan."                                                                                                                                                 |
| `unfixable.run_script_unknown`               | "Run script layanan pm2 ditulis dengan cara yang tidak dikenali panel."                                                                                                                   |
| `unfixable.sites_dir_outside_home`           | "Folder situs berada di luar folder home Termux, jadi panel tidak membuatnya."                                                                                                            |
| `unfixableSuffix`                            | "Ikuti Cara manual di bawah."                                                                                                                                                             |

Onboarding `id.dev.setup.ts` `apps_json.action`: "Perbaiki di Situs" (tautan `/panel/sites#persiapan`).

---

## 5. Kontrak API dan tipe

### 5.1 `src/shared/fix.types.ts` (baru)

```text
import type { Integration, IntegrationCheckKey } from "./site.types";

/** Integration fixes the panel can apply itself (0.4.0). */
export type FixKey = "ecosystem_block" | "pm2_auto_exit" | "sites_dir_create";
/** Why the panel will not apply a fix (copy: setup.unfixable.*). */
export type FixBlockReason =
  | "not_config_js" | "ecosystem_missing" | "ecosystem_linked" | "too_large" | "not_utf8" | "ecosystem_unloadable"
  | "markers_broken" | "unknown_apps_json_use" | "not_verified" | "run_script_missing" | "run_script_unknown"
  | "sites_dir_outside_home";
/** Per fix: which checks it resolves and whether it can run now. */
export type FixAvailability = { key: FixKey; checks: IntegrationCheckKey[] } & (
  | { available: true }
  | { available: false; reason: FixBlockReason }
);
/** Which file a change or backup belongs to. */
export type FixFile = "ecosystem" | "pm2_run";
/** One hunk produced by the patcher itself (1-based lines of the current file). */
export type FixChange = { kind: "add"; afterLine: number; lines: string[] } | { kind: "remove"; line: number; text: string };
/** Preview of one file; `sha` goes back in the apply request. */
export type FixFilePreview = { file: FixFile; path: string; sha: string; changes: FixChange[] };
/** What the change means, for the plain-language dialog. */
export type FixEffects = {
  keepApps: string[];        // hand-written apps, unchanged, not restarted
  addApps: string[];         // panel sites pm2 will load (on next start)
  guard: boolean;            // pm2-guard added
  oldSpread: boolean;        // `...require('./apps.json')` removed
  appliesOnRestart: boolean; // pm2_auto_exit
  dir: string | null;        // sites_dir_create
};
export type FixPreview = { key: FixKey; files: FixFilePreview[]; effects: FixEffects };
/** Body of POST /integration/fixes/:key; `expect` = path → sha from the preview. */
export type FixApplyRequest = { expect: Record<string, string> };
export type FixErrorCode =
  | "busy" | "changed" | "changed_during_fix" | "changed_since" | "validation_failed" | "not_fixable"
  | "disk_full" | "not_writable" | "not_found";
/** Latest panel backup of one file; `changedSince` = file edited after the fix (restore needs force). */
export type FixBackup = { id: string; file: FixFile; at: string; changedSince: boolean; affectedSites: string[] };
/** Result of the checked pm2 restart (F10). */
export type Pm2RestartResult = { ok: boolean; missing: string[]; offerRestore: string | null; integration: Integration };
export type FixResult = {
  key: FixKey | "restore";
  outcome: "applied" | "unchanged" | "restored";
  restart: Pm2RestartResult | null; // restore with `restart: true`
  integration: Integration;
};
```

`Integration` (`site.types.ts`) += `fixes: FixAvailability[]`, `lastFix: FixBackup | null` (backup terbaru dari file mana
pun). `IntegrationCheck.params.pending` untuk `pm2_auto_exit`, `params.noSites` untuk `ecosystem_spreads_apps_json`.
`Integration.snippet` = teks blok v1.

### 5.2 Endpoint (`/api/panel`, peran admin, guard Origin + `X-Requested-With`)

| Metode | Path                               | Hasil                                                       | Error                                                                                                            |
| ------ | ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/integration`                     | `Integration` + `fixes` + `lastFix`                         | –                                                                                                                |
| POST   | `/integration/fixes/:key/preview`  | `FixPreview` (tidak menulis apa pun)                        | 422 `not_fixable {reason}`, 404 key                                                                              |
| POST   | `/integration/fixes/:key`          | `FixResult` (body `FixApplyRequest`)                        | 409 `busy`/`changed`/`changed_during_fix`, 422 `validation_failed`/`not_fixable`/`not_writable`, 507 `disk_full` |
| POST   | `/integration/backups/:id/restore` | `FixResult` (body `{ force?: boolean; restart?: boolean }`) | 409 `changed_since`/`busy`, 404 `not_found`, 422 `validation_failed`/`not_writable`, 507 `disk_full`             |
| POST   | `/integration/pm2/restart`         | `Pm2RestartResult`                                          | 409 `busy`                                                                                                       |

Tidak ada batch endpoint dan tidak ada `GET /integration/backups` (debat C18).

Audit (`src/shared/audit.types.ts`): `integration.fix`, `integration.restore`, `integration.pm2_restart`. Kunci dan isi
file tidak pernah masuk audit atau log. `audit.describe.ts` (web): "{aktor} memperbaiki integrasi pm2 ({file})",
"{aktor} membatalkan perbaikan {file}", "{aktor} memulai ulang pm2 dari kartu Persiapan".

### 5.3 Runner

Tidak ada API runner baru. Fix memakai `jobs.assertIdle()` (`job.runner.ts`) + `backup.busy()` + kunci aksi
`integration`.

---

## 6. P1 — desain per item

### 6.1 Tombol **Jalankan pm2 / postgres** (#10, #16, #26; F8)

- Komponen `src/web/shared/service-start.tsx`: `ServiceStartButton({ service: "pm2" | "postgres", onStarted?: () => void })`
  → `POST /api/panel/services/:name/start` (endpoint yang ada; audit, kunci, `noteIntentionalRestart` sudah ditangani
  `panel.service.ts`). Label: "Jalankan pm2" / "Jalankan postgres". Sukses: toast "pm2 berjalan lagi dan menyala
  otomatis saat HP dinyalakan ulang." lalu `onStarted()`.
- Server: aksi `start` pada layanan inti (`pm2`, `postgres`) menghapus `$SVDIR/<name>/down` bila ada, lalu `sv up`
  (gotcha POCO: hapus `down` saja tidak menyalakan). Implementasi di `RunitAdapter` (`runit.termux.ts` + fake).
- Dipasang di: baris check `pm2_runtime` (Persiapan), toast error `pm2_not_running`/`pm2_unavailable` di daftar situs,
  banner detail situs (`pm2_not_running`), halaman job gagal (`job.failure.tsx`), kartu masalah Ringkasan
  (`service_down`, `pm2_unavailable`), `database_failed`.
- Copy semua lokasi: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti." + tombol; perintah `sv up pm2` pindah
  ke "Cara manual".

### 6.2 Buat folder situs (#6) — fix `sites_dir_create`

`mkdir -p` mode 700 hanya bila `realpath` induk terdekat yang ada berada di HOME (`sites_dir_outside_home` bila tidak),
lalu `ensureAppsJson`. Masuk mekanisme fix yang sama (preview `files: []`, `effects.dir`). Tanpa backup (tidak ada yang
ditimpa); tidak ada undo. Audit `integration.fix` `{ key: "sites_dir_create" }`.

### 6.3 Jalankan lagi app yang hilang dari pm2 (#14, #15)

- Situs **dikelola** sudah dimuat ulang oleh `restartApp` (`deploy.restart.ts`); yang kurang hanya tombol dan copy.
- Situs **adopsi** yang tidak dikenal pm2: `restartApp` → `startFromEcosystem(eco, name)`; `null` →
  `StepError("app_not_in_ecosystem")`.
- Detail situs "Tidak berjalan di pm2": tombol utama **Jalankan lagi** (job `site.restart` yang ada). Copy:
  - dikelola: "pm2 tidak menjalankan situs ini. Tekan Jalankan lagi; panel memuatnya ulang dari daftar situs panel."
  - adopsi: "pm2 tidak menjalankan aplikasi ini. Tekan Jalankan lagi untuk memuatnya dari `ecosystem.config.js`."
  - `app_not_in_ecosystem`: "Entri aplikasi ini tidak ada lagi di `ecosystem.config.js`, jadi panel tidak bisa
    menjalankannya. Tambahkan lagi lewat Cara manual, atau hapus situs ini dari panel."

### 6.4 DNS tanpa token (#12)

**Bagian A (tanpa syarat):** kartu `src/web/site/dns.manual.tsx` saat token kosong: record siap salin (Tipe `CNAME`,
Nama `<host>`, Isi `<tunnelId>.cfargotunnel.com`, Proxy aktif) + **Periksa lagi** (cek DNS wizard yang ada). Tautan
"Buat token Cloudflare" hanya bila format URL templat token sudah diverifikasi di gerbang G0; bila belum, tautan ke
halaman token umum.

**Bagian B (bersyarat gerbang G0, debat C8):**

- `CloudflaredAdapter.routeDns(tunnel, hostname)` → `cloudflared tunnel route dns <tunnel> <hostname>` (tanpa overwrite).
- Di langkah `dns` yang ada (`site.steps.ts`, bukan `dns_ensure`): bila `DnsNotConfiguredError` muncul dan
  `~/.cloudflared/cert.pem` ada (`existsSync` saja; isi cert tidak pernah dibaca), jalankan `routeDns`. Hasil diterima
  hanya bila output cloudflared menyebut FQDN yang **persis sama** dengan hostname yang diminta → `dns_routed`. Berbeda
  → `dns_wrong_zone` dengan record siap salin dan nama record keliru yang perlu dihapus di dasbor.
- `dnsManaged` tetap `false` (record tanpa `recordId`); penghapusan sudah melewatinya (`dns_none_owned`). **Tanpa migrasi
  dan tanpa kolom `dns_source`.**
- Copy: `dns_routed` "Record DNS dibuat lewat cloudflared. Panel hanya bisa menghapusnya bila token API diisi.";
  `dns_wrong_zone` "cloudflared membuat record di zona lain ({fqdn}). Hapus record itu di dasbor Cloudflare, lalu tambahkan
  record di bawah secara manual."
- Gerbang G0 (Rule 20): format output `route dns` diverifikasi di POCO (versi cloudflared terpasang; satu hostname uji
  atas izin pemilik, record dihapus setelahnya). Tanpa bukti sebelum G2 dimulai → bagian B pindah ke §13.

---

## 7. Pertanyaan terbuka revisi 1 (sudah diputuskan)

| #   | Keputusan                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------ |
| Q1  | D1 dibatalkan untuk blok bertanda + run script (DECISIONS C1)                                                            |
| Q2  | Blok di akhir file                                                                                                       |
| Q3  | Sinkron + audit (F5)                                                                                                     |
| Q4  | Berlaku saat start berikutnya; restart opt-in dan dicek (DECISIONS C3, F10)                                              |
| Q5  | Penjaga hanya bila tidak ada app tangan (DECISIONS C4)                                                                   |
| Q6  | Template dan `server-termux` tidak diubah di 0.4.0 (§13)                                                                 |
| Q7  | `<dataDir>/fix-backups`, 10 per file, **tidak ikut cadangan** `panel`/R2 karena bisa memuat `env` rahasia (DECISIONS C5) |
| Q8  | Admin, diaudit (DECISIONS C6)                                                                                            |
| Q9  | DNS lewat `cert.pem`: bersyarat G0, tanpa migrasi (§6.4)                                                                 |
| Q10 | P2 ke backlog (DECISIONS C2)                                                                                             |
| Q11 | Rilis 0.4.0 (DECISIONS C7)                                                                                               |

---

## 8. Mode fake dan data demo (QA wajib bisa menguji)

- `FAKE_SCENARIO_FILE` (`.panel-fake.json`) += `integration?: "ready" | "poco" | "old_spread" | "exotic" | "broken" |
  "no_sites_dir"`. `seedSandbox` menulis fixture yang sesuai (ditandai `// test-only`) saat sandbox dibuat; default
  tetap `ready`. `poco` = salinan struktur ecosystem POCO (factory `site()`, objek literal, komentar; path diarahkan ke
  sandbox, binary `grun`/`php` palsu) + run script pm2 tanpa flag. Teks skenario ada di
  `src/server/system/fake.integration.ts`.
- Pending: fake `supervise("pm2")` memberi uptime yang bisa diatur dan fake menulis run script dengan `mtime` nyata,
  sehingga `pending` teruji (tulis flag → `pending` → restart yang dicek → ok). Tidak ada `RunitAdapter.cmdline`.
- Fake pm2 bisa diset agar satu app tidak kembali setelah restart (menguji `restartCheckFailed` + restore).
- Fake `control(start)` menghapus file `down` sandbox seperti termux.
- `scripts/demo-seed.ts` menerima `--integration poco` untuk QA browser.
- Probe di fake memakai `node` host (sudah begitu). Gerbang F12 tidak berlaku di fake.

## 9. Test (bun test, `tests/`)

| File                                                                                | Pemilik  | Isi (assertion nyata)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/site.files.test.ts`                                                          | core     | Spy: `fsyncSync(fd)` dipanggil sebelum `renameSync`, lalu fsync direktori; mode dijaga; `readBytesOrNull` mengembalikan `Buffer` tanpa U+FFFD                                                                                                                                                                                                                                                                                                                           |
| `tests/ecosystem.patch.test.ts`                                                     | core     | Fixture `tests/fixtures/ecosystem/{poco,template,old-spread,old-spread-x2,marked-v0,marked-current,markers-broken,array-export,dynamic-require,exports-function,bom,crlf,latin1,frozen-apps}.config.js`: kind + reason per fixture; POCO → kandidat = byte asli + blok; `bom` tetap berawalan BOM; `crlf` → blok ber-`\r\n`; `latin1` → `not_utf8`; dua kali = `unchanged`; old spread hilang; `changes[]` menunjuk baris benar; prefix disisipkan via `JSON.stringify` |
| `tests/ecosystem.probe.test.ts` (baru)                                              | core     | Sentinel dibuang dari `names`/`envKeys`/`digests`; `spreads` true dengan `apps.json = []` bila spread/blok ada; file dengan `panelApps` tanpa spread di `apps` → `spreads` false; `frozen-apps` + blok → probe ok, `block` null; digest stabil terhadap urutan kunci; nilai `env` tidak muncul di stdout                                                                                                                                                                |
| `tests/ecosystem.snippet.test.ts`                                                   | core     | Diganti: menguji `ecosystemBlock()` (teks persis, EOL) dan `snippetCurrent` (penanda + `legacyCurrent`)                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/runscript.patch.test.ts`                                                     | core     | Run POCO → flag tepat setelah `pm2-runtime`; template → `unchanged`; flag hanya di komentar → patch; dua baris → `run_script_unknown`; `pm2-runtime start` → `run_script_unknown`; shebang bash → validasi `bash -n`; sintaks gagal → tidak ditulis; mode 0755                                                                                                                                                                                                          |
| `tests/fix.backup.test.ts` (baru)                                                   | core     | Nama + id; retensi 10; resolve id: `../`, `%2F`, id tidak ada → null; file 600, folder 700                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/system.fake.test.ts`                                                         | adapters | Skenario `poco`/`old_spread`/`exotic`/`broken`/`no_sites_dir` menulis fixture; uptime pm2 bisa diatur; `control(start)` menghapus `down`; app "tidak kembali"                                                                                                                                                                                                                                                                                                           |
| `tests/demo-seed.test.ts`                                                           | adapters | `--integration poco` menghasilkan sandbox skenario `poco`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tests/panel.api.test.ts`                                                           | adapters | `start` pm2 menghapus `down` lalu up; audit `service.start`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tests/web.service-start.test.ts` (baru)                                            | adapters | Tombol memanggil endpoint start; sukses → toast + `onStarted`; error → pesan kode                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/ecosystem.fix.test.ts` (baru)                                                | service  | Temp dir + fake + node: apply POCO → file baru, mode dijaga, backup ada, digest app tangan sama; `exports-function` → `validation_failed`, file asli byte-identik; sha berubah → `changed`/`changed_during_fix`; ENOSPC disuntik → 507 `disk_full`, file utuh; symlink ke luar `sites.dir` dan hardlink → `ecosystem_linked`; kandidat yatim dihapus saat boot; restore + `changed_since` + `force`; gerbang termux → `not_verified`                                    |
| `tests/integration.fix.api.test.ts` (baru)                                          | service  | Peran `user` 403; tanpa header CSRF 403; preview tidak menulis; apply → 200 + audit `integration.fix` tanpa isi file; job/cadangan berjalan → 409 `busy`; restore id traversal → 404; restart dicek: semua kembali → ok; satu app hilang setelah fix → `missing` + `offerRestore`; restore `{restart:true}` → `FixResult.restart`                                                                                                                                       |
| `tests/site.integration.test.ts`                                                    | service  | `snippet_current` moot tanpa sebutan apps.json (bug POCO); `legacyCurrent` ok; `pm2_auto_exit` pending via mtime/uptime = ok + `params.pending`; `pm2_guard` tidak disembunyikan oleh flag (C15); `noSites` saat `apps.json` kosong; `fixes[]` dan `lastFix` per skenario; `appNames` memuat app panel runnable                                                                                                                                                         |
| `tests/web.site.test.ts`                                                            | web      | Kartu `poco`: tombol "Perbaiki semua (2)", tanpa tombol per baris; dialog menyebut app yang dipertahankan; fix tidak tersedia → `<details>` manual terbuka + alasan; toast `validation_failed` "Tidak diterapkan" tone warning; dialog undo menyebut situs dan tier `confirm`; restart gagal → tombol restoreAndRestart; kamus `setup.*` lengkap (`satisfies`)                                                                                                          |
| `tests/deploy.restart.test.ts` (baru)                                               | p1       | Adopsi tidak dikenal pm2 → `startFromEcosystem`; entri hilang → `app_not_in_ecosystem`                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/dns.route.test.ts` (baru, bila #12B)                                         | p1       | Token kosong + `cert.pem` → `routeDns`; FQDN cocok → `dns_routed`, `dnsManaged` false; FQDN lain → `dns_wrong_zone`; tanpa cert → kartu manual                                                                                                                                                                                                                                                                                                                          |
| `tests/web.site-detail.test.ts`, `tests/web.job.test.ts`, `tests/web.panel.test.ts` | p1       | Tombol **Jalankan lagi** dan `ServiceStartButton` muncul di lokasi §6.1/§6.3; tidak ada teks `sv up` di luar kunci `manual`; kartu DNS manual menampilkan record siap salin                                                                                                                                                                                                                                                                                             |

## 10. Kriteria penerimaan

1. Di fake skenario `poco`: kartu Persiapan menampilkan 1 error (`ecosystem_spreads_apps_json`) + 1 warning
   (`pm2_auto_exit`), tombol **Perbaiki semua (2)**; satu klik + **Terapkan** → kartu menjadi satu baris "pm2 siap"
   (pending = ok + info), tanpa membuka Termux.
2. Isi ecosystem hasil: byte asli identik sampai byte terakhirnya, lalu blok v1. Mode file tetap. pm2 (fake) tidak
   menerima satu pun `restart/stop/delete/start` selama fix.
3. Menjalankan fix kedua kali: `unchanged`, file tidak ditulis (mtime tetap).
4. **Batalkan perubahan** dari baris "Perubahan terakhir" mengembalikan file byte-identik; check kembali error; dialog
   menyebut situs dikelola yang terdampak dan memakai tier `confirm` bila ada.
5. Fixture eksotis (`latin1`, `dynamic-require`, `markers-broken`, symlink/hardlink): tidak ada penulisan, baris
   menampilkan alasan awam + "Cara manual" terbuka. `bom` dan `crlf` berhasil di-patch tanpa merusak byte asli.
6. Validasi gagal yang dipaksa: file asli utuh, toast "Tidak diterapkan" tone warning, audit `outcome: validation_failed`.
7. `pm2_auto_exit`: setelah fix → ok + "Aktif setelah HP atau pm2 dimulai ulang"; **Mulai ulang pm2 sekarang** meminta
   konfirmasi yang menyebut semua app dan perubahan ecosystem; sesudahnya ok. Di fake dengan app yang tidak kembali:
   hasil menyebut app itu + tombol **Kembalikan file ecosystem dan mulai ulang pm2**.
8. Tidak ada lagi "Jalankan `sv up pm2`/`sv up postgres` di HP" di `src/web/i18n` kecuali kunci `manual`. "lewat ssh"
   hilang dari pesan item P1. Pengecualian yang tetap (item backlog): `apps_json_invalid` (#7), `no_folder` (#13),
   rute tulisan tangan (#19).
9. Semua aksi tercatat di audit dengan aktor; tidak ada isi file, nilai env, atau kunci di log/audit (Rule 12).
10. Test spy fsync lulus; `writeAtomic` dipakai juga untuk `config.yml` (`site.steps.ts`).
11. **Lab E11 lulus sebelum `ECOSYSTEM_FIX_ON_TERMUX = true`** (hasil di `PLAN/debate/03-pm2-lab-results.md`). Bila
    belum lulus saat rilis, 0.4.0 tetap dirilis dengan fix ecosystem `not_verified` di termux; fix run script tetap aktif.
12. Uji manual di POCO **hanya atas izin pemilik**: fix ecosystem + run script, `pm2 list` tidak berubah (pid
    makuro-solusi & adminneo sama); reboot test terpisah atas izin.

## 11. Rencana kerja (worker, kepemilikan file eksklusif)

Aturan: tiap file punya satu pemilik di seluruh rencana kecuali disebut berurutan; worker dilarang menyentuh file worker
lain, dilarang commit/push/ganti branch. Kontrak §5.1 ditulis `wkr-fix-core-01` sebagai langkah pertamanya.

**Gerbang G0 (sebelum G1, tanpa kode, dikerjakan koordinator/pemilik):** verifikasi format output `cloudflared tunnel
route dns` dan URL templat token Cloudflare di POCO (Rule 20, §6.4). Hasil menentukan apakah `routeDns` (adapters) dan
§6.4 B (p1) ikut dikerjakan.

**Lab E11 (paralel, di luar tabel):** worker lab terpisah menjalankan E11 di runtime pm2 lab terisolasi (A12, PM2_HOME
terpisah) dengan varian (a)–(d) debat C4 dan menambahkan hasilnya ke `PLAN/debate/03-pm2-lab-results.md`. Hanya
koordinator yang membalik `ECOSYSTEM_FIX_ON_TERMUX` setelah membaca hasilnya.

| Gelombang | Worker                | File (eksklusif)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Bergantung pada                                  | Test milik worker                                                                                        |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| G1        | `wkr-fix-core-01`     | `src/shared/fix.types.ts` (baru), `src/shared/site.types.ts`, `src/shared/audit.types.ts`, `src/server/sites/site.files.ts` (fsync, `readBytesOrNull`), `src/server/sites/site.steps.ts` (hanya: tulis `config.yml` lewat `writeAtomic`), `src/server/sites/ecosystem.patch.ts` (baru: blok, `planEcosystemFix`, `snippetCurrent`, `ECOSYSTEM_FIX_ON_TERMUX = false`), `src/server/sites/runscript.patch.ts` (baru), `src/server/sites/fix.backup.ts` (baru), `src/server/sites/ecosystem.probe.ts` (sentinel, `spreads`, `block`, `digests`), `tests/fixtures/ecosystem/*` | –                                                | `site.files`, `ecosystem.patch`, `ecosystem.probe`, `ecosystem.snippet`, `runscript.patch`, `fix.backup` |
| G1        | `wkr-fix-adapters-01` | `src/server/system/*` (fake: skenario, uptime, app tidak kembali, `down`; `runit.termux.ts`: start hapus `down`; `cloudflared.termux.ts` + fake: `routeDns` **hanya bila G0 lulus**), `src/server/system/fake.integration.ts` (baru), `src/server/panel/panel.service.ts` (start layanan inti), `src/web/shared/service-start.tsx` (baru), `scripts/demo-seed*.ts`                                                                                                                                                                                                          | –                                                | `system.fake`, `demo-seed`, `panel.api`, `web.service-start`                                             |
| G2        | `wkr-fix-service-01`  | `src/server/sites/integration.fix.ts` (baru: preview/apply/restore/restart dicek/`sites_dir_create`, gerbang F12, pemetaan ENOSPC/EACCES), `src/server/sites/integration.service.ts` (hapus `ECOSYSTEM_SNIPPET` dan aturan moot, `fixes`, `lastFix`, pending, `spreads` sentinel, `appNames`), `src/server/routes/sites.routes.ts`, `src/server/sites/site.service.ts` (wiring), `src/server/boot.ts` (hapus kandidat yatim)                                                                                                                                                | core, adapters                                   | `ecosystem.fix`, `integration.fix.api`, `site.integration`                                               |
| G2        | `wkr-fix-web-01`      | `src/web/site/site.setup.tsx`, `src/web/site/fix.dialog.tsx` (baru), `src/web/site/fix.diff.tsx` (baru), `src/web/site/setup.manual.tsx` (baru), `src/web/site/site.api.ts`, `src/web/site/site.adopt.ts`, `src/web/site/sites.page.tsx` (toast pm2 + `ServiceStartButton`), `src/web/i18n/id.site.ts`, `src/web/i18n/id.dev.setup.ts`, `src/web/dev/audit.describe.ts`                                                                                                                                                                                                     | core (tipe), adapters (`service-start.tsx`)      | `web.site`                                                                                               |
| G2        | `wkr-fix-p1-01`       | `src/server/deploy/deploy.restart.ts`, `src/server/sites/site.steps.ts` (langkah `dns`, §6.4 B, hanya bila G0 lulus; berurutan setelah core), `src/web/site/dns.manual.tsx` (baru), `src/web/site/site-detail.page.tsx`, `src/web/site/site.hostnames.tsx`, `src/web/site/job.failure.tsx`, `src/web/panel/overview.problems.tsx`, `src/shared/problem.copy.ts`, `src/web/i18n/id.site-detail.ts`, `src/web/i18n/id.job.ts`, `src/web/i18n/id.deploy.ts`, `src/web/i18n/id.panel.ts`, `src/web/i18n/id.overview.ts`                                                         | core, adapters (`service-start.tsx`, `routeDns`) | `deploy.restart`, `dns.route` (bila #12B), `web.site-detail`, `web.job`, `web.panel`                     |
| Akhir     | `wkr-fix-docs-01`     | `README.md` (bagian Integrasi pm2 dan Instal saja), `CHANGELOG.md` `## [0.4.0]`, `package.json` (versi 0.4.0), `docs/content-guide.md` (pola "Cara manual"), `PLAN/DECISIONS.md` (hanya baris status C8 setelah E11)                                                                                                                                                                                                                                                                                                                                                        | semua G2 + hasil E11                             | – (dokumen; verifikasi grep kriteria 8)                                                                  |

Gerbang tiap gelombang (dijalankan koordinator setelah semua worker gelombang itu selesai): `bun test`, `bun run
typecheck`, `bun run lint`, `bun run build`, `bun run bundle:check`. Tambahan:

- **Setelah G1:** fixture `poco` dimuat probe host tanpa error; test spy fsync lulus.
- **Setelah G2:** QA browser fake `poco` (kriteria 1–7) oleh koordinator; grep kriteria 8.
- **Sebelum merge ke `main`:** hasil E11 dibaca; `ECOSYSTEM_FIX_ON_TERMUX` dibalik hanya bila lulus (kriteria 11).

Catatan kepemilikan: `site.steps.ts` dipegang core di G1 (hanya penulisan `config.yml`) lalu p1 di G2 (langkah `dns`),
berurutan. `service-start.tsx` ditulis adapters di G1 dan hanya diimpor di G2. Bila G0 gagal, p1 tetap mengerjakan
#10/#16/#26, #14/#15, dan #12A.

## 12. Risiko

| Risiko                                                                                                                                         | Mitigasi                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| HP mati sebelum data ter-flush ke disk (A9), ecosystem kosong saat boot                                                                        | fsync kandidat, backup, file, dan direktori di `writeAtomic` (debat C1)                            |
| Restart pm2 = pemuatan pertama blok hasil patch                                                                                                | Restart selalu `confirm`, dicek 30 dtk, dan menawarkan "Kembalikan dan mulai ulang" (F10)          |
| Blok mengubah perilaku pm2 saat reboot berikutnya                                                                                              | Gerbang E11 (F12), validasi sentinel + digest, backup + restore, QA reboot di POCO hanya atas izin |
| Pemilik menyunting file bersamaan                                                                                                              | Cek sha sebelum `rename` (`changed_during_fix`) dan sesudahnya (log + audit, tanpa tulis balik)    |
| `node` di HP tidak ada / timeout                                                                                                               | Fix tidak tersedia (`ecosystem_unloadable` via probe), jatuh ke Cara manual                        |
| Kode tangan yang mengekspor fungsi/Promise atau array beku                                                                                     | `listed: false` atau `block` null → `validation_failed` → file tidak disentuh                      |
| File non-UTF-8 rusak saat ditulis ulang                                                                                                        | Baca byte, decode fatal → `not_utf8`                                                               |
| Backup dipulihkan basi terhadap situs baru                                                                                                     | Dialog menyebut situs terdampak, tier `confirm` (debat C9)                                         |
| `route dns` membuat record di zona yang salah                                                                                                  | Guard FQDN persis + `dns_wrong_zone`; bagian B hanya setelah G0                                    |
| Anggaran bundle `/panel`                                                                                                                       | Dialog dan diff lazy-load                                                                          |
| `/data` POCO = f2fs `fsync_mode=nobarrier` (E11): `fsync` menjaga urutan tulis, tetapi tidak menjamin data selamat bila listrik putus mendadak | Backup bertanggal + validasi sentinel/digest saat boot (C1, F10); bila gagal, pulihkan dari backup |

## 13. Backlog (tidak masuk 0.4.0, DECISIONS C2)

Setiap item butuh PLAN atau setidaknya spec terpisah sebelum dikerjakan. Desain ringkas revisi 1 ada di git history file
ini (commit `2e295ff`).

| #       | Item                                                                           | Alasan ditunda                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7      | Fix `apps_json_rebuild`                                                        | `apps.json` hanya rusak bila disunting tangan (panel selalu menulis atomik); blok sudah tahan file rusak (E5). Tambahkan bila muncul di produksi                                                                                                               |
| #13     | Job `site.repair` (pulihkan folder situs)                                      | Job baru dengan `ALTER ROLE` irreversible untuk kasus langka (folder dihapus di luar panel). "Hapus situs + buat ulang" sudah ada                                                                                                                              |
| #37     | Unggah kunci data lama                                                         | Hanya terjadi setelah pindah HP atau kunci hilang. Mengubah PLAN/04 K8, jadi butuh keputusan baru. Bila dikerjakan, wajib debat C7 (409 `not_mismatch`, parser file unduhan, `key_partial`, copy "Semua orang perlu masuk lagi"). Kandidat terdepan berikutnya |
| #12B    | `route dns` lewat `cert.pem`                                                   | Hanya bila gerbang G0 gagal (format output cloudflared belum terverifikasi)                                                                                                                                                                                    |
| –       | Template `deploy/pm2/ecosystem.config.js` dan `server-termux` ke blok bertanda | Template 0.3.0 dikenali `legacyCurrent`; `server-termux` butuh izin pemilik (B24). Ubah saat versi blok naik                                                                                                                                                   |
| #8      | Fix `ecosystem_create` (tulis template bila file tidak ada)                    | Tidak terjadi di HP yang sudah memakai pm2; installer sudah menyalin template                                                                                                                                                                                  |
| #9      | Pulihkan versi ecosystem terakhir yang berfungsi                               | Memakai endpoint restore P0, jadi nanti cukup UI kecil; tunggu kebutuhan nyata                                                                                                                                                                                 |
| #11     | Tulis `config.yml` cloudflared minimal                                         | Kasus langka (kredensial ada, config tidak); butuh validasi `ingress validate` di HP                                                                                                                                                                           |
| #17     | **Coba hapus lagi** untuk `dns_delete_failed`                                  | Jarang; job `hostname.remove` bisa diulang dari UI yang ada                                                                                                                                                                                                    |
| #18     | Ambil alih record DNS asing                                                    | Menyentuh record milik pengguna; butuh keputusan pemilik dan tier `typed`                                                                                                                                                                                      |
| #19     | Hapus rute tulisan tangan                                                      | Menyentuh config milik pengguna dan memutus domain lain; butuh keputusan pemilik                                                                                                                                                                               |
| #20     | Ambil alih situs adopsi ke panel                                               | Mengedit entri tangan di ecosystem di luar blok; melanggar batas F1                                                                                                                                                                                            |
| #27     | Detail `host_rebooted` dari status layanan                                     | Perbaikan teks/tampilan, bukan alur buntu; tidak memblokir pengguna                                                                                                                                                                                            |
| #28     | Detail teknis `system_error`                                                   | Sama dengan #27                                                                                                                                                                                                                                                |
| #31/#32 | Empty state Aplikasi/Domain dengan aksi utama                                  | Polesan UX, bukan langkah manual wajib                                                                                                                                                                                                                         |
| #33     | Pasang paket termux-api dari panel                                             | Butuh job instal paket dengan log; juga butuh aplikasi Termux:API dari F-Droid yang tetap manual                                                                                                                                                               |
| #38     | Perintah `scp` kunci data ke Cara manual                                       | Terkait #37; dikerjakan bersama                                                                                                                                                                                                                                |
| #39/#40 | Pasang Cloudflare Access lewat API                                             | Fitur produk utuh; endpoint API perlu verifikasi; butuh PLAN dan debat sendiri                                                                                                                                                                                 |
| #41     | Tautan bantuan token/bucket                                                    | Format URL templat perlu verifikasi; nilai kecil                                                                                                                                                                                                               |
| #43     | **Hubungkan akun Cloudflare** (`tunnel login` dari panel)                      | Proses interaktif dengan URL otorisasi dan cert multi-zona; butuh desain sendiri                                                                                                                                                                               |
| #45/#54 | Pulihkan dari cadangan (HP sama / HP baru)                                     | Fitur produk utuh, menyentuh `panel.db` saat restart; butuh PLAN sendiri                                                                                                                                                                                       |
| #46     | Nonaktifkan HP ini                                                             | Aksi terakhir yang memutus panel; butuh PLAN dan tier `typed`                                                                                                                                                                                                  |
| #47/#48 | Perbarui panel / kembalikan versi sebelumnya                                   | Fitur produk utuh (unduh rilis, proses terlepas, rollback); butuh PLAN dan debat sendiri                                                                                                                                                                       |
| #51–#53 | Installer interaktif (`.env`, ingress panel, nodejs+pm2)                       | Di luar UI panel; menyentuh `install-phone.sh` dan alur rilis                                                                                                                                                                                                  |
