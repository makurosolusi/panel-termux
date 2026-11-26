import type {
  App,
  ControlAction,
  DatabaseInfo,
  DeviceInfo,
  LogStream,
  PanelMode,
  Service,
} from "../../shared/panel.types";

/** Service as the supervisor sees it; the panel adds `protected`. */
export type RunitService = Omit<Service, "protected">;

/** One cloudflared ingress rule with a hostname (the catch-all rule is dropped). */
export type IngressRule = { hostname: string; service: string; port: number | null };

/** Result of one HTTPS GET to a hostname; status null = network error/timeout. */
export type ProbeResult = { status: number | null; ms: number | null };

/** Thrown by adapters when a system command fails; message names the operation, never secrets. */
export class SystemError extends Error {}

/** runit services under $PREFIX/var/service. `control`/`readLog` return null for an unknown service. */
export interface RunitAdapter {
  list(): Promise<RunitService[]>;
  control(name: string, action: ControlAction): Promise<RunitService | null>;
  readLog(name: string, lines: number): Promise<string[] | null>;
}

/** pm2 apps. `control`/`readLog` return null for an unknown app. */
export interface Pm2Adapter {
  list(): Promise<App[]>;
  control(name: string, action: ControlAction): Promise<App | null>;
  readLog(name: string, stream: LogStream, lines: number): Promise<string[] | null>;
  /** `pm2 delete <name>`; false when pm2 has no such process. */
  remove(name: string): Promise<boolean>;
}

/** cloudflared ingress config and reachability of its hostnames. */
export interface CloudflaredAdapter {
  /** Path of the live config.yml (read by listIngress, edited by site jobs). */
  readonly configPath: string;
  listIngress(): Promise<IngressRule[]>;
  probe(hostname: string): Promise<ProbeResult>;
  /** `cloudflared tunnel --config <path> ingress validate` on a candidate config file. */
  validate(path: string): Promise<{ ok: boolean; message: string }>;
}

/** Local PostgreSQL databases. Names passed to create/drop must match SQL_IDENT_RE. */
export interface PostgresAdapter {
  listDatabases(): Promise<DatabaseInfo[]>;
  /** Creates LOGIN role `name` with `password` and database `name` owned by it. */
  createRoleAndDatabase(name: string, password: string): Promise<void>;
  /** Drops database and role `name` (IF EXISTS, terminating connections). */
  dropRoleAndDatabase(name: string): Promise<void>;
}

/** Site role/database identifier: lowercase, starts with a letter (no quoting surprises in psql). */
export const SQL_IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Local TCP probing (/proc/net/tcp is EACCES on Android, so we try to connect). */
export interface NetAdapter {
  /** Whether something accepts TCP connections on 127.0.0.1:`port`. */
  isListening(port: number): Promise<boolean>;
}

/** Device metrics (battery, memory, disk, load, uptime). */
export interface DeviceAdapter {
  read(): Promise<DeviceInfo>;
}

/** All adapters of one mode. */
export type SystemAdapters = {
  mode: PanelMode;
  /** HOME the site files live under (`~` in sites.dir, ~/.cloudflared); a temp sandbox in fake mode. */
  home: string;
  net: NetAdapter;
  runit: RunitAdapter;
  pm2: Pm2Adapter;
  cloudflared: CloudflaredAdapter;
  postgres: PostgresAdapter;
  device: DeviceAdapter;
};
