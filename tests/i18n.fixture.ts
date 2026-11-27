// Test-only: run a test file's formatters in a given locale. Files whose literals are still Indonesian call
// `formatLocaleForFile("id")` until their wave-1 owner migrates them to English (PLAN/08 §8); then the call goes.
import { afterAll, beforeAll } from "bun:test";
import { setActiveLocale } from "@/shared/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/shared/locale";

/** Sets the active locale for the calling file; restores the default afterwards (module singleton). */
export function formatLocaleForFile(locale: Locale): void {
  beforeAll(() => setActiveLocale(locale));
  afterAll(() => setActiveLocale(DEFAULT_LOCALE));
}
