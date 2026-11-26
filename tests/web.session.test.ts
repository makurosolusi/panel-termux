import { describe, expect, test } from "bun:test";
import { homeFor, isProtectedPath, type Role } from "@/shared/roles";
import type { MeResult } from "@/web/session/session.api";
import { sessionErrorKind } from "@/web/session/session.error";
import { needsFullLoad, notFoundKind, resolveRedirect } from "@/web/session/session.redirect";
import { ApiError } from "@/web/shared/api.client";

// test-only fixture
const as = (role: Role, home = "/elsewhere"): MeResult => ({
  status: "ok",
  me: { id: "u1", email: "a@example.test", name: "A", image: null, role, home, createdAt: "2026-01-01T00:00:00.000Z" },
});
const anon: MeResult = { status: "unauthorized" };

describe("resolveRedirect", () => {
  test.each([
    ["anon", anon, "/", null],
    ["anon", anon, "/profile", "/login"],
    ["anon", anon, "/dev", "/login"],
    ["anon", anon, "/login", null],
    ["user", as("user"), "/dev", "/profile"],
    ["user", as("user"), "/panel", "/profile"],
    ["user", as("user"), "/profile", null],
    ["admin", as("admin"), "/dev", "/panel"],
    ["admin", as("admin"), "/panel", null],
    ["admin", as("admin"), "/profile", null],
    ["super_admin", as("super_admin"), "/panel", null],
    ["super_admin", as("super_admin"), "/dev", null],
    ["user", as("user"), "/login", "/profile"],
    ["admin", as("admin"), "/login", "/panel"],
    ["super_admin", as("super_admin"), "/login", "/panel"],
    ["user", as("user"), "/", null],
    ["admin", as("admin"), "/", null],
    ["super_admin", as("super_admin"), "/", null],
    ["anon", anon, "/panel/sites", "/login"],
    ["anon", anon, "/nope", null], // public 404 (A7), not /login
    ["anon", anon, "/hargaa", null],
    ["anon", anon, "/panelx", null],
    ["anon", anon, "/panel/sites/blog", "/login"],
  ] as const)("%s on %s → %p", (_label, result, path, expected) => {
    expect(resolveRedirect(result, path)).toBe(expected);
  });

  test("home comes from the role, not from the server-provided `home` field", () => {
    expect(resolveRedirect(as("user", "https://evil.example"), "/login")).toBe("/profile");
  });
});

describe("areas, home, 404 and root errors", () => {
  test("protected paths are per segment", () => {
    expect(isProtectedPath("/panelx")).toBe(false);
    expect(isProtectedPath("/panel")).toBe(true);
    expect(isProtectedPath("/dev/users")).toBe(true);
    expect(isProtectedPath("/login")).toBe(false);
  });

  test("super_admin lands on Ringkasan (A11)", () => expect(homeFor("super_admin")).toBe("/panel"));

  test("unknown path: guests get the public 404, signed-in users the shell 404", () => {
    expect(notFoundKind(anon)).toBe("public");
    expect(notFoundKind(as("user"))).toBe("shell");
    expect(notFoundKind(as("super_admin"))).toBe("shell");
  });

  test("root error kinds: chunk, network, server", () => {
    expect(sessionErrorKind(new TypeError("Failed to fetch dynamically imported module: /chunk-abc.js"))).toBe("chunk");
    expect(sessionErrorKind(new ApiError("network", null, null, null))).toBe("network");
    expect(sessionErrorKind(new ApiError("server", 502, null, null))).toBe("server");
    expect(sessionErrorKind(new Error("boom"))).toBe("server");
  });
});

describe("needsFullLoad", () => {
  test.each([
    ["/login", "/profile", true],
    ["/login", "/panel", true],
    ["/login", "/dev", true],
    ["/panel", "/login", false],
    ["/login", "/login", false],
    ["/dev", "/panel", false],
    ["/panel/sites", "/login", false],
  ] as const)("%s → %s: %p", (from, to, expected) => expect(needsFullLoad(from, to)).toBe(expected));

  test("signed-in visitor on /login: full load to a home that is never /login (no loop)", () => {
    for (const role of ["user", "admin", "super_admin"] as const) {
      const to = resolveRedirect(as(role), "/login");
      expect(to).not.toBeNull();
      expect(to).not.toBe("/login");
      expect(needsFullLoad("/login", to as string)).toBe(true);
      expect(resolveRedirect(as(role), to as string)).toBeNull(); // landing on home redirects no further
    }
  });
});
