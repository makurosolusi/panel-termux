import { useRouteLoaderData } from "react-router";
import type { Me, MeResult } from "./session.api";

/** Route id of the root route whose loader fetches `/api/me`. */
export const ROOT_ROUTE_ID = "root";

/** Signed-in account for protected pages; SessionGate guarantees it exists before they render. */
export function useMe(): Me {
  const result = useRouteLoaderData(ROOT_ROUTE_ID) as MeResult | undefined;
  if (result?.status !== "ok") throw new Error("useMe: rendered outside an authenticated route");
  return result.me;
}
