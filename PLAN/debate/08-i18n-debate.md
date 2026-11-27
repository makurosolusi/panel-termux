# Debate 08 — i18n plan (PLAN/08-i18n.md, first draft)

Adversarial review of the first draft of `PLAN/08-i18n.md` (written by `wkr-i18n-plan-01`). Recorded by
`wkr-i18n-plan-02` from the coordinator's summary, 2026-11-27. Resolutions are binding through `PLAN/DECISIONS.md` §E;
the revised plan applies them.

Severity: BLOCKER = the plan does not work as written; MAJOR = the plan works but ships a defect or an unowned gap;
MINOR = quality or completeness.

## Findings

### 1. BLOCKER — top-level await does not order evaluation under `splitting: true`

Reproduced on Bun 1.4.2: when dictionaries end up in a shared chunk (for example `shell`/`common`, which both the
entry and lazy routes import), the entry chunk imports that shared chunk statically. Static imports evaluate before
the entry body, so the shared chunk evaluates **before** `locale.boot`'s `await import("./id.pack")` resolves, and the
Indonesian overlay never applies to those dictionaries. The R&D spike (§6.3) only had dictionaries inside the entry
chunk and missed this.

Resolution: a dynamic-import boundary.

- `src/web/main.tsx` becomes a ~10-line bootstrap: `detectLocale()`; if `id` → `setOverlays((await
  import("./id.pack")).default)`; then `const { mount } = await import("./app.mount"); mount()`.
- Everything that touches a dictionary lives behind `app.mount` (router, layout, providers, pages).
- The overlay registry module must not import any dictionary.
- Measure the extra preloaded chunk hop for English users (entry → `app.mount` chunk).
- Redefine the `scripts/bundle-report.ts` entry grouping and budgets for the new entry + mount chunk.
- Replace the "first import" order test with a behavioral built-output test: build the real HTML entry with
  splitting, load the built output with a stubbed `document`/`localStorage` (`lang=id`), and assert that a
  module-level alias (for example `src/web/site/site.anchors.tsx:9`) is Indonesian.

### 2. MAJOR — wave 0 gates are vacuous

Wave 0 creates `en.*` files that still hold Indonesian text, so every gate (bundle, parity, boot) passes whether or
not the overlay works. Resolution: wave 0a includes one real English smoke domain (for example `en.app`) and one
real id-pack round trip. Bundle budgets are gated on real English after wave 1 (`/` ≤ 150 KB, `/panel` ≤ 215 KB).

### 3. MAJOR — the codemod must be reproducible

"sed over 164 files" is not reviewable or re-runnable after a rebase. Resolution: a committed, re-runnable script
`scripts/codemod-i18n.ts` producing a **pure rename commit**, separate from the typing and file-creation commits. It
must cover type-position uses, e.g. `keyof typeof idShell.groups` (`nav.items.ts:42`) and `idLanding.shots.items`
(`landing.shots.ts:12`).

### 4. MAJOR — unowned test files

`tests/i18n.boot.test.ts`, the parity test and the `tests/web.guard.test.ts:47` allow-list had no owner.
Resolution: owned by the base worker (wave 0a).

### 5. MAJOR — `user.locale` needs better-auth wiring and regenerated migrations

A plain column is not exposed by better-auth. Resolution: add `locale` as a better-auth `additionalField` in
`src/server/auth/auth.service.ts:31-34` (`input: false`, written only via `PATCH /api/me`), regenerate
`drizzle/migrations.js` / `.d.ts`, and update the embedded-migration test. These server pieces move to wave 0b so
wave 1 builds on a fixed contract.

### 6. MAJOR — reload-on-mismatch is fragile

Reloading after `GET /api/me` when the server locale differs needs a `sessionStorage` loop guard and causes a visible
double load. Resolution: drop reload-on-mismatch and the guard. Write the locale to localStorage at sign-in
completion; the server value applies at the next boot. `PATCH /api/me` stays.

### 7. MAJOR — stored Indonesian device labels

`audit_log.user_agent` rows contain "… di …" and the unknown-device text "Perangkat tidak dikenal"
(`sessions.service.ts:31,42`, `api.handler.ts:153`, `audit.service.ts:38`), shown verbatim in `audit.page.tsx:115-116`.
Resolution: normalize on read (`" di "` → `" · "`; "Perangkat tidak dikenal" → `tDevAudit.unknownDevice`; `null`
renders the same), with tests for old rows.

### 8. MAJOR — upgrades must not silently flip language

An owner who configured Telegram alerts in Indonesian would get English digests after the upgrade. Resolution:
backfill `alerts.language = 'id'` when alerts were configured before 0.6.0 (idempotent, at migration or boot). The
CHANGELOG states the CLI default change and `PANEL_LANG=id`.

### 9. MAJOR — CLI locale on Termux

The Android system locale is not visible to Termux processes, so `LANG` cannot carry the user's language.
Resolution: `panel init` asks once, at the top: `Language / Bahasa: 1) English 2) Bahasa Indonesia` (skipped with
`--lang`/`PANEL_LANG` or when non-interactive), persists `PANEL_LANG` in the panel env file, and `cliLocale` reads it.
Decide whether `PANEL_LANG` belongs to `ENV_VARS` (the child-env scrubber, `cli.host.ts:162-171`). Verify `LANG` on
POCO.

Verification on POCO (read-only, 2026-11-27): Android locale `persist.sys.locale = id-ID`, yet the Termux login shell
has `LANG=en_US.UTF-8` (`LC_ALL` empty) and a clean `env -i sh` has no `LANG` at all. The claim holds: env-based
detection would always pick English on an Indonesian phone.

### 10. MINOR/MAJOR — typing gaps

- Arrays: parity must check array length, and `applyOverlay` replaces arrays wholesale (no index merge).
- Typed pack: `OverlayPack = { [K in keyof Domains]: Messages<Domains[K]> }`.
- Run a `tsc` spike on `id.job.ts` (102 function leaves) before the codemod to confirm `Messages<T>` type-checks
  in reasonable time and with readable errors.
- Runtime parity for function leaves: call with guessed sample arguments (`1`, `"x"`, `new Date(0)`) and assert the
  result is a string.

### 11. MAJOR — tests lose literal coverage

Asserting only through the dictionary cannot catch wrong English. Resolution: every migrated test file keeps at least
one literal English assertion per component under test, plus literal assertions for all formatter and plural
outputs. Indonesian rendering is covered by the built-output behavioral test (or a preload variant).

### 12. MINOR — formatting details

- `hourCycle: "h23"` for `formatClock` and `formatDateTime` in English (24-hour), with a test at 00:05.
- Durations: test zero and sub-minute cases (`0 s`, `59 s`, `1 min`).
- Server alert texts must not use `Intl` (check `alert.messages.ts`).

### 13. MINOR — problem copy and the deleted-account URL

- Test that `tProblem` leaves produce Indonesian separators after the id overlay.
- Rename `?akun=dihapus` → `?account=deleted`, accepting both for one release
  (`src/web/landing/account.deleted.ts:3`, `deleted.notice.tsx:8`).

### 14. MINOR — glossary

- Mark many-to-one mappings (Pulihkan → Restore / Recover / Restore previous version).
- List the exceptions to job → "Change": job ids, API codes and CLI keep `job`.
- The CLI uses the same glossary.

### 15. MINOR — worker split

Splitting `wkr-i18n-cli-18` / `wkr-i18n-cli-19` is mandatory, not optional. The account worker's server pieces move
to wave 0b.

## Scope cuts (approved by the coordinator)

- Drop `og.id.png`, the `?lang=id` OG variant, `og:locale:alternate` and `hreflang`. OG preview is English only.
- Drop locale-aware data-key text: the data-key download is English only.
- Drop reload-on-mismatch (finding 6).

## Appendix — tsc spike on `id.job.ts` (wave 0a stage 1, `wkr-i18n-base-01`, 2026-11-27)

Setup: `Messages<T>` exactly as in PLAN/08 §4.2 in a temporary `src/shared/i18n.ts`; `src/web/i18n/en.job.ts` = a
copy of `id.job.ts` exporting `tJob`; `id.job.ts` annotated `export const idJob: Messages<typeof tJob> = { … }` (102
function leaves, `satisfies Record<…>` clauses kept). TypeScript 7.0.2, `tsc --noEmit --extendedDiagnostics`, three
runs each on the whole project. The spike files were removed afterwards (stage 2 creates the real ones).

| Run set  | Check time (s)     | Instantiations | Types   |
| -------- | ------------------ | -------------- | ------- |
| baseline | 1.29 · 1.37 · 1.02 | 1,848,486      | 460,847 |
| typed    | 1.11 · 0.99 · 1.04 | 1,864,001      | 462,282 |

Result: no measurable check-time cost (differences are run-to-run noise; +0.8 % instantiations). Far below the 2 s
stop threshold. Parameter types flow from English: `(p) =>` in the overlay needs no annotation.

Deliberate errors (all readable, pointing at the overlay line):

- Missing key: `TS2741: Property 'validated' is missing in type '{ invalid_site: … }' but required in type '{ readonly validated: () => string; … }'.`
- Misspelled / extra key: `TS2561: Object literal may only specify known properties, but 'tunnel_restartd' does not exist in type '{ … }'. Did you mean to write 'tunnel_restarted'?`
- Function with more parameters than English: `TS2322: Type '(pct: string, more: string) => string' is not assignable to type '(pct: number) => string'. Target signature provides too few arguments. Expected 2 or more, but got 1.`

Not caught by the type (as expected, covered by `tests/i18n.parity.test.ts`): array length, and an overlay function
declaring fewer parameters than English (TypeScript allows dropping parameters).

Decision: continue with `Messages<typeof t*>` as planned.
