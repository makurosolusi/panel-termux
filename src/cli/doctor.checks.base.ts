// Builders shared by the `panel doctor` bootstrap check groups (PLAN/07 §3.1): one DoctorCheck shape and the
// hint → action rule.
import type { DoctorAction, DoctorBootstrapKey, DoctorCheck, DoctorGroup, DoctorState } from "../shared/doctor.types";
import type { JobParams } from "../shared/job.types";

/** Next step when a piece of the install is missing: `init` repairs it (0.5.1, PLAN/07 §2.1). */
export const REINSTALL = "jalankan: panel init (bila perintah panel belum ada: ulangi baris pasang di README)";

/** A failing outcome: state, label, next step (→ line), params. */
export type Bad = [state: DoctorState, label: string, hint?: string | null, params?: JobParams];

/** `action` follows from the hint, so every → line and its JSON action agree. */
const actionOf = (hint: string | null): DoctorAction =>
  !hint
    ? null
    : hint.includes("panel init")
      ? "init"
      : hint.includes("panel docs")
        ? "docs"
        : hint.startsWith("buka ")
          ? "ui"
          : "manual";

/** One check; `action` derived from `hint`. */
export function make(group: DoctorGroup, key: DoctorBootstrapKey, ...[state, label, hint = null, params = {}]: Bad) {
  return { group, key, state, label, action: actionOf(hint), hint, params } satisfies DoctorCheck;
}

/** Check builder of one group: ok label when `good`, else the Bad outcome. */
export const group =
  (g: DoctorGroup) =>
  (key: DoctorBootstrapKey, good: boolean, ok: string, bad: Bad): DoctorCheck =>
    good ? make(g, key, "ok", ok) : make(g, key, ...bad);
