import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ROLES } from "../../shared/roles";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { log } from "../log.service";
import { syncUserRole } from "./access.service";

/** What createAuth needs; `secret` is the instance data secret from secret.ts. */
export type AuthDeps = {
  db: Db;
  env: Pick<Env, "APP_BASE_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SUPER_ADMIN_EMAILS">;
  secret: string;
};

/** Builds the Better Auth instance (Google only, open sign-in, role synced on every session). */
export function createAuth({ db, env, secret }: AuthDeps) {
  const superAdmins = env.SUPER_ADMIN_EMAILS;
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    basePath: "/api/auth",
    secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: {
      // Redirect URI registered in Google Cloud: `${APP_BASE_URL}/api/auth/callback/google`.
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    },
    user: {
      additionalFields: {
        // input:false → clients cannot set it on sign-up/update; only the server changes roles.
        role: { type: [...ROLES], required: false, defaultValue: "user", input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session creation: sync role with SUPER_ADMIN_EMAILS before the session is issued.
          before: async (session) => {
            syncUserRole(db, session.userId, superAdmins);
          },
          after: async (session) => {
            recordAudit(db, { actorId: session.userId, action: "auth.sign_in" });
            log.info(`[auth] user ${session.userId} signed in`);
          },
        },
      },
    },
    // cloudflared sets CF-Connecting-IP to the visitor (and the panel only listens on loopback), so session
    // IPs and Better Auth's own rate limit see the real client instead of 127.0.0.1.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] } },
    // OAuth callback errors land on the SPA login page as /login?error=<code>.
    onAPIError: { errorURL: `${env.APP_BASE_URL}/login` },
  });
}

/** The panel's Better Auth instance type. */
export type Auth = ReturnType<typeof createAuth>;
