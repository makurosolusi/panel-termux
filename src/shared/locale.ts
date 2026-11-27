// UI locales of the whole product (web, server texts, CLI). English is the default (PLAN/08 §2, DECISIONS E1).

/** A supported UI language. */
export type Locale = "en" | "id";

/** Language used when nothing else decides. */
export const DEFAULT_LOCALE: Locale = "en";

/** Every supported locale, default first. */
export const LOCALES: readonly Locale[] = ["en", "id"];

/** Name of each language in itself; never translated, so a user lost in the wrong language finds the way back. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", id: "Bahasa Indonesia" };

/** BCP 47 tag handed to `Intl`/`toLocale*` per locale (English uses a 24-hour clock, see web format.ts). */
export const INTL_TAG: Record<Locale, string> = { en: "en-US", id: "id-ID" };

/** `en`, `id`, `en-US`, `id_ID.UTF-8`, legacy `in` (any case) → locale; anything else → null. */
export function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const base = /^([a-z]{2})(?:[-_].*)?$/i.exec(value.trim())?.[1]?.toLowerCase();
  if (base === "en") return "en";
  return base === "id" || base === "in" ? "id" : null;
}
