// site.delete job (PLAN/03 §3.4), split out of site.jobs.ts (file health).
import { existsSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { site } from "../db/schema";
import { appName } from "../deploy/deploy.steps";
import { log } from "../log.service";
import { Pm2UnavailableError } from "../system/system.types";
import { removeIngressRule } from "./ingress.editor";
import { type JobSpec, type StepDef, StepError } from "./job.runner";
import type { HostRow, JobCtx, SiteRow } from "./site.jobs";
import {
  appsRemoveStep,
  dnsDeleteStep,
  ingressStep,
  reapplyTunnel,
  tunnelRestartStep,
  tunnelState,
} from "./site.steps";

/** Irreversible step that only acts on managed sites (adopted: `<prefix>_adopted_skip`). */
const managedOnly = (key: StepDef["key"], s: SiteRow, prefix: string, run: StepDef["run"]): StepDef => ({
  key,
  irreversible: true,
  run: async (c) => (s.managed ? run(c) : { code: `${prefix}_adopted_skip`, skipped: true }),
});

/** Keep flags of a site delete. */
export type DeleteKeep = { data: boolean; database: boolean };

/**
 * site.delete: validate → apps_remove (first, D5) → ingress → tunnel_restart → dns (non-fatal) → app_remove! →
 * database_drop! → folder_remove!. Adopted sites: only panel-added ingress rules / DNS records, then the DB row.
 */
export function deleteSiteJob(ctx: JobCtx, actorId: string, s: SiteRow, hosts: HostRow[], keep: DeleteKeep): JobSpec {
  const tunnel = tunnelState();
  const ingressHosts = hosts.filter((h) => s.managed || h.ingressManaged).map((h) => h.hostname);
  const steps: StepDef[] = [
    {
      key: "validate",
      async run() {
        if (!ctx.db.select().from(site).where(eq(site.name, s.name)).get())
          throw new StepError("invalid_site", { issues: "gone" });
        return { code: "validated" };
      },
    },
    appsRemoveStep(ctx, s.name, s.managed),
    ingressStep(ctx, tunnel, ingressHosts, true, (t) => ingressHosts.reduce(removeIngressRule, t)),
    tunnelRestartStep(ctx, tunnel),
    dnsDeleteStep(
      ctx.dns,
      hosts.filter((h) => h.dnsManaged).map((h) => h.hostname),
      actorId,
    ),
    managedOnly("app_remove", s, "app", async () => {
      try {
        const removed = await ctx.system.pm2.remove(appName(s));
        return removed
          ? { code: "app_removed", params: { name: appName(s) } }
          : { code: "app_not_deployed", skipped: true };
      } catch (e) {
        if (e instanceof Pm2UnavailableError) throw new StepError("pm2_not_running", { reason: e.reason });
        throw new StepError("pm2_failed", {}, (e as Error).message);
      }
    }),
    managedOnly("database_drop", s, "database", async () => {
      if (!s.database) return { code: "database_none", skipped: true };
      if (keep.database) return { code: "database_kept", skipped: true };
      if (ctx.backupBusy?.()) throw new StepError("busy_backup", { name: s.database });
      try {
        await ctx.system.postgres.dropRoleAndDatabase(s.database);
      } catch (e) {
        throw new StepError("database_failed", { name: s.database }, (e as Error).message);
      }
      return { code: "database_dropped", params: { name: s.database } };
    }),
    managedOnly("folder_remove", s, "folder", async () => {
      if (keep.data) return { code: "folder_kept", skipped: true };
      if (!existsSync(s.dir)) return { code: "folder_gone", skipped: true };
      try {
        rmSync(s.dir, { recursive: true, force: true });
      } catch (e) {
        throw new StepError("folder_failed", { path: s.dir }, (e as Error).message);
      }
      return { code: "folder_removed", params: { path: s.dir } };
    }),
  ];
  return {
    kind: "site.delete",
    target: s.name,
    actorId,
    steps,
    input: { name: s.name, keepData: keep.data, keepDatabase: keep.database },
    onSuccess() {
      ctx.db.delete(site).where(eq(site.name, s.name)).run();
      try {
        ctx.onSiteDeleted?.(s.name);
      } catch (e) {
        // The site is gone already; a failed cleanup hook must not turn the delete into a rollback.
        log.error(`[sites] after-delete cleanup of ${s.name} failed: ${(e as Error).message}`);
      }
    },
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}
