// Log contract shared by every log endpoint and the web LogViewer (DECISIONS B13). Lines are oldest first.
import type { LogLevel } from "./dev.types";

/** One log line as shown; `at` = ISO-8601 UTC when the line carried a timestamp we could parse. */
export type LogLine = { at: string | null; text: string; stream?: "out" | "err"; level?: LogLevel };

/**
 * One follow response. `cursor` is opaque (`base64url("<ino>:<offset>")`); `reset` = file rotated/replaced or the
 * cursor was invalid, drop what you have; `truncated` = more than the server sends at once (256 KiB) was new.
 */
export type LogChunk = { lines: LogLine[]; cursor: string; reset: boolean; truncated: boolean };
