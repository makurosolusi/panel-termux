// Crash-safe binary swap of a site folder (PLAN/03 D23): `app` exists at every point of a deploy or rollback, and
// `repairSwap` brings any interrupted state back (cleanup table S1–S3 / R1–R3 / D1–D5, PLAN/03 §4.11).
import { existsSync, linkSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type LinkFn, linkOrCopy } from "../../shared/file.link";

/** Binary files of one site folder: live, previous, staged, old previous set aside, rollback/copy temp. */
export type BinPaths = { app: string; prev: string; next: string; drop: string; swp: string };

/** Binary paths inside site folder `dir` (names = SITE_BINARY_NAMES). */
export const binPaths = (dir: string): BinPaths => ({
  app: join(dir, "app"),
  prev: join(dir, "app.prev"),
  next: join(dir, "app.new"),
  drop: join(dir, ".app.prev.drop"),
  swp: join(dir, ".app.swap"),
});

/** Called after every file operation with its name; tests throw from it to simulate a crash at that point. */
export type SwapHook = (point: SwapPoint) => void;
/** Points between the operations of a swap. */
export type SwapPoint =
  | "deploy:dropped"
  | "deploy:copied"
  | "deploy:linked"
  | "deploy:renamed"
  | "rollback:copied"
  | "rollback:linked"
  | "rollback:renamed"
  | "rollback:done";

const noop: SwapHook = () => {};

export type { LinkFn };

/** What a deploy swap found and did; `linked` null = there was no live binary to keep. */
export type DeploySwap = { hadApp: boolean; hadPrev: boolean; linked: boolean | null };

/**
 * Deploy: `app.prev → .app.prev.drop`, `app` kept as `app.prev` (hardlink or copy via `.app.swap`),
 * `app.new → app`. The old app.prev stays in `.app.prev.drop` until the job succeeded.
 */
export function deploySwap(p: BinPaths, hook: SwapHook = noop, link: LinkFn = linkSync): DeploySwap {
  if (!existsSync(p.next)) throw new Error(`${p.next} is missing`);
  const hadApp = existsSync(p.app);
  const hadPrev = existsSync(p.prev);
  if (hadPrev) {
    renameSync(p.prev, p.drop);
    hook("deploy:dropped");
  }
  let linked: boolean | null = null;
  if (hadApp) {
    linked = linkOrCopy(p.app, p.prev, { link, via: p.swp, onCopied: () => hook("deploy:copied") });
    hook("deploy:linked");
  }
  renameSync(p.next, p.app);
  hook("deploy:renamed");
  return { hadApp, hadPrev, linked };
}

/** Undo of a completed deploySwap: the replaced binary back to `app`, the set-aside one back to `app.prev`. */
export function undoDeploySwap(p: BinPaths, s: DeploySwap): void {
  if (s.hadApp) renameSync(p.prev, p.app);
  else rmSync(p.app, { force: true });
  if (s.hadPrev) renameSync(p.drop, p.prev);
}

/** Rollback: `app` kept as `.app.swap` (hardlink or copy), `app.prev → app`, `.app.swap → app.prev`. Its own undo. */
export function rollbackSwap(p: BinPaths, hook: SwapHook = noop, link: LinkFn = linkSync): { linked: boolean } {
  if (!existsSync(p.app) || !existsSync(p.prev)) throw new Error(`rollback needs ${p.app} and ${p.prev}`);
  const linked = linkOrCopy(p.app, p.swp, { link, onCopied: () => hook("rollback:copied") });
  hook("rollback:linked");
  renameSync(p.prev, p.app);
  hook("rollback:renamed");
  renameSync(p.swp, p.prev);
  hook("rollback:done");
  return { linked };
}

/** Lowercase hex sha256 of a file, streamed. */
export async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
}

/** Journal of the interrupted job (`job.input`): what it was putting in place and what was live before. */
export type RepairInput =
  | { kind: "deploy"; sha256: string; fromSha256: string | null; firstDeploy: boolean }
  | { kind: "rollback"; toSha256: string; fromSha256: string | null };
/** Cleanup table row that matched (PLAN/03 §4.11); "D5" also covers "nothing to do". */
export type RepairRow = "S1" | "S2" | "S3" | "R1" | "R2" | "R3" | "D1" | "D2" | "D3" | "D4" | "D5";

/**
 * Brings a site folder left by an interrupted deploy/rollback back to the version that was live before the job
 * (first matching row wins). Existence decides wherever it can; sha256 only when it cannot (D3/D4/R3).
 * Copies instead of hardlinks (E9) are handled by `app.new`/`app.prev` presence rather than inode equality.
 */
export async function repairSwap(
  p: BinPaths,
  input: RepairInput,
  shaOf: (path: string) => Promise<string> = sha256File,
): Promise<RepairRow> {
  const has = existsSync;
  const rm = (f: string) => rmSync(f, { force: true });
  if (!has(p.app)) {
    if (has(p.swp)) {
      renameSync(p.swp, p.app);
      rm(p.next);
      return "S1";
    }
    if (has(p.prev)) {
      renameSync(p.prev, p.app);
      if (has(p.drop)) renameSync(p.drop, p.prev);
      rm(p.next);
      return "S2";
    }
    if (has(p.drop)) renameSync(p.drop, p.prev);
    rm(p.next);
    return "S3";
  }
  if (input.kind === "rollback") {
    rm(p.next);
    if (has(p.swp)) {
      if (has(p.prev)) {
        rm(p.swp); // R1: copy/link made, nothing renamed yet
        return "R1";
      }
      renameSync(p.swp, p.prev); // R2: complete the rollback, then swap back like R3
      rollbackSwap(p);
      return "R2";
    }
    const sha = await shaOf(p.app);
    if (has(p.prev) && sha === input.toSha256 && sha !== input.fromSha256) {
      rollbackSwap(p);
      return "R3";
    }
    return "D5";
  }
  rm(p.swp); // a partial copy of app on its way to app.prev
  if (has(p.drop) && !has(p.prev)) {
    renameSync(p.drop, p.prev);
    rm(p.next);
    return "D1";
  }
  if (has(p.drop) && has(p.next)) {
    rm(p.prev);
    renameSync(p.drop, p.prev);
    rm(p.next);
    return "D2";
  }
  const sha = has(p.next) ? null : await shaOf(p.app);
  const started = has(p.drop) || input.sha256 !== input.fromSha256; // same sha + no drop: cannot tell, nothing to undo
  if (sha === input.sha256 && has(p.prev) && started) {
    renameSync(p.prev, p.app);
    if (has(p.drop)) renameSync(p.drop, p.prev);
    return "D3";
  }
  if (sha === input.sha256 && !has(p.prev) && input.firstDeploy) {
    rm(p.app);
    return "D4";
  }
  rm(p.next);
  return "D5";
}
