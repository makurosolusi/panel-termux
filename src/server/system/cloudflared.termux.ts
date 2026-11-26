import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runTermux } from "../exec/termux.exec";
import { log } from "../log.service";
import { type CloudflaredAdapter, type IngressRule, type ProbeResult, SystemError } from "./system.types";

/** Per-hostname HTTPS check timeout (round trip through Cloudflare takes 0.5-2 s from the phone). */
const PROBE_TIMEOUT_MS = 8_000;

const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

function portOf(service: string): number | null {
  let u: URL;
  try {
    u = new URL(service);
  } catch {
    // Non-URL services such as `http_status:404` have no port by design.
    return null;
  }
  if (u.port) return Number(u.port);
  return DEFAULT_PORTS[u.protocol] ?? null;
}

/** Parses cloudflared config.yml text into ingress rules that have a hostname (catch-all dropped). */
export function parseIngress(yamlText: string): IngressRule[] {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(yamlText);
  } catch (e) {
    throw new SystemError(`cloudflared config: invalid YAML (${(e as Error).message})`, { cause: e });
  }
  const ingress = (doc as { ingress?: unknown } | null)?.ingress;
  if (!Array.isArray(ingress)) return [];
  return ingress.flatMap((r: { hostname?: unknown; service?: unknown }) =>
    typeof r?.hostname === "string" && typeof r.service === "string"
      ? [{ hostname: r.hostname, service: r.service, port: portOf(r.service) }]
      : [],
  );
}

/** One HTTPS GET (redirects not followed) with timeout; network errors give status null. */
export async function probeHttps(hostname: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const t = performance.now();
  try {
    const res = await fetch(`https://${hostname}/`, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return { status: res.status, ms: Math.round(performance.now() - t) };
  } catch (e) {
    log.warn(`[panel] health check ${hostname} failed: ${(e as Error).name}`);
    return { status: null, ms: null };
  }
}

/** `ingress validate` only parses config + rules; a few seconds is plenty even on a slow phone. */
const VALIDATE_TIMEOUT_MS = 20_000;
const VALIDATE_MSG_MAX = 300;

/** Real cloudflared adapter reading `~/.cloudflared/config.yml` (missing file = no domains). */
export function createTermuxCloudflared(
  configPath = join(process.env.HOME || homedir(), ".cloudflared", "config.yml"),
): CloudflaredAdapter {
  return {
    configPath,
    async listIngress() {
      let text: string;
      try {
        text = await readFile(configPath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new SystemError(`read ${configPath}: ${(e as Error).message}`, { cause: e });
      }
      return parseIngress(text);
    },
    probe: (hostname) => probeHttps(hostname),
    async validate(path) {
      const r = await runTermux("cloudflared", ["tunnel", "--config", path, "ingress", "validate"], {
        timeoutMs: VALIDATE_TIMEOUT_MS,
      });
      return { ok: r.code === 0, message: (r.stdout + r.stderr).trim().slice(0, VALIDATE_MSG_MAX) };
    },
  };
}
