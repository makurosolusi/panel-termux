// Terminal questions of the CLI (PLAN/07 §4.3, debate D6). Answers are read from /dev/tty in raw mode, so the
// question goes to the terminal (stdout stays clean), Ctrl-C is one byte (exit 130 through CliExit: the lock is
// released by init's finally) and a secret is never echoed. ENXIO on /dev/tty = no controlling terminal (ssh
// without -t, D6). Without a terminal only `ask` answers, from one stdin line (`--ssh-key -`, C26).
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { ReadStream } from "node:tty";
import { CliExit } from "./cli.output";
import { INIT_EXIT } from "./init.types";

/** open("/dev/tty") errors that mean "no terminal here" (D6: ENXIO in a non-interactive ssh). */
const NO_TTY = new Set(["ENXIO", "ENOENT", "ENODEV", "ENOTTY", "EACCES", "EPERM"]);
const ENTER = new Set([10, 13]);
const BACKSPACE = new Set([8, 127]);
const CTRL_C = 3;
const CTRL_D = 4;

/** Next input byte, or null at end of input. */
export type ByteSource = () => number | null;

/** Bytes of `fd`, one read per byte so nothing after the answer's newline is consumed. */
export function fdBytes(fd: number): ByteSource {
  const b = Buffer.alloc(1);
  return () => (readSync(fd, b, 0, 1, null) === 1 ? (b[0] as number) : null);
}

/** One stdin line without its newline (`--ssh-key -`); null at EOF with nothing read. */
export function readLine(next: ByteSource = fdBytes(0)): string | null {
  const bytes: number[] = [];
  for (let c = next(); c !== null; c = next()) {
    if (c === 10) return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
    bytes.push(c);
  }
  return bytes.length > 0 ? Buffer.from(bytes).toString("utf8") : null;
}

/**
 * One raw-mode answer: Enter ends it, Backspace erases a character, Ctrl-C throws CliExit 130, Ctrl-D on an empty
 * line (or end of input) = null. `echo` gets what to show (typed text, or erase sequences); null = no echo.
 */
export function readAnswer(next: ByteSource, echo: ((bytes: Uint8Array) => void) | null): string | null {
  const bytes: number[] = [];
  for (;;) {
    const c = next();
    if (c === null || (c === CTRL_D && bytes.length === 0)) return null;
    if (c === CTRL_C) throw new CliExit(INIT_EXIT.interrupted, "Dibatalkan (Ctrl-C).");
    if (ENTER.has(c)) return Buffer.from(bytes).toString("utf8");
    if (BACKSPACE.has(c)) {
      if (bytes.length === 0) continue;
      // drop UTF-8 continuation bytes too, so one Backspace = one character
      while (bytes.length > 0 && ((bytes.pop() as number) & 0xc0) === 0x80);
      echo?.(Buffer.from("\b \b"));
    } else if (c >= 32) {
      bytes.push(c);
      echo?.(Buffer.of(c)); // raw byte: the terminal assembles UTF-8 itself
    }
  }
}

/** The controlling terminal opened read/write, or null when there is none (D6). Other errors throw. */
export function openTty(path = "/dev/tty"): number | null {
  try {
    return openSync(path, "r+");
  } catch (e) {
    if (NO_TTY.has((e as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error(`open ${path} failed: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * Asks `question` on the terminal at `path` in raw mode; null when there is no terminal or at EOF. The ReadStream owns
 * the fd once built (destroy() closes it; a second closeSync could hit an fd reused meanwhile); before that we close it.
 */
export function askTerminal(question: string, secret: boolean, path = "/dev/tty"): string | null {
  const fd = openTty(path);
  if (fd === null) return null;
  let stream: ReadStream;
  try {
    stream = new ReadStream(fd);
  } catch (e) {
    closeSync(fd);
    throw new Error(`open terminal ${path} failed: ${(e as Error).message}`, { cause: e });
  }
  const write = (t: string | Uint8Array) => writeSync(fd, typeof t === "string" ? Buffer.from(t) : t);
  let raw = false;
  try {
    write(`${question} `);
    stream.setRawMode(true);
    raw = true;
    return readAnswer(fdBytes(fd), secret ? null : write);
  } finally {
    if (raw) stream.setRawMode(false);
    if (raw) write("\n");
    stream.destroy();
  }
}

/** Visible one-line answer: on the terminal when stdin is one, else one stdin line (CliHost.tty.ask). */
export async function ttyAsk(question: string): Promise<string | null> {
  return process.stdin.isTTY ? askTerminal(question, false) : readLine();
}

/** Answer typed without echo (CliHost.tty.secret); null without a terminal: secrets are never read from a pipe. */
export async function ttySecret(question: string): Promise<string | null> {
  return process.stdin.isTTY ? askTerminal(question, true) : null;
}
