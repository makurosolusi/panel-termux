import { describe, expect, test } from "bun:test";
import type { Role } from "@/shared/roles";
import { ROLE_TONE } from "@/web/components/role-badge";
import { usageTone } from "@/web/components/stat-tile";
import { LEGACY_TONE, toneForStatus } from "@/web/components/status.tone";
import { breadcrumbsFor, documentTitleFor, navGroupsFor, navMatch } from "@/web/layout/nav.items";
import {
  formatBytes,
  formatDuration,
  formatLoadPerCore,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/web/shared/format";
import {
  parsePreference,
  readPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writePreference,
} from "@/web/theme/theme.preference";

describe("navigation by role", () => {
  const links = (role: Role) => navGroupsFor(role).map((g) => [g.key, g.items.map((i) => i.to)]);

  test("user sees only Profil", () => {
    expect(links("user")).toEqual([["account", ["/profile"]]]);
  });

  test("admin sees Server + Profil, never Administrasi", () => {
    const groups = links("admin");
    expect(groups.map(([k]) => k)).toEqual(["server", "account"]);
    expect(groups[0]?.[1]).toEqual([
      "/panel",
      "/panel/sites",
      "/panel/services",
      "/panel/apps",
      "/panel/domains",
      "/panel/databases",
      "/panel/backups",
    ]);
  });

  test("super_admin sees all three groups", () => {
    const groups = links("super_admin");
    expect(groups.map(([k]) => k)).toEqual(["server", "admin", "account"]);
    expect(groups[1]?.[1]).toEqual(["/dev", "/dev/users", "/dev/audit", "/dev/logs", "/dev/settings"]);
  });
});

describe("route meta", () => {
  test("index routes match only exactly; children match their section", () => {
    expect(navMatch("/panel")?.item.to).toBe("/panel");
    expect(navMatch("/panel/sites/blog")?.item.to).toBe("/panel/sites");
    expect(navMatch("/panel/jobs/42")?.item.to).toBe("/panel/jobs");
    expect(navMatch("/dev/")?.item.to).toBe("/dev");
    expect(navMatch("/nope")).toBeNull();
  });

  test("breadcrumbs: group, page, decoded segments; last one is current", () => {
    expect(breadcrumbsFor("/panel/services/my%20svc/log")).toEqual([
      { label: "Server" },
      { label: "Layanan", to: "/panel/services" },
      { label: "my svc", to: "/panel/services/my%20svc" },
      { label: "Log" },
    ]);
    expect(breadcrumbsFor("/panel/sites/%E0%A4%A")).toContainEqual({ label: "%E0%A4%A" });
    expect(breadcrumbsFor("/nope")).toEqual([]);
  });

  test("document titles", () => {
    expect(documentTitleFor("/panel/sites", "x")).toBe("Situs · Panel Termux");
    expect(documentTitleFor("/panel/sites/new", "x")).toBe("Baru · Situs · Panel Termux");
    expect(documentTitleFor("/nope", "Halaman tidak ditemukan")).toBe("Halaman tidak ditemukan · Panel Termux");
  });
});

describe("theme preference", () => {
  test("parse + resolve", () => {
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("purple")).toBe("system");
    expect(parsePreference(null)).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("storage round-trip and failures fall back safely", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v) };
    expect(readPreference(storage)).toBe("system");
    expect(writePreference(storage, "dark")).toBe(true);
    expect(map.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readPreference(storage)).toBe("dark");
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readPreference(broken)).toBe("system");
    expect(writePreference(broken, "light")).toBe(false);
    expect(readPreference(undefined)).toBe("system");
  });
});

describe("status → tone", () => {
  test.each([
    ["run", "success"],
    ["online", "success"],
    ["succeeded", "success"],
    ["running", "info"],
    ["launching", "warning"],
    ["partial", "warning"],
    ["failed", "danger"],
    ["errored", "danger"],
    ["rolled_back", "danger"],
    ["stopped", "neutral"],
    ["whatever", "neutral"],
  ] as const)("%s → %s", (status, tone) => expect(toneForStatus(status)).toBe(tone));

  test("legacy panel tones and roles", () => {
    expect(LEGACY_TONE).toEqual({ ok: "success", warn: "warning", bad: "danger", muted: "neutral" });
    expect(ROLE_TONE.super_admin).toBe("accent"); // privileged, not dangerous: never red
    expect(ROLE_TONE.admin).toBe("info");
  });

  test("usage thresholds", () => {
    expect(usageTone(40)).toBe("success");
    expect(usageTone(75)).toBe("warning");
    expect(usageTone(95)).toBe("danger");
    expect(usageTone(86, { warn: 85, danger: 95 })).toBe("warning");
  });
});

describe("formatters (shell)", () => {
  test("durations", () => {
    expect(formatDuration(3)).toBe("3 dtk");
    expect(formatDuration(120)).toBe("2 mnt");
    expect(formatDuration(437)).toBe("7 mnt 17 dtk");
    expect(formatDuration(Number.NaN)).toBe("–");
  });

  test("relative time", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const ago = (s: number) => new Date(now.getTime() - s * 1000);
    expect(formatRelative(ago(2), now)).toBe("baru saja");
    expect(formatRelative(ago(-30), now)).toBe("baru saja");
    expect(formatRelative(ago(42), now)).toBe("42 dtk lalu");
    expect(formatRelative(ago(3 * 60 + 20), now)).toBe("3 mnt lalu");
    expect(formatRelative(ago(2 * 3600 + 5), now)).toBe("2 jam lalu");
    expect(formatRelative(ago(86_400 + 60), now)).toBe("kemarin");
    expect(formatRelative(ago(4 * 86_400), now)).toBe("4 hari lalu");
    expect(formatRelative(ago(30 * 86_400), now)).toMatch(/2026/);
    expect(formatRelative("nope", now)).toBe("–");
    expect(formatRelative(null, now)).toBe("–");
  });

  test("bytes, megabytes, numbers, percent", () => {
    expect(formatMegabytes(3776)).toBe("3,7 GB");
    expect(formatMegabytes(11_269)).toBe("11 GB");
    expect(formatMegabytes(512)).toBe("512 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1,5 GB");
    expect(formatNumber(12_345.67, 1)).toBe("12.345,7");
    expect(formatPercent(42.25)).toBe("42%");
    expect(formatPercent(42.25, 1)).toBe("42,3%");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("–");
  });

  test("load average per core", () => {
    expect(formatLoadPerCore(17.55, 8)).toEqual({ text: "17,6 / 8 inti", tone: "danger" });
    expect(formatLoadPerCore(6, 8)).toEqual({ text: "6 / 8 inti", tone: "warning" });
    expect(formatLoadPerCore(1.2, 8)).toEqual({ text: "1,2 / 8 inti", tone: "success" });
    expect(formatLoadPerCore(1.2, null)).toEqual({ text: "1,2", tone: "neutral" });
    expect(formatLoadPerCore(-1, 8)).toEqual({ text: "–", tone: "neutral" });
  });
});
