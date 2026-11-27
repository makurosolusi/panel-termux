import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** File contents, or null when the file does not exist. Other errors throw with the path. */
export function readTextOrNull(path: string): string | null {
  const b = readBytesOrNull(path);
  return b === null ? null : b.toString("utf8");
}

/** File bytes, or null when the file does not exist (no decoding, so nothing turns into U+FFFD). */
export function readBytesOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`read ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Strict UTF-8 decode that keeps a BOM in the text (it re-encodes byte-identically); null when not UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (e) {
    if (e instanceof TypeError) return null; // the decoder's only failure: invalid byte sequence
    throw e;
  }
}

/** Temp path next to `path` (same filesystem, so rename is atomic). */
export const tempPathFor = (path: string) => join(dirname(path), `.${basename(path)}.panel-tmp`);

/** fsyncs a file or directory so a power cut after this call keeps it (A9). */
export function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes `data` to a new file `path` with `mode` and fsyncs it before returning. */
export function writeFileSynced(path: string, data: string | Uint8Array, mode: number): void {
  const fd = openSync(path, "w", mode);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, mode); // open's mode is masked by umask
}

/**
 * Writes `data` to `path` atomically and durably: temp file (fsynced) + rename + fsync of the directory, with
 * `mode`. With `backup`, the previous file is first copied (and fsynced) to `<path>.bak`.
 */
export function writeAtomic(
  path: string,
  data: string | Uint8Array,
  { mode = 0o644, backup = false }: { mode?: number; backup?: boolean } = {},
): void {
  const tmp = tempPathFor(path);
  try {
    if (backup && existsSync(path)) {
      copyFileSync(path, `${path}.bak`);
      fsyncPath(`${path}.bak`);
    }
    writeFileSynced(tmp, data, mode);
    renameSync(tmp, path);
    fsyncPath(dirname(path));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`write ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Puts back what `readTextOrNull` returned before an edit: rewrites the old bytes, or removes the file if it was absent. */
export function restoreText(path: string, previous: string | null, mode = 0o644): void {
  if (previous === null) rmSync(path, { force: true });
  else writeAtomic(path, previous, { mode });
}
