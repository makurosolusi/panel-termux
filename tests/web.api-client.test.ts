import { describe, expect, test } from "bun:test";
import { id } from "@/web/i18n/id";
import {
  ACCESS_RELOAD_WINDOW_MS,
  AJAX_HEADERS,
  apiErrorMessage,
  errorFromResponse,
  isAccessChallenge,
  redirectFor,
  shouldReloadForAccess,
} from "@/web/shared/api.client";

describe("Cloudflare Access 401 vs panel 401", () => {
  test.each([
    ["panel 401 JSON", 401, { error: "unauthorized" }, false],
    ["Access 401 without body", 401, null, true],
    ["Access 401 with non-error JSON", 401, { message: "x" }, true],
    ["403", 403, null, false],
    ["500", 500, null, false],
    ["200", 200, null, false],
  ] as const)("%s → %p", (_label, status, body, expected) => {
    expect(isAccessChallenge(status, body)).toBe(expected);
  });

  test("kinds and redirects", () => {
    const panel = errorFromResponse(401, { error: "unauthorized" });
    expect(panel.kind).toBe("unauthorized");
    expect(redirectFor(panel)).toBe("/login");

    const access = errorFromResponse(401, null);
    expect(access.kind).toBe("access");
    expect(redirectFor(access)).toBeNull();
    expect(apiErrorMessage(access)).toBe(id.common.errors.access);

    expect(errorFromResponse(403, null).kind).toBe("forbidden");
    expect(errorFromResponse(502, null).kind).toBe("server");
    expect(errorFromResponse(404, null).kind).toBe("client");
  });

  test("AJAX header asks Access for a 401 instead of a redirect", () => {
    expect(AJAX_HEADERS["x-requested-with"]).toBe("XMLHttpRequest");
  });
});

describe("shouldReloadForAccess (loop guard)", () => {
  const now = 1_000_000; // test-only
  test.each([
    ["never reloaded", null, true],
    ["just reloaded", now - 1, false],
    ["reloaded inside window", now - ACCESS_RELOAD_WINDOW_MS + 1, false],
    ["reloaded exactly window ago", now - ACCESS_RELOAD_WINDOW_MS, true],
    ["reloaded long ago", now - 24 * 3600 * 1000, true],
    ["garbage marker", Number.NaN, true],
  ] as const)("%s → %p", (_label, last, expected) => {
    expect(shouldReloadForAccess(last, now)).toBe(expected);
  });
});
