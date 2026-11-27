// panel init (PLAN/07 §4): detect → plan → confirm → run steps → summary. Owns step 0 (lock, arch, mode), the one
// rule of which step may change the phone in which mode/TTY (§4 mode table, K9, K21, C22, C23) and the exit codes.
// Steps (init.types.ts contract) recompute their state from the phone, so a rerun resumes without a state file (m6).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliHost, probePaths } from "./cli.host";
import type { CliIo, Command, ParsedArgs } from "./cli.main";
import { CliExit } from "./cli.output";
import { binaryStep } from "./init.binary";
import { bootStep } from "./init.boot";
import { envStep } from "./init.env";
import { detectMode, SELF_VERSION } from "./init.mode";
import { packagesStep } from "./init.packages";
import { panelSvStep } from "./init.panel-sv";
import { allowed, hasAction, type Planned, type Policy, printPlan, summary, tilde } from "./init.plan";
import { pm2Step } from "./init.pm2";
import { postgresStep } from "./init.postgres";
import { runitStep } from "./init.runit";
import { sshStep } from "./init.ssh";
import { startStep } from "./init.start";
import { tunnelStep } from "./init.tunnel";
import {
  INIT_EXIT,
  INIT_SKIPPABLE,
  type InitArgs,
  type InitContext,
  type InitMode,
  type InitSkippable,
  type InitStep,
  type InitStepId,
} from "./init.types";

/** Test knobs: the step list (default INIT_STEPS). */
export type InitOpts = { steps?: readonly InitStep[] };

const POLICY: Record<InitStepId, Record<InitMode, Policy>> = {
  binary: { fresh: "run", repair: "run", upgrade: "run" },
  packages: { fresh: "run", repair: "tty", upgrade: "report" },
  runit: { fresh: "run", repair: "run", upgrade: "report" },
  ssh: { fresh: "run", repair: "run", upgrade: "report" },
  postgres: { fresh: "run", repair: "tty", upgrade: "report" },
  env: { fresh: "run", repair: "run", upgrade: "report" },
  "panel-sv": { fresh: "run", repair: "run", upgrade: "run" }, // upgrade: only a known old run script (C23)
  pm2: { fresh: "run", repair: "run", upgrade: "report" },
  tunnel: { fresh: "run", repair: "run", upgrade: "report" },
  boot: { fresh: "run", repair: "tty", upgrade: "report" },
  start: { fresh: "run", repair: "run", upgrade: "run" },
};
/** Steps the flags leave out entirely (not even planned). */
const LEFT_OUT: Partial<Record<InitStepId, (a: InitArgs) => boolean>> = {
  ssh: (a) => a.sshKey === null,
  postgres: (a) => a.skip.has("postgres"),
  tunnel: (a) => a.skip.has("tunnel"),
  boot: (a) => a.skip.has("boot"),
};

/** The steps in run order (§4.1). */
export const INIT_STEPS: readonly InitStep[] = [
  binaryStep,
  packagesStep,
  runitStep,
  sshStep,
  postgresStep,
  envStep,
  panelSvStep,
  pm2Step,
  tunnelStep,
  bootStep,
  startStep,
];

const usage = (message: string) => new CliExit(INIT_EXIT.usage, message, "lihat: panel init --help");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

/** Flags → InitArgs; bad values are usage errors (exit 2) before the phone is looked at. */
export function parseInitArgs(values: ParsedArgs["values"]): InitArgs {
  const skip = list(values.skip);
  const bad = skip.find((s) => !(INIT_SKIPPABLE as readonly string[]).includes(s));
  if (bad !== undefined) throw usage(`Nilai --skip tidak dikenal: ${bad} (pilihan: ${INIT_SKIPPABLE.join(", ")})`);
  const sshKey = typeof values["ssh-key"] === "string" ? values["ssh-key"] : null;
  if (sshKey === "") throw usage("--ssh-key kosong: beri URL https://, path file, atau - (stdin)");
  if (sshKey !== null && /^http:\/\//i.test(sshKey))
    throw usage("--ssh-key tidak menerima http://: pakai https://, path file, atau - (stdin)");
  return {
    yes: values.yes === true,
    dryRun: values["dry-run"] === true,
    skipVerify: values["skip-verify"] === true,
    sshKey,
    hostname: typeof values.hostname === "string" ? values.hostname : null,
    adminEmails: list(values["admin-email"]),
    skip: new Set(skip as InitSkippable[]),
  };
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;

/** pid in a lock file still runs `init` (m7: dead pid, or a reused pid running something else, = stale). */
function lockHeld(host: CliHost, pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || !host.proc.alive(pid)) return false;
  return host.proc.list().some((p) => p.pid === pid && p.cmdline.includes("init"));
}

/** `$PREFIX/tmp/panel-init.lock` (O_EXCL, holds our pid; outside $HOME, C20). Returns an idempotent release. */
export function acquireLock(host: CliHost): () => void {
  const file = join(host.paths.prefix, "tmp", "panel-init.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, `${host.proc.selfPid}\n`);
      } finally {
        closeSync(fd);
      }
      let held = true;
      return () => {
        if (held) rmSync(file, { force: true });
        held = false;
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST")
        throw new CliExit(INIT_EXIT.failed, `Gagal membuat lock ${file}: ${errCode(e)}.`);
    }
    const pid = Number(readFileSync(file, "utf8").trim());
    if (lockHeld(host, pid))
      throw new CliExit(
        INIT_EXIT.failed,
        `panel init lain sedang berjalan (pid ${pid}).`,
        `tunggu sampai selesai; bila tidak ada yang berjalan: rm ${file}`,
      );
    rmSync(file, { force: true }); // stale (m7)
  }
  throw new CliExit(INIT_EXIT.failed, `Gagal membuat lock ${file}: dibuat ulang proses lain.`, "ulangi panel init");
}

/** m8: `panel init` when $PREFIX/bin/panel resolves to ~/panel/panel, else the installed binary, else this file. */
function resumeCommand(host: CliHost): string {
  const binary = probePaths(host.paths).binary;
  const link = join(host.paths.prefix, "bin", "panel");
  if (existsSync(link) && existsSync(binary) && realpathSync(link) === realpathSync(binary)) return "panel init";
  return `${tilde(host, existsSync(binary) ? binary : host.selfPath)} init`;
}

/** `panel init` with test knobs; see the file header. */
export async function runInit(parsed: ParsedArgs, io: CliIo, opts: InitOpts = {}): Promise<number> {
  const args = parseInitArgs(parsed.values);
  const { out } = io;
  const host = await io.host();
  const tty = host.tty.isTty;
  if (args.skipVerify && !tty)
    throw usage("--skip-verify hanya bisa dipakai di terminal (butuh jawaban y), tidak dengan pipa atau ssh tanpa -t");
  if (host.arch !== "arm64")
    throw new CliExit(INIT_EXIT.failed, `Prosesor HP ini ${host.arch}; panel butuh arm64 (64-bit).`);
  const release = args.dryRun ? () => {} : acquireLock(host);
  let guarded = 0;
  let warned = false;
  const onSigint = () => {
    if (guarded > 0 && !warned) {
      warned = true;
      out.note("ℹ️ Menunggu pkg selesai; tekan Ctrl-C sekali lagi untuk memaksa berhenti.");
      return;
    }
    release();
    process.exit(INIT_EXIT.interrupted);
  };
  if (!args.dryRun) process.on("SIGINT", onSigint);
  try {
    const decision = await detectMode(host);
    out.line(`Panel Termux ${SELF_VERSION} — penyiapan HP${args.dryRun ? " (--dry-run: tidak ada yang diubah)" : ""}`);
    out.line();
    if (decision.mode === "downgrade")
      throw new CliExit(
        INIT_EXIT.needsUser,
        `Binary ini v${SELF_VERSION}, lebih lama dari panel yang terpasang (v${decision.installed.version}).`,
        "untuk kembali ke versi sebelumnya: panel rollback [--db]",
      );
    const mode = decision.mode;
    const ctx: InitContext = {
      host,
      args,
      mode,
      decision,
      out,
      tty,
      prompt: host.tty,
      state: { changed: [], manual: [] },
      resumeCommand: () => resumeCommand(host),
      guardSigint: async (fn) => {
        guarded++;
        try {
          return await fn();
        } finally {
          guarded--;
          warned = false;
        }
      },
      async confirmRisky(action, question, manual) {
        const ask = (defaultYes: boolean) => host.tty.confirm(question, defaultYes);
        if (action === "restart-panel") {
          if (mode !== "upgrade") return false; // K9: repair/fresh never restart a running panel
          if (args.yes) return true;
          if (tty) return ask(true);
        } else if (action === "pkg-upgrade") {
          if (mode === "fresh" && args.yes) return true;
          if (tty) return ask(true);
        } else if (tty) return ask(false); // --yes never answers these (K9, C19, K19)
        if (action === "skip-verify") throw usage("--skip-verify hanya bisa dipakai di terminal");
        throw new CliExit(INIT_EXIT.needsUser, `Butuh jawaban di terminal: ${question}`, `jalankan: ${manual}`);
      },
    };
    const planned: Planned[] = [];
    for (const step of opts.steps ?? INIT_STEPS) {
      if (LEFT_OUT[step.id]?.(args)) continue;
      planned.push({ step, policy: POLICY[step.id][mode], lines: step.plan(ctx, await step.detect(ctx)) });
    }
    printPlan(ctx, planned);
    if (args.dryRun) return INIT_EXIT.ok;
    const todo = planned.filter((p) => allowed(p.policy, tty) && hasAction(p.lines));
    if (todo.length === 0) {
      out.line("Tidak ada yang perlu diubah.");
      return INIT_EXIT.ok;
    }
    // The plan question (§4.1): --yes answers it, a TTY asks [Y/n], neither = exit 3.
    if (!args.yes && !tty)
      throw new CliExit(
        INIT_EXIT.needsUser,
        "panel init butuh konfirmasi, tapi tidak ada terminal.",
        `jalankan di terminal, atau: ${ctx.resumeCommand()} --yes`,
      );
    if (!args.yes && !(await host.tty.confirm("Lanjutkan?", true))) {
      out.line("Dibatalkan, tidak ada yang diubah.");
      return INIT_EXIT.cancelled;
    }
    for (const { step } of todo) {
      const state = await step.detect(ctx); // fresh: an earlier step may have done part of it
      if (!hasAction(step.plan(ctx, state))) continue;
      out.line();
      out.line(`${step.title.charAt(0).toUpperCase()}${step.title.slice(1)}`);
      await step.apply(ctx, state);
    }
    summary(out, ctx);
    return INIT_EXIT.ok;
  } finally {
    if (!args.dryRun) process.off("SIGINT", onSigint);
    release();
  }
}

/** Dispatcher entry. */
export const initCommand: Command = (args, io) => runInit(args, io);
