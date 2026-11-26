import type { NetAdapter } from "./system.types";

/** A local connect either succeeds or is refused within milliseconds; the cap only guards odd stacks. */
const CONNECT_TIMEOUT_MS = 1_000;
const LOOPBACK = "127.0.0.1";

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

/** Real network adapter. */
export const createTermuxNet = (): NetAdapter => ({ isListening: (port) => isListening(port) });
