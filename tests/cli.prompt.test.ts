import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { type ByteSource, openTty, readAnswer, readLine } from "@/cli/cli.prompt";

/** ByteSource over `text` (string = UTF-8, numbers = raw bytes); records how many bytes were consumed. */
function bytes(...parts: (string | number)[]) {
  const all = parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p)] : [p]));
  let i = 0;
  const next: ByteSource = () => (i < all.length ? (all[i++] as number) : null);
  return { next, consumed: () => i };
}

describe("readAnswer (raw mode)", () => {
  test("Enter ends the answer; Backspace erases one character, also a multibyte one", () => {
    expect(readAnswer(bytes("abc", 127, "d", 13).next, null)).toBe("abd");
    expect(readAnswer(bytes("xé", 127, 127, "y", 10).next, null)).toBe("y");
    expect(readAnswer(bytes(127, 8, "ok", 13).next, null)).toBe("ok");
  });

  test("echo shows typed bytes and erases on Backspace", () => {
    const shown: string[] = [];
    readAnswer(bytes("ab", 127, 13).next, (b) => shown.push(Buffer.from(b).toString()));
    expect(shown.join("")).toBe("ab\b \b");
  });

  test("Ctrl-C throws exit 130", () => {
    expect(() => readAnswer(bytes("ab", 3).next, null)).toThrow(expect.objectContaining({ code: 130 }));
  });

  test("Ctrl-D on an empty line and end of input = null; control bytes are ignored", () => {
    expect(readAnswer(bytes(4).next, null)).toBeNull();
    expect(readAnswer(bytes("ab").next, null)).toBeNull();
    expect(readAnswer(bytes("a", 4, 27, "b", 13).next, null)).toBe("ab");
  });
});

describe("readLine (stdin, --ssh-key -)", () => {
  test("returns one line without its newline and consumes nothing after it", () => {
    const src = bytes("ssh-ed25519 AAAA key\r\nrest");
    expect(readLine(src.next)).toBe("ssh-ed25519 AAAA key");
    expect(src.consumed()).toBe("ssh-ed25519 AAAA key\r\n".length);
  });

  test("last line without newline is returned; empty input = null", () => {
    expect(readLine(bytes("abc").next)).toBe("abc");
    expect(readLine(bytes().next)).toBeNull();
    expect(readLine(bytes("\n").next)).toBe("");
  });
});

describe("openTty", () => {
  test("a missing terminal device = null (no terminal), other errors throw with the path", () => {
    expect(openTty("/nonexistent/panel-tty")).toBeNull();
    expect(() => openTty(tmpdir())).toThrow(tmpdir());
  });
});
