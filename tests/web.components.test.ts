import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeText, codeSegments } from "@/web/components/code-text";
import { typedMatches } from "@/web/components/confirm-action";
import { PaginationFooter } from "@/web/components/pagination-footer";
import { isEmptyData, queryViewState } from "@/web/components/query-view";
import { buttonVariants } from "@/web/components/ui/button";
import { Select, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
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

describe("PaginationFooter", () => {
  const p = (pageCount: number) => ({ page: 2, pageCount, total: 40, onPageChange: () => {} }); // test-only
  test("hidden when everything fits on one page", () => {
    expect(renderToStaticMarkup(createElement(PaginationFooter, { p: p(1) }))).toBe("");
  });
  test("shows position with total", () => {
    expect(renderToStaticMarkup(createElement(PaginationFooter, { p: p(3) }))).toContain("Halaman 2 dari 3 · 40 entri");
  });
});

describe("CodeText", () => {
  test("backtick spans become <code>, the rest stays text", () => {
    expect(codeSegments("Tulis `awal-akhir`, mis. `3001-3999`.")).toEqual([
      { text: "Tulis ", code: false },
      { text: "awal-akhir", code: true },
      { text: ", mis. ", code: false },
      { text: "3001-3999", code: true },
      { text: ".", code: false },
    ]);
    const html = renderToStaticMarkup(createElement(CodeText, null, "Untuk R2 biarkan `auto`."));
    expect(html).toContain("<code");
    expect(html).toContain(">auto</code>.");
    expect(html).not.toContain("`");
  });
  test("unbalanced backticks and non-strings pass through unchanged", () => {
    expect(codeSegments("satu ` saja")).toEqual([{ text: "satu ` saja", code: false }]);
    expect(renderToStaticMarkup(createElement(CodeText, null, "tanpa kode"))).toBe("tanpa kode");
  });
});

describe("touch targets under pointer: coarse (D-W9-5)", () => {
  const triggerClass = (size?: "sm" | "default") =>
    renderToStaticMarkup(
      createElement(Select, null, createElement(SelectTrigger, { size }, createElement(SelectValue))),
    ).match(/class="([^"]+)"/)?.[1] ?? "";
  test("select heights are plain utilities, so pointer-coarse:h-11 is not outranked by a data-[size] selector", () => {
    for (const size of ["sm", "default"] as const) {
      const cls = triggerClass(size);
      expect(cls).toContain("pointer-coarse:h-11");
      expect(cls).not.toMatch(/data-\[size=[a-z]+\]:h-/);
    }
    expect(triggerClass("sm")).toMatch(/(^| )h-8( |$)/);
  });
  test("switch gets a centred 44 px hit-area", () => {
    const html = renderToStaticMarkup(createElement(Switch));
    expect(html).toContain("pointer-coarse:after:size-11");
    expect(html).toMatch(/class="[^"]*(^| )relative /);
  });
});
