import type { LogStream } from "../../shared/panel.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { log } from "../log.service";
import { assertAction, assertName, createPanelService, type PanelDeps } from "../panel/panel.service";
import { SystemError } from "../system/system.types";
import { ApiError } from "./http.error";

const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 2000;
const HTTP_BAD_GATEWAY = 502;

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

type ErrorCtx = { error: unknown; code: unknown; status: (code: number, body: unknown) => unknown };

/** onError shared by the /panel route groups: ApiError → its status, SystemError → 502, else logged 500. */
export function panelOnError({ error, code, status }: ErrorCtx) {
  if (error instanceof ApiError) return status(error.status, { error: error.code, message: error.message });
  if (error instanceof SystemError) {
    log.error(`[panel] system command failed: ${error.message}`);
    return status(HTTP_BAD_GATEWAY, { error: "system_error", message: error.message });
  }
  if (code === "PARSE") return status(400, { error: "invalid_body", message: "request body must be JSON" });
  if (code === "NOT_FOUND") return;
  log.error(`[panel] request failed: ${error instanceof Error ? error.message : String(code)}`);
}

/** admin monitoring + control API under /panel (services, apps, domains, databases, overview). */
export function createPanelRoutes(auth: Auth, deps: PanelDeps) {
  const panel = createPanelService(deps);
  return roleGuard(auth, "/panel", "admin")
    .onError(panelOnError as never)
    .get("/ping", () => ({ ok: true }))
    .get("/overview", () => panel.overview())
    .get("/services", () => panel.services())
    .post("/services/:name/:action", ({ params, user }) =>
      panel.controlService(user.id, assertName(params.name), assertAction(params.action)),
    )
    .get("/services/:name/log", async ({ params, query }) => ({
      lines: await panel.serviceLog(assertName(params.name), logLines(query.lines)),
    }))
    .get("/apps", () => panel.apps())
    .post("/apps/:name/:action", ({ params, user }) =>
      panel.controlApp(user.id, assertName(params.name), assertAction(params.action)),
    )
    .get("/apps/:name/log", async ({ params, query }) => ({
      lines: await panel.appLog(assertName(params.name), logStream(query.stream), logLines(query.lines)),
    }))
    .get("/domains", () => panel.domains())
    .get("/databases", () => panel.databases());
}
