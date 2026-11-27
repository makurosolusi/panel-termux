import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
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
import type { FakeScenarioName } from "@/cli/cli.host";
import { createFakeHost, type FakeHost, type FakeHostOptions } from "@/cli/cli.host.fake";
import { CliExit, createCliOut } from "@/cli/cli.output";
import { appendKeys, createSshStep, parseKey, parseKeys, type SshState, sshPaths, sshStep } from "@/cli/init.ssh";
import type { InitArgs, InitContext, InitMode } from "@/cli/init.types";

// test-only public keys (private halves deleted); fingerprints as printed by `ssh-keygen -lf`
const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDMfS9QnMcdg1nA15nt310e+V8EyzIk/DQZUb24T2GXo a@mac";
const ED_FP = "SHA256:SUtt8ELqeS6JF9NPp+htE5umJdW12s424rKJ2mgi94c";
const RSA =
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDBY6MH/10c/YKMldCGnnHDGLVMBi5KdtjtXzXc6HPANQrpEGcDo5J2PT11w8S1ZwBcbKGRVSsdQAqMwxtAsr2hwz5HoelTwTDN03zyz19wDutBzDZCD3zSILcZzWI+fLiRZ4yMfOM6O6xJM9nJUll1Lv2oUM9ugNdmucKfDDsnynJ0Q8S/WxQyfEt5L0PV1Yqz+D0AbYtFoRZOjnQhMGCcF57asIU3TOmkTRvbPj/nLCJI3OztzF1GNq3FByNjzWv3RH61wr75me3mZzdJpfMKC/EOBf5wFoj0KW8WrZf9N4M2LYaVJZ35Oif5RGn5EAe5IlV9OD/kOkzH5YDMI3n/ b@mac";
const RSA_FP = "SHA256:OMypD44Y2jt2VdqnkVl3+G5cCvoIWBVTPba3RJBfFM8";
const KEYS_URL = "https://github.com/contoh.keys";
const TERMUX_SSHD_CONFIG = "Include /x/usr/etc/ssh/sshd_config.d/*.conf\nPrintMotd yes\nSubsystem sftp sftp-server\n";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-ssh-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** A fake phone with openssh installed (sshd service down, Termux-like sshd_config, host key) unless `bare`. */
function phone(scenario: FakeScenarioName = "fresh", opts: FakeHostOptions & { bare?: boolean } = {}): FakeHost {
  const root = join(tmp, String(n++));
  mkdirSync(root, { recursive: true });
  // runit is set up by step 3 before this one: `sv` answers (rc 0, not running) unless the test says otherwise
  const sv = (tool: string) => (tool === "sv" ? { code: 0, stdout: "", stderr: "" } : undefined);
  const execAnswers = (tool: string, args: readonly string[]) => opts.execAnswers?.(tool, args) ?? sv(tool);
  const h = createFakeHost(scenario, { root, tty: false, answers: [], ...opts, execAnswers });
  if (!opts.bare) {
    const etc = join(h.paths.prefix, "etc", "ssh");
    mkdirSync(join(h.paths.svdir, "sshd"), { recursive: true });
    writeFileSync(join(h.paths.svdir, "sshd", "run"), "#!/bin/sh\nexec sshd -D\n");
    writeFileSync(join(h.paths.svdir, "sshd", "down"), "");
    mkdirSync(etc, { recursive: true });
    writeFileSync(join(etc, "sshd_config"), TERMUX_SSHD_CONFIG);
    writeFileSync(join(etc, "ssh_host_ed25519_key.pub"), `${ED}\n`);
    writeFileSync(join(h.paths.prefix, "bin", "sv"), "#!/bin/sh\n");
  }
  return h;
}

function ctxOf(host: FakeHost, sshKey: string | null, mode: InitMode = "fresh", tty = false) {
  const lines: string[] = [];
  const args: InitArgs = {
    yes: true,
    dryRun: false,
    skipVerify: false,
    sshKey,
    hostname: null,
    adminEmails: [],
    skip: new Set(),
  };
  const ctx = {
    host,
    args,
    mode,
    decision: {} as InitContext["decision"],
    out: createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) }),
    tty,
    prompt: host.tty,
    state: { changed: [] as string[], manual: [] as string[] },
    confirmRisky: async () => false,
    guardSigint: (fn) => fn(),
    resumeCommand: () => "panel init",
  } satisfies InitContext;
  return { ctx, text: () => lines.join("") };
}

/** Every path under `dir` with size, mode and mtime: any write shows up. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = statSync(f);
      out.push(`${f} ${s.size} ${s.mode} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

const keyFile = (text: string) => {
  const f = join(tmp, `key-${n++}.pub`);
  writeFileSync(f, text);
  return f;
};
const run = async (ctx: InitContext) => {
  const s = (await sshStep.detect(ctx)) as SshState;
  const lines = sshStep.plan(ctx, s);
  await sshStep.apply(ctx, s);
  return lines;
};
const failsWith = async (p: Promise<unknown>, code: number, msg: RegExp) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(CliExit);
  expect((e as CliExit).code).toBe(code);
  expect((e as CliExit).message).toMatch(msg);
};

describe("key parsing (K22)", () => {
  test("fingerprints equal ssh-keygen -l", () => {
    expect(parseKey(ED)?.fingerprint).toBe(ED_FP);
    expect(parseKey(RSA)?.fingerprint).toBe(RSA_FP);
  });
  test("options prefix, wrong blob type, private key and garbage are refused", () => {
    expect(parseKey(`command="ls" ${ED}`)).toBeNull();
    expect(parseKey(ED.replace("ssh-ed25519", "ssh-rsa"))).toBeNull(); // blob names ed25519
    expect(parseKey("ssh-ed25519 not*base64")).toBeNull();
    expect(() => parseKeys(`no-pty ${ED}`, "f")).toThrow(/baris 1 bukan kunci publik/);
    expect(() => parseKeys("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n", "f")).toThrow(/PRIVAT/);
    expect(() => parseKeys("# only a comment\n\n", "f")).toThrow(/tidak berisi kunci/);
  });
  test("duplicates inside the source are kept once; comments and CRLF skipped", () => {
    expect(parseKeys(`# mac\r\n${ED}\r\n${ED} other\r\n${RSA}\r\n`, "f").map((k) => k.fingerprint)).toEqual([
      ED_FP,
      RSA_FP,
    ]);
  });
  test("appendKeys adds the missing final newline before the new line", () => {
    const k = parseKeys(RSA, "f");
    expect(appendKeys("ssh-ed25519 AAAA old", k)).toBe(`ssh-ed25519 AAAA old\n${RSA}\n`);
    expect(appendKeys("", k)).toBe(`${RSA}\n`);
    expect(appendKeys("x\n", k)).toBe(`x\n${RSA}\n`);
  });
});

describe("ssh step (K22, C26)", () => {
  test("https URL: fetched once over two detects, keys written 700/600, drop-in, down removed, sv up", async () => {
    const h = phone("fresh", { fetch: async () => new Response(`${ED}\n${RSA}\n`) });
    const { ctx, text } = ctxOf(h, KEYS_URL);
    const before = snapshot(h.paths.home);
    const lines = sshStep.plan(ctx, await sshStep.detect(ctx));
    expect(snapshot(h.paths.home)).toEqual(before); // detect + plan write nothing
    expect(lines.filter((l) => l.kind === "action").map((l) => l.text)).toEqual([
      `Tambah 2 kunci SSH ke ~/.ssh/authorized_keys: ${ED_FP}, ${RSA_FP}`,
      "Matikan masuk SSH dengan kata sandi (hanya kunci)",
      "Nyalakan SSH (port 8022)",
    ]);
    await run(ctx);
    const p = sshPaths(ctx);
    expect(h.records.filter((r) => r.kind === "fetch").map((r) => r.argv)).toEqual([[KEYS_URL]]);
    expect(readFileSync(p.authorizedKeys, "utf8")).toBe(`${ED}\n${RSA}\n`);
    expect(statSync(p.sshDir).mode & 0o777).toBe(0o700);
    expect(statSync(p.authorizedKeys).mode & 0o777).toBe(0o600);
    expect(readFileSync(p.dropIn, "utf8")).toContain("PasswordAuthentication no");
    expect(existsSync(p.down)).toBe(false);
    expect(h.records.some((r) => r.argv.join(" ") === "sv up sshd")).toBe(true);
    expect(ctx.state.changed).toEqual([p.sshDir, p.authorizedKeys, p.dropIn, p.down]);
    expect(text()).toContain(`Sidik jari HP (host): ${ED_FP}`);
    expect(text()).toMatch(/ssh -p 8022 \S+@<IP HP: lihat Tailscale\/Wi-Fi>/);
    expect(text()).not.toContain("AAAAC3Nza"); // key bodies are never printed
  });

  test("http:// and other schemes are refused (exit 2) without fetching", async () => {
    const h = phone();
    for (const url of ["http://github.com/x.keys", "ftp://x/k"])
      await failsWith(sshStep.detect(ctxOf(h, url).ctx), 2, /https/);
    expect(h.records.filter((r) => r.kind === "fetch")).toEqual([]);
  });

  test("download failure and HTTP 404 → exit 1", async () => {
    await failsWith(sshStep.detect(ctxOf(phone(), KEYS_URL).ctx), 1, /Gagal mengunduh/);
    const h = phone("fresh", { fetch: async () => new Response("Not Found", { status: 404 }) });
    await failsWith(sshStep.detect(ctxOf(h, KEYS_URL).ctx), 1, /HTTP 404/);
  });

  test("a redirect to http:// is refused (exit 1), keys not used", async () => {
    const res = new Response(ED);
    Object.defineProperty(res, "url", { value: "http://evil.example/k" }); // test-only: final URL after redirects
    const h = phone("fresh", { fetch: async () => res });
    await failsWith(sshStep.detect(ctxOf(h, KEYS_URL).ctx), 1, /bukan https/);
  });

  test("local file; missing file → exit 1", async () => {
    const h = phone();
    const { ctx } = ctxOf(h, keyFile(`${RSA}\n`));
    await run(ctx);
    expect(readFileSync(sshPaths(ctx).authorizedKeys, "utf8")).toBe(`${RSA}\n`);
    await failsWith(sshStep.detect(ctxOf(h, join(tmp, "nope.pub")).ctx), 1, /Gagal membaca file kunci/);
  });

  test("`-` reads one pasted line once across detects; empty answer → exit 3", async () => {
    const h = phone("fresh", { answers: [ED] });
    const { ctx } = ctxOf(h, "-");
    await sshStep.detect(ctx);
    await run(ctx); // second detect: no second question (the queue is empty = EOF)
    expect(readFileSync(sshPaths(ctx).authorizedKeys, "utf8")).toBe(`${ED}\n`);
    await failsWith(sshStep.detect(ctxOf(phone("fresh", { answers: [""] }), "-").ctx), 3, /tidak ada kunci/);
  });

  test("existing authorized_keys: lines kept, final newline added, duplicates (also with options) skipped", async () => {
    const h = phone();
    const { ctx } = ctxOf(h, keyFile(`${ED}\n${RSA}\n`));
    const p = sshPaths(ctx);
    mkdirSync(p.sshDir, { recursive: true });
    writeFileSync(p.authorizedKeys, `no-pty ${ED.replace("a@mac", "lama")}`);
    const lines = await run(ctx);
    expect(lines[0]?.text).toBe(`Tambah 1 kunci SSH ke ~/.ssh/authorized_keys: ${RSA_FP}`);
    expect(readFileSync(p.authorizedKeys, "utf8")).toBe(`no-pty ${ED.replace("a@mac", "lama")}\n${RSA}\n`);
    expect(ctx.state.changed).not.toContain(p.sshDir); // folder existed
  });

  test("second run (repair): nothing planned, authorized_keys and running sshd untouched", async () => {
    const h = phone("ready", {
      execAnswers: (tool, args) =>
        tool === "sv" && args[0] === "status" ? { code: 0, stdout: "run: sshd: (pid 5) 9s\n", stderr: "" } : undefined,
    });
    const file = keyFile(`${ED}\n`);
    await run(ctxOf(h, file, "repair").ctx);
    const { ctx } = ctxOf(h, file, "repair");
    const before = snapshot(h.paths.home);
    const s = await sshStep.detect(ctx);
    expect(sshStep.plan(ctx, s).filter((l) => l.kind === "action")).toEqual([]);
    expect(snapshot(h.paths.home)).toEqual(before);
  });

  test("drop-in: an existing one is not overwritten; user-set PasswordAuthentication or no Include → none", async () => {
    const h = phone();
    const { ctx } = ctxOf(h, keyFile(ED));
    const p = sshPaths(ctx);
    mkdirSync(p.dropInDir, { recursive: true });
    writeFileSync(p.dropIn, "# mine\n");
    await run(ctx);
    expect(readFileSync(p.dropIn, "utf8")).toBe("# mine\n");

    for (const config of [`${TERMUX_SSHD_CONFIG}PasswordAuthentication yes\n`, "PrintMotd yes\n"]) {
      const h2 = phone();
      const c2 = ctxOf(h2, keyFile(ED)).ctx;
      writeFileSync(sshPaths(c2).sshdConfig, config);
      await run(c2);
      expect(existsSync(sshPaths(c2).dropIn)).toBe(false);
      expect(readFileSync(sshPaths(c2).sshdConfig, "utf8")).toBe(config); // never edited
    }
  });

  test("TTY: fingerprints shown, `n` → nothing written, manual line left", async () => {
    const h = phone("fresh", { tty: true, answers: [false] });
    const { ctx, text } = ctxOf(h, keyFile(ED), "fresh", true);
    const before = snapshot(h.paths.home);
    await run(ctx);
    expect(text()).toContain(ED_FP);
    expect(snapshot(h.paths.home)).toEqual(before);
    expect(ctx.state.changed).toEqual([]);
    expect(ctx.state.manual[0]).toContain("--ssh-key");
  });

  test("no sshd service after the package step → exit 1 after the keys are in", async () => {
    const h = phone("fresh", { bare: true });
    const { ctx } = ctxOf(h, keyFile(ED));
    const e = await run(ctx).catch((err: CliExit) => err);
    expect(e).toMatchObject({ code: 1, hint: "pasang: pkg install openssh" });
    expect(existsSync(sshPaths(ctx).authorizedKeys)).toBe(true);
  });

  test("sshd started by hand (not runit): warning, no sv up, down kept, manual line", async () => {
    const h = phone();
    h.proc.list = () => [{ pid: 777, uid: h.proc.uid, exe: "/x/usr/bin/sshd", cmdline: ["sshd"] }];
    const { ctx } = ctxOf(h, keyFile(ED));
    const lines = await run(ctx);
    expect(lines).toContainEqual(
      expect.objectContaining({ kind: "warning", text: expect.stringContaining("pid 777") }),
    );
    expect(lines.some((l) => l.text.startsWith("Nyalakan SSH"))).toBe(false);
    expect(h.records.some((r) => r.argv.join(" ") === "sv up sshd")).toBe(false);
    expect(existsSync(sshPaths(ctx).down)).toBe(true);
    expect(ctx.state.manual.join("\n")).toContain("kill 777, lalu sv up sshd");
  });

  test("sv up sshd is retried until runsv supervises the folder; still failing → exit 1", async () => {
    let fails = 1;
    const svUp = (tool: string, args: readonly string[]) =>
      tool === "sv" && args[0] === "up" && fails-- > 0 ? { code: 1, stdout: "", stderr: "fail: sshd: x" } : undefined;
    const step = createSshStep({ daemonMs: 0, svMs: 200, healthMs: 0, pollMs: 5 });
    const h = phone("fresh", { execAnswers: svUp });
    const { ctx } = ctxOf(h, keyFile(ED));
    await step.apply(ctx, (await step.detect(ctx)) as SshState);
    expect(h.records.filter((r) => r.argv.join(" ") === "sv up sshd")).toHaveLength(2);

    fails = 1_000;
    const c2 = ctxOf(phone("fresh", { execAnswers: svUp }), keyFile(ED)).ctx;
    await failsWith(
      step.detect(c2).then((s) => step.apply(c2, s as SshState)),
      1,
      /sv up sshd gagal/,
    );
  });

  test("upgrade mode: source not read, a warning to run again, apply does nothing", async () => {
    const h = phone("upgrade", { fetch: async () => new Response(ED) });
    const { ctx } = ctxOf(h, KEYS_URL, "upgrade");
    const lines = await run(ctx);
    expect(lines).toEqual([
      {
        kind: "warning",
        text: "SSH dilewati saat upgrade",
        hint: `jalankan lagi panel init --ssh-key ${KEYS_URL} setelah upgrade`,
      },
    ]);
    expect(h.records).toEqual([]);
  });
});
