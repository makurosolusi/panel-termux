import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth.schema";

/** Invite list: Google accounts allowed to sign in besides SUPER_ADMIN_EMAILS. Email stored lowercased. */
export const allowedEmail = sqliteTable("allowed_email", {
  email: text("email").primaryKey(),
  // Inviter may be deleted later; keep the invite.
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
