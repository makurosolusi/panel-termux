import { statfsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { availableParallelism, homedir, loadavg, uptime } from "node:os";
import type { Battery } from "../../shared/panel.types";
import { runTermux } from "../exec/termux.exec";
import { log } from "../log.service";
import { type DeviceAdapter, SystemError } from "./system.types";

/** termux-battery-status can hang when Termux:API is missing; cap it. */
const BATTERY_TIMEOUT_MS = 5_000;
/** The call takes ~0.7 s on the phone; overview polling must not pay that each time. */
const BATTERY_CACHE_MS = 30_000;
const KB_PER_MB = 1024;

/** Parses termux-battery-status JSON; null when the shape is unexpected. */
export function parseBattery(stdout: string): Battery | null {
  let j: { percentage?: unknown; status?: unknown; temperature?: unknown };
  try {
    j = JSON.parse(stdout);
  } catch (e) {
    log.warn(`[panel] termux-battery-status: invalid JSON (${(e as Error).name})`);
    return null;
  }
  if (typeof j?.percentage !== "number") return null;
  return {
    percent: j.percentage,
    charging: j.status === "CHARGING" || j.status === "FULL",
    temperatureC: typeof j.temperature === "number" ? Math.round(j.temperature * 10) / 10 : 0,
  };
}

/** Parses /proc/meminfo into MB (MemTotal, MemAvailable). */
export function parseMeminfo(text: string): { totalMb: number; availableMb: number } {
  const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"))?.[1] ?? Number.NaN);
  const total = kb("MemTotal");
  const avail = kb("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(avail)) throw new SystemError("/proc/meminfo: missing fields");
  return { totalMb: Math.round(total / KB_PER_MB), availableMb: Math.round(avail / KB_PER_MB) };
}

async function readBattery(): Promise<Battery | null> {
  try {
    const r = await runTermux("termux-battery-status", [], { timeoutMs: BATTERY_TIMEOUT_MS });
    if (r.code !== 0) {
      log.warn(`[panel] termux-battery-status exited ${r.code}`);
      return null;
    }
    return parseBattery(r.stdout);
  } catch (e) {
    log.warn(`[panel] battery unavailable: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Real device adapter. /proc/uptime and /proc/stat are EACCES on Android, so uptime/load come from
 * os.uptime()/os.loadavg(); memory from /proc/meminfo; disk from statfs($HOME).
 */
export function createTermuxDevice(diskPath = process.env.HOME || homedir()): DeviceAdapter {
  let battery: { at: number; value: Promise<Battery | null> } | null = null;
  return {
    async read() {
      if (!battery || Date.now() - battery.at > BATTERY_CACHE_MS) battery = { at: Date.now(), value: readBattery() };
      let memText: string;
      try {
        memText = await readFile("/proc/meminfo", "utf8");
      } catch (e) {
        throw new SystemError(`read /proc/meminfo: ${(e as Error).message}`, { cause: e });
      }
      const fs = statfsSync(diskPath);
      const [l1 = 0, l5 = 0, l15 = 0] = loadavg();
      return {
        battery: await battery.value,
        cpuCores: availableParallelism(),
        memory: parseMeminfo(memText),
        disk: { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize },
        load: [l1, l5, l15].map((n) => Math.round(n * 100) / 100) as [number, number, number],
        uptimeSec: Math.floor(uptime()),
      };
    },
  };
}
