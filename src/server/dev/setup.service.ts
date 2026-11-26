import { count, eq } from "drizzle-orm";
import type { DevSetup } from "../../shared/dev.types";
import { readBackupConfig } from "../backup/backup.config";
import { site, user } from "../db/schema";
import type { SettingsDeps } from "../settings.service";
import { describeSetting } from "../settings.service";
import type { SiteService } from "../sites/site.service";

/** First-run checklist for super_admin (GET /api/dev/setup), derived from current settings and files. */
export function setupChecklist(deps: SettingsDeps, sites: Pick<SiteService, "integration">): DevSetup {
  const { db } = deps;
  const n = (q: { n: number } | undefined) => q?.n ?? 0;
  return {
    items: [
      {
        key: "cloudflare_token",
        done: describeSetting(db, "cloudflare.api_token").isSet,
        hint: "Set the Cloudflare API token in /dev settings so new hostnames get DNS records.",
      },
      {
        key: "backup",
        done: readBackupConfig(deps).s3 !== null,
        hint: "Fill in the S3 backup settings in /dev settings.",
      },
      {
        key: "apps_json",
        done: sites.integration().ecosystemIncludesAppsJson,
        hint: "Spread ...require('./apps.json') into the apps of ~/sites/ecosystem.config.js.",
      },
      {
        key: "adopt_sites",
        done: n(db.select({ n: count() }).from(site).get()) > 0,
        hint: "Create a site or adopt an existing ingress entry under /panel/sites.",
      },
      {
        key: "admins",
        done: n(db.select({ n: count() }).from(user).where(eq(user.role, "admin")).get()) > 0,
        hint: "Optional: give a teammate the admin role under /dev/users.",
      },
    ],
  };
}
