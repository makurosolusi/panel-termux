import { describe, expect, test } from "bun:test";
import type { Role } from "@/shared/roles";
import { loginErrorMessage } from "@/web/pages/login.error";
import type { MeResult } from "@/web/session/session.api";
import { needsFullLoad, resolveRedirect } from "@/web/session/session.redirect";

// test-only fixture
const as = (role: Role, home = "/elsewhere"): MeResult => ({
  status: "ok",
  me: { id: "u1", email: "a@example.test", name: "A", image: null, role, home },
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
    ["anon", anon, "/nope", "/login"],
  ] as const)("%s on %s → %p", (_label, result, path, expected) => {
    expect(resolveRedirect(result, path)).toBe(expected);
  });

  test("home comes from the role, not from the server-provided `home` field", () => {
    expect(resolveRedirect(as("user", "https://evil.example"), "/login")).toBe("/profile");
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

describe("loginErrorMessage", () => {
  test("no error code → no message", () => expect(loginErrorMessage(null)).toBeNull());
  test.each(["state_mismatch", "access_denied"])("%p → generic message", (code) =>
    expect(loginErrorMessage(code)).toBe(
      "Masuk dengan Google tidak berhasil. Coba lagi; bila terus gagal, pastikan kamu memakai akun Google yang benar.",
    ),
  );
});
