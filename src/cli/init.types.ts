// Contract of `panel init` steps (PLAN/07 §4, §16 "Kontrak W0", frozen for the W1 workers). A step only knows how
// to read its part of the phone (detect), say what it would do (plan) and do it (apply). Whether it may run in this
// mode / with this TTY (§4 mode table, K9, K21, C22, C23) is decided in init.command.ts, never in the step.
import type { DoctorState } from "../shared/doctor.types";
import type { CliHost } from "./cli.host";
import { tr } from "./cli.locale";
import type { CliOut } from "./cli.output";

/** Exit codes of init (PLAN/07 §2.2). Throw `new CliExit(INIT_EXIT.needsUser, message, hint)` from a step. */
export const INIT_EXIT = { ok: 0, failed: 1, usage: 2, needsUser: 3, cancelled: 4, interrupted: 130 } as const;

/** Install mode (K7, K20, C20): no user data = fresh; newer/other build or stale runit process = upgrade; else repair. */
export type InitMode = "fresh" | "upgrade" | "repair";

/** Parts `--skip` may leave out (§2.1). */
export const INIT_SKIPPABLE = ["postgres", "tunnel", "boot"] as const;
/** One `--skip` value. */
export type InitSkippable = (typeof INIT_SKIPPABLE)[number];

/** Parsed and validated `panel init` flags (§2.1; no --downgrade/--port/--tunnel, C27). */
export type InitArgs = {
  yes: boolean;
  dryRun: boolean;
  skipVerify: boolean;
  /** `--ssh-key <https-url|file|->` (K22); http:// is rejected before any step (exit 2). */
  sshKey: string | null;
  hostname: string | null;
  adminEmails: string[];
  skip: ReadonlySet<InitSkippable>;
};

/** Where the installed version came from (K20): the running panel, panel.db, or unknown. */
export type InstalledVersion = { version: string | null; source: "health" | "db" | null };

/** Result of init.mode.ts detectMode: the mode plus the facts it was derived from (printed in the plan). */
export type ModeDecision = {
  /** `downgrade` never reaches the steps: init exits 3 with the rollback hint before step 1 (K20, C27). */
  mode: InitMode | "downgrade";
  /** User-data paths that exist (C20); empty = fresh phone. */
  userData: string[];
  installed: InstalledVersion;
  /** ~/panel/panel exists. */
  binaryInstalled: boolean;
  /** ~/panel/panel has the same bytes as this binary (SHA-256). */
  sameBinary: boolean;
  /** runit's panel process (supervise/pid → /proc/<pid>/exe) is not the file ~/panel/panel (K21: upgrade cut short). */
  staleProcess: boolean;
};

/** One plan line: `action` = numbered "What will be done" line; ok/warning/error/info = a checked fact (+ → hint). */
export type PlanLine = { kind: "action" | DoctorState; text: string; hint?: string };

/**
 * Actions that need their own confirmation (§4.1, K9, C19, C22, K19). ctx.confirmRisky applies the one rule:
 * restart-panel: upgrade mode only, TTY question or --yes (also without TTY); restart-cloudflared, dns-overwrite,
 * apt-replace, skip-verify: TTY only, --yes does not answer; pkg-upgrade: TTY, or --yes on a fresh phone.
 */
export type RiskyAction =
  | "restart-panel"
  | "restart-cloudflared"
  | "dns-overwrite"
  | "pkg-upgrade"
  | "apt-replace"
  | "skip-verify";

/** Terminal questions for steps (backed by CliHost.tty; scripted in the fake). */
export type InitPrompt = CliHost["tty"];

/** Mutable run facts shared by steps; printed in the summary (step 11). Never holds secrets (K10). */
export type InitRunState = {
  /** Every file or folder init wrote, removed or renamed (C6 row of §4.5: printed with its path). */
  changed: string[];
  /** Manual steps left for the user (Access, Android settings, OAuth when skipped …), one line each. */
  manual: string[];
};

/** What every step gets. Built once per run by init.command.ts. */
export type InitContext = {
  host: CliHost;
  args: InitArgs;
  mode: InitMode;
  decision: ModeDecision;
  out: CliOut;
  /** stdin is a terminal (questions possible). */
  tty: boolean;
  prompt: InitPrompt;
  state: InitRunState;
  /**
   * Asks for a risky action per RiskyAction's rule: true = go, false = the user said no (the step decides: skip or
   * exit 4). Throws CliExit 3 (exit 2 for skip-verify) when it cannot ask; `manual` = the exact command to run instead.
   */
  confirmRisky: (action: RiskyAction, question: string, manual: string) => Promise<boolean>;
  /** Runs `fn` with the first Ctrl-C ignored ("waiting for pkg to finish"), for pkg/npm (K7, §4.2). */
  guardSigint: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Command that resumes init (m8): `panel init` when $PREFIX/bin/panel is ours, else `~/panel/panel init`. */
  resumeCommand: () => string;
};

/** Stable step ids in run order (§4.1: 1, 2, 3, 3a, 4–10; step 0 and 11 are init.command.ts itself). */
export const INIT_STEP_IDS = [
  "binary",
  "packages",
  "runit",
  "ssh",
  "postgres",
  "env",
  "panel-sv",
  "pm2",
  "tunnel",
  "boot",
  "start",
] as const;
/** One step id. */
export type InitStepId = (typeof INIT_STEP_IDS)[number];

const STEP_TITLES: Record<InitStepId, [en: string, id: string]> = {
  binary: ["panel binary", "binary panel"],
  packages: ["Termux packages", "paket Termux"],
  runit: ["runit", "runit"],
  ssh: ["SSH", "SSH"],
  postgres: ["PostgreSQL", "PostgreSQL"],
  env: [".env", ".env"],
  "panel-sv": ["panel service", "layanan panel"],
  pm2: ["pm2", "pm2"],
  tunnel: ["Cloudflare tunnel", "tunnel Cloudflare"],
  boot: ["Termux:Boot", "Termux:Boot"],
  start: ["starting the panel", "menyalakan panel"],
};

/** Step title in the active CLI locale: lowercase name used in "Already complete: …" and as the run header. */
export const stepTitle = (id: InitStepId): string => tr(...STEP_TITLES[id]);

/**
 * One init step. `detect` and `plan` never write anything and start no child that changes the phone (`--dry-run`
 * calls only these); `detect` may run read-only probes (host.exec) and fetch. `plan` returns no `action` line when
 * there is nothing to do. `apply` runs only when allowed and planned, after a fresh `detect`; it throws CliExit for
 * exit 1/3/4 and records every path it writes in ctx.state.changed.
 */
export type InitStep<S = unknown> = {
  id: InitStepId;
  detect: (ctx: InitContext) => Promise<S>;
  plan: (ctx: InitContext, state: S) => PlanLine[];
  apply: (ctx: InitContext, state: S) => Promise<void>;
};

/** Erases a step's state type so steps with different states share one registry. */
export const defineStep = <S>(step: InitStep<S>): InitStep => step as unknown as InitStep;
