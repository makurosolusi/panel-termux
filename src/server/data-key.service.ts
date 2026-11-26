import { count, countDistinct, eq, gt, inArray } from "drizzle-orm";
import type { DataKeyState, SecurityStatus } from "../shared/security.types";
import { recordAudit } from "./audit.service";
import type { Db } from "./db/client";
import { appMeta, session, setting } from "./db/schema";
import { accessSeen } from "./http/api.handler";
import { log } from "./log.service";
import { getSetting, type SettingKey, type SettingsDeps, unreadableSecretSettings } from "./settings.service";

// Data key state by try-decrypt (PLAN/04 K8, C1): no stored check value, so the answer is always current.

const EXPORTED_AT_KEY = "secret_exported_at";

/** Whether the current data key decrypts every stored secret setting, and which ones it cannot. */
export function dataKeyState(deps: SettingsDeps): { state: DataKeyState; unreadable: SettingKey[] } {
  const unreadable = unreadableSecretSettings(deps);
  return { state: unreadable.length ? "mismatch" : "ok", unreadable };
}

/**
 * Boot check after migrations. Mismatch mode only reports: it deletes nothing and never replaces `data/secret`
 * (the owner restores the old file or resets). Logs + audits `secret.mismatch`.
 */
export function checkDataKeyOnBoot(deps: SettingsDeps, created: boolean): DataKeyState {
  const { state, unreadable } = dataKeyState(deps);
  if (created) log.warn("[secret] no data key file found; a new one was created");
  if (state === "mismatch") {
    log.error(
      `[secret] data key does not match: ${unreadable.length} secret setting(s) unreadable (${unreadable.join(", ")}). ` +
        "Restore the old data/secret file, or reset them in Administrasi → Kesehatan sistem.",
    );
    recordAudit(deps.db, {
      actorId: null,
      action: "secret.mismatch",
      meta: { createdThisBoot: created, unreadable: unreadable.length },
    });
  }
  return state;
}

/** Deletes the secret settings the current key cannot read (reset path B) and audits `secret.reset {keys}`. */
export function resetUnreadableSettings(deps: SettingsDeps, actorId: string): SettingKey[] {
  const keys = unreadableSecretSettings(deps);
  if (keys.length === 0) return keys;
  deps.db.transaction((tx) => {
    tx.delete(setting).where(inArray(setting.key, keys)).run();
    recordAudit(deps.db, { actorId, action: "secret.reset", meta: { keys } });
  });
  log.warn(`[secret] ${keys.length} unreadable secret setting(s) deleted by ${actorId}: ${keys.join(", ")}`);
  return keys;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** File name of the data key download, e.g. `panel-termux-kunci-data-2026-11-26.txt`. */
export const dataKeyFileName = (now: Date): string => `panel-termux-kunci-data-${localDate(now)}.txt`;

/** Text of the data key download (PLAN/04 §3.6): what it is, where to keep it, how to put it back. */
export function exportDataKeyText(secret: string, appBaseUrl: string, now: Date): string {
  const made = `${localDate(now)} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return [
    "Panel Termux — kunci data (data/secret)",
    `Panel: ${appBaseUrl} · dibuat ${made}`,
    "Simpan di pengelola kata sandi, di luar HP ini dan di luar bucket cadangan. Siapa pun yang memegang",
    "file ini bersama panel.db bisa membaca pengaturan rahasia dan memalsukan sesi.",
    'Pakai di HP baru (lihat README "Pulihkan ke HP baru" langkah 10):',
    `  printf '%s' '${secret}' > ~/panel/data/secret && chmod 600 ~/panel/data/secret`,
    "",
    secret,
    "",
  ].join("\n");
}

/** Records that the data key was downloaded: `app_meta.secret_exported_at` + audit `secret.export`. */
export function markDataKeyExported(db: Db, actorId: string, now: Date = new Date()): void {
  const at = now.toISOString();
  db.transaction((tx) => {
    tx.insert(appMeta)
      .values({ key: EXPORTED_AT_KEY, value: at })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: at } })
      .run();
    recordAudit(db, { actorId, action: "secret.export" });
  });
  log.info(`[secret] data key downloaded by ${actorId}`);
}

/** What getSecurityStatus needs besides the DB: the public URL and whether boot created the key. */
export type SecurityContext = { appBaseUrl: string; createdThisBoot: boolean; now?: Date };

/** SecurityStatus for /dev/security, onboarding (PLAN/05) and the monitor's security problems (PLAN/02). */
export function getSecurityStatus(
  deps: SettingsDeps,
  { appBaseUrl, createdThisBoot, now }: SecurityContext,
): SecurityStatus {
  const { db } = deps;
  const { state, unreadable } = dataKeyState(deps);
  const exportedAt = db.select().from(appMeta).where(eq(appMeta.key, EXPORTED_AT_KEY)).get()?.value ?? null;
  const live = db
    .select({ active: count(), users: countDistinct(session.userId) })
    .from(session)
    .where(gt(session.expiresAt, now ?? new Date()))
    .get();
  return {
    dataKey: { state, createdThisBoot, exportedAt, unreadableSettings: unreadable },
    access: { https: appBaseUrl.startsWith("https://"), lastSeenAt: accessSeen.at?.toISOString() ?? null },
    sessions: { active: live?.active ?? 0, users: live?.users ?? 0 },
    backupsIncludeSecrets: getSetting(deps, "backup.include_secrets") === "on",
  };
}
