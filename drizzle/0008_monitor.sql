-- Monitoring history (PLAN/02, A8). Non-critical: may be lost, must stay bounded (pruned hourly by the sampler).
-- One row per sampler tick (default 60 s); nullable columns so a failed section never blocks the row. `at` = unix ms.
CREATE TABLE IF NOT EXISTS `metric_sample` (
	`at` integer PRIMARY KEY NOT NULL,
	`battery_pct` integer,
	`battery_status` text,
	`battery_temp_c` real,
	`mem_available_mb` integer,
	`mem_total_mb` integer,
	`disk_free_mb` integer,
	`load1` real,
	`load5` real,
	`problems_danger` integer NOT NULL,
	`problems_warning` integer NOT NULL
);
--> statement-breakpoint
-- One row per domain probe; WITHOUT ROWID: the composite PK is the table (no second B-tree), prune walks the PK (C20).
CREATE TABLE IF NOT EXISTS `check_result` (
	`hostname` text NOT NULL,
	`at` integer NOT NULL,
	`status` integer,
	`ms` integer,
	`local_status` integer,
	PRIMARY KEY(`hostname`, `at`)
) WITHOUT ROWID;
--> statement-breakpoint
-- Problem lifecycle = alert state. Open rows (closed_at NULL) survive restarts so alerts are not re-sent.
CREATE TABLE IF NOT EXISTS `problem_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`severity` text NOT NULL,
	`params` text NOT NULL,
	`opened_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	`notified_state` text,
	`notified_severity` text,
	`last_sent_at` integer
);
--> statement-breakpoint
-- At most one open event per key; the engine relies on it.
CREATE UNIQUE INDEX IF NOT EXISTS `problem_event_open_key_idx` ON `problem_event` (`key`) WHERE closed_at IS NULL;
--> statement-breakpoint
-- Reopen lookup (key closed < 15 min ago) and retention.
CREATE INDEX IF NOT EXISTS `problem_event_key_closed_idx` ON `problem_event` (`key`,`closed_at`);
