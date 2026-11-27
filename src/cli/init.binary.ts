// Step 1 of `panel init` (PLAN/07 §4.1, K19, K21, K24, C21, C24, E10, E11, E16): put this binary at ~/panel/panel
// (panel.new → fsync → self check → panel.prev by link or copy (E9) + rename → rename), the `panel` command symlink, then remove
// the download and old ~/panel-src/v<version> folders. Same bytes already installed = no binary write, no check.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fsyncPath, linkOrCopy } from "../shared/file.link";
import { type CliHost, probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { blockerOf, servesBinary } from "./init.binary.checks";
import { downloadPath, srcDir, srcEntries } from "./init.binary.paths";
import { SELF_VERSION } from "./init.mode";
import { tilde } from "./init.plan";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";
import { previewVerify, verifyInstall } from "./init.verify";

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

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const binLink = (host: CliHost) => join(host.paths.prefix, "bin", "panel");

const blockerHint = () =>
  tr("free up space or download the Android release binary", "kosongkan ruang atau unduh binary rilis Android");

/** Runs one filesystem write; failure = exit 1 naming the operation and the errno. */
function step(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`Could not ${what}: ${errCode(e)}.`, `Gagal ${what}: ${errCode(e)}.`),
      tr("check the permissions of ~/panel, then try again", "periksa izin folder ~/panel, lalu ulangi"),
    );
  }
}

function linkState(host: CliHost): BinaryState["link"] {
  const link = binLink(host);
  const st = lstatSync(link, { throwIfNoEntry: false });
  if (!st) return "create";
  if (!st.isSymbolicLink()) return "foreign";
  return resolve(dirname(link), readlinkSync(link)) === probePaths(host.paths).binary ? "ok" : "foreign";
}

async function detect(ctx: InitContext): Promise<BinaryState> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const install = !ctx.decision.sameBinary;
  const keepPrev = install && existsSync(p.binary) && (!existsSync(p.prev) || (await servesBinary(host)));
  return {
    install,
    keepPrev,
    link: linkState(host),
    download: downloadPath(host),
    ...srcEntries(host),
    makeDataDir: !existsSync(p.dataDir),
    blocker: install ? blockerOf(host, keepPrev) : null,
    preview: install && ctx.args.dryRun ? await previewVerify(ctx, host.selfPath) : null,
  };
}

function plan(ctx: InitContext, s: BinaryState): PlanLine[] {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const lines: PlanLine[] = [];
  if (s.blocker) lines.push({ kind: "error", text: s.blocker, hint: blockerHint() });
  if (s.preview) lines.push(s.preview);
  if (s.install) {
    const old = ctx.decision.installed.version;
    const kept = old ? `v${old}` : tr("the old one", "yang lama");
    const prev = s.keepPrev ? tr(` (${kept} kept as panel.prev)`, ` (${kept} disimpan sebagai panel.prev)`) : "";
    const cmd = s.link === "create" ? tr(" (command: panel)", " (perintah: panel)") : "";
    lines.push({
      kind: "action",
      text: existsSync(p.binary)
        ? tr(
            `Replacing ~/panel/panel with v${SELF_VERSION}${prev}`,
            `Mengganti ~/panel/panel dengan v${SELF_VERSION}${prev}`,
          )
        : tr(`Installing the panel to ~/panel/panel${cmd}`, `Memasang panel ke ~/panel/panel${cmd}`),
    });
  }
  if (s.link === "create" && !(s.install && !existsSync(p.binary)))
    lines.push({
      kind: "action",
      text: tr(
        `Creating the panel command (${binLink(host)} → ~/panel/panel)`,
        `Membuat perintah panel (${binLink(host)} → ~/panel/panel)`,
      ),
    });
  if (s.link === "foreign")
    lines.push({
      kind: "warning",
      text: tr(
        `${binLink(host)} already exists and does not belong to the panel; left unchanged`,
        `${binLink(host)} sudah ada dan bukan milik panel; tidak diubah`,
      ),
      hint: tr(
        "use ~/panel/panel, or delete that file and run panel init again",
        "pakai ~/panel/panel, atau hapus file itu lalu jalankan lagi panel init",
      ),
    });
  if (s.download) {
    const file = tilde(host, s.download);
    lines.push({ kind: "action", text: tr(`Deleting the download ${file}`, `Menghapus file unduhan ${file}`) });
  }
  if (s.prune.length > 0) {
    const old = s.prune.map((f) => f.slice(srcDir(host).length + 1)).join(", ");
    lines.push({
      kind: "action",
      text: tr(`Deleting old downloads in ~/panel-src: ${old}`, `Menghapus unduhan lama di ~/panel-src: ${old}`),
    });
  }
  if (s.makeDataDir)
    lines.push({
      kind: "action",
      text: tr(
        "Creating the data folder ~/panel/data (for you only)",
        "Membuat folder data ~/panel/data (hanya untuk kamu)",
      ),
    });
  return lines;
}

/**
 * panel.new (a stale one from a failed run is overwritten) → fsync → self check (fail: panel.new and a just-made
 * ~/panel removed) → panel.prev (link, or fsynced copy on Termux, via panel.prev.new + rename) → panel.
 */
async function installSelf(ctx: InitContext, s: BinaryState): Promise<void> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  const next = join(host.paths.panelDir, "panel.new");
  const madeDir = !existsSync(host.paths.panelDir);
  step(tr(`copy the binary to ${next}`, `menyalin binary ke ${next}`), () => {
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
    step(tr(`keep ${p.binary} as ${p.prev}`, `menyimpan ${p.binary} sebagai ${p.prev}`), () => {
      rmSync(prevNew, { force: true });
      linkOrCopy(p.binary, prevNew, { link: host.link });
      renameSync(prevNew, p.prev);
      fsyncPath(host.paths.panelDir);
    });
    ctx.state.changed.push(p.prev);
  }
  step(tr(`install ${p.binary}`, `memasang ${p.binary}`), () => {
    renameSync(next, p.binary);
    fsyncPath(host.paths.panelDir);
  });
  ctx.state.changed.push(p.binary);
}

async function apply(ctx: InitContext, s: BinaryState): Promise<void> {
  const { host } = ctx;
  const p = probePaths(host.paths);
  if (s.blocker) throw new CliExit(INIT_EXIT.failed, `${s.blocker}.`, blockerHint());
  if (s.install) await installSelf(ctx, s);
  if (s.makeDataDir) {
    step(tr(`create ${p.dataDir}`, `membuat ${p.dataDir}`), () =>
      mkdirSync(p.dataDir, { recursive: true, mode: 0o700 }),
    );
    ctx.state.changed.push(p.dataDir);
  }
  if (s.link === "create") {
    const link = binLink(host);
    step(tr(`create ${link}`, `membuat ${link}`), () => {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(p.binary, link);
    });
    ctx.state.changed.push(link);
  }
  if (s.download) {
    const file = s.download;
    step(tr(`delete the download ${file}`, `menghapus file unduhan ${file}`), () => rmSync(file, { force: true }));
    ctx.state.changed.push(file);
  }
  for (const dir of s.prune) {
    step(tr(`delete ${dir}`, `menghapus ${dir}`), () => rmSync(dir, { recursive: true, force: true }));
    ctx.state.changed.push(dir);
  }
  for (const name of s.stray)
    ctx.state.manual.push(
      tr(
        `~/panel-src/${name} is no longer used; delete it if you do not need it`,
        `~/panel-src/${name} tidak dipakai lagi; hapus bila tidak perlu`,
      ),
    );
}

/** Step 1 `binary` (§4.1). */
export const binaryStep = defineStep<BinaryState>({
  id: "binary",
  detect,
  plan,
  apply,
});
