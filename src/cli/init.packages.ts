// Init step 2 "packages" (PLAN/07 §4.1 row 2, K7, K8, D9, C20, lab L8): installs only what is missing. A fresh phone
// without PostgreSQL gets `pkg upgrade` first (confirmRisky); everywhere else `LC_ALL=C apt-get -s install` runs first
// and an install that would replace cloudflared/postgresql/nodejs* is refused. That simulation in apply follows one
// `apt-get update` (lists only, never upgrades: `pkg update` would also upgrade), so it sees what `pkg install` will
// fetch; detect's simulation (stale lists, detect never writes) is only the plan's preview. Never `--reinstall` (hold
// does not stop it, L8). Every apt/dpkg/pkg child runs with LC_ALL=C; SVDIR/LOGDIR come from CliHost.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TermuxExecError } from "../server/exec/termux.exec";
import { probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { dpkgState, HELD_PACKAGES } from "./doctor.probe";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

/** pm2 version init installs (K8). */
export const PM2_VERSION = "7.1.2";
/** Packages an install may never replace (D9): a jump here breaks the tunnel, the database or the sites. */
const NO_REPLACE = /^(cloudflared|postgresql|nodejs.*)$/;
/** Lab L8 parser: `Inst <pkg> [<installed>] (<new> …`; `[…]` present = an installed package gets replaced. */
export const APT_INST_RE = /^Inst (\S+)(?: \[([^\]]+)\])? \((\S+) /;
/** dpkg must keep existing config files and never ask (K7). */
const DPKG_OPTS = ["-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"];
const DOCS = "lihat: panel docs paket";

/** Result of `apt-get -s install`: packages that would be new, and installed ones that would be replaced. */
export type AptSimulation = { added: string[]; replaced: string[] };

/** Parses `LC_ALL=C apt-get -s install …` stdout; only `^Inst ` lines count (L8). */
export function parseAptSimulation(stdout: string): AptSimulation {
  const sim: AptSimulation = { added: [], replaced: [] };
  for (const line of stdout.split("\n")) {
    const m = APT_INST_RE.exec(line);
    if (m?.[1]) (m[2] ? sim.replaced : sim.added).push(m[1]);
  }
  return sim;
}

/** What the packages step found on the phone. */
export type PackagesState = {
  /** `dpkg --audit` stdout, trimmed ("" = clean, L8). */
  audit: string;
  /** apt packages to install, in install order. */
  missing: string[];
  pm2: boolean;
  /** HELD_PACKAGES installed (or about to be) without a hold. */
  unheld: string[];
  /** Fresh phone and no PostgreSQL (PG_VERSION or the package): `pkg upgrade` is allowed (C20). */
  upgrade: boolean;
  /** Simulation of installing `missing` (only when not upgrading); null = apt-get could not answer. */
  sim: AptSimulation | null;
};

const pkgList = (names: readonly string[]) => names.join(", ");

/** doctor's dpkg state (`hold ok installed` counts; half-installed = not installed, pkg install finishes it). */
const installed = async (ctx: InitContext, pkg: string) => (await dpkgState(ctx.host, pkg)) === "installed";

/** stdout of a read-only probe; a failed or missing tool throws with the command (it is needed to decide). */
async function probe(ctx: InitContext, tool: string, args: string[]): Promise<string> {
  const r = await ctx.host.exec(tool, args, { lcAllC: true });
  if (r.code !== 0) throw new CliExit(INIT_EXIT.failed, `${tool} ${args.join(" ")} gagal (kode ${r.code}).`, DOCS);
  return r.stdout;
}

async function simulate(ctx: InitContext, missing: string[]): Promise<AptSimulation | null> {
  try {
    const r = await ctx.host.exec("apt-get", ["-s", "install", ...missing], { lcAllC: true, timeoutMs: 60_000 });
    return r.code === 0 ? parseAptSimulation(r.stdout) : null;
  } catch (e) {
    if (e instanceof TermuxExecError) return null; // no apt-get / timeout: apply refuses, plan says so
    throw e;
  }
}

/** Packages this run needs (K8: any node is fine; openssh only for --ssh-key). */
function wanted(ctx: InitContext): string[] {
  const { args } = ctx;
  const p = probePaths(ctx.host.paths);
  return [
    "termux-services",
    ...(existsSync(p.node) ? [] : ["nodejs-lts"]),
    ...(args.skip.has("postgres") ? [] : ["postgresql"]),
    ...(args.skip.has("tunnel") ? [] : ["cloudflared"]),
    "termux-api",
    ...(args.sshKey ? ["openssh"] : []),
  ];
}

async function detect(ctx: InitContext): Promise<PackagesState> {
  const p = probePaths(ctx.host.paths);
  const want = wanted(ctx);
  const have = await Promise.all(want.map((n) => installed(ctx, n)));
  const missing = want.filter((_, i) => !have[i]);
  const [audit, holds, pgInstalled] = await Promise.all([
    probe(ctx, "dpkg", ["--audit"]),
    probe(ctx, "apt-mark", ["showhold"]),
    installed(ctx, "postgresql"),
  ]);
  const held = holds.split("\n").map((l) => l.trim());
  const willHave = new Set([...want.filter((_, i) => have[i]), ...missing]);
  if (pgInstalled) willHave.add("postgresql");
  const upgrade = ctx.mode === "fresh" && !pgInstalled && !existsSync(p.pgVersion);
  return {
    audit: audit.trim(),
    missing,
    pm2: !existsSync(p.pm2Runtime),
    unheld: HELD_PACKAGES.filter((n) => willHave.has(n) && !held.includes(n)),
    upgrade,
    sim: missing.length > 0 && !upgrade ? await simulate(ctx, missing) : null,
  };
}

const configureCmd = "dpkg --configure -a --force-confdef --force-confold";
const installCmd = (missing: string[]) => `pkg install ${missing.join(" ")}`;

function plan(ctx: InitContext, s: PackagesState): PlanLine[] {
  const lines: PlanLine[] = [];
  if (s.audit && ctx.mode === "fresh")
    lines.push({ kind: "action", text: `Menyelesaikan pemasangan paket yang terputus (${configureCmd})` });
  else if (s.audit) {
    lines.push({ kind: "action", text: "Memeriksa pemasangan paket yang terputus (harus diperbaiki manual dulu)" });
    lines.push({ kind: "error", text: "Pemasangan paket sebelumnya terputus", hint: `jalankan: ${configureCmd}` });
  }
  if (s.missing.length > 0) {
    const list = pkgList(s.missing);
    lines.push({
      kind: "action",
      text: s.upgrade ? `Memperbarui paket Termux (pkg upgrade), lalu memasang: ${list}` : `Memasang: ${list}`,
    });
    if (!s.upgrade) lines.push({ kind: "action", text: "Memperbarui daftar paket (apt-get update) sebelum memeriksa" });
    if (!s.upgrade && s.sim === null)
      lines.push({ kind: "warning", text: "Simulasi apt-get gagal: daftar paket belum bisa diperiksa", hint: DOCS });
    const bad = s.sim?.replaced.filter((n) => NO_REPLACE.test(n)) ?? [];
    if (bad.length > 0)
      lines.push({
        kind: "error",
        text: `Pemasangan akan mengganti ${pkgList(bad)}; init tidak melakukannya`,
        hint: `baca panel docs paket, lalu bila yakin: ${installCmd(s.missing)}`,
      });
    else if (s.sim?.replaced.length)
      lines.push({ kind: "warning", text: `Pemasangan juga memperbarui paket terpasang: ${pkgList(s.sim.replaced)}` });
  }
  if (s.unheld.length > 0)
    lines.push({
      kind: "action",
      text: `Menahan ${s.unheld.join(" dan ")} dari upgrade otomatis (apt-mark hold; lihat panel docs paket)`,
    });
  if (s.pm2) lines.push({ kind: "action", text: `Memasang pm2 ${PM2_VERSION} (npm)` });
  return lines;
}

/** Runs a visible, SIGINT-guarded pkg/apt/npm command; non-zero exit = exit 1 naming `what`. */
async function runOrFail(ctx: InitContext, what: string, tool: string, args: string[]): Promise<void> {
  const env = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
  const code = await ctx.guardSigint(() => ctx.host.run(tool, args, { env, lcAllC: true }));
  if (code !== 0)
    throw new CliExit(
      INIT_EXIT.failed,
      `${what} gagal (${tool} keluar dengan kode ${code}).`,
      `${DOCS}; lalu ulangi ${ctx.resumeCommand()}`,
    );
}

/**
 * Before a plain install: refresh the lists once, simulate again (detect's simulation saw stale lists), refuse
 * replacing cloudflared/postgresql/nodejs*, confirm any other replacement (K7). Installs stay per package, so a
 * failure names the package.
 */
async function guardSimulation(ctx: InitContext, s: PackagesState): Promise<void> {
  await runOrFail(ctx, "Memperbarui daftar paket (apt-get update)", "apt-get", ["update"]);
  const sim = await simulate(ctx, s.missing);
  const manual = installCmd(s.missing);
  if (sim === null)
    throw new CliExit(
      INIT_EXIT.failed,
      `Simulasi pemasangan ${pkgList(s.missing)} gagal (apt-get -s).`,
      `cek internet dan ${DOCS}, lalu ulangi ${ctx.resumeCommand()}`,
    );
  const bad = sim.replaced.filter((n) => NO_REPLACE.test(n));
  if (bad.length > 0)
    throw new CliExit(
      INIT_EXIT.needsUser,
      `Memasang ${pkgList(s.missing)} akan ikut mengganti ${pkgList(bad)}; init tidak melakukannya.`,
      `baca panel docs paket, lalu bila yakin: ${manual}`,
    );
  if (sim.replaced.length > 0) {
    const go = await ctx.confirmRisky(
      "apt-replace",
      `Memasang ${pkgList(s.missing)} juga memperbarui paket terpasang: ${pkgList(sim.replaced)}. Lanjutkan?`,
      manual,
    );
    if (!go) throw new CliExit(INIT_EXIT.cancelled, "Pemasangan paket dibatalkan, tidak ada paket yang diubah.");
  }
}

async function apply(ctx: InitContext, s: PackagesState): Promise<void> {
  const { prefix } = ctx.host.paths;
  if (s.audit) {
    if (ctx.mode !== "fresh")
      throw new CliExit(
        INIT_EXIT.needsUser,
        "Pemasangan paket sebelumnya terputus; init tidak memperbaikinya di HP yang sudah berisi data.",
        `jalankan: ${configureCmd}, lalu ${ctx.resumeCommand()}`,
      );
    await runOrFail(ctx, "Menyelesaikan pemasangan paket yang terputus", "dpkg", [
      "--configure",
      "-a",
      "--force-confdef",
      "--force-confold",
    ]);
  }
  if (s.missing.length > 0) {
    // C20: re-checked by the fresh detect right before apply; declined upgrade falls back to the guarded install
    const upgrade =
      s.upgrade &&
      (await ctx.confirmRisky(
        "pkg-upgrade",
        "Perbarui semua paket Termux dulu (pkg upgrade)?",
        `pkg upgrade, lalu ${ctx.resumeCommand()}`,
      ));
    if (upgrade) await runOrFail(ctx, "Memperbarui paket Termux (pkg upgrade)", "pkg", ["upgrade", "-y", ...DPKG_OPTS]);
    else await guardSimulation(ctx, s);
    for (const name of s.missing)
      await runOrFail(ctx, `Memasang paket ${name}`, "pkg", ["install", "-y", ...DPKG_OPTS, name]);
    ctx.state.changed.push(`${prefix} (paket: ${pkgList(s.missing)})`);
  }
  if (s.pm2) {
    await runOrFail(ctx, `Memasang pm2 ${PM2_VERSION}`, "npm", ["install", "-g", `pm2@${PM2_VERSION}`]);
    ctx.state.changed.push(join(prefix, "lib", "node_modules", "pm2"));
  }
  ctx.host.resetSystem(); // K13: adapters must see the tools installed above
  const after = await detect(ctx);
  if (after.missing.length > 0)
    throw new CliExit(
      INIT_EXIT.failed,
      `Paket ${pkgList(after.missing)} belum terpasang setelah pkg install.`,
      `${DOCS}; lalu ulangi ${ctx.resumeCommand()}`,
    );
  if (after.pm2) throw new CliExit(INIT_EXIT.failed, "pm2 belum terpasang setelah npm install.", DOCS);
  if (after.unheld.length > 0) {
    await runOrFail(ctx, `Menahan ${after.unheld.join(" dan ")}`, "apt-mark", ["hold", ...after.unheld]);
    ctx.out.line(`Ditahan: ${after.unheld.join(", ")} (pkg upgrade tidak akan menaikkannya; lihat panel docs paket).`);
    ctx.state.changed.push(`${join(prefix, "var", "lib", "dpkg", "status")} (hold: ${after.unheld.join(" ")})`);
  }
}

/** Step 2: Termux packages, pm2 and holds. */
export const packagesStep = defineStep<PackagesState>({
  id: "packages",
  title: INIT_STEP_TITLES.packages,
  detect,
  plan,
  apply,
});
