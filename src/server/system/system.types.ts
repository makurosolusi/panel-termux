import type {
  App,
  ControlAction,
  DatabaseInfo,
  DeviceInfo,
  LogStream,
  PanelMode,
  Service,
  ServiceState,
} from "../../shared/panel.types";
import type { OfflineClients } from "./external.clients";

/** Service as the supervisor sees it; the panel adds `protected` and `lockout`. */
export type RunitService = Omit<Service, "protected" | "lockout">;

/**
 * One service's runsv state read from `supervise/stat` + `supervise/pid` (no `sv` spawn). `uptimeSec` (from
 * `supervise/status`) is present only while the service runs and the status file is readable.
 */
export type SuperviseState = { state: ServiceState; pid: number | null; uptimeSec?: number };

/** `start` options: `removeDown` deletes `<svdir>/<name>/down` first, so the service also starts after a reboot. */
export type RunitControlOptions = { removeDown?: boolean };

/** One cloudflared ingress rule with a hostname (the catch-all rule is dropped). */
export type IngressRule = { hostname: string; service: string; port: number | null };

/** Result of one HTTPS GET to a hostname; status null = network error/timeout. */
export type ProbeResult = { status: number | null; ms: number | null };

/** Thrown by adapters when a system command fails; message names the operation, never secrets. */
export class SystemError extends Error {}

/** Why pm2 cannot be asked: runit service `pm2` not `run`, or no live daemon socket. */
export type Pm2UnavailableReason = "service_down" | "no_daemon";

/** Thrown by the pm2 adapter instead of invoking the CLI (which would spawn a stray daemon, DECISIONS B14). */
export class Pm2UnavailableError extends SystemError {
  constructor(readonly reason: Pm2UnavailableReason) {
    super(`pm2 unavailable: ${reason}`);
  }
}

/** pm2 process with internal fields (log paths, cwd, script); never sent to clients as-is. */
export type Pm2Proc = App & {
  outLog: string | null;
  errLog: string | null;
  /** `pm_cwd` */
  cwd: string | null;
  /** `pm_exec_path` (the script or interpreter pm2 runs) */
  execPath: string | null;
  args: string[];
  /** `pm_uptime`: epoch ms of the last (re)start */
  startedAtMs: number | null;
  /** `pmx_module`, or the keep-alive guard app (PM2_GUARD_NAME) */
  module: boolean;
};
/** runit services under $PREFIX/var/service. `control`/`readLog` return null for an unknown service. */
export interface RunitAdapter {
  list(): Promise<RunitService[]>;
  /** runsv state of one service from its `supervise/` files; null when the service does not exist. */
  supervise(name: string): Promise<SuperviseState | null>;
  control(name: string, action: ControlAction, opts?: RunitControlOptions): Promise<RunitService | null>;
  readLog(name: string, lines: number): Promise<string[] | null>;
}

/**
 * pm2 apps. `control`/`readLog` return null for an unknown app. Every method throws Pm2UnavailableError when
 * pm2 is not running, without invoking the pm2 CLI.
 */
export interface Pm2Adapter {
  list(): Promise<App[]>;
  /** Same processes with internal fields (cwd, script, log paths) for server-side checks. */
  procs(): Promise<Pm2Proc[]>;
  control(name: string, action: ControlAction): Promise<App | null>;
  readLog(name: string, stream: LogStream, lines: number): Promise<string[] | null>;
  /** `pm2 delete <name>`; false when pm2 has no such process. */
  remove(name: string): Promise<boolean>;
  /** `pm2 start <ecosystem> --only <name>`: (re)loads the app from the ecosystem file; null if it is still absent. */
  startFromEcosystem(ecosystem: string, name: string): Promise<App | null>;
}

/** Thrown by `routeDns` when cloudflared created/found the CNAME under another name (cert.pem of another zone). */
export class DnsWrongZoneError extends SystemError {
  constructor(readonly fqdn: string) {
    super(`cloudflared routed ${fqdn} instead of the requested hostname`);
  }
}

/**
 * Thrown by `routeDns` without `overwrite` when the hostname already has a DNS record for another target (C19).
 * cloudflared does not say which target, so the old one is unknown here.
 */
export class DnsRecordExistsError extends SystemError {
  constructor(readonly hostname: string) {
    super(`cloudflared route dns ${hostname}: a DNS record for this hostname already exists`);
  }
}

/** `routeDns` outcome: `created` = new CNAME, false = it already pointed at this tunnel. */
export type RouteDnsResult = { created: boolean };

/** `routeDns` options: `overwrite` = `--overwrite-dns` (only `panel init` after a TTY yes, C19; site jobs never). */
export type RouteDnsOptions = { overwrite?: boolean };

/** cloudflared ingress config and reachability of its hostnames. */
export interface CloudflaredAdapter {
  /** Path of the live config.yml (read by listIngress, edited by site jobs). */
  readonly configPath: string;
  listIngress(): Promise<IngressRule[]>;
  probe(hostname: string): Promise<ProbeResult>;
  /** `cloudflared tunnel --config <path> ingress validate` on a candidate config file. */
  validate(path: string): Promise<{ ok: boolean; message: string }>;
  /**
   * `cloudflared tunnel route dns <tunnel> <hostname>` (uses ~/.cloudflared/cert.pem; `--overwrite-dns` only with
   * `overwrite`). Throws DnsWrongZoneError when the reported name differs from `hostname`, DnsRecordExistsError when
   * another record has the name (no overwrite), SystemError on any other failure.
   */
  routeDns(tunnel: string, hostname: string, opts?: RouteDnsOptions): Promise<RouteDnsResult>;
}

/** Local PostgreSQL databases. Names passed to create/drop must match SQL_IDENT_RE. */
export interface PostgresAdapter {
  listDatabases(): Promise<DatabaseInfo[]>;
  /** Creates LOGIN role `name` with `password` and database `name` owned by it. */
  createRoleAndDatabase(name: string, password: string): Promise<void>;
  /** Drops database and role `name` (IF EXISTS, terminating connections). */
  dropRoleAndDatabase(name: string): Promise<void>;
  /** `pg_dump -Fc` of database `name` into `file` (read-only for the database). */
  dump(name: string, file: string): Promise<void>;
  /** `pg_dumpall --globals-only -w -f file` (roles incl. password hashes, tablespaces). */
  dumpGlobals(file: string): Promise<void>;
  /** `pg_restore --list file`: throws when the dump is unreadable. */
  verifyDump(file: string): Promise<void>;
  /** `show server_version`, e.g. "18.7". */
  serverVersion(): Promise<string>;
  /** createdb -O owner target; pg_restore --no-owner --role=owner --exit-on-error -d target; count tables. */
  restoreInto(file: string, target: string, owner: string): Promise<{ tableCount: number }>;
  /** DROP DATABASE IF EXISTS … WITH (FORCE); the role is never touched. */
  dropDatabase(name: string): Promise<void>;
}

/** gzip tar archives of explicit entries (exclusions are done by choosing entries, never --exclude: PLAN/04 K20). */
export interface ArchiveAdapter {
  /** tar -czf file -C dir <entries…> (no --exclude). tar exit 1 = warning "file_changed". */
  create(file: string, dir: string, entries: string[]): Promise<{ warning: "file_changed" | null }>;
  /** tar -tzf: throws when the archive is unreadable. */
  list(file: string): Promise<void>;
}

/** Site role/database identifier: lowercase, starts with a letter (no quoting surprises in psql). */
export const SQL_IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Local TCP probing (/proc/net/tcp is EACCES on Android, so we try to connect). */
export interface NetAdapter {
  /** Whether something accepts TCP connections on 127.0.0.1:`port`. */
  isListening(port: number): Promise<boolean>;
  /** HTTP status of `GET http://127.0.0.1:<port><path>` (optional `Host` header); null on network error/timeout. */
  httpStatus(port: number, path?: string, timeoutMs?: number, host?: string): Promise<number | null>;
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
  /** Termux `$PREFIX` to read service files under; the fake's sandbox `<home>/usr`, absent = termuxPrefix(). */
  prefix?: string;
  net: NetAdapter;
  runit: RunitAdapter;
  pm2: Pm2Adapter;
  cloudflared: CloudflaredAdapter;
  postgres: PostgresAdapter;
  device: DeviceAdapter;
  archive: ArchiveAdapter;
  /** Offline S3/Telegram/DNS fakes; set only in the panel's own fake mode (D-W9-4), absent = real clients. */
  offline?: OfflineClients;
};
