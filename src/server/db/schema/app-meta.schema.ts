import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Key/value table for instance metadata (e.g. schema_version). */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
