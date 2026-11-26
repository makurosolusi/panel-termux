import { describe, expect, test } from "bun:test";
import { canAccess, homeFor, isKnownSpaPath, isProtectedPath } from "@/shared/roles";

describe("roles", () => {
  test("homeFor maps each role to its landing page (super_admin → Ringkasan, A11)", () => {
    expect(homeFor("user")).toBe("/profile");
    expect(homeFor("admin")).toBe("/panel");
    expect(homeFor("super_admin")).toBe("/panel");
  });

  test.each([
    ["user", "/profile", true],
    ["user", "/panel", false],
    ["user", "/dev", false],
    ["admin", "/profile", true],
    ["admin", "/panel/apps", true],
    ["admin", "/dev", false],
    ["super_admin", "/dev/settings", true],
    ["super_admin", "/panel", true],
    ["user", "/login", true],
    ["user", "/panelx", true], // not under /panel; prefix match is per path segment
  ] as const)("canAccess(%s, %s) = %p", (role, path, ok) => {
    expect(canAccess(role, path)).toBe(ok);
  });

  test.each([
    ["/profile", true],
    ["/panel/sites/shop", true],
    ["/dev/", true],
    ["/panelx", false],
    ["/", false],
    ["/login", false],
    ["/hargaa", false],
  ] as const)("isProtectedPath(%s) = %p", (path, protectedPath) => {
    expect(isProtectedPath(path)).toBe(protectedPath);
  });

  test.each([
    ["/", true],
    ["/login", true],
    ["/profile", true],
    ["/panel/jobs/123", true],
    ["/dev/settings", true],
    ["/hargaa", false],
    ["/panelx", false],
    ["/favicon.ico", false],
    ["", false],
  ] as const)("isKnownSpaPath(%s) = %p", (path, known) => {
    expect(isKnownSpaPath(path)).toBe(known);
  });
});
