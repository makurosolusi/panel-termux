// Step 1 `binary` cleanup targets (PLAN/07 K24, E10, E11): the download to delete and the old ~/panel-src folders.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CliHost } from "./cli.host";
import { SELF_VERSION } from "./init.mode";

const VERSION_DIR = /^v[0-9]/;
const SEMVER_DIR = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
/** Names our download has (README: ~/panel-termux; install.sh shim: the raw `panel` asset). */
const DOWNLOAD_NAMES = new Set(["panel-termux", "panel"]);
/** ~/panel-src, where old downloads were unpacked. */
export const srcDir = (host: CliHost) => join(host.paths.home, "panel-src");

/**
 * The download to delete (K24, E10): this file, when it is named like our download, outside ~/panel/ (panel.prev/
 * panel.new never) and outside $PREFIX/bin (an installed tool, not a download). So `bun …/main.ts init` never removes
 * bun. The fake host only ever deletes inside its sandbox, so `PANEL_CLI_FAKE=… dist/panel` never removes a build.
 */
export function downloadPath(host: CliHost): string | null {
  if (!existsSync(host.selfPath) || !DOWNLOAD_NAMES.has(basename(host.selfPath))) return null;
  const self = realpathSync(host.selfPath);
  const bin = join(host.paths.prefix, "bin");
  const realBin = existsSync(bin) ? realpathSync(bin) : bin;
  if (dirname(host.selfPath) === bin || dirname(self) === realBin) return null;
  const panelDir = existsSync(host.paths.panelDir) ? realpathSync(host.paths.panelDir) : host.paths.panelDir;
  if (self.startsWith(`${panelDir}/`)) return null;
  if (host.mode === "fake" && !self.startsWith(`${realpathSync(host.paths.home)}/`)) return null;
  return host.selfPath;
}

/** E11: keep this version, the newest older one and anything newer; only `v[0-9]*` folders, others mentioned. */
export function srcEntries(host: CliHost): { prune: string[]; stray: string[] } {
  const dir = srcDir(host);
  if (!existsSync(dir)) return { prune: [], stray: [] };
  const entries = readdirSync(dir, { withFileTypes: true });
  const older = entries
    .filter((e) => e.isDirectory() && SEMVER_DIR.test(e.name))
    .map((e) => e.name)
    .filter((n) => Bun.semver.order(n.slice(1), SELF_VERSION) < 0)
    .sort((a, b) => Bun.semver.order(b.slice(1), a.slice(1)));
  return {
    prune: older.slice(1).map((n) => join(dir, n)),
    stray: entries.filter((e) => !VERSION_DIR.test(e.name)).map((e) => e.name),
  };
}
