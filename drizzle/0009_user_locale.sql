-- UI language per account (DECISIONS E2/E3): nullable, null = follow the device; no backfill. SQLite has no
-- ADD COLUMN IF NOT EXISTS: the drizzle journal is the guard (it runs pending migrations in one transaction, so a
-- crash rolls back the ALTER together with its journal row).
ALTER TABLE `user` ADD `locale` text;
--> statement-breakpoint
-- 0.5.x sent Telegram text in Indonesian; keep it for panels that already had alerts set up (PLAN/08 §3.4, E11).
-- Non-secret settings are stored as plain text (settings.service), so the value is the literal 'id'. OR IGNORE keeps
-- a value the owner already chose.
INSERT OR IGNORE INTO `setting` (`key`, `value`)
SELECT 'alerts.language', 'id'
WHERE EXISTS (SELECT 1 FROM `setting` WHERE `key` IN ('alerts.telegram_bot_token', 'alerts.telegram_chat_id'));
