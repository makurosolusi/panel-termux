import { describe, expect, test } from "bun:test";
import type { BackupVerify } from "@/shared/backup.types";
import { type DevSetting, SETTING_KEYS } from "@/shared/dev.types";
import { codeSegments } from "@/web/components/code-text";
import { CONNECTION_KEYS, fieldDef, GROUP_ANCHOR, groupKeys, SETTING_GROUPS } from "@/web/dev/settings.registry";
import {
  changedValues,
  changesSitesDir,
  choiceLabel,
  cloudflareOutcome,
  fieldErrorMessage,
  fieldStatus,
  groupItems,
  initialDraft,
  initialDrafts,
  missingRequired,
  needsAutoTest,
  patchErrorFrom,
  SettingsPatchError,
  s3Draft,
  s3Outcome,
  saveFailure,
  shownValue,
  statusLabel,
  testFailure,
  turnsOnIncludeSecrets,
} from "@/web/dev/settings.state";
import { idSettings } from "@/web/i18n/id.settings";
import { ApiError } from "@/web/shared/api.client";

// test-only fixture
const setting = (over: Partial<DevSetting>): DevSetting => ({
  key: "monitor.sample_interval_sec",
  secret: false,
  value: "60",
  default: "60",
  isSet: false,
  readable: true,
  updatedAt: null,
  ...over,
});

describe("registry", () => {
  test("every key sits in exactly one of the six cards", () => {
    expect(SETTING_GROUPS).toEqual(["cloudflare", "backup", "alerts", "sites", "monitor", "security"]);
    const all = SETTING_GROUPS.flatMap(groupKeys).sort();
    expect(all).toEqual([...SETTING_KEYS].sort());
    expect(groupKeys("monitor")).toEqual(["monitor.sample_interval_sec", "monitor.battery_warn_percent"]);
  });
  test("health/onboarding anchors exist and every group has copy", () => {
    expect(GROUP_ANCHOR.cloudflare).toBe("cloudflare");
    expect(GROUP_ANCHOR.backup).toBe("cadangan");
    for (const g of SETTING_GROUPS) expect(idSettings.groups[g].title.length).toBeGreaterThan(2);
  });
  test("secret controls match the server's secret keys", () => {
    const secrets: string[] = SETTING_KEYS.filter((k) => fieldDef(k).control === "secret");
    expect(secrets.sort()).toEqual(
      [
        "alerts.telegram_bot_token",
        "backup.s3_access_key_id",
        "backup.s3_secret_access_key",
        "cloudflare.api_token",
      ].sort(),
    );
  });
  test("groupItems keeps registry order and drops keys the server did not send", () => {
    const items = [setting({ key: "monitor.battery_warn_percent" }), setting({ key: "monitor.sample_interval_sec" })];
    expect(groupItems("monitor", items).map((s) => s.key)).toEqual([
      "monitor.sample_interval_sec",
      "monitor.battery_warn_percent",
    ]);
    expect(groupItems("alerts", items)).toEqual([]);
  });
});

describe("drafts and dirty tracking", () => {
  test("plain default: input starts empty (default as placeholder), overridden starts at the stored value", () => {
    expect(initialDraft(setting({}))).toBe("");
    expect(initialDraft(setting({ isSet: true, value: "120" }))).toBe("120");
    expect(shownValue(setting({}), "")).toBe("60");
  });
  test("secret never pre-fills, even if a value slipped into the payload", () =>
    expect(initialDraft(setting({ secret: true, isSet: true, value: "leak" }))).toBe(""));
  test("untouched card is clean", () => {
    const items = [setting({}), setting({ key: "sites.dir", value: "/x", isSet: true, default: "~/sites" })];
    expect(changedValues(items, initialDrafts(items))).toEqual({});
  });
  test("typing the default while nothing is stored is not a change", () =>
    expect(changedValues([setting({})], { "monitor.sample_interval_sec": " 60 " })).toEqual({}));
  test("new value is trimmed; clearing an override sends null (back to default)", () => {
    const s = setting({ isSet: true, value: "120" });
    expect(changedValues([s], { "monitor.sample_interval_sec": " 90 " })).toEqual({
      "monitor.sample_interval_sec": "90",
    });
    expect(changedValues([s], { "monitor.sample_interval_sec": "" })).toEqual({ "monitor.sample_interval_sec": null });
  });
  test("secret: empty input keeps the stored value, text replaces it", () => {
    const s = setting({ key: "cloudflare.api_token", secret: true, value: null, default: null, isSet: true });
    expect(changedValues([s], { "cloudflare.api_token": "" })).toEqual({});
    expect(changedValues([s], { "cloudflare.api_token": "tok" })).toEqual({ "cloudflare.api_token": "tok" });
  });
});

describe("field status", () => {
  test("plain: Bawaan only without a stored value and with a default", () => {
    expect(fieldStatus(setting({})).kind).toBe("default");
    expect(fieldStatus(setting({ default: null, value: null })).kind).toBe("notSet");
    expect(fieldStatus(setting({ isSet: true, updatedAt: "2026-11-01T00:00:00Z" }))).toEqual({
      kind: "changed",
      tone: "info",
      at: "2026-11-01T00:00:00Z",
    });
  });
  test("secret: stored / not set / unreadable (danger)", () => {
    const sec = (o: Partial<DevSetting>) => setting({ secret: true, value: null, default: null, ...o });
    expect(fieldStatus(sec({ isSet: true })).kind).toBe("stored");
    expect(fieldStatus(sec({ isSet: false })).kind).toBe("notSet");
    expect(fieldStatus(sec({ isSet: true, readable: false }))).toEqual({ kind: "unreadable", tone: "danger" });
  });
  test("status labels: relative time when known, plain text otherwise", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    expect(statusLabel({ kind: "stored", tone: "success", at: null }, now)).toBe("Tersimpan");
    expect(statusLabel({ kind: "stored", tone: "success", at: "2026-11-27T11:00:00Z" }, now)).toStartWith(
      "Tersimpan · diubah ",
    );
    expect(statusLabel({ kind: "unreadable", tone: "danger" }, now)).toBe("Tidak bisa dibaca");
    expect(statusLabel({ kind: "default", tone: "neutral" }, now)).toBe("Bawaan");
  });
  test("choice labels: hours, off, severity", () => {
    expect(choiceLabel("backup.hour", "3")).toBe("03.00");
    expect(choiceLabel("backup.hour", "off")).toBe("Mati");
    expect(choiceLabel("alerts.min_severity", "danger")).toBe("Gawat");
  });
  test("missing required: empty secret, unreadable secret, or plain without value; a draft fills it", () => {
    const sec = setting({ key: "cloudflare.api_token", secret: true, value: null, default: null });
    expect(missingRequired(sec, true, "")).toBe(true);
    expect(missingRequired({ ...sec, isSet: true }, true, "")).toBe(false);
    expect(missingRequired({ ...sec, isSet: true, readable: false }, true, "")).toBe(true);
    expect(missingRequired(sec, true, "x")).toBe(false);
    expect(missingRequired(sec, false, "")).toBe(false);
  });
});

describe("save decisions", () => {
  const include = setting({ key: "backup.include_secrets", value: "off", default: "off" });
  test("turning include_secrets on needs the confirm, turning it off does not", () => {
    expect(turnsOnIncludeSecrets({ "backup.include_secrets": "on" }, [include])).toBe(true);
    expect(turnsOnIncludeSecrets({ "backup.include_secrets": "off" }, [{ ...include, value: "on" }])).toBe(false);
    expect(changesSitesDir({ "sites.dir": "/data" })).toBe(true);
    expect(changesSitesDir({ "sites.port_range": "3001-3100" })).toBe(false);
  });
  test("auto-test only for Cloudflare/S3 connection keys", () => {
    expect(needsAutoTest("cloudflare", { "cloudflare.api_token": "x" })).toBe(true);
    expect(needsAutoTest("backup", { "backup.s3_bucket": "b" })).toBe(true);
    expect(needsAutoTest("backup", { "backup.hour": "4" })).toBe(false);
    expect(needsAutoTest("alerts", { "alerts.telegram_chat_id": "1" })).toBe(false);
    expect(CONNECTION_KEYS.monitor).toBeUndefined();
  });
  test("S3 draft carries only filled connection fields", () =>
    expect(
      s3Draft({
        "backup.s3_bucket": " b ",
        "backup.s3_endpoint": "",
        "backup.s3_secret_access_key": "s",
        "backup.hour": "4",
      }),
    ).toEqual({ bucket: "b", secretAccessKey: "s" }));
});

describe("error mapping", () => {
  test("400 fields → per-key messages", () => {
    const err = patchErrorFrom(400, {
      error: "invalid_value",
      message: "x",
      fields: { "backup.s3_bucket": "invalid", "nope.key": "unknown" },
    });
    expect(err).toBeInstanceOf(SettingsPatchError);
    expect(err.code).toBe("invalid_value");
    expect(saveFailure(err)).toBe("fields");
    expect(fieldErrorMessage("backup.s3_bucket", "invalid")).toBe(idSettings.fields["backup.s3_bucket"].invalid);
    expect(fieldErrorMessage("backup.s3_bucket", "empty")).toBe("Wajib diisi.");
    expect(fieldErrorMessage("backup.s3_bucket", "unknown")).toBe(idSettings.unknownKey);
  });
  test("403 reauth_required and 409 key_mismatch become notices; other failures toast", () => {
    expect(saveFailure(patchErrorFrom(403, { error: "reauth_required", message: "m" }))).toBe("reauth");
    expect(saveFailure(patchErrorFrom(409, { error: "key_mismatch", message: "m" }))).toBe("keyMismatch");
    expect(saveFailure(patchErrorFrom(500, null))).toBe("toast");
    expect(saveFailure(new ApiError("network", null, null, null))).toBe("toast");
    expect(saveFailure(new Error("boom"))).toBe("toast");
  });
  test("a body without fields gives an empty map", () =>
    expect(patchErrorFrom(400, { error: "invalid_body", message: "m" }).fields).toEqual({}));
});

describe("test result rendering", () => {
  test("Cloudflare: zone count, no zones is a warning, codes map to copy", () => {
    expect(cloudflareOutcome({ ok: true, code: "ok", zones: 3, detail: null })).toEqual({
      tone: "success",
      text: "Token aktif dan bisa mengakses 3 zona.",
    });
    expect(cloudflareOutcome({ ok: false, code: "no_zones", zones: 0, detail: null }).tone).toBe("warning");
    const bad = cloudflareOutcome({ ok: false, code: "key_mismatch", zones: null, detail: "d" });
    expect(bad).toEqual({ tone: "danger", text: idSettings.test.cloudflare.key_mismatch, detail: "d" });
  });
  test("S3: ok shows ms; delete_denied is a warning; others danger with detail", () => {
    const r = (o: Partial<BackupVerify>): BackupVerify => ({
      ok: false,
      code: "write_denied",
      failedStep: "write",
      steps: [],
      ms: 120,
      detail: "AccessDenied",
      ...o,
    });
    expect(s3Outcome(r({ ok: true, code: "ok", failedStep: null })).text).toContain("120 md");
    expect(s3Outcome(r({ code: "delete_denied" })).tone).toBe("warning");
    expect(s3Outcome(r({}))).toEqual({ tone: "danger", text: idSettings.test.s3.write_denied, detail: "AccessDenied" });
  });
  test("Telegram: known codes, too_soon is a warning, unknown falls back to the API message", () => {
    const e = (status: number, code: string) => new ApiError(status >= 500 ? "server" : "client", status, code, null);
    expect(testFailure(e(502, "telegram_forbidden")).text).toBe(idSettings.test.telegram.telegram_forbidden);
    expect(testFailure(e(409, "alerts_not_configured")).text).toBe(idSettings.test.telegram.alerts_not_configured);
    expect(testFailure(e(409, "telegram_webhook_set")).text).toContain("webhook");
    expect(testFailure(e(429, "too_soon")).tone).toBe("warning");
    expect(testFailure(new ApiError("client", 400, "weird", "server said no")).text).toBe("server said no");
  });
});

describe("field copy with `code`", () => {
  // CodeText renders unbalanced backticks as plain text, so every backtick in help/invalid copy must pair up.
  test("help and invalid strings render backticked parts as code, never raw backticks", () => {
    const copies = Object.values(idSettings.fields).flatMap((f) => [f.help, f.invalid]);
    const withCode = copies.filter((c) => c.includes("`"));
    expect(withCode.length).toBeGreaterThan(3);
    for (const c of withCode) expect(codeSegments(c).some((seg) => seg.code)).toBe(true);
  });
});
