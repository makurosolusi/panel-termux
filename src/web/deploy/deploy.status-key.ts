// Raw deploy row status → canonical StatusKey (DECISIONS B12): undone and cut-off rows are warnings (A10).
import type { DeployStatus } from "@/shared/deploy.types";
import type { StatusKey } from "@/web/components/status.vocab";

/** Badge key of a deploy history row. */
export const DEPLOY_STATUS_KEY = {
  running: "processing",
  succeeded: "succeeded",
  failed: "failed",
  rolled_back: "rolled_back",
  interrupted: "interrupted",
} as const satisfies Record<DeployStatus, StatusKey>;
