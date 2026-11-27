import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { LOCALES, type Locale, parseLocale } from "../../shared/locale";
import type { Me, MePatch } from "../../shared/me.types";
import { homeFor, isRole } from "../../shared/roles";
import type { Auth } from "../auth/auth.service";
import { getSessionChecked, requestUserIds } from "../auth/role.guard";
import { createSessionsService } from "../auth/sessions.service";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { deleteOwnAccount } from "../dev/users.service";
import { ApiError } from "./http.error";
import { panelOnError } from "./panel.routes";

/** Body of PATCH /me → the locale to store; exactly `en`, `id` or null, anything else is 400. */
function parseMePatch(body: unknown): MePatch {
  const locale = typeof body === "object" && body !== null ? (body as { locale?: unknown }).locale : undefined;
  if (locale === null || LOCALES.includes(locale as Locale)) return { locale: locale as Locale | null };
  throw new ApiError(
    400,
    "invalid_locale",
    `body must be { "locale": ${LOCALES.map((l) => `"${l}"`).join(" | ")} | null }`,
  );
}

/** Signed-in user's own API: GET/PATCH/DELETE /me and the session list/revoke endpoints under /me/sessions. */
export function createMeRoutes(auth: Auth, db: Db) {
  const sessions = createSessionsService(auth, db);
  return (
    new Elysia({ prefix: "/me" })
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
          locale: parseLocale(s.user.locale),
        } satisfies Me;
      })
      // Not audited: the UI language is a personal preference like the theme, not a security event.
      .patch("", async ({ request, body, status }) => {
        const s = await getSessionChecked(auth, request.headers);
        if (!s) return status(401, { error: "unauthorized", message: "sign in required" });
        requestUserIds.set(request.headers, s.user.id);
        const { locale } = parseMePatch(body);
        db.update(user).set({ locale }).where(eq(user.id, s.user.id)).run();
        return status(204);
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
      .post("/sessions/revoke-others", ({ request }) => sessions.revokeOthers(request.headers))
  );
}
