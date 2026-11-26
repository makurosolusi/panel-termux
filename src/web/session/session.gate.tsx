import { useEffect } from "react";
import { Navigate, Outlet, useLoaderData, useLocation } from "react-router";
import type { MeResult } from "./session.api";
import { SessionFallback } from "./session.fallback";
import { needsFullLoad, resolveRedirect } from "./session.redirect";

/**
 * Root route element: redirects per session/role on every navigation, otherwise renders the matched child.
 * /login → home is a full page load (see `needsFullLoad`); every other redirect stays client-side.
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
  return to ? <Navigate to={to} replace /> : <Outlet />;
}
