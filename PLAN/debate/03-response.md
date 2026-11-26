# Respons penulis PLAN 03 terhadap kritik dan hasil lab pm2 POCO

> Penulis: wkr-plan-sites-01 · 2026-11-26. Bahan: `PLAN/debate/03-critique.md` (C1–C23),
> `PLAN/debate/03-pm2-lab-results.md` (E1–E7, pm2 7.1.2 di POCO), `PLAN/debate/00-integration-critique.md`,
> respons PLAN/01/02/04/05, repo `server-termux` (`/Users/bip/test/server-termux`, dibaca saja). Semua perubahan
> sudah dimasukkan ke `PLAN/03-sites-lifecycle.md` (lihat "Riwayat revisi" di sana). Tidak ada kode yang diubah.
>
> Keputusan pemilik yang mengikat dan dipakai di sini: semua fitur tetap di v0.3.0 (tidak ada pemangkasan scope);
> label job/deploy yang gagal lalu dikembalikan = "Dikembalikan" dengan nada **warning**; beranda super_admin =
> Ringkasan; blip cloudflared per perubahan domain dipertahankan tetapi diperkecil (digabung, hanya bila ingress
> berubah) dan dijelaskan di UI; installer boleh membuat template ecosystem + run script pm2 di HP **baru**.

## Ringkasan

| Verdict         | Jumlah | Temuan                                                                                                                                               |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TERIMA          | 18     | C1–C5, C7, C8, C10–C18, C20, C21                                                                                                                     |
| TERIMA SEBAGIAN | 5      | C6, C9, C19, C22, C23                                                                                                                                |
| TOLAK           | 0      | (butir yang ditolak ada di dalam temuan sebagian: `run.prev` di C6, tanpa baca pm2 di jendela stabil di C9, buang E7 di C19, batas < 120 dtk di C22) |

Total 23 temuan. "Pemangkasan" di C20/C22/C23 hanya diterima
bila itu penyederhanaan implementasi, bukan pengurangan fitur (keputusan pemilik). Semua fitur yang tercantum di PLAN
tetap ada.

---

## Temuan per temuan

### C1 · BLOCKER · sha akhir unggahan tidak diketahui saat job dimulai — **TERIMA**

Bukti: `deploy.service.ts:97-109` menyisipkan baris `deploy` sebelum langkah pertama, dan `deploy.schema.ts:17`
mewajibkan `sha256`.

Perubahan:

- Potongan ditulis langsung ke satu file `<data>/uploads/<id>/upload.bin` pada offset `index × chunkSize` (`pwrite`).
  Ini usulan opsional C20 yang ikut diterima karena menyederhanakan C1 dan C11.
- `POST /uploads/:id/complete` membaca `upload.bin` secara streaming sekali (±1–2 dtk untuk 89 MB di HP). Selama
  membaca, server memverifikasi sha tiap potongan terhadap meta, menghitung sha seluruh file, lalu menulis
  `state: "assembling"` ke meta. Setelah itu baru `jobs.start`: sha disimpan di `job.input.sha256` dan di baris
  `deploy` **sebelum** langkah pertama.
- Langkah `assemble` menjadi `stage`: `rename(upload.bin → <site>/app.new)`. Bila `EXDEV` (beda filesystem),
  server menyalin sambil menghitung ulang sha lalu membandingkannya.
- Aturan tertulis di D12: **sha tersimpan permanen sebelum langkah `swap`**.

### C2 · BLOCKER · cleanup tidak memodelkan crash di tengah swap — **TERIMA**

Bukti: `deploy.steps.ts:118-120` (3 rename) dan `:135-139` (`.app.swap`).

Perubahan:

1. Urutan swap baru menjaga `app` **selalu ada**:
   - deploy: `app.prev → .app.prev.drop` (bila ada) → `link(app, app.prev)` (hardlink; fallback `copyFile` bila
     `link` ditolak) → `rename(app.new, app)`. Yang terakhir mengganti `app` secara atomik.
   - rollback: `link(app, .app.swap)` → `rename(app.prev, app)` → `rename(.app.swap, app.prev)`.
2. §4.11 diganti tabel keadaan berdasarkan keberadaan `(app, app.prev, .app.prev.drop, .app.swap, app.new)`, inode
   `app == app.prev`, dan sha dari `job.input` (`sha256`, `fromSha256`; null = deploy pertama). Aturan pertama: bila
   `app` hilang tetapi `app.prev` atau `.app.swap` ada, `app` dipulihkan dulu. Entri pm2 hanya dihapus bila tidak ada
   binary sama sekali **dan** `fromSha256 = null`.
3. Redeploy dengan sha sama: ambiguitas swapped/belum tidak berbahaya karena isinya identik. Tabel memakai inode untuk
   membedakannya, dan hasil keduanya sama.
4. Uji wajib: crash diinjeksi di setiap titik di antara operasi (3 untuk deploy, 3 untuk rollback), lalu cleanup,
   lalu dicek bahwa `app` ada dan isinya = keadaan sebelum perubahan.
5. Hardlink di `/data/data/com.termux` belum diuji. Ditambahkan **E9** (cek `ln` 1 menit di POCO). Hasil apa pun
   tidak mengubah desain karena ada fallback `copyFile` (biaya 89 MB tulis).

### C3 · BLOCKER · cek dan filter "binary ada" salah untuk entri grun — **TERIMA** (bentuk lain melalui C6)

Bukti kritik dikonfirmasi lab E1f: entri `script: $PREFIX/bin/grun` dengan `./app` hilang hanya crash-loop dirinya,
sedangkan entri native dengan script hilang merobohkan semua app (E1, ±54 restart runtime/menit).

Perubahan:

- Entri `apps.json` panel tidak pernah lagi memakai `script: grun`. Semua memakai `script: "./run"` (C6), sehingga
  bentuk entri panel hanya satu.
- Snippet memakai filter `existsSync(path.resolve(a.cwd || __dirname, a.script || ""))`. `path.resolve` menangani
  `script` absolut dengan benar, berbeda dengan `path.join` yang disebut kritik. Filter ini **wajib** (E1e lulus di
  pm2 7.1.2).
- Panel menjamin `run` hanya ada bila `app` ada: `run` ditulis setelah `app` ada, dan dihapus sebelum `app`.
- Fungsi server `entryBinary(entry)` untuk cek `apps_entries_runnable`: entri panel (`script === "./run"`) →
  `<cwd>/run` dan `<cwd>/app`; entri lain → `basename(script) ∈ {grun, glibc-runner}` ? `resolve(cwd, args[0])` :
  `resolve(cwd, script)`.
- Uji snippet ditambah: entri native hilang, entri `./run` tanpa `run`, entri grun lama dengan `./app` hilang (tidak
  difilter, karena hanya crash-loop dirinya; cek server melaporkannya sebagai warning).

### C4 · BLOCKER · pm2-runtime tidak hidup, deploy pertama memunculkan daemon liar — **TERIMA**

Bukti: lab E4. Ecosystem tanpa app saat start membuat runtime keluar seketika, **juga dengan `--no-auto-exit`**
(13 start/20 dtk). `--no-auto-exit` menahan kasus "app terakhir dihapus". Template `server-termux` sekarang
(`files/sites/ecosystem.config.js`) berisi `apps: []` dan run script-nya (`files/sv/pm2/run`) memakai
`--no-auto-exit`. Akibatnya HP baru dari `server-termux` masuk loop restart sampai situs pertama ada.

Perubahan:

- Adapter kanonik (`wkr-adapters-01`, PLAN/02 respons C6): `Pm2UnavailableError(reason)` bila layanan runit `pm2`
  tidak `run`, **tanpa** memanggil CLI pm2. `startFromEcosystem`, `control`, dan `remove` juga memakai cek ini.
  Panel tidak pernah menyalakan daemon.
- Langkah `app_restart` menangkap error itu → kode `pm2_not_running`. Cek integrasi baru `pm2_runtime` (ok bila
  layanan `pm2` `run` dan `rpc.sock` ada) masuk ke `ready`.
- Cek integrasi `pm2_auto_exit` (warning): run script `$SVDIR/pm2/run` tidak memuat `--no-auto-exit`. POCO hari ini
  tidak memakainya; aman selama ada makuro-solusi/adminneo.
- Cek `pm2_guard` (warning): ecosystem tidak punya app selain milik panel (`names − apps.json names` kosong). Teksnya
  menyarankan app penjaga.
- Spec perubahan `server-termux` (template + penjaga `pm2-guard`) dan spec `install-phone.sh` untuk PLAN/05 ada di
  bagian "Spec installer" di bawah dan di PLAN §7.
- Peringatan `pm2_last_app` di dialog hapus situs dan undo deploy pertama: hanya tampil bila `pm2_guard` dan
  `pm2_auto_exit` sama-sama warning. Dengan penjaga atau flag, kasus ini tidak terjadi.

### C5 · MAJOR · janji ke PLAN/04 dan PLAN/05 tidak ada di PLAN tujuan — **TERIMA**

Perubahan di §7 dependensi, ditulis sebagai permintaan bernama dengan file:

- PLAN/04 (`wkr-backup-engine-02`): pengecualian `*/app`, `*/app.prev`, `*/app.new`, `*/.app.prev.drop`,
  `*/.app.swap`, `*/.env.panel-prev`, `*/run.panel-tmp` dan folder `uploads/` panel. Fungsi `lastGoodItem` (nama
  X27 dari integrasi) dipakai untuk "cadangan terakhir database X"; PLAN/03 tidak membuat nama sendiri.
- PLAN/05 (`wkr-dist-01`, pemilik `install-phone.sh`): `sv -w 130 restart panel` satu kali tanpa loop, plus pesan
  jujur. Spec lengkap di bawah.
- Bila salah satunya tidak disepakati, dialog hapus situs memakai teks tanpa info cadangan (fallback tertulis).

### C6 · MAJOR/OVER · delete+start saat runtime berubah — **TERIMA SEBAGIAN**

Diterima: entri `apps.json` dibuat tetap, `{ script: "./run", interpreter: "none" }`. `run` adalah skrip sh yang
ditulis panel:

```sh
#!/data/data/com.termux/files/usr/bin/sh
# Ditulis Panel Termux. Runtime: native. Jangan diedit; deploy berikutnya menimpanya.
exec ./app
```

(varian glibc: `exec /data/data/com.termux/files/usr/bin/grun ./app`). Karena `exec`, pid dan sinyal tetap milik
app. Deploy, rollback, dan restart cukup memakai `pm2 restart <nama>`. Hanya deploy pertama yang memakai
`pm2 start ecosystem.config.js --only <nama>` (E2: masuk daemon yang sama dan kembali setelah runtime restart).
Langkah `apps_entry`/`setAppRuntime`/`appsChanged`/cabang reload dihapus. Lab E3 (script lama dipakai ulang) tidak
lagi relevan untuk entri panel.

Tidak diterima: `run.prev` ikut di-swap. Isi `run` **diturunkan** dari ELF `app` (`detectRuntime`), sehingga cukup
ditulis ulang secara atomik di langkah baru `run_script` setelah swap dan saat cleanup. Itu lebih sedikit file dan
tidak ada keadaan `run`/`app` yang tidak cocok setelah cleanup.

Migrasi entri lama (hanya di dev/fake; produksi belum punya situs dikelola): deploy pertama setelah upgrade yang
menemukan entri dengan `script ≠ "./run"` menulis ulang entri dan menjalankan delete+start sekali (kode
`apps_migrated`). Ini satu-satunya delete+start yang tersisa. Jedanya di bawah ambang auto-exit E4, dan penjaga
menutup sisanya.

### C7 · MAJOR · aturan `$`/kutip Bun di editor env dan tempel `.env` — **TERIMA**

Perubahan:

- `src/shared/env.codec.ts` (baru) berisi `decodeEnvValue(raw)` dengan aturan Bun 1.4.2: `$NAME` diekspansi di
  semua bentuk kutip, `\$` literal, kutip ganda tanpa unescape `\"`, `\n` di kutip ganda = baris baru, komentar inline
  ` #` pada nilai tanpa kutip. Dipakai bersama oleh parser tempel (web), redaksi log (server), dan `readEnvPort`.
- Parser tempel menandai baris yang memuat `$` tanpa `\`: "Bun membaca `$NAMA` sebagai variabel. Panel menyimpan
  nilainya apa adanya, jadi aplikasimu akan melihat `$` secara literal."
- `envLine`: nilai yang memuat `'` tetapi tidak memuat `"` atau `\` ditulis dalam kutip ganda dengan `$` → `\$`.
  Nilai hanya ditolak bila memuat `'` **dan** (`"` atau `\`), dengan `reason: "quote"`.
- `tests/site.files.test.ts` ditambah kasus A–J kritik dan dijalankan terhadap `bun` nyata, pola yang sudah ada.

### C8 · MAJOR · `site.env` yang terputus tidak bisa dipulihkan — **TERIMA**

`env_write` menyalin `.env` ke `.env.panel-prev` (0600) sebelum menulis. Undo dan cleanup mengembalikannya, lalu file
itu dihapus saat job selesai (sukses atau rolled_back). Teks "tidak bisa dipulihkan" dihapus. File ini dikecualikan
dari cadangan (C5) dan tidak pernah dibaca ke klien.

### C9 · MAJOR · semantik cek kesehatan dan biaya pm2 — **TERIMA SEBAGIAN**

Diterima:

- Baseline `restarts` + pid diambil **segera setelah** `app_restart`. Gagal bila `restarts` naik di titik baca mana
  pun.
- pm2 hanya dibaca saat baseline, saat streak tercapai, setelah jendela stabil 5 dtk, dan tiap 10 dtk untuk
  `errored`. Itu sekitar 3–30 spawn node per deploy, bukan 20–100.
- `expect: "lt500" | "2xx3xx"` menggantikan angka bebas. Ini penyederhanaan implementasi; fitur "status yang
  diharapkan" tetap ada.
- Probe mengirim `Host: <domain utama>`.

Ditambah dari lab E3: status pm2 `online` tidak dipercaya sendirian. Sehat mensyaratkan `pid` angka > 0 yang
**sama** di semua titik baca (pid berubah = restart) dan port yang menjawab.

Tidak diterima: menghapus pembacaan pm2 di jendela stabil. Tanpa pembacaan kedua, crash-loop dengan backoff pm2 ≥ 5
dtk lolos.

Catatan teknis: Bun `fetch` dengan header `Host` belum diverifikasi. Kriteria penerimaan menguji bahwa server lokal
uji menerima `Host` yang dikirim. Bila Bun mengabaikannya, implementasi memakai `node:http` `request({ host:
"127.0.0.1", headers: { host } })`.

### C10 · MAJOR · urutan DNS/ingress dan blip ganda — **TERIMA** (+ keputusan pemilik: blip diperkecil)

Perubahan:

- `site.delete` dan `hostname.remove`: `ingress → tunnel_restart → dns`. Langkah `dns` saat menghapus **non-fatal**:
  gagal → `dns_left {hostname}` (selesai, nada warning, tautan ke dasbor Cloudflare). Tidak ada undo ingress dan
  tidak ada restart kedua.
- Pembuatan tetap `dns → tunnel_restart`, jadi kegagalan DNS terjadi sebelum restart.
- Blip diperkecil:
  - `POST /sites/:name/hostnames` menerima `{ hostnames: string[] }` (1–5) dalam satu job dengan satu restart.
  - Wizard boleh menambah domain tambahan (`extraHostnames`, maks 4) dalam satu `site.create`.
  - Restart hanya bila teks ingress berubah (sudah ada).
- UI menyebut dampaknya dengan nama, di wizard, dialog domain, dan dialog hapus: "cloudflared dimulai ulang sekali.
  Semua domain di HP ini terputus 3–10 dtk, termasuk solusi.malikkurosaki.com dan panel ini."
- Dua replika cloudflared tercatat P2 (di luar v0.3.0 karena bukan fitur yang ada di PLAN).

### C11 · MAJOR · protokol unggahan yang dipersist kurang detail — **TERIMA**

Aturan tertulis (§3.2/§4.6), dibantu `pwrite` (C1):

- `meta.json` = `{ v:1, site, fileName, sizeBytes, chunks, chunkSha: Record<index, sha>, state: "receiving" |
  "assembling", createdAt, touchedAt }`, ditulis atomik (tmp + rename) **setelah** `pwrite` + `fsync` potongan
  berhasil.
- Boot: pindai `uploads/*`. Buang dir tanpa meta, meta rusak, kedaluwarsa (> TTL), `state = "assembling"` (job-nya
  sudah ditandai `interrupted`, cleanup tidak memakai unggahan), dan `.tmp` sisa.
- `complete` memverifikasi sha tiap potongan dengan membaca `upload.bin` (C1), jadi potongan yang rusak di flash
  ketahuan sebelum swap → 400 `chunk_corrupt {index}`, dan potongan itu dihapus dari `received` supaya klien
  mengirim ulang.
- `site.delete` membuang unggahan aktif situs itu (langkah `validate`).
- Preflight ruang memakai total ukuran semua unggahan aktif + ukuran baru + 200 MB. Dengan `pwrite` + `rename`,
  kebutuhannya turun dari 2× menjadi 1× ukuran per unggahan.

### C12 · MAJOR · rollback situs adopsi tanpa cek runtime — **TERIMA**

`POST rollback` situs adopsi menjalankan `detectRuntime(app.prev)` dan membandingkannya dengan `scriptRuntime` dari
pm2. Bila beda → 409 `runtime_mismatch {expected, got}`, dengan teks yang sama seperti di unggahan. Situs dikelola
tidak perlu cek ini karena `run` ditulis ulang dari ELF.

### C13 · MAJOR · kepemilikan file bentrok lintas PLAN — **TERIMA**

§7 diselaraskan dengan tabel integrasi:

- Kontrak shared (`site.types.ts`, `deploy.types.ts`, `env.codec.ts`, `ApiError` status/extra) → `wkr-contracts-00`
  (W0).
- Migrasi `0007_sites_lifecycle` → `wkr-db-01` (W1).
- Adapter → `wkr-adapters-01` (W1).
- `http.error.ts` → W0 kontrak (status kanonik `400|401|403|404|409|410|421|429|502|503|507` + `extra`).
- `index.ts`/`boot.ts` → worker boot (hook `ensureAppsJson()` diekspor `wkr-sites-server-02`).
- `shutdown.ts` → `wkr-sites-runner-01` saja. PLAN/02 menyerahkan idle-nya lewat daftar `idle[]` di boot.
- `tests/site.harness.ts` → `wkr-sites-runner-01` (W1), dipakai W2.
- Merge `main` (hotfix CSRF) → prasyarat W0 milik orkestrator.

### C14 · MAJOR · probe ecosystem mewarisi env panel — **TERIMA**

Probe dijalankan dengan env minimal `{ PATH, HOME, PREFIX, PM2_HOME, LANG }`, sama seperti yang dilihat pm2 dari run
script. `detail` stderr melewati redaktor PLAN/02 (`src/server/system/log.redact.ts`) dan dipotong 300 karakter.
Probe juga mengembalikan **nama kunci** `env` per app (tanpa nilai) untuk E6b (lihat bagian lab).

### C15 · MINOR · deteksi `scriptRuntime` grun — **TERIMA**

`{grun, glibc-runner}` (basename, juga setelah `realpath`) → `grun`. `other` hanya peringatan, bukan 409:
"Panel tidak tahu cara pm2 menjalankan binary ini. Cek kesehatan setelah deploy akan menunjukkan hasilnya."

### C16 · MINOR · `job.input` — **TERIMA**

`site.deploy` menyimpan `{ site, sha256, fromSha256, sizeBytes, fileName, runtime, firstDeploy }`; `uploadId` dihapus.
`/recover` mode retry untuk `site.delete` hanya diterima bila langkah `validate` job asli `done`.

### C17 · MINOR · default hapus situs — **TERIMA**

"Simpan database" dicentang otomatis bila database belum pernah dicadangkan atau cadangan terakhirnya > 24 jam.
"Simpan folder dan file situs" dicentang otomatis bila `data/` tidak kosong dan tidak ada cadangan folder situs
< 24 jam (dari `lastGoodItem` PLAN/04). Menghapus berarti mencentang ulang secara sadar. Teks menjelaskan alasan
centang otomatis.

### C18 · MINOR · perilaku pm2 tidak terwakili di fake — **TERIMA**

Fake pm2 (`wkr-adapters-01`) mendapat opsi `runtimeExitsOnMissingNativeScript`, `exitsOnZeroAppsAtStart`,
`supervisorDown`, dan `onlineWithoutPid` (E3). Test: panel menolak `app_restart` saat supervisor mati
(`pm2_not_running`); health gagal saat `online` tanpa pid; entri `./run` tanpa `run` tidak dimuat oleh snippet.

### C19 · MINOR · klarifikasi — **TERIMA SEBAGIAN**

- `PANEL_PORT` → `PORT` (`env.ts:46-47`). TERIMA.
- Teks upgrade jujur bahwa deploy dengan cek kesehatan panjang bisa terputus. TERIMA: §4.12 + spec installer.
- `/sites/:name/uploads/active` → 200 `null` bila tidak ada; 404 hanya untuk situs tidak ada. TERIMA.
- "Buang E7" — **TOLAK sebagian**. Lab membuktikan nama file menentukan perilaku pm2 (`eco2.js` dijalankan sebagai
  skrip). Panel memakai nama tetap `ecosystem.config.js`, jadi tidak perlu cek runtime. Fakta ini tetap dicatat
  sebagai asumsi tertulis (§8.3), karena template installer dan README tidak boleh menamai file lain.

### C20 · OVER · ukuran rencana — **TERIMA** (penyederhanaan implementasi, fitur tetap)

1. `./run` tetap: diterima (C6).
2. Ekor stderr tanpa Map/TTL/endpoint: diterima. Panel "Kenapa gagal" memanggil endpoint log app PLAN/02
   (`GET /panel/apps/:app/log?stream=err&lines=50` → `LogChunk` dengan `LogLine[]`). Redaktor PLAN/02 menerima
   daftar rahasia tambahan per app dari `siteSecretsFor(app)` (nilai `.env` situs yang sudah di-decode, ≥ 6
   karakter). Satu kebijakan redaksi. `AppLogTail`, `GET /jobs/:id/app-log`, `hasAppLog`, dan `log_expired` dihapus.
   Fitur tetap: kotak stderr tampil di halaman progres.
3. Satu endpoint `POST /jobs/:id/recover` (server memilih cleanup/retry dari `kind`): diterima. Teks tombol tetap
   spesifik dari `job.recoverMode` ("Bersihkan" / "Ulangi hapus situs"), karena keduanya berbeda makna bagi pengguna.
4. `binary.hash.ts` diganti `(ino, mtimeMs)` di baris `deploy`: diterima. Lencana "Aktif" = `stat(app)` cocok.
   Binary yang diganti lewat ssh tampil "Versi tanpa catatan". Hardlink (C2) mempertahankan inode `app.prev` = inode
   `app` lama, jadi `previous` tetap dikenali.
5. `expect` dua pilihan (C9) dan tanpa cache DNS 30 dtk: diterima.

### C21 · OVER · kunci per sumber daya — **TERIMA**

Selama ada job, `cloudflared`, `pm2`, `postgres`, dan app pm2 target terkunci. Signature `jobs.isLocked({ kind, name
})` tetap (PLAN/02 sudah memakainya), implementasinya `busy() && set.has(…)`. Dari X23: `database_drop` menolak 409
`busy` bila `backup.running || backup.restoring`.

### C22 · OVER · jadwal retry + cabang offline — **TERIMA SEBAGIAN**

Diterima: backoff eksponensial 1, 2, 4, 8, 16, 30, 30, 30 dtk (total ±121 dtk, lebih lama dari blip cloudflared
≤ 30 dtk + reconnect), lalu "Unggahan terhenti" + **Lanjutkan unggahan**. Cabang `navigator.onLine` dibuang.

Tidak diterima: batas total di bawah 120 dtk. Keputusan pemilik meminta retry lebih lama dari blip restart
cloudflared, dan 120 dtk memberi jarak dua kali lipat.

### C23 · OVER · `apps_entries_runnable` sebagai cek terpisah — **TERIMA SEBAGIAN**

Diterima: dengan filter snippet, entri tanpa binary tidak lagi merobohkan pm2, jadi cek ini menjadi **warning** dan
tidak masuk `ready`.

Tambahan agar aman: filter hanya bekerja bila pemilik menempel snippet versi terbaru. Probe membaca teks ecosystem
dan mencari penanda `existsSync` di blok `panelApps` (cek `snippet_current`). Bila tidak ada:
`snippet_current` = **error** (masuk `ready`), teks "Snippet di ecosystem.config.js versi lama. Ganti dengan blok
terbaru", dan `apps_entries_runnable` naik ke danger.

---

## Penerapan hasil lab pm2 POCO (pm2 7.1.2)

| Lab        | Hasil                                                                                                                                                 | Penerapan di PLAN                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1         | Entri native dengan script hilang → runtime menghentikan semua app dan keluar; ±54 start/mnt; `--no-auto-exit` dan ada tidaknya cwd tidak berpengaruh | D5 wajib. Filter `existsSync(path.resolve(cwd, script))` di snippet **wajib** (§3.6). `run` ditulis setelah `app` dan dihapus sebelum `app`. Cek `snippet_current` error bila filter tidak ada. README memperingatkan                                                       |
| E1e        | Snippet dengan filter: entri hilang dilewati, app lain online                                                                                         | Snippet §3.6 = varian E1e (plus filter `name`). Tabel uji diperbarui                                                                                                                                                                                                        |
| E1f        | Entri grun dengan `./app` hilang → hanya app itu crash-loop                                                                                           | Entri panel tidak memakai grun sebagai script (C6). Cek server untuk entri bentuk lain: warning "crash loop"                                                                                                                                                                |
| E2         | `start --only` dari CLI (dua cara) masuk daemon runtime, kembali setelah restart, tanpa duplikat                                                      | Deploy pertama memakai `pm2 start ecosystem.config.js --only <nama>`. Cek `pm2_home_match` tidak dibuat. Adapter memakai `PM2_HOME` yang sama dengan run script (default `~/.pm2`)                                                                                          |
| E3         | `start --only` pada app yang ada: script lama tetap; pm2 bisa `online` dengan `pid=undefined` dan port mati                                           | Entri panel tidak pernah berubah (`./run`), jadi deploy/rollback = `pm2 restart`. Cek kesehatan mensyaratkan pid valid yang stabil + port menjawab (D16). Fake `onlineWithoutPid`                                                                                           |
| E4         | `--no-auto-exit` menahan runtime setelah semua app dihapus; ecosystem 0 app saat start tetap keluar                                                   | Cek `pm2_auto_exit` (warning) dan `pm2_guard` (warning). Template `server-termux` + installer: app penjaga `pm2-guard` (spec di bawah). Nama `pm2-guard` dicadangkan dan disembunyikan dari daftar Aplikasi (PLAN/02)                                                       |
| E4 catatan | Setelah runtime restart, app ecosystem dimuat lagi; `delete` CLI tidak permanen                                                                       | Hapus situs dikelola: entri `apps.json` dihapus **sebelum** `pm2 delete` (urutan sudah ada). Langkah `app_remove` mencatat bahwa app akan hilang permanen hanya karena entrinya sudah dihapus                                                                               |
| E5         | Snippet lulus 6 keadaan `apps.json` di runtime nyata                                                                                                  | Snippet layak rilis; uji repo `tests/ecosystem.snippet.test.ts` meniru 6 keadaan + filter                                                                                                                                                                                   |
| E6         | Bun (kedua target) membaca `.env` hanya saat start                                                                                                    | `restartPending` dipertahankan                                                                                                                                                                                                                                              |
| E6b        | `env` di entri pm2 mengalahkan `.env`                                                                                                                 | Entri panel tidak lagi menaruh `PORT` di `env` (port hanya di `.env`, dikunci panel), sehingga `.env` satu sumber. Situs adopsi: probe mengembalikan nama kunci `env` per app; editor menandai kunci itu "Diatur oleh pm2 (ecosystem.config.js); nilai di `.env` diabaikan" |
| E7         | Nama tanpa `.config.js` dijalankan sebagai skrip                                                                                                      | Panel selalu memakai `ecosystem.config.js` (nama tetap dari `sites.dir`); asumsi tertulis untuk template/README                                                                                                                                                             |
| Catatan    | pm2 7.1.2 mencetak `PM2 error: getconf …` dan `[pidusage] …` palsu                                                                                    | Permintaan ke PLAN/02 (`log.redact.ts`/aturan masalah): baris ini diabaikan saat menghitung error dan diberi level `debug` di `LogViewer`                                                                                                                                   |

Eksperimen tambahan yang tersisa (murah, gelombang 0, tidak memblokir W1): **E9** `ln` hardlink di
`~/sites/x` (C2; fallback ada); **E10** app penjaga `sleep infinity` di pm2 7.1.2 (RSS, tetap `online`, tidak
dihitung restart); **E4b** apakah modul `pm2-logrotate` menahan runtime saat ecosystem 0 app (bila ya, catat saja;
penjaga tetap dipakai karena modul bisa dihapus).

---

## Spec installer

### `server-termux` (`/Users/bip/test/server-termux`, repo kita; dikerjakan worker terpisah dengan izin pemilik)

1. `files/sites/ecosystem.config.js` diganti template berikut. Hanya ditulis bila file belum ada (`put_once` tetap):

   ```js
   // Daftar app yang dijalankan PM2 di HP ini. Tambah site('<nama>') untuk situs yang kamu tulis sendiri.
   // Situs buatan Panel Termux ada di apps.json dan dimuat otomatis oleh blok panelApps di bawah.
   const SITES = "/data/data/com.termux/files/home/sites";
   const PREFIX = "/data/data/com.termux/files/usr";

   // Binary Bun glibc dijalankan lewat grun; .env di folder situs dibaca binary saat start.
   const site = (name) => ({
     name,
     cwd: `${SITES}/${name}`,
     script: `${PREFIX}/bin/grun`,
     args: "./app",
     interpreter: "none",
     exp_backoff_restart_delay: 1000,
   });

   // Panel Termux: situs buatan panel tercatat di apps.json (dikelola panel, jangan diedit tangan).
   // Aman bila apps.json belum ada, kosong, atau rusak; entri yang binary-nya belum ada dilewati,
   // karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi.
   const panelApps = (() => {
     try {
       const fs = require("fs");
       const path = require("path");
       const list = require("./apps.json");
       return Array.isArray(list)
         ? list.filter((a) => a && typeof a.name === "string" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script || "")))
         : [];
     } catch (e) {
       console.error(`[ecosystem] apps.json dilewati: ${e.message}`);
       return [];
     }
   })();

   // pm2-runtime keluar bila ecosystem tidak punya aplikasi saat start, juga dengan --no-auto-exit.
   // Penjaga ini (sleep, ±1 MB) menahannya hidup di HP yang belum punya situs. Jangan dihapus.
   const guard = {
     name: "pm2-guard",
     script: `${PREFIX}/bin/sleep`,
     args: "infinity",
     interpreter: "none",
     autorestart: true,
   };

   module.exports = {
     apps: [
       guard,
       // site('blog'),
       ...panelApps,
     ],
   };
   ```

2. `files/sites/apps.json` baru, isinya `[]`. Diletakkan dengan `put_once files/sites/apps.json "$HOME/sites/apps.json"`
   di blok `step pm2` (`install.sh:59-62`), tidak pernah ditimpa.
3. `files/sv/pm2/run`: tetap `--no-auto-exit` (sudah ada), ditambah `export PM2_HOME=$HOME/.pm2` sebelum `exec`, agar
   panel dan runit sama-sama memakai `PM2_HOME` eksplisit. Loop pembunuh app yatim tidak diubah.
4. `files/home/sites/README.md`: bagian "Situs buatan panel" (`apps.json`, jangan hapus `pm2-guard`, jangan hapus
   `app` lewat ssh tanpa menghapus situs di panel).
5. `test/install.test.sh` ditambah assert:
   - template memuat `panelApps`, `existsSync`, dan `pm2-guard`;
   - `apps.json` dibuat sekali dan tidak ditimpa (`echo '[{"name":"x"}]' > apps.json`, jalankan ulang, isi sama);
   - bila `node` ada di runner test: `node -e 'console.log(require(process.argv[1]).apps.map(a=>a.name).join())'`
     terhadap template dengan `apps.json` hilang, rusak, dan berisi entri yang script-nya tidak ada → output tepat
     `pm2-guard`.
6. `CHANGELOG.md` `## [0.2.0]`: Added `pm2-guard` + `apps.json` + snippet Panel Termux.
7. Tidak ada perubahan untuk HP yang sudah berjalan (POCO). `put_once` menjamin ecosystem pemilik tidak disentuh.
   Panel menampilkan cek `pm2_guard`/`snippet_current` sebagai panduan.

### `scripts/install-phone.sh` (pemilik PLAN/05 `wkr-dist-01`)

1. Restart panel: `sv -w 130 restart panel` **satu kali** (ganti loop `until sv restart panel` di
   `install-phone.sh:76-79`). Sebelum itu cetak: "Memulai ulang panel. Bila ada perubahan situs yang sedang berjalan,
   panel menunggu sampai 2 menit." Setelah itu `sv status panel` harus `run:`. Kalau tidak, keluar 1 dengan pesan
   "Panel belum berjalan setelah 130 dtk. Lihat $PREFIX/var/log/sv/panel/current." (tanpa menyebut service-daemon).
2. HP baru tanpa setup pm2 (`[ ! -f ~/sites/ecosystem.config.js ] && [ ! -d $SVDIR/pm2 ]`): salin template yang sama
   persis dengan `server-termux` §1–3. Panel repo menyimpan salinannya di `deploy/pm2/{ecosystem.config.js,
   apps.json,run}`, dan CHANGELOG/README menyebut `server-termux` sebagai sumbernya. Lalu `sv up pm2`. Bila salah
   satu sudah ada, jangan menyentuh apa pun dan cetak "pm2 sudah diatur; buka Situs → Persiapan di panel untuk
   memeriksa integrasi."
3. Tidak pernah memanggil `pm2` CLI (bisa menyalakan daemon liar; memory proyek).
4. Test `scripts/install-phone.test.sh`: dua cabang di atas, dan isi `deploy/pm2/ecosystem.config.js` lulus uji `node`
   yang sama seperti `server-termux` §5.

---

## Penyelarasan dengan kontrak kanonik

| Kontrak                         | Bentuk final di PLAN 03                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Adapter                         | Dikerjakan `wkr-adapters-01`: `Pm2Proc` += `cwd`, `execPath`, `args`, `startedAtMs`, `module`; `NetAdapter.httpStatus(port, path = "/", timeoutMs = 5000, host?)` (`host` = tambahan PLAN 03, C9); `Pm2UnavailableError(reason)` saat runit pm2 down; nama `pm2-guard` → `module: true`; fake dengan opsi C18            |
| Kunci & restart                 | `jobs.isLocked({kind, name})`, `jobs.active(): ActiveJob \| null`; runner memanggil `monitor.noteIntentionalRestart({kind:"app", name})` di setiap `app_restart` dan `{kind:"service", name:"cloudflared"}` di `tunnel_restart`                                                                                          |
| Status                          | `src/web/site/job.status-key.ts` dan `src/web/deploy/deploy.status-key.ts` (milik PLAN 03, `satisfies Record<…, StatusKey>`): `running → processing` ("Diproses…"), `succeeded → succeeded`, `failed → failed`, `rolled_back → rolled_back` ("Dikembalikan", warning), `interrupted → interrupted` ("Terputus", warning) |
| Migrasi                         | `drizzle/0007_sites_lifecycle.sql` oleh `wkr-db-01`                                                                                                                                                                                                                                                                      |
| Log                             | `LogLine`/`LogChunk` dari `src/shared/log.types.ts`; kotak stderr memakai endpoint log app PLAN/02                                                                                                                                                                                                                       |
| Konfirmasi                      | `ConfirmAction tier: "confirm" \| "typed"`; aksi tanpa konfirmasi = `Button` biasa                                                                                                                                                                                                                                       |
| `install-phone.sh`              | Milik PLAN/05; spec di atas                                                                                                                                                                                                                                                                                              |
| Beranda super_admin = Ringkasan | Tautan "kembali" dan banner perubahan terputus di Ringkasan memakai `/panel` untuk semua operator                                                                                                                                                                                                                        |
| i18n `id.ts`                    | Tidak disentuh worker halaman PLAN 03 (X17); file baru `id.site.ts`, `id.site-detail.ts`, `id.job.ts`, `id.deploy.ts` digabung oleh shell                                                                                                                                                                                |

## Usulan kontrak baru dari PLAN 03 (untuk arbitrase)

1. `NetAdapter.httpStatus` mendapat argumen opsional keempat `host?: string` (C9).
2. Redaktor PLAN/02 menerima rahasia tambahan per app: `redactLines(lines, extraSecrets: string[])`, dan site service
   mengekspor `siteSecretsFor(app): string[]` (C20.2).
3. `src/shared/env.codec.ts` (`decodeEnvValue`, `encodeEnvLine`) dimiliki `wkr-contracts-00` (C7).
4. Nama app `pm2-guard` dicadangkan: disembunyikan dari Aplikasi, adopsi, dan aturan masalah; nama situs itu ditolak
   `name_taken` (E4).
5. Probe ecosystem mengembalikan `{ loadedAppsJson, names, envKeys: Record<name, string[]>, snippetCurrent }` (C14,
   C23, E6b).
6. `POST /jobs/:id/recover` + `Job.recoverMode: "cleanup" | "retry" | null` menggantikan `/cleanup` dan `/retry`
   (C20.3).
