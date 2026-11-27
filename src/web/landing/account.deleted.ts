// Dependency-free on purpose: imported by both the landing chunk and the /profile chunk.
/** Where "Delete my account" lands: the landing page with a one-time "account deleted" notice (QA m4). */
export const ACCOUNT_DELETED_HREF = "/?account=deleted";

/**
 * The landing URL carries the account-deleted marker. The pre-0.6.0 `?akun=dihapus` is still accepted for one
 * release (DECISIONS E14); drop it in the release after 0.6.0.
 */
export const isAccountDeletedSearch = (search: string): boolean => {
  const q = new URLSearchParams(search);
  return q.get("account") === "deleted" || q.get("akun") === "dihapus";
};
