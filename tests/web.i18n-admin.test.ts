import { describe, expect, test } from "bun:test";
import { SETTING_KEYS } from "@/shared/dev.types";
import { idAccount, signInErrorMessage } from "@/web/i18n/id.account";
import { idDev } from "@/web/i18n/id.dev";
import { idSettings } from "@/web/i18n/id.settings";

// English words that would mean a 0.2.x server label or a placeholder slipped into the Indonesian registry.
const ENGLISH = /\b(must|the|setting|settings|label|description|todo|lorem|placeholder|backup|enter|value)\b/i;

/** Every string leaf of a nested copy object (functions are skipped). */
function strings(o: unknown): string[] {
  if (typeof o === "string") return [o];
  if (o && typeof o === "object") return Object.values(o).flatMap(strings);
  return [];
}

describe("id.settings", () => {
  test("every SETTING_KEYS entry has a label, help and invalid message", () => {
    const fields: Record<string, { label: string; help: string; invalid: string }> = idSettings.fields;
    expect(Object.keys(fields).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) {
      expect(fields[key]?.label.trim().length, key).toBeGreaterThan(2);
      expect(fields[key]?.help.trim().length, key).toBeGreaterThan(10);
      expect(fields[key]?.invalid.trim().length, key).toBeGreaterThan(5);
    }
  });

  test("no English placeholder text in the settings registry copy", () => {
    // Technical tokens in backticks (`auto`, `.env`) are allowed; strip them first.
    const leaks = strings(idSettings.fields)
      .map((s) => s.replace(/`[^`]*`/g, ""))
      .filter((s) => ENGLISH.test(s));
    expect(leaks).toEqual([]);
  });

  test("the six groups are titled in Indonesian", () => {
    expect(Object.values(idSettings.groups).map((g) => g.title)).toEqual([
      "Cloudflare",
      "Cadangan",
      "Notifikasi Telegram",
      "Situs",
      "Pemantauan",
      "Keamanan",
    ]);
  });

  test("labels are unique so audit lines and toasts are unambiguous", () => {
    const labels = Object.values(idSettings.fields).map((f) => f.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("id.dev split", () => {
  test("id.dev keeps the keys the 0.2.x pages read", () => {
    expect(idDev.settings).toBe(idSettings);
    expect(idDev.health.uptime).toBe("Waktu aktif");
    expect(idDev.users.deleteBody("Citra")).toContain("Citra");
    expect(idDev.logs.levels.error).toBe("Kesalahan");
    expect(idDev.audit.empty.length).toBeGreaterThan(0);
    expect(idDev.setup.progress(2, 6)).toBe("2 dari 6 selesai");
  });
});

describe("id.account", () => {
  test("Better Auth callback codes map to specific messages", () => {
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("access_denied")).toBe(idAccount.signIn.errors.cancelled);
    expect(signInErrorMessage("state_mismatch")).toBe(idAccount.signIn.errors.state);
    expect(signInErrorMessage("state_not_found")).toBe(idAccount.signIn.errors.state);
    expect(signInErrorMessage("email_not_found")).toBe(idAccount.signIn.errors.email);
  });

  test("unknown and prototype-named codes fall back to the generic message", () => {
    expect(signInErrorMessage("unable_to_get_user_info")).toBe(idAccount.signIn.errors.generic);
    expect(signInErrorMessage("constructor")).toBe(idAccount.signIn.errors.generic);
  });

  test("the no-access card gives concrete next steps", () => {
    expect(idAccount.noAccess.steps.length).toBeGreaterThanOrEqual(3);
    expect(idAccount.noAccess.body).toContain("Admin");
  });
});
