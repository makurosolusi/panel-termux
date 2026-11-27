# Panel Termux content guide

The reference for all interface text (`src/web/i18n/en.*.ts` and the `id.*` overlays), CLI output (`tr()`), Telegram alerts, the landing page, and error messages. English is the default language; Indonesian is a complete option (see [Indonesian (`id`)](#indonesian-id)). Public docs (README, CHANGELOG, release notes) are written in English, with an Indonesian README in `README.id.md`. When in doubt, pick the words that are clearest to someone opening the panel for the first time.

## Voice and tone

- **Clear, calm, direct.** Say what happened and what the reader can do. No filler, no exclamation marks, no blaming the user.
- Address the reader as **"you"**. Avoid "the user", "please" on every line, and "Oops".
- Short sentences, active verbs: "Save changes", not "Changes can be saved".
- Use contractions the way people speak: "can't", "isn't", "didn't", "you'll". Write "cannot" only where the stress matters.
- Use technical terms when that is what people look for (pm2, runit, cloudflared, `.env`, port). Put file names, commands, and variables in code format.
- Natural product English, not a translation of the Indonesian text. Translate the concept, then check the glossary.

## Product name

- In text people read: **Panel Termux**. Inside a sentence, the app may call itself "the panel" (lowercase).
- `panel-termux` only in technical contexts: repo name, binary name, GitHub URL, commands.

## Glossary

One term per concept, in every locale and on every surface (web, server, CLI). Do not alternate. Rows marked **m:1** map several English terms to one Indonesian word: pick the English term by concept, never by translating the Indonesian word back.

| Concept (code)            | English                                                        | Don't use                | Indonesian                                                          |
| ------------------------- | -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| site                      | **Site** / **Sites**                                           | Website, web app         | Situs                                                               |
| runit service             | **Service**                                                    | Daemon                   | Layanan                                                             |
| pm2 app                   | **App**                                                        | Process, application     | Aplikasi                                                            |
| hostname                  | **Domain**                                                     | Hostname, host           | Domain                                                              |
| database                  | **Database**                                                   | DB (except tight spaces) | Database                                                            |
| backup (noun / verb)      | **Backup** / **Back up**                                       | Snapshot                 | Cadangan / Cadangkan                                                |
| restore (backup)          | **Restore**                                                    | Recover                  | Pulihkan (**m:1**)                                                  |
| recover (interrupted job) | **Recover**                                                    | Restore, clean up        | Pulihkan (**m:1**)                                                  |
| rollback (button)         | **Restore previous version** (button) / **Rollback** (history) | Revert                   | Kembalikan versi sebelumnya (**m:1** with "Pulihkan" in older copy) |
| job                       | **Change**                                                     | Job, task                | Perubahan                                                           |
| job history               | **Change history**                                             | Job log                  | Riwayat perubahan                                                   |
| overview (`/panel`)       | **Overview**                                                   | Dashboard                | Ringkasan                                                           |
| setup card                | **Setup**                                                      | Integration              | Persiapan                                                           |
| fix / fix all             | **Fix** / **Fix all**                                          | Repair, resolve          | Perbaiki / Perbaiki semua                                           |
| manual steps              | **Manual steps**                                               | Instructions             | Cara manual                                                         |
| health (`/dev`)           | **System health**                                              | Health, status           | Kesehatan sistem                                                    |
| `/dev` console            | **Administration**                                             | Dev, developer, system   | Administrasi                                                        |
| user / role               | **User** / **Role**                                            | Account type             | Pengguna / Peran                                                    |
| settings                  | **Settings**                                                   | Configuration            | Pengaturan                                                          |
| uptime                    | **Uptime**                                                     | Running time             | Waktu aktif                                                         |
| storage                   | **Storage**                                                    | Disk                     | Penyimpanan                                                         |
| env vars                  | **Environment variables**                                      | Env, envs                | Variabel lingkungan                                                 |
| upload / download         | **Upload** / **Download**                                      |                          | Unggah / Unduh                                                      |
| online / errored          | **Running** / **Errored**                                      | Online, error            | Berjalan / Bermasalah                                               |
| interrupted               | **Interrupted**                                                | Aborted, broken          | Terputus                                                            |
| not managed yet           | **Not managed yet**                                            | Unmanaged, foreign       | Belum dikelola                                                      |
| demo mode                 | **Demo mode**                                                  | Fake mode                | Mode demo                                                           |
| start / stop / restart    | **Start** / **Stop** / **Restart**                             | Run, kill, reboot        | Mulai / Hentikan / Mulai ulang                                      |
| retry                     | **Try again**                                                  | Retry (in buttons)       | Coba lagi                                                           |
| data key                  | **Data key**                                                   | Secret, master key       | Kunci data                                                          |
| deploy                    | **Deploy**                                                     | Release, ship            | Deploy                                                              |

Job ids (`job_…`), API paths and codes (`/api/jobs`, `JOB_*`), log keys, audit actions, and CLI command and flag names keep the word `job`. Only prose and labels say "Change".

## Capitalization

- **Sentence case** for titles, labels, buttons, and menus: "Change history", not "Change History".
- Proper names stay as they are: Panel Termux, Cloudflare, Google, PostgreSQL, Bun, Android, Termux, Super Admin (and the role names User, Admin, Super Admin).
- Commands, files, and services are written exactly: `pm2`, `cloudflared`, `sshd`.

## Numbers, dates, time

English uses the `en-US` locale with a 24-hour clock (`src/shared/format.number.ts`, `src/web/shared/format.ts`).

| Kind          | Format                                                                                                    | Example                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Date and time | medium date + 24-hour time                                                                                | Nov 26, 2026, 21:26                                         |
| Time only     | HH:MM                                                                                                     | 03:00                                                       |
| Duration      | the two largest units, abbreviated                                                                        | 7 min 17 s · 1 d 9 h · 42 s                                 |
| Relative      | no seconds: number + unit + "ago", future "in …"; under 1 minute "just now"; the previous day "yesterday" | 3 min ago · 1 h 5 min ago · in 5 min · just now · yesterday |
| Decimal       | point                                                                                                     | 1.5 GB                                                      |
| Thousands     | comma                                                                                                     | 12,480                                                      |

Time unit abbreviations are only **d**, **h**, **min**, **s**. Spell out "day"/"days" in sentences ("4 days ago").

## Units

- Sizes: B, KB, MB, GB, TB. **GB and TB with 1 decimal** ("12.4 GB"), MB without decimals when ≥ 100.
- Temperature: "36.5 °C" (space before °C).
- Percent: "72%" (no space).
- Free space: "12.4 GB free of 64.0 GB".

## Plurals

- Every count goes through a function with an explicit singular: ``(n) => (n === 1 ? "1 site" : `${n} sites`)``. Never "site(s)".
- Zero uses the plural ("0 sites") or, better, an empty-state sentence ("No sites yet").
- Indonesian has no plural forms; its overlay can return the same text for every `n`.

## Button verbs

Buttons start with a verb and name the result. Use this list:

| Action                       | Button                                              |
| ---------------------------- | --------------------------------------------------- |
| Saving                       | Save                                                |
| Closing a dialog unchanged   | Cancel                                              |
| Deleting                     | Delete (in dialogs: "Delete site", "Remove domain") |
| Starting                     | Start                                               |
| Stopping                     | Stop                                                |
| Restarting                   | Restart                                             |
| Repeating a failed request   | Try again                                           |
| Creating                     | Create site, Add domain                             |
| Closing an info panel/dialog | Close                                               |
| Copying                      | Copy                                                |

Don't use "OK", "Yes", or "Submit" in dialogs. The confirm button repeats the action's verb.

## Message patterns

### Error messages

**What happened + why (if known) + what to do.**

- ✅ "Can't reach the server. Check your internet connection, then try again."
- ✅ "Another backup is running. Wait for it to finish, then try again."
- ❌ "Request failed." (no next step)
- ❌ "Error 500" (a code with no explanation)

Never show a raw technical message as the only content. Server detail may go below it.

### Technical work: the panel does it

Never tell people to do technical work by hand (run a command in Termux, open ssh, edit a file) when the panel can do it. Give a button that does it: "Fix", "Start pm2", "Start again".

- The main message says what happened and names the button: "pm2 isn't running, so every site is down. Press Start pm2, then try again."
- Manual steps (commands, file paths, blocks to paste) only go in the collapsed **"Manual steps (for technical users)"** section, closed by default. Open it automatically only when the panel can't fix the problem itself, and say why.
- ✅ "The panel can't fix this automatically. Follow Manual steps on the Setup card."
- ❌ "Run `sv up pm2` on the phone." / "Fix it over ssh."

### Empty states

**What this section holds + the first action.**

- ✅ "No sites yet. Create your first site to connect a domain to an app."
- ❌ "No data."

### Confirmation dialogs

- Title: a question with verb + object: "Delete site blog?"
- Body: **the consequence first**, then what stays safe. Say when it can't be undone ("This can't be undone.").
- Button: the same verb as the title. Dangerous actions use the red variant.

### Toasts

- Short, **past tense**, one thing: "Settings saved.", "sshd restarted."
- Failure toasts follow the error message pattern.

### Help text and data freshness

- Don't write static technical intervals ("Refreshes every 15 seconds"). Show when the data was last updated: "Updated 3 min ago", under a minute "Updated just now" (`tCommon.updatedAgo`; the relative time pieces live in `tShell.time`).
- Placeholders give an example and start with "e.g.": "e.g. blog.example.com".

## No Indonesian in English

- English text (`en.*`, `problem.copy.en.ts`, CLI `en` strings, `docs/cli/*.md`) contains no Indonesian words, including in examples: `example.com`, not `contoh.com`. `tests/web.no-indonesian.test.ts` checks the rendered English pages for Indonesian words.
- Indonesian text lives only in the `id.*` overlays, `problem.copy.id.ts`, CLI `id` strings, and `docs/cli/id/`. It is loaded only when Indonesian is chosen.
- Data contracts are English in every locale and never translated: the audit CSV header, the data key file, the ecosystem block comments, API error codes, and URL anchors.

## Landing page

- Only claims that can be proven: one native Android binary, about 65 MB RAM (measured on the phone), no root, no Docker, Cloudflare Tunnel without a public IP, a site wizard with rollback, browser deploys with rollback, daily backups to R2/S3, Google sign-in with roles.
- No made-up numbers, testimonials, or superlatives ("best", "fastest").
- Benefits first, technical detail after.

## Indonesian (`id`)

The rules below apply to the Indonesian overlays (`src/web/i18n/id.*.ts`, `problem.copy.id.ts`, CLI `id` strings, `docs/cli/id/`). They are unchanged from 0.5.x so the Indonesian UI keeps its voice. The glossary above is binding for both columns.

### Suara dan nada

- **Jelas, tenang, langsung.** Sebut apa yang terjadi dan apa yang bisa dilakukan. Tanpa basa-basi, tanpa tanda seru, tanpa menyalahkan pengguna.
- Sapa pengguna dengan **"kamu"**. Hindari "Anda", "user", dan "Silakan" berulang.
- Kalimat pendek, kata kerja aktif. "Simpan perubahan", bukan "Perubahan dapat disimpan".
- Istilah teknis dipakai bila memang itu yang dicari pengguna (pm2, runit, cloudflared, `.env`, port). Tulis dalam format kode bila berupa nama file, perintah, atau variabel.

### Nama produk

- Di teks yang dibaca pengguna: **Panel Termux**. Merujuk ke aplikasinya sendiri di dalam kalimat boleh "panel" (huruf kecil).
- `panel-termux` hanya di konteks teknis: nama repo, nama binary, URL GitHub, perintah.

### Glosarium

Satu istilah untuk satu konsep. Jangan bergantian.

| Konsep (kode)     | Pakai                                                                   | Jangan                 | Catatan                                                                                                           |
| ----------------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| site              | **Situs**                                                               | Site, web              | "Buat situs", "Hapus situs"                                                                                       |
| runit service     | **Layanan**                                                             | Service                | sshd, postgres, pm2, cloudflared                                                                                  |
| pm2 app           | **Aplikasi**                                                            | App                    |                                                                                                                   |
| hostname          | **Domain**                                                              | Hostname, host         |                                                                                                                   |
| database          | **Database**                                                            | Basis data, DB         | "DB" hanya di ruang sempit teknis                                                                                 |
| backup            | **Cadangan**                                                            | Backup                 | Tombol: "Cadangkan sekarang". Nama file/perintah teknis tetap                                                     |
| restore           | **Pulihkan**                                                            | Restore                | "Perintah pemulihan"                                                                                              |
| deploy            | **Deploy**                                                              | Rilis, Penyebaran      | Kata serapan yang lazim di kalangan developer; huruf kecil di tengah kalimat                                      |
| rollback          | **Rollback** (label riwayat) / **Kembalikan versi sebelumnya** (tombol) | Revert                 |                                                                                                                   |
| job               | **Perubahan**                                                           | Job, Tugas             | "Riwayat perubahan", "Progres perubahan"                                                                          |
| overview          | **Ringkasan**                                                           | Overview, Dashboard    |                                                                                                                   |
| health (`/dev`)   | **Kesehatan sistem**                                                    | Health                 |                                                                                                                   |
| `/dev` console    | **Administrasi**                                                        | Dev, Developer, Sistem | Label menu dan judul halaman; path URL tetap `/dev`. "Sistem" dipakai untuk aktor otomatis di audit dan opsi tema |
| user              | **Pengguna**                                                            | User                   | Nama peran: Pengguna, Admin, Super Admin                                                                          |
| role              | **Peran**                                                               | Role                   |                                                                                                                   |
| audit log         | **Audit** / **Log audit**                                               |                        |                                                                                                                   |
| log               | **Log**                                                                 | Catatan                |                                                                                                                   |
| settings          | **Pengaturan**                                                          | Setting, Konfigurasi   |                                                                                                                   |
| uptime            | **Waktu aktif**                                                         | Uptime                 | Di baris meta: "aktif 3 jam"                                                                                      |
| heap              | **Memori JS (heap)**                                                    | Heap                   |                                                                                                                   |
| RSS memory        | **Memori**                                                              | RAM terpakai           |                                                                                                                   |
| disk / data dir   | **Penyimpanan**                                                         | Disk                   |                                                                                                                   |
| session           | **Sesi**                                                                | Session                |                                                                                                                   |
| token             | **Token**                                                               |                        | "Token API Cloudflare"                                                                                            |
| tunnel            | **Tunnel**                                                              | Terowongan             | "Cloudflare Tunnel", "tunnel cloudflared"                                                                         |
| env vars          | **Variabel lingkungan**                                                 | Env, environment       | Nama file tetap `.env`                                                                                            |
| upload / download | **Unggah** / **Unduh**                                                  | Upload, Download       |                                                                                                                   |
| online (status)   | **Berjalan**                                                            | Online                 |                                                                                                                   |
| errored (status)  | **Bermasalah**                                                          | Error                  |                                                                                                                   |
| demo / fake mode  | **Mode demo**                                                           | Fake                   |                                                                                                                   |

### Kapitalisasi

- **Huruf kapital di awal saja** (sentence case) untuk judul, label, tombol, menu: "Riwayat perubahan", bukan "Riwayat Perubahan".
- Nama diri tetap: Panel Termux, Cloudflare, Google, PostgreSQL, Bun, Android, Termux, Super Admin.
- Nama perintah, file, dan layanan ditulis apa adanya: `pm2`, `cloudflared`, `sshd`.

### Angka, tanggal, waktu

Semua memakai locale `id-ID`.

| Jenis           | Format                                                                                                              | Contoh                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Tanggal dan jam | tanggal pendek + jam dengan titik                                                                                   | 26 Nov 2026, 21.26                                                |
| Jam saja        | HH.MM                                                                                                               | 03.00                                                             |
| Durasi          | dua satuan terbesar, satuan disingkat konsisten                                                                     | 7 mnt 17 dtk · 1 hari 9 jam · 42 dtk                              |
| Relatif         | tanpa detik: angka + satuan + "lalu", masa depan "dalam …"; di bawah 1 menit "baru saja"; hari sebelumnya "kemarin" | 3 mnt lalu · 1 jam 5 mnt lalu · dalam 5 mnt · baru saja · kemarin |
| Desimal         | koma                                                                                                                | 1,5 GB                                                            |
| Ribuan          | titik                                                                                                               | 12.480                                                            |

Singkatan satuan waktu hanya: **hari**, **jam**, **mnt**, **dtk**. Jangan "h", "j", "m", "d" (ambigu dengan hours/minutes/days).

### Satuan

- Ukuran: B, KB, MB, GB, TB. **GB dan TB dengan 1 desimal** ("12,4 GB"), MB tanpa desimal bila ≥ 100.
- Suhu: "36,5 °C" (spasi sebelum °C).
- Persen: "72%" (tanpa spasi).
- Sisa ruang: "12,4 GB bebas dari 64,0 GB".

### Kata kerja tombol

Tombol diawali kata kerja dan menyebut hasilnya. Pakai daftar ini:

| Aksi                       | Tombol                                           |
| -------------------------- | ------------------------------------------------ |
| Menyimpan                  | Simpan                                           |
| Membatalkan dialog         | Batal                                            |
| Menghapus                  | Hapus (di dialog: "Hapus situs", "Hapus domain") |
| Menjalankan                | Mulai                                            |
| Menghentikan               | Hentikan                                         |
| Restart                    | Mulai ulang                                      |
| Mengulang permintaan gagal | Coba lagi                                        |
| Membuat                    | Buat situs, Tambah domain                        |
| Menutup panel/dialog info  | Tutup                                            |
| Menyalin                   | Salin                                            |

Jangan memakai "OK", "Ya", atau "Submit" di dialog. Tombol konfirmasi mengulang kata kerja aksinya.

### Pola pesan

#### Pesan error

**Apa yang terjadi + kenapa (bila tahu) + apa yang bisa dilakukan.**

- ✅ "Tidak bisa terhubung ke server. Periksa koneksi internet, lalu coba lagi."
- ✅ "Cadangan lain sedang berjalan. Tunggu sampai selesai, lalu coba lagi."
- ❌ "Permintaan gagal." (tidak memberi langkah berikutnya)
- ❌ "Error 500" (kode tanpa penjelasan)

Jangan menampilkan pesan teknis mentah sebagai satu-satunya isi. Detail server boleh ditampilkan di bawahnya.

#### Pekerjaan teknis: panel yang mengerjakan

Jangan pernah menyuruh pengguna mengerjakan hal teknis dengan tangan (menjalankan perintah di Termux, membuka ssh, mengedit file) bila panel bisa mengerjakannya sendiri. Beri tombol yang melakukannya: "Perbaiki", "Jalankan pm2", "Jalankan lagi".

- Pesan utama menyebut apa yang terjadi dan tombolnya: "Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti. Tekan Jalankan pm2, lalu coba lagi."
- Langkah manual (perintah, path file, blok untuk ditempel) hanya di bagian lipat **"Cara manual (untuk pengguna teknis)"**, tertutup secara bawaan. Buka otomatis hanya bila panel tidak bisa memperbaikinya sendiri, dan sebut alasannya.
- ✅ "Panel tidak bisa memperbaiki ini otomatis. Ikuti Cara manual di kartu Persiapan."
- ❌ "Jalankan `sv up pm2` di HP." / "Perbaiki lewat ssh."

#### Status kosong

**Apa isi bagian ini + aksi pertama.**

- ✅ "Belum ada situs. Buat situs pertama untuk menghubungkan domain ke aplikasi."
- ❌ "Tidak ada data."

#### Dialog konfirmasi

- Judul: pertanyaan dengan kata kerja + objek: "Hapus situs blog?"
- Isi: **akibatnya dulu**, lalu apa yang tetap aman. Sebut bila tidak bisa dibatalkan.
- Tombol: kata kerja yang sama dengan judul. Aksi berbahaya memakai varian merah.

#### Toast

- Kalimat pendek, **bentuk lampau**, satu hal: "Pengaturan disimpan.", "sshd dimulai ulang."
- Toast gagal mengikuti pola pesan error.

#### Teks bantuan dan status data

- Jangan menulis interval teknis yang statis ("Diperbarui otomatis tiap 15 detik"). Tampilkan kapan data terakhir diperbarui: "Diperbarui 3 mnt lalu", di bawah 1 menit "Diperbarui baru saja" (`tCommon.updatedAgo`; potongan waktu relatif ada di `tShell.time`).
- Placeholder memberi contoh, diawali "mis.": "mis. blog.contoh.com".

### Landing page

- Hanya klaim yang bisa dibuktikan: satu binary native Android, sekitar 65 MB RAM (diukur di HP), tanpa root, tanpa Docker, Cloudflare Tunnel tanpa IP publik, wizard situs dengan rollback, deploy dari browser dengan rollback, cadangan harian ke R2/S3, login Google dengan peran.
- Tanpa angka karangan, testimoni, atau superlatif ("terbaik", "tercepat").
- Manfaat dulu, detail teknis sesudahnya.
