// CLI output (PLAN/07 §2.3): plain Indonesian lines, one per item. stdout = data/results, stderr = notes and errors,
// so `panel env > .env.new` and `panel doctor --json | jq` stay clean (D15).
import type { DoctorState } from "../shared/doctor.types";

/** Symbol printed before a check line, by state. */
export const SYMBOL: Record<DoctorState, string> = { ok: "✅", warning: "⚠️", error: "❌", info: "ℹ️" };
/** Prefix of a next-step line (always follows a ❌/⚠️). */
export const NEXT = "→";

/** Where CLI text goes; tests pass collecting functions. */
export type CliSinks = { stdout: (text: string) => void; stderr: (text: string) => void };

/** CLI writer: `line` (stdout), `note` (stderr), `check` (stdout, symbol + optional → hint), `json` (stdout). */
export type CliOut = {
  line: (text?: string) => void;
  note: (text: string) => void;
  check: (state: DoctorState, label: string, hint?: string | null) => void;
  /** `❌ <message>` + optional `→ <hint>` to stderr (Rule 11: message names the operation and the cause). */
  fail: (message: string, hint?: string) => void;
  json: (value: unknown) => void;
};

const processSinks: CliSinks = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
};

/** CliOut over `sinks` (default: the process streams). */
export function createCliOut(sinks: CliSinks = processSinks): CliOut {
  return {
    line: (text = "") => sinks.stdout(`${text}\n`),
    note: (text) => sinks.stderr(`${text}\n`),
    check(state, label, hint) {
      sinks.stdout(`  ${SYMBOL[state]} ${label}\n`);
      if (hint) sinks.stdout(`     ${NEXT} ${hint}\n`);
    },
    fail(message, hint) {
      sinks.stderr(`${SYMBOL.error} ${message}\n`);
      if (hint) sinks.stderr(`${NEXT} ${hint}\n`);
    },
    json: (value) => sinks.stdout(`${JSON.stringify(value, null, 2)}\n`),
  };
}

/** Ends a command with a printed `❌ message` (+ `→ hint`) and `code` (PLAN/07 §2.2); runCli prints it. */
export class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}
