import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as sharedFormat from "@/shared/format.number";
import { activeLocale, setActiveLocale } from "@/shared/i18n";
import type { Role } from "@/shared/roles";
import { backupRoutes } from "@/web/backup/backup.routes";
import { typedMatches } from "@/web/components/confirm-action";
import { ROLE_TONE } from "@/web/components/role-badge";
import { usageTone } from "@/web/components/stat-tile";
import { devRoutes } from "@/web/dev/dev.routes";
import { documentTitle } from "@/web/layout/document.title";
import {
  activeInMore,
  activeNavTo,
  breadcrumbsFor,
  MOBILE_PRIMARY,
  mobileNavFor,
  navGroupsFor,
  navMatch,
} from "@/web/layout/nav.items";
import { routeMeta } from "@/web/layout/shell.page";
import { panelRoutes } from "@/web/panel/panel.routes";
import { HEALTH_URL, recoverChunk, serverReachable } from "@/web/shared/chunk.error";
import * as webFormat from "@/web/shared/format";
import {
  formatBytes,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatLoadPerCore,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/web/shared/format";
import { siteRoutes } from "@/web/site/site.routes";
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

  test("breadcrumbs: at most 3, intermediate URL segments never become crumbs", () => {
    expect(breadcrumbsFor("/panel/services/sshd/log", "sshd log")).toEqual([
      { label: "Server" },
      { label: "Services", to: "/panel/services" },
      { label: "sshd log" },
    ]);
    const uuid = "0b7e2a4c-3f1d-4a8e-9c2b-5d6e7f8a9b0c"; // test-only
    const job = breadcrumbsFor(`/panel/jobs/${uuid}`, "Change progress");
    expect(job).toEqual([
      { label: "Server" },
      { label: "Change history", to: "/panel/jobs" },
      { label: "Change progress" },
    ]);
    expect(JSON.stringify(job)).not.toContain(uuid);
    expect(breadcrumbsFor("/panel/sites", "Sites")).toEqual([{ label: "Server" }, { label: "Sites" }]);
    expect(breadcrumbsFor("/panel/sites/blog", null)).toEqual([
      { label: "Server" },
      { label: "Sites", to: "/panel/sites" },
    ]);
    expect(breadcrumbsFor("/nope", "x")).toEqual([]);
  });

  test("breadcrumbs: problem history is a hidden Server page, not in the 'More' sheet", () => {
    expect(navMatch("/panel/problems")?.item.to).toBe("/panel/problems");
    expect(breadcrumbsFor("/panel/problems", "Problem history")).toEqual([
      { label: "Server" },
      { label: "Problem history" },
    ]);
    expect(activeInMore("/panel/problems", mobileNavFor("super_admin").more)).toBe(false);
  });

  test("every breadcrumb link points at a nav item (an existing route)", () => {
    const navPaths = new Set(navGroupsFor("super_admin").flatMap((g) => g.items.map((i) => i.to)));
    navPaths.add("/panel/jobs");
    for (const path of ["/panel/sites/blog", "/panel/apps/x/log", "/dev/users/1", "/panel/jobs/1"]) {
      const crumbs = breadcrumbsFor(path, "T");
      expect(crumbs.length).toBeLessThanOrEqual(3);
      for (const c of crumbs) if (c.to) expect(navPaths.has(c.to)).toBe(true);
    }
  });

  test("document title", () => {
    expect(documentTitle("Situs")).toBe("Situs · Panel Termux");
  });
});

describe("phone navigation", () => {
  test("user: no bottom bar, nothing in the sheet", () => {
    expect(mobileNavFor("user")).toEqual({ primary: [], more: [] });
  });

  test("admin: four primary slots, sheet has the rest of Server only", () => {
    const { primary, more } = mobileNavFor("admin");
    expect(primary.map((i) => i.to)).toEqual([...MOBILE_PRIMARY]);
    expect(more.map((g) => [g.key, g.items.map((i) => i.to)])).toEqual([
      ["server", ["/panel/domains", "/panel/databases", "/panel/backups"]],
    ]);
  });

  test("super_admin: Administrasi first in the sheet, then Domain/Database/Cadangan; Akun never a group", () => {
    const { primary, more } = mobileNavFor("super_admin");
    expect(primary).toHaveLength(4);
    expect(more.map((g) => g.key)).toEqual(["admin", "server"]);
  });

  test("'Lainnya' marks pages that live in the sheet", () => {
    const { more } = mobileNavFor("super_admin");
    expect(activeInMore("/dev/users", more)).toBe(true);
    expect(activeInMore("/panel/backups", more)).toBe(true);
    expect(activeInMore("/profile", more)).toBe(true);
    expect(activeInMore("/panel/sites/blog", more)).toBe(false);
    expect(activeInMore("/panel", more)).toBe(false);
  });

  test("hidden pages highlight their parent link (sidebar + bottom bar), visible pages themselves", () => {
    expect(activeNavTo("/panel/jobs")).toBe("/panel/sites");
    expect(activeNavTo("/panel/jobs/job-1")).toBe("/panel/sites");
    expect(activeNavTo("/panel/problems")).toBe("/panel");
    expect(activeNavTo("/panel/sites/blog")).toBe("/panel/sites");
    expect(activeNavTo("/panel")).toBe("/panel");
    expect(activeNavTo("/dev/users/1")).toBe("/dev/users");
    expect(activeNavTo("/nope")).toBeNull();
    expect(MOBILE_PRIMARY).toContain(activeNavTo("/panel/jobs") as string);
  });
});

describe("route titles", () => {
  test("deepest handle title wins; task on any match", () => {
    expect(routeMeta([{ handle: { title: "A" } }, {}, { handle: { title: "B", task: true } }])).toEqual({
      title: "B",
      task: true,
    });
    expect(routeMeta([{}, { handle: "junk" }])).toEqual({ title: null, task: false });
  });

  test("every signed-in route entry has handle.title; the wizard is a task route", () => {
    type R = { path?: string; handle?: unknown; children?: R[] };
    const leaves = (rs: R[]): R[] => rs.flatMap((r) => (r.children ? leaves(r.children) : [r]));
    // app.routes itself pulls the browser-only auth client; it only concatenates these four arrays
    const all = leaves([...panelRoutes, ...siteRoutes, ...backupRoutes, ...devRoutes] as R[]);
    // 19 = every leaf of the four arrays; a new route must bump this and carry a title
    expect(all.length).toBe(19);
    expect(routeMeta(all.filter((r) => r.path === "/panel/problems")).title).toBe("Problem history");
    for (const r of all) expect(routeMeta([r]).title, r.path).toBeTruthy();
    expect(routeMeta(all.filter((r) => r.path === "/panel/sites/new")).task).toBe(true);
    expect(routeMeta(all.filter((r) => r.path === "/panel/sites")).task).toBe(false);
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
  test("role tones", () => {
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
  // English (default locale) output, literal; the Indonesian number/date variants are pinned in the block below and
  // byte-exact in tests/format.number.test.ts.

  test("durations", () => {
    expect(formatDuration(3)).toBe("3 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(437)).toBe("7 min 17 s");
    expect(formatDuration(Number.NaN)).toBe("–");
  });

  test("relative time", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const ago = (s: number) => new Date(now.getTime() - s * 1000);
    expect(formatRelative(ago(2), now)).toBe("just now");
    expect(formatRelative(ago(-30), now)).toBe("just now");
    expect(formatRelative(ago(59), now)).toBe("just now"); // D16: seconds are never shown
    expect(formatRelative(ago(60), now)).toBe("1 min ago");
    expect(formatRelative(ago(3 * 60 + 20), now)).toBe("3 min ago");
    expect(formatRelative(ago(2 * 3600 + 5), now)).toBe("2 h ago");
    expect(formatRelative(ago(2 * 3600 + 5 * 60 + 9), now)).toBe("2 h 5 min ago");
    expect(formatRelative(ago(86_400 + 60), now)).toBe("yesterday");
    expect(formatRelative(ago(-57 * 60), now)).toBe("in 57 min"); // a coming backup is never "just now"
    expect(formatRelative(ago(-2 * 86_400), now)).toMatch(/2026/);
    expect(formatRelative(ago(4 * 86_400), now)).toBe("4 days ago");
    expect(formatRelative(ago(30 * 86_400), now)).toMatch(/2026/);
    expect(formatRelative("nope", now)).toBe("–");
    expect(formatRelative(null, now)).toBe("–");
  });

  test("relative days follow the local calendar, not 24 h blocks", () => {
    const now = new Date(2026, 10, 27, 2, 30); // 27 Nov 02:30 local
    expect(formatRelative(new Date(2026, 10, 25, 23, 52), now)).toBe("2 days ago"); // 26 h ago, 2 calendar days
    expect(formatRelative(new Date(2026, 10, 26, 1, 0), now)).toBe("yesterday");
    expect(formatRelative(new Date(2026, 10, 26, 20, 0), now)).toBe("6 h 30 min ago");
  });

  test("bytes, megabytes, numbers, percent", () => {
    expect(formatMegabytes(3776)).toBe("3.7 GB");
    expect(formatMegabytes(11_269)).toBe("11.0 GB");
    expect(formatMegabytes(512)).toBe("512 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(64 * 1024 ** 3)).toBe("64.0 GB");
    expect(formatBytes(232 * 1024 ** 3)).toBe("232.0 GB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(1.5 * 1024)).toBe("1.5 KB");
    expect(formatNumber(12_345.67, 1)).toBe("12,345.7");
    expect(formatPercent(42.25)).toBe("42%");
    expect(formatPercent(42.25, 1)).toBe("42.3%");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("–");
  });

  test("web formatters are the shared ones bound to the active locale", () => {
    const l = activeLocale();
    expect(l).toBe("en");
    expect(webFormat.formatBytes(1536)).toBe(sharedFormat.formatBytes(1536, l));
    expect(webFormat.formatDuration(437)).toBe(sharedFormat.formatDuration(437, l));
    expect(webFormat.formatNumber(1234.5, 1)).toBe(sharedFormat.formatNumber(1234.5, 1, l));
    expect(webFormat.formatPercent(42.25, 1)).toBe(sharedFormat.formatPercent(42.25, 1, l));
    expect(webFormat.formatMegabytes(3776)).toBe(sharedFormat.formatMegabytes(3776, l));
    expect(webFormat.formatTemperature(36.5)).toBe(sharedFormat.formatTemperature(36.5, l));
  });

  test("log clock and day label in local time", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Jakarta"; // test-only: UTC+7, restored below so other files keep the host zone
    try {
      expect(formatClock("2026-11-26T14:54:07.234Z")).toBe("21:54:07");
      expect(formatClock(null)).toBe("");
      expect(formatClock("nope")).toBe("");
      expect(formatDayLabel("2026-11-26T14:54:07Z")).toBe("Thursday, Nov 26, 2026");
      expect(formatDayLabel(null)).toBe("");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test("load average per core", () => {
    expect(formatLoadPerCore(17.55, 8)).toEqual({ text: "17.6 / 8 cores", tone: "danger" });
    expect(formatLoadPerCore(6, 8)).toEqual({ text: "6 / 8 cores", tone: "warning" });
    expect(formatLoadPerCore(1.2, 8)).toEqual({ text: "1.2 / 8 cores", tone: "success" });
    expect(formatLoadPerCore(1.2, null)).toEqual({ text: "1.2", tone: "neutral" });
    expect(formatLoadPerCore(-1, 8)).toEqual({ text: "–", tone: "neutral" });
  });
});

describe("formatters (shell, id)", () => {
  // Intl- and format.number-backed output in Indonesian; dictionary words come from the id pack (tests/i18n.boot).
  beforeAll(() => setActiveLocale("id"));
  afterAll(() => setActiveLocale("en")); // module singleton: restore so later files run in the default locale

  test("numbers, clock and day label", () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1,5 GB");
    expect(formatNumber(12_345.67, 1)).toBe("12.345,7");
    expect(formatDuration(437)).toBe("7 mnt 17 dtk");
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Jakarta"; // test-only: UTC+7, restored below so other files keep the host zone
    try {
      expect(formatClock("2026-11-26T14:54:07.234Z")).toBe("21.54.07");
      expect(formatDayLabel("2026-11-26T14:54:07Z")).toBe("Kamis, 26 Nov 2026");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

describe("typed confirmation", () => {
  test("trims input but is case-sensitive", () => {
    expect(typedMatches(" blog ", "blog")).toBe(true);
    expect(typedMatches("Blog", "blog")).toBe(false);
  });
});

describe("chunk recovery (server down ≠ stale bundle)", () => {
  const reloads: string[] = [];
  const reload = (key: string) => {
    reloads.push(key);
    return true;
  };
  test("server down → offline, no reload (stays in the app instead of a browser error page)", async () => {
    reloads.length = 0;
    expect(await recoverChunk("k", { reachable: async () => false, reload })).toBe("offline");
    expect(reloads).toEqual([]);
  });
  test("server answers → reload once; already reloaded → stale", async () => {
    reloads.length = 0;
    expect(await recoverChunk("k", { reachable: async () => true, reload })).toBe("reloading");
    expect(reloads).toEqual(["k"]);
    expect(await recoverChunk("k", { reachable: async () => true, reload: () => false })).toBe("stale");
  });
  test("serverReachable: 2xx only; a network error or a proxy 502 counts as down", async () => {
    const seen: string[] = [];
    const ok = (async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await serverReachable(ok)).toBe(true);
    expect(seen).toEqual([HEALTH_URL]);
    const proxy502 = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
    expect(await serverReachable(proxy502)).toBe(false);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await serverReachable(offline)).toBe(false);
  });
});
