// Secrets of a site for log redaction (B22): the values of its .env, matched by pm2 app name.
import { join } from "node:path";
import { eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { site } from "../db/schema";
import { envValues } from "./env.file";
import { readTextOrNull } from "./site.files";

/** Keys whose values are not secret and would only blank out ordinary log text. */
const NOT_SECRET = ["PORT"];

/** Values of the .env of the site run by pm2 app `app` (site.app, or site.name when no app); [] when none. */
export function siteSecretsFor(db: Db, app: string): string[] {
  const s = db
    .select({ dir: site.dir, app: site.app, name: site.name })
    .from(site)
    .where(or(eq(site.app, app), eq(site.name, app)))
    .all()
    .find((r) => (r.app ?? r.name) === app);
  if (!s) return [];
  return envValues(readTextOrNull(join(s.dir, ".env")) ?? "", NOT_SECRET).filter((v) => v !== "");
}
