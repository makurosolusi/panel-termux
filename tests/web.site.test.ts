import { describe, expect, test } from "bun:test";
import type {
  AdoptCandidateApp,
  DiscoveredIngress,
  Integration,
  IntegrationCheck,
  IntegrationCheckKey,
  Site,
  SiteIssueCode,
} from "@/shared/site.types";
import { idSite } from "@/web/i18n/id.site";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";
import {
  adoptBody,
  adoptOptions,
  adoptPrefill,
  appFacts,
  appWarnings,
  checkText,
  discoveredRow,
  discoveredRows,
  editCommand,
  integrationReady,
  oldSnippet,
  setupNeeded,
  snippetNeeded,
} from "@/web/site/site.adopt";
import { SITE_ERROR_CODES, siteUrl } from "@/web/site/site.api";
import { siteRowTone, siteStatusKey } from "@/web/site/site.card";
import {
  blipHosts,
  checkRequest,
  createBody,
  createPlan,
  EMPTY_SITE_FORM,
  issueText,
  notesByHost,
  parsePort,
  type SiteForm,
  targetIssues,
  targetReady,
} from "@/web/site/site.check";

// test-only fixtures
const form = (over: Partial<SiteForm> = {}): SiteForm => ({
  name: " blog ",
  hostnames: ["Blog.Contoh.com ", ""],
  port: "3001",
  database: false,
  env: [],
  ...over,
});
const app = (over: Partial<AdoptCandidateApp> = {}): AdoptCandidateApp => ({
  name: "makuro-solusi",
  status: "online",
  cwd: "/data/sites/makuro-solusi",
  port: 3005,
  portSource: "dotenv",
  runtime: "grun",
  scriptRuntime: "grun",
  blockers: [],
  warnings: [],
  ...over,
});
const ingress = (over: Partial<DiscoveredIngress> = {}): DiscoveredIngress => ({
  hostname: "solusi.contoh.com",
  port: 3005,
  self: false,
  match: "makuro-solusi",
  blockers: [],
  ...over,
});
const chk = (key: IntegrationCheckKey, state: IntegrationCheck["state"] = "ok", params = {}): IntegrationCheck => ({
  key,
  state,
  params,
  detail: null,
});
const integration = (checks: IntegrationCheck[], ready = true): Integration => ({
  ready,
  checks,
  snippet: "const panelApps = …",
  ecosystemPath: "/data/sites/ecosystem.config.js",
  ecosystemIncludesAppsJson: ready,
  appsJsonExists: true,
  tunnelId: "t",
  cloudflareTokenSet: true,
  issues: ready ? [] : ["x"],
});

describe("wizard target", () => {
  test.each([
    ["", undefined],
    [" 3001 ", 3001],
    ["0", "invalid"],
    ["65536", "invalid"],
    ["3.5", "invalid"],
    ["abc", "invalid"],
  ] as const)("parsePort(%p) → %p", (text, want) => expect(parsePort(text)).toBe(want));

  test("check request: trimmed, lower-cased, blank extra domains dropped, database carried", () =>
    expect(checkRequest(form({ hostnames: ["A.contoh.com", " ", "B.Contoh.com"], database: true }))).toEqual({
      name: "blog",
      hostname: "a.contoh.com",
      extraHostnames: ["b.contoh.com"],
      port: 3001,
      database: true,
    }));

  test("a pasted URL becomes its domain (m13)", () =>
    expect(
      checkRequest(form({ hostnames: ["https://Kedai.contoh.com/menu?x=1", "http://b.contoh.com."] })),
    ).toMatchObject({
      hostname: "kedai.contoh.com",
      extraHostnames: ["b.contoh.com"],
    }));

  test("no check while name/domain empty or port invalid; empty port lets the server suggest", () => {
    expect(checkRequest(EMPTY_SITE_FORM)).toBeNull();
    expect(checkRequest(form({ hostnames: [" "] }))).toBeNull();
    expect(checkRequest(form({ port: "x" }))).toBeNull();
    expect(checkRequest(form({ port: "" }))).not.toHaveProperty("port");
  });

  test("ready only after a passing check for the current values", () => {
    expect(targetReady(form(), { ok: true, issues: [] }, false)).toBe(true);
    expect(targetReady(form(), { ok: true, issues: [] }, true)).toBe(false);
    expect(targetReady(form(), undefined, false)).toBe(false);
    expect(targetReady(form({ port: "0" }), { ok: true, issues: [] }, false)).toBe(false);
  });

  test("issues: Indonesian copy from code + params, grouped per field and per domain; leftover job id kept", () => {
    const r = targetIssues({
      ok: false,
      issues: [
        { field: "name", code: "name_leftover", params: { jobId: "j9" }, message: "en" },
        { field: "hostname", hostname: "a.contoh.com", code: "hostname_in_use", params: {}, message: "en" },
        { field: "port", code: "port_out_of_range", params: { from: 3000, to: 3999 }, message: "en" },
      ],
    });
    expect(r.leftoverJobId).toBe("j9");
    expect(r.name).toEqual([idSite.issues.name_leftover]);
    expect(r.hostnames["a.contoh.com"]).toEqual([
      "a.contoh.com sudah diarahkan ke aplikasi lain di config cloudflared.",
    ]);
    expect(r.port).toEqual(["Pakai port di rentang situs 3000–3999."]);
  });

  test("unknown issue code falls back to the server text", () =>
    expect(issueText({ field: "name", code: "brand_new", message: "server text" })).toBe("server text"));

  test("every issue code has copy", () => {
    const codes: SiteIssueCode[] = ["name_invalid", "name_taken", "hostname_self", "port_panel", "port_in_use"];
    for (const code of codes)
      expect(issueText({ field: "name", code, params: { port: 1 }, message: "en" })).not.toBe("en");
  });

  test("DNS notes per domain", () =>
    expect(
      notesByHost({
        ok: true,
        issues: [],
        notes: [{ field: "hostname", hostname: "a.contoh.com", code: "dns_token_missing", params: {} }],
      }),
    ).toEqual({ "a.contoh.com": [idSite.notes.dns_token_missing] }));
});

describe("wizard create body and summary", () => {
  test("body: extra domains, port and env omitted when empty", () => {
    expect(createBody(form({ port: "" }))).toEqual({ name: "blog", hostname: "blog.contoh.com", database: false });
    expect(
      createBody(form({ hostnames: ["a.contoh.com", "b.contoh.com"], env: [{ id: 1, key: "API_KEY", value: "v" }] })),
    ).toEqual({
      name: "blog",
      hostname: "a.contoh.com",
      extraHostnames: ["b.contoh.com"],
      port: 3001,
      database: false,
      env: { API_KEY: "v" },
    });
  });

  test("plan follows the site.create steps and names the domains, port, database and token", () => {
    const body = {
      name: "blog",
      hostname: "a.contoh.com",
      extraHostnames: ["b.contoh.com"],
      port: 3001,
      database: true,
    };
    const plan = createPlan(body, false);
    expect(plan).toHaveLength(8);
    expect(plan[1]).toBe("Membuat folder ~/sites/blog");
    expect(plan[2]).toBe("Membuat database blog beserta role-nya");
    expect(plan[3]).toBe("Menulis .env (PORT dan DATABASE_URL)");
    expect(plan[4]).toBe("Menambahkan rute a.contoh.com, b.contoh.com ke port 3001 di config cloudflared");
    expect(plan[5]).toContain("dilewati");
    expect(createPlan({ ...body, database: false }, true)[2]).toBe("Tanpa database");
    expect(createPlan(body, true)[5]).not.toContain("dilewati");
  });

  test("blip names other domains (panel included), not the new ones, max 3", () => {
    expect(blipHosts(["solusi.contoh.com", "a.contoh.com"], "panel.contoh.com", ["a.contoh.com"])).toEqual([
      "solusi.contoh.com",
      "panel.contoh.com",
    ]);
    expect(blipHosts(["1", "2", "3", "4"], "", [])).toHaveLength(3);
    expect(idSite.wizard.blip(["x.contoh.com"])).toBe(
      "cloudflared dimulai ulang sekali. Semua domain di HP ini terputus 3–10 dtk, termasuk x.contoh.com.",
    );
  });
});

describe("belum dikelola", () => {
  test("panel's own host reads 'Panel Termux (domain ini)' and is not adoptable", () =>
    expect(discoveredRow(ingress({ self: true, blockers: ["self"] }), [app()])).toEqual({
      hostname: "solusi.contoh.com",
      target: "Panel Termux (domain ini)",
      adoptable: false,
      reason: null,
    }));

  test("row shows port → app; wildcard and no usable app are blocked with a reason", () => {
    expect(discoveredRow(ingress(), [app()])).toMatchObject({ target: "port 3005 → makuro-solusi", adoptable: true });
    expect(discoveredRow(ingress({ blockers: ["wildcard"] }), [app()])).toMatchObject({ adoptable: false });
    expect(discoveredRow(ingress(), [app({ name: "other", blockers: ["outside_sites_dir"] })])).toMatchObject({
      adoptable: false,
      reason: idSite.discovered.noCandidates,
    });
    // the matched app's own blocker explains the row, not "no matching app" (QA m2)
    expect(discoveredRow(ingress(), [app({ blockers: ["no_binary"] })])).toMatchObject({
      adoptable: false,
      reason: idSite.adopt.blockers.no_binary,
    });
  });

  test("rows: adoptable first, panel last", () => {
    const rows = discoveredRows({
      ingress: [
        ingress({ hostname: "panel.x", self: true }),
        ingress({ hostname: "w.x", blockers: ["wildcard"] }),
        ingress(),
      ],
      apps: [app()],
    });
    expect(rows.map((r) => r.hostname)).toEqual(["solusi.contoh.com", "w.x", "panel.x"]);
  });
});

describe("adopt dialog", () => {
  const apps = [app(), app({ name: "adminneo", port: 3010 }), app({ name: "luar", blockers: ["outside_sites_dir"] })];

  test("options: usable first, blocked disabled with the reason", () =>
    expect(adoptOptions(apps)).toEqual([
      { name: "adminneo", disabled: false, reason: null },
      { name: "makuro-solusi", disabled: false, reason: null },
      { name: "luar", disabled: true, reason: idSite.adopt.blockers.outside_sites_dir },
    ]));

  test("prefill: matched app, else same-port app, else nothing; name follows the app", () => {
    expect(adoptPrefill(ingress(), apps)).toEqual({ app: "makuro-solusi", name: "makuro-solusi" });
    expect(adoptPrefill(ingress({ match: null, port: 3010 }), apps)).toEqual({ app: "adminneo", name: "adminneo" });
    expect(adoptPrefill(ingress({ match: "luar", port: 1 }), apps)).toEqual({ app: "", name: "" });
  });

  test("body requires an unblocked app and a name (app = pm2 name)", () => {
    expect(adoptBody("solusi.contoh.com", { app: "makuro-solusi", name: " solusi " }, apps)).toEqual({
      hostname: "solusi.contoh.com",
      app: "makuro-solusi",
      name: "solusi",
    });
    expect(adoptBody("h", { app: "luar", name: "luar" }, apps)).toBeNull();
    expect(adoptBody("h", { app: "makuro-solusi", name: " " }, apps)).toBeNull();
    expect(adoptBody("h", { app: "gone", name: "x" }, apps)).toBeNull();
  });

  test("facts: folder, runtime with how pm2 runs it, port with its source", () => {
    expect(appFacts(app())).toEqual({
      folder: "/data/sites/makuro-solusi",
      runtime: "glibc · dijalankan lewat grun",
      port: "3005 · dari `.env`",
    });
    expect(appFacts(app({ runtime: null, port: null, portSource: null, cwd: null })).port).toBe("tidak diketahui");
    expect(appWarnings(app({ warnings: ["script_other"] }))).toEqual([idSite.adopt.warnings.script_other]);
  });
});

describe("persiapan", () => {
  const allOk = (Object.keys(idSite.setup.checks) as IntegrationCheckKey[]).map((k) => chk(k));

  test("ready + no pm2 warning → card collapses; a pm2 warning keeps it open", () => {
    expect(setupNeeded(integration(allOk))).toBe(false);
    const withWarn = allOk.map((c) => (c.key === "pm2_auto_exit" ? chk(c.key, "warning") : c));
    expect(setupNeeded(integration(withWarn))).toBe(true);
    expect(setupNeeded(integration(allOk, false))).toBe(true);
  });

  test("old 0.2.x server without `ready` falls back to its issues", () => {
    const old = { ...integration([]), ready: undefined };
    expect(integrationReady(old)).toBe(true);
    expect(integrationReady({ ...old, issues: ["x"] })).toBe(false);
  });

  test("old snippet = apps.json spread without the existsSync filter; then steps show with 'versi lama'", () => {
    const old = integration([chk("ecosystem_spreads_apps_json"), chk("snippet_current", "error")], false);
    expect(oldSnippet(old)).toBe(true);
    expect(snippetNeeded(old)).toBe(true);
    const none = integration([chk("ecosystem_spreads_apps_json", "error"), chk("snippet_current", "error")], false);
    expect(oldSnippet(none)).toBe(false);
    expect(snippetNeeded(integration(allOk))).toBe(false);
  });

  test("check copy per state, with params", () => {
    expect(checkText(chk("snippet_current", "error"))).toBe(idSite.setup.checks.snippet_current.error);
    expect(checkText(chk("sites_dir", "error", { path: "/x/sites" }))).toContain("/x/sites");
    expect(checkText(chk("apps_json", "error", { reason: "invalid" }))).toContain("rusak");
    expect(checkText(chk("apps_entries_runnable", "warning", { count: 2 }))).toContain("2 situs");
    expect(checkText(chk("tunnel"))).toBe(idSite.setup.checks.tunnel.ok);
  });

  test("every check key has ok copy and copy for the state the server can send", () => {
    const serverStates: Record<IntegrationCheckKey, "warning" | "error"> = {
      sites_dir: "error",
      apps_json: "error",
      ecosystem_file: "error",
      ecosystem_loads: "error",
      ecosystem_spreads_apps_json: "error",
      snippet_current: "error",
      apps_entries_runnable: "warning",
      pm2_runtime: "error",
      pm2_auto_exit: "warning",
      pm2_guard: "warning",
      tunnel: "error",
      cloudflare_token: "warning",
    };
    for (const [key, state] of Object.entries(serverStates) as [IntegrationCheckKey, "warning" | "error"][]) {
      expect(checkText(chk(key, state))).not.toBe(checkText(chk(key)));
    }
  });

  test("edit command uses the server's ecosystem path", () =>
    expect(editCommand(integration(allOk))).toBe("nano /data/sites/ecosystem.config.js"));
});

describe("site list", () => {
  test("pm2 status → canonical status key", () => {
    expect(siteStatusKey("online")).toBe("running");
    expect(siteStatusKey("launching")).toBe("starting");
    expect(siteStatusKey("not_deployed")).toBe("not_deployed");
    expect(siteStatusKey("unknown")).toBe("unknown");
  });

  test("row edge only for sites that need a look", () => {
    const site = (appStatus: Site["appStatus"]) => ({ appStatus, managed: true, lastDeploy: null }) as Site;
    expect(siteRowTone(site("errored"))).toBe("danger");
    expect(siteRowTone(site("stopped"))).toBe("warning");
    expect(siteRowTone(site("online"))).toBeUndefined();
    expect(siteRowTone(site("not_deployed"))).toBeUndefined();
  });

  test("409 busy and adopt codes map to site copy", () => {
    expect(apiErrorMessage(errorFromResponse(409, { error: "busy", message: "x" }), SITE_ERROR_CODES)).toBe(
      idSite.errorCodes.busy,
    );
    expect(apiErrorMessage(errorFromResponse(404, { error: "app_not_found", message: "x" }), SITE_ERROR_CODES)).toBe(
      idSite.errorCodes.app_not_found,
    );
  });

  test("siteUrl encodes the name", () => expect(siteUrl("a b", "/env")).toBe("/api/panel/sites/a%20b/env"));
});
