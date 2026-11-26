import { Elysia } from "elysia";
import type { CloudflareVerify } from "../../shared/dev.types";
import { recordAudit } from "../audit.service";
import { requestUserIds } from "../auth/role.guard";
import type { Db } from "../db/client";
import { SETTINGS } from "../settings.registry";
import type { CloudflareVerifier } from "./dns.provider";
import type { DnsProvider } from "./dns.types";

const HTTP_BAD_REQUEST = 400;
const TOKEN_KEY = "cloudflare.api_token";

/** Coded result for a provider without verifyToken (fakes): its plain verdict becomes ok / api_error. */
async function plainVerify(dns: DnsProvider): Promise<CloudflareVerify> {
  const r = await dns.verify();
  return { ok: r.ok, code: r.ok ? "ok" : "api_error", zones: null, detail: r.message };
}

/**
 * /cloudflare/* endpoints for /dev (mount under the super_admin guard). POST /cloudflare/verify takes an optional
 * JSON body `{ token }` to test a draft token before saving; without it the saved token is tested. Every test that
 * ran is audited as `cloudflare.verify` (meta `{ ok, code }`, never the token).
 */
export function createCloudflareDevRoutes({ dns, db }: { dns: DnsProvider & Partial<CloudflareVerifier>; db: Db }) {
  return new Elysia().post(
    "/cloudflare/verify",
    async ({ request, status }) => {
      const text = (await request.text()).trim();
      let token: string | undefined;
      if (text) {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return status(HTTP_BAD_REQUEST, { error: "invalid_body", message: "request body must be JSON", fields: {} });
        }
        const raw = (body as { token?: unknown } | null)?.token;
        if (raw !== undefined && raw !== null) {
          const problem = typeof raw === "string" ? SETTINGS[TOKEN_KEY].validate(raw.trim()) : "must be a string";
          if (problem)
            return status(HTTP_BAD_REQUEST, {
              error: "invalid_value",
              message: `${TOKEN_KEY}: ${problem}`,
              fields: { [TOKEN_KEY]: "invalid" },
            });
          token = (raw as string).trim();
        }
      }
      const out = await (dns.verifyToken ? dns.verifyToken(token) : plainVerify(dns));
      recordAudit(db, {
        actorId: requestUserIds.get(request.headers) ?? null,
        action: "cloudflare.verify",
        meta: { ok: out.ok, code: out.code },
      });
      return out;
    },
    { parse: "none" },
  );
}
