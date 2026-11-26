import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { termuxPrefix } from "../exec/termux.exec";
import { log } from "../log.service";
import { createTarArchive } from "./archive.tar";
import { createTermuxCloudflared } from "./cloudflared.termux";
import { createTermuxDevice } from "./device.termux";
import { createTermuxNet } from "./net.termux";
import { createTermuxPm2 } from "./pm2.termux";
import { createTermuxPostgres } from "./postgres.termux";
import { createTermuxRunit } from "./runit.termux";
import { createFakeSystem } from "./system.fake";
import type { SystemAdapters } from "./system.types";

/** Real Termux adapters (no mode detection). pm2 is asked only while runit `pm2` is `run` (B14). */
export function createTermuxSystem(): SystemAdapters {
  const runit = createTermuxRunit();
  const isSupervisorUp = async () => {
    const s = await runit.supervise("pm2");
    return s === null ? null : s.state === "run";
  };
  return {
    mode: "termux",
    home: process.env.HOME || homedir(),
    net: createTermuxNet(),
    runit,
    pm2: createTermuxPm2({ isSupervisorUp }),
    cloudflared: createTermuxCloudflared(),
    postgres: createTermuxPostgres(),
    device: createTermuxDevice(),
    archive: createTarArchive(),
  };
}

/**
 * Termux adapters when `$PREFIX/bin/sv` exists, else the fake with offline S3/Telegram/DNS (D-W9-4) and sandbox HOME
 * `fakeHome` (boot: `<data dir>/fake-home`, kept across restarts; default a fresh temp dir). Logs the chosen mode.
 */
export function selectSystem(opts: { fakeHome?: string } = {}): SystemAdapters {
  const sv = `${termuxPrefix()}/bin/sv`;
  const system = existsSync(sv) ? createTermuxSystem() : createFakeSystem({ home: opts.fakeHome, offline: true });
  log.info(`[panel] system adapters: ${system.mode}${system.mode === "fake" ? ` (${sv} not found)` : ""}`);
  return system;
}
