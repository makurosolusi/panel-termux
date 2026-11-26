import { CHUNK_SHA_HEADER, DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { DeployService } from "../deploy/deploy.service";
import { Pm2UnavailableError } from "../system/system.types";
import { ApiError, parsePaging } from "./http.error";
import { panelOnError } from "./panel.routes";

const HTTP_UNAVAILABLE = 503;

/** Reads a raw chunk body, refusing oversized ones before buffering them. */
async function chunkBody(request: Request): Promise<Uint8Array> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > DEPLOY_CHUNK_SIZE) throw new ApiError(400, "invalid_chunk_size", `chunk larger than ${DEPLOY_CHUNK_SIZE}`);
  return new Uint8Array(await request.arrayBuffer());
}

type ErrorCtx = Parameters<typeof panelOnError>[0];

/** panelOnError plus `extra` fields of ApiError, and pm2 down → 503 `pm2_unavailable`. */
function deployOnError(ctx: ErrorCtx) {
  const { error, status } = ctx;
  if (error instanceof ApiError) return status(error.status, error.body);
  if (error instanceof Pm2UnavailableError) {
    return status(HTTP_UNAVAILABLE, { error: "pm2_unavailable", message: error.message, reason: error.reason });
  }
  return panelOnError(ctx);
}

/** admin deploy API under /panel: resumable binary upload, rollback, deploy history. */
export function createDeployRoutes(auth: Auth, deploys: DeployService) {
  return (
    roleGuard(auth, "/panel", "admin")
      .onError(deployOnError as never)
      .post("/sites/:name/uploads", async ({ params, body, status }) =>
        status(201, await deploys.startUpload(params.name, body)),
      )
      // Response.json so "none" is a JSON `null` body, not an empty one.
      .get("/sites/:name/uploads/active", ({ params }) => Response.json(deploys.activeUpload(params.name)))
      .get("/uploads/:uploadId", ({ params }) => deploys.getUpload(params.uploadId))
      .put(
        "/uploads/:uploadId/chunks/:index",
        async ({ params, request }) =>
          deploys.putChunk(
            params.uploadId,
            params.index,
            await chunkBody(request),
            request.headers.get(CHUNK_SHA_HEADER),
          ),
        { parse: "none" },
      )
      .post("/uploads/:uploadId/complete", async ({ params, user, status }) =>
        status(202, await deploys.complete(user.id, params.uploadId)),
      )
      .delete("/uploads/:uploadId", ({ params, status }) => {
        deploys.abort(params.uploadId);
        return status(204);
      })
      .post("/sites/:name/rollback", async ({ params, user, status }) =>
        status(202, await deploys.rollback(user.id, params.name)),
      )
      .get("/sites/:name/deploys", ({ params, query }) => deploys.list(params.name, parsePaging(query)))
  );
}
