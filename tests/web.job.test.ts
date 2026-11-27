import { describe, expect, test } from "bun:test";
import type { Job, JobStep } from "@/shared/job.types";
import type { Problem } from "@/shared/monitor.types";
import { detail } from "@/shared/problem.copy.en";
import type { Site } from "@/shared/site.types";
import { missingFromPm2 } from "@/shared/site.types";
import { tDeploy } from "@/web/i18n/en.deploy";
import { tJob } from "@/web/i18n/en.job";
import { tPanel } from "@/web/i18n/en.panel";
import { tSiteDetail } from "@/web/i18n/en.site-detail";
import { problemService } from "@/web/panel/overview.problems";
import { serviceToStart } from "@/web/site/job.failure";
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

  test("a step left running in an ended job shows as interrupted, never 'running'", () => {
    expect(shownStepStatus(steps[1] as JobStep, cut)).toBe("interrupted");
    expect(JOB_STEP_STATUS_KEY[shownStepStatus(steps[1] as JobStep, cut)]).toBe("interrupted");
    expect(shownStepStatus(steps[1] as JobStep, { status: "running" })).toBe("running");
    expect(shownStepStatus(steps[0] as JobStep, cut)).toBe("done");
    expect(liveAnnouncement(cut)).toBe("Step 2 of 2: Swapping the binary… interrupted");
  });

  test("the cut-off step stops counting at the job's finish", () => {
    const later = new Date("2026-11-28T00:00:00Z").getTime();
    expect(stepDurationMs(steps[1] as JobStep, stepEndMs(cut, later))).toBe(5_000);
    expect(stepEndMs({ finishedAt: null }, later)).toBe(later);
  });

  test("interrupted copy is not repeated word for word", () => {
    expect(tJob.outcomes.interrupted()).not.toBe(tJob.final.interrupted);
    expect<string>(tJob.recover.cleanup).toBe(tJob.next.recover);
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

  test("no pm2 process + successful deploy, live binary or adopted → missing (danger), Start again allowed", () => {
    expect(missingFromPm2(facts({ lastDeploy: deployed("succeeded") }))).toBe(true);
    expect(missingFromPm2(facts({ lastDeploy: deployed("rolled_back") }))).toBe(true);
    const binary = { live: { sizeBytes: 1, modifiedAt: "2026-11-27T09:00:00Z" }, previous: null } as Facts["binary"];
    expect(missingFromPm2(facts({ binary }))).toBe(true);
    expect(missingFromPm2(facts({ managed: false }))).toBe(true);
    expect(siteRowTone(facts({ lastDeploy: deployed("succeeded") }))).toBe("danger");
    expect(canRestart(facts({ lastDeploy: deployed("succeeded") }))).toBe(true);
    // PLAN/06 §6.3: an adopted app is loaded from its ecosystem.config.js entry by the same restart job
    expect(canRestart(facts({ managed: false }))).toBe(true);
  });

  test("'Never deployed' only without a successful deploy and without a binary", () => {
    expect(missingFromPm2(facts())).toBe(false);
    expect(missingFromPm2(facts({ lastDeploy: deployed("failed") }))).toBe(false);
    expect(missingFromPm2(facts({ appStatus: "online", lastDeploy: deployed("succeeded") }))).toBe(false);
    expect(canRestart(facts())).toBe(false);
  });
});

describe("deployOutcomeSuffix", () => {
  test("a failed or interrupted last deploy is labelled, a successful one is not", () => {
    expect(deployOutcomeSuffix("interrupted")).toBe(" · Interrupted");
    expect(deployOutcomeSuffix("failed")).toBe(" · Failed");
    expect(deployOutcomeSuffix("rolled_back")).toBe(" · Rolled back");
    expect(deployOutcomeSuffix("succeeded")).toBe("");
  });
});

describe("finalReason (QA N7)", () => {
  const error: Job["error"] = { code: "health_timeout", params: { seconds: 60, last: 502 }, detail: null };
  test("a reason a step already shows is not repeated under the banner", () => {
    expect(finalReason({ error, steps: [step("health", "failed", { code: "health_timeout" })] })).toBeNull();
    expect(finalReason({ error, steps: [step("health", "failed")] })).toContain("60 s");
    expect(finalReason({ error: { code: "interrupted", params: {}, detail: null }, steps: [] })).toBeNull();
    expect(finalReason({ error: null, steps: [] })).toBeNull();
  });
});

describe("in-UI start of pm2/postgres instead of manual commands (PLAN/06 §6.1, criterion 8)", () => {
  const err = (code: string) => ({ error: { code, params: {}, detail: null } });

  test("failed job offers the service its error needs", () => {
    expect(serviceToStart(err("pm2_not_running"))).toBe("pm2");
    expect(serviceToStart(err("database_failed"))).toBe("postgres");
    expect(serviceToStart(err("pm2_failed"))).toBeNull();
    expect(serviceToStart({ error: null })).toBeNull();
  });

  test("Overview problem rows offer the button for pm2/postgres down only", () => {
    const p = (code: Problem["code"], target: string, params: Problem["params"] = {}) => ({ code, target, params });
    expect(problemService(p("service_down", "pm2"))).toBe("pm2");
    expect(problemService(p("service_down", "postgres"))).toBe("postgres");
    expect(problemService(p("service_down", "sshd"))).toBeNull();
    expect(problemService(p("pm2_unavailable", "pm2", { reason: "service_down" }))).toBe("pm2");
    // runit runs pm2 but its daemon is gone: `sv up` would do nothing
    expect(problemService(p("pm2_unavailable", "pm2", { reason: "no_daemon" }))).toBeNull();
  });

  test("no `sv up` or ssh instruction left in the P1 copy", () => {
    const texts = [tJob, tDeploy, tPanel, tSiteDetail].map((d) =>
      JSON.stringify(d, (_k, v) => (typeof v === "function" ? v({}) : v)),
    );
    for (const text of texts) expect(text).not.toContain("sv up");
    expect(tJob.outcomes.pm2_not_running()).toBe(
      "The pm2 service is not running, so every site has stopped too. Start pm2, then try again.",
    );
    const site = JSON.stringify(tSiteDetail.header);
    expect(site).not.toContain("ssh");
    expect(detail({ code: "pm2_unavailable", target: "pm2", params: {} })).not.toMatch(/start the service|sv up/i);
    expect(tJob.outcomes.dns_wrong_zone({ fqdn: "a.b.contoh.com" })).toContain("(a.b.contoh.com)");
    expect(tJob.outcomes.app_not_in_ecosystem({ name: "shop" })).toContain("shop");
  });
});
