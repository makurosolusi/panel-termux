import { msg } from "@/shared/i18n";

/** UI strings shared by every section (imported directly, DECISIONS B30). Wording follows docs/content-guide.md. */
export const tCommon = msg("common", {
  retry: "Try again",
  cancel: "Cancel",
  close: "Close",
  /** "Updated 3 min ago" — replaces static "updates every N seconds" lines; relative pieces live in `tShell.time`. */
  updatedAgo: (rel: string) => `Updated ${rel}`,
  /** Short heading per ApiErrorKind (ErrorState title, first sentence of toasts); no final period. */
  errorTitles: {
    network: "Can't reach the server",
    unauthorized: "Your session has expired",
    access: "Cloudflare Access sign-in needed",
    forbidden: "You don't have access",
    client: "The request didn't go through",
    server: "The server is having problems",
  },
  /** Next step, shown under `errorTitles` (the title already says what happened) and after it in toasts. */
  errorSteps: {
    network: "Check your internet connection, then try again.",
    unauthorized: "Taking you to the sign-in page…",
    access:
      "Open the panel address in the address bar to sign in. If you're still blocked, ask an admin to add your email to the Access policy.",
    forbidden: "Ask a Super Admin to change your role if you need this page.",
    server: "Try again in a moment.",
  },
  /** Fallback when the request failed for a reason without its own text; per-kind toasts are `title. step`. */
  genericError: "The request didn't go through. Try again; if it keeps failing, reload the page.",
} as const);
