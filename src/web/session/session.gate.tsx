import { useEffect } from "react";
import { Navigate, Outlet, ScrollRestoration, useLoaderData, useLocation } from "react-router";
import type { MeResult } from "./session.api";
import { SessionFallback } from "./session.fallback";
import { needsFullLoad, resolveRedirect } from "./session.redirect";

/**
 * Root route element: redirects per session/role on every navigation, otherwise renders the matched child, plus
 * scroll restoration. /login → home is a full page load (see `needsFullLoad`); every other redirect stays
 * client-side. Toaster/TooltipProvider live in AppLayout (app chunk), keeping them out of the landing's entry JS.
 */
export function SessionGate() {
  const result = useLoaderData() as MeResult;
  const { pathname } = useLocation();
  const to = resolveRedirect(result, pathname);
  const fullLoad = to !== null && needsFullLoad(pathname, to);
  useEffect(() => {
    if (fullLoad && to) window.location.replace(to);
  }, [fullLoad, to]);
  if (fullLoad) return <SessionFallback />;
  if (to) return <Navigate to={to} replace />;
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
