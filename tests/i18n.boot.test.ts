// Built-output boot test (PLAN/08 §4.3, DECISIONS E5): builds the real src/web/index.html with the production
// splitting config, swaps only `app.mount` for a probe (tests/fixtures/i18n-boot), loads the built bootstrap with a
// stubbed browser, and checks that dictionaries — including one in a shared chunk and a module-level alias in a
// lazy chunk — come out Indonesian for lang=id and English for lang=en.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { tApp } from "@/web/i18n/en.app";
import { tCommon } from "@/web/i18n/en.common";
import { tShell } from "@/web/i18n/en.shell";
import { tSiteDetail } from "@/web/i18n/en.site-detail";
import { idApp } from "@/web/i18n/id.app";
import { idCommon } from "@/web/i18n/id.common";
import { idShell } from "@/web/i18n/id.shell";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { LANG_STORAGE_KEY } from "@/web/i18n/locale.detect";
import type { BootProbe } from "./fixtures/i18n-boot/probe.mount";

const PROBE = resolve("tests/fixtures/i18n-boot/probe.mount.ts");
const PROBE_INPUT = "tests/fixtures/i18n-boot/probe.mount.ts";
const LAZY_INPUT = "tests/fixtures/i18n-boot/probe.lazy.ts";
const EN_APP_INPUT = "src/web/i18n/en.app.ts";

type Output = { inputs: Record<string, unknown>; entryPoint?: string };
let root = "";
let entryJs = "";
let packJs = "";
let outputs: Record<string, Output> = {};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "panel-i18n-boot-"));
  const result = await Bun.build({
    entrypoints: ["./src/web/index.html"],
    outdir: join(root, "build"),
    splitting: true,
    minify: true,
    metafile: true,
    plugins: [
      tailwind,
      {
        name: "probe-mount",
        setup(build) {
          build.onResolve({ filter: /^@\/web\/app\.mount$/ }, () => ({ path: PROBE }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success || !result.metafile) throw new Error(`boot test build failed: ${result.logs.join("\n")}`);
  const raw: unknown = result.metafile; // object in Bun ≥ 1.4.5, JSON string before
  outputs = (typeof raw === "string" ? JSON.parse(raw) : raw).outputs;
  const jsOf = (input: string) =>
    Object.entries(outputs)
      .find(([p, o]) => p.endsWith(".js") && o.entryPoint === input)?.[0]
      .replace(/^.*\//, "");
  entryJs = jsOf("src/web/index.html") ?? "";
  packJs = jsOf("src/web/i18n/id.pack.ts") ?? "";
  if (!entryJs || !packJs) throw new Error("boot test: entry or id.pack chunk missing from the build");
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Copies the build, stubs the browser globals the bootstrap touches, and loads the built entry. */
async function boot(name: string, opts: { stored: string | null; dropPack?: boolean }) {
  const dir = join(root, name);
  cpSync(join(root, "build"), dir, { recursive: true });
  if (opts.dropPack) rmSync(join(dir, packJs));
  const store = new Map(opts.stored ? [[LANG_STORAGE_KEY, opts.stored]] : []);
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "localStorage", "location", "history", "navigator", "__i18nProbe"].map(
    (k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const,
  );
  const set = (k: string, value: unknown) => Object.defineProperty(g, k, { value, configurable: true, writable: true });
  set("document", { documentElement: { lang: "" } });
  set("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  set("location", { href: "https://panel.test/panel" });
  set("history", { state: null, replaceState: () => undefined });
  set("navigator", { languages: ["en-US"] });
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await import(join(dir, entryJs));
    const probe = await (g.__i18nProbe as Promise<BootProbe>);
    return { probe, warned: warn.mock.calls.length };
  } finally {
    warn.mockRestore();
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  }
}

describe("i18n boot (built output)", () => {
  test("en.app is in a chunk shared by the mount chunk and a lazy chunk (the case top-level await missed)", () => {
    const chunkOf = (input: string) =>
      Object.entries(outputs).find(([p, o]) => p.endsWith(".js") && input in o.inputs)?.[0];
    const shared = chunkOf(EN_APP_INPUT);
    expect(shared).toBeDefined();
    expect(shared).not.toBe(chunkOf(PROBE_INPUT));
    expect(shared).not.toBe(chunkOf(LAZY_INPUT));
  });

  test("lang=id: shared-chunk dictionary, lazy alias and page alias are Indonesian", async () => {
    const { probe, warned } = await boot("id", { stored: "id" });
    expect(probe.lang).toBe("id");
    expect(probe.packFailed).toBe(false);
    expect(probe.signOut).toBe("Keluar");
    expect(probe.signOut).toBe(idApp.menu.signOut);
    expect(probe.lazySignOut).toBe("Keluar");
    expect(probe.anchor).toBe(idSiteDetail.anchors.summary);
    // shell/common sit in chunks shared by the entry side and lazy routes (still placeholders until wave 1)
    expect(probe.retry).toBe(idCommon.retry);
    expect(probe.shellAccount).toBe(idShell.account);
    expect(warned).toBe(0);
  }, 30_000);

  test("lang=en: English values and the pack is never requested", async () => {
    // the pack file is removed: a request would fail and flip packFailed
    const { probe, warned } = await boot("en", { stored: "en", dropPack: true });
    expect(probe.lang).toBe("en");
    expect(probe.packFailed).toBe(false);
    expect(probe.signOut).toBe("Sign out");
    expect(probe.signOut).toBe(tApp.menu.signOut);
    expect(probe.lazySignOut).toBe("Sign out");
    expect(probe.anchor).toBe(tSiteDetail.anchors.summary);
    expect(probe.retry).toBe(tCommon.retry);
    expect(probe.shellAccount).toBe(tShell.account);
    expect(warned).toBe(0);
  }, 30_000);

  test("lang=id with the pack missing: logs a warning and mounts in English", async () => {
    const { probe, warned } = await boot("id-nopack", { stored: "id", dropPack: true });
    expect(probe.lang).toBe("en");
    expect(probe.packFailed).toBe(true);
    expect(probe.signOut).toBe("Sign out");
    expect(warned).toBe(1);
  }, 30_000);
});
