// Self check of `panel init` (PLAN/07 K19, C24): the bytes about to be installed (~/panel/panel.new) are hashed and
// matched against the `panel` line of SHA256SUMS of the release tag embedded at build time, fetched over HTTPS.
// Proves the download is intact, not where it came from (D12); `gh attestation verify` on a computer proves origin.
import type { DoctorState } from "../shared/doctor.types";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { releaseTag, sha256File } from "./init.mode";
import { INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

/** Release downloads of this repo; `<tag>/SHA256SUMS` lives under it (PLAN/07 §8.2). */
export const RELEASE_DOWNLOAD_URL = "https://github.com/makurosolusi/panel-termux/releases/download";
/** Asset name of the raw binary in SHA256SUMS (§8.2). */
export const RELEASE_ASSET = "panel";
const FETCH_TIMEOUT_MS = 30_000;
const HTTP_NOT_FOUND = 404;
const VERIFY_CMD = "gh attestation verify panel --repo makurosolusi/panel-termux";
const originHint = () =>
  tr(
    `to prove where the release came from, on a computer: ${VERIFY_CMD}`,
    `untuk membuktikan asal rilis, di komputer: ${VERIFY_CMD}`,
  );
const skipLine = (): CheckLine => ({
  kind: "warning",
  text: tr(
    "SELF CHECK SKIPPED: this binary is not matched against any release",
    "CEK DIRI DILEWATI: binary ini tidak dicocokkan dengan rilis apa pun",
  ),
});
const redownloadHint = () =>
  tr(
    "download again with the full install line from the README, then run it again",
    "unduh ulang dengan seluruh baris pasang dari README, lalu jalankan lagi",
  );

/** A checked-fact plan line (never an action). */
export type CheckLine = PlanLine & { kind: DoctorState };

/** Outcome of comparing one file with the release: `local` = build without tag (no fetch). */
export type VerifyOutcome =
  | { kind: "ok"; tag: string }
  | { kind: "local" }
  | { kind: "mismatch" | "missing" | "not-found" | "offline"; tag: string; detail: string };

/** Hex SHA-256 of `asset` in SHA256SUMS text (`<hex>  name` or `<hex> *name`); null when there is no such line. */
export function sumFor(sums: string, asset: string): string | null {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+?)\s*$/.exec(line);
    if (m && m[2] === asset) return m[1]?.toLowerCase() ?? null;
  }
  return null;
}

/** Fetches SHA256SUMS of `tag` and compares the `panel` line with `file`'s hash. Never throws for network/HTTP. */
export async function checkRelease(ctx: InitContext, file: string, tag = releaseTag()): Promise<VerifyOutcome> {
  if (!tag) return { kind: "local" };
  const url = `${RELEASE_DOWNLOAD_URL}/${tag}/SHA256SUMS`;
  let sums: string;
  try {
    const res = await ctx.host.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === HTTP_NOT_FOUND) return { kind: "not-found", tag, detail: url };
    if (!res.ok) return { kind: "offline", tag, detail: `HTTP ${res.status}` };
    sums = await res.text();
  } catch (e) {
    return { kind: "offline", tag, detail: (e as Error).message };
  }
  const want = sumFor(sums, RELEASE_ASSET);
  if (want === null) return { kind: "missing", tag, detail: url };
  const got = await sha256File(file);
  return got === want ? { kind: "ok", tag } : { kind: "mismatch", tag, detail: `${got} ≠ ${want}` };
}

/** Outcome as a plan/result line (ok, info, or error with what to do). */
export function verifyLine(o: VerifyOutcome): CheckLine {
  switch (o.kind) {
    case "ok":
      return {
        kind: "ok",
        text: tr(
          `Binary matches SHA256SUMS of release ${o.tag} (proves the download is intact, not where it came from)`,
          `Binary cocok dengan SHA256SUMS rilis ${o.tag} (membuktikan unduhan utuh, bukan asal rilis)`,
        ),
        hint: originHint(),
      };
    case "local":
      return {
        kind: "info",
        text: tr("local build: not checked against a release", "build lokal: tidak dicek terhadap rilis"),
      };
    case "mismatch":
      return {
        kind: "error",
        text: tr(
          `This binary does not match SHA256SUMS of release ${o.tag}: the download is damaged or not from that release`,
          `Binary ini tidak cocok dengan SHA256SUMS rilis ${o.tag}: unduhan rusak atau bukan dari rilis itu`,
        ),
        hint: redownloadHint(),
      };
    case "missing":
      return {
        kind: "error",
        text: tr(
          `SHA256SUMS of release ${o.tag} has no "${RELEASE_ASSET}" line`,
          `SHA256SUMS rilis ${o.tag} tidak memuat baris "${RELEASE_ASSET}"`,
        ),
        hint: redownloadHint(),
      };
    case "not-found":
      return {
        kind: "error",
        text: tr(
          `Release ${o.tag} has no SHA256SUMS (${o.detail} → 404)`,
          `Rilis ${o.tag} tidak punya SHA256SUMS (${o.detail} → 404)`,
        ),
        hint: redownloadHint(),
      };
    case "offline":
      return {
        kind: "error",
        text: tr(
          `The self check needs internet: SHA256SUMS of release ${o.tag} could not be downloaded (${o.detail})`,
          `Cek diri butuh internet: SHA256SUMS rilis ${o.tag} tidak bisa diunduh (${o.detail})`,
        ),
        hint: tr(
          "connect to the internet and try again, or run it in a terminal with --skip-verify",
          "sambungkan internet lalu ulangi, atau jalankan di terminal dengan --skip-verify",
        ),
      };
  }
}

/** Dry-run preview (§4.1): what the check would say about this binary; `--skip-verify` = a warning, no fetch. */
export async function previewVerify(ctx: InitContext, file: string): Promise<CheckLine> {
  if (ctx.args.skipVerify) return skipLine();
  return verifyLine(await checkRelease(ctx, file));
}

/**
 * Checks `file` (panel.new) before it is renamed into place: ok/local → prints the line and returns; any failure →
 * CliExit 1. `--skip-verify`: loud warning + TTY question (default no; ctx.confirmRisky), no → exit 4. The caller
 * removes `file` when this throws.
 */
export async function verifyInstall(ctx: InitContext, file: string): Promise<void> {
  if (ctx.args.skipVerify) {
    const skip = skipLine();
    ctx.out.check(skip.kind, skip.text);
    const go = await ctx.confirmRisky(
      "skip-verify",
      tr("Install this unchecked binary?", "Pasang binary yang tidak dicek ini?"),
      tr(
        `${ctx.resumeCommand()} (without --skip-verify, with internet)`,
        `${ctx.resumeCommand()} (tanpa --skip-verify, dengan internet)`,
      ),
    );
    if (!go)
      throw new CliExit(
        INIT_EXIT.cancelled,
        tr("Cancelled: the binary was not installed.", "Dibatalkan: binary tidak dipasang."),
      );
    return;
  }
  const line = verifyLine(await checkRelease(ctx, file));
  if (line.kind === "error") throw new CliExit(INIT_EXIT.failed, `${line.text}.`, line.hint);
  ctx.out.check(line.kind, line.text, line.hint ?? null);
}
