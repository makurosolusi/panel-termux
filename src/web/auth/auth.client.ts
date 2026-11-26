import { createAuthClient } from "better-auth/react";

/** better-auth browser client; the API lives on the same origin as the SPA. */
export const authClient = createAuthClient({ baseURL: window.location.origin });

/** Starts Google OAuth; on success better-auth sends the browser to `/`, on failure to `/login?error=…`. */
export const signInWithGoogle = () =>
  authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/login" });

/** Ends the session and reloads into /login so the root loader re-checks `/api/me`. Returns false on failure. */
export async function signOut(): Promise<boolean> {
  const { error } = await authClient.signOut();
  if (error) return false;
  window.location.assign("/login");
  return true;
}
