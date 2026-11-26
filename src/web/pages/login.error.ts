import { id } from "@/web/i18n/id";

/** Message for any `?error=` code from the OAuth callback; null when there is none. */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return id.login.errors.generic;
}
