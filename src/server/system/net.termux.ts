import type { NetAdapter } from "./system.types";

/** A local connect either succeeds or is refused within milliseconds; the cap only guards odd stacks. */
const CONNECT_TIMEOUT_MS = 1_000;
const LOOPBACK = "127.0.0.1";
/** A health GET should be answered well within this on a phone. */
const HTTP_TIMEOUT_MS = 5_000;

/** Whether a TCP or unix-socket connect succeeds (refused/timeout = false). */
async function connects(
  target: { hostname: string; port: number } | { unix: string },
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((r) => {
    timer = setTimeout(() => r(false), timeoutMs);
  });
  const socket = { data() {} };
  const attempt = (
    "unix" in target ? Bun.connect({ unix: target.unix, socket }) : Bun.connect({ ...target, socket })
  ).then(
    (s) => {
      s.end();
      return true;
    },
    // ECONNREFUSED/ENOENT is the expected "nobody there" answer, not an error.
    () => false,
  );
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether 127.0.0.1:`port` accepts a TCP connection (refused/timeout = not listening). */
export const isListening = (port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> =>
  connects({ hostname: LOOPBACK, port }, timeoutMs);

/** Whether a process accepts connections on unix socket `path` (a stale socket file left by a dead daemon = false). */
export const unixSocketAlive = (path: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> =>
  connects({ unix: path }, timeoutMs);

/**
 * HTTP status of GET http://127.0.0.1:`port``path` (redirects not followed); `host` is sent as the Host header
 * (Bun's fetch honours it, checked in tests). null on error/timeout.
 */
export async function httpStatus(
  port: number,
  path = "/",
  timeoutMs = HTTP_TIMEOUT_MS,
  host?: string,
): Promise<number | null> {
  try {
    const res = await fetch(`http://${LOOPBACK}:${port}${path.startsWith("/") ? path : `/${path}`}`, {
      redirect: "manual",
      headers: host ? { Host: host } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    // Refused/reset/timeout all mean "not answering yet"; callers poll.
    return null;
  }
}

/** Real network adapter. */
export const createTermuxNet = (): NetAdapter => ({
  isListening: (port) => isListening(port),
  httpStatus,
});
