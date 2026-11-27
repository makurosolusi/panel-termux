// CLI language (PLAN/08 §3.5, §6; DECISIONS E12). Resolved once per run in cli.main.ts; `panel init` may change it
// after its language question. Strings stay next to the code that prints them: `out.line(tr("Done.", "Selesai."))`.
import { DEFAULT_LOCALE, type Locale, parseLocale } from "../shared/locale";
import type { EnvFileValues } from "./env.file";

/** Where the active CLI locale came from: an explicit choice (`--lang`, PANEL_LANG) or a guess from the shell. */
export type CliLocaleSource = "flag" | "env" | "env-file" | "shell" | "default";

/** Resolved CLI locale and its source. */
export type CliLocale = { locale: Locale; source: CliLocaleSource };

/** Value of `--lang x` / `--lang=x` in argv (last one wins, like parseArgs); undefined when absent. */
export function langFlag(argv: readonly string[]): string | undefined {
  let value: string | undefined;
  argv.forEach((a, i) => {
    if (a === "--lang") value = argv[i + 1];
    else if (a.startsWith("--lang=")) value = a.slice("--lang=".length);
  });
  return value;
}

/**
 * `--lang` → PANEL_LANG (process env) → PANEL_LANG (panel env file, read only when needed) → LC_ALL → LC_MESSAGES →
 * LANG (POSIX precedence: the first non-empty one decides; only `id`/`in` select Indonesian) → `en`. Invalid
 * `--lang`/PANEL_LANG values are skipped here (cli.main rejects a bad `--lang` as a usage error).
 */
export function cliLocale(
  env: Record<string, string | undefined>,
  argv: readonly string[],
  envFile: () => EnvFileValues | null,
): CliLocale {
  const flag = parseLocale(langFlag(argv));
  if (flag) return { locale: flag, source: "flag" };
  const fromEnv = parseLocale(env.PANEL_LANG);
  if (fromEnv) return { locale: fromEnv, source: "env" };
  const fromFile = parseLocale(envFile()?.PANEL_LANG);
  if (fromFile) return { locale: fromFile, source: "env-file" };
  const shell = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((v) => v?.trim());
  if (shell) return { locale: parseLocale(shell) === "id" ? "id" : "en", source: "shell" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}

let active: CliLocale = { locale: DEFAULT_LOCALE, source: "default" };

/** Sets the locale of this CLI run (cli.main after resolving; init after its language question). */
export function setCliLocale(next: CliLocale): void {
  active = next;
}

/** The locale of this CLI run. */
export const activeCliLocale = (): CliLocale => active;

/** `en` or `id` text by the active CLI locale. */
export const tr = (en: string, id: string): string => (active.locale === "id" ? id : en);
