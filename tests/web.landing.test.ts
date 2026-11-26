import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OG_TEXT } from "@/server/http/seo";
import type { Role } from "@/shared/roles";
import { idLanding } from "@/web/i18n/id.landing";
import { ACCOUNT_DELETED_HREF, isAccountDeletedSearch } from "@/web/landing/account.deleted";
import { landingCta } from "@/web/landing/landing.cta";
import { GALLERY, imgLoading, SHOTS } from "@/web/landing/landing.shots";
import type { MeResult } from "@/web/session/session.api";

// test-only fixture
const as = (role: Role): MeResult => ({
  status: "ok",
  me: {
    id: "u1",
    email: "a@example.test",
    name: "A",
    image: null,
    role,
    home: "https://evil.example",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
});

describe("landingCta (header account link)", () => {
  test("anonymous visitor → Masuk via /login", () => {
    expect(landingCta({ status: "unauthorized" })).toEqual({ kind: "signIn", label: "Masuk", to: "/login" });
  });

  test("no loader data yet → Masuk", () => expect(landingCta(undefined).kind).toBe("signIn"));

  test("user → Akun saya at /profile", () => {
    expect(landingCta(as("user"))).toEqual({ kind: "account", label: "Akun saya", to: "/profile" });
  });

  test.each(["admin", "super_admin"] as const)("%s → Buka panel at /panel (from role, not payload)", (role) => {
    expect(landingCta(as(role))).toEqual({ kind: "open", label: "Buka panel", to: "/panel" });
  });
});

describe("landing copy", () => {
  test("meta equals the server link preview (OG_TEXT) and fits a search snippet", () => {
    expect(OG_TEXT).toEqual(idLanding.meta);
    expect(idLanding.meta.description.length).toBeLessThanOrEqual(155);
  });

  test("install command uses the release asset URL of B9 and its checksum", () => {
    expect(idLanding.install.command).toBe(
      "curl -fsSLo install.sh https://github.com/makurosolusi/panel-termux/releases/latest/download/install.sh && sh install.sh",
    );
    expect(idLanding.install.steps).toHaveLength(5);
    expect(idLanding.install.steps[0].body).toContain("panel-termux-android-arm64.tar.gz");
    expect(idLanding.install.steps[0].body).toContain("SHA256SUMS");
  });

  test("no overclaims: no one-command promise, no Google sign-in CTA, no binary-size spec", () => {
    const all = JSON.stringify(idLanding);
    expect(all).not.toMatch(/1 perintah|satu perintah/i);
    expect(Object.values(idLanding.cta)).not.toContain("Masuk dengan Google");
    expect(all).not.toContain("~110");
    expect(all).toContain("~65");
  });

  test("footer links point at the public repo files", () => {
    expect(idLanding.links.license).toBe("https://github.com/makurosolusi/panel-termux/blob/main/LICENSE");
    expect(idLanding.links.changelog).toBe("https://github.com/makurosolusi/panel-termux/blob/main/CHANGELOG.md");
    expect(idLanding.links.releases).toBe("https://github.com/makurosolusi/panel-termux/releases");
  });
});

describe("screenshots", () => {
  test("four shots with alt text; gallery = the three non-hero shots", () => {
    expect(Object.keys(SHOTS).sort()).toEqual(["health", "overview", "services", "sites"]);
    for (const shot of Object.values(SHOTS)) expect(idLanding.shots.items[shot.key].alt.length).toBeGreaterThan(20);
    expect(GALLERY).toEqual(["sites", "health", "services"]);
  });

  test("only the hero's light variant gets fetchpriority=high; the rest is lazy", () => {
    expect(imgLoading(true, "light")).toEqual({ loading: "eager", fetchPriority: "high" });
    expect(imgLoading(true, "dark")).toEqual({ loading: "eager", fetchPriority: "auto" });
    expect(imgLoading(false, "light")).toEqual({ loading: "lazy", fetchPriority: "auto" });
  });
});

describe("landing chunk isolation", () => {
  const dir = join(import.meta.dir, "../src/web/landing");
  const sources = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);

  test.each(sources)("%s imports no panel code and not the aggregate i18n", (_file, src) => {
    expect(src).not.toMatch(/from "@\/web\/(panel|dev|site|backup|deploy|pages)\//);
    expect(src).not.toMatch(/from "@\/web\/i18n\/id"/);
  });
});

describe("account-deleted notice", () => {
  test("self-delete lands on / with the marker the landing recognises", () => {
    const url = new URL(ACCOUNT_DELETED_HREF, "https://panel.example");
    expect(url.pathname).toBe("/");
    expect(isAccountDeletedSearch(url.search)).toBe(true);
  });
  test("other or missing query → no notice", () => {
    expect(isAccountDeletedSearch("")).toBe(false);
    expect(isAccountDeletedSearch("?akun=lain")).toBe(false);
  });
});
