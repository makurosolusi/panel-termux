import { describe, expect, test } from "bun:test";
import {
  CHUNK_RELOAD_KEY,
  isChunkLoadError,
  RELOAD_ONCE_WINDOW_MS,
  reloadOnce,
  shouldReloadOnce,
} from "@/web/shared/chunk.error";

describe("isChunkLoadError", () => {
  test.each([
    // Chrome/Edge: chunk answered 404 text/plain, or (before B11) SPA HTML 200 → MIME error, same message
    ["Chrome", new TypeError("Failed to fetch dynamically imported module: https://x.test/chunk-abcd1234.js")],
    ["Safari", new TypeError("Importing a module script failed.")],
    ["Firefox", new TypeError("error loading dynamically imported module: https://x.test/chunk-abcd1234.js")],
    ["Vite-style CSS preload", new Error("Unable to preload CSS for /chunk-abcd1234.css")],
    ["plain object with message", { message: "Failed to fetch dynamically imported module" }],
  ])("%s → true", (_label, err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });

  test.each([
    ["other TypeError", new TypeError("Cannot read properties of undefined (reading 'x')")],
    ["network fetch", new TypeError("Failed to fetch")],
    ["string", "Failed to fetch dynamically imported module"],
    ["null", null],
  ])("%s → false", (_label, err) => {
    expect(isChunkLoadError(err)).toBe(false);
  });
});

describe("reloadOnce", () => {
  const env = () => {
    const map = new Map<string, string>();
    let reloads = 0;
    return {
      map,
      reloads: () => reloads,
      env: {
        storage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) },
        reload: () => {
          reloads++;
        },
      },
    };
  };
  const now = 1_000_000; // test-only

  test("reloads once, refuses again within 30 s, allows after", () => {
    const e = env();
    expect(reloadOnce(CHUNK_RELOAD_KEY, now, e.env)).toBe(true);
    expect(e.map.get(CHUNK_RELOAD_KEY)).toBe(String(now));
    expect(reloadOnce(CHUNK_RELOAD_KEY, now + RELOAD_ONCE_WINDOW_MS - 1, e.env)).toBe(false);
    expect(e.reloads()).toBe(1);
    expect(reloadOnce(CHUNK_RELOAD_KEY, now + RELOAD_ONCE_WINDOW_MS, e.env)).toBe(true);
    expect(e.reloads()).toBe(2);
  });

  test("keys are independent; broken storage never reloads", () => {
    const e = env();
    expect(reloadOnce("a", now, e.env)).toBe(true);
    expect(reloadOnce("b", now, e.env)).toBe(true);
    const broken = {
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => undefined,
      },
      reload: () => {
        throw new Error("must not reload");
      },
    };
    expect(reloadOnce("a", now, broken)).toBe(false);
  });

  test.each([
    ["never reloaded", null, true],
    ["just reloaded", now - 1, false],
    ["reloaded inside window", now - RELOAD_ONCE_WINDOW_MS + 1, false],
    ["reloaded exactly window ago", now - RELOAD_ONCE_WINDOW_MS, true],
    ["garbage marker", Number.NaN, true],
  ] as const)("shouldReloadOnce: %s → %p", (_label, last, expected) => {
    expect(shouldReloadOnce(last, now)).toBe(expected);
  });
});
