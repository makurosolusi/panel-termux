import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, type FakeAnswer, type FakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { runInit } from "@/cli/init.command";
import { SELF_VERSION } from "@/cli/init.mode";
import { PANEL_RUN_TEMPLATE } from "@/cli/init.panel-sv";
import { DROP_IN_NAME } from "@/cli/init.ssh";

// Every real step against the fake host's simulated phone (PLAN/07 §16 G1a): a full fresh install, its rerun, the
// POCO upgrade and the two refusals. The fake's pkg/initdb/sv/cloudflared leave their results in the sandbox.
const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-e2e-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = () => {
  const d = join(tmp, String(n++));
  mkdirSync(d, { recursive: true });
  return d;
};

// test-only values; the secret is a sentinel searched for in every output
const SECRET = "TEST-ONLY-e2e-sentinel-0123456789";
const HOSTNAME = "panel.contoh.com";
const SELF_BYTES = "\x7fELF e2e self\n";
const ANSWERS: FakeAnswer[] = [true, HOSTNAME, "admin@contoh.com", "e2e-client.apps.googleusercontent.com", SECRET, ""];
const READ_ONLY =
  /^(dpkg -s|dpkg --audit|apt-mark showhold|apt-get -s|\/system\/bin\/cmd package list|postgres --version|sv status|cloudflared tunnel list)/;

/** An ed25519 public key line that parses (type + 32 byte blob). */
function pubKey(): string {
  const type = Buffer.from("ssh-ed25519");
  const len = (x: number) => Buffer.from([0, 0, 0, x]);
  return `ssh-ed25519 ${Buffer.concat([len(type.length), type, len(32), Buffer.alloc(32, 3)]).toString("base64")} e2e\n`;
}

function setup(scenario: FakeScenarioName, opts: { root?: string; tty?: boolean; answers?: FakeAnswer[] } = {}) {
  const self = join(dir(), "panel"); // outside the sandbox: never deleted as "the download"
  writeFileSync(self, SELF_BYTES, { mode: 0o755 });
  return createFakeHost(scenario, { root: opts.root ?? dir(), tty: false, answers: [], selfPath: self, ...opts });
}

async function init(h: FakeHost, values: Record<string, unknown>) {
  const sink: string[] = [];
  const out = createCliOut({ stdout: (t) => sink.push(t), stderr: (t) => sink.push(t) });
  const parsed = { values: { yes: true, "dry-run": false, "skip-verify": false, ...values }, positionals: [] };
  let code: number;
  try {
    code = await runInit(parsed as never, { out, host: async () => h });
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    code = err.code;
  }
  return { code, text: sink.join("") };
}

const argv = (h: FakeHost, kind: "run" | "exec") =>
  h.records.filter((r) => r.kind === kind).map((r) => r.argv.join(" "));
const changing = (h: FakeHost) => argv(h, "exec").filter((a) => !READ_ONLY.test(a));

/** Files (not folders) under `d` with size, mode and mtime. */
function files(d: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (x: string) => {
    for (const name of readdirSync(x)) {
      const f = join(x, name);
      const s = lstatSync(f);
      if (s.isDirectory()) walk(f);
      else out.set(f, `${s.size} ${s.mode} ${s.mtimeMs}`);
    }
  };
  walk(d);
  return out;
}
const diff = (a: Map<string, string>, b: Map<string, string>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f) !== b.get(f)).sort();

describe("panel init end to end on the fake phone", () => {
  test("fresh: every step runs, exit 0, the phone is set up, no secret in the output", async () => {
    const h = setup("fresh", { tty: true, answers: [...ANSWERS] });
    const key = join(dir(), "id.pub");
    writeFileSync(key, pubKey());
    const r = await init(h, { "ssh-key": key });
    expect(r.code).toBe(0);
    expect(r.text).toContain("panel init finished");
    expect(r.text).toContain("Panel service installed in runit");
    expect(existsSync(join(h.paths.prefix, "tmp", "panel-init.unfinished"))).toBe(false);
    expect(r.text).not.toContain(SECRET);
    expect(r.text).not.toContain("fake-tunnel-secret");
    const p = probePaths(h.paths);
    const sv = (...x: string[]) => join(h.paths.svdir, ...x);
    expect(readFileSync(p.binary, "utf8")).toBe(SELF_BYTES);
    expect(statSync(p.envFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(p.envFile, "utf8")).toContain(`APP_BASE_URL=https://${HOSTNAME}`);
    expect(statSync(p.dataDir).mode & 0o777).toBe(0o700);
    expect(readFileSync(sv("panel", "run"), "utf8")).toBe(PANEL_RUN_TEMPLATE);
    for (const s of ["panel", "pm2", "postgres", "cloudflared", "sshd"]) expect(existsSync(sv(s, "down"))).toBe(false);
    expect(readFileSync(sv("cloudflared", "run"), "utf8")).toContain("--no-autoupdate run");
    expect(existsSync(join(h.paths.home, "sites", "ecosystem.config.js"))).toBe(true);
    expect(existsSync(join(p.bootDir, "panel-termux"))).toBe(true);
    expect(existsSync(p.pgVersion)).toBe(true);
    expect(readFileSync(join(p.cloudflaredDir, "config.yml"), "utf8")).toContain(`hostname: ${HOSTNAME}`);
    expect(readFileSync(join(h.paths.home, ".ssh", "authorized_keys"), "utf8")).toBe(pubKey());
    expect(existsSync(join(h.paths.prefix, "etc", "ssh", "sshd_config.d", DROP_IN_NAME))).toBe(true);
    expect(argv(h, "run")).toContain(
      "pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold",
    );
    expect(changing(h)).toEqual([
      "sv up sshd",
      "sv up postgres",
      "sv up pm2",
      `cloudflared tunnel create panel-contoh-com`,
      "sv up cloudflared",
      "sv up panel",
    ]);
    expect(existsSync(join(h.paths.prefix, "tmp", "panel-init.lock"))).toBe(false);

    // the rerun finds everything in place (no state file: each step reads the phone again)
    const again = setup("fresh", { root: h.paths.home });
    const r2 = await init(again, {});
    expect(r2.code).toBe(0);
    expect(r2.text).toContain("Nothing needs to change.");
    expect([argv(again, "run"), changing(again)]).toEqual([[], []]);
  });

  test("poco upgrade --yes without TTY: only the binary side and the panel run script change, one restart", async () => {
    const h = setup("poco");
    h.system(); // the fake system seeds its sandbox on creation
    const before = files(h.paths.home);
    const r = await init(h, {});
    expect(r.code).toBe(0);
    const p = probePaths(h.paths);
    const run = join(h.paths.svdir, "panel", "run");
    expect(diff(before, files(h.paths.home))).toEqual(
      [p.binary, p.prev, join(h.paths.prefix, "bin", "panel"), run, `${run}.bak-0.5.0`].sort(),
    );
    expect(argv(h, "run")).toEqual([]);
    expect(changing(h)).toEqual(["sv -w 130 restart panel"]);
    expect(r.text).toContain(`Panel v${SELF_VERSION} is running and healthy`);
  });

  test("fresh-pg (PostgreSQL data, so not a new phone): packages go through apt-get -s, never pkg upgrade", async () => {
    const h = setup("fresh-pg", { tty: true, answers: [...ANSWERS.slice(1), true] });
    const r = await init(h, {});
    expect(r.code).toBe(0);
    expect(argv(h, "exec").some((a) => a.startsWith("apt-get -s install"))).toBe(true);
    expect(argv(h, "run").some((a) => a.startsWith("pkg upgrade"))).toBe(false);
    expect(argv(h, "run")).not.toContain(expect.stringContaining("initdb"));
  });

  test("downgrade: exit 3 with the rollback hint, nothing run", async () => {
    const h = setup("downgrade");
    const r = await init(h, {});
    expect(r.code).toBe(3);
    expect(r.text).toContain("panel rollback");
    expect([argv(h, "run"), changing(h)]).toEqual([[], []]);
  });
});
