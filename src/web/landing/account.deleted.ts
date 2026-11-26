// Dependency-free on purpose: imported by both the landing chunk and the /profile chunk.
/** Where "Hapus akun saya" lands: the landing page with a one-time "akun dihapus" notice (QA m4). */
export const ACCOUNT_DELETED_HREF = "/?akun=dihapus";

/** The landing URL carries the account-deleted marker. */
export const isAccountDeletedSearch = (search: string): boolean =>
  new URLSearchParams(search).get("akun") === "dihapus";
