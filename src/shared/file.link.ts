// Hard link with a copy fallback (E9): Android refuses link(2) in Termux app data (EACCES), so every "keep this
// binary under a second name" (site deploy/rollback, panel init's panel.prev, panel rollback) copies there instead.
// Node builtins only: the CLI imports this without reaching src/server.
import { closeSync, copyFileSync, fsyncSync, linkSync, openSync, readSync, renameSync, statSync } from "node:fs";

/** `link(2)`; tests pass one that fails like Termux (EACCES) to take the copy path. */
export type LinkFn = (src: string, dst: string) => void;

/** `link` errors that mean "no hardlinks here" → copy instead. */
const LINK_REFUSED = new Set(["EACCES", "EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "EMLINK"]);
const CHUNK = 1024 * 1024;

/** fsync of a file or directory (directory = make renames in it durable). */
export function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Hardlinks `src` to `dst` (true); when refused, copies `src` to `via ?? dst`, fsyncs it, calls `onCopied`, then
 * renames `via` to `dst` (false). With `via`, `dst` never holds a partial copy. Other link errors throw with context.
 */
export function linkOrCopy(
  src: string,
  dst: string,
  o: { link?: LinkFn; via?: string; onCopied?: () => void } = {},
): boolean {
  try {
    (o.link ?? linkSync)(src, dst);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (!LINK_REFUSED.has(code)) throw new Error(`link ${src} → ${dst}: ${(e as Error).message}`, { cause: e });
  }
  const tmp = o.via ?? dst;
  copyFileSync(src, tmp);
  fsyncPath(tmp);
  o.onCopied?.();
  if (o.via) renameSync(o.via, dst);
  return false;
}

/** Same bytes: same inode (hard link), or same size and content (copy), compared in 1 MB chunks. */
export function sameFile(a: string, b: string): boolean {
  const [sa, sb] = [statSync(a), statSync(b)];
  if (sa.dev === sb.dev && sa.ino === sb.ino) return true;
  if (sa.size !== sb.size) return false;
  const [fa, fb] = [openSync(a, "r"), openSync(b, "r")];
  try {
    const [ba, bb] = [Buffer.alloc(CHUNK), Buffer.alloc(CHUNK)];
    for (let pos = 0; pos < sa.size; pos += CHUNK) {
      const n = readSync(fa, ba, 0, CHUNK, pos);
      if (n !== readSync(fb, bb, 0, CHUNK, pos) || !ba.subarray(0, n).equals(bb.subarray(0, n))) return false;
      if (n === 0) break;
    }
    return true;
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}
