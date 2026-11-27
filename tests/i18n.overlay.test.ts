// applyOverlay / msg on local fixtures only: tests never call setOverlays (module singleton, PLAN/08 §8).
import { describe, expect, test } from "bun:test";
import { applyOverlay, msg } from "@/shared/i18n";

const fixture = () => ({
  title: "Sites",
  count: (n: number) => `${n} sites`,
  nested: { a: "A", deep: { b: "B" } },
  steps: ["one", "two", "three"] as readonly string[],
  untouched: "kept",
});

describe("applyOverlay", () => {
  test("replaces leaves, recurses into objects and keeps keys the overlay lacks", () => {
    const en = fixture();
    const shared = en.nested.deep;
    applyOverlay(en, { title: "Situs", count: (n: number) => `${n} situs`, nested: { deep: { b: "Be" } } });
    expect(en.title).toBe("Situs");
    expect(en.count(3)).toBe("3 situs");
    expect(en.nested.a).toBe("A");
    expect(en.nested.deep.b).toBe("Be");
    expect(en.nested.deep).toBe(shared); // patched in place: module-level aliases see the change
    expect(en.untouched).toBe("kept");
  });

  test("arrays are replaced wholesale, never merged by index", () => {
    const en = fixture();
    applyOverlay(en, { steps: ["satu"] });
    expect(en.steps).toEqual(["satu"]);
  });

  test("applying the same overlay twice is idempotent (parent and child domains overlap)", () => {
    const en = fixture();
    const overlay = { nested: { a: "Ah", deep: { b: "Be" } }, steps: ["x", "y"] };
    applyOverlay(en.nested, overlay.nested);
    applyOverlay(en, overlay);
    expect(en.nested).toEqual({ a: "Ah", deep: { b: "Be" } });
    expect(en.steps).toEqual(["x", "y"]);
  });

  test("a non-object overlay changes nothing", () => {
    const en = fixture();
    applyOverlay(en, undefined);
    applyOverlay(en, "nope");
    expect(en).toEqual({ ...fixture(), count: en.count });
  });
});

describe("msg", () => {
  test("returns the same English object when no overlay is registered for the domain", () => {
    const en = fixture();
    expect(msg("test.unregistered", en)).toBe(en);
    expect(en.title).toBe("Sites");
  });
});
