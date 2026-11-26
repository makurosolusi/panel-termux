import { signInErrorMessage } from "@/web/i18n/id.account";

/**
 * Message for the OAuth callback's `?error=` code; null when there is none. Only the code is read: `error_description`
 * comes from a third party and is never rendered (PLAN/05 F10).
 */
export function loginErrorMessage(params: URLSearchParams): string | null {
  return signInErrorMessage(params.get("error"));
}
