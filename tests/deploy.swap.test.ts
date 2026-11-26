import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { job } from "@/server/db/schema";
import {
  type BinPaths,
  binPaths,
  deploySwap,
  type LinkFn,
  repairSwap,
  rollbackSwap,
  type SwapPoint,
  sha256File,
  undoDeploySwap,
} from "@/server/deploy/swap";
import { deployHarness, sha256 } from "./deploy.fixture";

class Crash extends Error {}
const at = (point: SwapPoint) => (p: SwapPoint) => {
  if (p === point) throw new Crash(point);
};
/** link(2) as Android refuses it in Termux app data (lab E9). */
const termuxLink: LinkFn = () => {
  throw Object.assign(new Error("EACCES: permission denied, link"), { code: "EACCES" });
};
const MODES = [
  ["hardlink", undefined],
  ["copy (E9)", termuxLink],
] as const;

const enc = (s: string) => new TextEncoder().encode(s);
const shaOf = (s: string) => sha256(enc(s));
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
const temps = (p: BinPaths) => [p.next, p.drop, p.swp].filter((f) => existsSync(f));

/** A site folder with optional app/app.prev/app.new contents. */
function folder(files: { app?: string; prev?: string; next?: string }): BinPaths {
  const p = binPaths(mkdtempSync(join(tmpdir(), "panel-swap-")));
  if (files.app !== undefined) writeFileSync(p.app, files.app);
  if (files.prev !== undefined) writeFileSync(p.prev, files.prev);
  if (files.next !== undefined) writeFileSync(p.next, files.next);
  return p;
}

const DEPLOY_POINTS: SwapPoint[] = ["deploy:dropped", "deploy:copied", "deploy:linked", "deploy:renamed"];
const SCENARIOS = [
  { label: "app + app.prev", app: "A", prev: "B" },
  { label: "app only", app: "A", prev: undefined },
  { label: "first deploy", app: undefined, prev: undefined },
] as const;

describe("deploy swap: crash at every point, then cleanup restores the pre-job version", () => {
  for (const [mode, link] of MODES) {
    for (const sc of SCENARIOS) {
      for (const point of DEPLOY_POINTS) {
        test(`${mode} · ${sc.label} · crash after ${point}`, async () => {
          const p = folder({ app: sc.app, prev: sc.prev, next: "N" });
          let crashed = false;
          try {
            deploySwap(p, at(point), link);
          } catch (e) {
            if (!(e instanceof Crash)) throw e;
            crashed = true;
          }
          if (sc.app !== undefined) expect(existsSync(p.app)).toBe(true); // app exists at every point
          const row = await repairSwap(p, {
            kind: "deploy",
            sha256: shaOf("N"),
            fromSha256: sc.app ? shaOf(sc.app) : null,
            firstDeploy: sc.app === undefined,
          });
          expect(read(p.app)).toBe(sc.app ?? null);
          if (sc.prev !== undefined || !crashed) expect(read(p.prev)).toBe(sc.prev ?? null);
          // Only "app only" cut right after the copy/link leaves app.prev = the live binary (same bytes, harmless).
          else expect<(string | null)[]>([null, sc.app ?? null]).toContain(read(p.prev));
          expect(temps(p)).toEqual([]);
          expect(row).toMatch(/^[SD]\d$/);
          rmSync(p.app, { force: true });
        });
      }
    }
  }

  test("completed swap with the old app.prev still set aside (D3 with drop) goes back fully", async () => {
    const p = folder({ app: "A", prev: "B", next: "N" });
    deploySwap(p, undefined, termuxLink);
    expect([read(p.app), read(p.prev), read(p.drop)]).toEqual(["N", "A", "B"]);
    const input = { kind: "deploy", sha256: shaOf("N"), fromSha256: shaOf("A"), firstDeploy: false } as const;
    expect(await repairSwap(p, input)).toBe("D3");
    expect([read(p.app), read(p.prev), temps(p)]).toEqual(["A", "B", []]);
    expect(await repairSwap(p, input)).toBe("D5"); // idempotent: nothing left to do
    expect([read(p.app), read(p.prev)]).toEqual(["A", "B"]);
  });

  test("redeploy of the same sha before the swap started changes nothing", async () => {
    const p = folder({ app: "A", prev: "B" });
    const row = await repairSwap(p, { kind: "deploy", sha256: shaOf("A"), fromSha256: shaOf("A"), firstDeploy: false });
    expect(row).toBe("D5");
    expect([read(p.app), read(p.prev)]).toEqual(["A", "B"]);
  });

  test("first deploy finished but cut off before success → binary removed (D4)", async () => {
    const p = folder({ next: "N" });
    deploySwap(p);
    expect(await repairSwap(p, { kind: "deploy", sha256: shaOf("N"), fromSha256: null, firstDeploy: true })).toBe("D4");
    expect(existsSync(p.app)).toBe(false);
  });

  test.each(MODES)("undo of a completed deploy swap (%s) restores app and app.prev", (_m, link) => {
    const p = folder({ app: "A", prev: "B", next: "N" });
    const s = deploySwap(p, undefined, link);
    expect(s).toEqual({ hadApp: true, hadPrev: true, linked: link === undefined });
    undoDeploySwap(p, s);
    expect([read(p.app), read(p.prev), temps(p)]).toEqual(["A", "B", []]);
  });
});

describe("rollback swap: crash at every point, then cleanup restores the pre-job version", () => {
  const POINTS: SwapPoint[] = ["rollback:copied", "rollback:linked", "rollback:renamed", "rollback:done"];
  for (const [mode, link] of MODES) {
    for (const point of POINTS) {
      if (point === "rollback:copied" && link === undefined) continue; // no copy with hardlinks
      test(`${mode} · crash after ${point}`, async () => {
        const p = folder({ app: "A", prev: "B" });
        try {
          rollbackSwap(p, at(point), link);
        } catch (e) {
          if (!(e instanceof Crash)) throw e;
        }
        expect(existsSync(p.app)).toBe(true);
        if (point === "rollback:copied") writeFileSync(p.swp, "A-partial"); // cut off mid-copy
        const row = await repairSwap(p, { kind: "rollback", toSha256: shaOf("B"), fromSha256: shaOf("A") });
        expect([read(p.app), read(p.prev), temps(p)]).toEqual(["A", "B", []]);
        expect(row).toMatch(/^R\d$|^D5$/);
      });
    }
  }

  test("a completed rollback is its own undo", () => {
    const p = folder({ app: "A", prev: "B" });
    rollbackSwap(p, undefined, termuxLink);
    expect([read(p.app), read(p.prev)]).toEqual(["B", "A"]);
    rollbackSwap(p);
    expect([read(p.app), read(p.prev), temps(p)]).toEqual(["A", "B", []]);
  });
});

describe("states without app (external or older layouts)", () => {
  const input = { kind: "deploy", sha256: shaOf("N"), fromSha256: null, firstDeploy: false } as const;
  test("S1: .app.swap becomes app", async () => {
    const p = folder({});
    writeFileSync(p.swp, "A");
    expect(await repairSwap(p, input)).toBe("S1");
    expect([read(p.app), temps(p)]).toEqual(["A", []]);
  });
  test("S2: app.prev becomes app, the set-aside one app.prev", async () => {
    const p = folder({ prev: "B", next: "N" });
    writeFileSync(p.drop, "C");
    expect(await repairSwap(p, input)).toBe("S2");
    expect([read(p.app), read(p.prev), temps(p)]).toEqual(["B", "C", []]);
  });
  test("S3: nothing live → staged file removed", async () => {
    const p = folder({ next: "N" });
    expect(await repairSwap(p, input)).toBe("S3");
    expect([existsSync(p.app), temps(p)]).toEqual([false, []]);
  });
  test("sha256File streams the file", async () => {
    const p = folder({ app: "hello" });
    expect(await sha256File(p.app)).toBe(shaOf("hello"));
  });
});

describe("job.cleanup of an interrupted deploy (POST /jobs/:id/recover path)", () => {
  const h = deployHarness();

  test("crash mid-swap → cleanup repairs files, rewrites run, restarts, checks health, resolves the job", async () => {
    const { dir, port } = h.addSite("shop");
    h.healthy.add(port);
    const p = binPaths(dir);
    const { fakeElf } = await import("./deploy.fixture");
    const A = fakeElf({ fill: 1 });
    writeFileSync(p.app, A);
    writeFileSync(p.prev, fakeElf({ fill: 2 }));
    writeFileSync(p.next, fakeElf({ fill: 3 }));
    try {
      deploySwap(p, at("deploy:linked"), termuxLink);
    } catch (e) {
      if (!(e instanceof Crash)) throw e;
    }
    const id = "j-interrupted";
    const input = { site: "shop", sha256: sha256(fakeElf({ fill: 3 })), fromSha256: sha256(A), firstDeploy: false };
    h.db
      .insert(job)
      .values({
        id,
        kind: "site.deploy",
        target: "shop",
        status: "interrupted",
        steps: [],
        actorId: h.adminId,
        startedAt: new Date(),
        input,
      })
      .run();
    const cleanupId = h.deploys.recover(h.adminId, { jobId: id, kind: "site.deploy", target: "shop", input });
    const j = await h.waitJob(cleanupId);
    expect(j).toMatchObject({ kind: "job.cleanup", status: "succeeded" });
    expect(Object.fromEntries(j.steps.map((s) => [s.key, s.code]))).toEqual({
      inspect: "inspect_found",
      swap: "swap_back",
      run_script: "run_written",
      apps_entry: "apps_registered",
      app_restart: "app_started",
      health: "healthy",
    });
    expect(j.steps.find((s) => s.key === "swap")?.params).toEqual({ row: "D2" });
    expect(new Uint8Array(readFileSync(p.app))).toEqual(A);
    expect(temps(p)).toEqual([]);
    expect(read(join(dir, "run"))).toContain("exec ./app");
    expect(h.jobs.get(id).resolvedBy).toBe(cleanupId);
  });

  test("site gone → inspect_nothing, still resolves", async () => {
    const id = "j-gone";
    h.db
      .insert(job)
      .values({
        id,
        kind: "site.rollback",
        target: "ghost",
        status: "interrupted",
        steps: [],
        actorId: h.adminId,
        startedAt: new Date(),
        input: {},
      })
      .run();
    const j = await h.waitJob(
      h.deploys.recover(h.adminId, { jobId: id, kind: "site.rollback", target: "ghost", input: {} }),
    );
    expect(j.status).toBe("succeeded");
    expect(j.steps[0]?.code).toBe("inspect_nothing");
    expect(h.jobs.get(id).resolvedBy).toBe(j.id);
  });
});
