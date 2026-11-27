import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeCliLocale, cliLocale, langFlag, setCliLocale, tr } from "@/cli/cli.locale";
import { runCli } from "@/cli/cli.main";
import { createCliOut } from "@/cli/cli.output";

const none = () => null;
const file = (PANEL_LANG: string) => () => ({ PANEL_LANG });

describe("cliLocale order (E12)", () => {
  test("--lang wins over everything, in both spellings", () => {
    const env = { PANEL_LANG: "en", LANG: "en_US.UTF-8" };
    expect(cliLocale(env, ["doctor", "--lang", "id"], file("en"))).toEqual({ locale: "id", source: "flag" });
    expect(cliLocale(env, ["doctor", "--lang=id"], file("en"))).toEqual({ locale: "id", source: "flag" });
    expect(langFlag(["--lang", "en", "--lang=id"])).toBe("id");
  });

  test("PANEL_LANG: process env first, then the env file (read only when needed)", () => {
    let reads = 0;
    const counted = () => {
      reads++;
      return { PANEL_LANG: "id" };
    };
    expect(cliLocale({ PANEL_LANG: "en" }, [], counted)).toEqual({ locale: "en", source: "env" });
    expect(reads).toBe(0);
    expect(cliLocale({ LANG: "en_US.UTF-8" }, [], counted)).toEqual({ locale: "id", source: "env-file" });
    expect(reads).toBe(1);
  });

  test("invalid --lang / PANEL_LANG are skipped", () => {
    expect(cliLocale({ PANEL_LANG: "fr" }, ["--lang", "xx"], file("id"))).toEqual({ locale: "id", source: "env-file" });
  });

  test("shell: first non-empty of LC_ALL, LC_MESSAGES, LANG decides; only id/in mean Indonesian", () => {
    expect(cliLocale({ LC_ALL: "", LC_MESSAGES: "id_ID.UTF-8", LANG: "en_US.UTF-8" }, [], none).locale).toBe("id");
    expect(cliLocale({ LC_ALL: "C", LANG: "id_ID.UTF-8" }, [], none)).toEqual({ locale: "en", source: "shell" });
    expect(cliLocale({ LANG: "in_ID" }, [], none).locale).toBe("id");
    expect(cliLocale({ LANG: "de_DE.UTF-8" }, [], none).locale).toBe("en");
    // POCO: the phone is id-ID but Termux says en_US (debate 9) → English unless PANEL_LANG says otherwise.
    expect(cliLocale({ LANG: "en_US.UTF-8" }, [], none).locale).toBe("en");
    expect(cliLocale({}, [], none)).toEqual({ locale: "en", source: "default" });
  });

  test("tr follows the active locale", () => {
    setCliLocale({ locale: "id", source: "flag" });
    expect(tr("Done.", "Selesai.")).toBe("Selesai.");
    setCliLocale({ locale: "en", source: "default" });
    expect(tr("Done.", "Selesai.")).toBe("Done.");
  });
});

describe("runCli --lang", () => {
  const home = mkdtempSync(join(tmpdir(), "panel-cli-locale-"));
  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
    setCliLocale({ locale: "en", source: "default" });
  });
  const run = async (argv: string[], env: Record<string, string | undefined> = { HOME: home }) => {
    const err: string[] = [];
    const out = createCliOut({ stdout: () => {}, stderr: (t) => err.push(t) });
    return { code: await runCli(argv, { out, env }), err: err.join("") };
  };

  test("accepted by every command and as a global option; other values are exit 2", async () => {
    expect((await run(["env", "--lang", "id"])).code).toBe(0);
    expect(activeCliLocale()).toEqual({ locale: "id", source: "flag" });
    expect((await run(["--lang", "en", "--version"])).code).toBe(0);
    const bad = await run(["env", "--lang", "fr"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--lang fr");
  });

  test("PANEL_LANG from ~/panel/.env when the process env has none", async () => {
    mkdirSync(join(home, "panel"), { recursive: true });
    writeFileSync(join(home, "panel", ".env"), "PANEL_LANG=id\n"); // test-only
    expect((await run(["env"], { HOME: home, LANG: "en_US.UTF-8" })).code).toBe(0);
    expect(activeCliLocale()).toEqual({ locale: "id", source: "env-file" });
  });
});
