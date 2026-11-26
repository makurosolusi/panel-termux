// Minimal line-based editor for cloudflared config.yml. Bun.YAML.stringify would drop comments and
// rewrite the hand-written file in flow style, so rules are inserted/removed as text and every edit is
// re-parsed and checked: only the ingress list may change, and exactly as intended.

/** Thrown when config.yml cannot be edited safely (shape not understood, or the re-parse check failed). */
export class IngressEditError extends Error {}

type Rule = Record<string, unknown>;
type Doc = Record<string, unknown> & { ingress?: Rule[] };
type Item = { start: number; end: number; hostname: string | null };

const INGRESS_KEY = /^ingress:\s*(#.*)?$/;
const HOSTNAME_LINE = /^\s*(?:-\s+)?hostname:\s*["']?([^"'\s#]+)["']?\s*(#.*)?$/;
const indentOf = (l: string) => l.length - l.trimStart().length;
const isFiller = (l: string) => l.trim() === "" || l.trim().startsWith("#");

function parse(text: string): Doc {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(text);
  } catch (e) {
    throw new IngressEditError(`config.yml is not valid YAML: ${(e as Error).message}`, { cause: e });
  }
  if (typeof doc !== "object" || doc === null || !Array.isArray((doc as Doc).ingress)) {
    throw new IngressEditError("config.yml has no ingress list");
  }
  return doc as Doc;
}

/** Locates the ingress list items (line ranges, end exclusive, trailing comments/blank lines excluded). */
function scan(lines: string[]): { items: Item[]; pad: number } {
  const at = lines.findIndex((l) => INGRESS_KEY.test(l));
  if (at === -1) throw new IngressEditError("config.yml: top-level `ingress:` line not found");
  const first = lines.findIndex((l, i) => i > at && !isFiller(l));
  if (first === -1 || !lines[first]?.trimStart().startsWith("- ")) {
    throw new IngressEditError("config.yml: ingress is not a block list");
  }
  const pad = indentOf(lines[first] as string);
  const items: Item[] = [];
  for (let i = first; i < lines.length; i++) {
    const l = lines[i] as string;
    if (isFiller(l)) continue;
    const ind = indentOf(l);
    if (ind < pad || (ind === pad && !l.trimStart().startsWith("-"))) break;
    if (ind === pad) items.push({ start: i, end: i + 1, hostname: null });
    const cur = items.at(-1) as Item;
    cur.end = i + 1;
    cur.hostname ??= l.match(HOSTNAME_LINE)?.[1] ?? null;
  }
  return { items, pad };
}

function verify(before: Doc, afterText: string, expected: Rule[]): void {
  const after = parse(afterText);
  const strip = ({ ingress: _i, ...rest }: Doc) => JSON.stringify(rest);
  if (strip(before) !== strip(after) || JSON.stringify(after.ingress) !== JSON.stringify(expected)) {
    throw new IngressEditError("config.yml edit check failed: result differs from the intended change");
  }
}

/** Hostnames of the ingress rules (catch-all excluded). */
export function ingressHostnames(text: string): string[] {
  return (parse(text).ingress ?? []).flatMap((r) => (typeof r.hostname === "string" ? [r.hostname] : []));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRED_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;

/**
 * Tunnel UUID (the CNAME target is `<uuid>.cfargotunnel.com`). `tunnel:` may be a tunnel NAME (it is
 * "poco" on the phone), so then the UUID comes from the credentials-file name `<uuid>.json`; null if neither.
 */
export function readTunnelId(text: string): string | null {
  const doc = parse(text);
  const t = typeof doc.tunnel === "string" ? doc.tunnel.trim() : "";
  if (UUID_RE.test(t)) return t.toLowerCase();
  const cred = doc["credentials-file"];
  return typeof cred === "string" ? (cred.match(CRED_UUID_RE)?.[1]?.toLowerCase() ?? null) : null;
}

/** Inserts `{hostname, service}` right above the final catch-all rule. `hostname` must be pre-validated. */
export function insertIngressRule(text: string, hostname: string, service: string): string {
  const doc = parse(text);
  const lines = text.split("\n");
  const { items, pad } = scan(lines);
  const last = items.at(-1);
  if (!last || last.hostname !== null) throw new IngressEditError("config.yml: last ingress rule is not a catch-all");
  if (items.some((it) => it.hostname === hostname)) {
    throw new IngressEditError(`config.yml: ${hostname} already has an ingress rule`);
  }
  const sp = " ".repeat(pad);
  lines.splice(last.start, 0, `${sp}- hostname: ${hostname}`, `${sp}  service: ${service}`);
  const out = lines.join("\n");
  const rules = doc.ingress ?? [];
  verify(doc, out, [...rules.slice(0, -1), { hostname, service }, ...rules.slice(-1)]);
  return out;
}

/** Removes the rule for `hostname`; returns the text unchanged when there is none. */
export function removeIngressRule(text: string, hostname: string): string {
  const doc = parse(text);
  const lines = text.split("\n");
  const item = scan(lines).items.find((it) => it.hostname === hostname);
  if (!item) return text;
  lines.splice(item.start, item.end - item.start);
  const out = lines.join("\n");
  verify(
    doc,
    out,
    (doc.ingress ?? []).filter((r) => r.hostname !== hostname),
  );
  return out;
}
