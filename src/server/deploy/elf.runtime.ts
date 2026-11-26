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
/** Enough of a file for the ELF header, program headers and interpreter path of a bun binary. */
export const ELF_PROBE_BYTES = 1024 * 1024;
/** Interpreter of bun-linux-arm64-android builds (Android's bionic linker): runs directly. */
const ANDROID_LINKER = "/system/bin/linker64";
/** Interpreter of glibc builds (bun-linux-arm64): needs `grun`. */
const GLIBC_LINKER_RE = /\/ld-linux-aarch64\.so\.1$/;

/** Why a file is not a runnable binary (API `invalid_binary.reason`). */
export type BinaryReason = "not_elf" | "not_64le" | "not_aarch64" | "interp" | "truncated";

/** Thrown when a file is not a runnable aarch64 Linux/Android binary; `reason` is the API code, message says why. */
export class BinaryError extends Error {
  constructor(
    readonly reason: BinaryReason,
    message: string,
  ) {
    super(message);
  }
}

/**
 * How pm2 must run the binary whose first bytes are `head` (the start of the file, e.g. upload chunk 0):
 * Android linker (or static) → "native", glibc linker → "grun". Throws BinaryError otherwise.
 */
export function detectRuntimeBuffer(head: Uint8Array): SiteRuntime {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  const slice = (pos: number, len: number) => {
    if (pos + len > b.length)
      throw new BinaryError("truncated", "binary is truncated (ELF headers point past the end)");
    return b.subarray(pos, pos + len);
  };
  if (b.length < ELF_HEADER_BYTES || b.readUInt32BE(0) !== ELF_MAGIC) {
    throw new BinaryError("not_elf", "not an ELF binary");
  }
  if (b[4] !== ELFCLASS64 || b[5] !== ELFDATA2LSB) {
    throw new BinaryError("not_64le", "not a 64-bit little-endian ELF");
  }
  const machine = b.readUInt16LE(18);
  if (machine !== EM_AARCH64) {
    throw new BinaryError(
      "not_aarch64",
      `ELF machine ${machine} is not aarch64; build with --target=bun-linux-arm64-android`,
    );
  }
  const phoff = Number(b.readBigUInt64LE(32));
  const phentsize = b.readUInt16LE(54);
  const phnum = b.readUInt16LE(56);
  if (phentsize * phnum > MAX_PHDR_BYTES) throw new BinaryError("truncated", "ELF program header table too large");
  const ph = slice(phoff, phentsize * phnum);
  for (let i = 0; i < phnum; i++) {
    const o = i * phentsize;
    if (ph.readUInt32LE(o) !== PT_INTERP) continue;
    const size = Number(ph.readBigUInt64LE(o + 32));
    if (size > MAX_INTERP_BYTES) throw new BinaryError("interp", "ELF interpreter path too long");
    const interp =
      slice(Number(ph.readBigUInt64LE(o + 8)), size)
        .toString("latin1")
        .split("\0")[0] ?? "";
    if (interp === ANDROID_LINKER) return "native";
    if (GLIBC_LINKER_RE.test(interp)) return "grun";
    throw new BinaryError("interp", `unsupported ELF interpreter ${JSON.stringify(interp)}`);
  }
  return "native"; // statically linked: runs directly
}

/** detectRuntimeBuffer on the first ELF_PROBE_BYTES of the file at `path`. */
export function detectRuntime(path: string): SiteRuntime {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(ELF_PROBE_BYTES);
    const n = readSync(fd, b, 0, ELF_PROBE_BYTES, 0);
    return detectRuntimeBuffer(b.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}
