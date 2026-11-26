import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const DB_FILE = "panel.db";

/** Drizzle database bound to the panel schema. */
export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

/** Opens (creating if needed) `<dataDir>/panel.db` in WAL mode. Caller must have created dataDir. */
export function openDb(dataDir: string): Db {
  const file = join(dataDir, DB_FILE);
  try {
    const sqlite = new Database(file, { create: true, strict: true });
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    sqlite.run("PRAGMA busy_timeout = 5000");
    return drizzle({ client: sqlite, schema });
  } catch (e) {
    throw new Error(`openDb ${file} failed: ${(e as Error).message}`, { cause: e });
  }
}
