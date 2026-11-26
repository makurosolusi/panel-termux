import { describe, expect, test } from "bun:test";
import { id } from "@/web/i18n/id";
import {
  AJAX_HEADERS,
  type ApiErrorKind,
  apiErrorMessage,
  errorFromResponse,
  isAccessChallenge,
  redirectFor,
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

    const forbidden = errorFromResponse(403, { error: "forbidden" });
    expect(forbidden.kind).toBe("forbidden");
    expect(redirectFor(forbidden)).toBe("/login"); // B20: not the public landing "/"
    expect(errorFromResponse(502, null).kind).toBe("server");
    expect(errorFromResponse(404, null).kind).toBe("client");
    expect(redirectFor(errorFromResponse(500, null))).toBeNull();
    expect(redirectFor(errorFromResponse(409, { error: "conflict" }))).toBeNull();
  });

  test("AJAX header asks Access for a 401 instead of a redirect", () => {
    expect(AJAX_HEADERS["x-requested-with"]).toBe("XMLHttpRequest");
  });
});

describe("error copy", () => {
  test("every error kind has a title", () => {
    const kinds: ApiErrorKind[] = ["network", "unauthorized", "access", "forbidden", "client", "server"];
    expect(Object.keys(id.common.errorTitles).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(id.common.errorTitles[kind]).toBeTruthy();
  });

  test("known code first, then 4xx server message, then per kind", () => {
    const conflict = errorFromResponse(409, { error: "name_taken", message: "Name taken" });
    expect(apiErrorMessage(conflict, { name_taken: "Nama sudah dipakai." })).toBe("Nama sudah dipakai.");
    expect(apiErrorMessage(conflict)).toBe("Name taken");
    expect(apiErrorMessage(errorFromResponse(503, null))).toBe(id.common.errors.server);
    expect(apiErrorMessage(new Error("x"))).toBe(id.common.errors.generic);
  });
});
