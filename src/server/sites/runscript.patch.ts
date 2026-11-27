// Patcher for the pm2 runit run script (PLAN/06 §3.6, DECISIONS C1): only adds `--no-auto-exit` after `pm2-runtime`.
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FixBlockReason, FixChange } from "../../shared/fix.types";
import { runTermux } from "../exec/termux.exec";
import { redactLines } from "../system/log.redact";
import { decodeUtf8, writeFileSynced } from "./site.files";

/** Input of planRunScriptFix; `bytes` null = file missing. */
export type RunScriptFixInput = { bytes: Buffer | null; isSymlink: boolean; nlink: number };
/** What the patcher decided; `line` is the 1-based patched line. */
export type RunScriptFixPlan =
  | { kind: "patch"; candidate: Buffer; line: number; changes: FixChange[] }
  | { kind: "unchanged" }
  | { kind: "manual"; reason: FixBlockReason };

const FLAG = "--no-auto-exit";
const RUNTIME = /(pm2-runtime)(\s)/;
const SYNTAX_TIMEOUT_MS = 10_000;
const DETAIL_MAX = 300;
const isComment = (l: string) => l.trimStart().startsWith("#");

/** Decides how to add `--no-auto-exit` to the one non-comment `pm2-runtime` line. */
export function planRunScriptFix({ bytes, isSymlink, nlink }: RunScriptFixInput): RunScriptFixPlan {
  const manual = (reason: FixBlockReason): RunScriptFixPlan => ({ kind: "manual", reason });
  if (bytes === null) return manual("run_script_missing");
  const text = isSymlink || nlink > 1 ? null : decodeUtf8(bytes);
  if (text === null) return manual("run_script_unknown");
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => (!isComment(l) && l.includes("pm2-runtime") ? [i] : []));
  if (hits.length !== 1) return manual("run_script_unknown");
  const i = hits[0] as number;
  const old = lines[i] as string;
  if (/pm2-runtime\s+start\b/.test(old)) return manual("run_script_unknown");
  if (old.includes(FLAG)) return { kind: "unchanged" };
  if (!RUNTIME.test(old)) return manual("run_script_unknown");
  const next = old.replace(RUNTIME, `$1 ${FLAG}$2`);
  lines[i] = next;
  const strip = (l: string) => l.replace(/\r$/, "");
  return {
    kind: "patch",
    candidate: Buffer.from(lines.join("\n"), "utf8"),
    line: i + 1,
    changes: [
      { kind: "remove", line: i + 1, text: strip(old) },
      { kind: "add", afterLine: i + 1, lines: [strip(next)] },
    ],
  };
}

/** Shell that checks the script: the shebang's interpreter when it is in `$PREFIX/bin`, else `sh`. */
export function syntaxShell(text: string, prefix: string): string {
  const first = text.split("\n", 1)[0] ?? "";
  const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(first);
  const name = m ? basename(m[1] === "/usr/bin/env" && m[2] ? m[2] : (m[1] as string)) : null;
  const inPrefix = name ? join(prefix, "bin", name) : null;
  if (inPrefix && existsSync(inPrefix)) return inPrefix;
  const sh = join(prefix, "bin", "sh");
  return existsSync(sh) ? sh : "/bin/sh"; // fake mode on a host without a Termux prefix
}

/**
 * Validates a candidate next to `runPath`: written with `mode`, `<shell> -n` must exit 0, and only line `line`
 * may differ from `original`. The temp file is always removed; a bad script is a result, I/O errors throw.
 */
export async function validateRunScript(
  runPath: string,
  original: Buffer,
  candidate: Buffer,
  line: number,
  mode: number,
  prefix: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const a = original.toString("utf8").split("\n");
  const b = candidate.toString("utf8").split("\n");
  const diff = b.flatMap((l, i) => (l !== a[i] ? [i + 1] : []));
  if (a.length !== b.length || diff.length !== 1 || diff[0] !== line)
    return { ok: false, detail: "candidate differs outside the pm2-runtime line" };
  const tmp = join(dirname(runPath), `.${basename(runPath)}.panel-candidate`);
  try {
    writeFileSynced(tmp, candidate, mode); // I/O errors propagate: the caller maps ENOSPC/EACCES
    let r: Awaited<ReturnType<typeof runTermux>>;
    try {
      r = await runTermux(syntaxShell(candidate.toString("utf8"), prefix), ["-n", tmp], {
        timeoutMs: SYNTAX_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, detail: `syntax check of ${runPath}: ${(e as Error).message}`.slice(0, DETAIL_MAX) };
    }
    if (r.code === 0) return { ok: true };
    const detail = redactLines(r.stderr.trim().split("\n")).lines.join("\n").slice(0, DETAIL_MAX);
    return { ok: false, detail: detail || `syntax check exited ${r.code}` };
  } finally {
    rmSync(tmp, { force: true });
  }
}
