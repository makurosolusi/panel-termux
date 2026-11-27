// SPA bootstrap (PLAN/08 §4.3, DECISIONS E5): pick the locale, register the Indonesian overlay if needed, then load
// the app. Imports nothing that touches a dictionary, so no dictionary evaluates before its overlay is registered.
import { setActiveLocale, setOverlays } from "@/shared/i18n";
import type { Locale } from "@/shared/locale";
import { detectLocale } from "@/web/i18n/locale.detect";
import { CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnce } from "@/web/shared/chunk.error";

let locale: Locale = detectLocale();
let packFailed = false;
if (locale === "id") {
  try {
    setOverlays((await import("@/web/i18n/id.pack")).default);
  } catch (cause) {
    console.warn("boot: Indonesian pack failed to load, showing English", cause);
    [locale, packFailed] = ["en", true];
  }
}
setActiveLocale(locale);
document.documentElement.lang = locale;
try {
  (await import("@/web/app.mount")).mount({ packFailed });
} catch (cause) {
  // a stale deploy can remove the chunk: reload once, as the route loaders do (chunk.error.ts)
  if (!(isChunkLoadError(cause) && reloadOnce(CHUNK_RELOAD_KEY)))
    throw new Error("boot: app failed to mount", { cause });
}
