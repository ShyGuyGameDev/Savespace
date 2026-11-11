CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`bundle_id` text NOT NULL,
	`app_name` text NOT NULL,
	`window_title` text,
	`signals` text DEFAULT '[]' NOT NULL,
	`ref` text,
	`project_id` text
);
--> statement-breakpoint
CREATE INDEX `activity_at_idx` ON `activity_events` (`at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`trigger` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_source` text DEFAULT 'template' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `checkpoints_project_idx` ON `checkpoints` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `exclusion_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`signals` text NOT NULL,
	`evidence` text NOT NULL,
	`score` real NOT NULL,
	`target_project_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_fingerprint_idx` ON `project_suggestions` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`signals` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_checkpoint_at` integer
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`app` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resources_checkpoint_idx` ON `resources` (`checkpoint_id`,`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
