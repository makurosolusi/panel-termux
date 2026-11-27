// Web locale detection at boot (PLAN/08 §3.1): `?lang=` → localStorage → navigator.languages → English.
// Imported by the bootstrap, so it must stay free of dictionaries.
import { DEFAULT_LOCALE, type Locale, parseLocale } from "@/shared/locale";

/** localStorage key of the chosen language (cache of `me.locale` for signed-in users). */
export const LANG_STORAGE_KEY = "panel-termux:lang";
/** Query parameter of the landing/login switcher. */
export const LANG_QUERY_PARAM = "lang";

/** Inputs of the detection, in precedence order. */
export type LocaleSources = { query: string | null; stored: string | null; languages: readonly string[] };

/** First valid source wins: query, stored value, first `en`/`id` browser language, then English. */
export function pickLocale({ query, stored, languages }: LocaleSources): Locale {
  return (
    parseLocale(query) ?? parseLocale(stored) ?? languages.map(parseLocale).find((l) => l !== null) ?? DEFAULT_LOCALE
  );
}

/** Stored language, or null when unset or storage is unreadable (private mode, blocked site data). */
export function readStoredLocale(storage: Pick<Storage, "getItem"> | undefined): string | null {
  try {
    return storage?.getItem(LANG_STORAGE_KEY) ?? null;
  } catch {
    return null; // unreadable storage only means "not chosen yet"
  }
}

/** Saves the language (`null` = follow the browser, removes the key); false when storage refused. */
export function writeStoredLocale(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, locale: Locale | null) {
  try {
    if (locale === null) storage?.removeItem(LANG_STORAGE_KEY);
    else storage?.setItem(LANG_STORAGE_KEY, locale);
    return storage !== undefined;
  } catch {
    return false;
  }
}

const browserStorage = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // accessing localStorage itself can throw (sandboxed iframe, blocked cookies)
  }
};

/** Detects the page locale; a valid `?lang=` is saved and removed from the address bar. */
export function detectLocale(): Locale {
  const url = new URL(location.href);
  const query = url.searchParams.get(LANG_QUERY_PARAM);
  const storage = browserStorage();
  const fromQuery = parseLocale(query);
  if (query !== null) {
    if (fromQuery) writeStoredLocale(storage, fromQuery);
    url.searchParams.delete(LANG_QUERY_PARAM);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return pickLocale({ query, stored: readStoredLocale(storage), languages: navigator.languages ?? [] });
}
