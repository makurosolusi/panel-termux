// Recovery from code-split chunks that fail to load after a panel update (PLAN/01 D12, §3.11).

/**
 * Browser messages for a failed dynamic import: Chrome/Edge, Safari, Firefox, and CSS preload. A missing chunk that
 * the server answers with 404 text/plain or (before B11) with the SPA HTML at 200 throws the same messages.
 */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** True when `err` is a failed chunk/module load (worth one page reload). */
export function isChunkLoadError(err: unknown): boolean {
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  return typeof message === "string" && CHUNK_ERROR.test(message);
}

/** sessionStorage key of the last chunk-failure reload. */
export const CHUNK_RELOAD_KEY = "panel.chunkReloadAt";
/** A second failure within this window after our reload means reloading does not help (loop guard). */
export const RELOAD_ONCE_WINDOW_MS = 30_000;

/** Whether to reload now, given when we last did (ms epoch, or null if never; NaN counts as never). */
export const shouldReloadOnce = (lastReloadAt: number | null, now: number): boolean =>
  lastReloadAt === null || !(now - lastReloadAt < RELOAD_ONCE_WINDOW_MS);

/** Where `reloadOnce` keeps its marker and how it reloads; injectable for tests. */
export type ReloadEnv = { storage: Pick<Storage, "getItem" | "setItem">; reload: () => void };

/**
 * Reloads the page unless it already did so for `key` within the last 30 s. Returns false (caller shows its error
 * state) when refused or when sessionStorage is unavailable, since then a reload could loop.
 */
export function reloadOnce(key: string, now: number = Date.now(), env?: ReloadEnv): boolean {
  try {
    const storage = env?.storage ?? sessionStorage;
    const raw = storage.getItem(key);
    if (!shouldReloadOnce(raw === null ? null : Number(raw), now)) return false;
    storage.setItem(key, String(now));
  } catch (cause) {
    console.warn(`reload guard ${key}: sessionStorage unavailable, not reloading`, cause);
    return false;
  }
  (env?.reload ?? (() => window.location.reload()))();
  return true;
}
