import { describe, expect, test } from "bun:test";
import type { MeSession } from "@/shared/me.types";
import { signInErrorMessage, tAccount } from "@/web/i18n/en.account";
import { loginErrorMessage } from "@/web/pages/login.error";
import { canSelfDelete } from "@/web/pages/profile.delete";
import { needsAccess } from "@/web/pages/profile.no-access";
import { hasOtherSessions, sessionActiveLabel, sessionDevice } from "@/web/pages/profile.sessions";

const e = tAccount.signIn.errors;

describe("sign-in error mapping", () => {
  test("no ?error → no message", () => {
    expect(loginErrorMessage(new URLSearchParams(""))).toBeNull();
    expect(signInErrorMessage(null)).toBeNull();
  });
  test.each([
    ["access_denied", e.cancelled],
    ["state_mismatch", e.state],
    ["state_not_found", e.state],
    ["email_not_verified", e.email],
    ["unable_to_get_user_info", e.generic],
    ["__proto__", e.generic],
  ])("%p → dictionary text", (code, message) => {
    expect(loginErrorMessage(new URLSearchParams({ error: code }))).toBe(message);
  });
  test("error_description and the raw code are never rendered", () => {
    const evil = "<b>Phishing: call +1 555</b>";
    const msg = loginErrorMessage(new URLSearchParams({ error: "evil_code_xyz", error_description: evil }));
    expect(msg).toBe(e.generic);
    expect(msg).not.toContain("evil_code_xyz");
    expect(msg).not.toContain("Phishing");
  });
});

describe("session row formatting", () => {
  test("device line in Indonesian, unknown → Perangkat tidak dikenal", () => {
    expect(sessionDevice("Chrome di Android")).toBe("Chrome di Android");
    expect(sessionDevice("")).toBe(tAccount.sessions.unknownDevice);
    expect(sessionDevice(null)).toBe(tAccount.sessions.unknownDevice);
  });
  test("last activity at day resolution", () => {
    const now = new Date(2026, 10, 27, 0, 30); // just after local midnight
    expect(sessionActiveLabel(new Date(2026, 10, 27, 0, 5).toISOString(), now)).toBe("Aktif hari ini");
    expect(sessionActiveLabel(new Date(2026, 10, 26, 23, 59).toISOString(), now)).toBe("Aktif kemarin");
    const old = sessionActiveLabel(new Date(2026, 10, 20, 12).toISOString(), now);
    expect(old.startsWith("Aktif ")).toBe(true);
    expect(old).toContain("2026");
    expect(old).toContain("20");
    expect(sessionActiveLabel("not-a-date", now)).toBe("Aktif –");
  });
  test("revoke-others offered only when another session exists", () => {
    const row = (id: string, current: boolean): MeSession => ({
      id,
      current,
      createdAt: "2026-11-27T00:00:00.000Z",
      lastActiveAt: "2026-11-27T00:00:00.000Z",
      userAgent: null,
      ipMasked: null,
    });
    expect(hasOtherSessions([row("a", true)])).toBe(false);
    expect(hasOtherSessions([row("a", true), row("b", false)])).toBe(true);
    expect(hasOtherSessions([])).toBe(false);
  });
});

describe("role-dependent profile cards", () => {
  test("no-access card only for user", () => {
    expect(needsAccess("user")).toBe(true);
    expect(needsAccess("admin")).toBe(false);
    expect(needsAccess("super_admin")).toBe(false);
  });
  test("self-delete only for user (server answers 403 otherwise)", () => {
    expect(canSelfDelete("user")).toBe(true);
    expect(canSelfDelete("admin")).toBe(false);
    expect(canSelfDelete("super_admin")).toBe(false);
  });
  test("no-access copy gives concrete steps and links to install your own", () => {
    expect(tAccount.noAccess.steps).toHaveLength(3);
    expect(tAccount.noAccess.ownServerHref).toBe("/#pasang");
  });
});

describe("delete-account copy (D-W9-2)", () => {
  test("says plainly what is removed and that audit keeps name/email for the retention period", () => {
    const body = tAccount.deleteAccount.body;
    expect(body).toContain("sesi");
    expect(body).toContain("audit");
    expect(body).toContain("nama dan email");
    expect(body).toContain("365 hari");
    expect(body).not.toContain("Email dan namamu dihapus");
  });
});
