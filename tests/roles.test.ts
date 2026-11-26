import { describe, expect, test } from "bun:test";
import { canAccess, homeFor } from "@/shared/roles";

describe("roles", () => {
  test("homeFor maps each role to its landing page", () => {
    expect(homeFor("user")).toBe("/profile");
    expect(homeFor("admin")).toBe("/panel");
    expect(homeFor("super_admin")).toBe("/dev");
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
});
