import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeHost, type FakeHostOptions } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import type { InitContext } from "@/cli/init.types";
import { checkRelease, RELEASE_ASSET, RELEASE_DOWNLOAD_URL, sumFor, verifyLine } from "@/cli/init.verify";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-verify-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const TAG = "v0.5.1"; // test-only
const file = join(tmp, "panel.new");
writeFileSync(file, "fake panel bytes\n"); // test-only
const HASH = new Bun.CryptoHasher("sha256").update("fake panel bytes\n").digest("hex");
const OTHER = "a".repeat(64);

/** Minimal ctx: checkRelease only uses ctx.host. */
function ctxWith(fetch: FakeHostOptions["fetch"]) {
  const host = createFakeHost("fresh", { root: mkdtempSync(join(tmp, "h-")), tty: false, answers: [], fetch });
  return { ctx: { host, out: createCliOut({ stdout: () => {}, stderr: () => {} }) } as unknown as InitContext, host };
}
const respond =
  (body: string, status = 200) =>
  async () =>
    new Response(body, { status });

describe("sumFor", () => {
  test("text and binary-mode lines, exact asset name, case-insensitive hex", () => {
    const sums = `${OTHER}  install.sh\n${HASH.toUpperCase()} *panel\n${OTHER}  panel-termux-android-arm64.tar.gz\n`;
    expect(sumFor(sums, "panel")).toBe(HASH);
    expect(sumFor(sums, "install.sh")).toBe(OTHER);
    expect(sumFor(`${OTHER}  panel.prev\nnot a line\n`, "panel")).toBeNull();
  });
});

describe("checkRelease (K19, C24)", () => {
  test("local build (no tag): no fetch at all", async () => {
    const { ctx, host } = ctxWith(respond(""));
    expect(await checkRelease(ctx, file, "")).toEqual({ kind: "local" });
    expect(host.records.filter((r) => r.kind === "fetch")).toEqual([]);
  });

  test("ok: fetches <download>/<tag>/SHA256SUMS over https and matches the panel line", async () => {
    const { ctx, host } = ctxWith(respond(`${OTHER}  install.sh\n${HASH}  ${RELEASE_ASSET}\n`));
    expect(await checkRelease(ctx, file, TAG)).toEqual({ kind: "ok", tag: TAG });
    const urls = host.records.filter((r) => r.kind === "fetch").map((r) => r.argv[0]);
    expect(urls).toEqual([`${RELEASE_DOWNLOAD_URL}/${TAG}/SHA256SUMS`]);
    expect(urls[0]?.startsWith("https://")).toBe(true);
  });

  test("one byte different → mismatch; no panel line → missing; 404 → not-found", async () => {
    expect((await checkRelease(ctxWith(respond(`${OTHER}  panel\n`)).ctx, file, TAG)).kind).toBe("mismatch");
    expect((await checkRelease(ctxWith(respond(`${HASH}  install.sh\n`)).ctx, file, TAG)).kind).toBe("missing");
    expect((await checkRelease(ctxWith(respond("Not Found", 404)).ctx, file, TAG)).kind).toBe("not-found");
  });

  test("network failure and 5xx → offline (never throws)", async () => {
    const down = await checkRelease(ctxWith(undefined).ctx, file, TAG); // fake default: offline
    expect(down).toMatchObject({ kind: "offline", tag: TAG });
    expect(await checkRelease(ctxWith(respond("", 503)).ctx, file, TAG)).toMatchObject({
      kind: "offline",
      detail: "HTTP 503",
    });
  });
});

describe("verifyLine", () => {
  test("ok states the limit (intact, not origin) and names gh attestation for a computer", () => {
    const l = verifyLine({ kind: "ok", tag: TAG });
    expect(l.kind).toBe("ok");
    expect(l.text).toContain("proves the download is intact, not where it came from");
    expect(l.hint).toContain("gh attestation verify panel --repo makurosolusi/panel-termux");
  });

  test("local → info; offline → error that offers --skip-verify; mismatch → error", () => {
    expect(verifyLine({ kind: "local" })).toEqual({ kind: "info", text: "local build: not checked against a release" });
    const off = verifyLine({ kind: "offline", tag: TAG, detail: "x" });
    expect(off.kind).toBe("error");
    expect(off.hint).toContain("--skip-verify");
    expect(verifyLine({ kind: "mismatch", tag: TAG, detail: "x" }).kind).toBe("error");
  });
});
