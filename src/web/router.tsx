import { lazy, Suspense } from "react";
import { createBrowserRouter, type PatchRoutesOnNavigationFunction, useRouteLoaderData } from "react-router";
import { isProtectedPath } from "@/shared/roles";
import { LandingPage } from "@/web/landing/landing.page";
import { PublicNotFoundPage } from "@/web/pages/public-not-found.page";
import { syncStoredLocale } from "@/web/session/locale.sync";
import { fetchMe, type MeResult } from "@/web/session/session.api";
import { SessionError } from "@/web/session/session.error";
import { SessionFallback } from "@/web/session/session.fallback";
import { SessionGate } from "@/web/session/session.gate";
import { notFoundKind } from "@/web/session/session.redirect";
import { ROOT_ROUTE_ID } from "@/web/session/use-me";

// Chunks (PLAN/01 §3.11): entry = this file + session + landing; `login` and `app` load on demand.
const ShellNotFound = lazy(() => import("@/web/app.routes").then((m) => ({ default: m.ShellNotFound })));

/** Root splat: public 404 for guests, the in-shell 404 for signed-in users (loads the app chunk). */
function NotFoundRoute() {
  const result = useRouteLoaderData(ROOT_ROUTE_ID) as MeResult;
  if (notFoundKind(result) === "public") return <PublicNotFoundPage />;
  return (
    <Suspense fallback={<SessionFallback />}>
      <ShellNotFound />
    </Suspense>
  );
}

let appPatched = false;

/**
 * Adds the signed-in route tree (`app` chunk) under the root the first time a navigation enters a signed-in area.
 * Route `lazy` cannot supply children, hence route discovery. A failed import reaches SessionError (reload once).
 */
const patchAppRoutes: PatchRoutesOnNavigationFunction = async ({ path, patch, signal }) => {
  if (appPatched || !isProtectedPath(path)) return;
  const { appRoutes } = await import("@/web/app.routes");
  if (appPatched || signal.aborted) return;
  patch(ROOT_ROUTE_ID, appRoutes);
  appPatched = true;
};

/**
 * SPA route tree. The root loader fetches `/api/me` once per page load (it does not re-run on plain path
 * changes); SessionGate re-applies the redirect rules on every navigation.
 */
export const router = createBrowserRouter(
  [
    {
      id: ROOT_ROUTE_ID,
      path: "/",
      loader: async () => {
        const r = await fetchMe();
        if (r.status === "ok") syncStoredLocale(r.me); // cache the account language for the next boot (PLAN/08 §3.1)
        return r;
      },
      Component: SessionGate,
      HydrateFallback: SessionFallback,
      ErrorBoundary: SessionError,
      children: [
        { index: true, Component: LandingPage }, // public, never redirected by SessionGate
        { path: "login", lazy: async () => ({ Component: (await import("@/web/pages/login.page")).LoginPage }) },
        { path: "*", Component: NotFoundRoute },
      ],
    },
  ],
  { patchRoutesOnNavigation: patchAppRoutes },
);
