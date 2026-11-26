// Loads ecosystem.config.js with node the way pm2 does and reports what it would start (PLAN/03 §3.6, B25).
import { join } from "node:path";
import { runTermux, TermuxExecError, termuxPrefix } from "../exec/termux.exec";
import { redactLines } from "../system/log.redact";
import type { SystemAdapters } from "../system/system.types";

/** What the probe saw: did the file require apps.json, which app names it exports, and their `env` key names. */
export type EcosystemProbe =
  | { ok: true; loadedAppsJson: boolean; names: string[]; envKeys: Record<string, string[]> }
  | { ok: false; reason: "syntax" | "node_missing" | "timeout" | "not_config_js"; detail: string | null };

/** The only environment the probe's node sees (no panel secrets, C14). */
export const PROBE_ENV_KEYS = ["PATH", "HOME", "PREFIX", "PM2_HOME", "LANG"] as const;
const PROBE_TIMEOUT_MS = 15_000;
const DETAIL_MAX = 300;
const MARK = "PANEL_PROBE ";
/** pm2 treats only `*.config.js` (and json/yaml) as an ecosystem; any other file is run as a script (lab E7). */
const CONFIG_JS = /\.config\.js$/;

// Runs in node: records any require that resolves to <dir>/apps.json, then prints one marked JSON line.
const PROBE = `
const Module = require("module"), path = require("path"), fs = require("fs");
const eco = fs.realpathSync(path.resolve(process.argv[1]));
const appsJson = path.join(path.dirname(eco), "apps.json");
let loadedAppsJson = false;
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  const base = parent && parent.filename ? path.dirname(parent.filename) : path.dirname(eco);
  const t = path.resolve(base, req);
  if (t === appsJson || t + ".json" === appsJson) loadedAppsJson = true;
  return orig.call(this, req, parent, ...rest);
};
const cfg = require(eco);
const apps = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.apps) ? cfg.apps : [];
const named = apps.filter((a) => a && typeof a.name === "string");
const envKeys = {};
for (const a of named) envKeys[a.name] = a.env && typeof a.env === "object" ? Object.keys(a.env) : [];
process.stdout.write("\\n${MARK}" + JSON.stringify({ loadedAppsJson, names: named.map((a) => a.name), envKeys }) + "\\n");
`;

const cut = (text: string) => {
  const t = redactLines(text.trim().split("\n")).lines.join("\n");
  return t === "" ? null : t.slice(0, DETAIL_MAX);
};

/** node to run: Termux `$PREFIX/bin/node`, or the host's node in fake mode (tests, dev). */
const nodeBin = (system: SystemAdapters): string | null => (system.mode === "termux" ? "node" : Bun.which("node"));

/** Runs the probe on `ecosystemPath` with cwd `sitesDir` and the minimal env. Never throws. */
export async function probeEcosystem(
  system: SystemAdapters,
  ecosystemPath: string,
  sitesDir: string,
): Promise<EcosystemProbe> {
  if (!CONFIG_JS.test(ecosystemPath)) return { ok: false, reason: "not_config_js", detail: ecosystemPath };
  const node = nodeBin(system);
  if (!node) return { ok: false, reason: "node_missing", detail: null };
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: system.home,
    PREFIX: termuxPrefix(),
    PM2_HOME: process.env.PM2_HOME ?? join(system.home, ".pm2"),
    LANG: process.env.LANG,
  };
  let r: Awaited<ReturnType<typeof runTermux>>;
  try {
    r = await runTermux(node, ["-e", PROBE, ecosystemPath], { cwd: sitesDir, timeoutMs: PROBE_TIMEOUT_MS, env });
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof TermuxExecError && msg.includes("timed out"))
      return { ok: false, reason: "timeout", detail: null };
    return { ok: false, reason: "node_missing", detail: cut(msg) };
  }
  const line = r.stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(MARK));
  if (r.code !== 0 || !line) return { ok: false, reason: "syntax", detail: cut(r.stderr) };
  try {
    const v = JSON.parse(line.slice(MARK.length)) as Omit<Extract<EcosystemProbe, { ok: true }>, "ok">;
    return { ok: true, loadedAppsJson: v.loadedAppsJson === true, names: v.names, envKeys: v.envKeys };
  } catch (e) {
    return { ok: false, reason: "syntax", detail: cut(`probe output unreadable: ${(e as Error).message}`) };
  }
}
