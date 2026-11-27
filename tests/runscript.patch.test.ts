// planRunScriptFix + validateRunScript (PLAN/06 §3.6): only `--no-auto-exit` after `pm2-runtime`, checked with `-n`.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRunScriptFix, syntaxShell, validateRunScript } from "@/server/sites/runscript.patch";

const root = mkdtempSync(join(tmpdir(), "panel-runscript-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// test-only: shaped like the POCO run script (Indonesian comments, no flag)
const POCO_RUN = `#!/data/data/com.termux/files/usr/bin/sh
# Dijalankan runit: pm2-runtime menjaga aplikasi di ~/sites tetap hidup.
export HOME=/data/data/com.termux/files/home
export PM2_HOME=$HOME/.pm2
exec node /data/data/com.termux/files/usr/lib/node_modules/pm2/bin/pm2-runtime $HOME/sites/ecosystem.config.js 2>&1
`;
const TEMPLATE_RUN = readFileSync(join(import.meta.dir, "..", "deploy", "pm2", "run"));
const plan = (text: string | Buffer, o: { isSymlink?: boolean; nlink?: number } = {}) =>
  planRunScriptFix({ bytes: Buffer.from(text), isSymlink: o.isSymlink ?? false, nlink: o.nlink ?? 1 });

describe("planRunScriptFix", () => {
  test("POCO: flag right after pm2-runtime on that line only", () => {
    const p = plan(POCO_RUN);
    if (p.kind !== "patch") throw new Error(JSON.stringify(p));
    expect(p.candidate.toString()).toBe(POCO_RUN.replace("pm2-runtime $HOME", "pm2-runtime --no-auto-exit $HOME"));
    expect(p.line).toBe(5);
    expect(p.changes).toEqual([
      { kind: "remove", line: 5, text: POCO_RUN.split("\n")[4] as string },
      {
        kind: "add",
        afterLine: 5,
        lines: [(POCO_RUN.split("\n")[4] as string).replace("pm2-runtime ", "pm2-runtime --no-auto-exit ")],
      },
    ]);
  });

  test("shipped template already has the flag → unchanged", () => {
    expect(plan(TEMPLATE_RUN)).toEqual({ kind: "unchanged" });
  });

  test("flag only in a comment still gets patched", () => {
    const p = plan(`#!/bin/sh\n# use --no-auto-exit some day\nexec pm2-runtime eco.config.js\n`);
    expect(p.kind).toBe("patch");
  });

  test.each([
    ["two pm2-runtime lines", "#!/bin/sh\npm2-runtime a.config.js &\nexec pm2-runtime b.config.js\n"],
    ["pm2-runtime start", "#!/bin/sh\nexec pm2-runtime start eco.config.js\n"],
    ["no pm2-runtime line", "#!/bin/sh\nexec pm2 resurrect\n"],
    ["pm2-runtime without argument", "#!/bin/sh\nexec pm2-runtime"],
    ["not UTF-8", Buffer.from([0x23, 0x21, 0xff, 0x0a])],
  ])("%s → run_script_unknown", (_l, text) => {
    expect(plan(text)).toEqual({ kind: "manual", reason: "run_script_unknown" });
  });

  test("symlink, hardlink, missing", () => {
    expect(plan(POCO_RUN, { isSymlink: true })).toEqual({ kind: "manual", reason: "run_script_unknown" });
    expect(plan(POCO_RUN, { nlink: 2 })).toEqual({ kind: "manual", reason: "run_script_unknown" });
    expect(planRunScriptFix({ bytes: null, isSymlink: false, nlink: 0 })).toEqual({
      kind: "manual",
      reason: "run_script_missing",
    });
  });
});

describe("validateRunScript", () => {
  const prefix = join(root, "usr");
  const log = join(root, "shell.log");
  mkdirSync(join(prefix, "bin"), { recursive: true });
  // test-only: $PREFIX/bin/bash records argv and whether the candidate is executable, then runs the host shell
  writeFileSync(
    join(prefix, "bin", "bash"),
    `#!/bin/sh\necho "$@" > "${log}"\n[ -x "$2" ] && echo exec >> "${log}"\nexec /bin/sh "$@"\n`,
  );
  chmodSync(join(prefix, "bin", "bash"), 0o755);
  const svc = join(root, "svc");
  mkdirSync(svc);
  const run = join(svc, "run");

  test("shebang interpreter from $PREFIX/bin is used; absent one falls back to sh", () => {
    expect(syntaxShell("#!/data/data/com.termux/files/usr/bin/bash\n", prefix)).toBe(join(prefix, "bin", "bash"));
    expect(syntaxShell("#!/usr/bin/env bash\n", prefix)).toBe(join(prefix, "bin", "bash"));
    expect(syntaxShell("#!/x/bin/zsh\n", prefix)).toBe("/bin/sh");
  });

  test("bash shebang → `bash -n` on a 0755 candidate; ok; temp removed, run untouched", async () => {
    const text = POCO_RUN.replace("usr/bin/sh", "usr/bin/bash");
    writeFileSync(run, text, { mode: 0o755 });
    const p = plan(text);
    if (p.kind !== "patch") throw new Error(JSON.stringify(p));
    expect(await validateRunScript(run, Buffer.from(text), p.candidate, p.line, 0o755, prefix)).toEqual({ ok: true });
    expect(readFileSync(log, "utf8")).toBe(`-n ${join(svc, ".run.panel-candidate")}\nexec\n`);
    expect(readdirSync(svc)).toEqual(["run"]);
    expect(readFileSync(run, "utf8")).toBe(text);
  });

  test("syntax error → not ok with detail, nothing left behind", async () => {
    const text = "#!/data/data/com.termux/files/usr/bin/bash\nif then\nexec pm2-runtime eco.config.js\n";
    const p = plan(text);
    if (p.kind !== "patch") throw new Error(JSON.stringify(p));
    const r = await validateRunScript(run, Buffer.from(text), p.candidate, p.line, 0o755, prefix);
    expect(r.ok).toBe(false);
    expect(existsSync(join(svc, ".run.panel-candidate"))).toBe(false);
  });

  test("candidate that changes another line is refused before any shell runs", async () => {
    const r = await validateRunScript(run, Buffer.from("a\nb\n"), Buffer.from("x\ny\n"), 1, 0o755, prefix);
    expect(r).toEqual({ ok: false, detail: "candidate differs outside the pm2-runtime line" });
  });
});
