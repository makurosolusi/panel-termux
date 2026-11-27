// Sign-in completion sync of the account language (PLAN/08 §3.1, DECISIONS E2): the server value is cached in
// localStorage so the next boot uses it. Never reloads, so a mismatch cannot loop.
import type { Me } from "@/shared/me.types";
import { readStoredLocale, writeStoredLocale } from "@/web/i18n/locale.detect";

/** The slice of `Storage` the language cache uses. */
export type LocaleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or undefined when the browser refuses access to it. */
export const browserStorage = (): LocaleStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // accessing localStorage itself can throw (sandboxed iframe, blocked cookies)
  }
};

/** Writes `me.locale` to storage when set and different; true when it wrote. `null` (follow device) leaves storage alone. */
export function syncStoredLocale(
  me: Pick<Me, "locale">,
  storage: LocaleStorage | undefined = browserStorage(),
): boolean {
  if (me.locale === null || readStoredLocale(storage) === me.locale) return false;
  return writeStoredLocale(storage, me.locale);
}
