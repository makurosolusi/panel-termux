// QA fix-07 follow-ups in the UI: apps a template ecosystem drops (MAJOR-N2), the "Check again" count (MAJOR-N1)
// and the plain label of pm2's guard (N4).
import { describe, expect, test } from "bun:test";
import type { FixEffects, FixPreview } from "@/shared/fix.types";
import type { Integration, IntegrationCheck } from "@/shared/site.types";
import { tSite } from "@/web/i18n/en.site";
import { appNamesText } from "@/web/i18n/en.site.setup";
import { restartDescription, restartTier } from "@/web/site/setup.actions";
import { applicableFixes, fixSummary, remainingProblems } from "@/web/site/site.adopt";

const t = tSite.setup;
const sd = t.dialog.sites_dir_create;

// test-only fixtures
const effects = (over: Partial<FixEffects>): FixEffects => ({
  keepApps: [],
  addApps: [],
  guard: false,
  oldSpread: false,
  appliesOnRestart: true,
  dir: null,
  newEcosystem: "/h/sites/ecosystem.config.js",
  ...over,
});
const preview = (over: Partial<FixEffects>): FixPreview => ({
  key: "sites_dir_create",
  files: [],
  effects: effects(over),
});
const check = (key: IntegrationCheck["key"], state: IntegrationCheck["state"]): IntegrationCheck => ({
  key,
  state,
  params: {},
  detail: null,
});
const integration = (over: Partial<Integration>) =>
  ({ issues: [], checks: [], lastFixes: [], appNames: ["pm2-guard", "toko-kopi"], ...over }) as unknown as Integration;

describe("new ecosystem from the template while hand-written apps run (MAJOR-N2)", () => {
  test("the fix dialog names the apps that stop on the next pm2 start instead of 'not disturbed'", () => {
    const lines = fixSummary(preview({ stopApps: ["makuro-solusi", "adminneo"] }));
    expect(lines).toContain(sd.stopApps(["makuro-solusi", "adminneo"]));
    expect(lines).not.toContain(sd.runningSafe);
    expect(lines.join(" ")).toContain("Running but not in this new file: makuro-solusi and adminneo.");
    // missing folder too: same warning after the folder line
    expect(fixSummary(preview({ dir: "/h/sites", stopApps: ["adminneo"] }))[1]).toBe(sd.stopApps(["adminneo"]));
  });

  test("restart confirmation names every app that would not come back, first, and asks for typing pm2", () => {
    const i = integration({ wouldStop: ["makuro-solusi", "adminneo"] });
    const text = restartDescription(i);
    expect(text.startsWith(t.restartPm2Stops(["makuro-solusi", "adminneo"]))).toBe(true);
    expect(text).toContain("so they stop and do not start again: makuro-solusi and adminneo");
    expect(restartTier(i)).toEqual({ tier: "typed", typedValue: "pm2", destructive: true });
    expect(restartTier(integration({ wouldStop: [] }))).toEqual({ tier: "confirm" });
    expect(restartDescription(integration({}))).not.toContain("do not start again");
  });

  test("a missing app the file does not list gets the way back, not a restore hint", () => {
    expect(t.restartNotListed(["adminneo"])).toBe(
      "Not in `ecosystem.config.js`, so pm2 does not run them again: adminneo. Add their entries back to that file, then restart pm2.",
    );
  });
});

describe("pm2's guard reads as a plain label (N4)", () => {
  test("restart copy never shows the internal name", () => {
    expect(appNamesText(["pm2-guard", "toko-kopi"])).toBe("pm2 guard and toko-kopi");
    expect(restartDescription(integration({}))).toContain("pm2 guard and toko-kopi");
    expect(restartDescription(integration({}))).not.toContain("pm2-guard");
    expect(t.restartCheckFailed(["pm2-guard"])).not.toContain("pm2-guard");
  });
});

describe("'Check again' count matches 'Fix all (n)' (MAJOR-N1)", () => {
  const fixes = [
    { key: "ecosystem_block" as const, checks: ["snippet_current" as const], available: true as const },
    { key: "pm2_auto_exit" as const, checks: ["pm2_auto_exit" as const], available: true as const },
  ];
  test("a warning with a fix counts, an optional warning without one does not", () => {
    const i = integration({
      checks: [
        check("snippet_current", "error"),
        check("pm2_auto_exit", "warning"),
        check("cloudflare_token", "warning"),
      ],
      fixes,
    });
    expect(applicableFixes(i)).toHaveLength(2);
    expect(remainingProblems(i)).toBe(2);
  });

  test("after the fixes the same source says nothing is left", () => {
    const i = integration({ checks: [check("snippet_current", "ok"), check("pm2_auto_exit", "ok")], fixes: [] });
    expect(remainingProblems(i)).toBe(0);
  });

  test("an error without a fix still counts", () => {
    expect(remainingProblems(integration({ checks: [check("tunnel", "error")], fixes: [] }))).toBe(1);
  });
});
