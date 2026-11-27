import { msg } from "@/shared/i18n";

/** UI strings of the session loader screens (entry chunk: shown before any page loads). */
export const tSession = msg("session", {
  loading: "Loading session…",
  errorTitle: "Can't connect to Panel Termux",
  retry: "Try again",
  errorBody: "Check your internet connection and make sure the server phone is on, then try again.",
  serverTitle: "Panel Termux is having problems",
  serverBody:
    "The server returned an error. Try again in a moment; if it keeps happening, check the panel log on the phone.",
} as const);
