# Jadwal implementasi global — Panel Termux v0.3.0

> wkr-critic-x · 2026-11-26 · branch `feature/production-polish`. Disusun dari PLAN/01–05 versi revisi, jawaban debat
> (`PLAN/debate/*-response.md`), hasil lab pm2 (`PLAN/debate/03-pm2-lab-results.md`), dan arbitrase **mengikat**
> `PLAN/DECISIONS.md` (A1–A12, B1–B26). Lingkup **penuh** (A8): tidak ada fitur yang ditunda. Jadwal pangkas di
> `debate/00-integration-critique.md` §4–5 **digantikan** dokumen ini.
>
> Tabel kepemilikan file di §2 dibangkitkan dari satu daftar data dan diperiksa mesin
> (`scratchpad/xcrit/sched.py`): **tidak ada file dengan dua pemilik dalam satu gelombang**, termasuk W2 ∪ W3 yang boleh
> berjalan bersamaan. Pola `dir/*` dianggap mencakup semua file di bawahnya saat pemeriksaan.

## Ringkasan

| Gelombang | Isi                                                                      | Worker                | Perkiraan baris (kode + test) |
| --------- | ------------------------------------------------------------------------ | --------------------- | ----------------------------- |
| pra-W0    | Merge `main` (hotfix CSRF 0.2.2) → branch (B17)                          | orkestrator           | ±10                           |
| W0        | Pecah `index.ts` + semua kontrak shared                                  | 2                     | ±1.450                        |
| W1        | Server dasar: HTTP/CSRF, migrasi, adapter, settings, runner, aturan      | 6                     | ±3.950                        |
| W2        | Layanan server: kunci data, audit/sesi, cadangan, monitor, situs, deploy | 6                     | ±5.000                        |
| W3        | Fondasi web + distribusi + i18n admin + SEO (boleh paralel dengan W2)    | 6                     | ±3.550                        |
| W4        | Shell layout + API panel + server admin + wiring boot                    | 5                     | ±2.650                        |
| W5        | Halaman web gelombang 1                                                  | 6                     | ±4.700                        |
| W6        | Halaman web gelombang 2 + histori monitor                                | 5                     | ±3.100                        |
| W7        | Pembersihan + seed demo + `server-termux` (bergerbang)                   | 3                     | ±700                          |
| W8        | QA browser (ego-browser)                                                 | 3                     | – (laporan)                   |
| W9        | Perbaikan hasil QA                                                       | ≤ 6                   | ±800 (perkiraan)              |
| W10       | Screenshot landing/OG + dokumen + versi 0.3.0                            | 2                     | ±850                          |
| R         | Rilis: checklist, dry run, tag pemilik, deploy POCO                      | orkestrator + pemilik | –                             |

Total: **12 gelombang kerja (W0–W10 + R)**, **41 worker bernama + 3 QA + ≤ 6 perbaikan**, sekitar **±26.700 baris**
termasuk test. Angka ini adalah jumlah perkiraan per worker. Bila dihitung dari total yang ditulis tiap PLAN, hasilnya
±23.000. Selisihnya ada di bagian bersama (kontrak, adapter, HTTP) yang tidak dihitung PLAN mana pun.

Jalur kritis:

```
pra-W0 merge → W0 kontrak → W1 adapter/db/settings/runner → W2 situs & monitor
→ W4 API panel + boot (+ shell layout dari W3) → W5 halaman → W6 halaman → W7 cleanup
→ W8 QA → W9 perbaikan → W10 dokumen → R
```

W3 tidak berada di jalur kritis bila dijalankan bersamaan dengan W2 (file tidak bersinggungan, sudah diperiksa).

---

## 1. Aturan yang berlaku di setiap gelombang

1. **Satu pemilik per file per gelombang.** Kepemilikan berpindah hanya di batas gelombang. Worker dilarang
   commit/push/ganti branch (Rule 23). Orkestrator yang commit per worker setelah review: satu concern = satu commit (Rule 9).
2. **Spec worker mengutip tanda tangan dari PLAN secara harfiah.** Contohnya PLAN/01 §3.3/§3.5 (`DataTable.actions`,
   `useApiQuery(url, refreshMs, {enabled})`, `ConfirmAction tier "confirm"|"typed"`) dan PLAN/04 §3.7. Kebutuhan
   perubahan pada komponen bersama di tengah gelombang dicatat dan dikerjakan di gelombang berikutnya oleh pemiliknya,
   tidak boleh diedit sendiri.
3. **i18n**: file i18n baru diimpor langsung oleh domainnya. `src/web/i18n/id.ts` hanya disentuh `wkr-shell-core-01`
   (W3) dan `wkr-shell-cleanup-04` (W7).
4. **Kontrak W0 bersifat aditif.** Field baru opsional dan tipe lama di-alias, supaya `bun run typecheck` tetap hijau
   sampai konsumennya pindah. Tipe dikencangkan di W7.
5. **Gerbang standar setiap akhir gelombang** (dijalankan orkestrator, semuanya wajib hijau sebelum gelombang berikutnya):
   `bun run typecheck` · `bun run lint` · `bun test` · `bun run build:local` · grep secret/PII di diff (Rule 7/12) ·
   batas file Rule 8 (500 baris / 20.000 karakter). Gerbang tambahan per gelombang ada di §2.
6. Worker yang mengubah perilaku publik menulis test-nya dalam pekerjaan yang sama (Rule 3). Dokumen README/CHANGELOG
   ditulis **sekali** di W10 (Rule 23), dari catatan "untuk docs" yang ditinggalkan tiap worker di laporannya.

---

## 2. Gelombang, worker, file

### pra-W0 — merge `main` (orkestrator, B17)

1. `git fetch && git merge main` di `feature/production-polish` (main = `112de15`, 0.2.2, hotfix CSRF).
2. Konflik yang diharapkan hanya `src/server/routes/api.routes.ts` (sudah diuji kering dengan `git merge-tree`).
   Resolusi: ambil versi branch (`/ready`, `createMeRoutes`, `siteJobs`) **ditambah** baris
   `.onRequest(({ request }) => rejectForeignOrigin(request, auth.options.baseURL) ?? undefined)` dari main, supaya
   perilakunya identik dengan produksi 0.2.2. `tests/{dev,panel}.api.test.ts` ter-auto-merge. `package.json` dan
   `CHANGELOG.md` ikut 0.2.2.
3. Gerbang: `bun test` (termasuk `tests/csrf.origin.test.ts`), `bun run typecheck`, `bun run lint`.
4. Commit `chore(merge): bring CSRF origin guard from main` (tanpa push; Rule 1).

### W0 — fondasi

<!-- WAVE:W0 -->
| Worker             | Menutup | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Bergantung   | Ukuran   |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- |
| `wkr-refactor-00`  | 04/B16  | `src/server/index.ts`, `src/server/boot.ts`, `src/server/http/spa.serve.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | pra-W0 merge | S ±150   |
| `wkr-contracts-00` | semua   | `src/shared/log.types.ts`, `src/shared/log.time.ts`, `src/shared/format.id.ts`, `src/shared/monitor.types.ts`, `src/shared/panel.types.ts`, `src/shared/site.types.ts`, `src/shared/deploy.types.ts`, `src/shared/env.codec.ts`, `src/shared/backup.types.ts`, `src/shared/security.types.ts`, `src/shared/dev.types.ts`, `src/shared/audit.types.ts`, `src/shared/roles.ts`, `src/server/routes/http.error.ts`, `src/server/monitor/monitor.contract.ts`, `tests/log.time.test.ts`, `tests/format.id.test.ts`, `tests/env.codec.test.ts`, `tests/roles.test.ts` | pra-W0 merge | L ±1.300 |
<!-- /WAVE -->

- `wkr-refactor-00`: pindahkan `start()` ke `boot.ts` dan `servePanel`/`canonicalRedirect`/`pageCspCache` ke
  `http/spa.serve.ts`. `index.ts` hanya me-re-export dan menjalankan `import.meta.main` (≤ 30 baris). Tanpa perubahan
  perilaku. Test yang mengimpor dari `@/server/index` (`server.health`, `server.origin`, `server.http`, `csrf.origin`)
  tetap jalan lewat re-export.
- `wkr-contracts-00` menulis semua tipe shared dari: PLAN/01 §3.4 & §3.13; PLAN/02 §3.1–3.3; PLAN/03 §3.1–3.2 +
  `env.codec.ts` (B23); PLAN/04 §3.1–3.3, §3.8, kode §3.9; PLAN/05 §3.1. Termasuk `homeFor(super_admin)="/panel"` (A11/B19),
  `SPA_ROOTS`/`isKnownSpaPath`/`isProtectedPath`, `SITE_BINARY_NAMES`, `PM2_GUARD_NAME="pm2-guard"` (B24),
  `ApiError` status kanonik `400|401|403|404|409|410|421|429|502|503|507` + `extra`, serta `monitor.contract.ts`
  (antarmuka `monitor.status()` B5).
  - `log.time.ts` (`splitLogTimestamp`, B13) dan `format.id.ts` dipindah ke W0, bukan W3 seperti di PLAN/01 §7.1,
    karena `wkr-mon-rules-01` dan `wkr-mon-core-02` memakainya lebih dulu.
- **Gerbang tambahan**: `tests/{log.time,format.id,env.codec,roles}.test.ts` hijau. Konsumen lama masih terkompilasi.

### W1 — server dasar (6 worker)

<!-- WAVE:W1 -->
| Worker                | Menutup                                 | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                            | Bergantung | Ukuran   |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| `wkr-http-01`         | 04 K1/K2/K11/K16/K17, 01 §3.12, B11/B17 | `src/server/http/api.handler.ts`, `src/server/http/spa.serve.ts`, `src/server/http/request.context.ts`, `src/server/http/security.headers.ts`, `src/server/routes/origin.guard.ts`, `src/server/routes/api.routes.ts`, `tests/server.http.test.ts`, `tests/server.origin.test.ts`, `tests/csrf.origin.test.ts`, `tests/server.serve.test.ts` | W0         | M ±450   |
| `wkr-db-01`           | 04 §3.4, 03 §3.3, 02 §3.4, B15          | `src/server/db/schema/*`, `drizzle/0006_data_safety.sql`, `drizzle/0007_sites_lifecycle.sql`, `drizzle/0008_monitor.sql`, `drizzle/meta/*`, `drizzle/migrations.js`, `tests/db.migrate.test.ts`                                                                                                                                              | W0         | M ±450   |
| `wkr-adapters-01`     | 02 §3.5, 03 §3.7, 04 §3.7, B14/B21      | `src/server/system/*`, `tests/panel.parsers.test.ts`, `tests/termux.exec.test.ts`, `tests/system.fake.test.ts`                                                                                                                                                                                                                               | W0         | L ±750   |
| `wkr-settings-01`     | 05 K1–K3, 02 §3.6, 04 §3.5, B8          | `src/server/settings.registry.ts`, `src/server/settings.service.ts`, `src/server/routes/dev.routes.ts`, `src/server/auth/role.guard.ts`, `tests/dev.settings.test.ts`, `tests/dev.api.test.ts`                                                                                                                                               | W0         | L ±600   |
| `wkr-sites-runner-01` | 03 W1, 02 marker                        | `src/server/sites/job.runner.ts`, `src/server/sites/job.legacy.ts`, `src/server/shutdown.ts`, `tests/site.harness.ts`, `tests/job.runner.test.ts`, `tests/server.shutdown.test.ts`                                                                                                                                                           | W0         | M ±500   |
| `wkr-mon-rules-01`    | 02 §3.1, 04 §3.9, B2–B4                 | `src/server/panel/overview.problems.ts`, `src/shared/problem.copy.ts`, `src/server/alerts/alert.engine.ts`, `src/server/alerts/telegram.client.ts`, `src/server/alerts/alert.messages.ts`, `tests/panel.problems.test.ts`, `tests/alert.engine.test.ts`, `tests/telegram.client.test.ts`                                                     | W0         | L ±1.200 |
<!-- /WAVE -->

- `wkr-http-01`:
  - Guard CSRF dipindah ke awal `createApiHandler`, sebelum rate limit (B17). `.onRequest` dihapus.
  - `createApiHandler(api, { appBaseUrl })`; host check 421 (K2); `request.context` (K11); `accessSeen` (K18).
  - Header B11: HTML `no-cache`, aset ber-hash `immutable` lewat bundle internal, chunk hilang 404 `text/plain`
    `no-store`, `/__spa` 404, `/api/*` `no-store`.
  - `csrf.origin.test.ts` dikomposisi lewat `servePanel`/`createApiHandler`. `MUTATIONS` memuat `PATCH /api/dev/settings`
    menggantikan `PUT`, ditambah kasus "61 POST asing lalu 1 POST sah → 200".
  - `server.serve.test.ts` menjalankan binary `build:local` untuk header aset.
- `wkr-db-01`: migrasi berurutan 0006 → 0007 → 0008 (B15). Generate → edit `IF NOT EXISTS` → setiap pernyataan dipisah
  `--> statement-breakpoint`. 0008 memuat `metric_sample`, `check_result`, `problem_event` (A8).
  `db.migrate.test.ts`: DB 0.2.2 berisi data → 0008, backfill `actor_kind`.
- `wkr-adapters-01`: semua tambahan adapter 02/03/04, termasuk `Pm2UnavailableError` (pm2 CLI tidak dipanggil bila
  runit `pm2` tidak `run`, B14), `httpStatus(port, path, timeoutMs, host?)` (B21), `pm2-guard` sebagai modul,
  `PostgresAdapter` + `ArchiveAdapter`, dan data fake.
- `wkr-settings-01`: `settings.registry.ts` (semua kunci di satu `SETTING_KEYS`, validator, tanpa label), `PATCH` atomik,
  `PUT /:key` dihapus, `KeyMismatchError`, `unreadableSecretSettings`, `monitor.battery_warn_percent` (B3). Bagian
  settings di `dev.api.test.ts` dipindah ke `dev.settings.test.ts`. Stub `assertFresh` di `role.guard.ts`
  (signature PLAN/04 §3.7, diisi `wkr-audit-02`).
- `wkr-sites-runner-01`: kode/params langkah, `interrupted`, `save()` aman, `isLocked`/`active()`, shutdown 120 dtk +
  marker `data/clean-shutdown` (titipan 02).
- `wkr-mon-rules-01`: semua aturan masalah di satu file (B2), termasuk kode 04 (`key_mismatch`, `access_not_seen`
  info, `backup_secrets_included`, `backup_item_stale`), `site_job_failed`, baterai B3 (tanpa `battery_unplugged`), info
  B4 (tidak dikirim ke Telegram). Mesin alert + klien Telegram.
- **Gerbang tambahan**:
  - `bun test tests/csrf.origin.test.ts tests/server.serve.test.ts` hijau pada binary.
  - Migrasi dijalankan pada salinan `panel.db` 0.2.x lokal (Rule 4), lalu `sqlite3 … ".schema audit_log"` diverifikasi.
  - `curl -sI` aset/HTML/`__spa` sesuai tabel B11.

### W2 — layanan server (6 worker; boleh berjalan bersamaan dengan W3)

<!-- WAVE:W2 -->
| Worker                 | Menutup                                        | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Bergantung                | Ukuran   |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------- |
| `wkr-keys-02`          | 04 K8/K9, F7/F8                                | `src/server/secret.ts`, `src/server/data-key.service.ts`, `src/server/db/snapshot.ts`, `src/server/routes/security.routes.ts`, `tests/secret.test.ts`, `tests/data-key.test.ts`, `tests/db.snapshot.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W1 settings, db           | M ±450   |
| `wkr-audit-02`         | 04 K11–K14, F9, B6                             | `src/server/audit.service.ts`, `src/server/auth/*`, `src/server/routes/me.routes.ts`, `tests/auth.test.ts`, `tests/me.sessions.test.ts`, `tests/audit.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | W1 db, http, settings     | L ±500   |
| `wkr-backup-engine-02` | 04 K3–K7, K10, F2–F5, F10, B7                  | `src/server/backup/*`, `tests/backup.api.test.ts`, `tests/backup.config.test.ts`, `tests/backup.retention.test.ts`, `tests/backup.restore.test.ts`, `tests/backup.verify.test.ts`, `tests/backup.s3mock.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | W1 adapters, db, settings | L ±900   |
| `wkr-mon-core-02`      | 02 §3.5 (sampler, snapshot, histori, redaksi)  | `src/server/monitor/monitor.snapshot.ts`, `src/server/monitor/monitor.sampler.ts`, `src/server/monitor/monitor.service.ts`, `src/server/monitor/monitor.history.ts`, `src/server/system/log.redact.ts`, `tests/monitor.snapshot.test.ts`, `tests/monitor.sampler.test.ts`, `tests/monitor.history.test.ts`, `tests/log.redact.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W1 adapters, rules, db    | L ±950   |
| `wkr-sites-server-02`  | 03 W2 (setup, adopsi, job, env, pemulihan B26) | `src/server/sites/site.service.ts`, `src/server/sites/site.adopt.ts`, `src/server/sites/adopt.candidates.ts`, `src/server/sites/site.env.service.ts`, `src/server/sites/integration.service.ts`, `src/server/sites/ecosystem.probe.ts`, `src/server/sites/job.recovery.ts`, `src/server/sites/site.jobs.ts`, `src/server/sites/site.steps.ts`, `src/server/sites/site.checks.ts`, `src/server/sites/env.file.ts`, `src/server/sites/apps.file.ts`, `src/server/sites/site.secrets.ts`, `src/server/cloudflare/dns.provider.ts`, `src/server/routes/sites.routes.ts`, `tests/site.create.test.ts`, `tests/site.manage.test.ts`, `tests/site.files.test.ts`, `tests/site.adopt.test.ts`, `tests/site.recovery.test.ts`, `tests/site.integration.test.ts`, `tests/ecosystem.snippet.test.ts`, `tests/cloudflare.dns.test.ts` | W1 runner, adapters, db   | L ±1.200 |
| `wkr-deploy-server-02` | 03 W2 (unggah, swap, health, rollback)         | `src/server/deploy/*`, `src/server/routes/deploy.routes.ts`, `tests/deploy.api.test.ts`, `tests/deploy.elf.test.ts`, `tests/deploy.health.test.ts`, `tests/deploy.upload.test.ts`, `tests/deploy.swap.test.ts`, `tests/deploy.fixture.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | W1 runner, adapters, db   | L ±1.000 |
<!-- /WAVE -->

- `wkr-keys-02`: key-check, mode mismatch, reset (typed, sesi segar), unduh kunci data, snapshot pra-migrasi (B10),
  route `revoke-all`.
- `wkr-audit-02`: kolom audit + isi dari konteks request, `getSessionChecked` (umur absolut 30 hari),
  `assertFresh`, `revokeUserSessions` (409 `self` saja, B6), `revokeAllSessions`, `handleAuthRequest`, `pruneAudit`,
  `listAudit` dengan `action[]` + `from/to`.
- `wkr-backup-engine-02`: cakupan + manifest + checksums, retensi berbasis catatan, verifikasi, `POST /api/dev/backup/verify`
  (B7), pulihkan ke database baru (A8), `lastGoodItem`, `busy()`, `backupScheduler.lastTickAt()` (B5), `pruneAudit` di
  tick harian.
- `wkr-mon-core-02`: snapshot cache, sampler (single-flight), histori 7 hari + retensi + `loadBaseline`,
  `redactLines(lines, extraSecrets)` (B22), `monitor.status()`.
- `wkr-sites-server-02`: integrasi (`apps.json`, probe B25 `{loadedAppsJson, names, envKeys}` + `snippetCurrent`,
  snippet `existsSync` wajib B18), adopsi, job create/delete/hostname/env/restart, `POST /jobs/:id/recover` (B26),
  `siteSecretsFor`, `ensureAppsJson`, penolakan nama `pm2-guard` (B24).
- `wkr-deploy-server-02`: unggah bisa dilanjut, sha per potongan, `swap.ts` (hardlink atau copy menurut E9), health
  (pid valid + probe port, B18), rollback, pemulihan deploy.
- **Gerbang tambahan**: `bun test tests/{backup,monitor,site,deploy,audit,data-key}*.test.ts`. Test redaksi: tidak ada
  token di log ring atau respons. E9 sudah tercatat sebelum `wkr-deploy-server-02` mengunci `swap.ts`.

### W3 — fondasi web, distribusi, i18n admin, SEO (6 worker; boleh paralel dengan W2)

<!-- WAVE:W3 -->
| Worker              | Menutup                             | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Bergantung                    | Ukuran   |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------- |
| `wkr-shell-core-01` | 01 §3.1, §3.5, §3.10, §3.14         | `src/web/shared/poller.ts`, `src/web/shared/use-poller.ts`, `src/web/shared/use-api-query.ts`, `src/web/shared/use-log-follow.ts`, `src/web/shared/format.ts`, `src/web/shared/chunk.error.ts`, `src/web/shared/api.client.ts`, `src/web/shared/api.action.ts`, `src/web/components/status.vocab.ts`, `src/web/components/status.tone.ts`, `src/web/components/log.buffer.ts`, `src/web/components/now.store.ts`, `src/web/i18n/id.status.ts`, `src/web/i18n/id.shell.ts`, `src/web/i18n/id.common.ts`, `src/web/i18n/id.ts`, `tests/web.status.test.ts`, `tests/web.polling.test.ts`, `tests/web.log-buffer.test.ts`, `tests/web.api-client.test.ts`, `tests/web.chunk.test.ts`, `tests/web.shell.test.ts`      | W0                            | M ±900   |
| `wkr-shell-ui-01`   | 01 §3.2, §3.3, §3.8, §3.9           | `src/web/components/page-header.tsx`, `src/web/components/query-view.tsx`, `src/web/components/error-state.tsx`, `src/web/components/empty-state.tsx`, `src/web/components/data-table.tsx`, `src/web/components/use-page-param.ts`, `src/web/components/search-field.tsx`, `src/web/components/stat-tile.tsx`, `src/web/components/section.tsx`, `src/web/components/status-badge.tsx`, `src/web/components/status-icon.tsx`, `src/web/components/relative-time.tsx`, `src/web/components/copy-button.tsx`, `src/web/components/confirm-action.tsx`, `src/web/components/action-bar.tsx`, `src/web/components/ui/*`, `src/web/styles.css`, `src/web/shared/query.state.tsx`, `src/web/shared/confirm.dialog.tsx` | W0 (tipe 01 dikunci di PLAN)  | L ±1.000 |
| `wkr-shell-log-01`  | 01 §3.4                             | `src/web/components/log-viewer.tsx`, `src/web/components/log-lines.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | W0                            | S ±250   |
| `wkr-dist-01`       | 05 §3.7, 04 §3.9.3, 03 §7.2, B9/B10 | `LICENSE`, `package.json`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/install-phone.sh`, `scripts/install-phone.test.sh`, `scripts/package-release.sh`, `scripts/install-release.sh`, `scripts/install-release.test.sh`, `scripts/package-release.test.sh`, `deploy/pm2/*`                                                                                                                                                                                                                                                                                                                                                                                  | W0; template pm2 menunggu E10 | M ±700   |
| `wkr-adm-i18n-01`   | 05 §5 copy                          | `src/web/i18n/id.dev.ts`, `src/web/i18n/id.dev.health.ts`, `src/web/i18n/id.dev.setup.ts`, `src/web/i18n/id.dev.users.ts`, `src/web/i18n/id.dev.audit.ts`, `src/web/i18n/id.dev.logs.ts`, `src/web/i18n/id.settings.ts`, `src/web/i18n/id.account.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | W0                            | M ±400   |
| `wkr-adm-seo-01`    | 05 K16/K17 §3.6                     | `src/server/http/seo.ts`, `src/server/http/spa.serve.ts`, `src/web/assets/og.png`, `src/web/assets/apple-touch-icon.png`, `tests/server.seo.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W1 http                       | M ±300   |
<!-- /WAVE -->

- `wkr-shell-core-01`: kamus status B12 (beku setelah W3). `rolled_back` = "Dikembalikan"/warning (A10). `interrupted` =
  "Terputus"/warning. Kunci domain verdict dan `key_mismatch`. `usePoller` primitif tunggal (B13), `useLogFollow`, 403 →
  `/login` (B20), copy key §3.14.
- `wkr-shell-ui-01`: komponen bersama + primitive `ui/*` + token. Termasuk satu baris import di pemakai
  `LegacyConfirmAction`; itu satu-satunya sentuhan ke folder domain, dan tidak ada pemilik lain di W3.
- `wkr-shell-log-01`: `LogViewer` (props PLAN/01 §3.4).
- `wkr-dist-01`:
  - LICENSE MIT "makurosolusi" (A6).
  - `release.yml` (`workflow_dispatch` `dry_run`, tag = versi `package.json`, aset B9, `actions/attest@v4` dipin SHA,
    `permissions: {}` + per job).
  - `ci.yml` (gerbang PLAN/04 §3.9.3 + 3 test shell + `scripts/bundle-report.ts`; skripnya dibuat W4) dan `dependabot.yml`.
  - `install-phone.sh` (`sv -w 130`, preflight ruang, petunjuk rollback; tanpa snapshot, B10).
  - `deploy/pm2/*`: template dari PLAN/03 §7.2. **Penjaga `pm2-guard` hanya bila E10 lulus**; bila belum, file template
    ditulis paling akhir di gelombang ini.
- `wkr-adm-i18n-01`: memecah `id.dev.ts`, membuat `id.settings.ts` (semua `SETTING_KEYS`) dan `id.account.ts`. Tidak
  menyentuh `id.ts`.
- `wkr-adm-seo-01`: `seo.ts` murni + merangkainya di `spa.serve.ts` (`/robots.txt`, `/sitemap.xml`, `/og.png`,
  `/apple-touch-icon.png`, status 404 + `noindex` untuk path tak dikenal A7, OG untuk `/`). Gambar placeholder bermerek.
- **Gerbang tambahan**:
  - `sh scripts/install-phone.test.sh`, `install-release.test.sh`, dan `package-release.test.sh` hijau.
  - `actionlint` bila tersedia.
  - `bun test tests/server.seo.test.ts`.
  - Review keamanan diff `.github/*` oleh orkestrator dengan checklist PLAN/04 §3.9.3, tanpa edit oleh PLAN/04.

### W4 — shell layout, API panel, server admin, boot (5 worker)

<!-- WAVE:W4 -->
| Worker                | Menutup                                | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Bergantung                                 | Ukuran |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| `wkr-shell-nav-02`    | 01 §3.7, §3.11, §3.13                  | `src/web/layout/*`, `src/web/session/*`, `src/web/pages/route-error.page.tsx`, `src/web/pages/not-found.page.tsx`, `src/web/pages/public-not-found.page.tsx`, `src/web/router.tsx`, `src/web/app.routes.tsx`, `src/web/panel/panel.routes.tsx`, `src/web/site/site.routes.tsx`, `src/web/backup/backup.routes.tsx`, `src/web/dev/dev.routes.tsx`, `src/web/panel/panel.layout.tsx`, `src/web/dev/dev.layout.tsx`, `src/web/index.html`, `scripts/build.ts`, `scripts/bundle-report.ts`, `src/web/landing/landing.page.tsx`, `src/web/pages/login.page.tsx`, `docs/content-guide.md`, `tests/web.session.test.ts`, `tests/web.shell.test.ts` | W3 core, ui, log                           | L ±800 |
| `wkr-mon-api-03`      | 02 §3.7, K16                           | `src/server/panel/panel.service.ts`, `src/server/panel/domain.health.ts`, `src/server/routes/panel.routes.ts`, `src/server/routes/alerts.routes.ts`, `src/server/http/request.log.ts`, `src/server/log.service.ts`, `tests/panel.api.test.ts`, `tests/alerts.api.test.ts`, `tests/dev.logs.test.ts`                                                                                                                                                                                                                                                                                                                                         | W2 mon-core, sites-server, backup-engine   | M ±700 |
| `wkr-adm-server-01`   | 05 §3.3–3.4, B5/B6                     | `src/server/dev/health.service.ts`, `src/server/dev/setup.service.ts`, `src/server/dev/users.service.ts`, `src/server/dev/audit.export.ts`, `src/server/routes/dev.admin.routes.ts`, `src/server/routes/me.routes.ts`, `tests/dev.health.test.ts`, `tests/dev.setup.test.ts`, `tests/dev.api.test.ts`                                                                                                                                                                                                                                                                                                                                       | W2 keys, audit, backup-engine, mon-core    | L ±700 |
| `wkr-adm-cfverify-01` | 05 W3 (CloudflareVerify)               | `src/server/cloudflare/dns.provider.ts`, `src/server/cloudflare/cloudflare.routes.ts`, `tests/cloudflare.verify.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W2 sites-server                            | S ±150 |
| `wkr-boot-03`         | 04 F7, 02 boot, 03 ensureAppsJson, B16 | `src/server/boot.ts`, `src/server/routes/api.routes.ts`, `tests/server.health.test.ts`, `tests/server.boot.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | W2 semua + nama route W4 (dikunci di spec) | M ±300 |
<!-- /WAVE -->

- `wkr-shell-nav-02`: router `lazy` + `splitting: true`, bottom bar + sheet "Lainnya", top bar, fokus route, 404 publik
  sisi klien (A7), file route domain (`panel/site/backup/dev.routes.tsx`, kemudian dimiliki domain), `useDocumentTitle`
  di landing/login, `scripts/bundle-report.ts`.
- `wkr-mon-api-03`: endpoint 02 §3.7, termasuk `/panel/status`, `/metrics`, `/problems/history`, unduh log + audit
  `log.download`, `alerts/test`, `alerts/telegram/chats` (B1), restart `panel`/`cloudflared` 202. Restart `panel`
  ditolak bila `jobs.active() || backup.busy()`. Request log GET < 400 = debug.
- `wkr-adm-server-01`: `/dev/health` (B5: `monitor.status()` + `lastTickAt()`; info B4 tidak menurunkan vonis), setup,
  users (+ cabut sesi B6), audit CSV, `DELETE /api/me` di `me.routes.ts`.
- `wkr-adm-cfverify-01`: `CloudflareVerify` berkode. Bergantung pada `wkr-sites-server-02` (W2) yang sudah selesai
  mengubah `dns.provider.ts`.
- `wkr-boot-03`:
  - Urutan boot F7: secret → db → snapshot → migrasi → key-check → `ensureAppsJson` → sampler → scheduler.
  - `bootId` di `/health`; marker shutdown bersih.
  - Mount `alerts.routes`, `security.routes`, `dev.admin.routes`, `handleAuthRequest` di `api.routes.ts`. Nama ekspor
    dikunci di spec, karena `wkr-mon-api-03`/`wkr-adm-server-01` menulisnya di gelombang yang sama.
- **Gerbang tambahan**:
  - Server lengkap jalan dalam mode fake (`bun run build:local`, binary di scratchpad, env dummy).
  - `curl` semua endpoint baru → 401 tanpa sesi, 403 tanpa `X-Requested-With`.
  - `bun test tests/server.boot.test.ts` (boot dua kali, snapshot dibuat sekali per migrasi tertunda).
  - Laporan ukuran bundle: `/` ≤ 150 KB gzip, `/panel` awal ≤ 200 KB.

### W5 — halaman web 1 (6 worker)

<!-- WAVE:W5 -->
| Worker                    | Menutup                                                     | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Bergantung                     | Ukuran |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------ |
| `wkr-mon-web-03`          | 02 §5 (Ringkasan, Layanan, Aplikasi, Domain, Database, Log) | `src/web/panel/*`, `src/web/i18n/id.panel.ts`, `src/web/i18n/id.overview.ts`, `tests/web.panel.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | W4 nav, mon-api                | L ±900 |
| `wkr-sites-web-list-03`   | 03 §5.1–5.3                                                 | `src/web/site/sites.page.tsx`, `src/web/site/site.setup.tsx`, `src/web/site/site.discovered.tsx`, `src/web/site/adopt.dialog.tsx`, `src/web/site/site.adopt.ts`, `src/web/site/site-new.page.tsx`, `src/web/site/wizard.target.tsx`, `src/web/site/wizard.options.tsx`, `src/web/site/wizard.summary.tsx`, `src/web/site/form.field.tsx`, `src/web/site/site.api.ts`, `src/web/site/site.check.ts`, `src/web/site/site.routes.tsx`, `src/web/site/site.card.tsx`, `src/web/site/integration.banner.tsx`, `src/web/i18n/id.site.ts`, `tests/web.site.test.ts` | W4 nav; W2 sites-server        | L ±900 |
| `wkr-sites-web-detail-03` | 03 §5.4, §5.6                                               | `src/web/site/site-detail.page.tsx`, `src/web/site/site.header.tsx`, `src/web/site/site.anchors.tsx`, `src/web/site/site.hostnames.tsx`, `src/web/site/site.env-editor.tsx`, `src/web/site/env.editor.tsx`, `src/web/site/env.rows.ts`, `src/web/site/env.paste.ts`, `src/web/site/site.settings.tsx`, `src/web/site/site.delete.tsx`, `src/web/i18n/id.site-detail.ts`, `tests/web.site-detail.test.ts`                                                                                                                                                     | W4 nav; W2 sites-server        | L ±850 |
| `wkr-sites-web-deploy-03` | 03 §5.5, deploy                                             | `src/web/deploy/*`, `src/web/site/job.page.tsx`, `src/web/site/job.steps.tsx`, `src/web/site/job.state.ts`, `src/web/site/jobs.page.tsx`, `src/web/site/job.failure.tsx`, `src/web/site/job.status-key.ts`, `src/web/i18n/id.deploy.ts`, `src/web/i18n/id.job.ts`, `tests/web.deploy.test.ts`                                                                                                                                                                                                                                                                | W4 nav; W2 deploy-server       | L ±950 |
| `wkr-backup-web-03`       | 04 §5.1–5.3                                                 | `src/web/backup/*`, `src/web/security/*`, `src/web/i18n/id.backup.ts`, `src/web/i18n/id.security.ts`, `tests/web.backup.test.ts`, `tests/web.security.test.ts`                                                                                                                                                                                                                                                                                                                                                                                               | W4 nav; W2 backup-engine, keys | L ±700 |
| `wkr-adm-health-web-01`   | 05 §5.1                                                     | `src/web/dev/health.page.tsx`, `src/web/dev/onboarding.card.tsx`, `src/web/dev/onboarding.banner.tsx`, `src/web/dev/onboarding.state.ts`, `src/web/i18n/id.dev.health.ts`, `src/web/i18n/id.dev.setup.ts`, `tests/web.dev-health.test.ts`                                                                                                                                                                                                                                                                                                                    | W4 nav, adm-server             | M ±400 |
<!-- /WAVE -->

- Template PLAN/01 §5.6 berlaku harfiah untuk semua worker. Pemetaan status mentah → kunci ada di file domain:
  `panel.status-key.ts`, `job.status-key.ts`, `deploy.status-key.ts`, `backup.status-key.ts` (B12).
- `wkr-mon-web-03` tidak menyisipkan banner onboarding (itu W6 `wkr-mon-history-04`), supaya tidak bergantung pada file
  W5 lain.
- **Gerbang tambahan**:
  - `bun test tests/web.*.test.ts`.
  - Smoke manual di mode fake. Orkestrator membuka setiap halaman W5 sekali di 390 px dengan ego-browser (izin pemilik
    sudah ada) untuk menangkap regresi kasar sebelum W6. QA penuh tetap di W8.

### W6 — halaman web 2 + histori monitor (5 worker)

<!-- WAVE:W6 -->
| Worker                    | Menutup                                            | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                              | Bergantung                  | Ukuran |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| `wkr-adm-settings-web-01` | 05 §5.2                                            | `src/web/dev/settings.page.tsx`, `src/web/dev/settings.group.tsx`, `src/web/dev/setting.field.tsx`, `src/web/dev/secret.field.tsx`, `src/web/dev/settings.test.tsx`, `src/web/dev/cloudflare.verify.tsx`, `src/web/dev/settings.state.ts`, `src/web/dev/settings.registry.ts`, `src/web/i18n/id.settings.ts`, `tests/web.dev-settings.test.ts` | W5 selesai; W1 settings     | L ±700 |
| `wkr-adm-users-web-01`    | 05 §5.3–5.4                                        | `src/web/dev/users.page.tsx`, `src/web/dev/users.list.tsx`, `src/web/dev/user.role.dialog.tsx`, `src/web/dev/audit.page.tsx`, `src/web/dev/audit.describe.ts`, `src/web/dev/logs.page.tsx`, `src/web/i18n/id.dev.users.ts`, `src/web/i18n/id.dev.audit.ts`, `src/web/i18n/id.dev.logs.ts`, `tests/web.dev.test.ts`                             | W4 adm-server               | L ±700 |
| `wkr-adm-account-web-01`  | 05 §5.6–5.7                                        | `src/web/pages/profile.page.tsx`, `src/web/pages/profile.sessions.tsx`, `src/web/pages/profile.no-access.tsx`, `src/web/pages/profile.theme.tsx`, `src/web/pages/profile.delete.tsx`, `src/web/pages/login.page.tsx`, `src/web/pages/login.error.ts`, `src/web/i18n/id.account.ts`, `tests/web.account.test.ts`                                | W4 nav, adm-server          | M ±450 |
| `wkr-adm-landing-01`      | 05 §5.8                                            | `src/web/landing/*`, `src/web/i18n/id.landing.ts`, `tests/web.landing.test.ts`                                                                                                                                                                                                                                                                 | W4 nav; W3 dist (nama aset) | L ±700 |
| `wkr-mon-history-04`      | 02 W4 (histori, sparkline, /panel/problems, badge) | `src/web/panel/sparkline.tsx`, `src/web/panel/heartbeat.strip.tsx`, `src/web/panel/problems.page.tsx`, `src/web/panel/overview.page.tsx`, `src/web/panel/domains.page.tsx`, `src/web/panel/panel.routes.tsx`, `src/web/panel/nav.badge.provider.tsx`, `tests/web.panel-history.test.ts`                                                        | W5 mon-web                  | M ±550 |
<!-- /WAVE -->

- `wkr-mon-history-04` mengambil alih `overview.page.tsx`, `domains.page.tsx`, dan `panel.routes.tsx` dari
  `wkr-mon-web-03` (W5 sudah selesai). Isinya: sparkline, strip heartbeat, `/panel/problems`, badge nav
  (`/panel/status` poll 60 dtk), dan `<OnboardingBanner />` untuk super_admin.
- `wkr-adm-settings-web-01`: grup Telegram memakai `alerts.*` (B1). Uji Cloudflare/S3/Telegram berlaku untuk nilai
  tersimpan, atau draft untuk S3 (B7).
- `wkr-adm-landing-01`: tautan instal memakai nama aset B9. Screenshot masih placeholder sampai W10.
- **Gerbang tambahan**: `bun test`; `/` tidak memuat chunk panel (cek string penanda); smoke 390 px seperti W5.

### W7 — pembersihan, seed demo, `server-termux`

<!-- WAVE:W7 -->
| Worker                 | Menutup                                      | File (eksklusif di gelombang ini)                                                                                                                                                                                                                                                                                                                     | Bergantung        | Ukuran |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `wkr-shell-cleanup-04` | 01 §7.4                                      | `src/web/shared/query.state.tsx`, `src/web/shared/stat.card.tsx`, `src/web/shared/confirm.dialog.tsx`, `src/web/dev/pager.tsx`, `src/web/dev/dev.pagination.ts`, `src/web/panel/status.badge.tsx`, `src/web/components/status.tone.ts`, `src/web/panel/panel.status.ts`, `src/web/i18n/id.ts`, `src/web/i18n/id.common.ts`, `tests/web.guard.test.ts` | W6                | S ±300 |
| `wkr-srvtermux-01`     | 03 §7.2, B24 (repo lain, izin pemilik + E10) | `../server-termux/files/sites/ecosystem.config.js`, `../server-termux/files/sites/apps.json`, `../server-termux/files/sv/pm2/run`, `../server-termux/files/home/sites/README.md`, `../server-termux/install.sh`, `../server-termux/test/install.test.sh`, `../server-termux/CHANGELOG.md`                                                             | izin pemilik, E10 | S ±200 |
| `wkr-demo-seed-07`     | 05 W3 (seed demo, dipakai QA & screenshot)   | `scripts/demo-seed.ts`, `tests/demo-seed.test.ts`                                                                                                                                                                                                                                                                                                     | W6                | S ±200 |
<!-- /WAVE -->

- `wkr-shell-cleanup-04`:
  - Hapus komponen lama.
  - Gabung semua file i18n baru ke `id.ts`, dan pindahkan string login/profil keluar dari `id.ts`.
  - Kencangkan tipe aditif W0: hapus `Problem.message`, `LogLines`, label setting server.
  - `tests/web.guard.test.ts`: tanpa import lama, tanpa kelas palet mentah, satu `<Toaster`, tanpa `setInterval(` selain
    `now.store.ts`.
- `wkr-demo-seed-07`: `scripts/demo-seed.ts` (PLAN/05 W3, data fiktif `contoh.com`/`contoh.test`). Seed membuat sesi
  untuk empat peran (tamu tanpa sesi, `user`, `admin`, `super_admin`) dan menulis cookie ke file mode 600 di data dir
  sementara. Dipakai W8 dan W10.
- `wkr-srvtermux-01` (**bergerbang**, lihat §6): perubahan repo `/Users/bip/test/server-termux` sesuai PLAN/03 §7.2. Hanya
  setelah izin pemilik **dan** E10 lulus. Commit dilakukan di repo itu, juga atas perintah pemilik.
- **Gerbang tambahan**: gerbang standar penuh + `bun test tests/web.guard.test.ts`. Untuk `server-termux`:
  `sh test/install.test.sh` di repo itu.

### W8 — QA browser (3 worker, hanya baca) — lihat §4

### W9 — perbaikan hasil QA (≤ 6 worker)

Worker bernama `wkr-fix-<area>-09` (mis. `wkr-fix-panel-09`, `wkr-fix-sites-09`, `wkr-fix-admin-09`,
`wkr-fix-public-09`). Setiap worker memegang file halaman yang sama dengan pemilik W5/W6 area itu. Perubahan pada
komponen bersama (PLAN/01) ditangani satu worker `wkr-fix-shell-09`, tanpa worker lain di file yang sama. Masukannya
adalah laporan W8 dengan diagnosis per temuan (Rule 11). Gerbang: gerbang standar + ulang QA W8 untuk halaman yang
disentuh.

### W10 — screenshot & dokumen (2 worker)

<!-- WAVE:W10 -->
| Worker              | Menutup                | File (eksklusif di gelombang ini)                                                          | Bergantung             | Ukuran |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | ---------------------- | ------ |
| `wkr-adm-shots-01`  | 05 W3 (screenshot, OG) | `src/web/assets/landing/*`, `src/web/assets/og.png`, `src/web/assets/apple-touch-icon.png` | W9 (UI final), W7 seed | S ±150 |
| `wkr-docs-final-10` | semua PLAN §docs, B9   | `README.md`, `CHANGELOG.md`, `.env.example`, `package.json`                                | W9; hasil QA           | M ±700 |
<!-- /WAVE -->

- `wkr-adm-shots-01`:
  - Memotret build mode demo, 390×844 @2x dan 1440×900 @1x, terang & gelap, dengan ego-browser.
  - Konversi ke WebP (skill `agent-media`) dengan anggaran PLAN/05 §5.8: tiap gambar ≤ 120 KB, total ≤ 700 KB, `og.png`
    ≤ 300 KB.
  - Data dir sementara dihapus sesudahnya.
- `wkr-docs-final-10`: satu-satunya penulis README/CHANGELOG (Rule 23).
  - README: bagian terbatas (Rule 16) dari catatan PLAN/02 §7, PLAN/03 §7.1 W4, PLAN/04 §7 W4, dan PLAN/05 W4.
  - `CHANGELOG.md` `## [0.3.0] - <tanggal rilis>` (Added/Changed/Fixed/Removed, perspektif pengguna, Rule 5).
  - `.env.example` (`PANEL_SKIP_SNAPSHOT`, `PANEL_CONNECTIVITY_URL`).
  - `package.json` `"version": "0.3.0"` (B9).
- **Gerbang tambahan**: `bun run build` (target Android) sukses; landing memuat screenshot asli; tautan README valid.

---

## 3. Tabel kontrak final (produsen → konsumen)

Semua sesuai `PLAN/DECISIONS.md`. "W" = gelombang ketika kontrak tersedia.

| #   | Kontrak                                                                                                                                                              | Produsen (worker, W)                                       | Konsumen                                                                                       | Dasar         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------- |
| 1   | `LogLine {at, text, stream?, level?}`, `LogChunk {lines, cursor, reset, truncated}`                                                                                  | `wkr-contracts-00`, W0                                     | mon-core, mon-api, shell-log, mon-web, sites-web-deploy, adm-users-web                         | B13           |
| 2   | `splitLogTimestamp` (svlogd `-tt`, potong ke ms)                                                                                                                     | `wkr-contracts-00`, W0                                     | mon-core (`log.redact`/baca cursor), adm-server (`/dev/logs`)                                  | B13           |
| 3   | `redactLines(lines, extraSecrets)` + `siteSecretsFor(app)`                                                                                                           | mon-core W2 + sites-server W2                              | mon-api (log app), deploy-server (ekor stderr), job page                                       | B22           |
| 4   | `usePoller` / `useApiQuery(url, refreshMs, {enabled})` / `useLogFollow`                                                                                              | `wkr-shell-core-01`, W3                                    | semua halaman W5–W6                                                                            | B13, PLAN/01  |
| 5   | Komponen bersama (`PageHeader`, `QueryView empty`, `DataTable actions`, `ConfirmAction confirm\|typed`, `ActionBar`, `StatusBadge state`)                            | `wkr-shell-ui-01`, W3                                      | semua halaman W5–W6                                                                            | PLAN/01 §3.3  |
| 6   | Kamus status (label/tone/ikon) — beku setelah W3; `rolled_back` "Dikembalikan"/warning; `interrupted` "Terputus"/warning                                             | `wkr-shell-core-01`, W3                                    | `*.status-key.ts` domain (02/03/04) di W5                                                      | B12, A10      |
| 7   | `Problem {id, code, kind, target, severity, params, since, href}`; `ProblemKind` + `security`; severity `info` (B4)                                                  | `wkr-contracts-00` W0; aturan `wkr-mon-rules-01` W1        | mon-core, mon-api, alert engine, adm-server (vonis), mon-web                                   | B2, B4        |
| 8   | Input masalah: `BackupStatus.lastGood`, `SecurityStatus`, `lastGoodItem`, `dataKeyState`, `accessSeen`                                                               | backup-engine W2, keys W2, http W1                         | mon-core/mon-rules, adm-server, mon-api (`DatabaseInfo.lastBackupAt`), sites-web (hapus situs) | B2            |
| 9   | Baterai: `monitor.battery_warn_percent` 25, danger 15, tanpa `battery_unplugged`; suhu ≥ 45 °C warning                                                               | settings W1, mon-rules W1                                  | mon-core, mon-web, adm-settings-web                                                            | A9, B3        |
| 10  | `monitor.status() → {problems, sampledAt}`; `backupScheduler.lastTickAt()`; tanpa `heartbeat.ts`                                                                     | `monitor.contract.ts` W0; mon-core W2; backup-engine W2    | adm-server `/dev/health`                                                                       | B5            |
| 11  | Kunci `alerts.*`, `monitor.sample_interval_sec`; `POST /api/dev/alerts/test`, `POST /api/dev/alerts/telegram/chats`                                                  | settings W1; mon-api W4                                    | adm-settings-web W6                                                                            | B1            |
| 12  | `SETTING_KEYS` tunggal, `PATCH /api/dev/settings` atomik, tanpa `PUT /:key`, label hanya `id.settings.ts`, `KeyMismatchError`, `readable`                            | `wkr-settings-01`, W1 (+ i18n W3)                          | keys W2, backup-engine W2, adm-server W4, adm-settings-web W6, csrf test W1                    | B8            |
| 13  | `POST /api/dev/backup/verify` → `BackupVerify {ok, code, failedStep, steps[], ms, detail}` (draft opsional)                                                          | `wkr-backup-engine-02`, W2                                 | adm-settings-web W6, onboarding (adm-server W4)                                                | B7            |
| 14  | `revokeUserSessions` (409 `self` saja, termasuk super admin env) / `revokeAllSessions`; route user di `dev.admin.routes`, `revoke-all` di `security.routes`          | audit W2 (fungsi), adm-server W4 + keys W2 (route)         | adm-users-web W6, backup-web (`SessionsAdminCard`) W5                                          | B6            |
| 15  | `DevAuditEntry` datar (04 §3.3) + `AuditAction` di `src/shared/audit.types.ts`; `listAudit({action[], actorId, from, to, excludePrefixes})`                          | contracts W0; audit W2                                     | adm-users-web (`describeAudit`), adm-server (CSV), mon-api (`recentActivity`)                  | PLAN/04/05    |
| 16  | `createApiHandler(api, {appBaseUrl})`: host check 421 → CSRF → rate limit → konteks request                                                                          | `wkr-http-01`, W1                                          | spa.serve (W1/W3), semua route                                                                 | B17           |
| 17  | Header B11 (HTML `no-cache`, aset `immutable`, chunk hilang 404, `/__spa` 404, `/api` `no-store`) + `seo.ts` (404 + `noindex`, OG `/`)                               | http W1; adm-seo W3                                        | shell-nav (chunk reload), landing, crawler                                                     | B11, A7       |
| 18  | `roles.ts`: `homeFor(super_admin)="/panel"`, `isProtectedPath`, `SPA_ROOTS`/`isKnownSpaPath`                                                                         | `wkr-contracts-00`, W0                                     | shell-nav (redirect, 404), adm-seo (status 404), session                                       | A11, B19, A7  |
| 19  | 403 di klien → `/login`                                                                                                                                              | `wkr-shell-core-01` (`api.client.ts`), W3                  | semua halaman                                                                                  | B20           |
| 20  | Migrasi `0006_data_safety`, `0007_sites_lifecycle`, `0008_monitor` (termasuk riwayat metrik)                                                                         | `wkr-db-01`, W1                                            | keys, audit, backup-engine, sites/deploy-server, mon-core                                      | B15           |
| 21  | Snapshot pra-migrasi saat boot (`<dataDir>/snapshots/`, simpan 3); installer hanya preflight + petunjuk rollback                                                     | keys W2 (fungsi), boot W4 (panggilan), dist W3 (installer) | POCO deploy (R)                                                                                | B10           |
| 22  | `boot.ts` + `http/spa.serve.ts`; satu pemilik per gelombang                                                                                                          | refactor W0 → http W1 → adm-seo W3 → boot W4               | –                                                                                              | B16           |
| 23  | Adapter: `Pm2UnavailableError`, `Pm2Proc {cwd, execPath, args, startedAtMs, module}`, `httpStatus(port, path, timeoutMs, host?)`, `PostgresAdapter`/`ArchiveAdapter` | `wkr-adapters-01`, W1                                      | mon-core, sites-server, deploy-server, backup-engine                                           | B14, B21      |
| 24  | `jobs.isLocked({kind, name})`, `jobs.active()`; `backup.busy()`                                                                                                      | runner W1; backup-engine W2                                | mon-api (kontrol + restart `panel`), sites-server (`database_drop`)                            | PLAN/02/03/04 |
| 25  | Snippet ecosystem dengan filter `existsSync` (wajib), `apps.json` hanya setelah binary ada, health = pid valid + probe port, nama `*.config.js`                      | sites-server W2, deploy-server W2                          | dist W3 (`deploy/pm2/*`), srvtermux W7, README W10                                             | B18           |
| 26  | Probe ecosystem `{loadedAppsJson, names, envKeys}` + `snippetCurrent`; `integration().ecosystemIncludesAppsJson`                                                     | `wkr-sites-server-02`, W2                                  | adm-server (onboarding `apps_json`), sites-web-list                                            | B25           |
| 27  | `POST /api/panel/jobs/:id/recover` + `Job.recoverMode: "cleanup" \| "retry"`                                                                                         | `wkr-sites-server-02`, W2                                  | sites-web-deploy (job page), mon-rules (`site_job_failed`)                                     | B26           |
| 28  | `env.codec.ts` (`decodeEnvValue`, `encodeEnvLine`, aturan `$` Bun 1.4.2)                                                                                             | `wkr-contracts-00`, W0                                     | sites-server (`env.file`), sites-web-detail (Tempel `.env`), dist (installer)                  | B23           |
| 29  | Nama `pm2-guard` dicadangkan (disembunyikan dari Aplikasi/adopsi, ditolak sebagai nama situs)                                                                        | contracts W0 (konstanta)                                   | adapters (modul), sites-server (validasi), mon-web (filter)                                    | B24           |
| 30  | Aset rilis `panel-termux-android-arm64.tar.gz`, `install.sh`, `SHA256SUMS`; `actions/attest@v4` (SHA); `dry_run`                                                     | `wkr-dist-01`, W3                                          | adm-landing (perintah instal) W6, docs W10, R                                                  | B9            |
| 31  | `OnboardingBanner` (05) disisipkan di Ringkasan                                                                                                                      | adm-health-web W5                                          | mon-history W6                                                                                 | PLAN/05 dep   |
| 32  | Rute domain web (`panel/site/backup/dev.routes.tsx`) dirangkai `app.routes.tsx`                                                                                      | shell-nav W4 (buat) → domain W5/W6 (isi)                   | router                                                                                         | PLAN/01 §7.0  |
| 33  | `seo.ts` teks OG = `idLanding.meta` (test membandingkan)                                                                                                             | adm-seo W3                                                 | adm-landing W6                                                                                 | PLAN/05 §3.6  |

---

## 4. Gelombang QA browser (W8)

Owner sudah mengizinkan ego-browser. Setiap worker QA memuat skill `ego-browser` (`ego-browser skill`) sebelum mulai.
QA dijalankan pada binary `bun run build:local` dalam **mode fake** dengan data dari `scripts/demo-seed.ts`
(`PANEL_DATA_DIR` sementara, env dummy, port loopback). QA hanya membaca dan tidak mengedit file. Laporan ditulis ke
scratchpad: per halaman × viewport × tema → lulus/gagal, temuan dengan langkah reproduksi dan screenshot.

**Matriks per halaman**: 1440×900 dan 390×844 · tema terang dan gelap · peran yang relevan. Total 4 kombinasi per
halaman per peran.

| Worker             | Halaman                                                                                                                                                                                                                                                                                                        | Peran                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `wkr-qa-panel-08`  | `/panel` (Ringkasan + banner onboarding), `/panel/services` + log, `/panel/apps` + log (stdout/stderr), `/panel/domains`, `/panel/databases`, `/panel/problems`, `/panel/backups` (+ dialog pulihkan & hapus DB uji)                                                                                           | admin, super_admin      |
| `wkr-qa-sites-08`  | `/panel/sites` (Persiapan, Belum dikelola), dialog Adopsi, `/panel/sites/new` (wizard 3 langkah), `/panel/sites/:name` (deploy unggah/lanjut, rollback, domain, env + Tempel `.env`, pengaturan health, hapus), `/panel/jobs`, `/panel/jobs/:id` (running/succeeded/rolled_back/failed/interrupted + Pulihkan) | admin                   |
| `wkr-qa-public-08` | `/` (landing, `#pasang`, salin perintah), `/login` (+ `?error=`), `/hargaa` (404 publik, status 404), `/profile` (kartu `user` tanpa akses, sesi, hapus akun), `/dev` (Kesehatan + onboarding), `/dev/settings` (simpan grup, uji, rahasia tak terbaca), `/dev/users`, `/dev/audit` (filter, CSV), `/dev/logs` | tamu, user, super_admin |

**Pemeriksaan wajib di setiap kombinasi** (diambil dari kriteria penerimaan PLAN/01 §6 dan tiap PLAN):

1. Tepat satu `<h1>`; judul terlihat di top bar HP; judul tab unik.
2. Tanpa scroll horizontal halaman (`scrollWidth === innerWidth`) di 390 px.
3. Target sentuh ≥ 44 px (emulasi `pointer: coarse`); desktop tetap padat.
4. Kontras teks status ≥ 4,5:1 di kedua tema, tanpa kelas palet mentah.
5. Keadaan memuat/kosong/gagal/stale. Gunakan DevTools offline untuk memicu `StaleNotice` dan backoff 10/20/40/60. Tab
   tersembunyi = 0 request.
6. Tier konfirmasi sesuai PLAN/01 §3.2 (typed menolak huruf besar yang salah; Escape tidak menutup saat pending; error
   tampil di dalam dialog).
7. Toast di atas bottom bar (HP) / kanan bawah (desktop). Fokus pindah ke h1 setelah navigasi.
8. Bottom bar: aktif benar; tidak ada untuk peran `user`; sheet "Lainnya" tertutup setelah memilih item.
9. Tidak ada string Inggris dari server di UI, kecuali `detail` teknis yang memang disalin.
10. Chunk: build ulang + restart saat tab terbuka → pindah area → reload sekali → berhasil.

Gerbang W8: semua temuan dikelompokkan BLOCKER/MAJOR/MINOR. BLOCKER dan MAJOR wajib selesai di W9. MINOR boleh
dicatat sebagai utang di CHANGELOG/README hanya dengan persetujuan pemilik.

---

## 5. Rilis v0.3.0

1. **Checklist pra-deploy (Rule 6)** ditampilkan orkestrator. Setiap butir ✅/❌, "N/A" harus diberi alasan:
   1. test
   2. typecheck
   3. lint
   4. build Android (`bun run build`) + `build:local`
   5. migrasi 0006–0008 tanpa gap: `latestSchemaVersion()` = jumlah file `drizzle/*.sql`, `db.migrate.test.ts` hijau
   6. scan kebocoran credential (Rule 7)
   7. `CHANGELOG.md` `## [0.3.0]`
   8. breaking change + rencana rollback: `panel.prev` + snapshot `<dataDir>/snapshots/` + `PANEL_SKIP_SNAPSHOT=1`.
      Kontrak API admin berubah (`PUT /dev/settings/:key` dihapus, `LogLines` → `LogChunk`, `Problem.message` hilang),
      dan semua konsumennya ada di repo ini.

   Bersamaan dengan itu ditampilkan **laporan garansi pra-push (Rule 18)**: hutang teknis + garansi rule 3/8/11/12/13/15/16/17.
2. **Branch & PR** (atas perintah pemilik, Rule 1/2/14): push `feature/production-polish`, buka PR ke `main` dengan
   deskripsi lengkap (apa, kenapa, cara uji manual, breaking change, screenshot). Merge hanya atas "merge sekarang".
3. **Dry run workflow** (B9): setelah merge (atau dari branch bila pemilik setuju),
   `gh workflow run release.yml -f dry_run=true`. Harus hijau: audit `bun audit --audit-level=high`, typecheck, lint,
   test, build, `SHA256SUMS`, attestation (dry run tanpa `gh release create`). Periksa log: tanpa secret, tanpa
   `actions/cache`, action ter-pin SHA.
4. **Versi**: `package.json` = `0.3.0` (sudah dari W10). Tag harus sama dengan versi, dan `release.yml` memeriksanya.
5. **Deploy ke POCO** (perintah pemilik di pesan yang sama, Rule 1). Prasyarat: tidak ada job situs/cadangan/pemulihan
   yang berjalan (`GET /api/dev/health` → `runningJob: null`).
   1. `bun run build` → `rsync -avR --partial dist/panel-android-arm64 scripts/install-phone.sh deploy/ .env.example poco:panel-src/`.
   2. `ssh poco 'cd ~/panel-src && sh scripts/install-phone.sh ./dist/panel-android-arm64'`. Installer: preflight ruang,
      lalu `sv -w 130 restart panel`.
   3. Boot pertama 0.3.0 membuat snapshot `panel.db.0.2.2.<ts>` lalu migrasi 0006–0008.
   4. Verifikasi: `/api/ready` (skema = 0008), `sv status panel` `run:`, `curl -sI` header B11 lewat domain publik,
      chunk `/panel` & `/dev` 200 di binary Android (risiko R2 PLAN/01), Ringkasan tanpa masalah palsu,
      `POST /api/dev/alerts/test` diterima Telegram, CPU sampler idle ≤ 1,2% satu inti setelah 10 mnt, makuro-solusi
      `restart_time` tidak berubah.
   5. Gagal → rollback: `sv down panel`, kembalikan `panel.prev` + snapshot terbaru, `sv up panel`. Langkahnya dicetak
      installer.
6. **Tag oleh pemilik** (A6): `git tag v0.3.0 && git push origin v0.3.0`. Worker tidak pernah membuat tag. Workflow
   membuat rilis dengan 3 aset + attestation. Uji `install.sh` dari rilis di Termux bersih sampai pesan "isi `.env`"
   (PLAN/05 §6.4), lalu `gh attestation verify`.
7. **Setelah rilis**: landing menautkan `releases/latest/download/install.sh`. Repo harus publik agar attestation dapat
   diverifikasi (PLAN/04 §3.9.3).

---

## 6. Butir yang bergerbang

| Butir                                                                                                    | Gerbang                                        | Dampak pada jadwal                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E9** hardlink di `~/sites` (POCO)                                                                      | Sedang berjalan                                | Harus tercatat sebelum `wkr-deploy-server-02` (W2) mengunci `swap.ts`. Bila `link` ditolak, `copyFile` menjadi jalur utama (89 MB tulis per deploy), tanpa perubahan desain                                       |
| **E10** penjaga `pm2-guard` (`sleep infinity`) menahan pm2-runtime                                       | Sedang berjalan                                | Menentukan isi `deploy/pm2/ecosystem.config.js` (`wkr-dist-01`, W3) dan pekerjaan `wkr-srvtermux-01` (W7). Gagal → `args: "2147483647"`, atau skrip node HTTP satu baris. Nama `pm2-guard` tetap dicadangkan (W0) |
| **E4b** ecosystem 0 app + modul `pm2-logrotate`                                                          | Sedang berjalan                                | Hanya catatan README (W10). Penjaga tetap dipakai                                                                                                                                                                 |
| **B24** perubahan repo `server-termux` (template ecosystem, `apps.json`, `PM2_HOME`, README, test)       | **Izin pemilik** + E10 lulus                   | `wkr-srvtermux-01` hanya dijalankan setelah keduanya terpenuhi. Rilis `server-termux` 0.2.0 sebelum v0.3.0 panel diumumkan. HP yang sudah berjalan (POCO) tidak disentuh                                          |
| Browser automation                                                                                       | Sudah diizinkan pemilik (ego-browser)          | Smoke W5/W6, QA W8, screenshot W10                                                                                                                                                                                |
| Uji end-to-end di POCO yang menyentuh produksi (deploy makuro-solusi, perubahan domain, restart `panel`) | Izin pemilik per sesi                          | Hanya di langkah R5 dan jendela waktu yang disetujui                                                                                                                                                              |
| Push, PR, merge, tag, deploy                                                                             | Perintah pemilik di pesan yang sama (Rule 1/2) | Langkah R2–R6                                                                                                                                                                                                     |
| R2/S3 nyata (multipart ≥ 100 MB, `stat` pasca-unggah)                                                    | Akun R2 pemilik                                | Uji operasional sebelum R6 (PLAN/04 §6); bila gagal, butir "belum diuji end-to-end" tetap di Keterbatasan landing                                                                                                 |
| `TERBUKA (a)` resep Access README (PLAN/05 §3.8)                                                         | Konfirmasi pemilik                             | Teks final di W10                                                                                                                                                                                                 |
