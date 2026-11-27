// Test-only lazy chunk: shares en.app with the probe mount chunk, so en.app lands in a shared chunk (debate 08 #1).
import { tApp } from "@/web/i18n/en.app";

/** Module-level alias evaluated when this chunk loads. */
export const SIGN_OUT = tApp.menu.signOut;
