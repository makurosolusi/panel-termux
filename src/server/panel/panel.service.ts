import {
  type App,
  CONTROL_ACTIONS,
  type ControlAction,
  type Domain,
  type LogStream,
  type PanelOverview,
  type Service,
} from "../../shared/panel.types";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import { getSetting } from "../settings.service";
import type { RunitService, SystemAdapters } from "../system/system.types";
import { createActionLocks } from "./action.lock";
import { createHealthCache } from "./domain.health";

/** What the panel service needs: DB + data secret (settings, audit) and the system adapters. */
export type PanelDeps = { db: Db; secret: string; system: SystemAdapters };

/** Allowed service/app name; checked before a name reaches any argv or path. */
export const RESOURCE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Validates a service/app name from the URL (400 `invalid_name`). */
export function assertName(name: string): string {
  if (!RESOURCE_NAME_RE.test(name)) throw new ApiError(400, "invalid_name", `invalid name ${JSON.stringify(name)}`);
  return name;
}

/** Validates a control action from the URL (400 `invalid_action`). */
export function assertAction(action: string): ControlAction {
  if (!CONTROL_ACTIONS.includes(action as ControlAction)) {
    throw new ApiError(400, "invalid_action", `action must be one of ${CONTROL_ACTIONS.join(", ")}`);
  }
  return action as ControlAction;
}

/** Monitoring + control operations behind /api/panel. */
export function createPanelService({ db, secret, system }: PanelDeps) {
  const withLock = createActionLocks();
  const checkHealth = createHealthCache((h) => system.cloudflared.probe(h));

  const protectedSet = () =>
    new Set(
      (getSetting({ db, secret }, "panel.protected_services") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  const withProtected = (s: RunitService, prot = protectedSet()): Service => ({ ...s, protected: prot.has(s.name) });

  const services = async (): Promise<Service[]> => {
    const prot = protectedSet();
    return (await system.runit.list()).map((s) => withProtected(s, prot));
  };

  async function domains(appList?: App[]): Promise<Domain[]> {
    const [rules, apps] = await Promise.all([system.cloudflared.listIngress(), appList ?? system.pm2.list()]);
    const health = await checkHealth(rules.map((r) => r.hostname));
    return rules.map((r) => ({
      ...r,
      app: r.port === null ? null : (apps.find((a) => a.port === r.port)?.name ?? null),
      health: health.get(r.hostname) ?? { status: null, ms: null, checkedAt: null },
    }));
  }

  /** Overview sections degrade to [] (logged) so one broken subsystem doesn't blank the dashboard. */
  const orEmpty = <T>(label: string, p: Promise<T[]>): Promise<T[]> =>
    p.catch((e: unknown) => {
      log.warn(`[panel] overview ${label} unavailable: ${(e as Error).message}`);
      return [];
    });

  return {
    services,
    apps: () => system.pm2.list(),
    domains: () => domains(),
    databases: () => system.postgres.listDatabases(),

    async overview(): Promise<PanelOverview> {
      const apps = await orEmpty("apps", system.pm2.list());
      const [device, svc, dom] = await Promise.all([
        system.device.read(),
        orEmpty("services", services()),
        orEmpty("domains", domains(apps)),
      ]);
      return { mode: system.mode, device, services: svc, apps, domains: dom };
    },

    async controlService(actorId: string, name: string, action: ControlAction): Promise<Service> {
      if (action === "stop" && protectedSet().has(name)) {
        throw new ApiError(409, "protected", `service ${name} is protected and cannot be stopped`);
      }
      const s = await withLock(`service:${name}`, () => system.runit.control(name, action));
      if (!s) throw new ApiError(404, "not_found", `unknown service ${name}`);
      recordAudit(db, { actorId, action: `service.${action}`, target: name });
      log.info(`[panel] service ${name} ${action} by ${actorId} → ${s.state}`);
      return withProtected(s);
    },

    async controlApp(actorId: string, name: string, action: ControlAction): Promise<App> {
      const a = await withLock(`app:${name}`, () => system.pm2.control(name, action));
      if (!a) throw new ApiError(404, "not_found", `unknown app ${name}`);
      recordAudit(db, { actorId, action: `app.${action}`, target: name });
      log.info(`[panel] app ${name} ${action} by ${actorId} → ${a.status}`);
      return a;
    },

    async serviceLog(name: string, lines: number): Promise<string[]> {
      const l = await system.runit.readLog(name, lines);
      if (!l) throw new ApiError(404, "not_found", `unknown service ${name}`);
      return l;
    },

    async appLog(name: string, stream: LogStream, lines: number): Promise<string[]> {
      const l = await system.pm2.readLog(name, stream, lines);
      if (!l) throw new ApiError(404, "not_found", `unknown app ${name}`);
      return l;
    },
  };
}

/** The panel service instance type. */
export type PanelService = ReturnType<typeof createPanelService>;
