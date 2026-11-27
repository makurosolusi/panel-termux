// Patcher for ecosystem.config.js (PLAN/06 §3.1–3.3, DECISIONS C1): the marked panel block at the end of the file,
// plus removing one old `...require('./apps.json')`. Text outside the markers is never changed. Pure functions.
import type { FixBlockReason, FixChange, FixEffects } from "../../shared/fix.types";
import type { EcosystemProbe } from "./ecosystem.probe";
import { decodeUtf8 } from "./site.files";

/** Version written in the start marker; bump when the block text changes. */
export const BLOCK_VERSION = 1;
/** Candidate file name next to the ecosystem (must end in `.config.js`, same folder for `./apps.json`). */
export const ECOSYSTEM_CANDIDATE = ".ecosystem.panel-candidate.config.js";
/** Larger files are left to the owner. */
export const ECOSYSTEM_MAX_BYTES = 256 * 1024;

const START = /^[ \t]*\/\/ >>> panel-termux:apps v(\d+)\b.*$/gm;
const END = /^[ \t]*\/\/ <<< panel-termux:apps\b.*$/gm;
const OLD_SPREAD = /\.\.\.\s*require\(\s*(["'])\.\/apps(?:\.json)?\1\s*\)\s*,?/g;
const MENTIONS_APPS_JSON = /apps\.json|\.\/apps["']/;
const CONFIG_JS = /\.config\.js$/;

/** The marked block, exact text (PLAN/06 §3.1); the guard script is `<prefix>/bin/sleep`, JSON-quoted. */
export function ecosystemBlock(prefix: string, eol: "\n" | "\r\n" = "\n"): string {
  const guard = JSON.stringify(`${prefix}/bin/sleep`);
  const lines = [
    `// >>> panel-termux:apps v${BLOCK_VERSION} (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)`,
    "// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,",
    "// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan",
    "// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar. Blok ini tidak pernah menggagalkan file.",
    ";{",
    "  try {",
    '    const fs = require("fs");',
    '    const path = require("path");',
    "    const cfg = module.exports;",
    "    const list = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.apps) ? cfg.apps : null;",
    "    if (list) {",
    "      let panel = [];",
    "      try {",
    '        const raw = require("./apps.json");',
    "        panel = Array.isArray(raw)",
    '          ? raw.filter((a) => a && typeof a.name === "string" && typeof a.script === "string" && a.script !== "" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script)))',
    "          : [];",
    "      } catch (e) {",
    '        console.error("[ecosystem] apps.json dilewati: " + e.message);',
    "      }",
    "      const names = new Set(list.map((a) => a && a.name));",
    "      const handWritten = list.length > 0;",
    "      for (const a of panel) if (!names.has(a.name)) list.push(a);",
    '      if (!handWritten && !names.has("pm2-guard"))',
    `        list.push({ name: "pm2-guard", script: ${guard}, args: "infinity", interpreter: "none", autorestart: true });`,
    "    }",
    `    globalThis.__panelTermuxApps = { v: ${BLOCK_VERSION}, listed: list !== null };`,
    "  } catch (e) {",
    '    console.error("[ecosystem] blok panel dilewati: " + e.message);',
    "  }",
    "}",
    "// <<< panel-termux:apps",
  ];
  return lines.join(eol) + eol;
}

const count = (re: RegExp, text: string) => [...text.matchAll(re)].length;
const hasAnyMarker = (text: string) => count(START, text) + count(END, text) > 0;
/** The 0.3.0 template block (`panelApps` + existsSync filter) without markers: still current. */
export const legacyCurrent = (text: string) => !hasAnyMarker(text) && /panelApps/.test(text) && /existsSync/.test(text);
/** Current = marked block of BLOCK_VERSION, or the 0.3.0 template block (PLAN/06 §3.2). */
export function snippetCurrent(text: string | null): boolean {
  if (text === null) return false;
  const v = [...text.matchAll(START)].map((m) => Number(m[1]));
  return (v.length === 1 && v[0] === BLOCK_VERSION && count(END, text) === 1) || legacyCurrent(text);
}

/** Input of planEcosystemFix; `bytes` null = file missing, `realDir` = folder of realpath(ecosystem). */
export type EcosystemFixInput = {
  bytes: Buffer | null;
  path: string;
  realDir: string;
  sitesDirReal: string;
  nlink: number;
  probeBefore: EcosystemProbe;
  prefix: string;
  /** Runnable panel sites in apps.json, for `effects.addApps`. */
  panelApps?: string[];
};
/** What the patcher decided. `candidate` is the complete new file. */
export type EcosystemFixPlan =
  | { kind: "patch"; candidate: Buffer; changes: FixChange[]; effects: FixEffects }
  | { kind: "unchanged" }
  | { kind: "manual"; reason: FixBlockReason };

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length; // 1-based
const lineCount = (text: string) => {
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
};
const linesOf = (segment: string) => segment.replace(/\r?\n$/, "").split(/\r?\n/);
/** Removes lines `from..to` (1-based) of `text`, as hunks. */
const removed = (text: string, from: number, to: number): FixChange[] =>
  text
    .split(/\r?\n/)
    .slice(from - 1, to)
    .map((t, i) => ({ kind: "remove", line: from + i, text: t }));

/** Start index of the line holding `i`, and the end index of the line holding `j` including its EOL. */
function lineSpan(text: string, i: number, j: number): [number, number] {
  const start = text.lastIndexOf("\n", i - 1) + 1;
  const nl = text.indexOf("\n", j);
  return [start, nl === -1 ? text.length : nl + 1];
}

/** Separator so the block starts after exactly one blank line, keeping the file's last newline. */
function separator(text: string, eol: string): string {
  if (text === "" || text.endsWith(eol + eol)) return "";
  return text.endsWith("\n") ? eol : eol + eol;
}

/** Decides how to bring the ecosystem to the current block (PLAN/06 §3.3, steps 1–13). */
export function planEcosystemFix(input: EcosystemFixInput): EcosystemFixPlan {
  const manual = (reason: FixBlockReason): EcosystemFixPlan => ({ kind: "manual", reason });
  const { bytes, probeBefore: probe } = input;
  if (!CONFIG_JS.test(input.path)) return manual("not_config_js");
  if (bytes === null) return manual("ecosystem_missing");
  if (input.realDir !== input.sitesDirReal || input.nlink > 1) return manual("ecosystem_linked");
  if (bytes.length > ECOSYSTEM_MAX_BYTES) return manual("too_large");
  const text = decodeUtf8(bytes);
  if (text === null) return manual("not_utf8");
  if (!probe.ok) return manual("ecosystem_unloadable");

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const block = ecosystemBlock(input.prefix, eol);
  const keepApps = probe.names;
  const effects = (oldSpread: boolean): FixEffects => ({
    keepApps,
    addApps: input.panelApps ?? [],
    guard: keepApps.length === 0,
    oldSpread,
    appliesOnRestart: false,
    dir: null,
  });
  const starts = [...text.matchAll(START)];
  const ends = [...text.matchAll(END)];
  if (starts.length !== ends.length || starts.length > 1) return manual("markers_broken");

  if (starts.length === 1) {
    const s = starts[0] as RegExpExecArray;
    const e = ends[0] as RegExpExecArray;
    if (e.index < s.index) return manual("markers_broken");
    const [from, to] = lineSpan(text, s.index, e.index + e[0].length);
    const region = text.slice(from, to);
    if (region === block || region === block.slice(0, -eol.length)) return { kind: "unchanged" };
    const candidate = Buffer.from(text.slice(0, from) + block + text.slice(to), "utf8");
    const first = lineAt(text, from);
    const changes: FixChange[] = [
      ...removed(text, first, first + linesOf(region).length - 1),
      { kind: "add", afterLine: first - 1, lines: linesOf(block) },
    ];
    return { kind: "patch", candidate, changes, effects: effects(false) };
  }

  if (legacyCurrent(text)) return { kind: "unchanged" };

  const append = (base: string, changes: FixChange[], oldSpread: boolean): EcosystemFixPlan => {
    const sep = separator(base, eol);
    const tail = Buffer.from(sep + block, "utf8");
    // Pure append keeps the original bytes as they are (byte-identical up to the old last byte).
    const head = oldSpread ? Buffer.from(base, "utf8") : bytes;
    const lines = [...(sep.length > 0 ? [""] : []), ...linesOf(block)];
    changes.push({ kind: "add", afterLine: lineCount(text), lines });
    return { kind: "patch", candidate: Buffer.concat([head, tail]), changes, effects: effects(oldSpread) };
  };

  const spreads = [...text.matchAll(OLD_SPREAD)];
  if (spreads.length === 1) {
    const m = spreads[0] as RegExpExecArray;
    const rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
    if (MENTIONS_APPS_JSON.test(rest)) return manual("unknown_apps_json_use");
    const [from, to] = lineSpan(text, m.index, m.index + m[0].length);
    const oldSeg = text.slice(from, to);
    const newSeg = oldSeg.replace(m[0], "");
    const keepLine = !/^[\s,]*$/.test(newSeg);
    const base = text.slice(0, from) + (keepLine ? newSeg : "") + text.slice(to);
    const first = lineAt(text, from);
    const last = first + linesOf(oldSeg).length - 1;
    const changes = removed(text, first, last);
    if (keepLine) changes.push({ kind: "add", afterLine: last, lines: linesOf(newSeg) });
    return append(base, changes, true);
  }
  if (!MENTIONS_APPS_JSON.test(text) && !probe.loadedAppsJson) return append(text, [], false);
  return manual("unknown_apps_json_use");
}
