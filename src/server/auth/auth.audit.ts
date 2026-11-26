import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { log } from "../log.service";
import type { Auth } from "./auth.service";

const FAILED_WINDOW_MS = 60_000;
const SIGN_OUT_PATH = /\/sign-out$/;
const CALLBACK_PATH = /\/callback\//;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

// Failed OAuth callbacks are not audited (PLAN/04 C17): one aggregate warn per minute, codes only.
let failed = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes the pending failed-callback summary now (tests; also run by the per-minute timer). */
export function flushFailedSignIns(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!failed.size) return;
  const total = [...failed.values()].reduce((a, b) => a + b, 0);
  const codes = [...failed].map(([code, n]) => `${code}×${n}`).join(", ");
  failed = new Map();
  log.warn(`[auth] ${total} failed sign-in callbacks in the last minute: ${codes}`);
}

function noteFailedCallback(location: string): void {
  const code = new URL(location, "http://x").searchParams.get("error") ?? "unknown";
  failed.set(code, (failed.get(code) ?? 0) + 1);
  if (!flushTimer) {
    flushTimer = setTimeout(flushFailedSignIns, FAILED_WINDOW_MS);
    flushTimer.unref?.();
  }
}

/**
 * Forwards /api/auth/* to Better Auth, auditing a successful sign-out (the user is read before the
 * session is gone) and counting OAuth callbacks that end on the login page with `?error=`.
 */
export async function handleAuthRequest(auth: Auth, db: Db, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const signOut = req.method === "POST" && SIGN_OUT_PATH.test(path);
  const before = signOut ? await auth.api.getSession({ headers: req.headers }) : null;
  const res = await auth.handler(req);
  if (before && res.status >= HTTP_OK_MIN && res.status <= HTTP_OK_MAX) {
    recordAudit(db, { actorId: before.user.id, action: "auth.sign_out", target: null });
    log.info(`[auth] user ${before.user.id} signed out`);
  }
  const location = res.headers.get("location");
  if (CALLBACK_PATH.test(path) && location?.includes("error=")) noteFailedCallback(location);
  return res;
}
