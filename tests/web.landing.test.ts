import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OG_TEXT } from "@/server/http/seo";
import type { Role } from "@/shared/roles";
import { tLanding } from "@/web/i18n/en.landing";
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
    expect(OG_TEXT).toEqual(tLanding.meta);
    expect(tLanding.meta.description.length).toBeLessThanOrEqual(155);
  });

  test("install line = PLAN/07 K24 with the release asset `panel` the packager publishes", () => {
    const cmd = tLanding.install.command;
    expect(cmd).toBe(
      "cd && curl -fL --retry 3 -o panel-termux https://github.com/makurosolusi/panel-termux/releases/latest/download/panel && chmod +x panel-termux && ./panel-termux init",
    );
    // `cd` first: ~/storage/shared is noexec (E13); local name is not `panel` because ~/panel is the install dir (Q14)
    expect(cmd.startsWith("cd && ")).toBe(true);
    expect(cmd).not.toMatch(/-o panel( |$)/);
    const asset = cmd.match(/releases\/latest\/download\/(\S+)/)?.[1];
    const packager = readFileSync(join(import.meta.dir, "../scripts/package-release.sh"), "utf8");
    expect(packager).toContain(`"$OUT/${asset}"`);
    expect(packager).toMatch(new RegExp(`sha256sum ${asset} `));
  });

  test("install steps: one line, what init asks (Google OAuth, Cloudflare login), then open the panel", () => {
    const steps = tLanding.install.steps;
    expect(steps.map((s) => s.title)).toEqual([
      "Jalankan baris ini di Termux",
      "Jawab pertanyaan init",
      "Login Cloudflare di browser",
      "Buka panel",
    ]);
    expect(steps[1].body).toContain("Client secret");
    expect(tLanding.install.upgrade).toContain("baris yang sama");
    const all = JSON.stringify(tLanding);
    for (const gone of ["install.sh", "install-phone", "pkg install termux-services", "tutup dan buka lagi"])
      expect(all).not.toContain(gone);
  });

  test("no overclaims: no one-command promise, no Google sign-in CTA, no binary-size spec", () => {
    const all = JSON.stringify(tLanding);
    expect(all).not.toMatch(/1 perintah|satu perintah/i);
    expect(Object.values(tLanding.cta)).not.toContain("Masuk dengan Google");
    expect(all).not.toContain("~110");
    expect(all).toContain("~65");
  });

  test("footer links point at the public repo files", () => {
    expect(tLanding.links.license).toBe("https://github.com/makurosolusi/panel-termux/blob/main/LICENSE");
    expect(tLanding.links.changelog).toBe("https://github.com/makurosolusi/panel-termux/blob/main/CHANGELOG.md");
    expect(tLanding.links.releases).toBe("https://github.com/makurosolusi/panel-termux/releases");
  });
});

describe("screenshots", () => {
  test("four shots with alt text; gallery = the three non-hero shots", () => {
    expect(Object.keys(SHOTS).sort()).toEqual(["health", "overview", "services", "sites"]);
    for (const shot of Object.values(SHOTS)) expect(tLanding.shots.items[shot.key].alt.length).toBeGreaterThan(20);
    expect(GALLERY).toEqual(["sites", "health", "services"]);
  });

  test("all 8 variants point at their own WebP file in src/web/assets/landing", () => {
    const files = Object.values(SHOTS).flatMap((s) => [s.light, s.dark]);
    expect(files).toHaveLength(8);
    for (const shot of Object.values(SHOTS)) {
      const suffix = `${shot.key}-${shot.device === "phone" ? "m" : "d"}`;
      expect(shot.light).toMatch(new RegExp(`${suffix}-light.*\\.webp$`));
      expect(shot.dark).toMatch(new RegExp(`${suffix}-dark.*\\.webp$`));
    }
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
