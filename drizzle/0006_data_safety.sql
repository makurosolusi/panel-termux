-- audit_log: the actor must survive user deletion, and where the request came from (PLAN/04 §3.4).
ALTER TABLE `audit_log` ADD `actor_kind` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `actor_label` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `actor_email` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `ip_masked` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `user_agent` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `request_id` text;
--> statement-breakpoint
-- backup_run: run-level facts for retention (items stay JSON; new item fields are optional in old rows).
ALTER TABLE `backup_run` ADD `includes_secrets` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `backup_run` ADD `panel_version` text;
--> statement-breakpoint
ALTER TABLE `backup_run` ADD `pruned_at` integer;
--> statement-breakpoint
-- Backfill rows written before this migration. Deleted actors cannot be recovered and stay 'unknown'.
UPDATE `audit_log` SET `actor_kind` = 'user',
  `actor_label` = (SELECT `name` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`),
  `actor_email` = (SELECT `email` FROM `user` WHERE `user`.`id` = `audit_log`.`actor_id`)
  WHERE `actor_id` IS NOT NULL;
--> statement-breakpoint
-- Scheduled runs were the only actor-less backup.run rows.
UPDATE `audit_log` SET `actor_kind` = 'system' WHERE `actor_id` IS NULL AND `action` = 'backup.run';
--> statement-breakpoint
-- "Pulihkan ke database baru": one row per restore; target_db is what "Hapus database uji" may drop.
CREATE TABLE IF NOT EXISTS `backup_restore` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`item_index` integer NOT NULL,
	`source_name` text NOT NULL,
	`target_db` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`error_code` text,
	`table_count` integer,
	`actor_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`dropped_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `backup_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Restore history is listed newest first.
CREATE INDEX IF NOT EXISTS `backup_restore_started_at_idx` ON `backup_restore` (`started_at`);
--> statement-breakpoint
-- Audit retention deletes by age (index exists since 0002; kept here as a no-op guard).
CREATE INDEX IF NOT EXISTS `audit_log_at_idx` ON `audit_log` (`at`);
