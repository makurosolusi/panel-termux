// Step 1 of `panel init` (PLAN/07 §4.1, K19, K21, K24, C21, C24, E10, E11, E16): put this binary at ~/panel/panel
// (panel.new → fsync → self check → panel.prev by link + rename → rename), the `panel` command symlink, then remove
// the download and old ~/panel-src/v<version> folders. Same bytes already installed = no binary write, no check.
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BinaryError, detectRuntime } from "../server/deploy/elf.runtime";
import { ENV_VARS, type EnvVar, type EnvVarName } from "../shared/env.schema";
import { type CliHost, probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { readEnvFile } from "./env.file";
import { releaseTag, SELF_VERSION } from "./init.mode";
import { tilde } from "./init.plan";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";
import { previewVerify, verifyInstall } from "./init.verify";

/** Headroom on top of 2 × panel.db + one binary (E16: panel.prev is a hard link, so the binary counts once). */
export const SPACE_HEADROOM_BYTES = 256 * 1024 * 1024;
const VERSION_DIR = /^v[0-9]/;
const SEMVER_DIR = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
/** Names our download has (README: ~/panel-termux; install.sh shim: the raw `panel` asset). */
const DOWNLOAD_NAMES = new Set(["panel-termux", "panel"]);
/** Lets a phone install a local build without a release tag (developers only; the bun runtime is still refused). */
export const DEV_INSTALL_ENV = "PANEL_DEV_INSTALL";

/** What step 1 found; detect only reads. */
export type BinaryState = {
  /** ~/panel/panel is not these bytes: copy, check, rename. */
  install: boolean;
  /** Old ~/panel/panel becomes panel.prev (C21); false when there is none or it never proved it served. */
  keepPrev: boolean;
  /** $PREFIX/bin/panel: ours (→ ~/panel/panel), missing (create), or someone else's (left alone). */
  link: "ok" | "create" | "foreign";
  /** The downloaded file to remove after install (K24, E10), or null. */
  download: string | null;
  /** ~/panel-src/v* folders to remove (E11). */
  prune: string[];
  /** Other ~/panel-src entries: only mentioned (E11). */
  stray: string[];
  /** ~/panel/data is missing (created 700). */
  makeDataDir: boolean;
  /** Refusal found before any write (wrong build, no space), or null. */
  blocker: string | null;
  /** Dry run only: what the self check would say (§4.1). */
  preview: PlanLine | null;
};

const envDefault = (name: EnvVarName) => (ENV_VARS as readonly EnvVar[]).find((v) => v.name === name)?.default ?? "";
const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const mb = (n: number) => `${Math.ceil(n / 1024 / 1024)} MB`;
const binLink = (host: CliHost) => join(host.paths.prefix, "bin", "panel");
const srcDir = (host: CliHost) => join(host.paths.home, "panel-src");

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Runs one filesystem write; failure = exit 1 naming the operation and the errno. */
function step(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    throw new CliExit(INIT_EXIT.failed, `Gagal ${what}: ${errCode(e)}.`, "periksa izin folder ~/panel, lalu ulangi");
  }
}

function envOf(host: CliHost) {
  return readEnvFile(probePaths(host.paths).envFile) ?? {};
}

/** C21: the running panel answers /api/health and runit's pid executes exactly ~/panel/panel (dev+ino). */
async function servesBinary(host: CliHost): Promise<boolean> {
  const binary = probePaths(host.paths).binary;
  if (!(await host.health(Number(envOf(host).PORT || envDefault("PORT"))))) return false;
  const pidFile = join(host.paths.svdir, "panel", "supervise", "pid");
  if (!existsSync(pidFile)) return false;
  const exe = host.proc.exeId(Number(readFileSync(pidFile, "utf8").trim()));
  const file = statSync(binary);
  return exe !== null && exe.dev === file.dev && exe.ino === file.ino;
}

function linkState(host: CliHost): BinaryState["link"] {
  const link = binLink(host);
  const st = lstatSync(link, { throwIfNoEntry: false });
  if (!st) return "create";
  if (!st.isSymbolicLink()) return "foreign";
  return resolve(dirname(link), readlinkSync(link)) === probePaths(host.paths).binary ? "ok" : "foreign";
}

/**
 * The download to delete (K24, E10): this file, when it is named like our download, outside ~/panel/ (panel.prev/
 * panel.new never) and outside $PREFIX/bin (an installed tool, not a download). So `bun …/main.ts init` never removes
 * bun. The fake host only ever deletes inside its sandbox, so `PANEL_CLI_FAKE=… dist/panel` never removes a build.
 */
function downloadPath(host: CliHost): string | null {
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
function srcEntries(host: CliHost): { prune: string[]; stray: string[] } {
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

/**
 * Only a compiled panel is installed: the bun runtime (`bun src/cli/main.ts init`) never, and a build without an
 * embedded release tag (no SHA256SUMS to check against) only with PANEL_DEV_INSTALL=1. Null = allowed.
 */
export function releaseBlocker(tag: string, devInstall: boolean, compiled: boolean): string | null {
  if (!compiled) return "Ini runtime bun, bukan binary panel; jalankan binary rilis (./panel-termux init)";
  if (!tag && !devInstall) return "Binary ini bukan build rilis (tanpa tag rilis), jadi tidak bisa dicek";
  return null;
}

/** Not a release build, wrong build (not aarch64 bionic) or too little space for 2 × panel.db + 256 MB + binary (E16). */
function blockerOf(host: CliHost): string | null {
  if (host.mode === "termux") {
    // a compiled binary runs its entry from Bun's embedded filesystem (/$bunfs/…); plain bun runs a real file
    const blocked = releaseBlocker(releaseTag(), process.env[DEV_INSTALL_ENV] === "1", Bun.main.startsWith("/$bunfs/"));
    if (blocked) return blocked;
    try {
      if (detectRuntime(host.selfPath) !== "native") return "Binary ini build glibc, bukan build Android (bionic)";
    } catch (e) {
      if (!(e instanceof BinaryError)) throw e;
      return `Binary ini tidak bisa dijalankan di HP ini: ${e.message}`;
    }
  }
  const env = envOf(host);
  const db = join(resolve(host.paths.panelDir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR")), "panel.db");
  const need = 2 * (existsSync(db) ? statSync(db).size : 0) + SPACE_HEADROOM_BYTES + statSync(host.selfPath).size;
  const free = host.freeBytes(existsSync(host.paths.panelDir) ? host.paths.panelDir : host.paths.home);
  return free < need ? `Ruang kosong ${mb(free)}, butuh ${mb(need)} untuk memasang panel` : null;
}

async function detect(ctx: InitContext): Promise<BinaryState> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const install = !ctx.decision.sameBinary;
  const installed = existsSync(p.binary);
  return {
    install,
    keepPrev: install && installed && (!existsSync(p.prev) || (await servesBinary(host))),
    link: linkState(host),
    download: downloadPath(host),
    ...srcEntries(host),
    makeDataDir: !existsSync(p.dataDir),
    blocker: install ? blockerOf(host) : null,
    preview: install && ctx.args.dryRun ? await previewVerify(ctx, host.selfPath) : null,
  };
}

function plan(ctx: InitContext, s: BinaryState): PlanLine[] {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const lines: PlanLine[] = [];
  if (s.blocker)
    lines.push({ kind: "error", text: s.blocker, hint: "kosongkan ruang atau unduh binary rilis Android" });
  if (s.preview) lines.push(s.preview);
  if (s.install) {
    const old = ctx.decision.installed.version;
    const prev = s.keepPrev ? ` (${old ? `v${old}` : "yang lama"} disimpan sebagai panel.prev)` : "";
    lines.push({
      kind: "action",
      text: existsSync(p.binary)
        ? `Mengganti ~/panel/panel dengan v${SELF_VERSION}${prev}`
        : `Memasang panel ke ~/panel/panel${s.link === "create" ? " (perintah: panel)" : ""}`,
    });
  }
  if (s.link === "create" && !(s.install && !existsSync(p.binary)))
    lines.push({ kind: "action", text: `Membuat perintah panel (${binLink(host)} → ~/panel/panel)` });
  if (s.link === "foreign")
    lines.push({
      kind: "warning",
      text: `${binLink(host)} sudah ada dan bukan milik panel; tidak diubah`,
      hint: "pakai ~/panel/panel, atau hapus file itu lalu jalankan lagi panel init",
    });
  if (s.download) lines.push({ kind: "action", text: `Menghapus file unduhan ${tilde(host, s.download)}` });
  if (s.prune.length > 0)
    lines.push({
      kind: "action",
      text: `Menghapus unduhan lama di ~/panel-src: ${s.prune.map((f) => f.slice(srcDir(host).length + 1)).join(", ")}`,
    });
  if (s.makeDataDir) lines.push({ kind: "action", text: "Membuat folder data ~/panel/data (hanya untuk kamu)" });
  return lines;
}

/** panel.new → fsync → self check (fail: panel.new and a just-made ~/panel removed) → panel.prev → panel. */
async function installSelf(ctx: InitContext, s: BinaryState): Promise<void> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const next = join(host.paths.panelDir, "panel.new");
  const madeDir = !existsSync(host.paths.panelDir);
  step(`menyalin binary ke ${next}`, () => {
    mkdirSync(host.paths.panelDir, { recursive: true, mode: 0o700 });
    copyFileSync(host.selfPath, next);
    chmodSync(next, 0o755);
    fsyncPath(next);
  });
  try {
    await verifyInstall(ctx, next);
  } catch (e) {
    rmSync(next, { force: true });
    if (madeDir) rmdirSync(host.paths.panelDir);
    throw e;
  }
  if (s.keepPrev && existsSync(p.binary)) {
    const prevNew = `${p.prev}.new`;
    step(`menyimpan ${p.binary} sebagai ${p.prev}`, () => {
      rmSync(prevNew, { force: true });
      linkSync(p.binary, prevNew);
      renameSync(prevNew, p.prev);
      fsyncPath(host.paths.panelDir);
    });
    ctx.state.changed.push(p.prev);
  }
  step(`memasang ${p.binary}`, () => {
    renameSync(next, p.binary);
    fsyncPath(host.paths.panelDir);
  });
  ctx.state.changed.push(p.binary);
}

async function apply(ctx: InitContext, s: BinaryState): Promise<void> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  if (s.blocker)
    throw new CliExit(INIT_EXIT.failed, `${s.blocker}.`, "kosongkan ruang atau unduh binary rilis Android");
  if (s.install) await installSelf(ctx, s);
  if (s.makeDataDir) {
    step(`membuat ${p.dataDir}`, () => mkdirSync(p.dataDir, { recursive: true, mode: 0o700 }));
    ctx.state.changed.push(p.dataDir);
  }
  if (s.link === "create") {
    const link = binLink(host);
    step(`membuat ${link}`, () => {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(p.binary, link);
    });
    ctx.state.changed.push(link);
  }
  if (s.download) {
    const file = s.download;
    step(`menghapus file unduhan ${file}`, () => rmSync(file, { force: true }));
    ctx.state.changed.push(file);
  }
  for (const dir of s.prune) {
    step(`menghapus ${dir}`, () => rmSync(dir, { recursive: true, force: true }));
    ctx.state.changed.push(dir);
  }
  for (const name of s.stray) ctx.state.manual.push(`~/panel-src/${name} tidak dipakai lagi; hapus bila tidak perlu`);
}

/** Step 1 `binary` (§4.1). */
export const binaryStep = defineStep<BinaryState>({
  id: "binary",
  title: INIT_STEP_TITLES.binary,
  detect,
  plan,
  apply,
});
