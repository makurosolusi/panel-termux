import { ApiError } from "../routes/http.error";

/**
 * Per-resource mutex for control actions: a second action on a busy key fails fast with 409 `busy`
 * instead of queueing. In-process only (the panel is a single process).
 */
export function createActionLocks() {
  const held = new Set<string>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (held.has(key)) throw new ApiError(409, "busy", `${key} is busy with another action`);
    held.add(key);
    try {
      return await fn();
    } finally {
      held.delete(key);
    }
  };
}
