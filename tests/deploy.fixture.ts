// Shared helpers of tests/deploy.*.test.ts (not a test file itself).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ANDROID_LINKER = "/system/bin/linker64";
export const GLIBC_LINKER = "/lib/ld-linux-aarch64.so.1";
const EM_AARCH64 = 183;
const PHDR = 56;

/** Minimal 64-bit LE ELF: header + PT_PHDR + optional PT_INTERP, padded with `fill` to `size` bytes. */
export function fakeElf({
  interp = ANDROID_LINKER as string | null,
  machine = EM_AARCH64,
  size = 4096,
  fill = 0,
} = {}): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(size, fill);
  b.fill(0, 0, 64 + 2 * PHDR + 64);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2;
  b[5] = 1;
  b[6] = 1;
  b.writeUInt16LE(3, 16);
  b.writeUInt16LE(machine, 18);
  b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(64n, 32);
  b.writeUInt16LE(64, 52);
  b.writeUInt16LE(PHDR, 54);
  b.writeUInt16LE(interp === null ? 1 : 2, 56);
  b.writeUInt32LE(6, 64); // PT_PHDR
  if (interp !== null) {
    const o = 64 + PHDR;
    const at = 64 + 2 * PHDR;
    b.writeUInt32LE(3, o); // PT_INTERP
    b.writeBigUInt64LE(BigInt(at), o + 8);
    b.writeBigUInt64LE(BigInt(interp.length + 1), o + 32);
    b.write(`${interp}\0`, at, "latin1");
  }
  return new Uint8Array(b);
}

/** Lowercase hex sha256. */
export const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** Compiles a tiny script with `bun build --compile --target=<target>` into a temp dir; returns the path. */
export function compileTiny(target: "bun-linux-arm64-android" | "bun-linux-arm64"): string {
  const dir = mkdtempSync(join(tmpdir(), "panel-elf-"));
  const src = join(dir, "a.ts");
  writeFileSync(src, "console.log(1);\n");
  const out = join(dir, "app");
  const r = Bun.spawnSync(["bun", "build", "--compile", `--target=${target}`, src, "--outfile", out]);
  if (r.exitCode !== 0) throw new Error(`bun build --compile ${target} failed: ${r.stderr.toString().slice(0, 300)}`);
  return out;
}
