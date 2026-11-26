import { describe, expect, test } from "bun:test";
import { typedMatches } from "@/web/components/confirm-action";
import { isEmptyData, queryViewState } from "@/web/components/query-view";
import { buttonVariants } from "@/web/components/ui/button";
import { parsePageParam } from "@/web/components/use-page-param";
import { ApiError } from "@/web/shared/api.client";

const err = new ApiError("network", null, null, null); // test-only

describe("typedMatches", () => {
  test("trims outer whitespace only", () => {
    expect(typedMatches(" blog ", "blog")).toBe(true);
    expect(typedMatches("blog\n", "blog")).toBe(true);
    expect(typedMatches("b log", "blog")).toBe(false);
  });
  test("is case-sensitive and rejects partial input", () => {
    expect(typedMatches("Blog", "blog")).toBe(false);
    expect(typedMatches("blo", "blog")).toBe(false);
    expect(typedMatches("", "blog")).toBe(false);
  });
  test("works for emails and database names", () => {
    expect(typedMatches("a.b@contoh.com", "a.b@contoh.com")).toBe(true);
    expect(typedMatches("app_db", "app-db")).toBe(false);
  });
});

describe("parsePageParam", () => {
  test("valid pages pass through", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("7")).toBe(7);
  });
  test("missing or broken values fall back to 1", () => {
    for (const raw of [null, "", "0", "-3", "2.5", "abc", "NaN", "Infinity", "1e400"]) {
      expect(parsePageParam(raw)).toBe(1);
    }
  });
});

describe("queryViewState", () => {
  test("first load: loading, then failed when it errors", () => {
    expect(queryViewState({ data: undefined, error: undefined })).toBe("loading");
    expect(queryViewState({ data: undefined, error: err })).toBe("failed");
  });
  test("data kept while a refresh fails = stale, even when empty", () => {
    expect(queryViewState({ data: [1], error: err })).toBe("stale");
    expect(queryViewState({ data: [], error: err })).toBe("stale");
  });
  test("default emptiness: [] and { items: [] }", () => {
    expect(queryViewState({ data: [], error: undefined })).toBe("empty");
    expect(queryViewState({ data: { items: [] }, error: undefined })).toBe("empty");
    expect(queryViewState({ data: { items: [1] }, error: undefined })).toBe("content");
    expect(queryViewState({ data: { count: 0 }, error: undefined })).toBe("content");
  });
  test("custom isEmpty wins", () => {
    expect(queryViewState({ data: { n: 0 }, error: undefined }, (d) => d.n === 0)).toBe("empty");
    expect(queryViewState({ data: [], error: undefined }, () => false)).toBe("content");
  });
  test("isEmptyData ignores null and non-array items", () => {
    expect(isEmptyData(null)).toBe(false);
    expect(isEmptyData({ items: "x" })).toBe(false);
    expect(isEmptyData("")).toBe(false);
  });
});

describe("touch targets", () => {
  const sizes = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const;
  test("every Button size reaches 44 px under pointer: coarse", () => {
    for (const size of sizes) {
      const cls = buttonVariants({ size });
      expect(cls).toMatch(/pointer-coarse:(h-1[12]|size-11|after:-inset-2\.5)/);
    }
  });
  test("ConfirmAction never uses AlertDialogAction (it would close before the request settles)", async () => {
    const src = await Bun.file(`${import.meta.dir}/../src/web/components/confirm-action.tsx`).text();
    expect(src).not.toContain("AlertDialogAction");
  });
});
