CREATE TABLE `dns_record` (
	`hostname` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`record_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`status` text NOT NULL,
	`steps` text NOT NULL,
	`error` text,
	`actor_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_started_at_idx` ON `job` (`started_at`);--> statement-breakpoint
CREATE TABLE `site` (
	`name` text PRIMARY KEY NOT NULL,
	`port` integer NOT NULL,
	`app` text,
	`database` text,
	`runtime` text NOT NULL,
	`managed` integer NOT NULL,
	`dir` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_port_unique` ON `site` (`port`);--> statement-breakpoint
CREATE TABLE `site_hostname` (
	`hostname` text PRIMARY KEY NOT NULL,
	`site_name` text NOT NULL,
	`ingress_managed` integer NOT NULL,
	`dns_managed` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_name`) REFERENCES `site`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_hostname_site_idx` ON `site_hostname` (`site_name`);