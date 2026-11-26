import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { termuxPrefix } from "../exec/termux.exec";
import { log } from "../log.service";
import { createTermuxCloudflared } from "./cloudflared.termux";
import { createTermuxDevice } from "./device.termux";
import { createTermuxNet } from "./net.termux";
import { createTermuxPm2 } from "./pm2.termux";
import { createTermuxPostgres } from "./postgres.termux";
import { createTermuxRunit } from "./runit.termux";
import { createFakeSystem } from "./system.fake";
import type { SystemAdapters } from "./system.types";

/** Real Termux adapters (no mode detection). */
export const createTermuxSystem = (): SystemAdapters => ({
  mode: "termux",
  home: process.env.HOME || homedir(),
  net: createTermuxNet(),
  runit: createTermuxRunit(),
  pm2: createTermuxPm2(),
  cloudflared: createTermuxCloudflared(),
  postgres: createTermuxPostgres(),
  device: createTermuxDevice(),
});

/** Termux adapters when `$PREFIX/bin/sv` exists, else the in-memory fake; logs the chosen mode. */
export function selectSystem(): SystemAdapters {
  const sv = `${termuxPrefix()}/bin/sv`;
  const system = existsSync(sv) ? createTermuxSystem() : createFakeSystem();
  log.info(`[panel] system adapters: ${system.mode}${system.mode === "fake" ? ` (${sv} not found)` : ""}`);
  return system;
}
