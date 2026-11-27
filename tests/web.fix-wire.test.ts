// 0.4.0 contract pieces in the UI: apps.json rebuild, ecosystem-only folder fix, restart CTA, DNS mode, hand-written
// routes and the missing-folder deploy blocker.
import { describe, expect, test } from "bun:test";
import type { FixBackup, FixEffects, FixPreview } from "@/shared/fix.types";
import type { Integration, SiteDetail } from "@/shared/site.types";
import { DeployApiError } from "@/web/deploy/deploy.api";
import { blockerText, noFolderText, uploadFailure } from "@/web/deploy/deploy.state";
import { idDeploy } from "@/web/i18n/id.deploy";
import { idSite } from "@/web/i18n/id.site";
import { errorFromResponse } from "@/web/shared/api.client";
import { undoDescription } from "@/web/site/setup.undo";
import { fixSummary, previewTitle, restartNeeded } from "@/web/site/site.adopt";
import { hostnameRemoveUrl } from "@/web/site/site.api";
import { wizardDns } from "@/web/site/site.check";

const dl = idSite.setup.dialog;

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
    expect(previewTitle(p)).toBe("Susun ulang apps.json?");
    expect(fixSummary(p)).toEqual([
      "`apps.json` rusak, jadi panel menulisnya ulang dari daftar situs panel: blog dan shop.",
      dl.restartNote,
    ]);
    expect(fixSummary(preview("apps_json_rebuild", { appliesOnRestart: true }))[0]).toContain("daftarnya kosong");
    expect(dl.restartNote).toContain("Mulai ulang pm2");
    expect(dl.restartNote).toContain("Jalankan pm2");
  });

  test("undo of apps.json names the sites pm2 skips after a reboot", () => {
    expect(undoDescription(backup({ affectedSites: ["blog"] }))).toBe(
      "`apps.json` kembali ke isi lama yang rusak, jadi blog tidak dijalankan pm2 setelah HP dinyalakan ulang. Sekarang tetap berjalan.",
    );
    expect(undoDescription(backup({ changedSince: true }))).toBe(
      `${idSite.setup.undoBody.apps_json} ${idSite.setup.undoChanged}`,
    );
    expect(idSite.setup.undoLabel.apps_json).toBe("Batalkan perubahan pada apps.json");
  });

  test("the broken apps.json row and job step point at Perbaiki, not at ssh", () => {
    const text = (idSite.setup.checks.apps_json.error as (p: Record<string, string>) => string)({ reason: "invalid" });
    expect(text).toContain("Tekan Perbaiki");
    expect(text).not.toMatch(/ssh|hapus file/i);
  });
});

describe("sites_dir_create: folder + files, or only the ecosystem file", () => {
  test("missing folder: folder, apps.json and ecosystem in one line, restart CTA because pm2 needs the new file", () => {
    const p = preview("sites_dir_create", { dir: "/h/sites", newEcosystem: "/h/sites/ecosystem.config.js" });
    p.effects.appliesOnRestart = true;
    expect(previewTitle(p)).toBe(dl.sites_dir_create.title);
    const lines = fixSummary(p);
    expect(lines[0]).toContain("`ecosystem.config.js`");
    expect(lines[1]).toBe(dl.restartNote);
  });

  test("folder there, only the ecosystem missing: own title and the restart CTA", () => {
    const p = preview("sites_dir_create", { newEcosystem: "/h/sites/ecosystem.config.js", appliesOnRestart: true });
    expect(previewTitle(p)).toBe("Buat file ecosystem.config.js?");
    expect(fixSummary(p)).toEqual([dl.sites_dir_create.ecosystemOnly("/h/sites/ecosystem.config.js"), dl.restartNote]);
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
    expect(idSite.setup.unfixable.ecosystem_linked).toContain("tidak mengubah atau menimpanya");
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
      "Folder situs ini hilang. Hapus situs lalu buat ulang, atau pulihkan dari cadangan.",
    );
    expect(blockerText(site({ deployBlocker: "no_folder" }))).toBe(idDeploy.noFolder.database);
    expect(blockerText(site({ deployBlocker: "no_folder", managed: false }))).toBe(idDeploy.noFolder.adopted);
    expect(blockerText(site({ deployBlocker: "pm2_not_running" }))).toBe(idDeploy.errorCodes.pm2_not_running);
    expect(blockerText(site({}))).toBeNull();
  });

  test("the 409 body's database flag picks the copy", () => {
    const err = (database: boolean) =>
      new DeployApiError(errorFromResponse(409, { error: "no_folder", database }), { database });
    expect(uploadFailure(err(true))).toEqual({ message: idDeploy.noFolder.database, next: "retry" });
    expect(uploadFailure(err(false)).message).toBe(idDeploy.noFolder.adopted);
  });
});
