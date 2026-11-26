import { count, eq } from "drizzle-orm";
import type { DevSetup, SetupItem, SetupItemKey, SetupLevel } from "../../shared/dev.types";
import { recordAudit } from "../audit.service";
import type { BackupService } from "../backup/backup.service";
import { getSecurityStatus } from "../data-key.service";
import type { Db } from "../db/client";
import { appMeta, backupRun, site, user } from "../db/schema";
import { describeSetting } from "../settings.service";
import type { IntegrationService } from "../sites/integration.service";

// Onboarding state in app_meta (PLAN/05 §3.2, K6/K7): row present = done/dismissed, row deleted = not yet.
const DISMISSED_KEY = "onboarding.dismissed_at";
const doneKey = (k: ManualKey) => `onboarding.${k}.done_at`;
const SECRET_CHECK_KEY = "onboarding.secret_saved.check";

/** Items the owner may tick by hand (PUT /api/dev/setup/items/:key). */
export const MANUAL_KEYS = ["access", "secret_saved"] as const;
/** A tickable onboarding item. */
export type ManualKey = (typeof MANUAL_KEYS)[number];
/** Type guard for the `:key` route param. */
export const isManualKey = (k: string): k is ManualKey => (MANUAL_KEYS as readonly string[]).includes(k);

/** What the checklist reads. `integration` is the sites integration (apps.json spread check). */
export type SetupDeps = {
  db: Db;
  secret: string;
  appBaseUrl: string;
  createdThisBoot: boolean;
  backup: Pick<BackupService, "status">;
  integration: Pick<IntegrationService, "snapshot">;
};

/**
 * Fingerprint of the data key stored with a manual "kunci data disimpan" tick: after a key reset the fingerprint
 * differs and the tick no longer counts (K7). A short SHA-256 prefix, never the key itself.
 */
export const secretCheck = (secret: string): string =>
  new Bun.CryptoHasher("sha256").update(secret).digest("hex").slice(0, 16);

const meta = (db: Db, key: string) => db.select().from(appMeta).where(eq(appMeta.key, key)).get()?.value ?? null;

function putMeta(db: Db, key: string, value: string | null): void {
  if (value === null) db.delete(appMeta).where(eq(appMeta.key, key)).run();
  else db.insert(appMeta).values({ key, value }).onConflictDoUpdate({ target: appMeta.key, set: { value } }).run();
}

const LEVEL: Record<Exclude<SetupItemKey, "adopt_sites">, SetupLevel> = {
  access: "required",
  secret_saved: "required",
  backup: "required",
  cloudflare_token: "recommended",
  apps_json: "recommended",
  first_site: "recommended",
  admins: "optional",
};

/** GET /api/dev/setup: the 7 onboarding items in table order (§3.1), dismiss state and `complete`. */
export function getSetup(deps: SetupDeps): DevSetup {
  const { db } = deps;
  const sec = getSecurityStatus(deps, { appBaseUrl: deps.appBaseUrl, createdThisBoot: deps.createdThisBoot });
  const n = (q: { n: number } | undefined) => q?.n ?? 0;
  const item = (key: keyof typeof LEVEL, auto: boolean, manual = false, extra: Partial<SetupItem> = {}): SetupItem => ({
    key,
    level: LEVEL[key],
    done: auto || manual,
    source: !auto && manual ? "manual" : "auto",
    needsFirstRun: false,
    applicable: true,
    ...extra,
  });
  const configured = deps.backup.status().configured;
  const hasGoodRun = n(db.select({ n: count() }).from(backupRun).where(eq(backupRun.status, "succeeded")).get()) > 0;
  const secretTicked =
    meta(db, doneKey("secret_saved")) !== null && meta(db, SECRET_CHECK_KEY) === secretCheck(deps.secret);
  const items = [
    item("access", sec.access.lastSeenAt !== null, meta(db, doneKey("access")) !== null, {
      applicable: sec.access.https,
    }),
    item("secret_saved", sec.dataKey.exportedAt !== null, secretTicked),
    item("backup", configured && hasGoodRun, false, { needsFirstRun: configured && !hasGoodRun }),
    item("cloudflare_token", describeSetting(db, "cloudflare.api_token").isSet),
    item("apps_json", deps.integration.snapshot().ecosystemIncludesAppsJson),
    item("first_site", n(db.select({ n: count() }).from(site).get()) > 0),
    item("admins", n(db.select({ n: count() }).from(user).where(eq(user.role, "admin")).get()) > 0),
  ];
  return {
    items,
    dismissedAt: meta(db, DISMISSED_KEY),
    complete: items.every((i) => i.level === "optional" || !i.applicable || i.done),
  };
}

/** Manual tick of `access`/`secret_saved` (the latter remembers the key fingerprint); audited `setup.update`. */
export function setManual(deps: SetupDeps, actorId: string, key: ManualKey, done: boolean): DevSetup {
  const at = done ? new Date().toISOString() : null;
  deps.db.transaction(() => {
    putMeta(deps.db, doneKey(key), at);
    if (key === "secret_saved") putMeta(deps.db, SECRET_CHECK_KEY, done ? secretCheck(deps.secret) : null);
    recordAudit(deps.db, { actorId, action: "setup.update", target: key, meta: { key, done } });
  });
  return getSetup(deps);
}

/** Hides (or shows again) the onboarding card; not audited (PLAN/05 §3.3). */
export function setDismissed(deps: SetupDeps, dismissed: boolean): DevSetup {
  putMeta(deps.db, DISMISSED_KEY, dismissed ? new Date().toISOString() : null);
  return getSetup(deps);
}
