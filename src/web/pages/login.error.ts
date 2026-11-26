import { id } from "@/web/i18n/id";

/** Maps the `?error=` code from the OAuth callback to a message; null when there is none. */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return code === "not_invited" ? id.login.errors.not_invited : id.login.errors.generic;
}
