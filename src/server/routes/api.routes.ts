import { Elysia } from "elysia";
import { homeFor } from "../../shared/roles";
import type { Auth } from "../auth/auth.service";
import { getSessionUser, roleGuard } from "../auth/role.guard";
import { createDevRoutes, type DevDeps } from "./dev.routes";

/** Auth-aware API under /api: Better Auth endpoints, /me, and role-guarded /panel and /dev areas. */
export const createApiRoutes = (auth: Auth, dev: DevDeps) =>
  new Elysia({ prefix: "/api" })
    // Better Auth owns /api/auth/* (sign-in/social, callback/google, get-session, sign-out, ...).
    .all("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .get("/me", async ({ request, status }) => {
      const user = await getSessionUser(auth, request.headers);
      if (!user) return status(401, { error: "unauthorized" });
      return { ...user, home: homeFor(user.role) };
    })
    .use(roleGuard(auth, "/panel", "admin").get("/ping", () => ({ ok: true })))
    .use(createDevRoutes(auth, dev));
