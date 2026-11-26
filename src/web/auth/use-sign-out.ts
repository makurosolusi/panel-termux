import { useState } from "react";
import { id } from "@/web/i18n/id";
import { signOut } from "./auth.client";

/** Sign-out handler with pending flag and an Indonesian error message on failure. */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    const ok = await signOut().catch((cause: unknown) => {
      console.error("signOut: request failed", cause);
      return false;
    });
    if (!ok) {
      setError(id.menu.signOutFailed);
      setPending(false);
    }
  };
  return { signOut: run, pending, error };
}
