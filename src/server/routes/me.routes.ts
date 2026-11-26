import { Elysia } from "elysia";
import type { Me } from "../../shared/me.types";
import { homeFor, isRole } from "../../shared/roles";
import type { Auth } from "../auth/auth.service";
import { getSessionChecked, requestUserIds } from "../auth/role.guard";
import { createSessionsService } from "../auth/sessions.service";
import type { Db } from "../db/client";
import { deleteOwnAccount } from "../dev/users.service";
import { panelOnError } from "./panel.routes";

/** Signed-in user's own API: GET/DELETE /me and the session list/revoke endpoints under /me/sessions. */
export function createMeRoutes(auth: Auth, db: Db) {
  const sessions = createSessionsService(auth, db);
  return new Elysia({ prefix: "/me" })
    .onError(panelOnError as never)
    .get("", async ({ request, status }) => {
      const s = await getSessionChecked(auth, request.headers);
      if (!s) return status(401, { error: "unauthorized", message: "sign in required" });
      const { id, email, name, image, role, createdAt } = s.user;
      requestUserIds.set(request.headers, id);
      const r = isRole(role) ? role : "user";
      return {
        id,
        email,
        name,
        image: image ?? null,
        role: r,
        home: homeFor(r),
        createdAt: createdAt.toISOString(),
      } satisfies Me;
    })
    .delete("", async ({ request, body, status }) => {
      const s = await getSessionChecked(auth, request.headers);
      if (!s) return status(401, { error: "unauthorized", message: "sign in required" });
      requestUserIds.set(request.headers, s.user.id);
      const role = isRole(s.user.role) ? s.user.role : "user";
      const confirm = typeof body === "object" && body !== null ? (body as { confirm?: unknown }).confirm : undefined;
      deleteOwnAccount(db, { id: s.user.id, email: s.user.email, role }, confirm);
      return status(204);
    })
    .get("/sessions", ({ request }) => sessions.list(request.headers))
    .delete("/sessions/:id", async ({ request, params, status }) => {
      await sessions.revoke(request.headers, params.id);
      return status(204);
    })
    .post("/sessions/revoke-others", ({ request }) => sessions.revokeOthers(request.headers));
}
