-- Health check per site (D16). Existing rows keep the pre-0007 rule ("any status < 500" at /) with a longer timeout.
ALTER TABLE `site` ADD `health_path` text DEFAULT '/' NOT NULL;
--> statement-breakpoint
ALTER TABLE `site` ADD `health_expect` text DEFAULT 'lt500' NOT NULL;
--> statement-breakpoint
ALTER TABLE `site` ADD `health_timeout_sec` integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
-- Journal for recovering interrupted jobs (D11): non-secret request input (names, hostnames, port, sha256, flags).
ALTER TABLE `job` ADD `input` text;
--> statement-breakpoint
-- Id of the cleanup/retry job that resolved this one; null = still needs attention when interrupted/failed.
ALTER TABLE `job` ADD `resolved_by` text;
--> statement-breakpoint
-- Per-site change history (GET /jobs?target=) and "latest job of a site".
CREATE INDEX IF NOT EXISTS `job_target_started_idx` ON `job` (`target`,`started_at`);
--> statement-breakpoint
-- Original upload file name for the deploy history (sanitized, ≤ 255 chars).
ALTER TABLE `deploy` ADD `file_name` text;
--> statement-breakpoint
-- When the deploy/rollback finished (null on rows before 0007 and while running).
ALTER TABLE `deploy` ADD `finished_at` integer;
--> statement-breakpoint
-- Identity of the file this deploy put in place (D22): "Aktif" = stat(app) matches; null on rows before 0007.
ALTER TABLE `deploy` ADD `bin_ino` integer;
--> statement-breakpoint
ALTER TABLE `deploy` ADD `bin_mtime_ms` integer;
