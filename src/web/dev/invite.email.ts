// ponytail: shape check only (x@y.z, no spaces); the server is the authority and answers 400 `invalid_email`.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lower-cased email when it looks valid, otherwise null. */
export function normalizeInviteEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
}
