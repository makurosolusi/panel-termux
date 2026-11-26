// listSettings / changedSettingKeys read the setting table once, not once per key (no N+1).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptSecret } from "@/server/crypto.service";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setting } from "@/server/db/schema";
import { changedSettingKeys, listSettings } from "@/server/settings.service";
import { SETTING_KEYS } from "@/shared/dev.types";

// test-only dummy values
const SECRET = "fedcba9876543210".repeat(4);
const dir = mkdtempSync(join(tmpdir(), "panel-settings-q-"));
const db = openDb(dir);
runMigrations(db);
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});
const at = new Date(1_000_000);
db.insert(setting).values({ key: "sites.dir", value: "/srv/sites", updatedAt: at }).run();
db.insert(setting)
  .values({ key: "cloudflare.api_token", value: encryptSecret("0".repeat(64), "tok"), updatedAt: at })
  .run();

function countQueries<T>(fn: () => T): { out: T; queries: number } {
  const prepare = db.$client.prepare.bind(db.$client);
  let queries = 0;
  db.$client.prepare = ((q: string) => {
    queries++;
    return prepare(q);
  }) as typeof db.$client.prepare;
  try {
    return { out: fn(), queries };
  } finally {
    db.$client.prepare = prepare;
  }
}

test("listSettings runs one query for every key and keeps the per-key view", () => {
  const { out, queries } = countQueries(() => listSettings({ db, secret: SECRET }));
  expect(queries).toBe(1);
  expect(out.map((s) => s.key)).toEqual([...SETTING_KEYS]);
  expect(out.find((s) => s.key === "sites.dir")).toMatchObject({ value: "/srv/sites", isSet: true, readable: true });
  // encrypted with another key → unreadable, value never exposed
  expect(out.find((s) => s.key === "cloudflare.api_token")).toMatchObject({
    value: null,
    isSet: true,
    readable: false,
  });
  expect(out.find((s) => s.key === "sites.port_range")?.isSet).toBe(false);
});

test("changedSettingKeys runs one query regardless of batch size", () => {
  const { out, queries } = countQueries(() =>
    changedSettingKeys(db, { "sites.dir": "/srv/sites", "sites.port_range": "4000-4100" }),
  );
  expect(queries).toBe(1);
  expect(out).toEqual(["sites.port_range"]);
});
