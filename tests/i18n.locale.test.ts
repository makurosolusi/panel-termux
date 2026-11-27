import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, INTL_TAG, parseLocale } from "@/shared/locale";
import { LANG_STORAGE_KEY, pickLocale, readStoredLocale, writeStoredLocale } from "@/web/i18n/locale.detect";

describe("parseLocale", () => {
  test.each([
    ["en", "en"],
    ["EN", "en"],
    ["en-GB", "en"],
    ["id", "id"],
    ["id-ID", "id"],
    ["id_ID.UTF-8", "id"],
    ["in", "id"],
    [" ID ", "id"],
  ])("%p → %p", (raw, want) => {
    expect(parseLocale(raw)).toBe(want as "en" | "id");
  });

  test.each([["de"], ["english"], [""], ["e"], [null], [42]])("%p → null", (raw) => {
    expect(parseLocale(raw)).toBeNull();
  });

  test("English is the default, with a 24-hour en-US tag", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(INTL_TAG).toEqual({ en: "en-US", id: "id-ID" });
  });
});

describe("pickLocale: query → stored → browser → English", () => {
  test("first valid source wins", () => {
    expect(pickLocale({ query: "id", stored: "en", languages: ["en-US"] })).toBe("id");
    expect(pickLocale({ query: "xx", stored: "id", languages: ["en-US"] })).toBe("id");
    expect(pickLocale({ query: null, stored: null, languages: ["de-DE", "id-ID", "en"] })).toBe("id");
    expect(pickLocale({ query: null, stored: "bogus", languages: ["en-US"] })).toBe("en");
    expect(pickLocale({ query: null, stored: null, languages: ["de", "fr"] })).toBe("en");
    expect(pickLocale({ query: null, stored: null, languages: [] })).toBe("en");
  });
});

describe("stored locale", () => {
  const memory = () => {
    const map = new Map<string, string>();
    return {
      map,
      storage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      },
    };
  };

  test("write, read, and null removes the key", () => {
    const m = memory();
    expect(writeStoredLocale(m.storage, "id")).toBe(true);
    expect(m.map.get(LANG_STORAGE_KEY)).toBe("id");
    expect(readStoredLocale(m.storage)).toBe("id");
    expect(writeStoredLocale(m.storage, null)).toBe(true);
    expect(readStoredLocale(m.storage)).toBeNull();
  });

  test("blocked or missing storage never throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(readStoredLocale(broken)).toBeNull();
    expect(writeStoredLocale(broken, "en")).toBe(false);
    expect(readStoredLocale(undefined)).toBeNull();
    expect(writeStoredLocale(undefined, "en")).toBe(false);
  });
});
