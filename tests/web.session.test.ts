import { describe, expect, test } from "bun:test";
import type { Role } from "@/shared/roles";
import { loginErrorMessage } from "@/web/pages/login.error";
import type { MeResult } from "@/web/session/session.api";
import { resolveRedirect } from "@/web/session/session.redirect";

// test-only fixture
const as = (role: Role, home = "/elsewhere"): MeResult => ({
  status: "ok",
  me: { id: "u1", email: "a@example.test", name: "A", image: null, role, home },
});
const anon: MeResult = { status: "unauthorized" };

describe("resolveRedirect", () => {
  test.each([
    ["anon", anon, "/", "/login"],
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
    ["super_admin", as("super_admin"), "/login", "/dev"],
    ["super_admin", as("super_admin"), "/", "/dev"],
  ] as const)("%s on %s → %p", (_label, result, path, expected) => {
    expect(resolveRedirect(result, path)).toBe(expected);
  });

  test("home comes from the role, not from the server-provided `home` field", () => {
    expect(resolveRedirect(as("user", "https://evil.example"), "/login")).toBe("/profile");
  });
});

describe("loginErrorMessage", () => {
  test("no error code → no message", () => expect(loginErrorMessage(null)).toBeNull());
  test("not_invited has its own message", () => expect(loginErrorMessage("not_invited")).toContain("belum diundang"));
  test("other codes fall back to the generic message", () =>
    expect(loginErrorMessage("state_mismatch")).toBe("Gagal masuk. Silakan coba lagi."));
});
