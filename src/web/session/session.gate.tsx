import { Navigate, Outlet, useLoaderData, useLocation } from "react-router";
import type { MeResult } from "./session.api";
import { resolveRedirect } from "./session.redirect";

/** Root route element: redirects per session/role on every navigation, otherwise renders the matched child. */
export function SessionGate() {
  const result = useLoaderData() as MeResult;
  const { pathname } = useLocation();
  const to = resolveRedirect(result, pathname);
  return to ? <Navigate to={to} replace /> : <Outlet />;
}
