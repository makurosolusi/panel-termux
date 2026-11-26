import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { ROLES } from "../../shared/roles";
import { emailDomain, recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { log } from "../log.service";
import { isEmailAllowed, NOT_INVITED, syncUserRole } from "./access.service";

/** What createAuth needs; `secret` is the instance data secret from secret.ts. */
export type AuthDeps = {
  db: Db;
  env: Pick<Env, "APP_BASE_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SUPER_ADMIN_EMAILS">;
  secret: string;
};

const NOT_INVITED_MESSAGE = "This account is not invited to the panel";

/** Builds the Better Auth instance (Google only, invite-only, role synced on every session). */
export function createAuth({ db, env, secret }: AuthDeps) {
  const superAdmins = env.SUPER_ADMIN_EMAILS;
  // Domain only: a refused stranger's full address is PII we have no reason to keep.
  const denied = (email: string) => {
    recordAudit(db, { actorId: null, action: "auth.denied", target: emailDomain(email) || null });
    log.warn(`[auth] sign-in refused for domain ${emailDomain(email) || "(none)"}`);
  };
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
      // Runs before user creation and on every Google sign-in with the fresh provider email,
      // so strangers never get a user row. Rejections redirect to onAPIError.errorURL?error=not_invited.
      validateUserInfo: ({ user }) => {
        if (!user.email || !isEmailAllowed(db, user.email, superAdmins)) {
          denied(user.email ?? "");
          return { error: NOT_INVITED, errorDescription: NOT_INVITED_MESSAGE };
        }
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session creation: sync role with env/invites, refuse if access was revoked.
          before: async (session) => {
            if (!syncUserRole(db, session.userId, superAdmins).allowed) {
              const row = db
                .select({ email: schema.user.email })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId))
                .get();
              denied(row?.email ?? "");
              throw new APIError("FORBIDDEN", { code: NOT_INVITED, message: NOT_INVITED_MESSAGE });
            }
          },
          after: async (session) => {
            recordAudit(db, { actorId: session.userId, action: "auth.sign_in" });
            log.info(`[auth] user ${session.userId} signed in`);
          },
        },
      },
    },
    // OAuth callback errors land on the SPA login page as /login?error=<code>.
    onAPIError: { errorURL: `${env.APP_BASE_URL}/login` },
  });
}

/** The panel's Better Auth instance type. */
export type Auth = ReturnType<typeof createAuth>;
