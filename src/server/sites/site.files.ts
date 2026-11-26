import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** File contents, or null when the file does not exist. Other errors throw with the path. */
export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`read ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Temp path next to `path` (same filesystem, so rename is atomic). */
export const tempPathFor = (path: string) => join(dirname(path), `.${basename(path)}.panel-tmp`);

/**
 * Writes `text` to `path` atomically (temp file + rename) with `mode`. With `backup`, the previous
 * file is first copied to `<path>.bak`.
 */
export function writeAtomic(path: string, text: string, { mode = 0o644, backup = false } = {}): void {
  const tmp = tempPathFor(path);
  try {
    if (backup && existsSync(path)) copyFileSync(path, `${path}.bak`);
    writeFileSync(tmp, text, { mode });
    chmodSync(tmp, mode); // writeFileSync's mode is masked by umask
    renameSync(tmp, path);
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
