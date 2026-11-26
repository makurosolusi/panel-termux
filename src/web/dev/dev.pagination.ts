/** Default page size of dev list views (matches the API default). */
export const DEV_PAGE_SIZE = 20;

/** Number of pages for `total` items (at least 1, so "page 1 of 1" shows for empty lists). */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

/** Reads `?page=` as a positive integer, falling back to 1 for missing or malformed values. */
export function parsePageParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Copy of `params` with `key` set (or removed when empty) and `page` reset to 1 — for filter/search changes. */
export function withFilter(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete("page");
  return next;
}

/** Copy of `params` pointing at `page` (page 1 drops the param to keep URLs clean). */
export function withPage(params: URLSearchParams, page: number): URLSearchParams {
  const next = new URLSearchParams(params);
  if (page > 1) next.set("page", String(page));
  else next.delete("page");
  return next;
}
