import { describe, expect, test } from "bun:test";
import { COMMAND_NAMES } from "../src/cli/cli.help";
import type { ParsedArgs } from "../src/cli/cli.main";
import { CliExit, createCliOut } from "../src/cli/cli.output";
import { DOC_TOPICS, DOCS_URL, docsCommand, renderPlain } from "../src/cli/docs.command";

// PLAN/07 §6.1 + §12: exactly 4 topics, plain text, unknown topic → 2, and docs only name commands that exist.
async function run(positionals: string[]) {
  let stdout = "";
  let stderr = "";
  const out = createCliOut({ stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  const args: ParsedArgs = { values: {}, positionals };
  const host = () => Promise.reject(new Error("docs must not detect the host"));
  try {
    return { code: await docsCommand(args, { out, host }), stdout, stderr };
  } catch (e) {
    if (!(e instanceof CliExit)) throw e;
    return { code: e.code, stdout, stderr, error: e };
  }
}

const TOPICS = ["google", "cloudflare", "android", "paket"];

describe("panel docs", () => {
  test("exactly the 4 topics, none empty", () => {
    expect(Object.keys(DOC_TOPICS)).toEqual(TOPICS);
    for (const t of TOPICS) expect(DOC_TOPICS[t]?.text.trim().length).toBeGreaterThan(500);
  });

  test("without a topic: lists every topic and the web URL, exit 0", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    for (const t of TOPICS) expect(r.stdout).toMatch(new RegExp(`^  ${t} `, "m"));
    expect(r.stdout).toContain(DOCS_URL);
    expect(r.stderr).toBe("");
  });

  test("unknown topic (instal) → exit 2 naming the topic and the list", async () => {
    const r = await run(["instal"]);
    expect(r.code).toBe(2);
    expect(r.error?.message).toBe("Topik tidak dikenal: instal");
    expect(r.error?.hint).toBe(`topik: ${TOPICS.join(", ")}`);
    expect(r.stdout).toBe("");
  });

  test.each(TOPICS)("docs %s prints plain text: no ANSI, no markdown marks, ≤ 100 columns, ≤ 70 lines", async (t) => {
    const r = await run([t]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(r.stdout).not.toContain("\x1b");
    expect(r.stdout).not.toMatch(/^#|`|\*\*/m);
    expect(lines.filter((l) => [...l].length > 100)).toEqual([]);
    expect(lines.length).toBeLessThanOrEqual(70);
  });

  test("every `panel <perintah>` in the docs exists in the dispatcher (no upgrade; init since 0.5.1)", () => {
    const named = Object.values(DOC_TOPICS).flatMap((d) => [...d.text.matchAll(/`panel ([a-z-]+)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => !(COMMAND_NAMES as readonly string[]).includes(n as string))).toEqual([]);
    for (const d of Object.values(DOC_TOPICS)) {
      expect(d.text).not.toMatch(/panel upgrade\b/);
      expect(d.text).not.toMatch(/install(-phone)?\.sh/);
    }
  });

  test("google and cloudflare say what panel init does for them, and keep the manual fallback", () => {
    expect(DOC_TOPICS.google?.text).toContain("`panel init` menanyakan Client ID dan Client secret");
    expect(DOC_TOPICS.google?.text).toContain("GOOGLE_CLIENT_SECRET=");
    const cf = DOC_TOPICS.cloudflare?.text ?? "";
    expect(cf).toContain("`panel init` menjalankan `cloudflared tunnel login`");
    expect(cf).toContain("--skip tunnel");
    expect(cf).toContain("cloudflared tunnel route dns <nama> panel.<domain>");
  });

  test("google gives the exact redirect URI the server registers", () => {
    expect(DOC_TOPICS.google?.text).toContain("<APP_BASE_URL>/api/auth/callback/google");
  });

  test("paket carries both safe recipes", () => {
    const text = DOC_TOPICS.paket?.text ?? "";
    for (const step of ["apt-mark unhold cloudflared", "rm -f $S/down", "apt-mark hold cloudflared", "pg_dumpall"])
      expect(text).toContain(step);
    expect(text.indexOf("pg_dumpall")).toBeLessThan(text.indexOf("pkg install postgresql"));
  });

  test("renderPlain drops heading marks and indents fenced code", () => {
    expect(renderPlain("# Judul\n\nIsi `x` **y**\n```\nsv up a\n```\n")).toBe("Judul\n\nIsi x y\n    sv up a");
  });
});
