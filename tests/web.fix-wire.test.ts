// 0.4.0 contract pieces in the UI: apps.json rebuild, ecosystem-only folder fix, restart CTA, DNS mode, hand-written
// routes and the missing-folder deploy blocker.
import { describe, expect, test } from "bun:test";
import type { FixBackup, FixEffects, FixPreview } from "@/shared/fix.types";
import type { Integration, SiteDetail } from "@/shared/site.types";
import { DeployApiError } from "@/web/deploy/deploy.api";
import { blockerText, noFolderText, uploadFailure } from "@/web/deploy/deploy.state";
import { tDeploy } from "@/web/i18n/en.deploy";
import { tSite } from "@/web/i18n/en.site";
import { errorFromResponse } from "@/web/shared/api.client";
import { undoDescription } from "@/web/site/setup.undo";
import { fixSummary, previewTitle, restartNeeded } from "@/web/site/site.adopt";
import { hostnameRemoveUrl } from "@/web/site/site.api";
import { wizardDns } from "@/web/site/site.check";

const dl = tSite.setup.dialog;

// test-only fixtures
const NONE: FixEffects = {
  keepApps: [],
  addApps: [],
  guard: false,
  oldSpread: false,
  appliesOnRestart: false,
  dir: null,
  newEcosystem: null,
};
const preview = (key: FixPreview["key"], effects: Partial<FixEffects> = {}): FixPreview => ({
  key,
  files: [],
  effects: { ...NONE, ...effects },
});
const backup = (over: Partial<FixBackup>): FixBackup => ({
  id: "apps_json.20261127-101500-000-0123abcd",
  file: "apps_json",
  at: "2026-11-27T10:15:00Z",
  changedSince: false,
  affectedSites: [],
  ...over,
});

describe("apps.json rebuild", () => {
  test("summary names the sites written back and asks for a pm2 restart", () => {
    const p = preview("apps_json_rebuild", { addApps: ["blog", "shop"], appliesOnRestart: true });
    expect(previewTitle(p)).toBe("Rebuild apps.json?");
    expect(fixSummary(p)).toEqual([
      "`apps.json` is broken, so the panel rewrites it from the panel's site list: blog and shop.",
      dl.restartNote,
    ]);
    expect(fixSummary(preview("apps_json_rebuild", { appliesOnRestart: true }))[0]).toContain("the list is empty");
    expect(dl.restartNote).toContain("Restart pm2");
    expect(dl.restartNote).toContain("Start pm2");
  });

  test("undo of apps.json names the sites pm2 skips after a reboot", () => {
    expect(undoDescription(backup({ affectedSites: ["blog"] }))).toBe(
      "`apps.json` goes back to its old, broken content, so pm2 does not run blog after the phone restarts. Nothing stops right now.",
    );
    expect(undoDescription(backup({ changedSince: true }))).toBe(
      `${tSite.setup.undoBody.apps_json} ${tSite.setup.undoChanged}`,
    );
    expect(tSite.setup.undoLabel.apps_json).toBe("Undo the change to apps.json");
  });

  test("the broken apps.json row and job step point at Fix, not at ssh", () => {
    const text = (tSite.setup.checks.apps_json.error as (p: Record<string, string>) => string)({ reason: "invalid" });
    expect(text).toContain("Press Fix");
    expect(text).not.toMatch(/ssh|delete the file/i);
  });
});

describe("sites_dir_create: folder + files, or only the ecosystem file", () => {
  test("missing folder: folder, apps.json and ecosystem in one line, restart CTA because pm2 needs the new file", () => {
    const p = preview("sites_dir_create", { dir: "/h/sites", newEcosystem: "/h/sites/ecosystem.config.js" });
    p.effects.appliesOnRestart = true;
    expect(previewTitle(p)).toBe(dl.sites_dir_create.title);
    const lines = fixSummary(p);
    expect(lines[0]).toContain("`ecosystem.config.js`");
    expect(lines.slice(1)).toEqual([dl.sites_dir_create.runningSafe, dl.restartNote]);
  });

  test("folder there, only the ecosystem missing: own title and the restart CTA", () => {
    const p = preview("sites_dir_create", { newEcosystem: "/h/sites/ecosystem.config.js", appliesOnRestart: true });
    expect(previewTitle(p)).toBe("Create ecosystem.config.js?");
    expect(fixSummary(p)).toEqual([
      dl.sites_dir_create.ecosystemOnly("/h/sites/ecosystem.config.js"),
      dl.sites_dir_create.runningSafe,
      dl.restartNote,
    ]);
  });

  test("restart is offered after a fix that waits for pm2, not after pm2_auto_exit or unapplied ones", () => {
    const eco = preview("sites_dir_create", { newEcosystem: "/e", appliesOnRestart: true });
    const run = preview("pm2_auto_exit", { appliesOnRestart: true });
    const block = preview("ecosystem_block");
    expect(restartNeeded([eco], 1)).toBe(true);
    expect(restartNeeded([run, block], 2)).toBe(false);
    expect(restartNeeded([block, eco], 1)).toBe(false); // stopped before eco was applied
  });

  test("a linked ecosystem names why in plain words", () => {
    expect(tSite.setup.unfixable.ecosystem_linked).toContain("does not change or overwrite it");
  });
});

describe("wizard DNS route from Integration.dnsMode", () => {
  const withMode = (dnsMode: Integration["dnsMode"]) => ({ issues: [], checks: [], dnsMode }) as unknown as Integration;
  test("server's mode wins; cloudflared reads as the cert route", () => {
    expect(wizardDns(withMode("token"))).toBe("token");
    expect(wizardDns(withMode("cloudflared"))).toBe("cert");
    expect(wizardDns(withMode("manual"))).toBe("manual");
    expect(wizardDns(withMode(undefined))).toBe("unknown");
  });
});

describe("hand-written route removal", () => {
  test("the typed domain goes in ?confirm=, encoded", () => {
    expect(hostnameRemoveUrl("blog", "a.contoh.com")).toEndWith("/sites/blog/hostnames/a.contoh.com");
    expect(hostnameRemoveUrl("blog", "a.contoh.com", "a.contoh.com")).toEndWith(
      "/sites/blog/hostnames/a.contoh.com?confirm=a.contoh.com",
    );
    expect(hostnameRemoveUrl("my blog", "x&y")).toContain("/sites/my%20blog/hostnames/x%26y");
  });
});

describe("missing site folder (deploy blocker / 409 no_folder)", () => {
  const site = (over: Partial<SiteDetail>) => ({ deployBlocker: null, managed: true, ...over }) as SiteDetail;
  test("database site: delete and create again, or restore; adopted: its own copy", () => {
    expect(noFolderText(true)).toBe(
      "This site's folder is gone. Delete the site and create it again, or restore it from a backup.",
    );
    expect(blockerText(site({ deployBlocker: "no_folder" }))).toBe(tDeploy.noFolder.database);
    expect(blockerText(site({ deployBlocker: "no_folder", managed: false }))).toBe(tDeploy.noFolder.adopted);
    expect(blockerText(site({ deployBlocker: "pm2_not_running" }))).toBe(tDeploy.errorCodes.pm2_not_running);
    expect(blockerText(site({}))).toBeNull();
  });

  test("the 409 body's database flag picks the copy", () => {
    const err = (database: boolean) =>
      new DeployApiError(errorFromResponse(409, { error: "no_folder", database }), { database });
    expect(uploadFailure(err(true))).toEqual({ message: tDeploy.noFolder.database, next: "retry" });
    expect(uploadFailure(err(false)).message).toBe(tDeploy.noFolder.adopted);
  });
});
