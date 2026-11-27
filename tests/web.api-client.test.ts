import { afterEach, describe, expect, mock, test } from "bun:test";
import { tCommon } from "@/web/i18n/en.common";
import {
  AJAX_HEADERS,
  ApiError,
  type ApiErrorKind,
  apiErrorDetail,
  apiErrorMessage,
  apiFetch,
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
    expect(apiErrorMessage(access)).toBe(`${tCommon.errorTitles.access}. ${tCommon.errorSteps.access}`);

    const forbidden = errorFromResponse(403, { error: "forbidden" });
    expect(forbidden.kind).toBe("forbidden");
    expect(redirectFor(forbidden)).toBe("/login"); // B20: not the public landing "/"
    expect(errorFromResponse(502, null).kind).toBe("server");
    expect(errorFromResponse(404, null).kind).toBe("client");
    expect(redirectFor(errorFromResponse(500, null))).toBeNull();
    expect(redirectFor(errorFromResponse(409, { error: "conflict" }))).toBeNull();
  });

  test("a string `reason` in the body is kept; anything else is null", () => {
    expect(errorFromResponse(422, { error: "not_fixable", reason: "too_large" }).reason).toBe("too_large");
    expect(errorFromResponse(422, { error: "not_fixable", reason: 3 }).reason).toBeNull();
    expect(errorFromResponse(502, null).reason).toBeNull();
  });

  test("detail under an error title is the next step only, never a repeat of the title", () => {
    const network = new ApiError("network", null, null, null);
    expect(apiErrorDetail(network)).toBe(tCommon.errorSteps.network);
    expect(apiErrorDetail(network)).not.toContain(tCommon.errorTitles.network);
    // toasts keep the full sentence: title + next step
    expect(apiErrorMessage(network)).toBe("Can't reach the server. Check your internet connection, then try again.");
    expect(apiErrorDetail(errorFromResponse(503, null))).toBe(tCommon.errorSteps.server);
    expect(apiErrorDetail(errorFromResponse(409, { error: "busy" }), { busy: "Busy right now." })).toBe(
      "Busy right now.",
    );
    expect(apiErrorDetail(new Error("x"))).toBe(tCommon.genericError);
  });

  test("AJAX header asks Access for a 401 instead of a redirect", () => {
    expect(AJAX_HEADERS["x-requested-with"]).toBe("XMLHttpRequest");
  });
});

describe("error copy", () => {
  test("every error kind has a title", () => {
    const kinds: ApiErrorKind[] = ["network", "unauthorized", "access", "forbidden", "client", "server"];
    expect(Object.keys(tCommon.errorTitles).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(tCommon.errorTitles[kind]).toBeTruthy();
  });

  test("known code first, then 4xx server message, then per kind", () => {
    const conflict = errorFromResponse(409, { error: "name_taken", message: "Name taken" });
    expect(apiErrorMessage(conflict, { name_taken: "That name is taken." })).toBe("That name is taken.");
    expect(apiErrorMessage(conflict)).toBe("Name taken");
    expect(apiErrorMessage(errorFromResponse(503, null))).toBe("The server is having problems. Try again in a moment.");
    expect(apiErrorMessage(new Error("x"))).toBe(tCommon.genericError);
  });
});

describe("403 reauth_required stays on the page", () => {
  const realFetch = globalThis.fetch;
  const g = globalThis as { window?: unknown };
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete g.window;
  });

  /** apiFetch against a stubbed fetch answering `status` + JSON `body`; returns the error and the navigations. */
  async function call(status: number, body: unknown) {
    const assign = mock((_to: string) => {});
    g.window = { location: { assign } };
    globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const err = await apiFetch("PATCH", "/api/dev/settings", { include_secrets: true }).catch((e: unknown) => e);
    return { err, to: assign.mock.calls.map((c) => c[0]) };
  }

  test("reauth_required: ApiError with the code, no redirect", async () => {
    const { err, to } = await call(403, { error: "reauth_required", message: "sign in again" });
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("forbidden");
    expect((err as ApiError).code).toBe("reauth_required");
    expect(to).toEqual([]);
    expect(redirectFor(errorFromResponse(403, { error: "reauth_required" }))).toBeNull();
  });

  test("other 403 and panel 401 still navigate to /login", async () => {
    expect((await call(403, { error: "forbidden" })).to).toEqual(["/login"]);
    expect((await call(401, { error: "unauthorized" })).to).toEqual(["/login"]);
  });
});
