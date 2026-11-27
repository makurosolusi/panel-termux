// `panel init` language question (PLAN/08 §3.5, DECISIONS E12): asked once, before any other output, and kept as
// PANEL_LANG in ~/panel/.env (atomic, mode 600). Termux does not see the Android locale, so the shell cannot tell.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readTextOrNull, writeAtomic } from "../server/sites/site.files";
import { decodeEnvValue, findEnvLine } from "../shared/env.codec";
import { renderEnvTemplate } from "../shared/env.schema";
import { type Locale, parseLocale } from "../shared/locale";
import { type CliHost, probePaths } from "./cli.host";
import { activeCliLocale, setCliLocale } from "./cli.locale";
import { setEnvLine } from "./init.env";

const ENV_MODE = 0o600;
/** Bilingual on purpose: nobody has chosen a language yet. */
const QUESTION = "Language / Bahasa: 1) English  2) Bahasa Indonesia [1]:";
const RETRY = "1 = English, 2 = Bahasa Indonesia";

/** What the question needs from runInit. `lang` = the parsed `--lang` value (cli.main already applied it). */
export type InitLanguageInput = {
  host: CliHost;
  lang: unknown;
  yes: boolean;
  dryRun: boolean;
  say: (t: string) => void;
};

/** Answer → locale: Enter/1 → en, 2 → id, also `en`/`id`; anything else → null (ask again). */
export function languageAnswer(answer: string): Locale | null {
  const a = answer.trim();
  if (a === "" || a === "1") return "en";
  if (a === "2") return "id";
  return parseLocale(a);
}

/**
 * Asks the language on a TTY and persists PANEL_LANG, unless already decided (`--lang`, PANEL_LANG in the process
 * env or in ~/panel/.env) or non-interactive (`--yes`, no TTY). `--dry-run` asks but writes nothing. When .env does
 * not exist yet it is created from the template (the env step then only fills the missing values). EOF keeps the
 * current locale and writes nothing. Returns the chosen locale, or null when nothing was asked/answered.
 */
export async function chooseInitLanguage({ host, lang, yes, dryRun, say }: InitLanguageInput): Promise<Locale | null> {
  if (typeof lang === "string" || activeCliLocale().source === "env") return null;
  const file = probePaths(host.paths).envFile;
  const text = readTextOrNull(file);
  const stored = text === null ? null : findEnvLine(text, "PANEL_LANG");
  if (stored !== null && parseLocale(decodeEnvValue(stored))) return null;
  if (yes || !host.tty.isTty) return null;
  let locale: Locale | null = null;
  while (locale === null) {
    const answer = await host.tty.ask(QUESTION);
    if (answer === null) return null;
    locale = languageAnswer(answer);
    if (locale === null) say(RETRY);
  }
  setCliLocale({ locale, source: "env-file" });
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    const base = text ?? renderEnvTemplate({ full: true, locale }); // template comments in the chosen language
    writeAtomic(file, setEnvLine(base, "PANEL_LANG", locale), { mode: ENV_MODE });
  }
  return locale;
}
