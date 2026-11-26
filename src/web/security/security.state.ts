import type { SecurityStatus } from "@/shared/security.types";
import type { StatusKey } from "@/web/components/status.vocab";

/** What the Cloudflare Access row says: not applicable (http), seen, or not seen yet. */
export type AccessState = "not_https" | "seen" | "not_seen";

/** Access row state from the security status. */
export const accessState = (a: SecurityStatus["access"]): AccessState =>
  !a.https ? "not_https" : a.lastSeenAt ? "seen" : "not_seen";

/** Badge of the data key card: "Cocok" (ok) or "Kunci tidak cocok" (danger). */
export const dataKeyStatusKey = (state: SecurityStatus["dataKey"]["state"]): StatusKey =>
  state === "ok" ? "succeeded" : "key_mismatch";
