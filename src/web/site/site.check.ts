import type {
  JobParams,
  SiteCheckRequest,
  SiteCheckResult,
  SiteCreateRequest,
  SiteIssue,
  SiteNote,
} from "@/shared/site.types";
import { idSite } from "@/web/i18n/id.site";
import { type EnvRow, envRecord, envRowsValid } from "./env.rows";

/** Domains per site: one primary + up to 4 extra (one job, one cloudflared restart). */
export const MAX_HOSTNAMES = 5;

/** Copy entry that may interpolate params. */
type Copy = string | ((p: JobParams) => string);

/** Renders an i18n entry with server params. */
export const renderCopy = (copy: Copy, params: JobParams = {}): string =>
  typeof copy === "function" ? copy(params) : copy;

/** Indonesian text of a check issue from its code; the server's text only for codes this build does not know. */
export function issueText(i: SiteIssue): string {
  const copy = (idSite.issues as Readonly<Record<string, Copy>>)[i.code];
  return copy ? renderCopy(copy, { hostname: i.hostname ?? null, ...i.params }) : i.message;
}

/** Indonesian text of a non-blocking DNS note. */
export const noteText = (n: SiteNote): string => renderCopy(idSite.notes[n.code], n.params);

/** Port text → number; "" → undefined (server suggests one); anything not 1–65535 → "invalid". */
export function parsePort(text: string): number | undefined | "invalid" {
  const s = text.trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65_535 ? n : "invalid";
}

/** Wizard form state across all steps; `hostnames[0]` is the primary domain. */
export type SiteForm = { name: string; hostnames: string[]; port: string; database: boolean; env: EnvRow[] };

/** Empty wizard form. */
export const EMPTY_SITE_FORM: SiteForm = { name: "", hostnames: [""], port: "", database: false, env: [] };

const cleanHost = (h: string) => h.trim().toLowerCase();

/** Trimmed name and the filled-in domains (trimmed, lower-cased), as both /check and create receive them. */
export function normalizeTarget(f: Pick<SiteForm, "name" | "hostnames">) {
  const hostnames = f.hostnames.map(cleanHost).filter((h) => h !== "");
  return { name: f.name.trim(), hostname: hostnames[0] ?? "", extraHostnames: hostnames.slice(1) };
}

/** Check request for the current step-1 values, or null while name/domain are empty or the port is invalid. */
export function checkRequest(f: SiteForm): SiteCheckRequest | null {
  const { name, hostname, extraHostnames } = normalizeTarget(f);
  const port = parsePort(f.port);
  if (!name || !hostname || port === "invalid") return null;
  return {
    name,
    hostname,
    ...(extraHostnames.length ? { extraHostnames } : {}),
    ...(port === undefined ? {} : { port }),
    database: f.database,
  };
}

/** Per-field issue texts; hostname issues are keyed by the (normalized) domain they belong to. */
export type TargetIssues = {
  name: string[];
  port: string[];
  hostnames: Record<string, string[]>;
  leftoverJobId?: string;
};

/** Groups the check's issues per field and per domain, in Indonesian. */
export function targetIssues(result: SiteCheckResult | undefined): TargetIssues {
  const out: TargetIssues = { name: [], port: [], hostnames: {} };
  for (const i of result?.issues ?? []) {
    if (i.code === "name_leftover" && typeof i.params?.jobId === "string") out.leftoverJobId = i.params.jobId;
    if (i.field !== "hostname") out[i.field].push(issueText(i));
    else {
      const key = cleanHost(i.hostname ?? "");
      out.hostnames[key] = [...(out.hostnames[key] ?? []), issueText(i)];
    }
  }
  return out;
}

/** Notes per (normalized) domain. */
export function notesByHost(result: SiteCheckResult | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const n of result?.notes ?? []) out[n.hostname] = [...(out[n.hostname] ?? []), noteText(n)];
  return out;
}

/** Step 1 may proceed: name and domain filled, port valid, and the latest check (for these values) passed. */
export function targetReady(f: SiteForm, check: SiteCheckResult | undefined, checking: boolean): boolean {
  return checkRequest(f) !== null && !checking && check?.ok === true;
}

/** Step 2 may proceed: every env row valid. */
export const optionsReady = (f: SiteForm): boolean => envRowsValid(f.env);

/** Body of POST /sites; empty port, extra domains and env are omitted. */
export function createBody(f: SiteForm): SiteCreateRequest {
  const { name, hostname, extraHostnames } = normalizeTarget(f);
  const port = parsePort(f.port);
  const env = envRecord(f.env);
  return {
    name,
    hostname,
    ...(extraHostnames.length ? { extraHostnames } : {}),
    ...(typeof port === "number" ? { port } : {}),
    database: f.database,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/** What creating `body` will do, step by step (mirrors the server's site.create steps). */
export function createPlan(body: SiteCreateRequest, tokenSet: boolean): string[] {
  const p = idSite.wizard.plan;
  const hosts = [body.hostname, ...(body.extraHostnames ?? [])].join(", ");
  const params: JobParams = {
    name: body.name,
    database: body.database,
    env: Object.keys(body.env ?? {}).length,
    hosts,
    port: body.port ?? null,
    token: tokenSet,
  };
  return [p.validate, p.folder, p.database, p.env_write, p.ingress, p.dns, p.tunnel_restart, p.domain_probe].map((c) =>
    renderCopy(c, params),
  );
}

/** Other domains on this phone that the cloudflared restart interrupts (named in the blip warning), max 3. */
export function blipHosts(siteHosts: readonly string[], panelHost: string, newHosts: readonly string[]): string[] {
  const skip = new Set(newHosts);
  return [...new Set([...siteHosts, panelHost])].filter((h) => h && !skip.has(h)).slice(0, 3);
}
