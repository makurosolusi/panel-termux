/** Entrypoint: re-exports the boot + SPA-serving API (tests import from here) and boots when run directly. */
import { start } from "./boot";

export { app, start } from "./boot";
export { canonicalRedirect, servePanel } from "./http/spa.serve";

if (import.meta.main) start();
