import { open } from "node:fs/promises";

/** Bytes read from the end of a log file; ~512 B per line for the 2000-line maximum. */
const TAIL_WINDOW_BYTES = 1024 * 1024;

/**
 * Last `n` lines of a text file (oldest first), reading at most the final 1 MiB.
 * Returns null when the file does not exist; other I/O errors throw with the path.
 */
export async function tailFile(path: string, n: number): Promise<string[] | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(path, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`tail ${path}: ${(e as Error).message}`, { cause: e });
  }
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_WINDOW_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (lines.at(-1) === "") lines.pop();
    // A cut window starts mid-line; drop that fragment.
    if (len < size) lines.shift();
    return lines.slice(-n);
  } catch (e) {
    throw new Error(`tail ${path}: ${(e as Error).message}`, { cause: e });
  } finally {
    await fh.close();
  }
}
