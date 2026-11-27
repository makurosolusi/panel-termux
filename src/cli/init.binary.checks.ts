// Read-only checks of init step 1 (split from init.binary.ts): may this binary be installed here (release build,
// Android bionic, free space), and does the running panel serve ~/panel/panel.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BinaryError, detectRuntime } from "../server/deploy/elf.runtime";
import { ENV_VARS, type EnvVar, type EnvVarName } from "../shared/env.schema";
import { type CliHost, probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { readEnvFile } from "./env.file";
import { releaseTag } from "./init.mode";

/** Headroom on top of 2 × panel.db + the new binary + the old one when kept (E16: Termux copies panel.prev, E9). */
export const SPACE_HEADROOM_BYTES = 256 * 1024 * 1024;
/** Lets a phone install a local build without a release tag (developers only; the bun runtime is still refused). */
export const DEV_INSTALL_ENV = "PANEL_DEV_INSTALL";

const envDefault = (name: EnvVarName) => (ENV_VARS as readonly EnvVar[]).find((v) => v.name === name)?.default ?? "";
const mb = (n: number) => `${Math.ceil(n / 1024 / 1024)} MB`;

function envOf(host: CliHost) {
  return readEnvFile(probePaths(host.paths).envFile) ?? {};
}

/** C21: the running panel answers /api/health and runit's pid executes exactly ~/panel/panel (dev+ino). */
export async function servesBinary(host: CliHost): Promise<boolean> {
  const binary = probePaths(host.paths).binary;
  if (!(await host.health(Number(envOf(host).PORT || envDefault("PORT"))))) return false;
  const pidFile = join(host.paths.svdir, "panel", "supervise", "pid");
  if (!existsSync(pidFile)) return false;
  const exe = host.proc.exeId(Number(readFileSync(pidFile, "utf8").trim()));
  const file = statSync(binary);
  return exe !== null && exe.dev === file.dev && exe.ino === file.ino;
}

/**
 * Only a compiled panel is installed: the bun runtime (`bun src/cli/main.ts init`) never, and a build without an
 * embedded release tag (no SHA256SUMS to check against) only with PANEL_DEV_INSTALL=1. Null = allowed.
 */
export function releaseBlocker(tag: string, devInstall: boolean, compiled: boolean): string | null {
  if (!compiled)
    return tr(
      "This is the bun runtime, not the panel binary; run the release binary (./panel-termux init)",
      "Ini runtime bun, bukan binary panel; jalankan binary rilis (./panel-termux init)",
    );
  if (!tag && !devInstall)
    return tr(
      "This binary is not a release build (no release tag), so it cannot be checked",
      "Binary ini bukan build rilis (tanpa tag rilis), jadi tidak bisa dicek",
    );
  return null;
}

/**
 * Not a release build, wrong build (not aarch64 bionic) or too little space for 2 × panel.db + 256 MB + binary, plus
 * a copy of the old binary when it is kept as panel.prev (E16; Android refuses the hard link, E9).
 */
export function blockerOf(host: CliHost, keepPrev: boolean): string | null {
  if (host.mode === "termux") {
    // a compiled binary runs its entry from Bun's embedded filesystem (/$bunfs/…); plain bun runs a real file
    const blocked = releaseBlocker(releaseTag(), process.env[DEV_INSTALL_ENV] === "1", Bun.main.startsWith("/$bunfs/"));
    if (blocked) return blocked;
    try {
      if (detectRuntime(host.selfPath) !== "native")
        return tr(
          "This binary is a glibc build, not the Android (bionic) build",
          "Binary ini build glibc, bukan build Android (bionic)",
        );
    } catch (e) {
      if (!(e instanceof BinaryError)) throw e;
      return tr(
        `This binary cannot run on this phone: ${e.message}`,
        `Binary ini tidak bisa dijalankan di HP ini: ${e.message}`,
      );
    }
  }
  const env = envOf(host);
  const db = join(resolve(host.paths.panelDir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR")), "panel.db");
  const prev = keepPrev ? statSync(probePaths(host.paths).binary).size : 0;
  const need =
    2 * (existsSync(db) ? statSync(db).size : 0) + SPACE_HEADROOM_BYTES + statSync(host.selfPath).size + prev;
  const free = host.freeBytes(existsSync(host.paths.panelDir) ? host.paths.panelDir : host.paths.home);
  if (free >= need) return null;
  return tr(
    `${mb(free)} free, the panel needs ${mb(need)} to install`,
    `Ruang kosong ${mb(free)}, butuh ${mb(need)} untuk memasang panel`,
  );
}
