// Per-section snapshot cache (PLAN/02 K10): stale-while-revalidate with single-flight refreshes, so a UI request
// answers from the last value (≤ 120 s) while a slow `pm2 jlist` runs in the background.
import type { BackupStatus } from "../../shared/backup.types";
import type { App, DeviceInfo, Service } from "../../shared/panel.types";
import type { SecurityStatus } from "../../shared/security.types";
import { log } from "../log.service";
import { KeyMismatchError } from "../settings.service";
import { type IngressRule, type Pm2Proc, Pm2UnavailableError } from "../system/system.types";
import type { MonitorSnapshot, SnapshotSection } from "./monitor.contract";

/** Section name of MonitorSnapshot. */
export type SectionName = keyof MonitorSnapshot;

/** Readers of each section; each may throw (the section then turns `ok: false`, keeping its last value). */
export type SnapshotSources = {
  device: () => Promise<DeviceInfo>;
  services: () => Promise<Service[]>;
  apps: () => Promise<Pm2Proc[]>;
  ingress: () => Promise<IngressRule[]>;
  backup: () => BackupStatus | Promise<BackupStatus>;
  security: () => SecurityStatus | Promise<SecurityStatus>;
};

/**
 * Freshness per section. pm2 is the expensive one (jlist 0.5-0.7 s). The 120 s battery cache lives in the
 * termux device adapter (BATTERY_CACHE_MS), so the device section itself can stay at 5 s.
 */
export const SECTION_TTL_MS: Record<SectionName, number> = {
  device: 5_000,
  services: 5_000,
  apps: 15_000,
  ingress: 5_000,
  backup: 5_000,
  security: 5_000,
};
/** A value up to this old is answered at once while it refreshes; older (or none yet) waits for the refresh. */
export const MAX_STALE_MS = 120_000;

const NAMES = Object.keys(SECTION_TTL_MS) as SectionName[];

/**
 * Error text of a failed section. pm2 carries its reason (`service_down` / `no_daemon`, read by the pm2_unavailable
 * rule) and the data-key failure its class name (`KeyMismatchError`, read by the key_mismatch rule).
 */
export function sectionError(e: unknown): string {
  if (e instanceof Pm2UnavailableError) return `Pm2UnavailableError: ${e.reason}`;
  if (e instanceof KeyMismatchError) return `KeyMismatchError: ${e.message}`;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

type Entry = {
  section: SnapshotSection<unknown>;
  /** The error object behind a failed section (pm2Procs rethrows it). */
  cause: unknown;
  /** End of the last refresh attempt (ok or failed); the TTL counts from here. */
  triedAt: number | null;
  /** Bumped by patch: forces a refresh on the next read, also past one already in flight. */
  gen: number;
  doneGen: number;
  inflight: Promise<void> | null;
};

/** Snapshot cache over `sources`; `now` is injectable for tests. */
export function createSnapshotCache(sources: SnapshotSources, now: () => number = Date.now) {
  const entries = new Map<SectionName, Entry>(
    NAMES.map((n) => [
      n,
      {
        section: { ok: false, error: "not read yet", at: null, stale: null },
        cause: null,
        triedAt: null,
        gen: 0,
        doneGen: 0,
        inflight: null,
      },
    ]),
  );
  const entry = (n: SectionName) => entries.get(n) as Entry;

  function refresh(n: SectionName): Promise<void> {
    const e = entry(n);
    if (e.inflight) return e.inflight;
    const gen = e.gen;
    e.inflight = (async () => {
      try {
        const value = await sources[n]();
        e.section = { ok: true, value, at: now() };
        e.cause = null;
      } catch (err) {
        const prev = e.section;
        e.section = { ok: false, error: sectionError(err), at: prev.at, stale: prev.ok ? prev.value : prev.stale };
        e.cause = err;
        log.warn(`[monitor] section ${n} unavailable: ${e.section.error}`);
      } finally {
        e.triedAt = now();
        e.doneGen = gen;
        e.inflight = null;
      }
    })();
    return e.inflight;
  }

  /** Answers fresh-enough values at once, kicks background refreshes for old ones, waits only when too old. */
  async function read(n: SectionName): Promise<void> {
    const e = entry(n);
    const fresh = e.triedAt !== null && now() - e.triedAt <= SECTION_TTL_MS[n] && e.doneGen === e.gen;
    if (fresh) return;
    const age = e.section.at === null ? Number.POSITIVE_INFINITY : now() - e.section.at;
    const pending = refresh(n);
    if (age > MAX_STALE_MS) await pending;
  }

  const current = (): MonitorSnapshot => Object.fromEntries(NAMES.map((n) => [n, entry(n).section])) as MonitorSnapshot;

  return {
    /** SWR read of every section. */
    async get(): Promise<MonitorSnapshot> {
      await Promise.all(NAMES.map(read));
      return current();
    },

    /** Last values without any I/O. */
    current,

    /** Sampler: refreshes every section (services first: the pm2 adapter checks the runit `pm2` service). */
    async refreshAll(): Promise<MonitorSnapshot> {
      await refresh("services");
      await Promise.all(NAMES.filter((n) => n !== "services").map(refresh));
      return current();
    },

    /** pm2 processes (≤ 15 s old); throws the adapter's error (e.g. Pm2UnavailableError) when none can be shown. */
    async pm2Procs(): Promise<Pm2Proc[]> {
      await read("apps");
      const e = entry("apps");
      if (e.section.ok) return e.section.value as Pm2Proc[];
      if (e.section.stale) return e.section.stale as Pm2Proc[];
      throw e.cause instanceof Error ? e.cause : new Error(e.section.error);
    },

    /** After a control action: puts the returned item into the cached list now and refreshes on the next read. */
    patch(section: "services" | "apps", item: Service | App): void {
      const e = entry(section);
      e.gen++;
      if (!e.section.ok) return;
      const list = e.section.value as (Service | App)[];
      e.section = { ...e.section, value: list.map((x) => (x.name === item.name ? { ...x, ...item } : x)) };
    },
  };
}

/** The snapshot cache of one monitor. */
export type SnapshotCache = ReturnType<typeof createSnapshotCache>;
