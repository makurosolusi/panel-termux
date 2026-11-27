// apt side of init step "packages" (split from init.packages.ts): `apt-get -s install` simulation (lab L8), the
// guard that refuses replacing cloudflared/postgresql/nodejs* (D9), and the SIGINT-guarded package commands.
import { TermuxExecError } from "../server/exec/termux.exec";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import type { PackagesState } from "./init.packages";
import { INIT_EXIT, type InitContext } from "./init.types";

/** Packages an install may never replace (D9): a jump here breaks the tunnel, the database or the sites. */
export const NO_REPLACE = /^(cloudflared|postgresql|nodejs.*)$/;
/** Lab L8 parser: `Inst <pkg> [<installed>] (<new> …`; `[…]` present = an installed package gets replaced. */
export const APT_INST_RE = /^Inst (\S+)(?: \[([^\]]+)\])? \((\S+) /;
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

/** `a, b, c` for messages. */
export const pkgList = (names: readonly string[]) => names.join(", ");
/** "read the docs, then if you are sure: <cmd>". */
export const sureHint = (cmd: string) =>
  tr(`read panel docs packages, then if you are sure: ${cmd}`, `baca panel docs packages, lalu bila yakin: ${cmd}`);
/** "see the docs, then rerun init". */
export const retryHint = (ctx: InitContext) =>
  tr(
    `see: panel docs packages; then run ${ctx.resumeCommand()} again`,
    `lihat: panel docs packages; lalu ulangi ${ctx.resumeCommand()}`,
  );

/** The manual `pkg install` command for `missing`. */
export const installCmd = (missing: string[]) => `pkg install ${missing.join(" ")}`;

/** `apt-get -s install missing`, parsed; null when apt-get cannot answer. */
export async function simulate(ctx: InitContext, missing: string[]): Promise<AptSimulation | null> {
  try {
    const r = await ctx.host.exec("apt-get", ["-s", "install", ...missing], { lcAllC: true, timeoutMs: 60_000 });
    return r.code === 0 ? parseAptSimulation(r.stdout) : null;
  } catch (e) {
    if (e instanceof TermuxExecError) return null; // no apt-get / timeout: apply refuses, plan says so
    throw e;
  }
}

/** Runs a visible, SIGINT-guarded pkg/apt/npm command; non-zero exit = exit 1 naming `what`. */
export async function runOrFail(ctx: InitContext, what: string, tool: string, args: string[]): Promise<void> {
  const env = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
  const code = await ctx.guardSigint(() => ctx.host.run(tool, args, { env, lcAllC: true }));
  if (code !== 0)
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`${what} failed (${tool} exited with code ${code}).`, `${what} gagal (${tool} keluar dengan kode ${code}).`),
      retryHint(ctx),
    );
}

/**
 * Before a plain install: refresh the lists once, simulate again (detect's simulation saw stale lists), refuse
 * replacing cloudflared/postgresql/nodejs*, confirm any other replacement (K7). Installs stay per package, so a
 * failure names the package.
 */
export async function guardSimulation(ctx: InitContext, s: PackagesState): Promise<void> {
  await runOrFail(
    ctx,
    tr("Updating the package lists (apt-get update)", "Memperbarui daftar paket (apt-get update)"),
    "apt-get",
    ["update"],
  );
  const sim = await simulate(ctx, s.missing);
  const manual = installCmd(s.missing);
  const list = pkgList(s.missing);
  if (sim === null)
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`Simulating the install of ${list} failed (apt-get -s).`, `Simulasi pemasangan ${list} gagal (apt-get -s).`),
      tr(
        `check the internet and see panel docs packages, then run ${ctx.resumeCommand()} again`,
        `cek internet dan lihat: panel docs packages, lalu ulangi ${ctx.resumeCommand()}`,
      ),
    );
  const bad = sim.replaced.filter((n) => NO_REPLACE.test(n));
  if (bad.length > 0)
    throw new CliExit(
      INIT_EXIT.needsUser,
      tr(
        `Installing ${list} would also replace ${pkgList(bad)}; init does not do that.`,
        `Memasang ${list} akan ikut mengganti ${pkgList(bad)}; init tidak melakukannya.`,
      ),
      sureHint(manual),
    );
  if (sim.replaced.length > 0) {
    const replaced = pkgList(sim.replaced);
    const go = await ctx.confirmRisky(
      "apt-replace",
      tr(
        `Installing ${list} also updates installed packages: ${replaced}. Continue?`,
        `Memasang ${list} juga memperbarui paket terpasang: ${replaced}. Lanjutkan?`,
      ),
      manual,
    );
    if (!go)
      throw new CliExit(
        INIT_EXIT.cancelled,
        tr(
          "Package install cancelled, no package was changed.",
          "Pemasangan paket dibatalkan, tidak ada paket yang diubah.",
        ),
      );
  }
}
