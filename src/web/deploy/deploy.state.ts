import type { Deploy, DeployStatus } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import type { Tone } from "@/web/panel/panel.status";

const DEPLOY_TONE: Record<DeployStatus, Tone> = { running: "warn", succeeded: "ok", failed: "bad", rolled_back: "bad" };

/** Badge tone of a deploy entry (rolled back = the deploy failed and was undone). */
export const deployTone = (status: DeployStatus): Tone => DEPLOY_TONE[status];

/**
 * Whether a previous binary may exist to roll back to: two succeeded entries on the shown page, or entries
 * beyond it (unknown → let the server answer 409 `no_previous`).
 */
export function canRollback(page: Page<Deploy>): boolean {
  if (page.page > 1 || page.total > page.items.length) return true;
  return page.items.filter((d) => d.status === "succeeded").length >= 2;
}

/** First 12 hex chars of a checksum, enough to tell binaries apart. */
export const shortSha = (sha256: string): string => sha256.slice(0, 12);
