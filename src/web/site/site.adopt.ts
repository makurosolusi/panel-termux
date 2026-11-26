import type { DiscoveredIngress, Integration, SiteAdoptRequest } from "@/shared/site.types";
import { parsePort } from "./site.check";

/** Adopt dialog form; all text so inputs stay controlled. */
export type AdoptForm = { name: string; hostname: string; port: string; app: string };

/** Dialog values prefilled from a discovered ingress; the name is left for the user to type. */
export const adoptPrefill = (d: DiscoveredIngress): AdoptForm => ({
  name: "",
  hostname: d.hostname,
  port: d.port === null ? "" : String(d.port),
  app: d.app ?? "",
});

/** Body of POST /sites/adopt, or null while name is empty or the port is missing/invalid (port is required). */
export function adoptBody(f: AdoptForm): SiteAdoptRequest | null {
  const name = f.name.trim();
  const port = parsePort(f.port);
  if (name === "" || typeof port !== "number" || f.hostname.trim() === "") return null;
  const app = f.app.trim();
  return { name, hostname: f.hostname.trim().toLowerCase(), port, ...(app ? { app } : {}) };
}

/** Known fixes the integration banner explains, derived from the integration flags. */
export type IntegrationHint = "appsJson" | "appsJsonMissing" | "tunnel" | "token";

/** Hints for the banner, in fix order; empty when the server reports no issues. */
export function integrationHints(i: Integration): IntegrationHint[] {
  if (i.issues.length === 0) return [];
  const hints: IntegrationHint[] = [];
  if (!i.ecosystemIncludesAppsJson) hints.push("appsJson");
  if (!i.appsJsonExists) hints.push("appsJsonMissing");
  if (i.tunnelId === null) hints.push("tunnel");
  if (!i.cloudflareTokenSet) hints.push("token");
  return hints;
}
