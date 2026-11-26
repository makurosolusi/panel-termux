import { Elysia } from "elysia";
import { homeFor } from "../../shared/roles";
import type { Auth } from "../auth/auth.service";
import { getSessionUser } from "../auth/role.guard";
import { selectSystem } from "../system/system.select";
import type { SystemAdapters } from "../system/system.types";
import { createDevRoutes, type DevDeps } from "./dev.routes";
import { createPanelRoutes } from "./panel.routes";

/**
 * Auth-aware API under /api: Better Auth endpoints, /me, and role-guarded /panel and /dev areas.
 * `system` defaults to auto-detected adapters (Termux when `$PREFIX/bin/sv` exists, else fake).
 */
export const createApiRoutes = (auth: Auth, dev: DevDeps, system: SystemAdapters = selectSystem()) =>
  new Elysia({ prefix: "/api" })
    // Better Auth owns /api/auth/* (sign-in/social, callback/google, get-session, sign-out, ...).
    .all("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .get("/me", async ({ request, status }) => {
      const user = await getSessionUser(auth, request.headers);
      if (!user) return status(401, { error: "unauthorized" });
      return { ...user, home: homeFor(user.role) };
    })
    .use(createPanelRoutes(auth, { db: dev.db, secret: dev.secret, system }))
    .use(createDevRoutes(auth, dev));
