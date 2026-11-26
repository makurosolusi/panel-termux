import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request facts for audit rows; IP already masked (Rule 12), user agent already shortened. */
export type RequestContext = { requestId: string; ipMasked: string | null; userAgent: string | null };

const store = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `ctx` as the current request (survives awaits inside `fn`). */
export function runWithRequest<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/** The request being handled, or null outside one (e.g. the backup scheduler). */
export function currentRequest(): RequestContext | null {
  return store.getStore() ?? null;
}
