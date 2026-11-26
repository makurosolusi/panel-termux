import type { NetAdapter } from "./system.types";

/** A local connect either succeeds or is refused within milliseconds; the cap only guards odd stacks. */
const CONNECT_TIMEOUT_MS = 1_000;
const LOOPBACK = "127.0.0.1";
/** A health GET of `/` should be answered well within this on a phone. */
const HTTP_TIMEOUT_MS = 5_000;

/** Whether 127.0.0.1:`port` accepts a TCP connection (refused/timeout = not listening). */
export async function isListening(port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((r) => {
    timer = setTimeout(() => r(false), timeoutMs);
  });
  const attempt = Bun.connect({ hostname: LOOPBACK, port, socket: { data() {} } }).then(
    (s) => {
      s.end();
      return true;
    },
    // ECONNREFUSED is the expected "free" answer, not an error.
    () => false,
  );
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP status of GET http://127.0.0.1:`port`/ (redirects not followed); null on error/timeout. */
export async function httpStatus(port: number, timeoutMs = HTTP_TIMEOUT_MS): Promise<number | null> {
  try {
    const res = await fetch(`http://${LOOPBACK}:${port}/`, {
      redirect: "manual",
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
  httpStatus: (port) => httpStatus(port),
});
