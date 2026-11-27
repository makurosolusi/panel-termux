// apps_json_rebuild fix (R&D/07 #7): an apps.json that no longer parses is rebuilt from the panel's own site table.
// Only managed sites whose `run` and `app` exist get an entry (D5), so pm2 never gets a script that is not there.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FixChange } from "../../shared/fix.types";
import { site } from "../db/schema";
import { panelAppEntry } from "../deploy/run.script";
import { redactLines } from "../system/log.redact";
import { parseApps } from "./apps.file";
import { type SiteCtx, sitePaths } from "./site.checks";
import { readBytesOrNull } from "./site.files";

/** What the rebuild would write: the current bytes, the new list and its plain diff; null = nothing to rebuild. */
export type AppsRebuild = { path: string; original: Buffer; candidate: Buffer; changes: FixChange[]; names: string[] };

/** The rebuild of apps.json, or null when the file is missing (D3 creates it) or still parses. */
export function planAppsRebuild(ctx: SiteCtx): AppsRebuild | null {
  const path = sitePaths(ctx).appsJson;
  const original = readBytesOrNull(path);
  if (original === null) return null;
  const text = original.toString("utf8");
  try {
    parseApps(text);
    return null;
  } catch {
    // unparsable: rebuilt below
  }
  const entries = ctx.db
    .select()
    .from(site)
    .where(eq(site.managed, true))
    .all()
    .filter((s) => existsSync(join(s.dir, "run")) && existsSync(join(s.dir, "app")))
    .map((s) => panelAppEntry(s.app ?? s.name, s.dir));
  const lines = JSON.stringify(entries, null, 2).split("\n");
  // The old file may hold env values of 0.2.x entries: the preview shows them redacted.
  const old = redactLines(text.replace(/\n$/, "").split("\n")).lines;
  const changes: FixChange[] = [
    ...old.map((t, i) => ({ kind: "remove" as const, line: i + 1, text: t })),
    { kind: "add", afterLine: old.length, lines },
  ];
  return {
    path,
    original,
    candidate: Buffer.from(`${lines.join("\n")}\n`),
    changes,
    names: entries.map((e) => e.name),
  };
}
