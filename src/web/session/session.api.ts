import type { Role } from "@/shared/roles";

/** Signed-in account as returned by `GET /api/me`. */
export type Me = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  home: string;
};

/** Outcome of the session check; network/server failures are thrown, not returned. */
export type MeResult = { status: "ok"; me: Me } | { status: "unauthorized" };

/** Loads the current session. Throws on network errors and non-401 failures so the error boundary shows them. */
export async function fetchMe(): Promise<MeResult> {
  const res = await fetch("/api/me", { credentials: "same-origin", headers: { accept: "application/json" } });
  if (res.status === 401) return { status: "unauthorized" };
  if (!res.ok) throw new Error(`GET /api/me failed: HTTP ${res.status}`);
  return { status: "ok", me: (await res.json()) as Me };
}
