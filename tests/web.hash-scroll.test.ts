// URL fragment scroll after the deferred mount (QA 29 M1): alias resolution, the bounded wait, and which
// navigations scroll (first load and PUSH/REPLACE, not back/forward).
import { afterEach, describe, expect, test } from "bun:test";
import type { DataRouter } from "react-router";
import { followUrlHash, resolveHashTarget, waitFor } from "@/web/shared/hash.scroll";

const el = (id: string) => ({ id }) as unknown as Element;
const byIds =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id) ? el(id) : null;

describe("resolveHashTarget", () => {
  test("the id itself first (landing/site aliases are real elements)", () => {
    expect(resolveHashTarget("#pasang", byIds("pasang", "install"))).toEqual(el("pasang"));
    expect(resolveHashTarget("#not-managed", byIds("not-managed"))).toEqual(el("not-managed"));
  });
  test("/dev and /dev/settings 0.5.x ids map to the new anchors", () => {
    expect(resolveHashTarget("#kunci-data", byIds("data-key"))).toEqual(el("data-key"));
    expect(resolveHashTarget("#penyiapan", byIds("setup"))).toEqual(el("setup"));
    expect(resolveHashTarget("#cadangan", byIds("backup"))).toEqual(el("backup"));
  });
  test("empty, missing and malformed hashes", () => {
    expect(resolveHashTarget("", byIds("x"))).toBeNull();
    expect(resolveHashTarget("#", byIds(""))).toBeNull();
    expect(resolveHashTarget("#nope", byIds("x"))).toBeNull();
    expect(resolveHashTarget("#%E0%A4%A", byIds("%E0%A4%A"))).toEqual(el("%E0%A4%A"));
    expect(resolveHashTarget("#a%20b", byIds("a b"))).toEqual(el("a b"));
  });
});

describe("waitFor", () => {
  test("resolves as soon as the target appears", async () => {
    let calls = 0;
    expect(await waitFor(() => (++calls >= 3 ? "found" : null), { intervalMs: 1, timeoutMs: 1000 })).toBe("found");
    expect(calls).toBe(3);
  });
  test("gives up after the timeout", async () => {
    const start = Date.now();
    expect(await waitFor(() => null, { intervalMs: 5, timeoutMs: 30 })).toBeNull();
    expect(Date.now() - start).toBeLessThan(500);
  });
  test("stops when aborted (user scrolled, newer navigation)", async () => {
    const ac = new AbortController();
    const p = waitFor(() => null, { intervalMs: 5, timeoutMs: 5000, signal: ac.signal });
    ac.abort();
    expect(await p).toBeNull();
  });
});

describe("followUrlHash", () => {
  const saved = { window: globalThis.window, document: globalThis.document };
  afterEach(() => Object.assign(globalThis, saved));

  type State = DataRouter["state"];
  const state = (key: string, hash: string, historyAction: string, idle = true) =>
    ({
      initialized: true,
      navigation: { state: idle ? "idle" : "loading" },
      location: { key, hash, pathname: "/", search: "", state: null },
      historyAction,
    }) as unknown as State;

  const setup = (initial: State) => {
    const scrolled: string[] = [];
    Object.assign(globalThis, {
      window: { addEventListener() {}, removeEventListener() {} },
      document: {
        getElementById: (id: string) =>
          ["install", "data-key"].includes(id) ? { scrollIntoView: () => scrolled.push(id) } : null,
      },
    });
    let listener: ((s: State) => void) | undefined;
    const subscribe = (fn: (s: State) => void) => {
      listener = fn;
      return () => {};
    };
    const router = { state: initial, subscribe };
    followUrlHash(router as unknown as DataRouter);
    const flush = () => new Promise((r) => setTimeout(r, 20));
    return { scrolled, emit: (s: State) => listener?.(s), flush };
  };

  test("first load (POP) with a hash scrolls once", async () => {
    const h = setup(state("default", "#install", "POP"));
    h.emit(state("default", "#install", "POP")); // same key again: ignored
    await h.flush();
    expect(h.scrolled).toEqual(["install"]);
  });
  test("PUSH with a 0.5.x alias scrolls; back/forward and loading states do not", async () => {
    const h = setup(state("default", "", "POP"));
    h.emit(state("k1", "#kunci-data", "PUSH", false)); // loaders still running
    await h.flush();
    expect(h.scrolled).toEqual([]);
    h.emit(state("k1", "#kunci-data", "PUSH"));
    await h.flush();
    expect(h.scrolled).toEqual(["data-key"]);
    h.emit(state("k2", "#install", "POP"));
    await h.flush();
    expect(h.scrolled).toEqual(["data-key"]);
  });
});
