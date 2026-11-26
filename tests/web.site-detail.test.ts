import { describe, expect, test } from "bun:test";
import type { BackupLastGood } from "@/shared/backup.types";
import type { Job, SiteCheckResult, SiteDetail } from "@/shared/site.types";
import { applyPaste, parseEnvPaste, pasteApplicable } from "@/web/site/env.paste";
import {
  type EnvDraft,
  emptyEnvDraft,
  envDraftCounts,
  envDraftSavable,
  envKeyBadges,
  envRowErrors,
  lockedKeysOf,
  newEnvRow,
  replacedErrors,
  toggleUnset,
} from "@/web/site/env.rows";
import {
  blinkingHosts,
  deleteDefaults,
  deleteQuery,
  healthForm,
  healthFormErrors,
  healthOf,
  healthPatch,
  healthToast,
  hostnameFeedback,
  hostnamesCheck,
  normalizeHostnames,
  siteBanners,
  siteBusy,
} from "@/web/site/site-detail.state";

// test-only fixtures
const site = (over: Partial<SiteDetail> = {}): SiteDetail => ({
  name: "blog",
  port: 3001,
  hostnames: ["blog.contoh.com"],
  database: "blog",
  runtime: "native",
  managed: true,
  appStatus: "online",
  createdAt: "2026-11-01T00:00:00.000Z",
  dir: "/data/sites/blog",
  envKeys: ["PORT", "DATABASE_URL", "API_KEY"],
  dns: [],
  ...over,
});
const draft = (over: Partial<EnvDraft> = {}): EnvDraft => ({ ...emptyEnvDraft(), ...over });
const ctx = { existing: ["API_KEY", "PORT"], locked: ["PORT"], pm2: ["NODE_ENV"] };
const good = (kind: BackupLastGood["kind"], name: string, at: string): BackupLastGood => ({
  kind,
  name,
  at,
  runId: "r1",
  itemIndex: 0,
  sizeBytes: 1,
  checked: true,
  restoreHint: "", // test-only
});
const NOW = new Date("2026-11-27T12:00:00.000Z");

describe("env rows", () => {
  test("shared key rule: lower-case allowed, locked keys per site refused, value problems flagged", () => {
    expect(envRowErrors([newEnvRow("api_key", "v")], [], ["PORT"])).toEqual([null]);
    expect(envRowErrors([newEnvRow("PORT", "1")], [], ["PORT"])).toEqual(["reserved"]);
    expect(envRowErrors([newEnvRow("DATABASE_URL", "x")], [], ["PORT"])).toEqual([null]);
    expect(envRowErrors([newEnvRow("A", "x\ny")])).toEqual(["multiline"]);
    expect(envRowErrors([newEnvRow("A", `it's "x"`)])).toEqual(["quote"]);
  });

  test("lockedKeysOf prefers the server list, falls back by managed/database", () => {
    expect(lockedKeysOf(site({ lockedEnvKeys: ["PORT"] }))).toEqual(["PORT"]);
    expect(lockedKeysOf(site())).toEqual(["PORT", "DATABASE_URL"]);
    expect(lockedKeysOf(site({ database: null }))).toEqual(["PORT"]);
    expect(lockedKeysOf(site({ managed: false }))).toEqual([]);
  });

  test("badges: owner first, then what the draft does; unset wins over a replacement", () => {
    expect(envKeyBadges("PORT", draft(), ["PORT"], [])).toEqual(["locked"]);
    expect(envKeyBadges("NODE_ENV", draft({ replaced: { NODE_ENV: "x" } }), [], ["NODE_ENV"])).toEqual([
      "pm2",
      "replace",
    ]);
    const d = toggleUnset(draft({ replaced: { API_KEY: "new" } }), "API_KEY");
    expect(envKeyBadges("API_KEY", d, [], [])).toEqual(["unset"]);
    expect(d.replaced).toEqual({});
    expect(envKeyBadges("API_KEY", toggleUnset(d, "API_KEY"), [], [])).toEqual([]);
  });

  test("savable needs a change and no invalid row or value; counts per kind", () => {
    expect(envDraftSavable(draft(), ["API_KEY"], [])).toBe(false);
    expect(envDraftSavable(draft({ replaced: { API_KEY: "" } }), ["API_KEY"], [])).toBe(false);
    expect(envDraftSavable(draft({ replaced: { API_KEY: "a\nb" } }), ["API_KEY"], [])).toBe(false);
    expect(replacedErrors(draft({ replaced: { API_KEY: "a\nb" } }))).toEqual({ API_KEY: "multiline" });
    expect(envDraftSavable(draft({ rows: [newEnvRow("API_KEY", "x")] }), ["API_KEY"], [])).toBe(false);
    const ok = draft({ replaced: { API_KEY: "n" }, unset: new Set(["OLD"]), rows: [newEnvRow("NEW", "1")] });
    expect(envDraftSavable(ok, ["API_KEY", "OLD"], [])).toBe(true);
    expect(envDraftCounts(ok)).toEqual({ replaced: 1, added: 1, unset: 1 });
  });
});

describe("Tempel .env", () => {
  const text = [
    "# comment",
    "",
    "export API_KEY='s3cr3t'",
    "NEW=plain # trailing",
    'NEW="last wins"',
    "PORT=9999",
    "NODE_ENV=production",
    "URL=http://$HOST/x",
    "ESC=a\\$b",
    "1BAD=x",
    "garbage line",
    'MULTI="first',
    "second line",
    'end"',
    "AFTER=ok",
  ].join("\n");
  const entries = parseEnvPaste(text, ctx);
  const byLine = (n: number) => entries.find((e) => e.line === n);

  test("decodes values with the shared codec, last duplicate wins", () => {
    expect(byLine(3)).toMatchObject({ key: "API_KEY", value: "s3cr3t", action: "replace", problems: [] });
    expect(byLine(4)).toMatchObject({ key: "NEW", value: "plain", action: "skip", problems: ["duplicate"] });
    expect(byLine(5)).toMatchObject({ key: "NEW", value: "last wins", action: "new" });
  });

  test("flags locked, pm2, $ expansion (not \\$), invalid keys and lines, multi-line values", () => {
    expect(byLine(6)).toMatchObject({ action: "skip", problems: ["locked"] });
    expect(byLine(7)).toMatchObject({ action: "new", problems: ["pm2"] });
    expect(byLine(8)).toMatchObject({ value: "http://$HOST/x", action: "new", problems: ["dollar"] });
    expect(byLine(9)).toMatchObject({ value: "a$b", problems: [] });
    expect(byLine(10)).toMatchObject({ action: "skip", problems: ["invalid"] });
    expect(byLine(11)).toMatchObject({ key: "", action: "skip", problems: ["invalid"] });
    expect(byLine(12)).toMatchObject({ key: "MULTI", action: "skip", problems: ["multiline"] });
    expect(byLine(13)).toBeUndefined(); // continuation lines belong to MULTI
    expect(byLine(15)).toMatchObject({ key: "AFTER", action: "new" });
    expect(pasteApplicable(entries)).toBe(6);
  });

  test("apply: existing keys become replacements (and stop being unset), others rows merged by key", () => {
    const start = draft({ unset: new Set(["API_KEY"]), rows: [newEnvRow("NEW", "old"), newEnvRow()] });
    const d = applyPaste(start, entries);
    expect(d.replaced).toEqual({ API_KEY: "s3cr3t" });
    expect(d.unset.has("API_KEY")).toBe(false);
    expect(d.rows.map((r) => [r.key, r.value])).toEqual([
      ["NEW", "last wins"],
      ["NODE_ENV", "production"],
      ["URL", "http://$HOST/x"],
      ["ESC", "a$b"],
      ["AFTER", "ok"],
    ]);
  });
});

describe("site detail decisions", () => {
  const job = (over: Partial<Job> = {}) => ({ id: "j1", resolvedBy: null, recoverMode: "cleanup", ...over }) as Job;

  test("banners: running vs other site, interrupted only when recoverable and idle, restart pending, blocker", () => {
    const active = { id: "a", kind: "site.deploy" as const, target: "blog", startedAt: "" };
    expect(siteBanners(site({ activeJob: active }), job())).toEqual(["running"]);
    expect(siteBanners(site({ activeJob: { ...active, target: "shop" } }), null)).toEqual(["busy_other"]);
    expect(siteBanners(site(), job())).toEqual(["interrupted"]);
    expect(siteBanners(site(), job({ resolvedBy: "j2" }))).toEqual([]);
    expect(siteBanners(site(), job({ recoverMode: null }))).toEqual([]);
    expect(siteBanners(site({ restartPending: true, deployBlocker: "pm2_not_running" }), null)).toEqual([
      "restart_pending",
      "blocker",
    ]);
    expect(siteBusy(site({ activeJob: active }))).toBe(true);
    expect(siteBusy(site())).toBe(false);
  });

  test("health toast", () => {
    const p = { path: "/api/health", checkedAt: "" };
    expect(healthToast({ ...p, ok: true, status: 200, ms: 85 })).toEqual({
      ok: true,
      text: "Sehat: HTTP 200 dari /api/health dalam 85 ms.",
    });
    expect(healthToast({ ...p, ok: false, status: 502, ms: 9 }).text).toContain("menjawab 502");
    expect(healthToast({ ...p, ok: false, status: null, ms: null }).text).toContain("tidak menjawab");
  });

  test("domains dialog: normalize, check request, blinking hosts, per-domain feedback", () => {
    expect(normalizeHostnames([" A.contoh.com ", "", "a.contoh.com", "b.contoh.com"])).toEqual([
      "a.contoh.com",
      "b.contoh.com",
    ]);
    expect(hostnamesCheck([])).toBeNull();
    expect(hostnamesCheck(["a.x", "b.x"])).toEqual({ hostname: "a.x", extraHostnames: ["b.x"], scope: "hostname" });
    expect(blinkingHosts(["b.x", "a.x", "b.x", "c.x"], ["c.x"])).toEqual(["a.x", "b.x"]);
    const result: SiteCheckResult = {
      ok: false,
      issues: [{ field: "hostname", hostname: "a.x", code: "hostname_self", params: {}, message: "self" }],
      notes: [{ field: "hostname", hostname: "b.x", code: "dns_token_missing", params: {} }],
    };
    expect(hostnameFeedback(result, " A.x ")).toMatchObject({ blocking: true });
    expect(hostnameFeedback(result, "b.x")).toMatchObject({ blocking: false });
    expect(hostnameFeedback(result, "c.x")).toBeNull();
    expect(hostnameFeedback(undefined, "a.x")).toBeNull();
  });

  test("health settings: bounds, path rule, patch only changed fields", () => {
    const cur = healthOf(site());
    expect(cur).toEqual({ path: "/", expect: "lt500", timeoutSec: 60 });
    const f = healthForm(cur);
    expect(healthPatch(f, cur)).toBeNull();
    expect(healthFormErrors({ ...f, timeout: "9" })).toEqual({ timeout: true });
    expect(healthFormErrors({ ...f, timeout: "301" })).toEqual({ timeout: true });
    expect(healthFormErrors({ ...f, timeout: "12.5" })).toEqual({ timeout: true });
    expect(healthFormErrors({ ...f, path: "api" })).toEqual({ path: true });
    expect(healthFormErrors({ ...f, path: "/a b" })).toEqual({ path: true });
    expect(healthPatch({ ...f, path: "/x", timeout: "300" }, cur)).toEqual({ health: { path: "/x", timeoutSec: 300 } });
    expect(healthPatch({ ...f, timeout: "5" }, cur)).toBeNull();
  });

  test("delete: defaults keep items without a good backup in 24 h; managed query carries the typed name", () => {
    const fresh = [
      good("database", "blog", "2026-11-27T03:00:00.000Z"),
      good("sites", "sites", "2026-11-27T03:00:00Z"),
    ];
    expect(deleteDefaults(site(), fresh, NOW)).toEqual({ keepDatabase: false, keepData: false });
    expect(deleteDefaults(site(), [good("database", "blog", "2026-11-25T03:00:00Z")], NOW)).toEqual({
      keepDatabase: true,
      keepData: true,
    });
    expect(deleteDefaults(site({ database: null }), [], NOW).keepDatabase).toBe(false);
    expect(deleteQuery(true, "blog", { data: true, database: false })).toBe(
      "?keepData=true&keepDatabase=false&confirm=blog",
    );
    expect(deleteQuery(false, "", { data: true, database: true })).toBe("");
  });
});
