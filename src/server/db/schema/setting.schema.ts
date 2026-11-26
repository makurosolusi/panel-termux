import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth.schema";

/** Runtime settings edited in /dev. Secret values are AES-256-GCM ciphertext (see crypto.service). */
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});
