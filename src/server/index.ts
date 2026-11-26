import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };
import spa from "../web/index.html";
import { openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEnvOrExit } from "./env";
import { loadOrCreateSecret } from "./secret";

/** Loopback only: the panel is reached through the Cloudflare tunnel, never exposed on the LAN. */
const LISTEN_HOST = "127.0.0.1";

/** API app; tests call `app.handle(new Request(...))` without starting a server. */
export const app = new Elysia({ prefix: "/api" }).get("/health", () => ({ ok: true, version: pkg.version }));

/** Boots the panel: env → data dir + secret → DB migrations → HTTP server (API + embedded SPA). */
export function start() {
  const env = loadEnvOrExit();
  loadOrCreateSecret(env.PANEL_DATA_DIR); // later used as BETTER_AUTH_SECRET
  const db = openDb(env.PANEL_DATA_DIR);
  const schemaVersion = runMigrations(db);

  const server = Bun.serve({
    hostname: LISTEN_HOST,
    port: env.PORT,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/api/*": (req) => app.handle(req),
      "/*": spa,
    },
  });
  console.info(`[panel] v${pkg.version} schema=${schemaVersion} listening on ${server.url}`);
  return server;
}

if (import.meta.main) start();
