import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probePaths } from "@/cli/cli.host";
import { createFakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { type EnvStepState, envStep, normalizeEmails, normalizeHostname, setEnvLine } from "@/cli/init.env";
import type { InitArgs, InitContext, InitSkippable } from "@/cli/init.types";
import { EnvError, parseEnv } from "@/server/env";
import { ENV_VARS, renderEnvTemplate } from "@/shared/env.schema";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-env-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

// test-only values; the secret is a sentinel searched for in every output and file
const SECRET = "TEST-ONLY-sentinel-0123456789abcdefXYZ";
const CLIENT_ID = "1234-abcd.apps.googleusercontent.com";
// `.env.example` of 0.4.0 (debate D7): placeholders count as empty
const ENV_EXAMPLE_040 = [
  "APP_BASE_URL=https://panel.example.com",
  "GOOGLE_CLIENT_ID=",
  "GOOGLE_CLIENT_SECRET=",
  "SUPER_ADMIN_EMAILS=you@example.com",
  "",
].join("\n");

type Opts = { tty?: boolean; answers?: (string | null)[]; args?: Partial<InitArgs>; skip?: InitSkippable[] };

/** Fresh fake phone + context whose prompt records every question in `events` next to the printed lines. */
function setup({ tty = true, answers = [], args = {}, skip = [] }: Opts = {}) {
  const root = join(tmp, String(n++));
  mkdirSync(root, { recursive: true });
  const host = createFakeHost("fresh", { root, tty, answers: [] });
  const events: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const queue = [...answers];
  const answer = (kind: string) => async (q: string) => {
    events.push(`${kind} ${q}`);
    return queue.length > 0 ? (queue.shift() ?? null) : null;
  };
  const ctx = {
    host,
    args: {
      yes: false,
      dryRun: false,
      skipVerify: false,
      sshKey: null,
      hostname: null,
      adminEmails: [],
      ...args,
      skip: new Set(skip),
    },
    mode: "fresh",
    decision: {} as InitContext["decision"],
    out: createCliOut({
      stdout: (t) => {
        stdout.push(t);
        events.push(`out ${t.trimEnd()}`);
      },
      stderr: (t) => stderr.push(t),
    }),
    tty,
    prompt: { isTty: tty, confirm: async () => true, ask: answer("ask"), secret: answer("secret") },
    state: { changed: [] as string[], manual: [] as string[] },
    confirmRisky: async () => true,
    guardSigint: (fn) => fn(),
    resumeCommand: () => "panel init",
  } satisfies InitContext;
  const file = probePaths(host.paths).envFile;
  mkdirSync(join(root, "panel"), { recursive: true });
  return { root, ctx, file, events, out: () => stdout.join("") + stderr.join("") };
}

/** detect → plan → apply like init.command; returns the exit code a CliExit carried (0 = done). */
async function run(ctx: InitContext): Promise<number> {
  try {
    await envStep.apply(ctx, await envStep.detect(ctx));
    return 0;
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (typeof code !== "number") throw e;
    ctx.out.fail((e as Error).message, (e as { hint?: string }).hint);
    return code;
  }
}

/** Every file under `dir` with its content: any write (and any leaked value) shows up. */
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true }))
    if (e.isFile()) out[join(e.parentPath, e.name)] = readFileSync(join(e.parentPath, e.name), "utf8");
  return out;
}

const parsed = (file: string) => {
  const values: Record<string, string> = {};
  for (const l of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) values[m[1] as string] = (m[2] as string).replace(/^'(.*)'$/, "$1");
  }
  return values;
};
const mode = (file: string) => statSync(file).mode & 0o777;

describe("init step env: fresh phone with a terminal", () => {
  test("creates .env from the template, asks the four values, prints the redirect URI before Client ID", async () => {
    const { ctx, file, events, out, root } = setup({
      answers: ["Panel.Contoh.com", "Kamu@Contoh.com, dua@contoh.com", CLIENT_ID, SECRET],
    });
    expect(await run(ctx)).toBe(0);
    expect(mode(file)).toBe(0o600);
    const v = parsed(file);
    expect(v.APP_BASE_URL).toBe("https://panel.contoh.com");
    expect(v.SUPER_ADMIN_EMAILS).toBe("kamu@contoh.com,dua@contoh.com");
    expect(v.GOOGLE_CLIENT_ID).toBe(CLIENT_ID);
    expect(v.GOOGLE_CLIENT_SECRET).toBe(SECRET);
    expect(() => parseEnv(v)).not.toThrow();
    // template comments and the optional block are kept
    expect(readFileSync(file, "utf8")).toContain("# --- Opsional");
    const redirect = events.indexOf("out   https://panel.contoh.com/api/auth/callback/google");
    expect(redirect).toBeGreaterThan(-1);
    expect(redirect).toBeLessThan(events.indexOf("ask Client ID:"));
    expect(events.filter((e) => !e.startsWith("out"))).toEqual([
      "ask Alamat panel (mis. panel.contoh.com):",
      "ask Email Google pemilik panel (super admin):",
      "ask Client ID:",
      "secret Client secret:",
    ]);
    expect(out()).toContain(`(tersimpan, ${SECRET.length} karakter)`);
    expect(ctx.state.changed).toEqual([file]);
    // the secret is only in .env: never printed, never in another file
    expect(out()).not.toContain(SECRET);
    const leaked = Object.entries(files(root)).filter(([f, c]) => f !== file && c.includes(SECRET));
    expect(leaked).toEqual([]);
  });

  test("invalid answers are asked again", async () => {
    const { ctx, file, events, out } = setup({
      answers: ["bukan alamat", "panel.contoh.com", "salah", "a@b.co", "  ", CLIENT_ID, "", SECRET],
    });
    expect(await run(ctx)).toBe(0);
    expect(events.filter((e) => e.startsWith("ask Alamat"))).toHaveLength(2);
    expect(events.filter((e) => e.startsWith("secret"))).toHaveLength(2);
    expect(parsed(file).SUPER_ADMIN_EMAILS).toBe("a@b.co");
    expect(out()).toContain("bukan alamat yang valid");
  });

  test("EOF stops asking: exit 3 naming the variables left, answers so far are saved", async () => {
    const { ctx, file, events, out } = setup({ answers: ["panel.contoh.com", null] });
    expect(await run(ctx)).toBe(3);
    expect(events.filter((e) => !e.startsWith("out"))).toHaveLength(2);
    expect(parsed(file).APP_BASE_URL).toBe("https://panel.contoh.com");
    expect(out()).toContain("belum lengkap: SUPER_ADMIN_EMAILS, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  });
});

describe("init step env: existing .env", () => {
  test(".env.example 0.4.0 placeholders count as empty: all four are asked (D7)", async () => {
    const { ctx, file } = setup({ answers: ["panel.contoh.com", "a@b.co", CLIENT_ID, SECRET] });
    writeFileSync(file, ENV_EXAMPLE_040, { mode: 0o600 });
    const state = (await envStep.detect(ctx)) as EnvStepState;
    expect(state.missing).toEqual(["APP_BASE_URL", "SUPER_ADMIN_EMAILS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(await run(ctx)).toBe(0);
    expect(parsed(file).APP_BASE_URL).toBe("https://panel.contoh.com");
    expect(readFileSync(file, "utf8")).not.toContain("example.com");
  });

  test("existing values and other lines stay untouched; only the missing one is asked", async () => {
    const { ctx, file, events } = setup({ answers: [SECRET] });
    const before = [
      "# komentar saya",
      "APP_BASE_URL=https://lama.contoh.com",
      "GOOGLE_CLIENT_ID=old-id",
      "GOOGLE_CLIENT_SECRET=",
      "SUPER_ADMIN_EMAILS=x@y.co",
      "PORT=3300",
      "",
    ].join("\n");
    writeFileSync(file, before, { mode: 0o600 });
    expect(await run(ctx)).toBe(0);
    expect(events.filter((e) => !e.startsWith("out"))).toEqual(["secret Client secret:"]);
    expect(events).toContain("out   https://lama.contoh.com/api/auth/callback/google");
    expect(readFileSync(file, "utf8")).toBe(before.replace("GOOGLE_CLIENT_SECRET=", `GOOGLE_CLIENT_SECRET=${SECRET}`));
  });

  test("complete .env: no action, no question, no write; a too-open mode is fixed to 600", async () => {
    const { ctx, file, events } = setup();
    const full =
      "APP_BASE_URL=https://a.contoh.com\nGOOGLE_CLIENT_ID=i\nGOOGLE_CLIENT_SECRET=s\nSUPER_ADMIN_EMAILS=a@b.co\n";
    writeFileSync(file, full, { mode: 0o600 });
    expect(envStep.plan(ctx, await envStep.detect(ctx))).toEqual([]);
    chmodSync(file, 0o644);
    const lines = envStep.plan(ctx, await envStep.detect(ctx));
    expect(lines.map((l) => l.kind)).toEqual(["action"]);
    expect(await run(ctx)).toBe(0);
    expect(mode(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe(full);
    expect(events).toEqual([]);
  });

  test("complete but invalid .env: plan shows the error naming the variable, never the value", async () => {
    const { ctx, file } = setup();
    writeFileSync(
      file,
      `APP_BASE_URL=https://a.contoh.com\nGOOGLE_CLIENT_ID=i\nGOOGLE_CLIENT_SECRET=${SECRET}\nSUPER_ADMIN_EMAILS=a@b.co\nPORT=99999\n`,
      { mode: 0o600 },
    );
    const lines = envStep.plan(ctx, await envStep.detect(ctx));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("error");
    expect(lines[0]?.text).toContain("PORT");
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });
});

describe("init step env: flags and no terminal", () => {
  test("no terminal: flags prefill, nothing is asked, exit 3 lists only the names", async () => {
    const { ctx, file, events, out } = setup({
      tty: false,
      args: { hostname: "https://panel.contoh.com/", adminEmails: ["a@b.co", "c@d.co"] },
    });
    const lines = envStep.plan(ctx, await envStep.detect(ctx));
    expect(lines.find((l) => l.kind === "warning")?.text).toContain("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
    expect(await run(ctx)).toBe(3);
    expect(events.filter((e) => !e.startsWith("out"))).toEqual([]);
    const v = parsed(file);
    expect(v.APP_BASE_URL).toBe("https://panel.contoh.com");
    expect(v.SUPER_ADMIN_EMAILS).toBe("a@b.co,c@d.co");
    expect(mode(file)).toBe(0o600);
    expect(out()).toContain(".env belum lengkap: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.");
  });

  test("--skip tunnel: APP_BASE_URL = http://localhost:<PORT>, not asked", async () => {
    const { ctx, file, events } = setup({ skip: ["tunnel"], answers: ["a@b.co", CLIENT_ID, SECRET] });
    writeFileSync(file, "PORT=3300\n", { mode: 0o600 });
    expect(await run(ctx)).toBe(0);
    expect(parsed(file).APP_BASE_URL).toBe("http://localhost:3300");
    expect(events.some((e) => e.startsWith("ask Alamat"))).toBe(false);
    expect(events).toContain("out   http://localhost:3300/api/auth/callback/google");
  });

  test("flags never overwrite an existing value", async () => {
    const { ctx, file } = setup({ tty: false, args: { hostname: "baru.contoh.com" } });
    writeFileSync(file, "APP_BASE_URL=https://lama.contoh.com\n", { mode: 0o600 });
    expect(await run(ctx)).toBe(3);
    expect(parsed(file).APP_BASE_URL).toBe("https://lama.contoh.com");
  });

  test("invalid --hostname / --admin-email = exit 2 at detect, nothing written", async () => {
    for (const args of [{ hostname: "bukan_host" }, { adminEmails: ["tanpa-at"] }]) {
      const { ctx, root } = setup({ tty: false, args });
      const before = files(root);
      await expect(envStep.detect(ctx)).rejects.toMatchObject({ code: 2 });
      expect(files(root)).toEqual(before);
    }
  });

  test("detect and plan never write", async () => {
    const { ctx, root, file } = setup({ args: { hostname: "panel.contoh.com" } });
    writeFileSync(file, ENV_EXAMPLE_040);
    chmodSync(file, 0o644);
    const before = files(root);
    const beforeMode = mode(file);
    envStep.plan(ctx, await envStep.detect(ctx));
    expect(files(root)).toEqual(before);
    expect(mode(file)).toBe(beforeMode);
  });
});

describe("init.env helpers", () => {
  test("the question order covers exactly the schema's required variables", async () => {
    const { ctx } = setup();
    const { missing } = (await envStep.detect(ctx)) as EnvStepState;
    expect([...missing].sort()).toEqual(
      ENV_VARS.filter((v) => v.required)
        .map((v) => v.name)
        .sort(),
    );
  });

  test("the email prompt accepts exactly what the server's parseEnv accepts", () => {
    for (const e of ["a@b.co", "x y@b.co", "a@b", "@b.co"]) {
      let server = true;
      try {
        parseEnv({
          APP_BASE_URL: "https://a.co",
          GOOGLE_CLIENT_ID: "i",
          GOOGLE_CLIENT_SECRET: "s",
          SUPER_ADMIN_EMAILS: e,
        });
      } catch (err) {
        if (!(err instanceof EnvError)) throw err;
        server = false;
      }
      expect(normalizeEmails(e) !== null).toBe(server);
    }
  });

  test("normalizeHostname / normalizeEmails", () => {
    expect(normalizeHostname(" HTTPS://Panel.Contoh.com// ")).toBe("panel.contoh.com");
    expect(normalizeHostname("localhost")).toBeNull();
    expect(normalizeEmails("A@b.co,, c@d.co ")).toBe("a@b.co,c@d.co");
    expect(normalizeEmails(" , ")).toBeNull();
  });

  test("setEnvLine replaces the last definition (the one Bun reads), else inserts before the final newline", () => {
    expect(setEnvLine("A=1\n# A=x\nexport A=2\n", "A", "3")).toBe("A=1\n# A=x\nA=3\n");
    expect(setEnvLine("B=1\n", "A", "it's $x")).toBe(`B=1\nA="it's \\$x"\n`);
    expect(setEnvLine(renderEnvTemplate({ full: false }), "PORT", "1")).toEndWith("PORT=1\n");
  });
});
