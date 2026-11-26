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

/** Health endpoint used to tell a stale bundle (server answers) from a server that is down. */
export const HEALTH_URL = "/api/health";

/**
 * True when the panel itself answers `/api/health` with 2xx. A failed request (offline, server down) or a non-2xx
 * from a proxy in front (cloudflared 502/530 while the panel is down) is false: reloading would only swap the SPA for
 * a browser or proxy error page.
 */
export async function serverReachable(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(HEALTH_URL, { cache: "no-store" });
    return res.ok;
  } catch (cause) {
    console.warn(`chunk recovery: ${HEALTH_URL} unreachable`, cause);
    return false;
  }
}

/** Outcome of `recoverChunk`: reload started, server down (show the offline message), or reload already tried. */
export type ChunkRecovery = "reloading" | "offline" | "stale";

/**
 * Recovery for a failed chunk: reload once only when the server answers (a newer bundle after an update); when it
 * does not, return "offline" so the caller stays in the app with a retry instead of reloading into an error page.
 */
export async function recoverChunk(
  key: string,
  deps: { reachable?: () => Promise<boolean>; reload?: (key: string) => boolean } = {},
): Promise<ChunkRecovery> {
  if (!(await (deps.reachable ?? serverReachable)())) return "offline";
  return (deps.reload ?? reloadOnce)(key) ? "reloading" : "stale";
}
