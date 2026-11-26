import { id } from "@/web/i18n/id";
import { runApiAction } from "@/web/shared/api.action";
import { apiErrorMessage, apiUrl } from "@/web/shared/api.client";

export { apiFetch as devFetch } from "@/web/shared/api.client";

/** Builds `/api/dev<path>?<query>`, skipping empty params. */
export const devUrl = (path: string, query?: Parameters<typeof apiUrl>[2]): string => apiUrl("/api/dev", path, query);

/** User-facing message for a dev API failure (dev error codes first). */
export const devErrorMessage = (err: unknown): string => apiErrorMessage(err, id.dev.errorCodes);

/** Runs a dev mutation, toasting `success` or the dev-mapped error; resolves to whether it succeeded. */
export const runDevAction = (mutation: () => Promise<unknown>, success: string): Promise<boolean> =>
  runApiAction(mutation, success, id.dev.errorCodes);
