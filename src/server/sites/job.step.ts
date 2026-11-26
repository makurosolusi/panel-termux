// Step contract of the site job runner: what a step returns or throws, and how that lands in the job row.
import type { JobError, JobKind, JobOutcomeCode, JobParams, JobStep, JobStepKey } from "../../shared/site.types";

/** Message of any thrown value (for logs and technical `detail`). */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Coded result of a step: `code`/`params` are translated by the client; `skipped` marks the step skipped. */
export type StepOutcome = { code: JobOutcomeCode; params?: JobParams; detail?: string | null; skipped?: boolean };

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
  key: JobStepKey;
  run(ctx: StepContext): Promise<StepOutcome>;
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
export function record(st: JobStep, res: StepOutcome): void {
  Object.assign(st, {
    status: res.skipped ? "skipped" : "done",
    code: res.code,
    params: res.params ?? {},
    detail: res.detail ?? null,
  });
}

/** Marks the step failed and returns the job error. */
export function failStep(st: JobStep, e: unknown): JobError {
  const coded = e instanceof StepError;
  const detail = coded ? e.detail : errMsg(e);
  const code = coded ? e.code : "unexpected";
  const params = coded ? e.params : {};
  Object.assign(st, { status: "failed", code, params, detail });
  return { code, params, detail };
}

/** Fresh persisted record of a step. */
export const pendingStep = (def: StepDef): JobStep => ({
  key: def.key,
  status: "pending",
  code: null,
  params: {},
  detail: null,
  log: [],
  startedAt: null,
  finishedAt: null,
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
