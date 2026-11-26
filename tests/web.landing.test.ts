import { describe, expect, test } from "bun:test";
import type { Role } from "@/shared/roles";
import { landingCta } from "@/web/landing/landing.cta";
import type { MeResult } from "@/web/session/session.api";

// test-only fixture
const as = (role: Role): MeResult => ({
  status: "ok",
  me: { id: "u1", email: "a@example.test", name: "A", image: null, role, home: "https://evil.example" },
});

describe("landingCta", () => {
  test("anonymous visitor → sign in via /login", () => {
    expect(landingCta({ status: "unauthorized" })).toEqual({
      kind: "signIn",
      label: "Masuk dengan Google",
      to: "/login",
    });
  });

  test("no loader data yet → sign in", () => expect(landingCta(undefined).to).toBe("/login"));

  test.each([
    ["user", "/profile"],
    ["admin", "/panel"],
    ["super_admin", "/panel"],
  ] as const)("%s → open panel at %s (from role, not payload)", (role, home) => {
    expect(landingCta(as(role))).toEqual({ kind: "open", label: "Buka panel", to: home });
  });
});
