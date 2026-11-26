import type { MetricRange } from "../../shared/monitor.types";
import { CONTROL_ACTIONS, type ControlAction, type ControlBody, type LogStream } from "../../shared/panel.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { log } from "../log.service";
import { historyPage, metricSeries } from "../monitor/monitor.history";
import { createPanelService, type PanelDeps } from "../panel/panel.service";
import { Pm2UnavailableError, SystemError } from "../system/system.types";
import { ApiError, parsePaging } from "./http.error";

const DEFAULT_LOG_LINES = 500;
const MAX_LOG_LINES = 2000;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Allowed service/app name; checked before a name reaches any argv or path. */
const RESOURCE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Validates a service/app name from the URL (400 `invalid_name`). */
function assertName(name: string): string {
  if (!RESOURCE_NAME_RE.test(name)) throw new ApiError(400, "invalid_name", `invalid name ${JSON.stringify(name)}`);
  return name;
}

/** Validates a control action from the URL (400 `invalid_action`). */
function assertAction(action: string): ControlAction {
  if (!CONTROL_ACTIONS.includes(action as ControlAction)) {
    throw new ApiError(400, "invalid_action", `action must be one of ${CONTROL_ACTIONS.join(", ")}`);
  }
  return action as ControlAction;
}

function logLines(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LOG_LINES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "invalid_lines", "lines must be an integer >= 1");
  return Math.min(n, MAX_LOG_LINES);
}

function logStream(raw: string | undefined): LogStream {
  if (raw === undefined || raw === "" || raw === "out") return "out";
  if (raw === "err") return "err";
  throw new ApiError(400, "invalid_stream", 'stream must be "out" or "err"');
}

function metricRange(raw: string | undefined): MetricRange {
  if (raw === undefined || raw === "" || raw === "24h") return "24h";
  if (raw === "7d") return "7d";
  throw new ApiError(400, "invalid_range", 'range must be "24h" or "7d"');
}

function hostname(raw: string): string {
  if (!HOSTNAME_RE.test(raw)) throw new ApiError(400, "invalid_hostname", `invalid hostname ${JSON.stringify(raw)}`);
  return raw;
}

const download = ({ filename, text }: { filename: string; text: string }) =>
  new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });

type ErrorCtx = { error: unknown; code: unknown; status: (code: number, body: unknown) => unknown };

/** onError of the /panel and /dev groups: ApiError → status + body (incl. `extra`), pm2 down → 503, SystemError → 502. */
export function panelOnError({ error, code, status }: ErrorCtx) {
  if (error instanceof ApiError) return status(error.status, error.body);
  if (error instanceof Pm2UnavailableError)
    return status(HTTP_UNAVAILABLE, { error: "pm2_unavailable", message: error.message, reason: error.reason });
  if (error instanceof SystemError) {
    log.error(`[panel] system command failed: ${error.message}`);
    return status(HTTP_BAD_GATEWAY, { error: "system_error", message: error.message });
  }
  if (code === "PARSE") return status(400, { error: "invalid_body", message: "request body must be JSON" });
  if (code === "NOT_FOUND") return;
  log.error(`[panel] request failed: ${error instanceof Error ? error.message : String(code)}`);
}

/** admin monitoring + control API under /panel (overview, status, metrics, services, apps, domains, databases). */
export function createPanelRoutes(auth: Auth, deps: PanelDeps) {
  const panel = createPanelService(deps);
  return roleGuard(auth, "/panel", "admin")
    .onError(panelOnError as never)
    .get("/ping", () => ({ ok: true }))
    .get("/overview", () => panel.overview())
    .get("/status", () => panel.status())
    .get("/metrics", ({ query }) => metricSeries(deps.db, metricRange(query.range), Date.now()))
    .get("/problems/history", ({ query }) => historyPage(deps.db, parsePaging(query)))
    .get("/alerts/status", () => deps.monitor.alertStatus())
    .get("/services", () => panel.services())
    .post("/services/:name/:action", async ({ params, user, body, status }) => {
      const r = await panel.controlService(
        user.id,
        assertName(params.name),
        assertAction(params.action),
        (body ?? undefined) as ControlBody | undefined,
      );
      return "deferred" in r ? status(HTTP_ACCEPTED, r) : r;
    })
    .get("/services/:name/log", ({ params, query }) =>
      panel.serviceLog(assertName(params.name), logLines(query.lines), query.after),
    )
    .get("/services/:name/log/download", async ({ params, user }) =>
      download(await panel.logFile(user.id, assertName(params.name))),
    )
    .get("/apps", () => panel.apps())
    .post("/apps/:name/:action", ({ params, user }) =>
      panel.controlApp(user.id, assertName(params.name), assertAction(params.action)),
    )
    .get("/apps/:name/log", ({ params, query }) =>
      panel.appLog(assertName(params.name), logStream(query.stream), logLines(query.lines), query.after),
    )
    .get("/apps/:name/log/download", async ({ params, query, user }) =>
      download(await panel.logFile(user.id, assertName(params.name), logStream(query.stream))),
    )
    .get("/domains", () => panel.domains())
    .post("/domains/:hostname/check", ({ params }) => panel.probeDomain(hostname(params.hostname)))
    .get("/databases", () => panel.databases());
}
