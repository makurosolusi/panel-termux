import { Elysia } from "elysia";
import type { DnsProvider } from "./dns.types";

/** /cloudflare/* endpoints for /dev (mount under the super_admin guard). */
export function createCloudflareDevRoutes({ dns }: { dns: DnsProvider }) {
  return new Elysia().post("/cloudflare/verify", () => dns.verify());
}
