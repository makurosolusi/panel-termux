import { closeSync, openSync, readSync } from "node:fs";
import type { SiteRuntime } from "../../shared/site.types";

const ELF_MAGIC = 0x7f454c46;
const ELF_HEADER_BYTES = 64;
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const EM_AARCH64 = 183;
const PT_INTERP = 3;
/** Sanity caps so a hostile header cannot make us allocate much. */
const MAX_PHDR_BYTES = 64 * 1024;
const MAX_INTERP_BYTES = 4096;
/** Interpreter of bun-linux-arm64-android builds (Android's bionic linker): runs directly. */
const ANDROID_LINKER = "/system/bin/linker64";
/** Interpreter of glibc builds (bun-linux-arm64): needs `grun`. */
const GLIBC_LINKER_RE = /\/ld-linux-aarch64\.so\.1$/;

/** Thrown when a file is not a runnable aarch64 Linux/Android binary; message says why. */
export class BinaryError extends Error {}

/**
 * How pm2 must run the binary at `path`, from its ELF header and PT_INTERP: Android linker (or static) →
 * "native", glibc linker → "grun". Throws BinaryError for non-ELF, non-64-bit/LE, non-aarch64 or unknown linkers.
 */
export function detectRuntime(path: string): SiteRuntime {
  const fd = openSync(path, "r");
  const read = (pos: number, len: number) => {
    const b = Buffer.alloc(len);
    const n = readSync(fd, b, 0, len, pos);
    if (n < len) throw new BinaryError("binary is truncated (ELF headers point past the end)");
    return b;
  };
  try {
    const head = Buffer.alloc(ELF_HEADER_BYTES);
    const n = readSync(fd, head, 0, ELF_HEADER_BYTES, 0);
    if (n < ELF_HEADER_BYTES || head.readUInt32BE(0) !== ELF_MAGIC) throw new BinaryError("not an ELF binary");
    if (head[4] !== ELFCLASS64 || head[5] !== ELFDATA2LSB) throw new BinaryError("not a 64-bit little-endian ELF");
    const machine = head.readUInt16LE(18);
    if (machine !== EM_AARCH64) {
      throw new BinaryError(`ELF machine ${machine} is not aarch64; build with --target=bun-linux-arm64-android`);
    }
    const phoff = Number(head.readBigUInt64LE(32));
    const phentsize = head.readUInt16LE(54);
    const phnum = head.readUInt16LE(56);
    if (phentsize * phnum > MAX_PHDR_BYTES) throw new BinaryError("ELF program header table too large");
    const ph = read(phoff, phentsize * phnum);
    for (let i = 0; i < phnum; i++) {
      const o = i * phentsize;
      if (ph.readUInt32LE(o) !== PT_INTERP) continue;
      const size = Number(ph.readBigUInt64LE(o + 32));
      if (size > MAX_INTERP_BYTES) throw new BinaryError("ELF interpreter path too long");
      const interp =
        read(Number(ph.readBigUInt64LE(o + 8)), size)
          .toString("latin1")
          .split("\0")[0] ?? "";
      if (interp === ANDROID_LINKER) return "native";
      if (GLIBC_LINKER_RE.test(interp)) return "grun";
      throw new BinaryError(`unsupported ELF interpreter ${JSON.stringify(interp)}`);
    }
    return "native"; // statically linked: runs directly
  } finally {
    closeSync(fd);
  }
}
