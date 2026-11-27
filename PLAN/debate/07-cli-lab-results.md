# PLAN 07 — hasil lab CLI (L5, L6)

Ditulis `wkr-cli-core-01`, 2026-11-27, gerbang G0. Mac lokal (macOS 24.5, arm64), Bun 1.4.2, SQLite bawaan Bun 3.43.2.
Tanpa Docker (C16). Lab L1–L4, L7, L8 butuh Termux (§14) dan belum dijalankan.

## L5 — isolasi `import()` dengan build nyata (D13): **LULUS**

**Cara.** Salinan working tree (tanpa `.git`, `node_modules` di-symlink) di scratchpad. Dua modul penanda ditambahkan
hanya di salinan: baris pertama `src/server/boot.ts` menulis `BOOT_EVAL` ke stderr, baris pertama
`src/server/log.service.ts` menulis `LOG_EVAL` (log.service = modul server dengan efek samping ring buffer yang dimuat
hampir semua modul server). Build dengan `bun scripts/build.ts local <out>` (konfigurasi repo apa adanya: entry
`src/server/main.ts`, `splitting: true`, plugin tailwind, `minify`, loader `.sql`, `compile`). Binary 65,5 MB, build
0,9 dtk. Setiap perintah dijalankan dari folder berisi `.env` lengkap (nilai palsu, `PORT=39999`), HOME kosong,
stdin `</dev/null`.

| Perintah             | Exit | Waktu   | `BOOT_EVAL` | `LOG_EVAL` | Catatan                                         |
| -------------------- | ---- | ------- | ----------- | ---------- | ----------------------------------------------- |
| `-v`                 | 0    | 0,022 s | tidak       | tidak      | `panel-termux 0.4.0 (darwin-arm64, bun 1.4.2)`  |
| `--help`             | 0    | 0,022 s | tidak       | tidak      |                                                 |
| `doctor --help`      | 0    | 0,021 s | tidak       | tidak      |                                                 |
| `env`                | 1    | 0,021 s | tidak       | tidak      | placeholder G1a (perintah belum disambung)      |
| `docs`, `docs paket` | 1    | 0,021 s | tidak       | tidak      | placeholder G1a                                 |
| `rollback`           | 1    | 0,021 s | tidak       | tidak      | placeholder G1a                                 |
| `--bogus`            | 2    | 0,021 s | tidak       | tidak      |                                                 |
| `serve`              | –    | –       | **ya**      | **ya**     | server jalan (dihentikan `timeout 3`, kode 124) |
| tanpa argumen        | –    | –       | **ya**      | **ya**     | stdin bukan TTY → serve (runit, K2)             |

- Run pertama `-v` 0,81 dtk (eksekusi pertama binary baru di macOS); run berikutnya 0,021–0,026 dtk.
- Tidak ada file baru di HOME untuk perintah CLI. `data/` dibuat oleh `serve` saja.
- Jadi splitting tidak menarik chunk server ke entry: jalur CLI hanya mengevaluasi `main.ts`, `env.schema.ts`,
  `env.codec.ts`, dan `src/cli/cli.{main,help,output}.ts` + `package.json`.
- Perintah yang memakai `CliHost` (doctor, rollback) memuat `cli.host.ts` → adapter Termux → `log.service` secara
  dinamis; itu memang jalur server (tanpa `log.info` ke stdout karena CLI tidak memanggil pemilih mode server). L5
  untuk `env`/`docs` setelah G1a: dibuktikan ulang oleh `scripts/cli.test.sh` (W2) dan `tests/cli.imports.test.ts`
  (penelusuran impor statis dari `main.ts`).
- Penjaga yang sama di `bun test`: `tests/cli.args.test.ts` menjalankan `runCli` di proses anak dengan plugin
  `--preload` yang menyisipkan penanda ke `boot.ts` (kontrol positif: impor `boot.ts` mencetak penanda).

## L6 — `new Database(f, { readonly: true })` pada `panel.db` WAL (m14): **dicatat, fallback `:memory:` tetap wajib**

**Cara.** Penulis `bun:sqlite` membuat `panel.db` dengan `journal_mode=WAL` dan baris yang masih di `-wal`
(`wal_autocheckpoint=0`). Pembaca membuka dengan `{ readonly: true }`, `SELECT count(*)`, menutup; isi folder dicatat
sebelum/sesudah.

| Kasus                                                  | Hasil                        | File baru?                    |
| ------------------------------------------------------ | ---------------------------- | ----------------------------- |
| (a) panel hidup (koneksi terbuka, `-wal` + `-shm` ada) | terbaca, baris dari WAL ikut | tidak                         |
| (b) panel di-`kill -9`, `-wal` + `-shm` tersisa        | terbaca                      | tidak                         |
| (b) panel mati, `-wal` ada, **`-shm` tidak ada**       | terbaca                      | **ya: `panel.db-shm` dibuat** |
| (b) panel mati bersih, hanya `panel.db` (header WAL)   | **`SQLITE_CANTOPEN`**        | tidak                         |
| sama, folder read-only                                 | `SQLITE_CANTOPEN`            | tidak                         |
| URI `file:…?mode=ro` (kasus `-shm` tidak ada)          | terbaca                      | ya: `-shm` dibuat             |
| URI `file:…?immutable=1` (semua kasus di atas)         | terbaca                      | tidak                         |

Catatan:

- `Database.close()` Bun 1.4.2 tidak menghapus `-wal`/`-shm` di percobaan ini, jadi kondisi "hanya `panel.db`"
  dibuat dengan checkpoint `TRUNCATE` lalu menghapus kedua file (sama dengan penutupan bersih SQLite biasa). Kondisi
  nyata di POCO setelah `sv down panel` belum dilihat (QA §9.3).
- Akibat untuk K12: `readonly` saja **bisa membuat `panel.db-shm`** (file sampingan, bukan `panel.db`) saat panel mati
  dengan `-wal` tanpa `-shm`, dan **gagal** saat hanya ada `panel.db`. Fallback `:memory:` (PLAN K12) menutup kasus
  gagal. Untuk "doctor tidak menulis file apa pun" ada dua pilihan bagi `wkr-cli-doctor-01`/koordinator:
  1. Terima `-shm` sebagai pengecualian yang dicatat (SQLite membuatnya, isinya indeks WAL, aman).
  2. Buka hanya bila `-shm` ada atau `-wal` tidak ada; selain itu langsung `:memory:`. Rekomendasi: **pilihan 2**,
     karena satu `existsSync` dan janji read-only tetap utuh.
     `immutable=1` tidak direkomendasikan: tanpa locking, sehingga bisa membaca halaman yang sedang ditulis panel hidup.
