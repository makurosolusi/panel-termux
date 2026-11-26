import { describe, expect, test } from "bun:test";
import type { Integration, Job, JobStep } from "@/shared/site.types";
import { id } from "@/web/i18n/id";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";
import { type EnvRow, envRecord, envRowErrors, envUpdateBody, envUpdateEmpty } from "@/web/site/env.rows";
import { isJobFinished, jobProgress, jobResultLink, jobTone, stepTone } from "@/web/site/job.state";
import { adoptBody, adoptPrefill, integrationHints } from "@/web/site/site.adopt";
import { SITE_ERROR_CODES, siteUrl } from "@/web/site/site.api";
import {
  checkRequest,
  createBody,
  issuesByField,
  optionsReady,
  parsePort,
  type SiteForm,
  targetReady,
} from "@/web/site/site.check";
import { createPlan } from "@/web/site/wizard.summary";

// test-only fixtures
const row = (key: string, value = "v", rowId = Math.random()): EnvRow => ({ id: rowId, key, value });
const form = (over: Partial<SiteForm> = {}): SiteForm => ({
  name: "blog",
  hostname: "Blog.Example.com ",
  port: "3001",
  database: false,
  env: [],
  ...over,
});
const step = (status: JobStep["status"], key = status): JobStep => ({ key, label: key, status, message: null });
const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  kind: "site.create",
  target: "blog",
  status: "running",
  steps: [],
  error: null,
  startedAt: "2026-11-26T07:00:00Z",
  finishedAt: null,
  ...over,
});

describe("env key rules", () => {
  test.each([
    ["API_KEY", null],
    ["_X1", null],
    ["api_key", "invalid"],
    ["1ABC", "invalid"],
    ["A-B", "invalid"],
    ["PORT", "reserved"],
    ["DATABASE_URL", "reserved"],
    ["", "empty"],
  ] as const)("%p → %p", (key, err) => expect(envRowErrors([row(key)])).toEqual([err]));

  test("fully blank rows are ignored, duplicates flagged on both rows", () =>
    expect(envRowErrors([row("", ""), row("A"), row("A"), row("B")])).toEqual([null, "duplicate", "duplicate", null]));

  test("keys already in .env count as duplicates", () =>
    expect(envRowErrors([row("SECRET")], ["SECRET"])).toEqual(["duplicate"]));

  test("envRecord trims keys and drops blank rows", () =>
    expect(envRecord([row(" A ", "1"), row("", "")])).toEqual({ A: "1" }));

  test("envUpdateBody: non-empty replacements + new rows; unset wins over replacement", () => {
    const body = envUpdateBody({ A: "new", B: "", C: "x" }, new Set(["C", "D"]), [row("E", "5")]);
    expect(body).toEqual({ set: { A: "new", E: "5" }, unset: ["C", "D"] });
    expect(envUpdateEmpty(body)).toBe(false);
    expect(envUpdateEmpty(envUpdateBody({ A: "" }, new Set(), []))).toBe(true);
  });
});

describe("wizard", () => {
  test.each([
    ["", undefined],
    [" 8080 ", 8080],
    ["0", "invalid"],
    ["65536", "invalid"],
    ["3.5", "invalid"],
    ["abc", "invalid"],
  ] as const)("parsePort(%p) → %p", (text, out) => expect(parsePort(text)).toBe(out));

  test("issuesByField groups messages per field", () =>
    expect(
      issuesByField([
        { field: "name", code: "exists", message: "a" },
        { field: "hostname", code: "taken", message: "b" },
        { field: "name", code: "invalid", message: "c" },
      ]),
    ).toEqual({ name: ["a", "c"], hostname: ["b"] }));

  test("checkRequest normalizes, omits empty port, null while incomplete/invalid", () => {
    expect(checkRequest(form())).toEqual({ name: "blog", hostname: "blog.example.com", port: 3001 });
    expect(checkRequest(form({ port: "" }))).toEqual({ name: "blog", hostname: "blog.example.com" });
    expect(checkRequest(form({ name: " " }))).toBeNull();
    expect(checkRequest(form({ port: "x" }))).toBeNull();
  });

  test("targetReady needs a passed, settled check", () => {
    expect(targetReady(form(), { ok: true, issues: [] }, false)).toBe(true);
    expect(targetReady(form(), { ok: true, issues: [] }, true)).toBe(false);
    expect(targetReady(form(), { ok: false, issues: [] }, false)).toBe(false);
    expect(targetReady(form(), undefined, false)).toBe(false);
    expect(targetReady(form({ port: "0" }), { ok: true, issues: [] }, false)).toBe(false);
  });

  test("optionsReady rejects reserved/invalid env keys", () => {
    expect(optionsReady(form({ env: [row("TOKEN")] }))).toBe(true);
    expect(optionsReady(form({ env: [row("PORT")] }))).toBe(false);
  });

  test("createBody omits empty port and env", () => {
    expect(createBody(form({ port: "", database: true }))).toEqual({
      name: "blog",
      hostname: "blog.example.com",
      database: true,
    });
    expect(createBody(form({ env: [row("K", "1"), row("", "")] }))).toEqual({
      name: "blog",
      hostname: "blog.example.com",
      port: 3001,
      database: false,
      env: { K: "1" },
    });
  });

  test("createPlan mentions db only when chosen and ends with the cloudflared restart", () => {
    const withDb = createPlan(createBody(form({ database: true })));
    expect(withDb).toContain(id.site.wizard.plan.database("blog"));
    expect(withDb.at(-1)).toBe(id.site.wizard.plan.restart);
    expect(createPlan(createBody(form()))).toContain(id.site.wizard.plan.noDatabase);
  });
});

describe("job state", () => {
  test("progress counts settled steps; succeeded is 100; no steps is 0", () => {
    expect(jobProgress(job({ steps: [step("done"), step("skipped"), step("running"), step("pending")] }))).toBe(50);
    expect(jobProgress(job({ steps: [] }))).toBe(0);
    expect(jobProgress(job({ status: "succeeded", steps: [step("pending")] }))).toBe(100);
    expect(jobProgress(job({ status: "rolled_back", steps: [step("rolled_back"), step("failed")] }))).toBe(100);
  });

  test.each([
    ["running", false],
    ["succeeded", true],
    ["failed", true],
    ["rolled_back", true],
  ] as const)("status %s finished=%p", (status, done) => expect(isJobFinished(job({ status }))).toBe(done));

  test("tones: skipped grey, failed red, rolled-back job red", () => {
    expect(stepTone("skipped")).toBe("muted");
    expect(stepTone("failed")).toBe("bad");
    expect(stepTone("done")).toBe("ok");
    expect(jobTone(job({ status: "rolled_back" }))).toBe("bad");
  });

  test("result link: detail, or list after delete / failed create", () => {
    expect(jobResultLink(job({ status: "succeeded" }))).toBe("/panel/sites/blog");
    expect(jobResultLink(job({ status: "failed" }))).toBe("/panel/sites");
    expect(jobResultLink(job({ kind: "site.delete", status: "succeeded" }))).toBe("/panel/sites");
    expect(jobResultLink(job({ kind: "hostname.add", status: "failed", target: "a b" }))).toBe("/panel/sites/a%20b");
  });
});

describe("adopt", () => {
  test("prefill from discovered entry leaves name empty", () => {
    expect(adoptPrefill({ hostname: "x.example.com", port: 4000, app: "x" })).toEqual({
      name: "",
      hostname: "x.example.com",
      port: "4000",
      app: "x",
    });
    expect(adoptPrefill({ hostname: "y.example.com", port: null, app: null })).toEqual({
      name: "",
      hostname: "y.example.com",
      port: "",
      app: "",
    });
  });

  test("adoptBody requires name and a valid port; empty app omitted", () => {
    const f = adoptPrefill({ hostname: "X.example.com", port: 4000, app: null });
    expect(adoptBody(f)).toBeNull();
    expect(adoptBody({ ...f, name: " x " })).toEqual({ name: "x", hostname: "x.example.com", port: 4000 });
    expect(adoptBody({ ...f, name: "x", port: "" })).toBeNull();
    expect(adoptBody({ ...f, name: "x", app: "pm" })).toMatchObject({ app: "pm" });
  });
});

describe("integration hints", () => {
  const ok: Integration = {
    ecosystemIncludesAppsJson: true,
    appsJsonExists: true,
    tunnelId: "t",
    cloudflareTokenSet: true,
    issues: [],
  };
  test("no issues → no banner", () => expect(integrationHints({ ...ok, cloudflareTokenSet: false })).toEqual([]));
  test("flags → hints in fix order", () =>
    expect(
      integrationHints({
        ecosystemIncludesAppsJson: false,
        appsJsonExists: false,
        tunnelId: null,
        cloudflareTokenSet: false,
        issues: ["x"],
      }),
    ).toEqual(["appsJson", "appsJsonMissing", "tunnel", "token"]));
});

describe("site api helpers", () => {
  test("409 busy maps to the site message", () =>
    expect(apiErrorMessage(errorFromResponse(409, { error: "busy", message: "x" }), SITE_ERROR_CODES)).toBe(
      id.site.errorCodes.busy,
    ));
  test("siteUrl encodes the name", () => expect(siteUrl("a b", "/env")).toBe("/api/panel/sites/a%20b/env"));
});
