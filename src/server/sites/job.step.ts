// Step contract of the site job runner: what a step returns or throws, and how that lands in the job row.
import type { JobError, JobKind, JobOutcomeCode, JobParams, JobStep, JobStepKey } from "../../shared/site.types";

/** Message of any thrown value (for logs and technical `detail`). */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Coded result of a step: `code`/`params` are translated by the client; `skipped` marks the step skipped. */
export type StepOutcome = { code: JobOutcomeCode; params?: JobParams; detail?: string | null; skipped?: boolean };
/** 0.2.x step results (English message / `{ skipped }`); goes away when the W2 site/deploy steps return StepOutcome. */
type LegacyResult = string | null | undefined | { skipped: string };
/** What a step's `run` returns. */
export type StepResult = StepOutcome | LegacyResult;

/** Thrown by a step to fail with a coded reason (any other error becomes `unexpected` with its message as detail). */
export class StepError extends Error {
  constructor(
    readonly code: JobOutcomeCode,
    readonly params: JobParams = {},
    readonly detail: string | null = null,
  ) {
    super(detail ?? code);
  }
}

/** Handed to `run`: append short technical lines to the step log (never secrets, never app output). */
export type StepContext = { log(line: string): void };

/**
 * One job step. `undo` reverses a completed step during rollback. A step with no `undo` and not
 * `irreversible` has no side effects (counts as rolled back); an `irreversible` one keeps the job "failed".
 */
export type StepDef = {
  /** 0.3.0 steps use JobStepKey; 0.2.x free keys stay until the W2 step lists move over. */
  key: JobStepKey | (string & {});
  /** 0.2.x English label, still persisted (with `message`) for the 0.2.x web until W2/W5; 0.3.0 steps omit it. */
  label?: string;
  run(ctx: StepContext): Promise<StepResult>;
  undo?(): Promise<void>;
  irreversible?: boolean;
};

/** Job definition handed to `start`. `onSuccess` commits DB records; `afterRollback` repairs shared state. */
export type JobSpec = {
  kind: JobKind;
  target: string;
  actorId: string;
  steps: StepDef[];
  /** Recovery journal (PLAN/03 §3.3): non-secret request input, persisted before the first step. */
  input?: Record<string, unknown>;
  /** Jobs this one resolves when it succeeds (recover: the original and/or an interrupted cleanup). */
  resolves?: string[];
  onSuccess?(): void;
  afterRollback?(): Promise<void>;
};

/** Applies a step's result to its persisted record. */
export function record(st: JobStep, def: StepDef, res: StepResult): void {
  if (typeof res === "object" && res !== null && "code" in res) {
    Object.assign(st, {
      status: res.skipped ? "skipped" : "done",
      code: res.code,
      params: res.params ?? {},
      detail: res.detail ?? null,
    });
    return;
  }
  const skipped = typeof res === "object" && res !== null;
  const text = skipped ? res.skipped : (res ?? null);
  Object.assign(st, { status: skipped ? "skipped" : "done", detail: text });
  if (def.label !== undefined) st.message = text;
}

/** Marks the step failed and returns the job error (0.2.x steps keep "<label>: <message>" as job detail). */
export function failStep(st: JobStep, def: StepDef, e: unknown): JobError {
  const coded = e instanceof StepError;
  const detail = coded ? e.detail : errMsg(e);
  const code = coded ? e.code : "unexpected";
  const params = coded ? e.params : {};
  Object.assign(st, { status: "failed", code, params, detail });
  if (def.label !== undefined) st.message = errMsg(e);
  return { code, params, detail: !coded && def.label ? `${def.label}: ${detail}` : detail };
}

/** Fresh persisted record of a step (0.2.x steps also keep `label`/`message` for the 0.2.x web). */
export const pendingStep = (def: StepDef): JobStep => ({
  key: def.key,
  status: "pending",
  code: null,
  params: {},
  detail: null,
  log: [],
  startedAt: null,
  finishedAt: null,
  ...(def.label !== undefined ? { label: def.label, message: null } : {}),
});

const STEP_LOG_MAX_LINES = 20;
const STEP_LOG_MAX_CHARS = 300;

/** Step context writing to the record's log (max 20 lines × 300 chars). */
export function stepContext(st: JobStep): StepContext {
  const lines = st.log ?? [];
  st.log = lines;
  return {
    log: (line) => {
      if (lines.length < STEP_LOG_MAX_LINES) lines.push(line.slice(0, STEP_LOG_MAX_CHARS));
    },
  };
}
