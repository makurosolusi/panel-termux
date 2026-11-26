import { DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { DeployService } from "../deploy/deploy.service";
import { ApiError, parsePaging } from "./http.error";
import { panelOnError } from "./panel.routes";

/** Reads a raw chunk body, refusing oversized ones before buffering them. */
async function chunkBody(request: Request): Promise<ArrayBuffer> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > DEPLOY_CHUNK_SIZE) throw new ApiError(400, "invalid_chunk_size", `chunk larger than ${DEPLOY_CHUNK_SIZE}`);
  return request.arrayBuffer();
}

/** admin deploy API under /panel: chunked binary upload, rollback, deploy history. */
export function createDeployRoutes(auth: Auth, deploys: DeployService) {
  return roleGuard(auth, "/panel", "admin")
    .onError(panelOnError as never)
    .post("/sites/:name/uploads", ({ params, body, status }) => status(201, deploys.startUpload(params.name, body)))
    .put(
      "/uploads/:uploadId/chunks/:index",
      async ({ params, request }) => deploys.putChunk(params.uploadId, params.index, await chunkBody(request)),
      { parse: "none" },
    )
    .post("/uploads/:uploadId/complete", ({ params, user, status }) =>
      status(202, deploys.complete(user.id, params.uploadId)),
    )
    .delete("/uploads/:uploadId", ({ params, status }) => {
      deploys.abort(params.uploadId);
      return status(204);
    })
    .post("/sites/:name/rollback", async ({ params, user, status }) =>
      status(202, await deploys.rollback(user.id, params.name)),
    )
    .get("/sites/:name/deploys", ({ params, query }) => deploys.list(params.name, parsePaging(query)));
}
