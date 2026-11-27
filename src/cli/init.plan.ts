// What `panel init` prints around its steps (PLAN/07 §4.1): the mode line, the numbered plan with checked facts and
// blocked actions, and the closing summary. Pure output: nothing here reads or changes the phone.
import type { CliHost } from "./cli.host";
import type { CliOut } from "./cli.output";
import { SELF_VERSION } from "./init.mode";
import type { InitContext, InitMode, InitStep, ModeDecision, PlanLine } from "./init.types";

/** run = may change the phone; tty = only with a terminal (else reported); report = never, only reported (§4). */
export type Policy = "run" | "tty" | "report";

/** `path` with the home folder written as ~. */
export const tilde = (host: CliHost, path: string) =>
  path.startsWith(`${host.paths.home}/`) ? `~${path.slice(host.paths.home.length)}` : path;

function modeLine(d: ModeDecision, mode: InitMode): string {
  const installed = d.installed.version ? `v${d.installed.version}` : null;
  if (mode === "fresh")
    return d.binaryInstalled
      ? "Instalasi baru yang belum selesai, dilanjutkan. Yang akan dilakukan:"
      : "HP ini belum punya instalasi panel. Yang akan dilakukan:";
  if (mode === "repair")
    return d.binaryInstalled
      ? `Panel v${SELF_VERSION} sudah terpasang. Yang kurang akan dilengkapi:`
      : "Termux ini sudah berisi data (PostgreSQL, tunnel, pm2, atau situs) tetapi panel belum terpasang. Yang akan dilakukan:";
  if (d.staleProcess)
    return `Binary v${SELF_VERSION} sudah dipasang, tetapi layanan panel masih menjalankan file lama. Yang akan dilakukan:`;
  return installed
    ? `Panel ${installed}${installed === `v${SELF_VERSION}` ? " (build lain)" : ""} sudah terpasang. Yang akan dilakukan:`
    : "Panel sudah terpasang (versi terpasang tidak diketahui). Yang akan dilakukan:";
}

/** One step with its policy and plan lines. */
export type Planned = { step: InitStep; policy: Policy; lines: PlanLine[] };
/** The plan has at least one numbered action. */
export const hasAction = (lines: PlanLine[]) => lines.some((l) => l.kind === "action");
/** The policy lets the step change the phone now. */
export const allowed = (policy: Policy, tty: boolean) => policy === "run" || (policy === "tty" && tty);

/** Prints the mode line, numbered actions, checked facts, blocked actions and the complete steps. */
export function printPlan(ctx: InitContext, planned: Planned[]): void {
  const { out } = ctx;
  out.line(modeLine(ctx.decision, ctx.mode));
  let n = 0;
  const why = ctx.mode === "upgrade" ? "tidak dipasang saat upgrade" : "butuh terminal";
  const blocked: string[] = [];
  const complete: string[] = [];
  for (const { step, policy, lines } of planned) {
    const run = allowed(policy, ctx.tty);
    for (const l of lines) {
      if (l.kind !== "action") continue;
      if (run) out.line(`  ${++n}. ${l.text}`);
      else blocked.push(`${l.text} (${why})`);
    }
    if (!hasAction(lines)) complete.push(step.title);
  }
  if (n === 0) out.line("  (tidak ada)");
  for (const { lines } of planned)
    for (const l of lines) if (l.kind !== "action") out.check(l.kind, l.text, l.hint ?? null);
  for (const b of blocked) out.check("warning", b, `jalankan lagi ${ctx.resumeCommand()} di terminal`);
  if (complete.length > 0) out.line(`Sudah lengkap: ${complete.join(", ")}.`);
}

/** Closing summary: changed paths and manual steps. */
export function summary(out: CliOut, ctx: InitContext): void {
  out.line();
  out.check("ok", "panel init selesai.");
  if (ctx.state.changed.length > 0)
    out.line(`Yang diubah:\n${[...new Set(ctx.state.changed)].map((f) => `  ${f}`).join("\n")}`);
  if (ctx.state.manual.length > 0) out.line(`Langkah manual:\n${ctx.state.manual.map((m) => `  → ${m}`).join("\n")}`);
}
