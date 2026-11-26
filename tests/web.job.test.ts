import { describe, expect, test } from "bun:test";
import type { Job, JobStep } from "@/shared/job.types";
import type { Site } from "@/shared/site.types";
import { missingFromPm2 } from "@/shared/site.types";
import { idJob } from "@/web/i18n/id.job";
import { finalReason, liveAnnouncement, shownStepStatus, stepDurationMs, stepEndMs } from "@/web/site/job.state";
import { deployOutcomeSuffix, JOB_STEP_STATUS_KEY } from "@/web/site/job.status-key";
import { canRestart, siteRowTone } from "@/web/site/site.card";

const step = (key: string, status: JobStep["status"], over: Partial<JobStep> = {}): JobStep => ({
  key,
  status,
  ...over,
});

describe("interrupted job steps (QA M4)", () => {
  const steps = [step("stage", "done"), step("swap", "running", { startedAt: "2026-11-27T09:00:00Z" })];
  const cut = { status: "interrupted", steps, finishedAt: "2026-11-27T09:00:05Z" } as Pick<
    Job,
    "status" | "steps" | "finishedAt"
  >;

  test("a step left running in an ended job shows as interrupted, never 'sedang berjalan'", () => {
    expect(shownStepStatus(steps[1] as JobStep, cut)).toBe("interrupted");
    expect(JOB_STEP_STATUS_KEY[shownStepStatus(steps[1] as JobStep, cut)]).toBe("interrupted");
    expect(shownStepStatus(steps[1] as JobStep, { status: "running" })).toBe("running");
    expect(shownStepStatus(steps[0] as JobStep, cut)).toBe("done");
    expect(liveAnnouncement(cut)).toBe("Langkah 2 dari 2: Menukar binary… terputus");
  });

  test("the cut-off step stops counting at the job's finish", () => {
    const later = new Date("2026-11-28T00:00:00Z").getTime();
    expect(stepDurationMs(steps[1] as JobStep, stepEndMs(cut, later))).toBe(5_000);
    expect(stepEndMs({ finishedAt: null }, later)).toBe(later);
  });

  test("interrupted copy is not repeated word for word", () => {
    expect(idJob.outcomes.interrupted()).not.toBe(idJob.final.interrupted);
    expect<string>(idJob.recover.cleanup).toBe(idJob.next.recover);
  });
});

describe("site missing from pm2 (D-W9-3, QA M7)", () => {
  type Facts = Parameters<typeof missingFromPm2>[0];
  const facts = (over: Partial<Facts> = {}): Facts => ({
    appStatus: "not_deployed",
    managed: true,
    lastDeploy: null,
    ...over,
  });
  const deployed = (status: string) =>
    ({ at: "2026-11-27T09:00:00Z", kind: "deploy", status, actorName: null }) as Site["lastDeploy"];

  test("no pm2 process + successful deploy, live binary or adopted → missing (danger), restart allowed when managed", () => {
    expect(missingFromPm2(facts({ lastDeploy: deployed("succeeded") }))).toBe(true);
    expect(missingFromPm2(facts({ lastDeploy: deployed("rolled_back") }))).toBe(true);
    const binary = { live: { sizeBytes: 1, modifiedAt: "2026-11-27T09:00:00Z" }, previous: null } as Facts["binary"];
    expect(missingFromPm2(facts({ binary }))).toBe(true);
    expect(missingFromPm2(facts({ managed: false }))).toBe(true);
    expect(siteRowTone(facts({ lastDeploy: deployed("succeeded") }))).toBe("danger");
    expect(canRestart(facts({ lastDeploy: deployed("succeeded") }))).toBe(true);
    expect(canRestart(facts({ managed: false }))).toBe(false);
  });

  test("'Belum di-deploy' only without a successful deploy and without a binary", () => {
    expect(missingFromPm2(facts())).toBe(false);
    expect(missingFromPm2(facts({ lastDeploy: deployed("failed") }))).toBe(false);
    expect(missingFromPm2(facts({ appStatus: "online", lastDeploy: deployed("succeeded") }))).toBe(false);
    expect(canRestart(facts())).toBe(false);
  });
});

describe("deployOutcomeSuffix", () => {
  test("a failed or interrupted last deploy is labelled, a successful one is not", () => {
    expect(deployOutcomeSuffix("interrupted")).toBe(" · Terputus");
    expect(deployOutcomeSuffix("failed")).toBe(" · Gagal");
    expect(deployOutcomeSuffix("rolled_back")).toBe(" · Dikembalikan");
    expect(deployOutcomeSuffix("succeeded")).toBe("");
  });
});

describe("finalReason (QA N7)", () => {
  const error: Job["error"] = { code: "health_timeout", params: { seconds: 60, last: 502 }, detail: null };
  test("a reason a step already shows is not repeated under the banner", () => {
    expect(finalReason({ error, steps: [step("health", "failed", { code: "health_timeout" })] })).toBeNull();
    expect(finalReason({ error, steps: [step("health", "failed")] })).toContain("60 dtk");
    expect(finalReason({ error: { code: "interrupted", params: {}, detail: null }, steps: [] })).toBeNull();
    expect(finalReason({ error: null, steps: [] })).toBeNull();
  });
});
