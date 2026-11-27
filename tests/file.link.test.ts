import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LinkFn, linkOrCopy, sameFile } from "@/shared/file.link";

const dir = mkdtempSync(join(tmpdir(), "panel-file-link-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const f = (name: string, body?: string) => {
  const path = join(dir, name);
  if (body !== undefined) writeFileSync(path, body);
  return path;
};
const refuse =
  (code: string): LinkFn =>
  () => {
    throw Object.assign(new Error(`${code}: link`), { code });
  };

describe("linkOrCopy", () => {
  test("EACCES (Termux, E9) → copy via the temp name, which is gone afterwards", () => {
    const [src, dst, via] = [f("a", "bytes"), f("a.dst"), f("a.tmp")];
    let copied = false;
    expect(linkOrCopy(src, dst, { link: refuse("EACCES"), via, onCopied: () => (copied = existsSync(via)) })).toBe(
      false,
    );
    expect(copied).toBe(true);
    expect(readFileSync(dst, "utf8")).toBe("bytes");
    expect(statSync(dst).ino).not.toBe(statSync(src).ino);
    expect(existsSync(via)).toBe(false);
  });

  test("allowed → hard link; any other link error throws with both paths", () => {
    const [src, dst] = [f("b", "x"), f("b.dst")];
    expect(linkOrCopy(src, dst)).toBe(true);
    expect(statSync(dst).ino).toBe(statSync(src).ino);
    expect(() => linkOrCopy(src, f("c.dst"), { link: refuse("ENOENT") })).toThrow(`link ${src} → ${f("c.dst")}`);
  });
});

describe("sameFile", () => {
  test("hard link, equal copy → true; same size other bytes, other size → false", () => {
    const a = f("s", "abcdef");
    linkSync(a, f("s.link"));
    expect(sameFile(a, f("s.link"))).toBe(true);
    expect(sameFile(a, f("s.copy", "abcdef"))).toBe(true);
    expect(sameFile(a, f("s.other", "abcdeX"))).toBe(false);
    expect(sameFile(a, f("s.short", "abc"))).toBe(false);
  });
});
