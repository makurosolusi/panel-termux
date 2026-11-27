// Init step 2 "packages" (PLAN/07 §4.1 row 2, K7, K8, D9, C20, lab L8): installs only what is missing. A fresh phone
// without PostgreSQL gets `pkg upgrade` first (confirmRisky); everywhere else `LC_ALL=C apt-get -s install` runs first
// and an install that would replace cloudflared/postgresql/nodejs* is refused. That simulation in apply follows one
// `apt-get update` (lists only, never upgrades: `pkg update` would also upgrade), so it sees what `pkg install` will
// fetch; detect's simulation (stale lists, detect never writes) is only the plan's preview. Never `--reinstall` (hold
// does not stop it, L8). Every apt/dpkg/pkg child runs with LC_ALL=C; SVDIR/LOGDIR come from CliHost.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { dpkgState, HELD_PACKAGES } from "./doctor.probe";
import {
  type AptSimulation,
  guardSimulation,
  installCmd,
  NO_REPLACE,
  pkgList,
  retryHint,
  runOrFail,
  simulate,
  sureHint,
} from "./init.packages.apt";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

/** pm2 version init installs (K8). */
export const PM2_VERSION = "7.1.2";
/** dpkg must keep existing config files and never ask (K7). */
const DPKG_OPTS = ["-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"];
const docs = () => tr("see: panel docs packages", "lihat: panel docs packages");

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

/** doctor's dpkg state (`hold ok installed` counts; half-installed = not installed, pkg install finishes it). */
const installed = async (ctx: InitContext, pkg: string) => (await dpkgState(ctx.host, pkg)) === "installed";

/** stdout of a read-only probe; a failed or missing tool throws with the command (it is needed to decide). */
async function probe(ctx: InitContext, tool: string, args: string[]): Promise<string> {
  const r = await ctx.host.exec(tool, args, { lcAllC: true });
  const cmd = `${tool} ${args.join(" ")}`;
  if (r.code !== 0)
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`${cmd} failed (code ${r.code}).`, `${cmd} gagal (kode ${r.code}).`),
      docs(),
    );
  return r.stdout;
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

function plan(ctx: InitContext, s: PackagesState): PlanLine[] {
  const lines: PlanLine[] = [];
  if (s.audit && ctx.mode === "fresh")
    lines.push({
      kind: "action",
      text: tr(
        `Finishing an interrupted package install (${configureCmd})`,
        `Menyelesaikan pemasangan paket yang terputus (${configureCmd})`,
      ),
    });
  else if (s.audit) {
    lines.push({
      kind: "action",
      text: tr(
        "Checking an interrupted package install (it must be fixed by hand first)",
        "Memeriksa pemasangan paket yang terputus (harus diperbaiki manual dulu)",
      ),
    });
    lines.push({
      kind: "error",
      text: tr("An earlier package install was interrupted", "Pemasangan paket sebelumnya terputus"),
      hint: tr(`run: ${configureCmd}`, `jalankan: ${configureCmd}`),
    });
  }
  if (s.missing.length > 0) {
    const list = pkgList(s.missing);
    lines.push({
      kind: "action",
      text: s.upgrade
        ? tr(
            `Updating Termux packages (pkg upgrade), then installing: ${list}`,
            `Memperbarui paket Termux (pkg upgrade), lalu memasang: ${list}`,
          )
        : tr(`Installing: ${list}`, `Memasang: ${list}`),
    });
    if (!s.upgrade)
      lines.push({
        kind: "action",
        text: tr(
          "Updating the package lists (apt-get update) before checking",
          "Memperbarui daftar paket (apt-get update) sebelum memeriksa",
        ),
      });
    if (!s.upgrade && s.sim === null)
      lines.push({
        kind: "warning",
        text: tr(
          "The apt-get simulation failed: the package lists cannot be checked yet",
          "Simulasi apt-get gagal: daftar paket belum bisa diperiksa",
        ),
        hint: docs(),
      });
    const bad = s.sim?.replaced.filter((n) => NO_REPLACE.test(n)) ?? [];
    if (bad.length > 0)
      lines.push({
        kind: "error",
        text: tr(
          `The install would replace ${pkgList(bad)}; init does not do that`,
          `Pemasangan akan mengganti ${pkgList(bad)}; init tidak melakukannya`,
        ),
        hint: sureHint(installCmd(s.missing)),
      });
    else if (s.sim?.replaced.length) {
      const replaced = pkgList(s.sim.replaced);
      lines.push({
        kind: "warning",
        text: tr(
          `The install also updates installed packages: ${replaced}`,
          `Pemasangan juga memperbarui paket terpasang: ${replaced}`,
        ),
      });
    }
  }
  if (s.unheld.length > 0)
    lines.push({
      kind: "action",
      text: tr(
        `Holding ${s.unheld.join(" and ")} back from automatic upgrades (apt-mark hold; see panel docs packages)`,
        `Menahan ${s.unheld.join(" dan ")} dari upgrade otomatis (apt-mark hold; lihat panel docs packages)`,
      ),
    });
  if (s.pm2)
    lines.push({
      kind: "action",
      text: tr(`Installing pm2 ${PM2_VERSION} (npm)`, `Memasang pm2 ${PM2_VERSION} (npm)`),
    });
  return lines;
}

async function apply(ctx: InitContext, s: PackagesState): Promise<void> {
  const { prefix } = ctx.host.paths;
  if (s.audit) {
    if (ctx.mode !== "fresh")
      throw new CliExit(
        INIT_EXIT.needsUser,
        tr(
          "An earlier package install was interrupted; init does not fix it on a phone that already holds data.",
          "Pemasangan paket sebelumnya terputus; init tidak memperbaikinya di HP yang sudah berisi data.",
        ),
        tr(
          `run: ${configureCmd}, then ${ctx.resumeCommand()}`,
          `jalankan: ${configureCmd}, lalu ${ctx.resumeCommand()}`,
        ),
      );
    await runOrFail(
      ctx,
      tr("Finishing the interrupted package install", "Menyelesaikan pemasangan paket yang terputus"),
      "dpkg",
      ["--configure", "-a", "--force-confdef", "--force-confold"],
    );
  }
  if (s.missing.length > 0) {
    // C20: re-checked by the fresh detect right before apply; declined upgrade falls back to the guarded install
    const upgrade =
      s.upgrade &&
      (await ctx.confirmRisky(
        "pkg-upgrade",
        tr("Update all Termux packages first (pkg upgrade)?", "Perbarui semua paket Termux dulu (pkg upgrade)?"),
        tr(`pkg upgrade, then ${ctx.resumeCommand()}`, `pkg upgrade, lalu ${ctx.resumeCommand()}`),
      ));
    if (upgrade)
      await runOrFail(
        ctx,
        tr("Updating Termux packages (pkg upgrade)", "Memperbarui paket Termux (pkg upgrade)"),
        "pkg",
        ["upgrade", "-y", ...DPKG_OPTS],
      );
    else await guardSimulation(ctx, s);
    for (const name of s.missing)
      await runOrFail(ctx, tr(`Installing package ${name}`, `Memasang paket ${name}`), "pkg", [
        "install",
        "-y",
        ...DPKG_OPTS,
        name,
      ]);
    ctx.state.changed.push(`${prefix} (${tr("packages", "paket")}: ${pkgList(s.missing)})`);
  }
  if (s.pm2) {
    await runOrFail(ctx, tr(`Installing pm2 ${PM2_VERSION}`, `Memasang pm2 ${PM2_VERSION}`), "npm", [
      "install",
      "-g",
      `pm2@${PM2_VERSION}`,
    ]);
    ctx.state.changed.push(join(prefix, "lib", "node_modules", "pm2"));
  }
  ctx.host.resetSystem(); // K13: adapters must see the tools installed above
  const after = await detect(ctx);
  if (after.missing.length > 0) {
    const left = pkgList(after.missing);
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`Package ${left} is not installed after pkg install.`, `Paket ${left} belum terpasang setelah pkg install.`),
      retryHint(ctx),
    );
  }
  if (after.pm2)
    throw new CliExit(
      INIT_EXIT.failed,
      tr("pm2 is not installed after npm install.", "pm2 belum terpasang setelah npm install."),
      docs(),
    );
  if (after.unheld.length > 0) {
    await runOrFail(
      ctx,
      tr(`Holding ${after.unheld.join(" and ")}`, `Menahan ${after.unheld.join(" dan ")}`),
      "apt-mark",
      ["hold", ...after.unheld],
    );
    const held = after.unheld.join(", ");
    ctx.out.line(
      tr(
        `Held: ${held} (pkg upgrade will not upgrade them; see panel docs packages).`,
        `Ditahan: ${held} (pkg upgrade tidak akan menaikkannya; lihat panel docs packages).`,
      ),
    );
    ctx.state.changed.push(`${join(prefix, "var", "lib", "dpkg", "status")} (hold: ${after.unheld.join(" ")})`);
  }
}

/** Step 2: Termux packages, pm2 and holds. */
export const packagesStep = defineStep<PackagesState>({
  id: "packages",
  detect,
  plan,
  apply,
});
