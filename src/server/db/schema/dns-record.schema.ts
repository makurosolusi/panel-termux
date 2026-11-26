import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** DNS records the panel created in Cloudflare; presence here = panel-owned (only these may be changed/deleted). */
export const dnsRecord = sqliteTable("dns_record", {
  hostname: text("hostname").primaryKey(),
  zoneId: text("zone_id").notNull(),
  recordId: text("record_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
