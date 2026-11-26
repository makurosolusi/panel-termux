import type { SiteCheckRequest, SiteCheckResult, SiteCreateRequest, SiteIssue } from "@/shared/site.types";
import { type EnvRow, envRecord, envRowsValid } from "./env.rows";

/** Field of the wizard's first step that a check issue belongs to. */
export type TargetField = SiteIssue["field"];

/** Issue messages grouped per field (fields without issues are absent). */
export function issuesByField(issues: readonly SiteIssue[]): Partial<Record<TargetField, string[]>> {
  const out: Partial<Record<TargetField, string[]>> = {};
  for (const i of issues) out[i.field] = [...(out[i.field] ?? []), i.message];
  return out;
}

/** Port text → number; "" → undefined (server suggests one); anything not 1–65535 → "invalid". */
export function parsePort(text: string): number | undefined | "invalid" {
  const s = text.trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65_535 ? n : "invalid";
}

/** Wizard form state across all steps. */
export type SiteForm = { name: string; hostname: string; port: string; database: boolean; env: EnvRow[] };

/** Trimmed name/hostname, lower-cased hostname: what both /check and create receive. */
export const normalizeTarget = (f: Pick<SiteForm, "name" | "hostname">) => ({
  name: f.name.trim(),
  hostname: f.hostname.trim().toLowerCase(),
});

/** Check request for the current step-1 values, or null while incomplete or the port is invalid. */
export function checkRequest(f: SiteForm): SiteCheckRequest | null {
  const { name, hostname } = normalizeTarget(f);
  const port = parsePort(f.port);
  if (!name || !hostname || port === "invalid") return null;
  return { name, hostname, ...(port === undefined ? {} : { port }) };
}

/** Step 1 may proceed: both fields filled, port valid, and the latest check (for these values) passed. */
export function targetReady(f: SiteForm, check: SiteCheckResult | undefined, checking: boolean): boolean {
  const { name, hostname } = normalizeTarget(f);
  return name !== "" && hostname !== "" && parsePort(f.port) !== "invalid" && !checking && check?.ok === true;
}

/** Step 2 may proceed: every env row valid. */
export const optionsReady = (f: SiteForm): boolean => envRowsValid(f.env);

/** Body of POST /sites; empty port and empty env are omitted. */
export function createBody(f: SiteForm): SiteCreateRequest {
  const port = parsePort(f.port);
  const env = envRecord(f.env);
  return {
    ...normalizeTarget(f),
    ...(typeof port === "number" ? { port } : {}),
    database: f.database,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
