import { afterEach, describe, expect, test } from "bun:test";
import type { MeSession } from "@/shared/me.types";
import { signInErrorMessage, tAccount } from "@/web/i18n/en.account";
import { loginErrorMessage } from "@/web/pages/login.error";
import { canSelfDelete } from "@/web/pages/profile.delete";
import { LANGUAGE_CHOICES, languageChoiceLabel, saveLanguage } from "@/web/pages/profile.language";
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
  test("device line is normalized; old Indonesian rows and unknown → Unknown device", () => {
    expect(sessionDevice("Chrome · Android")).toBe("Chrome · Android");
    expect(sessionDevice("Chrome di Android")).toBe("Chrome · Android");
    expect(sessionDevice("Perangkat tidak dikenal")).toBe("Unknown device");
    expect(sessionDevice("")).toBe("Unknown device");
    expect(sessionDevice(null)).toBe("Unknown device");
  });
  test("last activity at day resolution", () => {
    const now = new Date(2026, 10, 27, 0, 30); // just after local midnight
    expect(sessionActiveLabel(new Date(2026, 10, 27, 0, 5).toISOString(), now)).toBe("Active today");
    expect(sessionActiveLabel(new Date(2026, 10, 26, 23, 59).toISOString(), now)).toBe("Active yesterday");
    const old = sessionActiveLabel(new Date(2026, 10, 20, 12).toISOString(), now);
    expect(old).toBe("Active Nov 20, 2026");
    expect(sessionActiveLabel("not-a-date", now)).toBe("Active –");
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
    expect(body).toContain("sessions");
    expect(body).toContain("audit");
    expect(body).toContain("name and email");
    expect(body).toContain("365 days");
  });
});

describe("profile language card", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  /** In-memory storage + fetch stub recording the PATCH body; `status` is the server answer. */
  const harness = (status: number) => {
    const store = new Map<string, string>([["panel-termux:lang", "id"]]);
    const storage = {
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const sent: { method?: string; url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ method: init.method, url, body: JSON.parse(String(init.body)) });
      return status === 204 ? new Response(null, { status }) : Response.json({ error: "x" }, { status });
    }) as unknown as typeof fetch;
    let reloads = 0;
    return { store, storage, sent, reload: () => void reloads++, reloads: () => reloads };
  };

  test("offers both languages by their own names, then the device option", () => {
    expect(LANGUAGE_CHOICES).toEqual(["en", "id", null]);
    expect(LANGUAGE_CHOICES.map(languageChoiceLabel)).toEqual(["English", "Bahasa Indonesia", "Use device language"]);
  });
  test("a language is saved on the account, cached and applied by one reload", async () => {
    const h = harness(204);
    expect(await saveLanguage("en", h.storage, h.reload)).toBe(true);
    expect(h.sent).toEqual([{ method: "PATCH", url: "/api/me", body: { locale: "en" } }]);
    expect(h.store.get("panel-termux:lang")).toBe("en");
    expect(h.reloads()).toBe(1);
  });
  test("device language sends null and clears the cached choice", async () => {
    const h = harness(204);
    expect(await saveLanguage(null, h.storage, h.reload)).toBe(true);
    expect(h.sent[0]?.body).toEqual({ locale: null });
    expect(h.store.has("panel-termux:lang")).toBe(false);
    expect(h.reloads()).toBe(1);
  });
  test("a failed save keeps the cached choice and does not reload", async () => {
    const h = harness(500);
    expect(await saveLanguage("en", h.storage, h.reload)).toBe(false);
    expect(h.store.get("panel-termux:lang")).toBe("id");
    expect(h.reloads()).toBe(0);
  });
});
