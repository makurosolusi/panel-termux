# Changelog

## [0.6.1] - 2026-11-28

### Fixed

- `panel init --ssh-key` now makes SSH start when the phone boots in every case. Before, an sshd started by hand (or already under runit) kept the package's `down` file, so after a reboot nobody could ssh in, and a second run still called SSH complete. Init removes the file, and an sshd started by hand is left running with the exact `kill` and `sv up sshd` to move it under runit.
- `panel doctor` has a new check, "sshd starts automatically when the phone boots". It warns when sshd is in use but has a `down` file or runs outside runit, and says how to fix it.
- When two sshd processes run by hand, init names the one on the configured port (8022 unless `sshd_config` says otherwise) instead of the first one it found.
- Without `--ssh-key`, `panel init` now says when SSH will not start at boot and how to turn it on.
- Ctrl-C during `panel init` prints a one-line summary and the command to continue, and the next run resumes the install ("Resuming an install that did not finish") instead of treating it as a repair. The Cloudflare login now gives up after 10 minutes with the same hint. An interrupted first install resumes where it stopped (it leaves the marker `$PREFIX/tmp/panel-init.unfinished`, which only counts for the same release).
- `panel init` output: the Cloudflare login address is printed once, the panel service step shows a result line, and the "Changed" list no longer names the downloaded file that was deleted.

## [0.6.0] - 2026-11-28

### Added

- Indonesian is now a language option next to English. Signed-in users choose under **Profile → Language** (English, Bahasa Indonesia, or Use device language); the choice is saved to the account, so other devices follow it. The login page and the bottom of the landing page have a link to the other language, and `?lang=id` / `?lang=en` works on any page. Without a choice, the panel follows the browser language and falls back to English.
- CLI language: `panel init` asks **Language / Bahasa** once and saves the answer as `PANEL_LANG` in `~/panel/.env`. Every command accepts `--lang en|id`, and `PANEL_LANG` in the environment or in `~/panel/.env` sets it for all commands. `panel docs` has its guides in both languages.
- **Telegram language** setting under Settings → Telegram alerts (`alerts.language`, English or Bahasa Indonesia). Panels that already had Telegram alerts set up before 0.6.0 are switched to Indonesian automatically during the upgrade, so their alerts keep the language they had.

### Changed

- **English is the default language** for the web panel, the landing page, the CLI (help, `panel doctor`, `panel init`, `panel rollback`), Telegram alerts, and the offline guides. If you want to keep the CLI in Indonesian after upgrading, set `PANEL_LANG=id` in `~/panel/.env` (or answer Bahasa Indonesia when `panel init` asks).
- The ecosystem block that the panel adds to `ecosystem.config.js` is now `panel-termux:apps v2`, with English comments and log messages. Its code is the same as v1. Setup reports a v1 block as an older version, and **Setup → Fix** updates it with the usual preview, backup, and undo.
- `panel docs paket` is now `panel docs packages`. The old name still works.
- Page anchors are English: Sites `#setup`, `#overview`, `#not-managed`; Administration `#setup`, `#data-key`; Settings `#backup`, `#alerts`, `#sites`, `#monitor`, `#security`; landing `#install`, `#features`, `#how-it-works`, `#limits`, `#screens`. The old Indonesian anchors (`#persiapan`, `#kunci-data`, `#cadangan`, `#pasang`, …) still land on the same place for 0.6.x.
- After deleting your account, the landing page is opened with `?account=deleted` (the old `?akun=dihapus` is still accepted).
- Device names in sessions and the audit log are language-neutral, e.g. "Chrome · Android". Older audit rows ("Chrome di Android") are shown the same way.
- The downloaded data key file is now `panel-termux-data-key-<date>.txt`, and its instructions are in English.
- The data key reset asks you to type `delete` to confirm. The old word `hapus` is still accepted.
- `.env.example` and `panel env` are in English.
- The release `install.sh` shim and the release tarball stay through 0.6.x and are removed in 0.7.0 (0.5.1 said it would go in 0.6.0). New installs should download `panel` and run `panel init`.
- The panel's JavaScript bundle is slightly smaller than in 0.5.1. Indonesian text is loaded only when Indonesian is chosen.

### Fixed

- Links with an anchor (for example `/panel/sites#not-managed`) land on that section even when the page above it is still loading.

### Breaking

- The audit CSV export header is English: `time,actor,actor_email,action,target,ip_masked,request_id` (was `waktu,aktor,email_aktor,aksi,target,ip_tersamar,request_id`). Update scripts that read the CSV by column name.
- The CLI prints English by default. Scripts that match Indonesian CLI output need `PANEL_LANG=id` or `--lang id`.

## [0.5.1] - 2026-11-27

### Added

- `panel init`: one command to install the panel on a new phone, upgrade it, and repair it. Install with one line from the README: `cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init`. Init installs the binary, packages, runit, PostgreSQL, `.env`, the panel service, pm2, the cloudflared tunnel, Termux:Boot, then starts the panel, after printing its plan and asking for approval.
- The mode is chosen from the phone's state: new phone (all steps), upgrade (run the same line again: only the binary is swapped and the panel restarted), or repair (only completes what is missing). A binary older than the installed one is refused with a `panel rollback` hint.
- Init only asks for what is still empty: panel address, admin email, Google Client ID and secret (with the redirect URI printed), and a one-click Cloudflare login. `.env` values are never printed.
- Options `--yes`, `--dry-run` (plan only, changes nothing), `--hostname`, `--admin-email`, `--skip postgres|tunnel|boot`, `--ssh-key <https-url|file|->` (key-only SSH), and `--skip-verify`.
- Self-check: before installing, init matches its binary against its release's `SHA256SUMS`. The release's origin is still proven with `gh attestation verify panel --repo makurosolusi/panel-termux` on a computer.
- Tunnel: a tunnel whose credentials already exist is reused; DNS records pointing to another tunnel are only moved after confirmation in the terminal.
- Releases now include a `panel` asset (raw binary). Tags `v<version>-rc.<n>` are released as prereleases.
- If problems remain at the end, `panel init` exits with code 1 and prints the list of problems with hints, instead of reporting success.

### Changed

- Install, upgrade, and repair now go through `panel init`. Init never runs `pkg upgrade` when PostgreSQL data exists, holds `cloudflared` and `postgresql`, does not touch a hand-written `ecosystem.config.js` (use **Situs → Persiapan → Perbaiki**, Sites → Setup → Fix), never restarts pm2, and only restarts the panel on upgrade.
- The release `install.sh` is now a shim for one release: it downloads `panel`, checks `SHA256SUMS`, then runs `panel init`. The shim is removed in 0.6.0.
- Hints in `panel doctor`, `panel docs`, the CLI help, and the landing page now point to `panel init`.
- Builds without a release tag (local builds) are only installed by `panel init` when `PANEL_DEV_INSTALL=1` is set, because they cannot be checked against `SHA256SUMS`. The bun runtime is never installed.
- Tunnel questions (Cloudflare login, cloudflared restart) are asked before DNS or `config.yml` is changed. Without a terminal, the tunnel is skipped with no changes, the other steps still run, and init exits with code 3.
- New README with feature screenshots, problem solving, and troubleshooting.

### Removed

- `scripts/install-phone.sh`. To test your own build: `rsync --partial dist/panel-android-arm64 poco: && ssh poco 'PANEL_DEV_INSTALL=1 ./panel-android-arm64 init --yes'`.

## [0.5.0] - 2026-11-27

### Added

- Terminal commands in the panel binary (run from `~/panel`): `panel -h`/`--help`/`--h` for help (also `panel <command> --help`) and `panel -v`/`--version`/`--v`, which prints the version, e.g. `panel-termux 0.5.0 (android-arm64, bun 1.x)`.
- `panel doctor [--json]`: checks the phone without changing anything (packages and holds, Termux:Boot/API, runit, `.env`, duplicate panels, the cloudflared `down` file, PostgreSQL version, and the Setup card checks with the same messages). Exit code 1 only on errors; warnings stay 0. `--json` prints the full report to stdout.
- `panel env [--full]`: prints an empty `.env` template to stdout. `panel env > .env.new` is recommended; appending to a `.env` that already has content (`>>`) is refused. `--full` adds the optional variables, commented out with their defaults.
- `panel docs [google|cloudflare|android|paket]`: offline guides. The `paket` topic explains why `cloudflared` and `postgresql` are held from `pkg upgrade` (a cloudflared upgrade can kill the tunnel; a new PostgreSQL major version cannot use old data without a dump and restore) and how to upgrade them safely.
- `panel rollback [--db] [--yes]`: goes back to the previous binary (`panel.prev`) and restarts the panel service. The swap never makes `~/panel/panel` disappear, even if the phone dies midway. If the database has already been migrated by the new version, rollback warns about it; `--db` restores the latest snapshot after saving the current database as `panel.db.before-rollback.<time>` (not removed by snapshot rotation).

### Changed

- `panel` without arguments in a terminal now prints help instead of starting the server. To run the server manually, use `panel serve`. The runit service is unchanged and still starts the server.
- `.env.example` is now generated from the same variable list as `panel env --full`: `APP_BASE_URL` and `SUPER_ADMIN_EMAILS` are empty (not sample values), `PORT` and `PANEL_DATA_DIR` are commented out.
- The installer only replaces `panel.prev` if the installed panel is healthy (or `panel.prev` does not exist yet), so the last healthy version stays available for rollback. The installer's rollback hint is now `panel rollback [--db]`.
- Build and CI now test the same Bun runtime that ships in the binary (1.4.5); the build checks the embedded runtime version and fails if it differs.
- The installer and `panel doctor` count old sample values from `.env.example` (e.g. `https://panel.example.com`) as empty.

### Fixed

- A second panel started while another panel already answers on the same port now exits with code 1 before touching the data key or database.
- Programs run by CLI commands no longer receive secret values from the panel's `.env`.

## [0.4.0] - 2026-11-27

### Added

- **Perbaiki** (Fix) and **Perbaiki semua** (Fix all) buttons on the Setup card (Sites): the panel adjusts `ecosystem.config.js` and the pm2 run script itself, without opening Termux. Before applying, the panel explains what it means in plain language (hand-written apps stay, panel sites are added) with a diff you can open, then validates the result with `node`. If validation fails, the old file stays in use.
- In `ecosystem.config.js` the panel only adds a block marked `panel-termux:apps v1` at the end of the file. Hand-written apps are not changed or restarted; the `pm2-guard` keeper is only added when there are no hand-written apps.
- Per-file **Batalkan perubahan** (Undo changes) after a fix. Copies of files before the fix are kept in `<PANEL_DATA_DIR>/fix-backups/` (the last 10 per file, only on the phone, not included in R2/S3 backups).
- **Mulai ulang pm2 sekarang** (Restart pm2 now) (optional), which checks that all apps are running again, and offers **Kembalikan file ecosystem dan mulai ulang pm2** (Restore the ecosystem file and restart pm2) if any do not come back.
- If a pm2 restart would stop apps not listed in `ecosystem.config.js`, the panel warns by naming those apps and asks you to type `pm2` to continue.
- The **Jalankan pm2** (Start pm2) button is also available inside the pm2 restart dialog.
- **Jalankan pm2** (Start pm2) and **Jalankan postgres** (Start postgres) buttons everywhere that reports those services as down: Setup, the site list and details, Change history, Overview, the Apps and Databases pages. The services also start again after the phone restarts.
- **Jalankan lagi** (Start again) for sites missing from pm2, including adopted sites (loaded from `ecosystem.config.js`).
- Site folders that do not exist yet can be created from the Setup card.
- **Perbaiki** (Fix) can also rebuild a broken `apps.json` from the panel's site list, and create a missing `ecosystem.config.js` from the template. Both can be undone with **Batalkan perubahan** (Undo changes).
- After a fix that only takes effect at the next pm2 start, the Setup card immediately offers **Mulai ulang pm2 sekarang** (Restart pm2 now).
- Domain routes written manually in the cloudflared config can now be removed from the site details by typing the domain name, without ssh.
- Deploying to a panel-created site without a database whose folder is missing recreates that folder. Sites with a database or adopted sites get clear guidance with **Hapus situs** (Delete site) and **Buka Cadangan** (Open Backups) buttons.
- DNS for new sites is created through the phone's cloudflared login (`cert.pem`) when the Cloudflare API token is not set. Deleting that record later still needs a token.
- A ready-to-copy DNS record card (type, name, content, proxy) with **Periksa lagi** (Check again) when the panel cannot create the DNS itself.
- Manual steps for technical users are now in an expandable **Cara manual (untuk pengguna teknis)** (Manual steps, for technical users) section, not in the main message.
- Demo data: `scripts/demo-seed.ts --integration <scenario>` (`ready`, `poco`, `old_spread`, `exotic`, `broken`) to try the Setup card.

### Changed

- The Setup card shows one row per problem, with a clear reason when the panel cannot fix it itself.
- If cloudflared creates the DNS record in another zone, the DNS step is skipped and the site is still created; the panel names the record to delete in the Cloudflare dashboard.
- The `--no-auto-exit` added by the panel takes effect at the next pm2 start; pm2 is not restarted without your approval.
- The Create site wizard summary states the DNS method actually used: API token, the phone's cloudflared login, or a ready-to-copy record card.
- Focus moves to the Setup card after a fix, undo, or restart, so the result can be read right away.
- Notifications (toasts) are loaded lazily, making panel pages about 9 KB lighter on first load.

### Fixed

- `apps.json`, site `.env`, and `config.yml` are written with fsync (file and folder) before rename, so they are not empty if the phone dies right after saving.
- Setup on phones with a hand-written `ecosystem.config.js` that does not mention `apps.json` now shows the actual problem, not irrelevant rows.
- Setup detects an ecosystem that forgot to spread `...panelApps`, also while `apps.json` is still empty.
- Pressing **Mulai ulang pm2 sekarang** (Restart pm2 now) repeatedly (or a request resent by the browser) now waits for the restart in progress instead of returning an "already running" error. The HTTP connection idle limit is raised to 120 seconds.
- The check after a pm2 restart covers all apps that should be running, not only those running before the restart.
- **Batalkan perubahan** (Undo changes) on a file that was changed outside the panel immediately offers **Tetap kembalikan** (Restore anyway).
- **Kembalikan file ecosystem dan mulai ulang pm2** (Restore the ecosystem file and restart pm2) is still offered after a pm2 restart fails repeatedly.
- Restarting a site whose folder is missing fails immediately with a clear message instead of waiting.
- The count of remaining problems on the Setup card stays accurate after **Perbaiki semua** (Fix all).
- Copy buttons and links on phones now have a 44 px touch area.
- The DNS record card is readable at every screen width.

## [0.3.0] - 2026-11-27

### Added

- Install and upgrade from GitHub releases with one command in Termux (`curl -fsSLo install.sh …/releases/latest/download/install.sh && sh install.sh`). The installer checks the phone, free space, and the download's SHA-256 before installing; releases come with a build provenance attestation. On phones without pm2, the pm2 template is installed too.
- An overview that shows problems first (or "Semua sehat", All healthy), with recent activity as sentences, 24-hour/7-day battery and memory charts, the last 30 checks per domain, a Problem history page, and a problem count badge in the menu.
- Background monitoring: the panel periodically checks the phone, services, apps, domains, and backups, and reports when the phone has just rebooted or the panel stopped unexpectedly.
- Telegram notifications: messages when a problem appears, gets worse, is still open after 24 hours, and recovers, with a cooldown so they do not repeat. "Cari chat" (Find chat) and "Kirim pesan uji" (Send test message) buttons in Settings.
- Sites: a Setup page that checks the pm2 integration, adoption of pm2 apps that are already running, a wizard with several domains at once and live checks, an environment variable editor with `.env` paste, "Simpan dan mulai ulang" (Save and restart), which restores the old values if the app fails, a restart button, and per-site health check settings.
- Resumable deploys: an interrupted upload or reloaded page can be continued with "Lanjutkan unggahan" (Resume upload) for 1 hour. Files that are not a supported binary are rejected before being fully uploaded.
- A rollback dialog that names the source and target versions and what is not restored; per-site deploy history.
- Change history shows each step with its duration and log. Changes interrupted by a panel restart show as "Terputus" (Interrupted) and can be recovered.
- Full backups: Postgres roles, every database, site folders (without binaries), tunnel configuration, `panel.db`, and optionally the secret keys, along with `SHA256SUMS` and `manifest.json`. The Backups page shows the last valid backup of each item, the history, and a restore command per item.
- "Pulihkan ke database baru" (Restore to a new database) to test a backup without touching the original database, and a "Restore to a new phone" guide in the README.
- Data key: match/mismatch status, download a copy of the key, and "Hapus pengaturan rahasia lama" (Delete old secret settings) when the key is lost. The panel never deletes secret settings by itself.
- Automatic `panel.db` snapshot before database migrations on upgrade (the last 3 kept in `data/snapshots/`), and rollback instructions in the installer.
- System health with an overall verdict, background process status, the last error, and a 7-step setup guide for the super admin.
- Users: search, role filter, last active, revoke other users' sessions, and "Keluarkan semua pengguna" (Sign out all users). Audit as readable sentences, with action/actor/date filters and CSV export.
- Profile: a list of active sessions that can be revoked, theme choice, and deleting your own account for the `user` role.
- Phone navigation: a top bar with the page title and a bottom bar with a More menu. All buttons and controls are at least 44 px on touch screens.
- An introduction page with a full install guide, limitations, FAQ, real panel screenshots (light and dark), a link preview image (OG) and an iOS home screen icon; `robots.txt` and `sitemap.xml`.
- Optional env variables `PANEL_CONNECTIVITY_URL` (internet check address) and `PANEL_SKIP_SNAPSHOT` (migrate without a snapshot when storage is full).
- MIT license.

### Changed

- The super admin now lands on `/panel`; Administration is in the side menu.
- Settings are split into six groups (Cloudflare, Backups, Telegram notifications, Sites, Monitoring, Security), saved per group, with Cloudflare, S3, and Telegram connection tests. The Cloudflare token can be tested before saving.
- A new `ecosystem.config.js` snippet (`panelApps`) that is safe if `apps.json` is missing or broken and skips entries whose binary does not exist yet. The old `...require("./apps.json")` snippet is flagged as an error in Setup; replace it with the new one (README "pm2 integration"). `apps.json` is created by the panel at start.
- A deploy is only considered healthy if the port answers and pm2 shows the same process with no new restart; the health check time limit can be set per site (10-300 seconds, default 60).
- Backup retention always keeps the latest successful runs (`backup.keep_min_runs`) and the last valid backup of each item. Storage tokens without delete permission are supported; retention is then handed over to the bucket's lifecycle rule.
- Sensitive actions (downloading or resetting the data key, downloading the secrets item, changing the backup target) ask for "Masuk ulang" (Sign in again) if the sign-in is older than 15 minutes. Sessions last at most 30 days.
- The audit log records the actor, masked IP, and device for every change, including new accounts, sign-outs, and session revocations (with the target's name). Entries older than `audit.retention_days` (default 365 days) are deleted automatically.
- The `panel` and `cloudflared` services cannot be stopped from the panel; other core services only by typing their name. Restarting the panel is refused while a site change or backup is running.
- `sv restart panel` waits up to 2 minutes for a running site change before the panel stops.
- Relative times without seconds ("3 mnt lalu", "dalam 5 mnt"), device labels in Indonesian, and log pages that mask known secret values.
- The Cloudflare Access recipe no longer protects `/profile`.
- The `pm2-guard` keeper app is hidden from the Apps list. Do not remove it from `ecosystem.config.js` (README "pm2 integration").
- Fake mode becomes a healthy, fully offline demo phone, with demo files in `<PANEL_DATA_DIR>/fake-home`; `scripts/demo-seed.ts` fills a demo data dir for QA and screenshots.

### Fixed

- The Domains card in the Overview also counts domains held back by other problems.
- Panel sites are now linked to their domain and port in the Apps list, also after "Cek ulang" (Check again).
- Focus returns to the trigger button after the confirmation, adoption, and `.env` paste dialogs close.
- Options in menus and dropdowns are at least 44 px tall on touch screens.
- The add domain dialog cleans up addresses pasted with `https://` or a path.
- "Deploy terakhir" (Last deploy) in the site list and details marks unsuccessful deploys, and the failure reason on the change page is no longer shown twice.
- Pages keep showing the last data without reloading from scratch when a refresh fails.
- Pages that fail to load their parts while the server is unreachable now show "Server panel tidak terjangkau" (Panel server unreachable) inside the app instead of a blank page.
- A battery temperature that cannot be read shows "tidak ada data" (no data), not 0 °C.
- Deleting a site that has a database is refused while a backup is running, and unfinished deploy uploads are deleted along with the site.
- Backups and restores interrupted by a panel restart are marked interrupted instead of running forever.
- Sites recorded in the panel but missing from pm2 are marked "Tidak berjalan di pm2" (Not running in pm2).
- The panel no longer starts a second pm2 daemon while the pm2 service is down; pages show "pm2 tidak berjalan" (pm2 is not running).
- Restore tests finish without reloading the page, and the domain table fits on desktop screens.
- Deleting an account explains that audit records are kept, then returns to the home page with a notice.
- The site list and settings no longer run one database query per item.

### Breaking (admin API)

Only affects scripts that call the panel API directly:

- `PUT /api/dev/settings/:key` is removed; use `PATCH /api/dev/settings` per group.
- Service/app logs are returned as `LogChunk` (`{ lines: [{ at, text, stream? }], cursor, reset, truncated, redacted }`), replacing `LogLines`.
- `Problem.message` is removed; problem text is built from `code` and `params`.

## [0.2.2] - 2026-11-26

### Security

- Requests that change data (starting/stopping services, creating/deleting sites, deploys, changing users and settings, etc.) are now only accepted from the panel's own pages. Other pages, including sites hosted on the same subdomain, can no longer trigger actions on your behalf while you are signed in.

## [0.2.1] - 2026-11-26

### Fixed

- A panel behind Cloudflare Access immediately shows the Access login when there is no session or it has expired, instead of a network error.

## [0.2.0] - 2026-11-26

### Added

- A public introduction page at `/` that can be opened without signing in: why a spare phone, features, install steps, a tunnel diagram, and FAQ. Its button is "Masuk dengan Google" (Sign in with Google) for visitors or "Buka panel" (Open panel) to the role's home page when signed in. After Google sign-in you still go straight to your role's home page, and unknown addresses now show the introduction page.

### Fixed

- `scripts/install-phone.sh` now runs `sv restart panel` successfully when called over ssh (previously `sv` could not find the service because `SVDIR` was not set).

## [0.1.0] - 2026-11-26

### Added

- Google sign-in for all Google accounts with three roles: `user` (/profile), `admin` (/panel) and `super_admin` (/dev). New accounts start as `user`; the super admin makes them `admin` under /dev → Users. Super admins come from `SUPER_ADMIN_EMAILS` and are re-synced on every sign-in and every panel start.
- Opening the panel through another address redirects to `APP_BASE_URL` automatically, so Google sign-in always runs on the registered address.
- Dev console (/dev): panel health, user and role management, audit log, panel log, and runtime settings (Cloudflare, site folder and ports, protected services, backup). Secret values are stored encrypted and never shown again.
- Panel (/panel): device overview (battery, temperature, memory, storage, load), runit services and pm2 apps with start/stop/restart buttons and their logs, a list of tunnel domains with health checks, and a list of Postgres databases.
- Sites: create a new site (folder, optional Postgres database, `.env`, pm2 entry in `apps.json`, cloudflared ingress, Cloudflare DNS CNAME) as a staged job that rolls back automatically on failure; adopt hand-written existing sites; add/remove hostnames; edit `.env`; delete sites.
- Browser binary deploys for sites with chunked uploads (safe behind Cloudflare's 100 MB limit), automatic detection of Android (runs directly) or glibc (through `grun`) binaries, a health check after restart, automatic rollback on failure, and a button to go back to the previous version.
- Daily backups to S3/Cloudflare R2: a dump of every Postgres database and `panel.db`, automatic retention, manual runs, temporary download links, and restore instructions per item.
- A single binary for Termux (`dist/panel-android-arm64`) that runs directly without `grun`, plus a runit run script and `scripts/install-phone.sh` to install/upgrade on the phone.
