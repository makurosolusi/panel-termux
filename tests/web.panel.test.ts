import { describe, expect, test } from "bun:test";
import type { App, Domain, DomainHealth, Service } from "@/shared/panel.types";
import { id } from "@/web/i18n/id";
import { parseLogParams } from "@/web/panel/log.page";
import { panelUrl } from "@/web/panel/panel.api";
import {
  actionBlocks,
  appTone,
  countProblems,
  dropsAllDomains,
  healthLabel,
  healthTone,
  serviceTone,
} from "@/web/panel/panel.status";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";
import { formatLoad } from "@/web/shared/format";

// test-only fixtures
const svc = (over: Partial<Service> = {}): Service => ({
  name: "sshd",
  state: "run",
  pid: 1,
  uptimeSec: 10,
  wantUp: true,
  protected: false,
  ...over,
});
const app = (over: Partial<App> = {}): App => ({
  name: "web",
  status: "online",
  pid: 2,
  memoryMb: 50,
  cpu: 1,
  restarts: 0,
  uptimeSec: 10,
  port: 3000,
  ...over,
});
const health = (over: Partial<DomainHealth> = {}): DomainHealth => ({
  status: 200,
  ms: 85,
  checkedAt: "2026-11-26T07:00:00Z",
  ...over,
});
const domain = (h: Partial<DomainHealth>): Domain => ({
  hostname: "a.example.com",
  service: "http://localhost:3000",
  port: 3000,
  app: "web",
  health: health(h),
});

describe("tones", () => {
  test.each([
    ["run", true, "ok"],
    ["finish", true, "warn"],
    ["down", true, "bad"],
    ["down", false, "muted"],
    ["unknown", true, "muted"],
  ] as const)("service %s wantUp=%p → %s", (state, wantUp, tone) =>
    expect(serviceTone(svc({ state, wantUp }))).toBe(tone),
  );
  test.each([
    ["online", "ok"],
    ["launching", "warn"],
    ["errored", "bad"],
    ["stopped", "muted"],
    ["unknown", "muted"],
  ] as const)("app %s → %s", (status, tone) => expect(appTone(app({ status }))).toBe(tone));
});

describe("domain health badge", () => {
  const text = { unchecked: "U", unreachable: "X" };
  test.each([
    [{ checkedAt: null, status: null, ms: null }, "muted", "U"],
    [{ status: null, ms: null }, "bad", "X"],
    [{ status: 200 }, "ok", "200 · 85 ms"],
    [{ status: 301, ms: null }, "ok", "301"],
    [{ status: 399 }, "ok", "399 · 85 ms"],
    [{ status: 404 }, "bad", "404 · 85 ms"],
    [{ status: 502 }, "bad", "502 · 85 ms"],
    [{ status: 199 }, "bad", "199 · 85 ms"],
  ] as const)("%p → %s %p", (over, tone, label) => {
    expect(healthTone(health(over))).toBe(tone);
    expect(healthLabel(health(over), text)).toBe(label);
  });
});

describe("countProblems", () => {
  test("counts non-running services, non-online apps and failing (checked) domains", () =>
    expect(
      countProblems({
        services: [svc(), svc({ state: "down" }), svc({ state: "finish" })],
        apps: [app(), app({ status: "errored" }), app({ status: "launching" }), app({ status: "stopped" })],
        domains: [domain({}), domain({ status: 503 }), domain({ status: null }), domain({ checkedAt: null })],
      }),
    ).toEqual({ services: 2, apps: 3, domains: 2 }));
  test("all healthy → zeros", () =>
    expect(countProblems({ services: [svc()], apps: [app()], domains: [domain({})] })).toEqual({
      services: 0,
      apps: 0,
      domains: 0,
    }));
});

describe("actionBlocks", () => {
  test("busy blocks everything, even for a stopped unit", () =>
    expect(actionBlocks({ kind: "app", item: app({ status: "stopped" }) }, true)).toEqual({
      start: "busy",
      stop: "busy",
      restart: "busy",
    }));
  test("running service: start blocked, stop/restart free", () =>
    expect(actionBlocks({ kind: "service", item: svc() }, false)).toEqual({
      start: "running",
      stop: null,
      restart: null,
    }));
  test("protected service: stop always blocked, restart still allowed", () =>
    expect(actionBlocks({ kind: "service", item: svc({ protected: true }) }, false)).toEqual({
      start: "running",
      stop: "protected",
      restart: null,
    }));
  test("down service: stop blocked as already stopped", () =>
    expect(actionBlocks({ kind: "service", item: svc({ state: "down" }) }, false).stop).toBe("stopped"));
  test("errored app may be started and stopped", () =>
    expect(actionBlocks({ kind: "app", item: app({ status: "errored" }) }, false)).toEqual({
      start: null,
      stop: null,
      restart: null,
    }));
  test("stopped app: stop blocked, start free", () =>
    expect(actionBlocks({ kind: "app", item: app({ status: "stopped" }) }, false)).toMatchObject({
      start: null,
      stop: "stopped",
    }));
  test("every block reason has a tooltip text", () => {
    for (const r of ["busy", "protected", "running", "stopped"] as const) expect(id.panel.blocked[r]).toBeTruthy();
  });
});

test("cloudflared restart/stop warns about dropping all domains; start and other services do not", () => {
  expect(dropsAllDomains("cloudflared", "restart")).toBe(true);
  expect(dropsAllDomains("cloudflared", "stop")).toBe(true);
  expect(dropsAllDomains("cloudflared", "start")).toBe(false);
  expect(dropsAllDomains("sshd", "restart")).toBe(false);
});

describe("log params + url", () => {
  test.each([
    ["", 200, "out"],
    ["lines=500&stream=err", 500, "err"],
    ["lines=123&stream=bogus", 200, "out"],
    ["lines=2000", 2000, "out"],
    ["lines=99999", 200, "out"],
  ] as const)("%p → %d %s", (qs, lines, stream) =>
    expect(parseLogParams(new URLSearchParams(qs))).toEqual({ lines, stream }),
  );
  test("panelUrl encodes and drops empty params", () =>
    expect(panelUrl("/apps/a%20b/log", { lines: 200, stream: undefined })).toBe("/api/panel/apps/a%20b/log?lines=200"));
});

describe("panel error messages", () => {
  test("panel codes win over generic 4xx text", () => {
    expect(apiErrorMessage(errorFromResponse(409, { error: "protected" }), id.panel.errorCodes)).toContain("inti");
    expect(apiErrorMessage(errorFromResponse(409, { error: "busy" }), id.panel.errorCodes)).toContain("aksi lain");
  });
  test("same code maps per section (dev account vs panel service)", () =>
    expect(apiErrorMessage(errorFromResponse(409, { error: "protected" }), id.dev.errorCodes)).toContain("Akun"));
});

test("formatLoad uses Indonesian decimals", () => expect(formatLoad([0.5, 1, 1.256])).toBe("0,50 · 1,00 · 1,26"));
