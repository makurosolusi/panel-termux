// Response types of the admin monitoring/control API under /api/panel. Errors are `{ error, message }`.

/** Which system adapter backs the panel: real Termux tools, or in-memory demo data (dev/tests). */
export type PanelMode = "termux" | "fake";

/** Control action accepted by POST /services/:name/:action and /apps/:name/:action. */
export type ControlAction = "start" | "stop" | "restart";

/** All control actions. */
export const CONTROL_ACTIONS: readonly ControlAction[] = ["start", "stop", "restart"];

/** runit service state as reported by `sv status`. */
export type ServiceState = "run" | "down" | "finish" | "unknown";

/** Item of GET /services. `wantUp` = the supervisor's target state; `protected` = refuses stop. */
export type Service = {
  name: string;
  state: ServiceState;
  pid: number | null;
  uptimeSec: number | null;
  wantUp: boolean;
  protected: boolean;
};

/** pm2 process status. */
export type AppStatus = "online" | "stopped" | "errored" | "launching" | "unknown";

/** Item of GET /apps. `port` comes from the app's env PORT when set. */
export type App = {
  name: string;
  status: AppStatus;
  pid: number | null;
  memoryMb: number | null;
  cpu: number | null;
  restarts: number;
  uptimeSec: number | null;
  port: number | null;
};

/** Last HTTPS check of a hostname (cached 60 s); all null until the first check finished. */
export type DomainHealth = { status: number | null; ms: number | null; checkedAt: string | null };

/** Item of GET /domains: one cloudflared ingress rule. `app` = pm2 app whose port matches. */
export type Domain = {
  hostname: string;
  service: string;
  port: number | null;
  app: string | null;
  health: DomainHealth;
};

/** Item of GET /databases (templates and the `postgres` DB excluded). */
export type DatabaseInfo = { name: string; owner: string; sizeBytes: number };

/** Battery reading; null in DeviceInfo when termux-battery-status is unavailable or hangs. */
export type Battery = { percent: number; charging: boolean; temperatureC: number };

/** Device metrics in GET /overview. `load` = 1/5/15-minute load average. */
export type DeviceInfo = {
  battery: Battery | null;
  memory: { totalMb: number; availableMb: number };
  disk: { freeBytes: number; totalBytes: number };
  load: [number, number, number];
  uptimeSec: number;
};

/** GET /overview */
export type PanelOverview = {
  mode: PanelMode;
  device: DeviceInfo;
  services: Service[];
  apps: App[];
  domains: Domain[];
};

/** Log stream of a pm2 app. */
export type LogStream = "out" | "err";

/** GET /services/:name/log and /apps/:name/log (`lines` default 200, max 2000), oldest line first. */
export type LogLines = { lines: string[] };
