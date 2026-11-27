// Overlay registry for the dictionaries (PLAN/08 §4.2-4.3, DECISIONS E5, E8). English objects are the source of
// truth; the bootstrap registers the Indonesian pack before any dictionary module evaluates, and `msg()` patches each
// English object in place as it is created. This module must never import a dictionary at runtime.
import { DEFAULT_LOCALE, type Locale } from "./locale";

/** Shape an overlay must have for an English dictionary `T`: same keys, strings, same function parameters. */
export type Messages<T> = T extends string
  ? string
  : T extends (...a: infer A) => string
    ? (...a: A) => string
    : T extends readonly (infer U)[]
      ? readonly Messages<U>[]
      : { readonly [K in keyof T]: Messages<T[K]> };

const overlays: Record<string, unknown> = {};
let active: Locale = DEFAULT_LOCALE;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Writes `overlay` into `target`: nested objects recurse, strings, functions and arrays are replaced wholesale. */
export function applyOverlay(target: object, overlay: unknown): void {
  if (!isPlainObject(overlay)) return;
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    const current = t[key];
    if (isPlainObject(current) && isPlainObject(value)) applyOverlay(current, value);
    else t[key] = value;
  }
}

/** Registers the English dictionary of `domain`; returns it patched with the active overlay, if any. */
export function msg<T extends object>(domain: string, en: T): T {
  const overlay = overlays[domain];
  if (overlay !== undefined) applyOverlay(en, overlay);
  return en;
}

/** Registers a pack (domain → overlay). Must run before the first dictionary module evaluates (web bootstrap). */
export function setOverlays(pack: Readonly<Record<string, unknown>>): void {
  Object.assign(overlays, pack);
}

/** Records the locale the page runs in (read by the web formatters). */
export function setActiveLocale(locale: Locale): void {
  active = locale;
}

/** Locale the page runs in; `en` until the bootstrap says otherwise. */
export const activeLocale = (): Locale => active;
