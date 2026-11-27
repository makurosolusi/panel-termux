// Settings copy in both languages (PLAN/08 §8): the English source has no Indonesian left, the Indonesian overlay no
// English placeholders. Lives under tests/i18n.* because only those tests may import id.* (i18n.parity import rule).
import { describe, expect, test } from "bun:test";
import { SETTING_KEYS } from "@/shared/dev.types";
import { tDev } from "@/web/i18n/en.dev";
import { tSettings } from "@/web/i18n/en.settings";
import { idDev } from "@/web/i18n/id.dev";
import { idSettings } from "@/web/i18n/id.settings";

// English words that would mean a 0.2.x server label or a placeholder slipped into the Indonesian overlay.
const ENGLISH = /\b(must|the|setting|settings|label|description|todo|lorem|placeholder|backup|enter|value)\b/i;
// Indonesian words that would mean an untranslated string stayed in the English source of truth.
const INDONESIAN =
  /\b(dan|yang|tidak|atau|untuk|dengan|belum|sudah|lalu|isi|pilih|simpan|hapus|mis|cadangan|situs|layanan|pengaturan|bawaan|kunci|ganti|nyala|mati)\b/i;

/** Every string leaf of a nested copy object (functions are skipped). */
function strings(o: unknown): string[] {
  if (typeof o === "string") return [o];
  if (o && typeof o === "object") return Object.values(o).flatMap(strings);
  return [];
}

/** Strings of `copy` that match `words` once technical tokens in backticks (`auto`, `.env`) are stripped. */
const leaks = (copy: unknown, words: RegExp) =>
  strings(copy)
    .map((s) => s.replace(/`[^`]*`/g, ""))
    .filter((s) => words.test(s));

describe("settings copy", () => {
  test("every SETTING_KEYS entry has a label, help and invalid message in both languages", () => {
    for (const copy of [tSettings, idSettings]) {
      const fields: Record<string, { label: string; help: string; invalid: string }> = copy.fields;
      expect(Object.keys(fields).sort()).toEqual([...SETTING_KEYS].sort());
      for (const key of SETTING_KEYS) {
        expect(fields[key]?.label.trim().length, key).toBeGreaterThan(2);
        expect(fields[key]?.help.trim().length, key).toBeGreaterThan(10);
        expect(fields[key]?.invalid.trim().length, key).toBeGreaterThan(5);
      }
    }
  });

  test("no English placeholder text in the Indonesian settings fields", () => {
    expect(leaks(idSettings.fields, ENGLISH)).toEqual([]);
  });

  test("no Indonesian words left in the English settings copy", () => {
    expect(leaks(tSettings, INDONESIAN)).toEqual([]);
  });

  test("the six groups are titled in each language", () => {
    expect(Object.values(tSettings.groups).map((g) => g.title)).toEqual([
      "Cloudflare",
      "Backup",
      "Telegram alerts",
      "Sites",
      "Monitoring",
      "Security",
    ]);
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
    for (const copy of [tSettings, idSettings]) {
      const labels = Object.values(copy.fields).map((f) => f.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("id.dev split", () => {
  test("id.dev keeps the keys the 0.2.x pages read", () => {
    expect(tDev.settings).toBe(tSettings);
    expect(idDev.settings).toBe(idSettings);
    expect(idDev.health.uptime).toBe("Waktu aktif");
    expect(idDev.users.deleteBody("Citra")).toContain("Citra");
    expect(idDev.logs.levels.error).toBe("Kesalahan");
    expect(tDev.audit.empty.length).toBeGreaterThan(0);
    expect(idDev.setup.progress(2, 6)).toBe("2 dari 6 selesai");
  });
});
