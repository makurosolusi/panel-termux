import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, type FakeHostOptions } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { binaryStep, releaseBlocker } from "@/cli/init.binary";
import { runInit } from "@/cli/init.command";
import { SELF_VERSION } from "@/cli/init.mode";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-binary-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
// releaseTag() reads the build-time identifier; in bun test it is a plain global, so tests can set it (test-only).
const setTag = (tag: string) => Reflect.set(globalThis, "__PANEL_RELEASE_TAG__", tag);
afterEach(() => Reflect.deleteProperty(globalThis, "__PANEL_RELEASE_TAG__"));

const SELF = "\x7fELF new panel build\n"; // test-only bytes of "this binary"
const HASH = new Bun.CryptoHasher("sha256").update(SELF).digest("hex");
const sums =
  (hash = HASH) =>
  async () =>
    new Response(`${hash}  panel\n`, { status: 200 });

let n = 0;
const LOCK_DIR = "/usr/tmp"; // init's lock lives here (step 0, not this step): left out of snapshots

/** Fake host whose "downloaded" binary is ~/panel-termux inside the sandbox (K24). */
function host(scenario: FakeScenarioName, opts: FakeHostOptions = {}, arrange?: (root: string) => void) {
  const root = join(tmp, String(n++));
  mkdirSync(join(root, LOCK_DIR), { recursive: true });
  arrange?.(root);
  const selfPath = join(root, "panel-termux");
  writeFileSync(selfPath, SELF, { mode: 0o755 });
  const h = createFakeHost(scenario, { root, tty: false, answers: [], selfPath, ...opts });
  return { h, root, p: probePaths(h.paths), link: join(h.paths.prefix, "bin", "panel") };
}

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      if (f.endsWith(LOCK_DIR)) continue;
      const s = lstatSync(f);
      out.push(`${f} ${s.size} ${s.mode} ${s.mtimeMs} ${s.ino}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

async function init(h: ReturnType<typeof host>["h"], flags: Record<string, boolean> = {}) {
  const text: string[] = [];
  const out = createCliOut({ stdout: (t) => text.push(t), stderr: (t) => text.push(t) });
  const values = { yes: true, "dry-run": false, "skip-verify": false, ...flags };
  let code: number;
  try {
    code = await runInit({ values, positionals: [] }, { out, host: async () => h }, { steps: [binaryStep] });
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    code = err.code;
  }
  return { code, text: text.join("") };
}
const fetches = (h: ReturnType<typeof host>["h"]) => h.records.filter((r) => r.kind === "fetch");

describe("binary step: fresh phone", () => {
  test("installs via checked panel.new, makes the panel command and data dir, removes the download", async () => {
    setTag("v0.5.1");
    const { h, root, p, link } = host("fresh", { fetch: sums() });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(readFileSync(p.binary, "utf8")).toBe(SELF);
    expect(statSync(p.binary).mode & 0o777).toBe(0o755);
    expect(existsSync(join(h.paths.panelDir, "panel.new"))).toBe(false);
    expect(existsSync(p.prev)).toBe(false); // nothing to keep on a fresh phone
    expect(readlinkSync(link)).toBe(p.binary);
    expect(statSync(p.dataDir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(root, "panel-termux"))).toBe(false); // K24: download outside ~/panel removed
    expect(r.text).toContain(
      "Binary cocok dengan SHA256SUMS rilis v0.5.1 (membuktikan unduhan utuh, bukan asal rilis)",
    );
    expect(fetches(h).map((f) => f.argv[0])).toEqual([
      "https://github.com/makurosolusi/panel-termux/releases/download/v0.5.1/SHA256SUMS",
    ]);
  });

  test("mismatch → exit 1, panel.new and the new ~/panel removed, nothing else written", async () => {
    setTag("v0.5.1");
    const { h, root } = host("fresh", { fetch: sums("b".repeat(64)) });
    const before = snapshot(root);
    const r = await init(h);
    expect(r.code).toBe(1);
    expect(r.text).toContain("tidak cocok dengan SHA256SUMS rilis v0.5.1");
    expect(snapshot(root)).toEqual(before);
  });

  test("offline → exit 1 naming --skip-verify; --skip-verify on a TTY: warning + [y/N]", async () => {
    setTag("v0.5.1");
    const off = host("fresh");
    const r = await init(off.h);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Cek diri butuh internet");
    expect(existsSync(off.h.paths.panelDir)).toBe(false);

    const no = host("fresh", { tty: true, answers: [false] });
    const before = snapshot(no.root);
    expect((await init(no.h, { "skip-verify": true })).code).toBe(4);
    expect(snapshot(no.root)).toEqual(before);

    const yes = host("fresh", { tty: true, answers: [true] });
    const ok = await init(yes.h, { "skip-verify": true });
    expect(ok.code).toBe(0);
    expect(ok.text).toContain("CEK DIRI DILEWATI");
    expect(fetches(yes.h)).toEqual([]);
    expect(readFileSync(yes.p.binary, "utf8")).toBe(SELF);
  });

  test("--skip-verify without a TTY → exit 2 before anything", async () => {
    const { h, root } = host("fresh");
    const before = snapshot(root);
    expect((await init(h, { "skip-verify": true })).code).toBe(2);
    expect(snapshot(root)).toEqual(before);
  });

  test("local build (no tag): info line, no fetch, installs", async () => {
    const { h, p } = host("fresh");
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("build lokal: tidak dicek terhadap rilis");
    expect(fetches(h)).toEqual([]);
    expect(existsSync(p.binary)).toBe(true);
  });

  test("--dry-run: previews the check on this file, writes nothing", async () => {
    setTag("v0.5.1");
    const { h, root } = host("fresh", { fetch: sums() });
    const before = snapshot(root);
    const r = await init(h, { "dry-run": true, yes: false });
    expect(r.code).toBe(0);
    expect(r.text).toContain("Binary cocok dengan SHA256SUMS");
    expect(r.text).toContain("Memasang panel ke ~/panel/panel (perintah: panel)");
    expect(r.text).toContain("Menghapus file unduhan ~/panel-termux");
    expect(snapshot(root)).toEqual(before);
  });

  test("too little space (2 × panel.db + 256 MB + binary) → exit 1 before any write", async () => {
    const { h, root } = host("fresh");
    h.freeBytes = () => 1024;
    const before = snapshot(root);
    const r = await init(h);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Ruang kosong");
    expect(snapshot(root)).toEqual(before);
  });
});

describe("binary step: upgrade (K21, C21)", () => {
  test("healthy and runit runs ~/panel/panel → old file becomes panel.prev by hard link (same inode)", async () => {
    const { h, p, link } = host("upgrade");
    const oldIno = statSync(p.binary).ino;
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain(`Mengganti ~/panel/panel dengan v${SELF_VERSION} (v0.4.0 disimpan sebagai panel.prev)`);
    expect(statSync(p.prev).ino).toBe(oldIno);
    expect(readFileSync(p.binary, "utf8")).toBe(SELF);
    expect(existsSync(`${p.prev}.new`)).toBe(false);
    expect(readlinkSync(link)).toBe(p.binary); // already ours: left as is
  });

  test("panel.prev exists and runit's pid is unknown → panel.prev not overwritten", async () => {
    const { h, p } = host("upgrade", {}, (root) => {
      const prev = probePaths(createFakeHost("upgrade", { root }).paths).prev;
      writeFileSync(prev, "known good prev\n"); // test-only
    });
    rmSync(join(h.paths.svdir, "panel", "supervise", "pid"));
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).not.toContain("panel.prev)");
    expect(readFileSync(p.prev, "utf8")).toBe("known good prev\n");
    expect(readFileSync(p.binary, "utf8")).toBe(SELF);
  });

  test("same bytes already installed (upgrade-partial): no binary write, no check, bun never deleted", async () => {
    setTag("v0.5.1");
    mkdirSync(join(tmp, "partial", LOCK_DIR), { recursive: true });
    const h = createFakeHost("upgrade-partial", { root: join(tmp, "partial"), tty: false, answers: [] });
    const before = snapshot(join(tmp, "partial"));
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Sudah lengkap: binary panel");
    expect(fetches(h)).toEqual([]);
    expect(snapshot(join(tmp, "partial"))).toEqual(before);
    expect(existsSync(process.execPath)).toBe(true);
  });
});

describe("binary step: symlink and ~/panel-src (E11)", () => {
  test("a $PREFIX/bin/panel that is not ours is left alone with a warning", async () => {
    const { h, link } = host("fresh", {}, (root) => {
      mkdirSync(join(root, "usr", "bin"), { recursive: true });
      writeFileSync(join(root, "usr", "bin", "panel"), "#!/bin/sh\necho other\n");
    });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("bukan milik panel; tidak diubah");
    expect(readFileSync(link, "utf8")).toBe("#!/bin/sh\necho other\n");
  });

  test("prunes only v[0-9]* older than the newest older one; other entries only mentioned", async () => {
    const { h, root } = host("upgrade", {}, (r) => {
      for (const d of ["v0.3.0", "v0.4.0", "v0.4.0-rc.1", `v${SELF_VERSION}`, "v99.0.0", "dist", "deploy"])
        mkdirSync(join(r, "panel-src", d), { recursive: true });
      writeFileSync(join(r, "panel-src", ".env.example"), "");
    });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(readdirSync(join(root, "panel-src")).sort()).toEqual(
      [".env.example", "deploy", "dist", "v0.4.0", `v${SELF_VERSION}`, "v99.0.0"].sort(),
    );
    expect(r.text).toContain("~/panel-src/dist tidak dipakai lagi; hapus bila tidak perlu");
    expect(r.text).toContain("Menghapus unduhan lama di ~/panel-src: v0.4.0-rc.1, v0.3.0");
  });
});

describe("binary step: what may be installed and deleted (K24)", () => {
  test("releaseBlocker: bun runtime never; no release tag only with PANEL_DEV_INSTALL=1", () => {
    expect(releaseBlocker("v0.5.1", false, false)).toContain("runtime bun");
    expect(releaseBlocker("", true, false)).toContain("runtime bun");
    expect(releaseBlocker("", false, true)).toContain("bukan build rilis");
    expect(releaseBlocker("", true, true)).toBeNull();
    expect(releaseBlocker("v0.5.1", false, true)).toBeNull();
  });

  test("a file not named like our download, or one in $PREFIX/bin, is installed but never deleted", async () => {
    for (const where of ["home", "prefix"] as const) {
      const { h, p } = host("fresh");
      // test-only: Termux keeps $PREFIX beside $HOME; here it moves under the sandbox home so only the bin rule decides
      if (where === "prefix") h.paths.prefix = join(h.paths.home, "pfx");
      const self = where === "home" ? join(h.paths.home, "my-tool") : join(h.paths.prefix, "bin", "panel-termux");
      mkdirSync(join(self, ".."), { recursive: true });
      writeFileSync(self, SELF, { mode: 0o755 });
      h.selfPath = self;
      const r = await init(h);
      expect(r.code).toBe(0);
      expect(readFileSync(p.binary, "utf8")).toBe(SELF);
      expect(existsSync(self)).toBe(true);
      expect(r.text).not.toContain("Menghapus file unduhan");
    }
  });
});
