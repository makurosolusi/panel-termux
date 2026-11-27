import { describe, expect, test } from "bun:test";
import { signInErrorMessage, tAccount } from "@/web/i18n/en.account";

// Settings and id.dev copy checks live in tests/i18n.settings.test.ts (only tests/i18n.* may import id.*).

describe("en.account", () => {
  test("Better Auth callback codes map to specific messages", () => {
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("access_denied")).toBe(tAccount.signIn.errors.cancelled);
    expect(signInErrorMessage("state_mismatch")).toBe(tAccount.signIn.errors.state);
    expect(signInErrorMessage("state_not_found")).toBe(tAccount.signIn.errors.state);
    expect(signInErrorMessage("email_not_found")).toBe(tAccount.signIn.errors.email);
  });

  test("unknown and prototype-named codes fall back to the generic message", () => {
    expect(signInErrorMessage("unable_to_get_user_info")).toBe(tAccount.signIn.errors.generic);
    expect(signInErrorMessage("constructor")).toBe(tAccount.signIn.errors.generic);
  });

  test("the no-access card gives concrete next steps", () => {
    expect(tAccount.noAccess.steps.length).toBeGreaterThanOrEqual(3);
    expect(tAccount.noAccess.body).toContain("Admin");
  });
});
