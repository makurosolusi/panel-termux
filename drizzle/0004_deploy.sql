CREATE TABLE `backup_run` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`items` text NOT NULL,
	`error` text,
	`actor_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backup_run_started_at_idx` ON `backup_run` (`started_at`);--> statement-breakpoint
CREATE TABLE `deploy` (
	`id` text PRIMARY KEY NOT NULL,
	`site_name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`runtime` text NOT NULL,
	`job_id` text NOT NULL,
	`actor_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`site_name`) REFERENCES `site`(`name`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deploy_site_at_idx` ON `deploy` (`site_name`,`at`);