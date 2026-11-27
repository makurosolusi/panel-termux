import { useState } from "react";
import { tApp } from "@/web/i18n/en.app";

/** Sign-out handler with pending flag and an error message on failure. */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    // Lazy: keeps better-auth out of the shell's initial bundle; only the login page and sign-out need it.
    const ok = await import("./auth.client")
      .then((m) => m.signOut())
      .catch((cause: unknown) => {
        console.error("signOut: request failed", cause);
        return false;
      });
    if (!ok) {
      setError(tApp.menu.signOutFailed);
      setPending(false);
    }
  };
  return { signOut: run, pending, error };
}
