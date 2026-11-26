/** Canonical HTTP statuses an ApiError may carry (one list for every route group). */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 421 | 429 | 502 | 503 | 507;

/**
 * Error a handler/service throws to send `{ error: code, message, ...extra }` with `status` (mapped in the route
 * groups' onError). `extra` carries machine-readable detail such as `{ index }` or `{ fields }`; never secrets.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** Response body; `extra` cannot override `error`/`message`. */
  get body(): Record<string, unknown> & { error: string; message: string } {
    return { ...this.extra, error: this.code, message: this.message };
  }
}

/** Default page size for list endpoints. */
export const DEFAULT_PAGE_SIZE = 20;
/** Upper bound for `pageSize`; larger requests are clamped. */
export const MAX_PAGE_SIZE = 100;

/** Validated pagination window. */
export type Paging = { page: number; pageSize: number; offset: number };

const positiveInt = (raw: string | undefined, name: string, fallback: number): number => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "invalid_pagination", `${name} must be an integer >= 1`);
  return n;
};

/** Parses `page`/`pageSize` query params (defaults 1/20, pageSize clamped to 100); 400 on non-positive ints. */
export function parsePaging(query: Record<string, string | undefined>): Paging {
  const page = positiveInt(query.page, "page", 1);
  const pageSize = Math.min(positiveInt(query.pageSize, "pageSize", DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
