import { afterEach, describe, expect, test } from "bun:test";
import type { DevSetting, DevUser } from "@/shared/dev.types";
import { DevApiError, devErrorMessage, devFetch, devUrl, errorFromResponse, redirectFor } from "@/web/dev/dev.api";
import { formatBytes, formatDateTime, formatUptime, usedPercent } from "@/web/dev/dev.format";
import { pageCount, parsePageParam, withFilter, withPage } from "@/web/dev/dev.pagination";
import { normalizeInviteEmail } from "@/web/dev/invite.email";
import { canReset, initialDraft, RESET_BODY, saveBody, settingStatus } from "@/web/dev/settings.state";
import { isLockedUser } from "@/web/dev/users.list";

describe("errorFromResponse / redirectFor / devErrorMessage", () => {
  test.each([
    [401, "unauthorized", "/login"],
    [403, "forbidden", "/"],
    [400, "client", null],
    [409, "client", null],
    [500, "server", null],
    [503, "server", null],
  ] as const)("HTTP %d → %s, redirect %p", (status, kind, to) => {
    const err = errorFromResponse(status, null);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(redirectFor(err)).toBe(to);
  });

  test("reads code and message from the error body", () => {
    const err = errorFromResponse(409, { error: "exists", message: "already invited" });
    expect(err.code).toBe("exists");
    expect(err.serverMessage).toBe("already invited");
  });

  test("ignores bodies that are not { error: string }", () => {
    expect(errorFromResponse(400, { error: 42 }).code).toBeNull();
    expect(errorFromResponse(400, "oops").code).toBeNull();
  });

  test("known code → Indonesian message", () =>
    expect(devErrorMessage(errorFromResponse(409, { error: "protected" }))).toContain("dilindungi"));
  test("unknown 4xx code → server message", () =>
    expect(devErrorMessage(errorFromResponse(400, { error: "invalid_value", message: "must be a URL" }))).toBe(
      "must be a URL",
    ));
  test("network and 5xx → per-kind message", () => {
    expect(devErrorMessage(new DevApiError("network", null, null, null))).toContain("terhubung");
    expect(devErrorMessage(errorFromResponse(500, { error: "boom", message: "stack" }))).toContain("gangguan");
  });
  test("non-DevApiError → generic", () => expect(devErrorMessage(new Error("x"))).toBe("Permintaan gagal."));
});

describe("devUrl", () => {
  test("drops empty params", () =>
    expect(devUrl("/users", { page: 2, pageSize: 20, q: "", x: undefined, y: null })).toBe(
      "/api/dev/users?page=2&pageSize=20",
    ));
  test("encodes values", () => expect(devUrl("/logs", { q: "a b&c" })).toBe("/api/dev/logs?q=a+b%26c"));
  test("no query → bare path", () => expect(devUrl("/health")).toBe("/api/dev/health"));
});

describe("devFetch", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const stub = (impl: () => Promise<Response>) => {
    globalThis.fetch = Object.assign(impl, { preconnect: realFetch.preconnect });
  };

  test("rejected fetch → network error", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await devFetch("GET", "/api/dev/health").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DevApiError);
    expect((err as DevApiError).kind).toBe("network");
  });

  test("409 with body → client error carrying the code", async () => {
    stub(() => Promise.resolve(Response.json({ error: "exists", message: "dup" }, { status: 409 })));
    const err = (await devFetch("POST", "/api/dev/invites", { email: "a@b.co" }).catch(
      (e: unknown) => e,
    )) as DevApiError;
    expect([err.kind, err.code]).toEqual(["client", "exists"]);
  });

  test("204 → undefined; 200 → parsed JSON", async () => {
    stub(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await devFetch("DELETE", "/api/dev/users/u1")).toBeUndefined();
    stub(() => Promise.resolve(Response.json({ ok: 1 })));
    expect(await devFetch<{ ok: number }>("GET", "/api/dev/health")).toEqual({ ok: 1 });
  });

  test("200 with non-JSON body → server error, not silent null", async () => {
    stub(() => Promise.resolve(new Response("<html>", { status: 200 })));
    const err = (await devFetch("GET", "/api/dev/health").catch((e: unknown) => e)) as DevApiError;
    expect([err.kind, err.code]).toEqual(["server", "invalid_json"]);
  });
});

describe("pagination", () => {
  test.each([
    [0, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [100, 0, 100],
  ] as const)("pageCount(%d, %d) = %d", (total, size, pages) => expect(pageCount(total, size)).toBe(pages));
  test.each([
    [null, 1],
    ["3", 3],
    ["0", 1],
    ["-2", 1],
    ["1.5", 1],
    ["abc", 1],
  ] as const)("parsePageParam(%p) = %d", (raw, n) => expect(parsePageParam(raw)).toBe(n));
  test("withFilter sets the filter and resets page", () => {
    const next = withFilter(new URLSearchParams("q=old&page=4"), "q", "new");
    expect(next.toString()).toBe("q=new");
    expect(withFilter(next, "q", "").toString()).toBe("");
  });
  test("withPage keeps filters; page 1 drops the param", () => {
    expect(withPage(new URLSearchParams("q=x"), 3).toString()).toBe("q=x&page=3");
    expect(withPage(new URLSearchParams("q=x&page=3"), 1).toString()).toBe("q=x");
  });
});

describe("formatters", () => {
  test.each([
    [0, "0 B"],
    [1023, "1.023 B"],
    [1536, "1,5 KB"],
    [5 * 1024 ** 3, "5 GB"],
    [150 * 1024 ** 2, "150 MB"],
    [-1, "–"],
  ] as const)("formatBytes(%d) = %s", (n, s) => expect(formatBytes(n)).toBe(s));
  test.each([
    [0, "0d"],
    [42, "42d"],
    [3725, "1j 2m"],
    [3600, "1j"],
    [90061, "1h 1j"],
    [86400 * 3 + 59, "3h"],
  ] as const)("formatUptime(%d) = %s", (n, s) => expect(formatUptime(n)).toBe(s));
  test("usedPercent", () => {
    expect(usedPercent(25, 100)).toBe(75);
    expect(usedPercent(0, 0)).toBe(0);
    expect(usedPercent(200, 100)).toBe(0);
  });
  test("formatDateTime handles null/invalid", () => {
    expect(formatDateTime(null)).toBe("–");
    expect(formatDateTime("nope")).toBe("–");
    expect(formatDateTime("2026-11-26T07:05:00Z")).toContain("2026");
  });
});

// test-only fixtures
const setting = (over: Partial<DevSetting>): DevSetting => ({
  key: "k",
  label: "K",
  description: "",
  secret: false,
  value: "default",
  isSet: false,
  updatedAt: null,
  ...over,
});

describe("settings form state", () => {
  test("plain: draft starts at the effective value; unchanged → nothing to save", () => {
    const s = setting({ value: "abc" });
    expect(initialDraft(s)).toBe("abc");
    expect(saveBody(s, "abc")).toBeNull();
    expect(saveBody(s, "abd")).toEqual({ value: "abd" });
    expect(saveBody(s, "")).toEqual({ value: "" });
  });
  test("secret: write-only — draft starts empty, empty input saves nothing", () => {
    const s = setting({ secret: true, value: null, isSet: true });
    expect(initialDraft(s)).toBe("");
    expect(saveBody(s, "")).toBeNull();
    expect(saveBody(s, "new-secret")).toEqual({ value: "new-secret" });
  });
  test("secret draft ignores a value even if the server sent one", () =>
    expect(initialDraft(setting({ secret: true, value: "leak" }))).toBe(""));
  test("reset only when a value is stored; body is null", () => {
    expect(canReset(setting({ isSet: false }))).toBe(false);
    expect(canReset(setting({ isSet: true }))).toBe(true);
    expect(RESET_BODY).toEqual({ value: null });
  });
  test.each([
    [true, true, "saved"],
    [true, false, "notSet"],
    [false, true, "custom"],
    [false, false, "default"],
  ] as const)("status secret=%p isSet=%p → %s", (secret, isSet, status) =>
    expect(settingStatus(setting({ secret, isSet }))).toBe(status),
  );
});

describe("invite email + user lock", () => {
  test.each([
    ["  A@Gmail.com ", "a@gmail.com"],
    ["a@b.co", "a@b.co"],
    ["no-at", null],
    ["a@b", null],
    ["a b@c.de", null],
    ["", null],
  ] as const)("normalizeInviteEmail(%p) = %p", (raw, out) => expect(normalizeInviteEmail(raw)).toBe(out));

  const user = (over: Partial<DevUser>): DevUser => ({
    id: "u2",
    email: "u@x.co",
    name: "U",
    image: null,
    role: "user",
    createdAt: "2026-01-01T00:00:00Z",
    lastSeenAt: null,
    isEnvSuperAdmin: false,
    ...over,
  });
  test("env super admins and yourself are locked, others not", () => {
    expect(isLockedUser(user({ isEnvSuperAdmin: true }), "me")).toBe(true);
    expect(isLockedUser(user({ id: "me" }), "me")).toBe(true);
    expect(isLockedUser(user({}), "me")).toBe(false);
  });
});
