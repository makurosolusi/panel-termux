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
}

/** cloudflared ingress config and reachability of its hostnames. */
export interface CloudflaredAdapter {
  listIngress(): Promise<IngressRule[]>;
  probe(hostname: string): Promise<ProbeResult>;
}

/** Local PostgreSQL databases. */
export interface PostgresAdapter {
  listDatabases(): Promise<DatabaseInfo[]>;
}

/** Device metrics (battery, memory, disk, load, uptime). */
export interface DeviceAdapter {
  read(): Promise<DeviceInfo>;
}

/** All adapters of one mode. */
export type SystemAdapters = {
  mode: PanelMode;
  runit: RunitAdapter;
  pm2: Pm2Adapter;
  cloudflared: CloudflaredAdapter;
  postgres: PostgresAdapter;
  device: DeviceAdapter;
};
