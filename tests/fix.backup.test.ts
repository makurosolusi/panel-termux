// Local fix backups (PLAN/06 F6, DECISIONS C5): names, ids, retention, traversal-safe resolve, modes, I/O mapping.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIX_BACKUP_KEEP,
  fixIoError,
  latestFixBackups,
  listFixBackups,
  resolveFixBackup,
  saveFixBackup,
} from "@/server/sites/fix.backup";
import { writeAtomic } from "@/server/sites/site.files";

const root = mkdtempSync(join(tmpdir(), "panel-fix-backup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SHA = "0123abcd".repeat(8); // test-only
const at = (s: number, ms = 0) => new Date(Date.UTC(2026, 10, 27, 10, 0, s, ms));

describe("fix backups", () => {
  test("name, id, content and modes (folder 700, file 600)", () => {
    const data = join(root, "d1");
    const e = saveFixBackup(data, "ecosystem", Buffer.from([0xef, 0xbb, 0xbf, 0x41]), SHA, at(5, 42));
    expect(e).toEqual({
      id: "ecosystem.20261127-100005042-0123abcd",
      file: "ecosystem",
      path: join(data, "fix-backups", "ecosystem", "20261127-100005042-0123abcd.bak"),
      at: "2026-11-27T10:00:05.042Z",
      sha8: "0123abcd",
    });
    expect([...readFileSync(e.path)]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect(statSync(e.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(data, "fix-backups")).mode & 0o777).toBe(0o700);
    expect(statSync(join(data, "fix-backups", "ecosystem")).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(data, "fix-backups", "ecosystem"))).toEqual(["20261127-100005042-0123abcd.bak"]);
    expect(resolveFixBackup(data, e.id)).toEqual(e);
    expect(() => saveFixBackup(data, "ecosystem", Buffer.from("x"), "not-hex")).toThrow(/hex/);
  });

  test("keeps the 10 newest per file; other file untouched; latest across files", () => {
    const data = join(root, "d2");
    for (let s = 0; s < 13; s++) saveFixBackup(data, "pm2_run", Buffer.from(`v${s}`), SHA, at(s));
    saveFixBackup(data, "ecosystem", Buffer.from("e"), SHA, at(1));
    const runs = listFixBackups(data, "pm2_run");
    expect(runs).toHaveLength(FIX_BACKUP_KEEP);
    expect(runs[0]?.id).toBe("pm2_run.20261127-100012000-0123abcd");
    expect(runs.at(-1)?.id).toBe("pm2_run.20261127-100003000-0123abcd");
    expect(listFixBackups(data, "ecosystem")).toHaveLength(1);
    expect(latestFixBackups(data).map((e) => e.id)).toEqual([
      "pm2_run.20261127-100012000-0123abcd",
      "ecosystem.20261127-100001000-0123abcd",
    ]);
    expect(latestFixBackups(join(root, "empty"))).toEqual([]);
  });

  test("two fixes in one second keep their order; second-only names from 0.4.0 betas still read", () => {
    const data = join(root, "d4");
    saveFixBackup(data, "ecosystem", Buffer.from("e"), SHA, at(7, 900));
    saveFixBackup(data, "pm2_run", Buffer.from("r"), SHA, at(7, 901));
    expect(latestFixBackups(data).map((e) => e.file)).toEqual(["pm2_run", "ecosystem"]);
    const old = join(data, "fix-backups", "ecosystem", "20261127-100006-0123abcd.bak");
    writeFileSync(old, "old");
    const legacy = resolveFixBackup(data, "ecosystem.20261127-100006-0123abcd");
    expect(legacy).toMatchObject({ path: old, at: "2026-11-27T10:00:06.000Z", sha8: "0123abcd" });
    expect(listFixBackups(data, "ecosystem").map((e) => e.at)).toEqual([
      "2026-11-27T10:00:07.900Z",
      "2026-11-27T10:00:06.000Z",
    ]);
  });

  test.each([
    "ecosystem.20261127-100005000-0123abcd/../../secret",
    "../ecosystem.20261127-100005000-0123abcd",
    "ecosystem%2F..%2F20261127-100005000-0123abcd",
    "ecosystem.20261127-100005000-0123ABCD",
    "other.20261127-100005000-0123abcd",
    "ecosystem.20261127-100006000-0123abcd", // well-formed, not on disk
    "ecosystem.20261127-1000050-0123abcd", // 7 digits: neither format
    "",
  ])("resolve refuses %p", (id) => {
    const data = join(root, "d3");
    saveFixBackup(data, "ecosystem", Buffer.from("x"), SHA, at(5));
    expect(resolveFixBackup(data, id)).toBeNull();
  });

  test("I/O failures map to fix error codes through the cause chain", () => {
    const errno = (code: string) => Object.assign(new Error(code), { code });
    expect(fixIoError(new Error("write /x: no space", { cause: errno("ENOSPC") }))).toBe("disk_full");
    expect(fixIoError(errno("EACCES"))).toBe("not_writable");
    expect(fixIoError(errno("EPERM"))).toBe("not_writable");
    expect(fixIoError(errno("EIO"))).toBeNull();
    expect(fixIoError("nope")).toBeNull();
  });

  test.skipIf(process.getuid?.() === 0)("a real EACCES from writeAtomic maps to not_writable, file intact", () => {
    const dir = join(root, "ro");
    mkdirSync(dir);
    writeFileSync(join(dir, "f.config.js"), "old");
    chmodSync(dir, 0o500);
    try {
      let err: unknown = null;
      try {
        writeAtomic(join(dir, "f.config.js"), "new");
      } catch (e) {
        err = e;
      }
      expect(fixIoError(err)).toBe("not_writable");
      expect(readFileSync(join(dir, "f.config.js"), "utf8")).toBe("old");
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
