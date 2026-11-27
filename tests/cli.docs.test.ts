import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { COMMAND_NAMES } from "../src/cli/cli.help";
import { setCliLocale } from "../src/cli/cli.locale";
import { type ParsedArgs, runCli } from "../src/cli/cli.main";
import { CliExit, createCliOut } from "../src/cli/cli.output";
import { DOC_ALIASES, DOC_TOPICS, DOCS_URL, docsCommand, renderPlain } from "../src/cli/docs.command";

// PLAN/07 §6.1 + §12, PLAN/08 §6: exactly 4 topics in both locales, plain text, unknown topic → 2, docs only name
// commands that exist. The CLI locale is a module singleton: every test starts in English.
const english = () => setCliLocale({ locale: "en", source: "default" });
beforeEach(english);
afterAll(english);
const LOCALES = ["en", "id"] as const;
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

const TOPICS = ["google", "cloudflare", "android", "packages"];
const texts = () => Object.values(DOC_TOPICS).flatMap((d) => LOCALES.map((l) => d.text[l]));

describe("panel docs", () => {
  test("exactly the 4 topics, none empty, English and Indonesian different", () => {
    expect(Object.keys(DOC_TOPICS)).toEqual(TOPICS);
    for (const t of TOPICS) {
      for (const l of LOCALES) expect(DOC_TOPICS[t]?.text[l].trim().length).toBeGreaterThan(500);
      expect(DOC_TOPICS[t]?.text.en).not.toBe(DOC_TOPICS[t]?.text.id);
    }
  });

  test("without a topic: lists every topic and the web URL, exit 0", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    for (const t of TOPICS) expect(r.stdout).toMatch(new RegExp(`^  ${t} `, "m"));
    expect(r.stdout).toStartWith("Guide topics:\n");
    expect(r.stdout).toContain("Google sign-in: OAuth client and redirect URI");
    expect(r.stdout).toContain(`Web version: ${DOCS_URL}`);
    expect(r.stderr).toBe("");
  });

  test("unknown topic (instal) → exit 2 naming the topic and the list", async () => {
    const r = await run(["instal"]);
    expect(r.code).toBe(2);
    expect(r.error?.message).toBe("Unknown topic: instal");
    expect(r.error?.hint).toBe(`topics: ${TOPICS.join(", ")}`);
    expect(r.stdout).toBe("");
  });

  test.each(LOCALES.flatMap((l) => TOPICS.map((t) => [l, t])))(
    "%s docs %s prints plain text: no ANSI, no markdown marks, ≤ 100 columns, ≤ 70 lines",
    async (l, t) => {
      setCliLocale({ locale: l as "en" | "id", source: "flag" });
      const r = await run([t as string]);
      expect(r.code).toBe(0);
      const lines = r.stdout.trimEnd().split("\n");
      expect(r.stdout).not.toContain("\x1b");
      expect(r.stdout).not.toMatch(/^#|`|\*\*/m);
      expect(lines.filter((l) => [...l].length > 100)).toEqual([]);
      expect(lines.length).toBeLessThanOrEqual(70);
    },
  );

  test("every `panel <command>` in the docs exists in the dispatcher (no upgrade; init since 0.5.1)", () => {
    const named = texts().flatMap((t) => [...t.matchAll(/`panel ([a-z-]+)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => !(COMMAND_NAMES as readonly string[]).includes(n as string))).toEqual([]);
    for (const t of texts()) {
      expect(t).not.toMatch(/panel upgrade\b/);
      expect(t).not.toMatch(/install(-phone)?\.sh/);
      expect(t).not.toContain("panel docs paket"); // hints name the new topic
    }
  });

  test("google and cloudflare say what panel init does for them, and keep the manual fallback", () => {
    expect(DOC_TOPICS.google?.text.en).toContain("`panel init` asks for the Client ID and Client secret");
    expect(DOC_TOPICS.google?.text.id).toContain("`panel init` menanyakan Client ID dan Client secret");
    for (const l of LOCALES) expect(DOC_TOPICS.google?.text[l]).toContain("GOOGLE_CLIENT_SECRET=");
    const cf = DOC_TOPICS.cloudflare?.text.en ?? "";
    expect(cf).toContain("`panel init` runs `cloudflared tunnel login`");
    expect(cf).toContain("--skip tunnel");
    expect(cf).toContain("cloudflared tunnel route dns <name> panel.<domain>");
    expect(DOC_TOPICS.cloudflare?.text.id).toContain("cloudflared tunnel route dns <nama> panel.<domain>");
  });

  test("google gives the exact redirect URI the server registers", () => {
    for (const l of LOCALES) expect(DOC_TOPICS.google?.text[l]).toContain("<APP_BASE_URL>/api/auth/callback/google");
  });

  test.each(LOCALES)("packages (%s) carries both safe recipes", (l) => {
    const text = DOC_TOPICS.packages?.text[l] ?? "";
    for (const step of ["apt-mark unhold cloudflared", "rm -f $S/down", "apt-mark hold cloudflared", "pg_dumpall"])
      expect(text).toContain(step);
    expect(text.indexOf("pg_dumpall")).toBeLessThan(text.indexOf("pkg install postgresql"));
  });

  test("the old topic paket still prints the packages guide (0.5.x hints)", async () => {
    expect(DOC_ALIASES.paket).toBe("packages");
    const [alias, topic] = [await run(["paket"]), await run(["packages"])];
    expect(alias.code).toBe(0);
    expect(alias.stdout).toBe(topic.stdout);
    expect(alias.stdout).toStartWith("Held packages: cloudflared and postgresql");
  });

  test("--lang id and PANEL_LANG=id print the Indonesian list and guide", async () => {
    const lines: string[] = [];
    const out = createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) });
    const host = () => Promise.reject(new Error("docs must not detect the host"));
    expect(await runCli(["docs", "--lang", "id"], { out, host, env: {} })).toBe(0);
    expect(lines.join("")).toStartWith("Topik panduan:\n");
    expect(lines.join("")).toContain("Baca satu topik: panel docs <topik>");
    lines.length = 0;
    expect(await runCli(["docs", "paket"], { out, host, env: { PANEL_LANG: "id" } })).toBe(0);
    expect(lines.join("")).toStartWith("Paket yang ditahan: cloudflared dan postgresql");
    lines.length = 0;
    expect(await runCli(["docs", "instal"], { out, host, env: { PANEL_LANG: "id" } })).toBe(2);
    expect(lines.join("")).toContain("Topik tidak dikenal: instal");
  });

  test("renderPlain drops heading marks and indents fenced code", () => {
    expect(renderPlain("# Judul\n\nIsi `x` **y**\n```\nsv up a\n```\n")).toBe("Judul\n\nIsi x y\n    sv up a");
  });
});
