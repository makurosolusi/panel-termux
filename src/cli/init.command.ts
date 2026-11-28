// panel init (PLAN/07 §4): detect → plan → confirm → run steps → summary. Owns step 0 (lock, arch, mode), the one
// rule of which step may change the phone in which mode/TTY (§4 mode table, K9, K21, C22, C23) and the exit codes.
// Steps (init.types.ts contract) recompute their state from the phone, so a rerun resumes without a state file (m6).
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type CliHost, probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import type { CliIo, Command, ParsedArgs } from "./cli.main";
import { CliExit } from "./cli.output";
import { binaryStep } from "./init.binary";
import { bootStep } from "./init.boot";
import { envStep } from "./init.env";
import { chooseInitLanguage } from "./init.language";
import { acquireLock, setUnfinished } from "./init.lock";
import { detectMode, SELF_VERSION } from "./init.mode";
import { packagesStep } from "./init.packages";
import { panelSvStep } from "./init.panel-sv";
import { allowed, hasAction, type Planned, POLICY, printPlan, summary, tilde } from "./init.plan";
import { pm2Step } from "./init.pm2";
import { postgresStep } from "./init.postgres";
import { runitStep } from "./init.runit";
import { sshBootReady, sshStep } from "./init.ssh";
import { startStep } from "./init.start";
import { tunnelStep } from "./init.tunnel";
import {
  INIT_EXIT,
  INIT_SKIPPABLE,
  type InitArgs,
  type InitContext,
  type InitSkippable,
  type InitStep,
  type InitStepId,
  type PlanLine,
  stepTitle,
} from "./init.types";

/** Test knobs: the step list (default INIT_STEPS). */
export type InitOpts = { steps?: readonly InitStep[] };

/** Steps the flags leave out entirely (not even planned). */
const LEFT_OUT: Partial<Record<InitStepId, (a: InitArgs) => boolean>> = {
  ssh: (a) => a.sshKey === null,
  postgres: (a) => a.skip.has("postgres"),
  tunnel: (a) => a.skip.has("tunnel"),
  boot: (a) => a.skip.has("boot"),
};

/**
 * Steps whose exit 3 (needs a terminal: Cloudflare login, DNS move, cloudflared restart) waits until the run ends:
 * no later step reads what they make, so boot and start still run; init then exits 3 with the step's message.
 */
const DEFERRED_NEEDS_USER: ReadonlySet<InitStepId> = new Set(["tunnel"]);

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

const usage = (message: string) =>
  new CliExit(INIT_EXIT.usage, message, tr("see: panel init --help", "lihat: panel init --help"));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

/** Flags → InitArgs; bad values are usage errors (exit 2) before the phone is looked at. */
export function parseInitArgs(values: ParsedArgs["values"]): InitArgs {
  const skip = list(values.skip);
  const bad = skip.find((s) => !(INIT_SKIPPABLE as readonly string[]).includes(s));
  const choices = INIT_SKIPPABLE.join(", ");
  if (bad !== undefined)
    throw usage(
      tr(
        `Unknown --skip value: ${bad} (choices: ${choices})`,
        `Nilai --skip tidak dikenal: ${bad} (pilihan: ${choices})`,
      ),
    );
  const sshKey = typeof values["ssh-key"] === "string" ? values["ssh-key"] : null;
  if (sshKey === "")
    throw usage(
      tr(
        "--ssh-key is empty: give an https:// URL, a file path or - (stdin)",
        "--ssh-key kosong: beri URL https://, path file, atau - (stdin)",
      ),
    );
  if (sshKey !== null && /^http:\/\//i.test(sshKey))
    throw usage(
      tr(
        "--ssh-key does not accept http://: use https://, a file path or - (stdin)",
        "--ssh-key tidak menerima http://: pakai https://, path file, atau - (stdin)",
      ),
    );
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
    throw usage(
      tr(
        "--skip-verify only works in a terminal (it needs a y answer), not with a pipe or ssh without -t",
        "--skip-verify hanya bisa dipakai di terminal (butuh jawaban y), tidak dengan pipa atau ssh tanpa -t",
      ),
    );
  if (host.arch !== "arm64")
    throw new CliExit(
      INIT_EXIT.failed,
      tr(
        `This phone's processor is ${host.arch}; the panel needs arm64 (64-bit).`,
        `Prosesor HP ini ${host.arch}; panel butuh arm64 (64-bit).`,
      ),
    );
  const release = args.dryRun ? () => {} : acquireLock(host);
  let guarded = 0;
  let warned = false;
  const onSigint = () => {
    if (guarded > 0 && !warned) {
      warned = true;
      out.note(
        tr(
          "ℹ️ Waiting for pkg to finish; press Ctrl-C once more to force a stop.",
          "ℹ️ Menunggu pkg selesai; tekan Ctrl-C sekali lagi untuk memaksa berhenti.",
        ),
      );
      return;
    }
    // the unfinished marker (set for fresh installs) stays: the next run resumes instead of repairing
    out.note(
      tr(
        `\nInterrupted. Run ${resumeCommand(host)} to continue where it stopped.`,
        `\nDihentikan. Jalankan ${resumeCommand(host)} untuk melanjutkan dari yang tertinggal.`,
      ),
    );
    release();
    process.exit(INIT_EXIT.interrupted);
  };
  if (!args.dryRun) process.on("SIGINT", onSigint);
  try {
    const decision = await detectMode(host);
    await chooseInitLanguage({
      host,
      lang: parsed.values.lang,
      yes: args.yes,
      dryRun: args.dryRun,
      say: (t) => out.note(t),
    });
    const dry = args.dryRun ? tr(" (--dry-run: nothing is changed)", " (--dry-run: tidak ada yang diubah)") : "";
    out.line(
      tr(`Panel Termux ${SELF_VERSION} — phone setup${dry}`, `Panel Termux ${SELF_VERSION} — penyiapan HP${dry}`),
    );
    out.line();
    if (decision.mode === "downgrade")
      throw new CliExit(
        INIT_EXIT.needsUser,
        tr(
          `This binary is v${SELF_VERSION}, older than the installed panel (v${decision.installed.version}).`,
          `Binary ini v${SELF_VERSION}, lebih lama dari panel yang terpasang (v${decision.installed.version}).`,
        ),
        tr(
          "to go back to the previous version: panel rollback [--db]",
          "untuk kembali ke versi sebelumnya: panel rollback [--db]",
        ),
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
        if (action === "skip-verify")
          throw usage(tr("--skip-verify only works in a terminal", "--skip-verify hanya bisa dipakai di terminal"));
        throw new CliExit(
          INIT_EXIT.needsUser,
          tr(`Needs an answer in a terminal: ${question}`, `Butuh jawaban di terminal: ${question}`),
          tr(`run: ${manual}`, `jalankan: ${manual}`),
        );
      },
    };
    const planned: Planned[] = [];
    for (const step of opts.steps ?? INIT_STEPS) {
      if (LEFT_OUT[step.id]?.(args)) continue;
      planned.push({ step, policy: POLICY[step.id][mode], lines: step.plan(ctx, await step.detect(ctx)) });
    }
    printPlan(ctx, planned);
    // Without --ssh-key the ssh step is left out, so tell once how to make SSH survive a reboot (when it is in use).
    if (args.sshKey === null && (opts.steps ?? INIT_STEPS).includes(sshStep) && !(await sshBootReady(ctx)))
      out.check(
        "info",
        tr("SSH does not start automatically when the phone boots", "SSH tidak menyala otomatis saat HP hidup"),
        tr(
          `to enable it: ${ctx.resumeCommand()} --ssh-key <key file, https URL or ->`,
          `untuk mengaktifkannya: ${ctx.resumeCommand()} --ssh-key <file kunci, URL https atau ->`,
        ),
      );
    if (args.dryRun) return INIT_EXIT.ok;
    const todo = planned.filter((p) => allowed(p.policy, tty) && hasAction(p.lines));
    /** Error lines still true after the run (M1: a plan with only errors has no action, so nothing fixed it). */
    const leftErrors = async (): Promise<PlanLine[]> => {
      const errors: PlanLine[] = [];
      for (const { step, lines } of planned)
        if (lines.some((l) => l.kind === "error"))
          errors.push(...step.plan(ctx, await step.detect(ctx)).filter((l) => l.kind === "error"));
      return errors;
    };
    if (todo.length === 0) {
      const errors = await leftErrors();
      if (errors.length === 0) {
        out.line(tr("Nothing needs to change.", "Tidak ada yang perlu diubah."));
        return INIT_EXIT.ok;
      }
      summary(out, ctx, errors);
      return INIT_EXIT.failed;
    }
    // The plan question (§4.1): --yes answers it, a TTY asks [Y/n], neither = exit 3.
    if (!args.yes && !tty)
      throw new CliExit(
        INIT_EXIT.needsUser,
        tr(
          "panel init needs a confirmation, but there is no terminal.",
          "panel init butuh konfirmasi, tapi tidak ada terminal.",
        ),
        tr(
          `run it in a terminal, or: ${ctx.resumeCommand()} --yes`,
          `jalankan di terminal, atau: ${ctx.resumeCommand()} --yes`,
        ),
      );
    if (!args.yes && !(await host.tty.confirm(tr("Continue?", "Lanjutkan?"), true))) {
      out.line(tr("Cancelled, nothing was changed.", "Dibatalkan, tidak ada yang diubah."));
      return INIT_EXIT.cancelled;
    }
    const postponed: PlanLine[] = [];
    if (mode === "fresh") setUnfinished(host, true);
    for (const { step } of todo) {
      const state = await step.detect(ctx); // fresh: an earlier step may have done part of it
      if (!hasAction(step.plan(ctx, state))) continue;
      out.line();
      const title = stepTitle(step.id);
      out.line(`${title.charAt(0).toUpperCase()}${title.slice(1)}`);
      try {
        await step.apply(ctx, state);
      } catch (e) {
        if (!(e instanceof CliExit && e.code === INIT_EXIT.needsUser && DEFERRED_NEEDS_USER.has(step.id))) throw e;
        out.check("warning", `${e.message} ${tr("The other steps continue.", "Langkah lain dilanjutkan.")}`);
        postponed.push({ kind: "error", text: e.message, ...(e.hint ? { hint: e.hint } : {}) });
      }
    }
    setUnfinished(host, false); // every step ran to its end (a step that throws leaves the marker)
    const errors = await leftErrors();
    summary(out, ctx, [...postponed, ...errors]);
    if (errors.length > 0) return INIT_EXIT.failed;
    return postponed.length > 0 ? INIT_EXIT.needsUser : INIT_EXIT.ok;
  } finally {
    if (!args.dryRun) process.off("SIGINT", onSigint);
    release();
  }
}

/** Dispatcher entry. */
export const initCommand: Command = (args, io) => runInit(args, io);
