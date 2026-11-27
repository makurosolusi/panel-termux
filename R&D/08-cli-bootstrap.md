# R&D 08 — CLI di binary dan bootstrap dari Termux kosong

Ditulis `wkr-cli-plan-01`, 2026-11-27, branch `feature/auto-fix`. Sumber: kode repo, `scripts/*.sh`, repo publik
[`makurosolusi/server-termux`](https://github.com/makurosolusi/server-termux) (`install.sh`), POCO dibaca read-only lewat
`ssh poco` (hanya `--help`, `ls`, `dpkg`, `apt-cache`, isi skrip non-rahasia; nilai rahasia tidak dibaca), sumber
`termux/termux-packages` dan `cloudflare/cloudflared@2026.11.2` lewat `gh api`, dan eksperimen binary `bun build
--compile` lokal (Bun 1.4.2). Tidak ada web search. Klaim tentang produk luar yang ditulis dari ingatan ditandai **(perlu
verifikasi)**.

Di tengah riset, `ssh poco` mulai timeout (Tailscale). Hal yang belum sempat dicek di POCO ditandai **(belum dicek di
POCO)**.

## 0. Masukan pemilik

> "project ini harusnya cerdas dapat mendeteksi dan membuatkan / mengisi celah yang belum ada ... aplikasi ini sudah
> cukup mengakomodir dari termux kosong baru pertama diinstall dan ketika menjalankan aplikasi ini maka aplikasi ini
> harus bisa mengecek dan menginstallkan yang perlu diinstall untuk membangun ekosistem dan tempat hidup sebelum dirinya
> sendiri bisa hidup ... kita sudah punya single file binary yang di build dan kita bisa memanfaatkannya contoh
> melengkapinya dengan kemampuan cli --h -h, -v --v, init, docs dan lainnya yang diperlukan untuk setup awal"

Usulan koordinator yang disetujui: `panel` (tanpa argumen = serve, tidak berubah), `-h/--help`, `-v/--version`,
`doctor`, `init`, `docs`, `upgrade`/`rollback`; `install.sh` menjadi bootstrap tipis.

## 1. Ringkasan temuan

1. **Bahaya yang sudah ada sekarang:** binary saat ini mengabaikan argumen. `~/panel/panel --version` yang dijalankan
   di `~/panel` memuat `.env` lalu **menyalakan panel kedua** (snapshot + migrasi `panel.db` + bind port). Dicoba
   lokal: `dist/panel --version` di folder kosong langsung masuk boot dan gagal di validasi env. CLI menutup lubang ini.
2. **Binary hasil `--compile` meneruskan semua argumen ke skrip** (`--help`, `-v`, bahkan `--smol`); `process.argv` =
   `["bun", "/$bunfs/root/<nama>", ...argumen]`, sama posisinya dengan `bun src/server/index.ts ...` (argumen mulai
   indeks 2). `node:util` `parseArgs` jalan di binary; opsi tak dikenal melempar `TypeError` dengan
   `code: "ERR_PARSE_ARGS_UNKNOWN_OPTION"`.
3. **Binary memuat `.env` dari working directory** (default `autoloadDotenv: true`, `bun-types` `CompileBuildOptions`).
   Dicoba: binary yang dijalankan di folder berisi `.env` asing mendapat variabelnya di `process.env`. Jalur serve
   *bergantung* pada ini (run script `cd ~/panel && exec ./panel`), jadi jangan dimatikan; CLI harus membaca
   `~/panel/.env` secara eksplisit dan tidak percaya `process.env` untuk variabel panel.
4. **`import()` dinamis ikut ter-bundle di binary** (dicoba: modul berat hanya dievaluasi saat cabang serve). Dengan
   entry tipis, `panel -v` tidak perlu mengevaluasi Elysia/Better Auth/Drizzle. Binary sekarang butuh ±0,1–0,3 dtk
   (Mac, hangat) sampai validasi env; di HP lebih lambat (belum diukur).
5. **"Tutup dan buka lagi Termux" bisa dihindari.** termux-services memulai runsvdir dari
   `$PREFIX/etc/profile.d/start-services.sh` (`export SVDIR=…; (service-daemon start >/dev/null 2>&1 &)`), yang hanya
   jalan saat shell login baru. `service-daemon start` idempoten (pidfile) dan bisa dipanggil langsung oleh `init`.
   `sv-enable` hanya `rm -f $SVDIR/<s>/down; sv up <s>`.
6. **Paket `cloudflared` Termux memiliki folder layanannya sendiri dan menghapusnya saat upgrade.** `prerm` paket
   (POCO, `$PREFIX/var/lib/dpkg/info/cloudflared.prerm`) menjalankan `sv-disable cloudflared; sv down cloudflared; rm -rf
   $SVDIR/cloudflared` tanpa memeriksa argumen, jadi juga saat `pkg upgrade`. Paket baru memasang ulang run script dari
   template `exec cloudflared tunnel run --token-file $HOME/.cloudflared/token` plus file `down`. Run script POCO (`exec
   cloudflared tunnel --no-autoupdate run poco`, ditulis server-termux) **akan hilang dan tunnel mati** pada upgrade
   cloudflared berikutnya. Ini risiko produksi POCO sekarang, bukan hanya untuk CLI (§5.3).
7. **`pkg upgrade` di HP yang sudah jalan berbahaya:** selain #6, upgrade mayor `postgresql` mengubah format data
   (`$PREFIX/var/lib/postgresql`) sehingga postgres tidak start sampai `pg_upgrade`. server-termux sudah memegang aturan
   yang sama ("a repair rerun must not upgrade openssh/postgres under a live server"): pasang **hanya paket yang
   belum ada**.
8. **Node: `nodejs` dan `nodejs-lts` saling `Conflicts`.** POCO memakai `nodejs-lts` 24.22.3 (kandidat `nodejs`
   26.13.1). pm2 7.1.2 sudah lulus lab di sana (E1–E11). `init` harus menerima node apa pun yang sudah ada dan hanya
   memasang `nodejs-lts` bila belum ada node.
9. **server-termux sudah membuktikan alur bootstrap di POCO** (shell, 120 baris): paket yang hilang, `initdb`, pm2,
   template ecosystem `put_once`, cloudflared `tunnel create` + `config.yml`, Termux:Boot, watchdog
   `termux-job-scheduler`, `sv -w 30 check`. CLI panel sebaiknya mengikuti urutan dan aturan yang sama, tanpa bagian
   yang khusus pemilik (sshd key-only, `authorized_keys`, Tailscale, docs `~/CLAUDE.md`).

## 2. Inventaris alur sekarang: Termux kosong → panel jalan

Sumber: README "Instal di HP", `id.landing.ts` (`install`, `how`), `scripts/install-release.sh`,
`scripts/install-phone.sh`, server-termux README/`install.sh`. Kolom **Binary bisa?**: **ya** = `panel init` bisa
mengerjakannya penuh; **sebagian** = semua kecuali satu bagian milik pengguna (login akun, rahasia, aplikasi Android);
**tidak** = di luar Termux.

| #   | Langkah manual sekarang                                                                                                  | Sumber                                                    | Binary bisa? | Kendala / catatan                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pasang Termux, Termux:API, Termux:Boot dari F-Droid/GitHub (bukan Play Store)                                            | landing prereqs; server-termux README 1                   | **tidak**    | Aplikasi Android. `doctor` bisa mendeteksi Termux:API (`termux-battery-status` dengan timeout; sudah ada di `device.termux.ts`) dan Termux:Boot (hanya bila `~/.termux/boot/` ada — aplikasinya sendiri tak terdeteksi dari Termux) |
| 2   | Pengaturan Android: matikan pembatas proses anak (Android 12+), baterai "tanpa batasan", autostart, buka Termux:Boot sekali | server-termux README 4                                    | **tidak**    | Tidak bisa dibaca dari Termux tanpa adb. `init` mencetak daftar ini di akhir; `docs` memuatnya                                                                                                                                       |
| 3   | `pkg upgrade` pertama kali                                                                                               | server-termux README 2                                    | **ya**       | Hanya di HP baru (§5.2). Mirror dipilih otomatis oleh `pkg` (`select_mirror`, cache 6 jam); bisa lambat/gagal → ulangi, `termux-change-repo` interaktif                                                                              |
| 4   | `pkg install termux-services`, lalu tutup dan buka lagi Termux                                                           | install-release.sh:26-27; landing                         | **ya**       | Buka-ulang diganti `service-daemon start` (temuan 5). Perlu lab singkat bahwa runsvdir yang dimulai dari `init` bertahan setelah sesi ditutup (§6, L1)                                                                              |
| 5   | `pkg install curl` (dan `tar`, `sha256sum`)                                                                              | install-release.sh:23-25                                  | **tidak**    | Dibutuhkan *sebelum* binary ada (bootstrap). Bootstrap Termux biasanya sudah membawa curl/tar/coreutils **(belum dicek di HP baru)**                                                                                              |
| 6   | `pkg install cloudflared nodejs-lts postgresql termux-api` (+ `glibc-runner` untuk situs glibc)                         | README Kebutuhan; landing; server-termux                  | **ya**       | Hanya paket yang hilang (`dpkg -s`). Konflik node (temuan 8). Pacman Termux (`TERMUX_APP_PACKAGE_MANAGER=pacman`) memakai `--noconfirm` — tidak didukung P1                                                                         |
| 7   | `npm install -g pm2`                                                                                                     | install-phone.sh:126-127                                  | **ya**       | Pin `pm2@7.1.2` (versi lab). Butuh jaringan ke registry npm. Jangan memanggil CLI `pm2` lain (B14: daemon liar); server-termux memanggil `pm2 install pm2-logrotate` lalu `pm2 kill` — panel tidak perlu itu                       |
| 8   | `initdb` postgres + nyalakan layanan                                                                                     | server-termux `step postgres`                             | **ya**       | Paket memasang `$SVDIR/postgres/{run,down}` sebagai conffile (`down` = mati bawaan). `initdb -D $PREFIX/var/lib/postgresql -U postgres --auth-local=trust --auth-host=scram-sha-256` hanya bila `PG_VERSION` belum ada                |
| 9   | Unduh `install.sh`, jalankan (`curl … && sh install.sh`)                                                                 | README langkah 1                                          | **tidak**    | Satu perintah tetap batas minimum (R&D/07 #50). Menjadi bootstrap tipis                                                                                                                                                              |
| 10  | Cek arm64, ruang 400 MB, unduh tarball, cek `SHA256SUMS`, ekstrak ke `~/panel-src/<versi>`                               | install-release.sh                                        | **sebagian** | Unduhan pertama tetap di shell (belum ada binary). Pemeriksaan arsitektur/ruang/checksum tetap di `install.sh`; `upgrade` mengerjakan ulang hal yang sama dari dalam binary                                                        |
| 11  | Pasang binary ke `~/panel/panel` (simpan `panel.prev`), `~/panel/data` 700, `.env` dari `.env.example` 600               | install-phone.sh langkah 1–2                              | **ya**       | Binary menyalin dirinya (`process.execPath`) dengan pola `panel.new` → `mv`. `.env.example` di-embed (`with { type: "text" }`, pola `ecosystem.template.ts`)                                                                       |
| 12  | Buat OAuth client Google (browser, Google Cloud Console)                                                                 | README Google OAuth; landing langkah 2                    | **sebagian** | Hanya pemilik yang bisa membuatnya. `init` menampilkan redirect URI persis `https://<host>/api/auth/callback/google` untuk ditempel, lalu bertanya Client ID/secret                                                                 |
| 13  | `nano ~/panel/.env`: isi `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPER_ADMIN_EMAILS`, jalankan ulang | install-phone.sh exit 3; landing langkah 2 & 5            | **ya**       | Prompt; secret dibaca tanpa echo (`setRawMode` ada di `bun-types`); nilai ditulis lewat `encodeEnvLine` (B23) dan divalidasi `parseEnv`. `APP_BASE_URL` diturunkan dari hostname panel                                          |
| 14  | Service runit `panel` (`run`, `log/run` → svlogger, `down` selama `.env` belum lengkap)                                  | install-phone.sh langkah 3                                | **ya**       | Run script di-embed (`deploy/sv/panel/run`)                                                                                                                                                                                          |
| 15  | pm2: `~/sites/ecosystem.config.js` + `apps.json` + service runit `pm2` (hanya HP tanpa pm2)                             | install-phone.sh langkah 4; server-termux `step pm2`      | **ya**       | Sudah ada: fix `sites_dir_create` menulis template (`ecosystemFromTemplate`), fix `ecosystem_block`/`pm2_auto_exit` untuk file yang ada. HP lama: tidak pernah ditimpa                                                             |
| 16  | `cloudflared tunnel login` (buka URL di browser, pilih domain)                                                           | server-termux README 3; README.md langkah 3 (implisit)    | **sebagian** | Pengguna harus login di browser. cloudflared mencetak URL dan menunggu `~/.cloudflared/cert.pem`. `init` bisa membuka URL dengan `termux-open-url` **(belum dicek di POCO)** dan menunggu file itu                               |
| 17  | `cloudflared tunnel create <nama>`, tulis `~/.cloudflared/config.yml` (tunnel, credentials-file, catch-all 404)         | server-termux `step cloudflared`                          | **ya**       | `tunnel create -o json`, `tunnel list -n <nama> -o json` ada di 2026.11.2 (dicek `--help` POCO dan sumber). Nama tunnel yang sudah dipakai di akun → gagal: tawarkan memakai yang ada                                              |
| 18  | Tambah ingress `panel.<domain>` → `http://localhost:3200` sebelum catch-all                                              | README langkah 3                                          | **ya**       | `insertIngressRule` + `cloudflared.validate` + backup, sama dengan job situs (`ingress.editor.ts`, `site.steps.ts`)                                                                                                                 |
| 19  | `cloudflared tunnel route dns <tunnel> panel.<domain>`                                                                   | README langkah 3; landing                                 | **ya**       | `CloudflaredAdapter.routeDns` (tanpa `--overwrite-dns`, `DnsWrongZoneError` bila cert zona lain)                                                                                                                                    |
| 20  | Run script cloudflared + `sv up` / `sv restart cloudflared`                                                              | README langkah 3; server-termux                           | **ya**       | Folder layanan milik paket (temuan 6). Restart di HP yang sudah melayani situs = semua situs putus sebentar → hanya dengan persetujuan                                                                                              |
| 21  | `sv restart panel` + tunggu `/api/health`                                                                                | install-phone.sh langkah 5                                | **ya**       | `sv -w 130` (shutdown menunggu job situs, PLAN/03 §4.12)                                                                                                                                                                             |
| 22  | Cloudflare Access (Zero Trust, 4 path, policy email)                                                                     | README langkah 4; landing langkah 4                       | **sebagian** | Dashboard. Bisa lewat API dengan token berizin Access — fitur baru, P2. `init` mencetak resep singkat + tautan; onboarding panel sudah melacaknya (`access`)                                                                       |
| 23  | Termux:Boot: `~/.termux/boot/<skrip>` yang memanggil `termux-wake-lock` + `service-daemon start`                         | landing prereqs (opsional); server-termux                 | **ya**       | Tulis hanya bila folder `~/.termux/boot/` kosong dari skrip yang menyalakan layanan. POCO punya `start-services` → `~/bin/ensure-services boot` (jangan disentuh)                                                                 |
| 24  | Watchdog 15 menit (`termux-job-scheduler`)                                                                               | server-termux                                             | **sebagian** | Butuh Termux:API. Di luar lingkup panel (P2/opsi)                                                                                                                                                                                    |
| 25  | Upgrade: jalankan perintah curl lagi                                                                                     | README langkah 2; landing                                 | **ya**       | `panel upgrade`                                                                                                                                                                                                                     |
| 26  | Rollback: `sv down`, `cp panel.prev panel`, pilih snapshot, `sv up`                                                      | README Rollback; `rollback_hint`                          | **ya**       | `panel rollback`. Pemulihan `panel.db` dari snapshot tetap pilihan eksplisit (`--db`), karena data setelah upgrade hilang                                                                                                         |
| 27  | Sesudah panel jalan: simpan kunci data, cadangan, token Cloudflare, situs pertama                                       | onboarding `/dev` (PLAN/05)                               | –            | Sudah ditangani UI. `init` hanya menunjuk ke sana                                                                                                                                                                                   |

Hitungan: **ya** 17, **sebagian** 6, **tidak** 4 (Android, satu perintah unduh, prasyarat curl). Setelah CLI, pengguna
HP baru mengetik **satu perintah** lalu menjawab prompt; tiga kali keluar Termux (browser Google Cloud, browser login
Cloudflare, pengaturan Android) tidak bisa dihilangkan.

## 3. Kendala Termux dan binary

### 3.1 `pkg`

- `pkg install …` = `select_mirror; update_apt_cache; apt install "$@"` (dibaca dari `$PREFIX/bin/pkg` POCO). Argumen
  diteruskan apa adanya, jadi `pkg install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
  <paket>` sah. Dengan `DEBIAN_FRONTEND=noninteractive`, pertanyaan conffile tidak muncul dan file yang diubah
  pengguna dipertahankan (`confold`) — penting untuk HP lama.
- `select_mirror` memilih mirror otomatis (cek paralel, cache 6 jam; `pkg --check-mirror` memaksa cek ulang). Tidak
  interaktif. `termux-change-repo` interaktif (dialog) — hanya disebut di pesan error.
- `apt` mencetak "WARNING: apt does not have a stable CLI interface" ke stderr saat tidak ada TTY; abaikan, jangan
  parse output `apt`; keberhasilan dicek ulang dengan `dpkg -s <paket>` (status `install ok installed`).
- `TERMUX_APP_PACKAGE_MANAGER` bisa `pacman` (`pkg install` = `pacman -Sy --needed`). P1: hanya apt; pacman → pesan
  "pasang manual: …" (exit 3).
- Paket yang sudah ada **tidak** di-upgrade (temuan 6/7). `apt install` paket baru bisa menaikkan library dependensinya;
  itu bawaan apt dan diterima (server-termux melakukan hal sama).

### 3.2 termux-services, runit, boot

- `SVDIR` tidak diset di shell non-login (ssh non-interaktif, proses runit): `install-phone.sh` sudah meng-export-nya.
  CLI selalu memakai `$PREFIX/var/service` absolut dan mengoper `SVDIR` ke `sv`.
- `sv` gagal sampai runsv mengawasi folder (`supervise/ok`), ±5 dtk scan runsvdir: pola `wait_supervised` di
  `install-phone.sh` dan `sv_on` di server-termux. Folder layanan baru dibangun dengan nama titik lalu di-rename
  (`.pm2.new` → `pm2`) agar runsv tidak melihat folder setengah jadi.
- Termux:Boot menjalankan `~/.termux/boot/*` setelah HP menyala (setelah pengguna membuka aplikasinya sekali).
  `termux-wake-lock` menahan CPU agar Doze tidak membekukan proses; ada di POCO (`$PREFIX/bin/termux-wake-lock`).
- Android 12+ "phantom process killer" bisa membunuh proses anak Termux; matikan lewat opsi pengembang atau adb
  (server-termux README). Tidak terdeteksi dari Termux.
- Storage: panel tidak butuh `termux-setup-storage` (semua di `$HOME`); yang penting ruang kosong (`statfs`, sudah ada
  di `health.service.ts`) — `install.sh` mensyaratkan 400 MB, `install-phone.sh` 2 × `panel.db` + 256 MB.

### 3.3 cloudflared

- Perintah terverifikasi (2026.11.2, `--help` POCO + sumber): `tunnel login` (cetak URL, tunggu callback, tulis
  `cert.pem`), `tunnel create [-o json] NAME` (tulis `~/.cloudflared/<uuid>.json`), `tunnel list -n NAME -o json`,
  `tunnel route dns [-f] TUNNEL HOSTNAME`, `tunnel token [--cred-file F] TUNNEL`, `tunnel run [--token-file F] [NAME]`.
- `tunnel run` dengan token memanggil `runWithCredentials`; tanpa token mencari nama di argumen lalu `tunnel:` di config
  (`subcommands.go` `runCommand`). Ingress tetap dibaca dari config default `~/.cloudflared/config.yml` di kedua jalur
  — **dugaan dari sumber, wajib lab L2** — artinya template paket (`--token-file $HOME/.cloudflared/token`) mungkin bisa
  dipakai apa adanya untuk tunnel lokal dengan `cloudflared tunnel token <nama> > ~/.cloudflared/token` (600). Bila
  lulus, run script paket tidak perlu diedit dan upgrade paket tidak merusak
  apa pun selain file `down` (§5.3).
- `routeDns` panel tidak pernah memakai `--overwrite-dns` (aturan yang ada).

### 3.4 Binary Bun (`bun build --compile`)

| Perilaku                           | Hasil                                                                                                                  | Bukti                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| argv                               | `["bun", "/$bunfs/root/<nama>", ...args]`; `execArgv` kosong; `--smol`/`--help` sampai ke skrip                         | eksperimen lokal                            |
| `Bun.isStandaloneExecutable`       | `true` di binary                                                                                                       | eksperimen + `bun-types`                    |
| `process.execPath`                 | path binary itu sendiri → bisa menyalin dirinya ke `~/panel/panel`                                                     | eksperimen                                  |
| `.env` cwd                         | dimuat otomatis (`autoloadDotenv` default true)                                                                        | eksperimen + `CompileBuildOptions`          |
| `parseArgs`                        | ada; `strict` melempar `ERR_PARSE_ARGS_UNKNOWN_OPTION`; `--v`/`--h` adalah opsi panjang bernama `v`/`h` (perlu alias)  | eksperimen + `@types/node/util.d.ts`        |
| `import()` dinamis                 | ikut ter-bundle dan hanya dievaluasi saat dipanggil                                                                    | eksperimen                                  |
| `prompt()`/`confirm()`             | global Bun (non-rahasia)                                                                                               | `bun-types/globals.d.ts:1010`               |
| Mengganti binary yang sedang jalan | `rename` atas file yang sedang dieksekusi aman di Linux (inode lama tetap); `install-phone.sh` sudah memakainya        | pola yang sudah berjalan di POCO            |

## 4. Cara produk sejenis bootstrap, diagnosa, dan update

| Produk                    | Bootstrap                                                                                                   | Diagnosa                                                                                         | Update diri                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Coolify **(perlu verifikasi)** | `curl … install.sh \| bash`: cek OS, pasang Docker bila belum ada, buat `.env` dengan rahasia acak, jalankan stack; idempoten, rerun = upgrade | Halaman UI "Server → Validate" memeriksa SSH/Docker dan menawarkan memasangnya                    | Skrip upgrade dari UI/cron; versi dari CDN                                                    |
| Dokku **(perlu verifikasi)**   | `bootstrap.sh` versi ter-pin, pasang paket via apt, lalu setup web/CLI untuk kunci SSH                       | `dokku report` (ringkas status per app/plugin)                                                   | Lewat apt (`apt upgrade dokku`)                                                               |
| CapRover **(perlu verifikasi)** | `docker run caprover/caprover` + `caprover serversetup` (wizard CLI: IP, domain root, password, email SSL)   | Checklist di dashboard                                                                          | Tombol di dashboard (tarik image baru)                                                        |
| Caddy **(perlu verifikasi)**   | Satu binary; `caddy run`/`caddy start`                                                                       | `caddy validate --config`, `caddy version`, `caddy environ`                                      | `caddy upgrade`: unduh build resmi, ganti binary, simpan `.tmp`/backup lama                    |
| Tailscale **(perlu verifikasi)** | `curl -fsSL https://tailscale.com/install.sh \| sh` (deteksi distro, pasang repo), `tailscale up` (cetak URL login) | `tailscale status`, `tailscale netcheck`, `tailscale bugreport`                                  | `tailscale update` (minta konfirmasi, `--yes`)                                                |
| Homebrew **(perlu verifikasi)** | `install.sh` dengan prompt konfirmasi, cetak "Next steps"                                                   | `brew doctor`: daftar "Warning:" dengan saran perbaikan; exit ≠ 0 bila ada peringatan; "Your system is ready to brew." bila bersih | `brew update` (git pull) otomatis sebelum install                                             |
| rustup **(perlu verifikasi)**  | `rustup-init` menampilkan rencana (path, toolchain), pilihan 1) lanjut 2) kustom 3) batal, `-y` melewati      | –                                                                                                | `rustup self update`: unduh, verifikasi, ganti diri sendiri                                   |

Pola yang diambil:

1. **Rencana → konfirmasi → `-y`** (rustup, Tailscale, Homebrew): tampilkan apa yang akan dipasang/ditulis, lalu tanya
   sekali. Non-interaktif hanya dengan `--yes`.
2. **Rerun = perbaikan/upgrade** (Coolify, server-termux, install-phone.sh): idempoten, tanpa file state yang wajib.
3. **Doctor read-only** dengan saran per masalah (`brew doctor`), exit ≠ 0 saat ada error, `--json` untuk mesin.
4. **Login akun = cetak URL + tunggu** (Tailscale `up`, cloudflared `tunnel login`).
5. **Update diri = unduh resmi + verifikasi + ganti atomik + simpan versi lama** (Caddy, rustup); panel sudah punya
   `panel.prev` dan SHA256SUMS.
6. Yang tidak diambil: wizard UI sebelum panel hidup (CapRover) — login Google panel belum ada sebelum `.env` terisi,
   jadi CLI satu-satunya antarmuka yang aman.

## 5. Temuan teknis untuk desain

### 5.1 Satu sumber kebenaran untuk pemeriksaan

- Kartu Persiapan membaca `createIntegration(ctx).get()` (`integration.service.ts`), dengan copy di
  `src/web/i18n/id.site.setup.ts` (TS murni, hanya `import type`). CLI bisa memanggil fungsi yang sama dengan `FixCtx`
  `{db, secret, system}` dan mengimpor copy yang sama → teks CLI = teks UI.
- `FixCtx.db` dibutuhkan untuk `describeSetting(db, "sites.dir" | "cloudflare.api_token")`. `openDb` **membuat**
  `panel.db` (`create: true`, WAL): doctor tidak boleh memanggilnya di HP baru. Jalan: buka `panel.db` read-only bila
  ada (`new Database(file, { readonly: true })`; panel yang sedang jalan memegang `-wal/-shm`), selain itu DB
  `:memory:` yang dimigrasi (`runMigrations`) → setting default. `secret` tidak dibutuhkan untuk `describeSetting`
  (hanya `isSet`) — CLI tidak membaca `data/secret`.
- `selectSystem()` memilih mode `fake` bila `$PREFIX/bin/sv` tidak ada → binary di CI/Mac otomatis fake. Pemeriksaan
  paket (`dpkg -s`) dan bootstrap (`service-daemon`, `.env`, `cert.pem`) belum punya adapter; perlu adapter kecil
  dengan versi fake.
- Onboarding (`getSetup`) butuh `BackupService.status()` dan DB panel; di luar panel berjalan itu tidak ada.
  `doctor` menampilkan item onboarding hanya sebagai rujukan "buka /dev" — tidak menghitung ulang.

### 5.2 Membedakan HP baru dan HP yang sudah jalan

Tanda "sudah jalan" (salah satu cukup): `~/panel/panel`, `$SVDIR/panel`, `$SVDIR/pm2`, `~/sites/ecosystem.config.js`,
`~/.cloudflared/config.yml`, `$PREFIX/var/lib/postgresql/PG_VERSION`. POCO memiliki semuanya, ditambah ecosystem
tulisan tangan (mode 0600, tanpa blok panel; R&D/07 §1) dan layanan `cloudflared`/`pm2` yang melayani makuro-solusi.

Di HP yang sudah jalan:

- Panel sedang `run` = panel memegang lock job/fix (`jobs.assertIdle`, `withLock("integration")`) di prosesnya
  sendiri; CLI tidak bisa ikut lock itu. Menulis `apps.json`/ecosystem/`config.yml` dari CLI saat itu bisa bertabrakan
  dengan job situs. Aturan aman: **CLI tidak menerapkan fix integrasi selama layanan `panel` `run`** — ia menunjuk ke
  Situs → Persiapan (fix yang sama, dengan lock, audit dan undo).
- Tidak ada `pkg upgrade`, tidak ada restart pm2 (C3), restart cloudflared hanya dengan persetujuan eksplisit.

### 5.3 Risiko cloudflared upgrade (berlaku juga untuk POCO hari ini)

Upgrade paket = `prerm` menghapus `$SVDIR/cloudflared`, paket baru memasang template token + `down`. Akibat:
layanan berhenti dan tidak start lagi (karena `down`), run script kustom hilang, `config.yml` dan `cert.pem` tetap.
Opsi:

| Opsi | Isi                                                                                                         | Nilai                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A    | Pakai template paket: `cloudflared tunnel token <nama> > ~/.cloudflared/token` (600), run script tidak diedit | Tahan upgrade kecuali `down` (doctor menawarkan `sv-enable`). Butuh lab L2 (ingress lokal tetap dipakai) |
| B    | Tulis run script sendiri (seperti server-termux), doctor mendeteksi bila diganti template dan `init` menulisnya lagi | Jalan sekarang; tunnel tetap mati sampai pengguna menjalankan `panel init`/`doctor`                      |

Rekomendasi: A bila L2 lulus, B sebagai cadangan. Doctor tetap memeriksa `down` + isi run script di kedua kasus. Temuan
ini perlu disampaikan ke pemilik untuk POCO (jangan `pkg upgrade cloudflared` sampai diputuskan).

### 5.4 Rahasia

- Prompt secret: raw mode, tanpa echo, tidak pernah dicetak ulang, tidak masuk log/state/argv. Ditulis langsung ke
  `.env` (600) lewat `encodeEnvLine`. Doctor hanya menyebut nama variabel yang kosong (pola `install-phone.sh`).
- Token tunnel (opsi A) ditulis cloudflared langsung ke file lewat stdout yang diarahkan oleh CLI ke file 600,
  tidak pernah lewat terminal.
- `cert.pem` milik pengguna (login Cloudflare), tidak dibaca isinya, hanya keberadaannya.

### 5.5 Ukuran dan waktu start

CLI tambahan diperkirakan kecil (beberapa puluh KB minified) dibanding binary 92–118 MB; isu sebenarnya waktu start
dan efek samping modul. Entry tipis dengan `import()` dinamis per perintah membuat `-v`/`-h` tidak mengevaluasi server,
dan jalur serve tetap sama persis.

## 6. Lab yang dibutuhkan (POCO terisolasi atau HP/emulator kosong)

| #   | Pertanyaan                                                                                                                   | Kenapa                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| L1  | `service-daemon start` dari `panel init` (tanpa buka-ulang Termux): runsvdir hidup setelah sesi Termux ditutup dan dibuka?   | Menghapus langkah "tutup dan buka Termux"    |
| L2  | `cloudflared tunnel run --token-file` (template paket) + tunnel lokal + `config.yml` ingress: hostname situs tetap terlayani? | Opsi A §5.3                                  |
| L3  | Termux baru dari F-Droid: curl/tar/sha256sum ada di bootstrap? `pkg install -y` tanpa TTY berhasil?                         | Prasyarat `install.sh`, mode non-interaktif |
| L4  | Waktu `panel -v` dan `panel doctor` di HP dengan entry tipis                                                                 | Kriteria penerimaan                          |

## 7. Di luar lingkup (dicatat)

- Cloudflare Access lewat API (butuh token berizin Access) — P2.
- Watchdog `termux-job-scheduler`, sshd/Tailscale — milik server-termux, bukan panel.
- Upgrade dari UI panel (tombol "Perbarui") — memakai `panel upgrade` di belakang; butuh PLAN sendiri.
- Pacman Termux — hanya pesan manual.
