// panel init step 8, tunnel (PLAN/07 §4.4, C19, D4, D10, K9): fake host per scenario, run through runInit so the
// real confirmRisky/plan rules apply.
import { afterAll, describe, expect, test } from "bun:test";
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
import { createFakeHost, type FakeAnswer, type FakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { runInit } from "@/cli/init.command";
import { defaultTunnelName, tunnelStep } from "@/cli/init.tunnel";
import type { ExecResult } from "@/server/exec/termux.exec";
import { FAKE_TUNNEL_ID } from "@/server/system/system.fake";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-tunnel-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const HOST = "panel.contoh.com"; // test-only: inside the fake cert zone
const NEW_ID = "11111111-2222-4333-8444-555555555555"; // test-only
const SELF_BYTES = "\x7fELF fake panel\n"; // test-only: = the fake's installed binary, so `ready` is repair mode
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

type Opts = {
  tty?: boolean;
  answers?: FakeAnswer[];
  /** Tunnels the fake Cloudflare account already has (name → id) and whether their credentials are here. */
  account?: Record<string, { id: string; cred: boolean }>;
  /** Files to put in the sandbox before the scenario fills it (path relative to HOME → content). */
  files?: Record<string, string>;
  /** dpkg says cloudflared is installed (fresh scenario only; ready has it). */
  cfInstalled?: boolean;
};

/** Fake host + a scripted cloudflared: login writes cert.pem, create writes <id>.json and lists the tunnel. */
function setup(scenario: FakeScenarioName, o: Opts = {}) {
  const root = join(tmp, String(n++));
  for (const [rel, content] of Object.entries(o.files ?? {})) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content, { mode: 0o755 });
  }
  const self = join(tmp, `self-${n}`);
  writeFileSync(self, SELF_BYTES);
  const account = { ...(o.account ?? {}) };
  const cfDir = join(root, ".cloudflared");
  for (const t of Object.values(account))
    if (t.cred) {
      mkdirSync(cfDir, { recursive: true });
      writeFileSync(join(cfDir, `${t.id}.json`), "{}"); // test-only
    }
  const execAnswers = (tool: string, args: readonly string[]): ExecResult | undefined => {
    if (tool === "cloudflared" && args[1] === "list") {
      const name = args[3] as string;
      const t = account[name];
      return ok(JSON.stringify(t ? [{ id: t.id, name, created_at: "2026-11-27T00:00:00Z" }] : []));
    }
    if (tool === "cloudflared" && args[1] === "create") {
      account[args[2] as string] = { id: NEW_ID, cred: true };
      writeFileSync(join(cfDir, `${NEW_ID}.json`), "{}"); // test-only
      return ok(`Created tunnel ${args[2]} with id ${NEW_ID}`);
    }
    if (tool === "dpkg" && args[1] === "cloudflared" && o.cfInstalled)
      return ok("Package: cloudflared\nStatus: install ok installed\n");
    if ((tool === "apt-mark" && args[0] === "hold") || tool === "sv" || tool === "termux-open-url") return ok();
    return undefined;
  };
  const h = createFakeHost(scenario, {
    root,
    tty: o.tty ?? false,
    answers: o.answers ?? [],
    selfPath: self,
    execAnswers,
  });
  const fake: FakeHost = {
    ...h,
    async run(tool, args = [], opts = {}) {
      const code = await h.run(tool, args, opts);
      if (tool === "cloudflared" && args[1] === "login") {
        opts.onLine?.("https://dash.cloudflare.com/argotunnel?callback=test-only");
        mkdirSync(cfDir, { recursive: true });
        writeFileSync(join(cfDir, "cert.pem"), "test-only");
      }
      return code;
    },
  };
  const overwrites: string[] = [];
  const cf = fake.system().cloudflared;
  const route = cf.routeDns.bind(cf);
  cf.routeDns = async (t, hostname, opts) => {
    if (opts?.overwrite) overwrites.push(`${t} ${hostname}`);
    return route(t, hostname, opts);
  };
  return { h: fake, root, cfDir, overwrites, svdir: fake.paths.svdir };
}

async function init(h: FakeHost, flags: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const out = createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) });
  let code: number;
  try {
    code = await runInit(
      { values: { yes: false, "dry-run": false, "skip-verify": false, ...flags } as never, positionals: [] },
      { out, host: async () => h },
      { steps: [tunnelStep] },
    );
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    code = err.code;
  }
  return { code, text: lines.join("") };
}

/** Every path under `dir` with size, mode and mtime. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = lstatSync(f);
      out.push(`${f} ${s.size} ${s.mode} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

const ENV_FILE = { "panel/.env": `APP_BASE_URL=https://${HOST}\n` };
const argvs = (h: FakeHost) => h.records.filter((r) => r.kind !== "fetch").map((r) => r.argv.join(" "));

describe("tunnel name (Q7)", () => {
  test("panel- + domain without the first label", () => {
    expect(defaultTunnelName("panel.contoh.com")).toBe("panel-contoh-com");
    expect(defaultTunnelName("a.b.contoh.co.id")).toBe("panel-b-contoh-co-id");
  });
});

describe("fresh phone", () => {
  test("TTY: login, create without -o, config 600, DNS, ingress, our run script; no token anywhere", async () => {
    const { h, cfDir, svdir } = setup("fresh", { tty: true, answers: [true, ""], files: ENV_FILE });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Bila browser tidak terbuka sendiri, buka: https://dash.cloudflare.com/");
    const all = argvs(h);
    expect(all).toContain("cloudflared tunnel login");
    expect(all).toContain("cloudflared tunnel create panel-contoh-com");
    expect(all.filter((a) => a.includes("tunnel create")).every((a) => !a.includes("-o"))).toBe(true); // D4
    expect(all.some((a) => /token/i.test(a))).toBe(false);
    const config = join(cfDir, "config.yml");
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(readFileSync(config, "utf8")).toBe(
      `tunnel: ${NEW_ID}\ncredentials-file: ${cfDir}/${NEW_ID}.json\ningress:\n  - hostname: ${HOST}\n    service: http://localhost:3200\n  - service: http_status:404\n`,
    );
    const run = readFileSync(join(svdir, "cloudflared", "run"), "utf8");
    expect(run).toContain(`export HOME=${h.paths.home}\n`);
    expect(run).toContain(`exec cloudflared tunnel --no-autoupdate run ${NEW_ID} 2>&1\n`);
    expect(statSync(join(svdir, "cloudflared", "run")).mode & 0o777).toBe(0o700);
    expect(readlinkSync(join(svdir, "cloudflared", "log", "run"))).toEndWith("share/termux-services/svlogger");
    expect(existsSync(join(svdir, "cloudflared", "down"))).toBe(false);
    expect(existsSync(join(cfDir, "token"))).toBe(false);
    expect(r.text).toContain(config);
  });

  test("no TTY (--yes): exit 3 before login, nothing written", async () => {
    const { h, root } = setup("fresh", { files: ENV_FILE });
    const before = snapshot(root);
    const r = await init(h, { yes: true });
    expect(r.code).toBe(3);
    expect(r.text).toContain("⚠️ Login Cloudflare butuh browser dan terminal; tunnel dilewati"); // in the plan
    expect(r.text).toContain("❌ Login Cloudflare butuh browser dan terminal.");
    expect(argvs(h)).not.toContain("cloudflared tunnel login");
    const lockless = (snap: string[]) => snap.filter((f) => !f.startsWith(`${root}/usr `) && !f.includes("/usr/tmp"));
    expect(lockless(snapshot(root))).toEqual(lockless(before)); // the init lock lives in $PREFIX/tmp
  });

  test("tunnel exists with credentials here → reused, no tunnel create (C19)", async () => {
    const { h, cfDir } = setup("fresh", {
      tty: true,
      answers: [true, ""],
      files: { ...ENV_FILE, ".cloudflared/cert.pem": "test-only" },
      account: { "panel-contoh-com": { id: NEW_ID, cred: true } },
    });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("dipakai ulang");
    expect(argvs(h).some((a) => a.includes("tunnel create"))).toBe(false);
    expect(argvs(h)).not.toContain("cloudflared tunnel login");
    expect(readFileSync(join(cfDir, "config.yml"), "utf8")).toContain(`tunnel: ${NEW_ID}`);
  });

  test("tunnel exists without credentials: TTY asks another name; no TTY → exit 3 with both choices", async () => {
    const taken = { "panel-contoh-com": { id: FAKE_TUNNEL_ID, cred: false } };
    const files = { ...ENV_FILE, ".cloudflared/cert.pem": "test-only" };
    const a = setup("fresh", { tty: true, answers: [true, "", "panel-baru"], files, account: taken });
    expect((await init(a.h)).code).toBe(0);
    expect(argvs(a.h)).toContain("cloudflared tunnel create panel-baru");
    const b = setup("fresh", { files, account: taken, cfInstalled: true }); // cert.pem = user data: repair mode
    const r = await init(b.h, { yes: true });
    expect(r.code).toBe(3);
    expect(r.text).toContain("cloudflared tunnel delete panel-contoh-com");
    expect(existsSync(join(b.cfDir, "config.yml"))).toBe(false);
  });

  test("package left down + template run: replaced on a fresh phone, down removed, held, sv up", async () => {
    const { h, svdir } = setup("fresh", {
      tty: true,
      answers: [true, ""],
      cfInstalled: true,
      files: {
        ...ENV_FILE,
        "usr/var/service/cloudflared/run":
          "#!/bin/sh\nexec cloudflared tunnel run --token-file $HOME/.cloudflared/token 2>&1\n",
        "usr/var/service/cloudflared/down": "",
      },
    });
    expect((await init(h)).code).toBe(0);
    expect(readFileSync(join(svdir, "cloudflared", "run"), "utf8")).toContain("--no-autoupdate run");
    expect(existsSync(join(svdir, "cloudflared", "down"))).toBe(false);
    expect(argvs(h)).toContain("apt-mark hold cloudflared");
    expect(argvs(h)).toContain("sv up cloudflared");
  });
});

describe("DNS record of another tunnel (C19, E1)", () => {
  const files = { ...ENV_FILE, ".cloudflared/cert.pem": "test-only" };
  const account = { "panel-contoh-com": { id: NEW_ID, cred: true } };
  const taken = async (h: FakeHost) => {
    await h.system().cloudflared.routeDns("poco", HOST); // the old phone's tunnel owns the name
  };

  test("TTY yes → old → new mapping printed, one overwrite call", async () => {
    const s = setup("fresh", { tty: true, answers: [true, "", true], files, account });
    await taken(s.h);
    const r = await init(s.h);
    expect(r.code).toBe(0);
    expect(r.text).toContain(
      `${HOST}: record DNS lain (tujuan tidak terbaca dengan cert.pem) → tunnel panel-contoh-com (11111111)`,
    );
    expect(s.overwrites).toEqual([`${NEW_ID} ${HOST}`]);
  });

  test("TTY no → exit 4, no overwrite, config.yml not written (a rerun reuses the tunnel and asks again)", async () => {
    const s = setup("fresh", { tty: true, answers: [true, "", false], files, account });
    await taken(s.h);
    const r = await init(s.h);
    expect(r.code).toBe(4);
    expect(s.overwrites).toEqual([]);
    expect(existsSync(join(s.cfDir, "config.yml"))).toBe(false);
  });

  test("no TTY, even --yes → exit 3 with the exact command, no overwrite, config.yml not written", async () => {
    const s = setup("fresh", { files, account, cfInstalled: true });
    mkdirSync(s.cfDir, { recursive: true });
    await taken(s.h);
    const r = await init(s.h, { yes: true });
    expect(r.code).toBe(3);
    expect(r.text).toContain(`cloudflared tunnel route dns --overwrite-dns panel-contoh-com ${HOST}`);
    expect(s.overwrites).toEqual([]);
    expect(existsSync(join(s.cfDir, "config.yml"))).toBe(false); // DNS is asked before config.yml is written
  });
});

describe("existing install (repair)", () => {
  test("ready phone: nothing planned, detect/plan write nothing (--dry-run)", async () => {
    const { h, root } = setup("ready");
    const before = snapshot(root);
    const r = await init(h, { "dry-run": true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("Sudah lengkap: tunnel Cloudflare.");
    expect(snapshot(root)).toEqual(before);
    expect(argvs(h).filter((a) => a.startsWith("cloudflared") || a.startsWith("sv "))).toEqual([]);
  });

  const noPanelRule = (cfDir: string) => {
    const f = join(cfDir, "config.yml");
    const text = readFileSync(f, "utf8").replace(`  - hostname: ${HOST}\n    service: http://localhost:3200\n`, "");
    writeFileSync(f, text);
    return text;
  };

  test("panel running + host missing from ingress → warning only, config.yml untouched (D10)", async () => {
    const s = setup("ready", { tty: true, answers: [true] });
    const before = noPanelRule(s.cfDir);
    const r = await init(s.h);
    expect(r.text).toContain("panel sedang berjalan, jadi file itu tidak diubah");
    expect(readFileSync(join(s.cfDir, "config.yml"), "utf8")).toBe(before);
    expect(argvs(s.h).some((a) => a.startsWith("cloudflared tunnel route"))).toBe(false);
  });

  test("panel down: rule added above the catch-all, other rules byte-identical, restart asked (TTY yes)", async () => {
    const s = setup("ready", { tty: true, answers: [true, true] });
    const before = noPanelRule(s.cfDir);
    await s.h.system().runit.control("panel", "stop");
    const r = await init(s.h);
    expect(r.code).toBe(0);
    const after = readFileSync(join(s.cfDir, "config.yml"), "utf8");
    expect(after).toBe(
      before.replace(
        "  - service: http_status:404",
        `  - hostname: ${HOST}\n    service: http://localhost:3200\n  - service: http_status:404`,
      ),
    );
    expect(readFileSync(join(s.cfDir, "config.yml.bak"), "utf8")).toBe(before);
    expect(argvs(s.h)).toContain("sv restart cloudflared");
    expect(s.overwrites).toEqual([]);
  });

  test("panel down, no TTY (--yes): restart of a running cloudflared → exit 3 before DNS/config.yml (K9)", async () => {
    const s = setup("ready");
    noPanelRule(s.cfDir);
    await s.h.system().runit.control("panel", "stop");
    const before = readFileSync(join(s.cfDir, "config.yml"), "utf8");
    const r = await init(s.h, { yes: true });
    expect(r.code).toBe(3);
    expect(r.text).toContain("cloudflared yang berjalan perlu dimulai ulang (semua situs putus sebentar)"); // plan
    expect(r.text).toContain("❌ cloudflared yang berjalan perlu dimulai ulang; tunnel tidak diubah tanpa terminal.");
    expect(argvs(s.h)).not.toContain("sv restart cloudflared");
    // stopped before DNS and config.yml (MINOR 6): nothing half done that a terminal run would have asked about
    expect(argvs(s.h).some((a) => a.startsWith("cloudflared tunnel route"))).toBe(false);
    expect(readFileSync(join(s.cfDir, "config.yml"), "utf8")).toBe(before);
  });

  test("repair without TTY and without cloudflared (step 2 skipped): warning only, no cloudflared call (M2)", async () => {
    const files = { ...ENV_FILE, ".cloudflared/cert.pem": "test-only" }; // user data → repair
    const { h, root } = setup("fresh", { files });
    const before = snapshot(root);
    const r = await init(h, { yes: true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("⚠️ cloudflared belum terpasang; tunnel belum disiapkan");
    expect(r.text).not.toContain("Sudah lengkap: tunnel");
    expect(argvs(h).filter((a) => a.startsWith("cloudflared") || a.startsWith("sv "))).toEqual([]);
    const lockless = (snap: string[]) => snap.filter((f) => !f.startsWith(`${root}/usr `) && !f.includes("/usr/tmp"));
    expect(lockless(snapshot(root))).toEqual(lockless(before));
    // with a terminal step 2 runs first (it installs cloudflared), so the tunnel is planned
    const t = setup("fresh", { files, tty: true });
    expect((await init(t.h, { "dry-run": true })).text).toContain("Membuat tunnel, menghubungkan panel.contoh.com");
  });

  test("custom run script is kept (K6); template in repair without TTY → warning, not replaced", async () => {
    const custom = setup("ready");
    const runFile = join(custom.svdir, "cloudflared", "run");
    const kept = readFileSync(runFile, "utf8");
    expect((await init(custom.h, { yes: true })).code).toBe(0);
    expect(readFileSync(runFile, "utf8")).toBe(kept);
    const template = "#!/bin/sh\nexec cloudflared tunnel run --token-file $HOME/.cloudflared/token 2>&1\n";
    const t = setup("ready", { files: { "usr/var/service/cloudflared/run": template } });
    const r = await init(t.h, { yes: true });
    expect(r.text).toContain("Run script cloudflared masih template paket");
    expect(readFileSync(join(t.svdir, "cloudflared", "run"), "utf8")).toBe(template);
    expect(existsSync(join(probePaths(t.h.paths).cloudflaredDir, "token"))).toBe(false);
  });
});
