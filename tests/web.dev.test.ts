import { afterEach, describe, expect, test } from "bun:test";
import type { DevLogEntry, DevUser } from "@/shared/dev.types";
import { devErrorMessage, devFetch, devUrl } from "@/web/dev/dev.api";
import { levelParam, toViewerLines } from "@/web/dev/logs.page";
import { lastSeenText, userActions } from "@/web/dev/users.list";
import { tDevUsers } from "@/web/i18n/en.dev.users";
import { ApiError as DevApiError, errorFromResponse, redirectFor } from "@/web/shared/api.client";
import { formatBytes, formatDateTime, formatUptime, usedPercent } from "@/web/shared/format";

describe("errorFromResponse / redirectFor / devErrorMessage", () => {
  test.each([
    [401, "unauthorized", "/login"],
    [403, "forbidden", "/login"], // B20
    [400, "client", null],
    [409, "client", null],
    [500, "server", null],
    [503, "server", null],
  ] as const)("HTTP %d → %s, redirect %p", (status, kind, to) => {
    // the panel's own 401 always carries this body; a bodyless 401 is Cloudflare Access (web.api-client.test.ts)
    const err = errorFromResponse(status, status === 401 ? { error: "unauthorized" } : null);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(redirectFor(err)).toBe(to);
  });

  test("reads code and message from the error body", () => {
    const err = errorFromResponse(409, { error: "exists", message: "site exists" });
    expect(err.code).toBe("exists");
    expect(err.serverMessage).toBe("site exists");
  });

  test("ignores bodies that are not { error: string }", () => {
    expect(errorFromResponse(400, { error: 42 }).code).toBeNull();
    expect(errorFromResponse(400, "oops").code).toBeNull();
  });

  test("known code → its own message", () =>
    expect(devErrorMessage(errorFromResponse(409, { error: "protected" }))).toContain("protected"));
  test("unknown 4xx code → server message", () =>
    expect(devErrorMessage(errorFromResponse(400, { error: "invalid_value", message: "must be a URL" }))).toBe(
      "must be a URL",
    ));
  test("network and 5xx → per-kind message", () => {
    expect(devErrorMessage(new DevApiError("network", null, null, null))).toContain("Can't reach the server");
    expect(devErrorMessage(errorFromResponse(500, { error: "boom", message: "stack" }))).toContain("server");
  });
  test("non-DevApiError → generic", () =>
    expect(devErrorMessage(new Error("x"))).toBe(
      "The request didn't go through. Try again; if it keeps failing, reload the page.",
    ));
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
    const err = (await devFetch("PATCH", "/api/dev/users/u1", { role: "admin" }).catch(
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

describe("formatters", () => {
  test.each([
    [0, "0 B"],
    [1023, "1,023 B"],
    [1536, "1.5 KB"],
    [5 * 1024 ** 3, "5.0 GB"], // D16: GB/TB always one decimal
    [150 * 1024 ** 2, "150 MB"],
    [-1, "–"],
  ] as const)("formatBytes(%d) = %s", (n, s) => expect(formatBytes(n)).toBe(s));
  test.each([
    [0, "0 s"],
    [42, "42 s"],
    [437, "7 min 17 s"],
    [3725, "1 h 2 min"],
    [3600, "1 h"],
    [90061, "1 d 1 h"],
    [119_340, "1 d 9 h"],
    [86400 * 3 + 59, "3 d"],
    [-1, "–"],
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
const user = (over: Partial<DevUser>): DevUser => ({
  id: "u2",
  email: "u@x.co",
  name: "U",
  image: null,
  role: "user",
  createdAt: "2026-01-01T00:00:00Z",
  lastSeenAt: null,
  activeSessions: 1,
  isEnvSuperAdmin: false,
  ...over,
});

describe("user actions", () => {
  test("yourself: locked, nothing offered (server answers 409 protected/self)", () =>
    expect(userActions(user({ id: "me" }), "me")).toEqual({
      locked: "self",
      role: false,
      revoke: false,
      delete: false,
    }));
  test("env super admin: only sign-out from all devices (K21)", () =>
    expect(userActions(user({ isEnvSuperAdmin: true, role: "super_admin" }), "me")).toEqual({
      locked: "env",
      role: false,
      revoke: true,
      delete: false,
    }));
  test("env super admin who is yourself stays locked as self", () =>
    expect(userActions(user({ id: "me", isEnvSuperAdmin: true }), "me").locked).toBe("self"));
  test("other user / admin: everything", () => {
    expect(userActions(user({}), "me")).toEqual({ locked: null, role: true, revoke: true, delete: true });
    expect(userActions(user({ role: "admin" }), "me").delete).toBe(true);
  });
});

describe("lastSeenText (day resolution, local days)", () => {
  const now = new Date(2026, 10, 27, 9, 0);
  test.each([
    [null, "Never active"],
    ["nope", "Never active"],
    [new Date(2026, 10, 27, 0, 5).toISOString(), "Active today"],
    [new Date(2026, 10, 26, 23, 59).toISOString(), "Active yesterday"],
    [new Date(2026, 10, 20, 12).toISOString(), "Active 7 days ago"],
  ] as const)("%p → %s", (iso, text) => expect(lastSeenText(iso, now)).toBe(text));
});

describe("users copy plurals", () => {
  test("sessions, days ago, revoked", () => {
    expect([0, 1, 2].map(tDevUsers.sessions)).toEqual(["No sessions", "1 session", "2 sessions"]);
    expect(tDevUsers.seenDaysAgo(1)).toBe("Active 1 day ago");
    expect(tDevUsers.revoked("Rina", 1)).toBe("Rina was signed out of 1 session.");
    expect(tDevUsers.revokedAll(3)).toBe("3 sessions signed out.");
  });
});

describe("panel log page", () => {
  test.each([
    [null, "info"],
    ["error", "error"],
    ["warn", "warn"],
    ["loud", "info"],
  ] as const)("?level=%p → %s", (raw, level) => expect(levelParam(raw)).toBe(level));

  const e = (msg: string, at = "2026-11-26T07:00:00Z"): DevLogEntry => ({ at, level: "info", msg });
  test("newest-first API entries become oldest-first lines", () =>
    expect(toViewerLines([], [e("b"), e("a")]).map((l) => [l.text, l.seq])).toEqual([
      ["a", 0],
      ["b", 1],
    ]));
  test("next poll keeps seq of lines already shown; new lines continue the count", () => {
    const first = toViewerLines([], [e("b"), e("a")]);
    const next = toViewerLines(first, [e("d"), e("c"), e("b"), e("a")]);
    expect(next.map((l) => [l.text, l.seq])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });
  test("ring rolled past the last line: seq still grows", () => {
    const first = toViewerLines([], [e("a")]);
    expect(toViewerLines(first, [e("z")])[0]?.seq).toBe(1);
  });
});
